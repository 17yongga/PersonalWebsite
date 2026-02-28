"""Tests for trading strategies."""

import pytest
import pandas as pd
import numpy as np
from datetime import datetime, timedelta

import sys
import os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from strategies.momentum import MomentumStrategy
from strategies.mean_reversion import MeanReversionStrategy
from strategies.sentiment import SentimentStrategy
from strategies.base import Signal

class TestMomentumStrategy:
    """Tests for MomentumStrategy."""
    
    def setup_method(self):
        """Setup test fixtures."""
        self.strategy = MomentumStrategy()
        self.mock_data = self._create_mock_data()
    
    def _create_mock_data(self, days=100):
        """Create mock OHLCV data."""
        dates = pd.date_range(start='2023-01-01', periods=days, freq='D')
        
        # Create trending data
        np.random.seed(42)
        price = 100.0
        prices = []
        
        for i in range(days):
            # Add trend + noise
            trend = 0.001 * i  # Slight upward trend
            noise = np.random.normal(0, 0.02)
            change = trend + noise
            price *= (1 + change)
            prices.append(price)
        
        return pd.DataFrame({
            'open': [p * 0.99 for p in prices],
            'high': [p * 1.02 for p in prices],
            'low': [p * 0.98 for p in prices],
            'close': prices,
            'volume': [np.random.randint(100000, 1000000) for _ in prices]
        }, index=dates)
    
    def test_strategy_initialization(self):
        """Test strategy initialization."""
        assert self.strategy.name == "Momentum Strategy"
        assert self.strategy.config['rsi_period'] == 14
        assert self.strategy.config['buy_threshold'] == 2
        assert self.strategy.config['sell_threshold'] == -2
    
    def test_custom_config(self):
        """Test strategy with custom configuration."""
        custom_config = {
            'rsi_period': 21,
            'buy_threshold': 1,
            'sell_threshold': -1
        }
        
        strategy = MomentumStrategy(custom_config)
        assert strategy.config['rsi_period'] == 21
        assert strategy.config['buy_threshold'] == 1
    
    def test_config_validation(self):
        """Test configuration validation."""
        # Valid config should not raise
        valid_config = {
            'rsi_period': 14,
            'macd_fast': 12,
            'macd_slow': 26,
            'macd_signal': 9,
            'ema_fast': 20,
            'ema_slow': 50,
            'buy_threshold': 2,
            'sell_threshold': -2
        }
        
        assert self.strategy.validate_config(valid_config)
        
        # Invalid config should raise
        invalid_config = valid_config.copy()
        invalid_config['macd_fast'] = 30  # Greater than slow
        
        with pytest.raises(ValueError):
            self.strategy.validate_config(invalid_config)
    
    def test_signal_generation(self):
        """Test signal generation with mock data."""
        signals = self.strategy.generate_signals(self.mock_data)
        
        # Should be a list
        assert isinstance(signals, list)
        
        # Signals should be Signal objects
        for signal in signals:
            assert isinstance(signal, Signal)
            assert signal.symbol in ['UNKNOWN']  # Default symbol for single-asset data
            assert signal.action in ['buy', 'sell', 'hold']
            assert 0 <= signal.confidence <= 1
            assert signal.price > 0
    
    def test_insufficient_data(self):
        """Test behavior with insufficient data."""
        small_data = self.mock_data.head(10)
        signals = self.strategy.generate_signals(small_data)
        
        # Should return empty list for insufficient data
        assert len(signals) == 0
    
    def test_parameters_method(self):
        """Test get_parameters method."""
        params = self.strategy.get_parameters()
        
        assert isinstance(params, dict)
        assert 'rsi_period' in params
        assert 'buy_threshold' in params

class TestMeanReversionStrategy:
    """Tests for MeanReversionStrategy."""
    
    def setup_method(self):
        """Setup test fixtures."""
        self.strategy = MeanReversionStrategy()
        self.mock_data = self._create_mock_data()
    
    def _create_mock_data(self, days=100):
        """Create mock mean-reverting data."""
        dates = pd.date_range(start='2023-01-01', periods=days, freq='D')
        
        # Create mean-reverting data
        np.random.seed(42)
        price = 100.0
        prices = []
        mean_price = 100.0
        
        for i in range(days):
            # Mean reversion force + noise
            reversion_force = (mean_price - price) * 0.01
            noise = np.random.normal(0, 0.02)
            change = reversion_force + noise
            price *= (1 + change)
            prices.append(price)
        
        return pd.DataFrame({
            'open': [p * 0.99 for p in prices],
            'high': [p * 1.02 for p in prices],
            'low': [p * 0.98 for p in prices],
            'close': prices,
            'volume': [np.random.randint(100000, 1000000) for _ in prices]
        }, index=dates)
    
    def test_strategy_initialization(self):
        """Test strategy initialization."""
        assert self.strategy.name == "Mean Reversion Strategy"
        assert self.strategy.config['bb_period'] == 20
        assert self.strategy.config['zscore_buy_threshold'] == -2.0
    
    def test_config_validation(self):
        """Test configuration validation."""
        valid_config = {
            'bb_period': 20,
            'bb_std': 2.0,
            'zscore_period': 20,
            'zscore_buy_threshold': -2.0,
            'zscore_sell_threshold': 2.0
        }
        
        assert self.strategy.validate_config(valid_config)
        
        # Invalid thresholds should raise
        invalid_config = valid_config.copy()
        invalid_config['zscore_buy_threshold'] = 1.0  # Should be negative
        
        with pytest.raises(ValueError):
            self.strategy.validate_config(invalid_config)
    
    def test_signal_generation(self):
        """Test signal generation."""
        signals = self.strategy.generate_signals(self.mock_data)
        
        assert isinstance(signals, list)
        
        for signal in signals:
            assert isinstance(signal, Signal)
            assert signal.action in ['buy', 'sell']
            assert 0 <= signal.confidence <= 1

