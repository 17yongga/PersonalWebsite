"""Sector Rotation Strategy."""

import pandas as pd
import numpy as np
from typing import Dict, List, Any
from .base import Strategy, Signal
from utils.indicators import calculate_momentum, calculate_sma, calculate_rsi

class SectorRotationStrategy(Strategy):
    """
    Sector rotation strategy focusing on sector ETFs based on relative momentum.
    
    The strategy rotates between sector ETFs based on:
    1. Relative momentum (price performance vs benchmark)
    2. Absolute momentum (trend strength)
    3. Mean reversion opportunities
    
    Universe: XLK, XLF, XLE, XLV, XLY, XLP, XLI, XLU, XLRE
    """
    
    name = "Sector Rotation Strategy"
    description = "Sector rotation based on relative momentum and trend strength"
    
    def __init__(self, config: Dict[str, Any] = None):
        default_config = {
            'universe': ['XLK', 'XLF', 'XLE', 'XLV', 'XLY', 'XLP', 'XLI', 'XLU', 'XLRE'],
            'benchmark': 'SPY',  # Benchmark for relative momentum
            'lookback_period': 60,  # Days to calculate momentum
            'momentum_threshold': 0.05,  # 5% minimum outperformance
            'max_positions': 3,  # Maximum concurrent positions
            'rebalance_threshold': 0.1,  # 10% performance difference triggers rebalance
            'rsi_oversold': 30,
            'rsi_overbought': 70,
            'min_volume': 1000000,  # Minimum daily volume
            'position_size': 0.33,  # Equal weight positions
            'stop_loss': -0.15,  # 15% stop loss
            'take_profit': 0.25   # 25% take profit
        }
        
        if config:
            default_config.update(config)
        
        super().__init__(default_config)
    
    def validate_config(self, config: Dict[str, Any]) -> bool:
        """Validate configuration parameters."""
        required_keys = [
            'universe', 'lookback_period', 'momentum_threshold', 
            'max_positions', 'position_size'
        ]
        
        for key in required_keys:
            if key not in config:
                raise ValueError(f"Missing required parameter: {key}")
        
        if not isinstance(config['universe'], list) or len(config['universe']) == 0:
            raise ValueError("Universe must be a non-empty list of symbols")
        
        if config['max_positions'] > len(config['universe']):
            raise ValueError("Max positions cannot exceed universe size")
        
        if not 0 < config['position_size'] <= 1:
            raise ValueError("Position size must be between 0 and 1")
        
        return True
    
    def get_parameters(self) -> Dict[str, Any]:
        """Get strategy parameters and their descriptions."""
        return {
            'universe': 'List of sector ETFs to trade (default: major sector ETFs)',
            'benchmark': 'Benchmark for relative momentum calculation (default: SPY)',
            'lookback_period': 'Period for momentum calculation in days (default: 60)',
            'momentum_threshold': 'Minimum outperformance vs benchmark (default: 0.05)',
            'max_positions': 'Maximum concurrent positions (default: 3)',
            'rebalance_threshold': 'Performance difference triggering rebalance (default: 0.1)',
            'rsi_oversold': 'RSI oversold level for entry timing (default: 30)',
            'rsi_overbought': 'RSI overbought level for exit timing (default: 70)',
            'min_volume': 'Minimum daily volume filter (default: 1M)',
            'position_size': 'Position size as fraction of portfolio (default: 0.33)',
            'stop_loss': 'Stop loss threshold (default: -0.15)',
            'take_profit': 'Take profit threshold (default: 0.25)'
        }
    
    def generate_signals(self, data: pd.DataFrame, symbol: str = None) -> List[Signal]:
        """Generate sector rotation signals."""
        signals = []
        
        if len(data) < self.config['lookback_period'] + 20:
            return signals
        
        # Use provided symbol or try to determine it from data
        if symbol:
            symbol_name = symbol
        elif 'symbol' in data.columns:
            symbol_name = data['symbol'].iloc[0]
        else:
            symbol_name = 'UNKNOWN'
        
        # Only trade symbols in our universe
        if symbol_name not in self.config['universe']:
            return signals
        
        data = data.copy()
        
        # Calculate indicators
        data['momentum'] = calculate_momentum(
            data['close'], 
            period=self.config['lookback_period']
        )
        data['sma_20'] = calculate_sma(data['close'], 20)
        data['sma_50'] = calculate_sma(data['close'], 50)
        data['rsi'] = calculate_rsi(data['close'], 14)
        
        # Calculate relative strength (vs benchmark - would need benchmark data in real implementation)
        # For now, use absolute momentum as proxy
        data['relative_strength'] = data['momentum']
        
        latest = data.iloc[-1]
        
        # Volume filter
        if latest['volume'] < self.config.get('min_volume', 0):
            return signals
        
        # Generate signals based on momentum and trend
        action = 'hold'
        confidence = 0.0
        
        # BUY conditions: Strong momentum + trend + oversold RSI
        if (latest['momentum'] > self.config['momentum_threshold'] and
            latest['close'] > latest['sma_20'] > latest['sma_50'] and
            latest['rsi'] < 70):  # Not overbought
            
            action = 'buy'
            confidence = min(0.9, abs(latest['momentum']) * 2)
        
        # SELL conditions: Weak momentum + trend break + overbought RSI
        elif (latest['momentum'] < -self.config['momentum_threshold'] or
              (latest['close'] < latest['sma_20'] and latest['rsi'] > self.config['rsi_overbought'])):
            
            action = 'sell'
            confidence = min(0.8, abs(latest['momentum']) * 2)
        
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
    
    def rank_sectors(self, market_data: Dict[str, pd.DataFrame]) -> List[tuple]:
        """
        Rank sectors by relative momentum strength.
        
        Args:
            market_data: Dictionary mapping symbol -> OHLCV DataFrame
            
        Returns:
            List of (symbol, momentum_score) tuples sorted by score
        """
        rankings = []
        
        for symbol, data in market_data.items():
            if symbol not in self.config['universe']:
                continue
            
            if len(data) < self.config['lookback_period'] + 10:
                continue
            
            # Calculate momentum score
            momentum = calculate_momentum(
                data['close'], 
                period=self.config['lookback_period']
            ).iloc[-1]
            
            # Add trend confirmation
            sma_20 = calculate_sma(data['close'], 20).iloc[-1]
            sma_50 = calculate_sma(data['close'], 50).iloc[-1]
            trend_score = 1 if sma_20 > sma_50 else -1
            
            # Calculate RSI for timing
            rsi = calculate_rsi(data['close'], 14).iloc[-1]
            rsi_score = 0.5 if 30 < rsi < 70 else (0.2 if rsi > 70 else 0.8)
            
            # Composite score
            composite_score = momentum * trend_score * rsi_score
            rankings.append((symbol, composite_score))
        
        # Sort by score (highest first)
        rankings.sort(key=lambda x: x[1], reverse=True)
        return rankings
    
    def _build_signal_reason(self, row: pd.Series, action: str) -> str:
        """Build human-readable reason for the signal."""
        indicators = {
            'Momentum': row['momentum'],
            'RSI': row['rsi'],
            'SMA_Trend': 'Up' if row['close'] > row['sma_20'] > row['sma_50'] else 'Down',
            'Relative_Strength': row['relative_strength']
        }
        
        reasons = []
        for indicator, value in indicators.items():
            if isinstance(value, (int, float)):
                reasons.append(f"{indicator}: {value:.3f}")
            else:
                reasons.append(f"{indicator}: {value}")
        
        return f"{action.upper()} - {', '.join(reasons)}"