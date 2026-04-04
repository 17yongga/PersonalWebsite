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
from typing import Dict, List, Any, Optional
from dataclasses import dataclass

logging.basicConfig(stream=sys.stderr, level=logging.WARNING)

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import config
from alpaca_client import client
from strategies.momentum import MomentumStrategy
from strategies.mean_reversion import MeanReversionStrategy
from strategies.sector_rotation import SectorRotationStrategy
from strategies.value_dividend import ValueDividendStrategy
from strategies.volatility_breakout import VolatilityBreakoutStrategy

import pandas as pd
import numpy as np

# ── Strategy config ────────────────────────────────────────────────────────────

STRATEGY_CONFIG = {
    'momentum': {
        'class': MomentumStrategy,
        'name': 'Momentum Rider',
        'symbols': ['AAPL', 'MSFT', 'GOOGL', 'NVDA', 'META', 'TSLA', 'AMZN', 'JPM', 'V', 'MA'],
        'universe_key': False,
    },
    'mean_reversion': {
        'class': MeanReversionStrategy,
        'name': 'Contrarian',
        'symbols': ['AAPL', 'MSFT', 'GOOGL', 'NVDA', 'META', 'TSLA', 'AMZN', 'JPM', 'V', 'MA'],
        'universe_key': False,
    },
    'sector_rotation': {
        'class': SectorRotationStrategy,
        'name': 'Sector Rotator',
        'symbols': ['XLK', 'XLF', 'XLE', 'XLV', 'XLI', 'XLP', 'XLU', 'XLY', 'XLC', 'XLRE', 'XLB'],
        'universe_key': True,
    },
    'value_dividend': {
        'class': ValueDividendStrategy,
        'name': 'Dividend Hunter',
        'symbols': ['VZ', 'T', 'KO', 'PEP', 'PG', 'JNJ', 'XOM', 'CVX', 'ABBV', 'PFE', 'IBM', 'MMM'],
        'universe_key': True,
    },
    'volatility_breakout': {
        'class': VolatilityBreakoutStrategy,
        'name': 'Volatility Trader',
        'symbols': ['TSLA', 'NVDA', 'AMD', 'COIN', 'MSTR', 'SQ', 'SHOP', 'ROKU', 'PLTR', 'SNAP'],
        'universe_key': False,
    },
}

BENCHMARK_SYMBOL = 'SPY'
COMMISSION = 1.0       # $ per trade
SLIPPAGE   = 0.001     # 0.1%


# ── Data fetching ─────────────────────────────────────────────────────────────

def fetch_data(symbols: List[str], start: str, end: str) -> Dict[str, pd.DataFrame]:
    """Fetch OHLCV data from Alpaca with 90-day warm-up prepended."""
    dt_start  = datetime.strptime(start, '%Y-%m-%d') - timedelta(days=90)
    fetch_from = dt_start.strftime('%Y-%m-%d')

    data = {}
    for sym in symbols:
        try:
            bars = client.get_bars_for_symbol(sym, timeframe='1Day', start=fetch_from, end=end)
            if not bars:
                continue
            df = pd.DataFrame(bars)
            if df.empty:
                continue
            ts_col = 't' if 't' in df.columns else 'timestamp'
            df['timestamp'] = pd.to_datetime(df[ts_col], utc=True).dt.tz_convert(None)
            df.set_index('timestamp', inplace=True)
            df.rename(columns={'o':'open','h':'high','l':'low','c':'close','v':'volume'}, inplace=True)
            req = ['open', 'high', 'low', 'close', 'volume']
            if all(c in df.columns for c in req):
                data[sym] = df[req].sort_index()
        except Exception as e:
            sys.stderr.write(f"[runner] fetch {sym}: {e}\n")
    return data


# ── Simple backtest engine ────────────────────────────────────────────────────
# Fixes the core bug in BacktestEngine: it was passing a single-day row to
# generate_signals instead of the full cumulative history the strategy needs
# for RSI/MACD/EMA calculation.

@dataclass
class Trade:
    symbol:       str
    entry_date:   str
    exit_date:    str
    entry_price:  float
    exit_price:   float
    quantity:     int
    side:         str
    pnl:          float
    pnl_pct:      float
    duration_days: int
    entry_reason: str
    exit_reason:  str