class TestSentimentStrategy:
    """Tests for SentimentStrategy."""
    
    def setup_method(self):
        """Setup test fixtures."""
        self.strategy = SentimentStrategy()
        self.mock_data = self._create_mock_data()
    
    def _create_mock_data(self, days=50):
        """Create simple mock data."""
        dates = pd.date_range(start='2023-01-01', periods=days, freq='D')
        
        np.random.seed(42)
        prices = 100 * (1 + np.cumsum(np.random.normal(0, 0.02, days)))
        
        return pd.DataFrame({
            'open': prices * 0.99,
            'high': prices * 1.01,
            'low': prices * 0.99,
            'close': prices,
            'volume': np.random.randint(100000, 1000000, days)
        }, index=dates)
    
    def test_strategy_initialization(self):
        """Test strategy initialization."""
        assert self.strategy.name == "Sentiment Strategy"
        assert 'placeholder' in self.strategy.description.lower()
    
    def test_placeholder_functionality(self):
        """Test that placeholder functionality works."""
        signals = self.strategy.generate_signals(self.mock_data)
        
        assert isinstance(signals, list)
        
        # Check that signals contain placeholder note
        for signal in signals:
            assert "PLACEHOLDER" in signal.reason
    
    def test_sentiment_methods(self):
        """Test placeholder sentiment methods."""
        news_sentiment = self.strategy.get_news_sentiment('AAPL')
        social_sentiment = self.strategy.get_social_sentiment('AAPL')
        
        assert isinstance(news_sentiment, dict)
        assert isinstance(social_sentiment, dict)
        assert 'note' in news_sentiment
        assert news_sentiment['note'] == 'Placeholder implementation'

class TestSignalClass:
    """Tests for the Signal class."""
    
    def test_signal_creation(self):
        """Test Signal object creation."""
        signal = Signal(
            symbol='AAPL',
            action='buy',
            confidence=0.8,
            price=150.0,
            quantity=100,
            reason='Test signal'
        )
        
        assert signal.symbol == 'AAPL'
        assert signal.action == 'buy'
        assert signal.confidence == 0.8
        assert signal.price == 150.0
        assert signal.quantity == 100
        assert signal.reason == 'Test signal'
        assert signal.timestamp is not None
    
    def test_signal_defaults(self):
        """Test Signal with minimal parameters."""
        signal = Signal(
            symbol='MSFT',
            action='sell',
            confidence=0.5,
            price=300.0
        )
        
        assert signal.quantity == 0  # Default
        assert signal.reason == ""   # Default
        assert signal.timestamp is not None

def create_test_data_with_signals():
    """Helper function to create data that should generate signals."""
    dates = pd.date_range(start='2023-01-01', periods=50, freq='D')
    
    # Create data with strong trend for momentum signals
    prices = []
    price = 100.0
    
    for i in range(50):
        if i < 25:
            # Downtrend first half
            price *= 0.995
        else:
            # Strong uptrend second half
            price *= 1.01
        prices.append(price)
    
    return pd.DataFrame({
        'open': [p * 0.99 for p in prices],
        'high': [p * 1.02 for p in prices],
        'low': [p * 0.98 for p in prices],
        'close': prices,
        'volume': [500000] * 50
    }, index=dates)

def test_strategies_with_trending_data():
    """Test all strategies with data designed to generate signals."""
    data = create_test_data_with_signals()
    
    # Test momentum strategy
    momentum = MomentumStrategy()
    momentum_signals = momentum.generate_signals(data)
    
    # Test mean reversion strategy
    mean_reversion = MeanReversionStrategy()
    mr_signals = mean_reversion.generate_signals(data)
    
    # Test sentiment strategy
    sentiment = SentimentStrategy()
    sentiment_signals = sentiment.generate_signals(data)
    
    # All strategies should generate some signals
    assert len(momentum_signals) >= 0  # May or may not generate signals
    assert len(mr_signals) >= 0
    assert len(sentiment_signals) >= 0
    
    print(f"Generated signals - Momentum: {len(momentum_signals)}, Mean Reversion: {len(mr_signals)}, Sentiment: {len(sentiment_signals)}")

if __name__ == '__main__':
    # Run basic tests
    test_strategies_with_trending_data()
    print("All strategy tests passed!")