"""Value + Dividends Strategy."""

import pandas as pd
import numpy as np
from typing import Dict, List, Any
from .base import Strategy, Signal
from utils.indicators import calculate_rsi, calculate_sma, calculate_bollinger_bands

class ValueDividendStrategy(Strategy):
    """
    Value + dividend strategy focusing on high-quality dividend stocks.
    
    The strategy focuses on:
    1. Quality dividend-paying stocks (JNJ, KO, PG, WMT, etc.)
    2. Value entry points (low RSI, oversold conditions)
    3. Low volatility for stable returns
    4. Mean reversion opportunities
    
    Universe: JNJ, KO, PG, WMT, XOM, VZ, T, JPM, BAC, HD
    """
    
    name = "Value Dividend Strategy"
    description = "Value investing in high-quality dividend stocks with mean reversion timing"
    
    def __init__(self, config: Dict[str, Any] = None):
        default_config = {
            'universe': ['JNJ', 'KO', 'PG', 'WMT', 'XOM', 'VZ', 'T', 'JPM', 'BAC', 'HD'],
            'min_dividend_yield': 0.02,  # 2% minimum dividend yield
            'max_pe_ratio': 20,  # Maximum P/E ratio for value
            'min_market_cap': 50000000000,  # $50B minimum market cap
            'rsi_oversold': 35,  # Higher than growth stocks
            'rsi_overbought': 65,  # Lower than growth stocks
            'volatility_threshold': 0.02,  # 2% daily volatility threshold
            'bollinger_period': 20,
            'bollinger_std': 2.0,
            'sma_period': 50,
            'position_size': 0.12,  # 12% per position for diversification
            'max_positions': 8,
            'quality_score_min': 0.6,  # Minimum quality score
            'dividend_growth_min': 0.0,  # Minimum dividend growth rate
            'min_volume': 500000,  # Lower than growth stocks
            'stop_loss': -0.20,  # 20% stop loss (wider for value)
            'take_profit': 0.30   # 30% take profit
        }
        
        if config:
            default_config.update(config)
        
        super().__init__(default_config)
    
    def validate_config(self, config: Dict[str, Any]) -> bool:
        """Validate configuration parameters."""
        required_keys = [
            'universe', 'rsi_oversold', 'rsi_overbought', 
            'position_size', 'max_positions'
        ]
        
        for key in required_keys:
            if key not in config:
                raise ValueError(f"Missing required parameter: {key}")
        
        if not isinstance(config['universe'], list) or len(config['universe']) == 0:
            raise ValueError("Universe must be a non-empty list of symbols")
        
        if config['rsi_oversold'] >= config['rsi_overbought']:
            raise ValueError("RSI oversold level must be less than overbought level")
        
        if not 0 < config['position_size'] <= 1:
            raise ValueError("Position size must be between 0 and 1")
        
        return True
    
    def get_parameters(self) -> Dict[str, Any]:
        """Get strategy parameters and their descriptions."""
        return {
            'universe': 'List of quality dividend stocks to trade',
            'min_dividend_yield': 'Minimum dividend yield requirement (default: 0.02)',
            'max_pe_ratio': 'Maximum P/E ratio for value screening (default: 20)',
            'min_market_cap': 'Minimum market cap requirement (default: $50B)',
            'rsi_oversold': 'RSI oversold level for entry (default: 35)',
            'rsi_overbought': 'RSI overbought level for exit (default: 65)',
            'volatility_threshold': 'Maximum daily volatility (default: 0.02)',
            'bollinger_period': 'Bollinger Bands period (default: 20)',
            'bollinger_std': 'Bollinger Bands standard deviation (default: 2.0)',
            'sma_period': 'Simple moving average period (default: 50)',
            'position_size': 'Position size as fraction of portfolio (default: 0.12)',
            'max_positions': 'Maximum concurrent positions (default: 8)',
            'quality_score_min': 'Minimum quality score requirement (default: 0.6)',
            'dividend_growth_min': 'Minimum dividend growth rate (default: 0.0)',
            'min_volume': 'Minimum daily volume filter (default: 500K)',
            'stop_loss': 'Stop loss threshold (default: -0.20)',
            'take_profit': 'Take profit threshold (default: 0.30)'
        }
    
    def generate_signals(self, data: pd.DataFrame, symbol: str = None) -> List[Signal]:
        """Generate value dividend signals."""
        signals = []
        
        if len(data) < max(self.config['bollinger_period'], self.config['sma_period']) + 20:
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
        data['rsi'] = calculate_rsi(data['close'], 14)
        data['sma'] = calculate_sma(data['close'], self.config['sma_period'])
        
        bb_data = calculate_bollinger_bands(
            data['close'],
            period=self.config['bollinger_period'],
            std_dev=self.config['bollinger_std']
        )
        data['bb_upper'] = bb_data['upper']
        data['bb_middle'] = bb_data['middle']
        data['bb_lower'] = bb_data['lower']
        
        # Calculate volatility (rolling standard deviation)
        data['volatility'] = data['close'].pct_change().rolling(20).std()
        
        # Calculate quality score (simplified - in real implementation would use fundamental data)
        data['quality_score'] = self._calculate_quality_score(data)
        
        latest = data.iloc[-1]
        
        # Volume filter
        if latest['volume'] < self.config.get('min_volume', 0):
            return signals
        
        # Volatility filter (prefer low volatility for value stocks)
        if latest['volatility'] > self.config['volatility_threshold']:
            return signals
        
        # Quality filter
        if latest['quality_score'] < self.config['quality_score_min']:
            return signals
        
        # Generate signals based on value and mean reversion
        action = 'hold'
        confidence = 0.0
        
        # BUY conditions: Oversold RSI + below Bollinger lower band + above long-term SMA
        if (latest['rsi'] < self.config['rsi_oversold'] and
            latest['close'] < latest['bb_lower'] and
            latest['close'] > latest['sma']):  # Still in long-term uptrend
            
            action = 'buy'
            # Higher confidence when more oversold
            oversold_intensity = (self.config['rsi_oversold'] - latest['rsi']) / self.config['rsi_oversold']
            confidence = min(0.9, 0.6 + oversold_intensity)
        
        # SELL conditions: Overbought RSI + above Bollinger upper band OR broke long-term support
        elif (latest['rsi'] > self.config['rsi_overbought'] and
              latest['close'] > latest['bb_upper']) or latest['close'] < latest['sma']:
            
            action = 'sell'
            if latest['close'] < latest['sma']:
                # Strong sell if broke support
                confidence = 0.8
            else:
                # Moderate sell if just overbought
                overbought_intensity = (latest['rsi'] - self.config['rsi_overbought']) / (100 - self.config['rsi_overbought'])
                confidence = min(0.7, 0.5 + overbought_intensity)
        
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
    
    def _calculate_quality_score(self, data: pd.DataFrame) -> pd.Series:
        """
        Calculate a simplified quality score based on price action.
        In a real implementation, this would use fundamental data like:
        - Dividend yield and growth
        - P/E ratio, P/B ratio
        - Debt-to-equity ratio
        - Return on equity
        - Earnings consistency
        """
        # Simplified quality score based on price stability and trend
        returns = data['close'].pct_change()
        
        # Score components:
        # 1. Low volatility (stability)
        volatility_score = 1 - np.minimum(returns.rolling(60).std() * np.sqrt(252), 0.5) / 0.5
        
        # 2. Positive long-term trend
        long_term_return = (data['close'] / data['close'].shift(252)).fillna(1) - 1
        trend_score = np.minimum(np.maximum(long_term_return, -0.2), 0.2) / 0.2 * 0.5 + 0.5
        
        # 3. Consistent performance (low drawdowns)
        rolling_max = data['close'].rolling(252).max()
        drawdown = (data['close'] - rolling_max) / rolling_max
        consistency_score = 1 + np.maximum(drawdown, -0.3) / 0.3
        
        # Composite score
        quality_score = (volatility_score * 0.4 + trend_score * 0.3 + consistency_score * 0.3)
        
        return quality_score.fillna(0.6)  # Default score for insufficient data
    
    def rank_value_stocks(self, market_data: Dict[str, pd.DataFrame]) -> List[tuple]:
        """
        Rank value stocks by attractiveness.
        
        Args:
            market_data: Dictionary mapping symbol -> OHLCV DataFrame
            
        Returns:
            List of (symbol, value_score) tuples sorted by score
        """
        rankings = []
        
        for symbol, data in market_data.items():
            if symbol not in self.config['universe']:
                continue
            
            if len(data) < 60:
                continue
            
            latest = data.iloc[-1]
            
            # Calculate attractiveness score
            rsi = calculate_rsi(data['close'], 14).iloc[-1]
            quality_score = self._calculate_quality_score(data).iloc[-1]
            
            # RSI score (prefer oversold)
            rsi_score = (100 - rsi) / 100
            
            # Price relative to moving average (prefer discount)
            sma_50 = calculate_sma(data['close'], 50).iloc[-1]
            price_discount = max(0, (sma_50 - latest['close']) / sma_50)
            
            # Volatility score (prefer low volatility)
            volatility = data['close'].pct_change().rolling(20).std().iloc[-1]
            vol_score = max(0, 1 - volatility / self.config['volatility_threshold'])
            
            # Composite value score
            value_score = (rsi_score * 0.3 + quality_score * 0.4 + 
                          price_discount * 0.2 + vol_score * 0.1)
            
            rankings.append((symbol, value_score))
        
        # Sort by score (highest first)
        rankings.sort(key=lambda x: x[1], reverse=True)
        return rankings
    
    def _build_signal_reason(self, row: pd.Series, action: str) -> str:
        """Build human-readable reason for the signal."""
        bb_position = "Lower" if row['close'] < row['bb_lower'] else (
            "Upper" if row['close'] > row['bb_upper'] else "Middle"
        )
        
        trend = "Up" if row['close'] > row['sma'] else "Down"
        
        indicators = {
            'RSI': row['rsi'],
            'BB_Position': bb_position,
            'Trend_vs_SMA': trend,
            'Quality_Score': row['quality_score'],
            'Volatility': row['volatility']
        }
        
        reasons = []
        for indicator, value in indicators.items():
            if isinstance(value, (int, float)):
                reasons.append(f"{indicator}: {value:.3f}")
            else:
                reasons.append(f"{indicator}: {value}")
        
        return f"{action.upper()} - {', '.join(reasons)}"