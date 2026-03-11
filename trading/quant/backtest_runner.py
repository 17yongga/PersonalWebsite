#!/usr/bin/env python3
"""
Backtest Runner — CLI entry point for running strategy backtests.
Called by the Node.js trading server; outputs JSON to stdout.

Usage:
    python3 backtest_runner.py \
        --strategy momentum \
        --start 2023-01-01 \
        --end 2024-01-01 \
        --capital 10000
"""

import argparse
import json
import sys
import os
import logging
from datetime import datetime, timedelta
from typing import Dict, List

# Suppress noisy logs on stdout (only use stderr for non-JSON output)
logging.basicConfig(stream=sys.stderr, level=logging.WARNING)

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import config
from alpaca_client import client
from backtesting.engine import BacktestEngine
from strategies.momentum import MomentumStrategy
from strategies.mean_reversion import MeanReversionStrategy
from strategies.sector_rotation import SectorRotationStrategy
from strategies.value_dividend import ValueDividendStrategy
from strategies.volatility_breakout import VolatilityBreakoutStrategy

import pandas as pd
import numpy as np

# ── Strategy universe (mirrors strategy_executor.py) ──────────────────────────

STRATEGY_CONFIG = {
    'momentum': {
        'class': MomentumStrategy,
        'name': 'Momentum Rider',
        'symbols': ['AAPL', 'MSFT', 'GOOGL', 'NVDA', 'META', 'TSLA', 'AMZN', 'JPM', 'V', 'MA'],
        'description': 'RSI, MACD, and EMA crossover trend-following system',
    },
    'mean_reversion': {
        'class': MeanReversionStrategy,
        'name': 'Contrarian',
        'symbols': ['AAPL', 'MSFT', 'GOOGL', 'NVDA', 'META', 'TSLA', 'AMZN', 'JPM', 'V', 'MA'],
        'description': 'Bollinger Band & Z-score mean-reversion system',
    },
    'sector_rotation': {
        'class': SectorRotationStrategy,
        'name': 'Sector Rotator',
        'symbols': ['XLK', 'XLF', 'XLE', 'XLV', 'XLI', 'XLP', 'XLU', 'XLY', 'XLC', 'XLRE', 'XLB'],
        'description': 'Relative-strength sector ETF rotation',
        'universe_key': True,
    },
    'value_dividend': {
        'class': ValueDividendStrategy,
        'name': 'Dividend Hunter',
        'symbols': ['VZ', 'T', 'KO', 'PEP', 'PG', 'JNJ', 'XOM', 'CVX', 'ABBV', 'PFE', 'IBM', 'MMM'],
        'description': 'Low P/E, high-dividend value strategy',
        'universe_key': True,
    },
    'volatility_breakout': {
        'class': VolatilityBreakoutStrategy,
        'name': 'Volatility Trader',
        'symbols': ['TSLA', 'NVDA', 'AMD', 'COIN', 'MSTR', 'SQ', 'SHOP', 'ROKU', 'PLTR', 'SNAP'],
        'description': 'ATR-based breakout on high-volatility momentum stocks',
    },
}

BENCHMARK_SYMBOL = 'SPY'


def fetch_historical_data(symbols: List[str], start: str, end: str) -> Dict[str, pd.DataFrame]:
    """Fetch OHLCV data from Alpaca for a list of symbols."""
    # Add extra lookback for indicator warm-up (30 calendar days before start)
    dt_start = datetime.strptime(start, '%Y-%m-%d') - timedelta(days=45)
    fetch_start = dt_start.strftime('%Y-%m-%d')

    data = {}
    for symbol in symbols:
        try:
            bars = client.get_bars_for_symbol(symbol, timeframe='1Day', start=fetch_start, end=end)
            if not bars:
                continue
            df = pd.DataFrame(bars)
            if df.empty:
                continue

            # Alpaca v2 short column names
            ts_col = 't' if 't' in df.columns else 'timestamp'
            df['timestamp'] = pd.to_datetime(df[ts_col], utc=True).dt.tz_convert(None)
            df.set_index('timestamp', inplace=True)
            df.rename(columns={'o': 'open', 'h': 'high', 'l': 'low', 'c': 'close', 'v': 'volume'}, inplace=True)

            req_cols = ['open', 'high', 'low', 'close', 'volume']
            if all(c in df.columns for c in req_cols):
                data[symbol] = df[req_cols].sort_index()
        except Exception as e:
            sys.stderr.write(f"[backtest_runner] Failed to fetch {symbol}: {e}\n")

    return data


def build_equity_curve(portfolio_history, start: str) -> List[dict]:
    """Convert portfolio history to serialisable list, filtered to requested start date."""
    result = []
    for row in portfolio_history:
        date_str = str(row['date'])[:10]
        if date_str >= start:
            result.append({
                'date': date_str,
                'value': round(float(row['portfolio_value']), 2),
            })
    return result


def build_benchmark_curve(benchmark_df: pd.DataFrame, equity_curve: List[dict], initial_capital: float) -> List[dict]:
    """Normalise SPY to the same initial capital over the backtest period."""
    if benchmark_df is None or benchmark_df.empty or not equity_curve:
        return []

    start_date = equity_curve[0]['date']
    end_date = equity_curve[-1]['date']

    # Filter benchmark to backtest window
    bdf = benchmark_df[(benchmark_df.index.astype(str) >= start_date) &
                       (benchmark_df.index.astype(str) <= end_date)]['close']

    if bdf.empty:
        return []

    base_price = float(bdf.iloc[0])
    curve = []
    for ts, price in bdf.items():
        curve.append({
            'date': str(ts)[:10],
            'value': round(float(price) / base_price * initial_capital, 2),
        })
    return curve


