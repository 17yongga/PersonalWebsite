"""Momentum/Trend Following Strategy."""

import pandas as pd
import numpy as np
from typing import Dict, List, Any
from .base import Strategy, Signal
from utils.indicators import calculate_rsi, calculate_macd, calculate_ema

class MomentumStrategy(Strategy):
    """
    Momentum strategy using RSI, MACD, and EMA crossover.
    
    Scoring system where each indicator contributes to a composite score:
    - RSI: +1 if > 70 (overbought/momentum), -1 if < 30 (oversold)
    - MACD: +1 if MACD > signal line, -1 if MACD < signal line
    - EMA: +1 if EMA20 > EMA50, -1 if EMA20 < EMA50
    
    BUY when composite score > buy_threshold
    SELL when composite score < sell_threshold
    """
    
    name = "Momentum Strategy"
    description = "Trend following using RSI, MACD, and EMA crossover"
    
    def __init__(self, config: Dict[str, Any] = None):
        default_config = {
            'rsi_period': 14,
            'macd_fast': 12,
            'macd_slow': 26,
            'macd_signal': 9,
            'ema_fast': 20,
            'ema_slow': 50,
            'buy_threshold': 1,    # Any 1+ positive indicators (was 2 — too conservative)
            'sell_threshold': -1,  # Any 1+ negative indicators
            # NOTE: For momentum, RSI > 55 means price has upward momentum (NOT overbought).
            # RSI > 70 as a buy threshold is a common mistake — that's overbought territory.
            # We use 55/45 as the momentum confirmation band.
            'rsi_overbought': 55,  # RSI > 55 = upward momentum (was 70 = overbought, wrong)
            'rsi_oversold': 45,    # RSI < 45 = weakening momentum (was 30 = deeply oversold)
            'min_volume': 100000   # Minimum daily volume
        }
        
        if config:
            default_config.update(config)
        
        super().__init__(default_config)
    
    def validate_config(self, config: Dict[str, Any]) -> bool:
        """Validate configuration parameters."""
        required_keys = [
            'rsi_period', 'macd_fast', 'macd_slow', 'macd_signal',
            'ema_fast', 'ema_slow', 'buy_threshold', 'sell_threshold'
        ]
        
        for key in required_keys:
            if key not in config:
                raise ValueError(f"Missing required parameter: {key}")
        
        if config['macd_fast'] >= config['macd_slow']:
            raise ValueError("MACD fast period must be less than slow period")
        
        if config['ema_fast'] >= config['ema_slow']:
            raise ValueError("EMA fast period must be less than slow period")
        
        if config['buy_threshold'] <= config['sell_threshold']:
            raise ValueError("Buy threshold must be greater than sell threshold")
        
        return True
    
    def get_parameters(self) -> Dict[str, Any]:
        """Get strategy parameters and their descriptions."""
        return {
            'rsi_period': 'RSI calculation period (default: 14)',
            'macd_fast': 'MACD fast EMA period (default: 12)',
            'macd_slow': 'MACD slow EMA period (default: 26)',
            'macd_signal': 'MACD signal line period (default: 9)',
            'ema_fast': 'Fast EMA period (default: 20)',
            'ema_slow': 'Slow EMA period (default: 50)',
            'buy_threshold': 'Composite score threshold for buy signals (default: 2)',
            'sell_threshold': 'Composite score threshold for sell signals (default: -2)',
            'rsi_overbought': 'RSI overbought level (default: 70)',
            'rsi_oversold': 'RSI oversold level (default: 30)',
            'min_volume': 'Minimum daily volume filter (default: 100,000)'
        }
    
    def generate_signals(self, data: pd.DataFrame, symbol: str = None) -> List[Signal]:
        """Generate momentum-based trading signals."""
        signals = []
        
        # Need enough data for indicators
        min_periods = max(
            self.config['rsi_period'],
            self.config['macd_slow'] + self.config['macd_signal'],
            self.config['ema_slow']
        )
        
        if len(data) < min_periods + 10:  # Add buffer
            return signals
        
        # Calculate indicators
        data = data.copy()
        data['rsi'] = calculate_rsi(data['close'], period=self.config['rsi_period'])
        
        macd_data = calculate_macd(
            data['close'], 
            fast=self.config['macd_fast'],
            slow=self.config['macd_slow'],
            signal=self.config['macd_signal']
        )
        data['macd'] = macd_data['macd']
        data['macd_signal'] = macd_data['macd_signal']
        data['macd_histogram'] = macd_data['macd_histogram']
        
        data['ema_fast'] = calculate_ema(data['close'], period=self.config['ema_fast'])
        data['ema_slow'] = calculate_ema(data['close'], period=self.config['ema_slow'])
        
        # Calculate composite scores
        data['momentum_score'] = self._calculate_momentum_score(data)
        
        # Use provided symbol or try to determine it from data
        if symbol:
            symbol_name = symbol
        elif 'symbol' in data.columns:
            symbol_name = data['symbol'].iloc[0]
        else:
            symbol_name = 'UNKNOWN'
        
        if len(data) < 2:
            return signals
        
        latest = data.iloc[-1]
        previous = data.iloc[-2]
        
        # Volume filter
        if latest['volume'] < self.config.get('min_volume', 0):
            return signals
        
        # Generate signal based on momentum score
        current_score = latest['momentum_score']
        previous_score = previous['momentum_score']
        
        action = 'hold'
        confidence = abs(current_score) / 3.0  # Max score is 3
        
        if current_score >= self.config['buy_threshold'] and previous_score < self.config['buy_threshold']:
            action = 'buy'
        elif current_score <= self.config['sell_threshold'] and previous_score > self.config['sell_threshold']:
            action = 'sell'
        
        if action != 'hold':
            reason = self._build_signal_reason(latest, action)
            
            signal = Signal(
                symbol=symbol_name,
                action=action,
                confidence=confidence,
                price=float(latest['close']),
                reason=reason,
                timestamp=latest.name if hasattr(latest.name, 'timestamp') else pd.Timestamp.now()
            )
            
            signals.append(signal)
        
        return signals
    
    def _calculate_momentum_score(self, data: pd.DataFrame) -> pd.Series:
        """Calculate composite momentum score."""
        score = pd.Series(0.0, index=data.index)
        
        # RSI component
        rsi_score = np.where(
            data['rsi'] > self.config['rsi_overbought'], 1,
            np.where(data['rsi'] < self.config['rsi_oversold'], -1, 0)
        )
        score += rsi_score
        
        # MACD component
        macd_score = np.where(data['macd'] > data['macd_signal'], 1, -1)
        score += macd_score
        
        # EMA crossover component
        ema_score = np.where(data['ema_fast'] > data['ema_slow'], 1, -1)
        score += ema_score
        
        return score
    
    def _build_signal_reason(self, row: pd.Series, action: str) -> str:
        """Build human-readable reason for the signal."""
        indicators = {
            'RSI': row['rsi'],
            'MACD': row['macd'] - row['macd_signal'],  # MACD histogram
            'EMA_Ratio': row['ema_fast'] / row['ema_slow'],
            'Score': row['momentum_score']
        }
        
        return self._format_signal_reason(indicators, action)