def run_backtest(
    strategy,
    symbol_data: Dict[str, pd.DataFrame],
    start: str,
    end:   str,
    initial_capital: float = 10000.0,
) -> Dict[str, Any]:
    """
    Correct backtest: on each trading day, strategy receives ALL history up to
    that date — enabling proper indicator calculation.
    """
    # Gather trading dates in the requested range (union of all symbols)
    all_dates = set()
    for df in symbol_data.values():
        mask = (df.index.strftime('%Y-%m-%d') >= start) & \
               (df.index.strftime('%Y-%m-%d') <= end)
        all_dates.update(df.index[mask].strftime('%Y-%m-%d'))
    trading_dates = sorted(all_dates)

    if not trading_dates:
        raise ValueError("No trading dates found in the requested range")

    cash       = float(initial_capital)
    positions  = {}   # symbol -> {qty, entry_price, entry_date, entry_reason}
    trades:    List[Trade] = []
    portfolio_history = []

    for date_str in trading_dates:
        date_ts = pd.Timestamp(date_str)

        # ── Update open positions with today's closing price ───────────────
        day_prices = {}
        for sym, df in symbol_data.items():
            day_rows = df[df.index.strftime('%Y-%m-%d') == date_str]
            if not day_rows.empty:
                day_prices[sym] = float(day_rows['close'].iloc[-1])

        # ── Generate signals: pass full history UP TO (and including) today ─
        all_signals = []
        for sym, df in symbol_data.items():
            hist = df[df.index <= date_ts]
            if hist.empty:
                continue
            try:
                sigs = strategy.generate_signals(hist, symbol=sym)
                all_signals.extend(sigs)
            except TypeError:
                try:
                    sigs = strategy.generate_signals(hist)
                    all_signals.extend(sigs)
                except Exception:
                    pass
            except Exception as e:
                sys.stderr.write(f"[runner] signal error {sym} {date_str}: {e}\n")

        # ── Execute signals ─────────────────────────────────────────────────
        for sig in all_signals:
            sym   = sig.symbol
            price = day_prices.get(sym)
            if price is None:
                continue

            fill_price = price * (1 + SLIPPAGE if sig.action == 'buy' else 1 - SLIPPAGE)

            if sig.action == 'buy' and sym not in positions:
                # Size: 10% of portfolio, max 1 position per symbol
                portfolio_val = cash + sum(
                    pos['qty'] * day_prices.get(s, pos['entry_price'])
                    for s, pos in positions.items()
                )
                alloc  = portfolio_val * 0.10
                qty    = max(1, int(alloc / fill_price))
                cost   = qty * fill_price + COMMISSION
                if cost <= cash:
                    cash -= cost
                    positions[sym] = {
                        'qty':          qty,
                        'entry_price':  fill_price,
                        'entry_date':   date_str,
                        'entry_reason': getattr(sig, 'reason', ''),
                    }

            elif sig.action == 'sell' and sym in positions:
                pos       = positions.pop(sym)
                proceeds  = pos['qty'] * fill_price - COMMISSION
                cash     += proceeds
                pnl       = proceeds - pos['qty'] * pos['entry_price'] - COMMISSION
                pnl_pct   = (fill_price - pos['entry_price']) / pos['entry_price']
                entry_dt  = pd.Timestamp(pos['entry_date'])
                duration  = max(1, (date_ts - entry_dt).days)
                trades.append(Trade(
                    symbol       = sym,
                    entry_date   = pos['entry_date'],
                    exit_date    = date_str,
                    entry_price  = pos['entry_price'],
                    exit_price   = fill_price,
                    quantity     = pos['qty'],
                    side         = 'buy',
                    pnl          = pnl,
                    pnl_pct      = pnl_pct * 100,
                    duration_days= duration,
                    entry_reason = pos['entry_reason'],
                    exit_reason  = getattr(sig, 'reason', ''),
                ))

        # ── Record portfolio value ──────────────────────────────────────────
        positions_value = sum(
            pos['qty'] * day_prices.get(sym, pos['entry_price'])
            for sym, pos in positions.items()
        )
        portfolio_history.append({
            'date':            date_str,
            'portfolio_value': round(cash + positions_value, 2),
        })

    # ── Close any remaining positions at last available price ──────────────
    last_date = trading_dates[-1] if trading_dates else end
    for sym, pos in list(positions.items()):
        last_price = day_prices.get(sym, pos['entry_price'])
        pnl    = pos['qty'] * (last_price - pos['entry_price']) - COMMISSION
        pnl_pct = (last_price - pos['entry_price']) / pos['entry_price']
        entry_dt = pd.Timestamp(pos['entry_date'])
        duration = max(1, (pd.Timestamp(last_date) - entry_dt).days)
        trades.append(Trade(
            symbol        = sym,
            entry_date    = pos['entry_date'],
            exit_date     = last_date,
            entry_price   = pos['entry_price'],
            exit_price    = last_price,
            quantity      = pos['qty'],
            side          = 'buy',
            pnl           = pnl,
            pnl_pct       = pnl_pct * 100,
            duration_days = duration,
            entry_reason  = pos['entry_reason'],
            exit_reason   = 'End of backtest period',
        ))

    return {'portfolio_history': portfolio_history, 'trades': trades}


