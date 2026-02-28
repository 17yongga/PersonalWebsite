"""Volatility Breakout Strategy — replaces placeholder Sentiment strategy."""

import pandas as pd
import numpy as np
from typing import Dict, List, Any
from .base import Strategy, Signal

class VolatilityBreakoutStrategy(Strategy):
    """
    Volatility Breakout strategy using ATR expansion, volume spikes,
    and price breakouts above recent consolidation highs/lows.

    Entry conditions (BUY):
    - Price breaks above the N-day high (range breakout)
    - Volume spike >= volume_factor × 20-day avg volume
    - ATR expansion (current ATR > atr_threshold × avg ATR) — expanding volatility

    Entry conditions (SELL/short signal):
    - Price breaks below the N-day low
    - Volume spike
    - ATR expansion

    This strategy is HIGH frequency vs value/mean-reversion — it fires on breakouts
    and is best suited for volatile large-caps: TSLA, NVDA, AMD, APP, PLTR.
    """

    name = "Volatility Breakout Strategy"
    description = "Breakout trading on volume spikes and ATR expansion"

    def __init__(self, config: Dict[str, Any] = None):
        default_config = {
            'universe': ['TSLA', 'NVDA', 'AMD', 'APP', 'PLTR', 'META', 'MSTR', 'COIN'],
            'breakout_period': 20,      # N-day high/low for breakout
            'volume_factor': 1.5,       # Volume spike multiplier (1.5× avg = signal)
            'volume_avg_period': 20,    # Period for volume average
            'atr_period': 14,           # ATR calculation period
            'atr_threshold': 1.2,       # ATR must be 1.2× its average (expanding vol)
            'atr_avg_period': 20,       # Period for ATR average
            'min_atr_pct': 0.02,        # Minimum ATR as % of price (2%)
            'min_volume': 1000000,      # Minimum daily volume
            'stop_loss': -0.08,         # 8% stop loss (tight — breakout trades)
            'take_profit': 0.15,        # 15% take profit
            'confirm_close': True,      # Require close above breakout level (not just intraday)
        }

        if config:
            default_config.update(config)

        super().__init__(default_config)

    def validate_config(self, config: Dict[str, Any]) -> bool:
        required_keys = ['breakout_period', 'volume_factor', 'atr_period']
        for key in required_keys:
            if key not in config:
                raise ValueError(f"Missing required parameter: {key}")
        if config['volume_factor'] <= 1.0:
            raise ValueError("Volume factor must be > 1.0 to detect actual spikes")
        return True

    def get_parameters(self) -> Dict[str, Any]:
        return {
            'breakout_period': 'N-day high/low lookback for breakout detection (default: 20)',
            'volume_factor': 'Volume spike multiplier vs avg (default: 1.5×)',
            'atr_period': 'ATR calculation period (default: 14)',
            'atr_threshold': 'ATR expansion threshold vs avg ATR (default: 1.2×)',
            'stop_loss': 'Stop loss threshold (default: -8%)',
            'take_profit': 'Take profit threshold (default: +15%)',
        }

    def generate_signals(self, data: pd.DataFrame, symbol: str = None) -> List[Signal]:
        signals = []

        min_periods = max(
            self.config['breakout_period'],
            self.config['volume_avg_period'],
            self.config['atr_period'] + self.config['atr_avg_period']
        ) + 5

        if len(data) < min_periods:
            return signals

        data = data.copy()

        # --- ATR (Average True Range) ---
        high = data['high']
        low = data['low']
        close = data['close']
        prev_close = close.shift(1)

        tr = pd.concat([
            high - low,
            (high - prev_close).abs(),
            (low - prev_close).abs()
        ], axis=1).max(axis=1)

        atr = tr.rolling(self.config['atr_period']).mean()
        atr_avg = atr.rolling(self.config['atr_avg_period']).mean()

        data['atr'] = atr
        data['atr_avg'] = atr_avg
        data['atr_expanding'] = atr > (self.config['atr_threshold'] * atr_avg)

        # --- N-day breakout levels (use shift(1) to avoid lookahead) ---
        n = self.config['breakout_period']
        data['n_day_high'] = high.shift(1).rolling(n).max()
        data['n_day_low'] = low.shift(1).rolling(n).min()

        # --- Volume spike ---
        vol_avg = data['volume'].rolling(self.config['volume_avg_period']).mean()
        data['volume_spike'] = data['volume'] > (self.config['volume_factor'] * vol_avg)

        # --- Symbol ---
        if symbol:
            sym = symbol
        elif 'symbol' in data.columns:
            sym = data['symbol'].iloc[0]
        else:
            sym = 'UNKNOWN'

        # Volume filter
        if data['volume'].iloc[-1] < self.config['min_volume']:
            return signals

        latest = data.iloc[-1]
        prev = data.iloc[-2]

        # Skip if indicators not ready
        if pd.isna(latest['n_day_high']) or pd.isna(latest['atr']):
            return signals

        # ATR as % of price (avoid low-volatility noise)
        atr_pct = latest['atr'] / latest['close']
        if atr_pct < self.config['min_atr_pct']:
            return signals

        action = 'hold'
        confidence = 0.0

        # BUY: price closes above N-day high with volume spike + expanding ATR
        if (latest['close'] > latest['n_day_high'] and
                latest['volume_spike'] and
                latest['atr_expanding']):
            action = 'buy'
            # Confidence: how far above breakout, how big the volume spike
            breakout_pct = (latest['close'] - latest['n_day_high']) / latest['n_day_high']
            vol_ratio = latest['volume'] / (vol_avg.iloc[-1] if not pd.isna(vol_avg.iloc[-1]) else 1)
            atr_ratio = latest['atr'] / (latest['atr_avg'] if not pd.isna(latest['atr_avg']) else 1)
            confidence = min(0.5 + (breakout_pct * 5) + (vol_ratio - 1) * 0.1 + (atr_ratio - 1) * 0.1, 1.0)

        # SELL: price closes below N-day low with volume spike + expanding ATR
        elif (latest['close'] < latest['n_day_low'] and
              latest['volume_spike'] and
              latest['atr_expanding']):
            action = 'sell'
            breakdown_pct = (latest['n_day_low'] - latest['close']) / latest['n_day_low']
            vol_ratio = latest['volume'] / (vol_avg.iloc[-1] if not pd.isna(vol_avg.iloc[-1]) else 1)
            confidence = min(0.5 + (breakdown_pct * 5) + (vol_ratio - 1) * 0.1, 1.0)

        if action != 'hold':
            indicators = {
                'Close': latest['close'],
                'N_Day_High': latest['n_day_high'],
                'N_Day_Low': latest['n_day_low'],
                'ATR': latest['atr'],
                'ATR_Avg': latest['atr_avg'],
                'Volume_Spike': latest['volume_spike'],
            }
            reasons = [f"{k}: {v:.3f}" if isinstance(v, float) else f"{k}: {v}"
                       for k, v in indicators.items()]
            reason = f"{action.upper()} - {', '.join(reasons)}"

            signals.append(Signal(
                symbol=sym,
                action=action,
                confidence=confidence,
                price=float(latest['close']),
                reason=reason,
                timestamp=latest.name if hasattr(latest.name, 'timestamp') else pd.Timestamp.now()
            ))

        return signals
