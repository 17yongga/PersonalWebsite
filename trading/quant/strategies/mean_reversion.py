"""Mean Reversion Strategy."""

import pandas as pd
import numpy as np
from typing import Dict, List, Any
from .base import Strategy, Signal
from utils.indicators import calculate_bollinger_bands, calculate_sma

class MeanReversionStrategy(Strategy):
    """
    Mean reversion strategy using Bollinger Bands and Z-score.
    
    Entry conditions:
    - BUY when price < lower Bollinger Band AND z-score < -2
    - SELL when price > upper Bollinger Band AND z-score > 2
    
    Exit conditions:
    - Exit when price returns to middle Bollinger Band (SMA)
    """
    
    name = "Mean Reversion Strategy"
    description = "Mean reversion using Bollinger Bands and Z-score"
    
    def __init__(self, config: Dict[str, Any] = None):
        default_config = {
            'bb_period': 20,        # Bollinger Bands period
            'bb_std': 1.8,          # BB std dev — 1.8σ gives more signals than 2σ while staying meaningful
            # NOTE: z-score and Bollinger Bands are mathematically equivalent (both measure
            # standard deviations from a rolling mean). Requiring both is redundant.
            # Replaced z-score with RSI — genuinely independent momentum confirmation.
            'rsi_period': 14,
            'rsi_oversold': 35,     # RSI < 35 = oversold for buy (pairs with BB lower band)
            'rsi_overbought': 65,   # RSI > 65 = overbought for sell (pairs with BB upper band)
            'min_volume': 100000,   # Minimum daily volume
            'volatility_filter': False,  # Off by default — see note below
            # NOTE: min_volatility of 0.02 means 2% ANNUALIZED which is near-zero for any
            # real stock. Was effectively never filtering anything. Set a sensible default
            # if you want to use it: 0.15 = 15% annualized vol (equivalent to ~1% daily).
            'min_volatility': 0.15
        }
        
        if config:
            default_config.update(config)
        
        super().__init__(default_config)
    
    def validate_config(self, config: Dict[str, Any]) -> bool:
        """Validate configuration parameters."""
        required_keys = [
            'bb_period', 'bb_std', 'rsi_period',
            'rsi_oversold', 'rsi_overbought'
        ]
        
        for key in required_keys:
            if key not in config:
                raise ValueError(f"Missing required parameter: {key}")
        
        if config['rsi_oversold'] >= config['rsi_overbought']:
            raise ValueError("RSI oversold must be less than overbought")

        if config['bb_std'] <= 0:
            raise ValueError("Bollinger Bands standard deviation must be positive")
        
        return True
    
    def get_parameters(self) -> Dict[str, Any]:
        """Get strategy parameters and their descriptions."""
        return {
            'bb_period': 'Bollinger Bands calculation period (default: 20)',
            'bb_std': 'Bollinger Bands standard deviation multiplier (default: 2.0)',
            'zscore_period': 'Z-score calculation period (default: 20)',
            'zscore_buy_threshold': 'Z-score threshold for buy signals (default: -2.0)',
            'zscore_sell_threshold': 'Z-score threshold for sell signals (default: 2.0)',
            'min_volume': 'Minimum daily volume filter (default: 100,000)',
            'volatility_filter': 'Enable volatility filtering (default: True)',
            'min_volatility': 'Minimum daily volatility required (default: 0.02)'
        }
    
    def generate_signals(self, data: pd.DataFrame, symbol: str = None) -> List[Signal]:
        """Generate mean reversion trading signals."""
        signals = []
        
        # Need enough data for indicators
        min_periods = max(self.config['bb_period'], self.config['rsi_period'])
        
        if len(data) < min_periods + 10:  # Add buffer
            return signals
        
        # Calculate indicators
        data = data.copy()
        
        # Bollinger Bands
        bb_data = calculate_bollinger_bands(
            data['close'], 
            period=self.config['bb_period'],
            std_dev=self.config['bb_std']
        )
        data['bb_upper'] = bb_data['upper']
        data['bb_middle'] = bb_data['middle']
        data['bb_lower'] = bb_data['lower']

        # RSI — independent second confirmation (replaces redundant z-score)
        from utils.indicators import calculate_rsi
        data['rsi'] = calculate_rsi(data['close'], period=self.config['rsi_period'])

        # Price position within Bollinger Bands
        bb_range = data['bb_upper'] - data['bb_lower']
        bb_range = bb_range.replace(0, np.nan)
        data['bb_position'] = (data['close'] - data['bb_lower']) / bb_range

        # Volatility (for filtering) — annualized, 15% = ~1% daily vol (sensible threshold)
        if self.config.get('volatility_filter', False):
            data['volatility'] = data['close'].pct_change().rolling(5).std() * np.sqrt(252)
        
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
        
        # Apply filters
        if not self._passes_filters(latest):
            return signals
        
        # Determine signal
        signal = self._evaluate_mean_reversion_signal(symbol_name, latest, data)
        
        if signal:
            signals.append(signal)
        
        return signals
    
    def _calculate_zscore(self, prices: pd.Series, period: int) -> pd.Series:
        """Calculate rolling Z-score of prices."""
        rolling_mean = prices.rolling(window=period).mean()
        rolling_std = prices.rolling(window=period).std()
        
        # Avoid division by zero
        rolling_std = rolling_std.replace(0, np.nan)
        
        zscore = (prices - rolling_mean) / rolling_std
        return zscore
    
    def _passes_filters(self, row: pd.Series) -> bool:
        """Check if the data passes all filters."""
        # Volume filter
        if row['volume'] < self.config.get('min_volume', 0):
            return False

        # Volatility filter (annualized, 15% threshold is ~1% daily vol)
        if self.config.get('volatility_filter', False):
            if row.get('volatility', 1.0) < self.config.get('min_volatility', 0):
                return False

        # Data quality checks
        if pd.isna(row['rsi']) or pd.isna(row['bb_position']):
            return False

        return True
    
    def _evaluate_mean_reversion_signal(
        self, 
        symbol: str, 
        latest: pd.Series, 
        history: pd.DataFrame
    ) -> Signal:
        """Evaluate mean reversion conditions and generate signal if appropriate."""
        
        price = float(latest['close'])
        bb_position = latest['bb_position']
        rsi = latest['rsi']

        # Mean reversion conditions — BB + RSI (independent confirmation)
        # Price below lower BB (1.8σ) AND RSI < 35 = genuinely oversold
        oversold_condition = (
            price < latest['bb_lower'] and
            rsi < self.config['rsi_oversold']
        )

        # Price above upper BB AND RSI > 65 = genuinely overbought
        overbought_condition = (
            price > latest['bb_upper'] and
            rsi > self.config['rsi_overbought']
        )

        action = 'hold'
        confidence = 0.0

        if oversold_condition:
            action = 'buy'
            rsi_strength = (self.config['rsi_oversold'] - rsi) / self.config['rsi_oversold']
            bb_strength = max(1.0 - bb_position, 0)
            confidence = min(0.4 + (rsi_strength + bb_strength) / 2, 1.0)

        elif overbought_condition:
            action = 'sell'
            rsi_strength = (rsi - self.config['rsi_overbought']) / (100 - self.config['rsi_overbought'])
            bb_strength = max(bb_position - 1.0, 0)
            confidence = min(0.4 + (rsi_strength + bb_strength) / 2, 1.0)
        
        if action != 'hold':
            reason = self._build_signal_reason(latest, action)
            
            return Signal(
                symbol=symbol,
                action=action,
                confidence=confidence,
                price=price,
                reason=reason,
                timestamp=latest.name if hasattr(latest.name, 'timestamp') else pd.Timestamp.now()
            )
        
        return None
    
    def _build_signal_reason(self, row: pd.Series, action: str) -> str:
        """Build human-readable reason for the signal."""
        indicators = {
            'Price': row['close'],
            'BB_Upper': row['bb_upper'],
            'BB_Lower': row['bb_lower'],
            'RSI': row['rsi'],
            'BB_Position': row['bb_position']
        }

        return self._format_signal_reason(indicators, action)