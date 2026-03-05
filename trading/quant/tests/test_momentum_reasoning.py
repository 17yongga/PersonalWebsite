"""Tests for momentum strategy reasoning field."""

import pytest
import pandas as pd
import numpy as np
from strategies.base import Signal
from strategies.momentum import MomentumStrategy


def _make_dataframe(n=100, trend='up'):
    """Build a synthetic OHLCV DataFrame."""
    np.random.seed(42)
    dates = pd.date_range('2024-01-01', periods=n, freq='B')
    base = 100.0
    prices = [base]
    for _ in range(n - 1):
        pct = np.random.normal(0.002 if trend == 'up' else -0.002, 0.015)
        prices.append(prices[-1] * (1 + pct))
    close = np.array(prices)
    df = pd.DataFrame({
        'open': close * (1 + np.random.uniform(-0.005, 0.005, n)),
        'high': close * (1 + np.random.uniform(0.001, 0.015, n)),
        'low': close * (1 - np.random.uniform(0.001, 0.015, n)),
        'close': close,
        'volume': np.random.randint(100000, 10000000, n),
    }, index=dates)
    return df


def _force_signal(strategy, data, side='buy'):
    """Manipulate the last two rows to force a signal crossing."""
    d = data.copy()
    if side == 'buy':
        # Force RSI to rise above 55, MACD bullish, EMA crossover
        d.iloc[-2, d.columns.get_loc('close')] = d.iloc[-3]['close'] * 0.90
        d.iloc[-1, d.columns.get_loc('close')] = d.iloc[-3]['close'] * 1.05
    else:
        d.iloc[-2, d.columns.get_loc('close')] = d.iloc[-3]['close'] * 1.10
        d.iloc[-1, d.columns.get_loc('close')] = d.iloc[-3]['close'] * 0.85
    d['volume'] = 1000000  # ensure volume filter passes
    return d


class TestMomentumReasoning:
    def setup_method(self):
        self.strategy = MomentumStrategy()

    def test_buy_signal_has_reasoning(self):
        data = _make_dataframe(100, trend='up')
        data = _force_signal(self.strategy, data, side='buy')
        signals = self.strategy.generate_signals(data, symbol='TEST')
        buy_signals = [s for s in signals if s.action == 'buy']
        if buy_signals:
            sig = buy_signals[0]
            assert sig.reasoning is not None, "Buy signal should have reasoning"
            assert 'indicators' in sig.reasoning
            assert 'condition' in sig.reasoning
            assert 'decision' in sig.reasoning
            assert sig.reasoning['decision'] == 'BUY'

    def test_sell_signal_has_reasoning(self):
        data = _make_dataframe(100, trend='down')
        data = _force_signal(self.strategy, data, side='sell')
        signals = self.strategy.generate_signals(data, symbol='TEST')
        sell_signals = [s for s in signals if s.action == 'sell']
        if sell_signals:
            sig = sell_signals[0]
            assert sig.reasoning is not None, "Sell signal should have reasoning"
            assert 'indicators' in sig.reasoning
            assert 'condition' in sig.reasoning
            assert 'decision' in sig.reasoning
            assert sig.reasoning['decision'] == 'SELL'

    def test_reasoning_none_safe(self):
        """Passing reasoning=None to Signal() should not raise."""
        sig = Signal(
            symbol='TEST',
            action='hold',
            confidence=0.5,
            price=100.0,
            reasoning=None
        )
        assert sig.reasoning is None

    def test_indicator_values_are_floats(self):
        data = _make_dataframe(100, trend='up')
        data = _force_signal(self.strategy, data, side='buy')
        signals = self.strategy.generate_signals(data, symbol='TEST')
        buy_signals = [s for s in signals if s.action == 'buy']
        if buy_signals:
            rsi = buy_signals[0].reasoning['indicators']['rsi']
            assert isinstance(rsi, float), f"RSI should be float, got {type(rsi)}"
            assert not np.isnan(rsi), "RSI should not be NaN"