# ── Metrics ────────────────────────────────────────────────────────────────────

def compute_metrics(portfolio_history: List[dict], trades: List[Trade],
                    initial_capital: float) -> dict:
    if not portfolio_history:
        return {}

    values = [r['portfolio_value'] for r in portfolio_history]
    final  = values[-1]
    days   = len(values)

    total_return   = (final - initial_capital) / initial_capital
    ann_return     = (1 + total_return) ** (252 / max(days, 1)) - 1 if days > 1 else 0.0

    # Daily returns
    returns = pd.Series(values).pct_change().dropna()
    vol     = float(returns.std() * np.sqrt(252)) if len(returns) > 1 else 0.0
    sharpe  = (ann_return / vol) if vol > 0 else 0.0

    # Drawdown
    cum   = pd.Series(values)
    peak  = cum.cummax()
    dd    = (cum - peak) / peak
    max_dd = float(dd.min())

    # Underwater duration
    is_under    = dd < 0
    transitions = is_under.astype(int).diff()
    starts      = list(transitions[transitions == 1].index)
    ends        = list(transitions[transitions == -1].index)
    durations   = []
    for s in starts:
        e_cands = [e for e in ends if e > s]
        e = e_cands[0] if e_cands else len(dd) - 1
        durations.append(e - s)
    max_dd_days = int(max(durations)) if durations else 0

    # Sortino
    neg_returns = returns[returns < 0]
    down_std    = float(neg_returns.std() * np.sqrt(252)) if len(neg_returns) > 1 else 0.0
    sortino     = (ann_return / down_std) if down_std > 0 else 0.0

    # Calmar
    calmar = (ann_return / abs(max_dd)) if max_dd != 0 else 0.0

    # Trade stats
    pnls       = [t.pnl for t in trades]
    wins       = [p for p in pnls if p > 0]
    losses     = [p for p in pnls if p <= 0]
    win_rate   = len(wins) / len(pnls) if pnls else 0.0
    avg_win    = float(np.mean(wins))    if wins   else 0.0
    avg_loss   = float(np.mean(losses))  if losses else 0.0
    gross_profit = sum(wins)
    gross_loss   = abs(sum(losses))
    profit_factor = (gross_profit / gross_loss) if gross_loss > 0 else (1.0 if not losses else 0.0)
    avg_duration  = float(np.mean([t.duration_days for t in trades])) if trades else 0.0

    # VaR / ES
    var_95 = float(returns.quantile(0.05)) if len(returns) > 5 else 0.0
    es_95  = float(returns[returns <= returns.quantile(0.05)].mean()) if len(returns) > 5 else 0.0

    return {
        'final_value':              round(final, 2),
        'total_return':             round(total_return, 6),
        'annualized_return':        round(ann_return, 6),
        'volatility':               round(vol, 6),
        'sharpe_ratio':             round(sharpe, 4),
        'sortino_ratio':            round(sortino, 4),
        'calmar_ratio':             round(calmar, 4),
        'max_drawdown':             round(max_dd, 6),
        'max_drawdown_duration_days': max_dd_days,
        'win_rate':                 round(win_rate, 4),
        'total_trades':             len(trades),
        'winning_trades':           len(wins),
        'losing_trades':            len(losses),
        'avg_win':                  round(avg_win, 2),
        'avg_loss':                 round(avg_loss, 2),
        'largest_win':              round(max(wins, default=0.0), 2),
        'largest_loss':             round(min(losses, default=0.0), 2),
        'profit_factor':            round(profit_factor, 4),
        'avg_trade_duration':       round(avg_duration, 1),
        'var_95':                   round(var_95, 6),
        'expected_shortfall':       round(es_95, 6),
        'backtest_days':            days,
    }


# ── Output builders ───────────────────────────────────────────────────────────