def build_drawdown_curve(equity_curve: List[dict]) -> List[dict]:
    """Compute underwater equity curve (drawdown %) from equity curve."""
    if not equity_curve:
        return []
    values = [r['value'] for r in equity_curve]
    peak = values[0]
    result = []
    for i, row in enumerate(equity_curve):
        v = row['value']
        if v > peak:
            peak = v
        dd = ((v - peak) / peak) * 100 if peak > 0 else 0
        result.append({'date': row['date'], 'drawdown': round(dd, 4)})
    return result


def build_monthly_returns(equity_curve: List[dict]) -> List[dict]:
    """Build month-by-month return grid for heatmap display."""
    if len(equity_curve) < 2:
        return []

    df = pd.DataFrame(equity_curve)
    df['date'] = pd.to_datetime(df['date'])
    df = df.set_index('date').sort_index()

    monthly = df['value'].resample('ME').last()
    monthly_returns = monthly.pct_change().dropna()

    result = []
    for ts, ret in monthly_returns.items():
        result.append({
            'year': ts.year,
            'month': ts.month,
            'return': round(float(ret) * 100, 2),
        })
    return result


def serialize_trades(trades) -> List[dict]:
    """Convert Trade dataclass list to JSON-serialisable dicts."""
    result = []
    for t in trades:
        result.append({
            'symbol': t.symbol,
            'entry_date': str(t.entry_date)[:10],
            'exit_date': str(t.exit_date)[:10],
            'entry_price': round(float(t.entry_price), 4),
            'exit_price': round(float(t.exit_price), 4),
            'quantity': int(t.quantity),
            'side': t.side,
            'pnl': round(float(t.pnl), 2),
            'pnl_pct': round(float(t.pnl_pct), 4),
            'duration_days': int(t.duration_days),
            'entry_reason': t.entry_reason or '',
            'exit_reason': t.exit_reason or '',
        })
    # Sort newest first
    result.sort(key=lambda x: x['exit_date'], reverse=True)
    return result


def serialize_metrics(metrics: dict) -> dict:
    """Round and serialise all metrics, handling inf/nan."""
    out = {}
    for k, v in metrics.items():
        if isinstance(v, float):
            if np.isnan(v) or np.isinf(v):
                out[k] = None
            else:
                out[k] = round(v, 6)
        elif isinstance(v, (int, bool)):
            out[k] = v
        else:
            out[k] = v
    return out


def main():
    parser = argparse.ArgumentParser(description='Run a strategy backtest and output JSON results.')
    parser.add_argument('--strategy', required=True,
                        choices=list(STRATEGY_CONFIG.keys()),
                        help='Strategy slug to backtest')
    parser.add_argument('--start', required=True, help='Start date YYYY-MM-DD')
    parser.add_argument('--end', required=True, help='End date YYYY-MM-DD')
    parser.add_argument('--capital', type=float, default=10000.0, help='Initial capital')
    args = parser.parse_args()

    cfg = STRATEGY_CONFIG[args.strategy]

    try:
        # ── 1. Fetch market data ──────────────────────────────────────────
        all_symbols = list(set(cfg['symbols'] + [BENCHMARK_SYMBOL]))
        raw_data = fetch_historical_data(all_symbols, args.start, args.end)

        # Separate benchmark
        benchmark_df = raw_data.pop(BENCHMARK_SYMBOL, None)
        strategy_data = {s: raw_data[s] for s in cfg['symbols'] if s in raw_data}

        if len(strategy_data) < 2:
            raise ValueError(f"Insufficient data — only {len(strategy_data)} symbols loaded. "
                             "Alpaca may be rate-limiting or the date range is invalid.")

        # ── 2. Initialise strategy ────────────────────────────────────────
        StrategyClass = cfg['class']

        # Strategies that need a 'universe' kwarg
        if cfg.get('universe_key'):
            strategy = StrategyClass({'universe': list(strategy_data.keys())})
        else:
            strategy = StrategyClass()

        # ── 3. Run backtest ───────────────────────────────────────────────
        engine = BacktestEngine(
            initial_capital=args.capital,
            commission=1.0,
            slippage=0.001,
            market_impact=0.0005,
        )
        results = engine.run_backtest(
            strategy=strategy,
            data=strategy_data,
            start_date=args.start,
            end_date=args.end,
        )

        # ── 4. Build output ───────────────────────────────────────────────
        portfolio_history = results.get('portfolio_history')
        if portfolio_history is not None and not portfolio_history.empty:
            ph_list = portfolio_history.reset_index().to_dict('records')
        else:
            ph_list = []

        equity_curve = build_equity_curve(ph_list, args.start)
        benchmark_curve = build_benchmark_curve(benchmark_df, equity_curve, args.capital)
        drawdown_curve = build_drawdown_curve(equity_curve)
        monthly_returns = build_monthly_returns(equity_curve)
        trades = serialize_trades(results.get('trades', []))
        metrics = serialize_metrics(results.get('metrics', {}))

        output = {
            'success': True,
            'strategy': args.strategy,
            'strategy_name': cfg['name'],
            'start_date': args.start,
            'end_date': args.end,
            'initial_capital': args.capital,
            'symbols_used': list(strategy_data.keys()),
            'equity_curve': equity_curve,
            'benchmark_curve': benchmark_curve,
            'drawdown_curve': drawdown_curve,
            'monthly_returns': monthly_returns,
            'trades': trades,
            'metrics': metrics,
        }

        print(json.dumps(output))

    except Exception as e:
        error_output = {
            'success': False,
            'error': str(e),
            'strategy': args.strategy,
        }
        print(json.dumps(error_output))
        sys.exit(1)


if __name__ == '__main__':
    main()
