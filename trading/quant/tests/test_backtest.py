"""Tests for backtesting engine."""

import pytest
import pandas as pd
import numpy as np
from datetime import datetime, timedelta

import sys
import os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from backtesting.engine import BacktestEngine, Trade, Position
from backtesting.metrics import calculate_performance_metrics
from strategies.momentum import MomentumStrategy
from strategies.base import Signal

class MockStrategy:
    """Simple mock strategy for testing."""
    
    def __init__(self):
        self.name = "Mock Strategy"
        self.description = "Simple test strategy"
    
    def get_name(self):
        return self.name
    
    def get_description(self):
        return self.description
    
    def get_config(self):
        return {'test': True}
    
    def generate_signals(self, data):
        """Generate simple buy signal on first day, sell on last day."""
        if len(data) < 2:
            return []
        
        signals = []
        
        # Buy signal on day 10 if we have enough data
        if len(data) >= 15:
            buy_price = data.iloc[10]['close']
            signals.append(Signal(
                symbol='TEST',
                action='buy',
                confidence=0.8,
                price=buy_price,
                quantity=100,
                reason='Mock buy signal'
            ))
        
        return signals

class TestBacktestEngine:
    """Tests for BacktestEngine."""
    
    def setup_method(self):
        """Setup test fixtures."""
        self.engine = BacktestEngine(initial_capital=10000)
        self.mock_data = self._create_mock_data()
        self.strategy = MockStrategy()
    
    def _create_mock_data(self):
        """Create mock market data for testing."""
        dates = pd.date_range(start='2023-01-01', periods=30, freq='D')
        
        # Create simple uptrending data
        base_price = 100.0
        prices = []
        
        for i in range(30):
            price = base_price + (i * 0.5)  # Linear trend up
            prices.append(price)
        
        data = {
            'TEST': pd.DataFrame({
                'open': [p * 0.99 for p in prices],
                'high': [p * 1.02 for p in prices],
                'low': [p * 0.98 for p in prices],
                'close': prices,
                'volume': [1000000] * 30
            }, index=dates)
        }
        
        return data
    
    def test_engine_initialization(self):
        """Test engine initialization."""
        assert self.engine.initial_capital == 10000
        assert self.engine.cash == 10000
        assert self.engine.commission == 1.0
        assert self.engine.slippage == 0.001
        assert len(self.engine.positions) == 0
        assert len(self.engine.trades) == 0
    
    def test_reset_backtest(self):
        """Test backtest state reset."""
        # Modify engine state
        self.engine.cash = 5000
        self.engine.positions['TEST'] = Position('TEST', pd.Timestamp.now(), 100.0, 10, 'buy')
        
        # Reset
        self.engine._reset_backtest()
        
        assert self.engine.cash == self.engine.initial_capital
        assert len(self.engine.positions) == 0
        assert len(self.engine.trades) == 0
    
    def test_prepare_data(self):
        """Test data preparation."""
        prepared = self.engine._prepare_data(self.mock_data)
        
        assert not prepared.empty
        assert isinstance(prepared.index, pd.MultiIndex)
        assert 'date' in prepared.index.names
        assert 'symbol' in prepared.index.names
    
    def test_slippage_calculation(self):
        """Test slippage application."""
        base_price = 100.0
        
        buy_price = self.engine._apply_slippage(base_price, 'buy')
        sell_price = self.engine._apply_slippage(base_price, 'sell')
        
        # Buy price should be higher (unfavorable)
        assert buy_price > base_price
        
        # Sell price should be lower (unfavorable)
        assert sell_price < base_price
    
    def test_simple_backtest(self):
        """Test running a simple backtest."""
        results = self.engine.run_backtest(
            strategy=self.strategy,
            data=self.mock_data
        )
        
        # Check results structure
        assert 'strategy_name' in results
        assert 'initial_capital' in results
        assert 'final_value' in results
        assert 'metrics' in results
        assert 'portfolio_history' in results
        
        # Check that final value is reasonable
        assert results['final_value'] > 0
        
        # Should have some portfolio history
        assert len(results['portfolio_history']) > 0