def build_benchmark_curve(benchmark_df, portfolio_history, initial_capital):
    if benchmark_df is None or benchmark_df.empty or not portfolio_history:
        return []
    start = portfolio_history[0]['date']
    end   = portfolio_history[-1]['date']
    bdf   = benchmark_df[(benchmark_df.index.strftime('%Y-%m-%d') >= start) &
                         (benchmark_df.index.strftime('%Y-%m-%d') <= end)]['close']
    if bdf.empty:
        return []
    base = float(bdf.iloc[0])
    return [{'date': str(ts)[:10], 'value': round(float(p)/base*initial_capital, 2)}
            for ts, p in bdf.items()]


def build_drawdown_curve(portfolio_history):
    if not portfolio_history:
        return []
    values = [r['portfolio_value'] for r in portfolio_history]
    peak   = values[0]
    result = []
    for row, v in zip(portfolio_history, values):
        if v > peak:
            peak = v
        dd = ((v - peak) / peak * 100) if peak > 0 else 0
        result.append({'date': row['date'], 'drawdown': round(dd, 4)})
    return result


def build_monthly_returns(portfolio_history):
    if len(portfolio_history) < 2:
        return []
    df = pd.DataFrame(portfolio_history)
    df['date'] = pd.to_datetime(df['date'])
    df = df.set_index('date').sort_index()
    monthly  = df['portfolio_value'].resample('ME').last()
    mr       = monthly.pct_change().dropna()
    return [{'year': int(ts.year), 'month': int(ts.month), 'return': round(float(r)*100, 2)}
            for ts, r in mr.items()]


def serialize_trades(trades: List[Trade]):
    result = []
    for t in trades:
        result.append({
            'symbol':       t.symbol,
            'entry_date':   t.entry_date[:10],
            'exit_date':    t.exit_date[:10],
            'entry_price':  round(t.entry_price, 4),
            'exit_price':   round(t.exit_price, 4),
            'quantity':     t.quantity,
            'side':         t.side,
            'pnl':          round(t.pnl, 2),
            'pnl_pct':      round(t.pnl_pct, 4),
            'duration_days': t.duration_days,
            'entry_reason': t.entry_reason or '',
            'exit_reason':  t.exit_reason or '',
        })
    return sorted(result, key=lambda x: x['exit_date'], reverse=True)


# ── Main ───────────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--strategy', required=True, choices=list(STRATEGY_CONFIG.keys()))
    parser.add_argument('--start',    required=True)
    parser.add_argument('--end',      required=True)
    parser.add_argument('--capital',  type=float, default=10000.0)
    args = parser.parse_args()

    cfg = STRATEGY_CONFIG[args.strategy]

    try:
        # 1. Fetch data
        all_symbols  = list(set(cfg['symbols'] + [BENCHMARK_SYMBOL]))
        raw          = fetch_data(all_symbols, args.start, args.end)
        benchmark_df = raw.pop(BENCHMARK_SYMBOL, None)
        strat_data   = {s: raw[s] for s in cfg['symbols'] if s in raw}

        if len(strat_data) < 2:
            raise ValueError(f"Only {len(strat_data)} symbols loaded — check date range or API limits.")

        # 2. Init strategy
        StratClass = cfg['class']
        strategy   = StratClass({'universe': list(strat_data.keys())}) \
                     if cfg['universe_key'] else StratClass()

        # 3. Run correct backtest
        result = run_backtest(strategy, strat_data, args.start, args.end, args.capital)

        ph     = result['portfolio_history']
        trades = result['trades']

        # 4. Compute metrics & build output
        metrics = compute_metrics(ph, trades, args.capital)

        output = {
            'success':        True,
            'strategy':       args.strategy,
            'strategy_name':  cfg['name'],
            'start_date':     args.start,
            'end_date':       args.end,
            'initial_capital': args.capital,
            'symbols_used':   list(strat_data.keys()),
            'equity_curve':   ph,
            'benchmark_curve': build_benchmark_curve(benchmark_df, ph, args.capital),
            'drawdown_curve': build_drawdown_curve(ph),
            'monthly_returns': build_monthly_returns(ph),
            'trades':         serialize_trades(trades),
            'metrics':        metrics,
        }
        print(json.dumps(output))

    except Exception as e:
        import traceback
        sys.stderr.write(traceback.format_exc())
        print(json.dumps({'success': False, 'error': str(e), 'strategy': args.strategy}))
        sys.exit(1)


if __name__ == '__main__':
    main()