class TestPerformanceMetrics:
    """Tests for performance metrics calculations."""
    
    def setup_method(self):
        """Setup test fixtures."""
        self.portfolio_values = self._create_portfolio_series()
        self.trades = self._create_mock_trades()
    
    def _create_portfolio_series(self):
        """Create mock portfolio value series."""
        dates = pd.date_range(start='2023-01-01', periods=252, freq='D')
        
        # Create series with some volatility and overall growth
        np.random.seed(42)
        returns = np.random.normal(0.0008, 0.02, 252)  # Daily returns
        
        values = [10000]  # Starting value
        for ret in returns:
            values.append(values[-1] * (1 + ret))
        
        return pd.Series(values[1:], index=dates)
    
    def _create_mock_trades(self):
        """Create mock trade data."""
        trades = []
        
        # Winning trade
        trades.append(Trade(
            symbol='AAPL',
            entry_date=pd.Timestamp('2023-01-15'),
            exit_date=pd.Timestamp('2023-01-30'),
            entry_price=150.0,
            exit_price=155.0,
            quantity=100,
            side='buy',
            pnl=500.0,
            pnl_pct=3.33,
            duration_days=15,
            entry_reason='Test buy',
            exit_reason='Test sell'
        ))
        
        # Losing trade
        trades.append(Trade(
            symbol='MSFT',
            entry_date=pd.Timestamp('2023-02-01'),
            exit_date=pd.Timestamp('2023-02-15'),
            entry_price=300.0,
            exit_price=290.0,
            quantity=50,
            side='buy',
            pnl=-500.0,
            pnl_pct=-3.33,
            duration_days=14,
            entry_reason='Test buy',
            exit_reason='Test sell'
        ))
        
        return trades
    
    def test_performance_metrics_calculation(self):
        """Test basic performance metrics calculation."""
        metrics = calculate_performance_metrics(
            portfolio_values=self.portfolio_values,
            trades=self.trades,
            initial_capital=10000
        )
        
        # Check required metrics are present
        required_metrics = [
            'total_return', 'annualized_return', 'final_value',
            'volatility', 'max_drawdown', 'sharpe_ratio',
            'total_trades', 'win_rate', 'profit_factor'
        ]
        
        for metric in required_metrics:
            assert metric in metrics
            assert isinstance(metrics[metric], (int, float))
        
        # Basic sanity checks
        assert metrics['total_trades'] == len(self.trades)
        assert 0 <= metrics['win_rate'] <= 1
        assert metrics['final_value'] > 0
    
    def test_empty_data_handling(self):
        """Test handling of empty data."""
        empty_series = pd.Series([], dtype=float)
        empty_trades = []
        
        metrics = calculate_performance_metrics(
            portfolio_values=empty_series,
            trades=empty_trades,
            initial_capital=10000
        )
        
        # Should return empty dict for empty data
        assert metrics == {}
    
    def test_trade_metrics(self):
        """Test trade-specific metrics."""
        metrics = calculate_performance_metrics(
            portfolio_values=self.portfolio_values,
            trades=self.trades,
            initial_capital=10000
        )
        
        # Win rate should be 50% (1 win, 1 loss)
        assert metrics['win_rate'] == 0.5
        
        # Profit factor should be 1.0 (equal wins and losses)
        assert metrics['profit_factor'] == 1.0
        
        # Average trade duration
        expected_avg_duration = (15 + 14) / 2
        assert metrics['avg_trade_duration'] == expected_avg_duration

class TestIntegrationBacktest:
    """Integration tests with real strategies."""
    
    def setup_method(self):
        """Setup with real strategy and data."""
        self.engine = BacktestEngine(initial_capital=10000)
        self.strategy = MomentumStrategy()
        self.data = self._create_realistic_data()
    
    def _create_realistic_data(self):
        """Create more realistic market data."""
        dates = pd.date_range(start='2023-01-01', periods=100, freq='D')
        
        # Create data with trends and reversals
        np.random.seed(42)
        price = 100.0
        prices = []
        
        for i in range(100):
            # Add some trend and noise
            if i < 30:
                trend = 0.002  # Uptrend
            elif i < 70:
                trend = -0.001  # Slight downtrend
            else:
                trend = 0.0015  # Recovery
            
            noise = np.random.normal(0, 0.015)
            change = trend + noise
            price *= (1 + change)
            prices.append(price)
        
        # Create multi-symbol data
        symbols = ['AAPL', 'MSFT', 'GOOGL']
        data = {}
        
        for i, symbol in enumerate(symbols):
            # Vary the data slightly for each symbol
            symbol_prices = [p * (1 + i * 0.1) for p in prices]
            
            data[symbol] = pd.DataFrame({
                'open': [p * 0.999 for p in symbol_prices],
                'high': [p * 1.015 for p in symbol_prices],
                'low': [p * 0.985 for p in symbol_prices],
                'close': symbol_prices,
                'volume': [np.random.randint(100000, 1000000) for _ in symbol_prices]
            }, index=dates)
        
        return data
    
    def test_full_backtest_with_momentum_strategy(self):
        """Test full backtest with momentum strategy."""
        results = self.engine.run_backtest(
            strategy=self.strategy,
            data=self.data
        )
        
        # Verify results structure
        assert 'strategy_name' in results
        assert results['strategy_name'] == self.strategy.get_name()
        
        # Verify metrics
        metrics = results['metrics']
        assert 'total_return' in metrics
        assert 'sharpe_ratio' in metrics
        assert 'max_drawdown' in metrics
        
        # Portfolio history should span the full period
        portfolio_history = results['portfolio_history']
        assert len(portfolio_history) > 90  # Should have most trading days
        
        # Final value should be positive
        assert results['final_value'] > 0
        
        print(f"Backtest completed:")
        print(f"  Initial Capital: ${results['initial_capital']:,.2f}")
        print(f"  Final Value: ${results['final_value']:,.2f}")
        print(f"  Total Return: {metrics['total_return']:.2%}")
        print(f"  Total Trades: {results['total_trades']}")
    
    def test_backtest_with_date_range(self):
        """Test backtest with specific date range."""
        results = self.engine.run_backtest(
            strategy=self.strategy,
            data=self.data,
            start_date='2023-01-15',
            end_date='2023-03-15'
        )
        
        # Should still complete successfully
        assert 'final_value' in results
        
        # Date range should be respected in portfolio history
        portfolio_history = results['portfolio_history']
        if not portfolio_history.empty:
            start_actual = portfolio_history.index[0]
            end_actual = portfolio_history.index[-1]
            
            assert start_actual >= pd.Timestamp('2023-01-15')
            assert end_actual <= pd.Timestamp('2023-03-15')

def test_trade_dataclass():
    """Test Trade dataclass functionality."""
    trade = Trade(
        symbol='TEST',
        entry_date=pd.Timestamp('2023-01-01'),
        exit_date=pd.Timestamp('2023-01-10'),
        entry_price=100.0,
        exit_price=105.0,
        quantity=10,
        side='buy',
        pnl=50.0,
        pnl_pct=5.0,
        duration_days=9,
        entry_reason='Test entry',
        exit_reason='Test exit'
    )
    
    assert trade.symbol == 'TEST'
    assert trade.pnl == 50.0
    assert trade.duration_days == 9

def test_position_dataclass():
    """Test Position dataclass functionality."""
    position = Position(
        symbol='TEST',
        entry_date=pd.Timestamp('2023-01-01'),
        entry_price=100.0,
        quantity=10,
        side='buy',
        current_price=105.0,
        unrealized_pnl=50.0,
        entry_reason='Test position'
    )
    
    assert position.symbol == 'TEST'
    assert position.quantity == 10
    assert position.unrealized_pnl == 50.0

if __name__ == '__main__':
    # Run basic tests
    test_trade_dataclass()
    test_position_dataclass()
    
    # Run integration test
    integration_test = TestIntegrationBacktest()
    integration_test.setup_method()
    integration_test.test_full_backtest_with_momentum_strategy()
    
    print("All backtest tests passed!")