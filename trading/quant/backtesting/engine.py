"""Backtesting engine for trading strategies."""

import pandas as pd
import numpy as np
from typing import Dict, List, Any, Optional
from datetime import datetime, timedelta
import logging
from dataclasses import dataclass

from strategies.base import Strategy, Signal
from utils.risk import RiskManager
from .metrics import calculate_performance_metrics

logger = logging.getLogger(__name__)

@dataclass
class Trade:
    """Represents a completed trade."""
    symbol: str
    entry_date: pd.Timestamp
    exit_date: pd.Timestamp
    entry_price: float
    exit_price: float
    quantity: int
    side: str  # 'buy' or 'sell'
    pnl: float
    pnl_pct: float
    duration_days: int
    entry_reason: str
    exit_reason: str

@dataclass
class Position:
    """Represents an open position."""
    symbol: str
    entry_date: pd.Timestamp
    entry_price: float
    quantity: int
    side: str
    current_price: float = 0.0
    unrealized_pnl: float = 0.0
    entry_reason: str = ""

class BacktestEngine:
    """Backtesting framework for trading strategies."""
    
    def __init__(
        self,
        initial_capital: float = 10000,
        commission: float = 1.0,  # Fixed commission per trade
        slippage: float = 0.001,   # 0.1% slippage
        market_impact: float = 0.0005  # 0.05% market impact
    ):
        self.initial_capital = initial_capital
        self.commission = commission
        self.slippage = slippage
        self.market_impact = market_impact
        
        # Portfolio state
        self.cash = initial_capital
        self.positions = {}  # symbol -> Position
        self.trades = []     # List of completed trades
        self.portfolio_history = []  # Daily portfolio values
        
        # Risk management
        self.risk_manager = RiskManager(initial_capital)
        
        # Tracking
        self.current_date = None
        self.trade_log = []
    
    def run_backtest(
        self,
        strategy: Strategy,
        data: Dict[str, pd.DataFrame],  # symbol -> OHLCV data
        start_date: Optional[str] = None,
        end_date: Optional[str] = None
    ) -> Dict[str, Any]:
        """
        Run backtest for a strategy on historical data.
        
        Args:
            strategy: Trading strategy instance
            data: Dictionary mapping symbols to OHLCV DataFrames
            start_date: Start date for backtest (YYYY-MM-DD)
            end_date: End date for backtest (YYYY-MM-DD)
        
        Returns:
            Dictionary containing backtest results
        """
        logger.info(f"Starting backtest for {strategy.get_name()}")
        
        # Prepare data
        combined_data = self._prepare_data(data, start_date, end_date)
        
        if combined_data.empty:
            raise ValueError("No data available for backtesting")
        
        # Initialize tracking
        self._reset_backtest()
        dates = combined_data.index.get_level_values('date').unique().sort_values()
        
        # Run simulation day by day
        for date in dates:
            self.current_date = date
            day_data = combined_data.loc[date]
            
            # Update portfolio value and positions
            self._update_positions(day_data)
            
            # Generate signals for each symbol on this day
            all_signals = []
            
            # Check if day_data has symbol level
            if 'symbol' in day_data.index.names:
                # Multi-symbol data - generate signals for each symbol
                symbols = day_data.index.get_level_values('symbol').unique()
                for symbol in symbols:
                    symbol_data = day_data.loc[symbol]
                    if not symbol_data.empty:
                        # Check if strategy supports symbol parameter
                        import inspect
                        sig = inspect.signature(strategy.generate_signals)
                        if 'symbol' in sig.parameters:
                            symbol_signals = strategy.generate_signals(symbol_data, symbol=symbol)
                        else:
                            symbol_signals = strategy.generate_signals(symbol_data)
                        all_signals.extend(symbol_signals)
            else:
                # Single symbol or combined data
                signals = strategy.generate_signals(day_data)
                all_signals.extend(signals)
            
            # Execute trades based on signals
            for signal in all_signals:
                self._execute_signal(signal, day_data)
            
            # Record daily portfolio value
            portfolio_value = self._calculate_portfolio_value(day_data)
            self.portfolio_history.append({
                'date': date,
                'portfolio_value': portfolio_value,
                'cash': self.cash,
                'positions_value': portfolio_value - self.cash,
                'num_positions': len(self.positions)
            })
            
            self.risk_manager.update_portfolio_value(portfolio_value)
        
        # Close all remaining positions at final prices
        final_data = combined_data.loc[dates[-1]]
        self._close_all_positions(final_data, "Backtest end")
        
        # Calculate performance metrics
        results = self._compile_results(strategy)
        
        logger.info(f"Backtest completed. Final portfolio value: ${results['final_value']:,.2f}")
        return results
    
    def _prepare_data(
        self,
        data: Dict[str, pd.DataFrame],
        start_date: Optional[str] = None,
        end_date: Optional[str] = None
    ) -> pd.DataFrame:
        """Prepare and combine data from multiple symbols."""
        combined_dfs = []
        
        for symbol, df in data.items():
            df = df.copy()
            df['symbol'] = symbol
            df.index.name = 'date'
            
            # Apply date filters
            if start_date:
                df = df[df.index >= start_date]
            if end_date:
                df = df[df.index <= end_date]
            
            if not df.empty:
                combined_dfs.append(df)
        
        if not combined_dfs:
            return pd.DataFrame()
        
        # Combine all data
        combined_data = pd.concat(combined_dfs)
        combined_data = combined_data.reset_index().set_index(['date', 'symbol'])
        combined_data = combined_data.sort_index()
        
        return combined_data
    
    def _reset_backtest(self):
        """Reset backtest state."""
        self.cash = self.initial_capital
        self.positions = {}
        self.trades = []
        self.portfolio_history = []
        self.trade_log = []
        self.current_date = None
        self.risk_manager = RiskManager(self.initial_capital)
    
    def _update_positions(self, day_data: pd.DataFrame):
        """Update current positions with latest prices."""
        for symbol, position in self.positions.items():
            if symbol in day_data.index:
                current_price = day_data.loc[symbol, 'close']
                position.current_price = current_price
                
                # Calculate unrealized P&L
                if position.side == 'buy':
                    position.unrealized_pnl = (current_price - position.entry_price) * position.quantity
                else:  # sell/short
                    position.unrealized_pnl = (position.entry_price - current_price) * position.quantity
    
    def _execute_signal(self, signal: Signal, day_data: pd.DataFrame):
        """Execute a trading signal."""
        symbol = signal.symbol
        
        if symbol not in day_data.index:
            logger.warning(f"No price data for {symbol} on {self.current_date}")
            return
        
        # Get execution price with slippage
        base_price = day_data.loc[symbol, 'close']
        execution_price = self._apply_slippage(base_price, signal.action)
        
        # Calculate position size
        if signal.quantity > 0:
            quantity = signal.quantity
        else:
            quantity = self.risk_manager.calculate_position_size(
                symbol, execution_price, method='fixed_fractional'
            )
        
        # Check risk limits
        can_trade, reason = self.risk_manager.check_position_limits(
            symbol, quantity, execution_price
        )
        
        if not can_trade:
            logger.info(f"Trade rejected for {symbol}: {reason}")
            return
        
        # Execute the trade
        if signal.action == 'buy':
            self._execute_buy(symbol, quantity, execution_price, signal.reason)
        elif signal.action == 'sell':
            self._execute_sell(symbol, quantity, execution_price, signal.reason)
    
    def _apply_slippage(self, price: float, action: str) -> float:
        """Apply slippage and market impact to execution price."""
        total_impact = self.slippage + self.market_impact
        
        if action == 'buy':
            # Buy at higher price (unfavorable slippage)
            return price * (1 + total_impact)
        else:  # sell
            # Sell at lower price (unfavorable slippage)
            return price * (1 - total_impact)
    
    def _execute_buy(self, symbol: str, quantity: int, price: float, reason: str):
        """Execute a buy order."""
        trade_value = quantity * price
        total_cost = trade_value + self.commission
        
        if total_cost > self.cash:
            logger.info(f"Insufficient cash for {symbol} buy: need ${total_cost:.2f}, have ${self.cash:.2f}")
            return
        
        # Check if we already have a position
        if symbol in self.positions:
            # Add to existing position
            existing = self.positions[symbol]
            if existing.side == 'buy':
                # Average down/up
                total_quantity = existing.quantity + quantity
                total_cost_basis = (existing.quantity * existing.entry_price) + (quantity * price)
                avg_price = total_cost_basis / total_quantity
                
                existing.quantity = total_quantity
                existing.entry_price = avg_price
            else:
                # Close short position first, then potentially open long
                self._close_position(symbol, existing, price, "Signal reversal")
                if quantity > existing.quantity:
                    remaining_quantity = quantity - existing.quantity
                    self._open_position(symbol, remaining_quantity, price, 'buy', reason)
        else:
            # Open new long position
            self._open_position(symbol, quantity, price, 'buy', reason)
        
        # Deduct cash
        self.cash -= total_cost
        
        # Log the trade
        self.trade_log.append({
            'date': self.current_date,
            'symbol': symbol,
            'action': 'buy',
            'quantity': quantity,
            'price': price,
            'value': trade_value,
            'commission': self.commission,
            'cash_after': self.cash,
            'reason': reason
        })
        
        logger.debug(f"BUY: {quantity} shares of {symbol} @ ${price:.2f}")
    
    def _execute_sell(self, symbol: str, quantity: int, price: float, reason: str):
        """Execute a sell order."""
        # Check if we have a position to sell
        if symbol not in self.positions:
            logger.info(f"No position to sell for {symbol}")
            return
        
        position = self.positions[symbol]
        
        if position.side == 'sell':
            logger.info(f"Already short {symbol}, cannot sell more")
            return
        
        # Determine how much to sell
        sell_quantity = min(quantity, position.quantity)
        
        # Calculate proceeds
        trade_value = sell_quantity * price
        net_proceeds = trade_value - self.commission
        
        # Record the trade
        entry_value = sell_quantity * position.entry_price
        pnl = trade_value - entry_value - self.commission
        pnl_pct = (pnl / entry_value) * 100 if entry_value > 0 else 0
        
        trade = Trade(
            symbol=symbol,
            entry_date=position.entry_date,
            exit_date=self.current_date,
            entry_price=position.entry_price,
            exit_price=price,
            quantity=sell_quantity,
            side='buy',  # We bought, now selling
            pnl=pnl,
            pnl_pct=pnl_pct,
            duration_days=(self.current_date - position.entry_date).days,
            entry_reason=position.entry_reason,
            exit_reason=reason
        )
        
        self.trades.append(trade)
        
        # Update position
        if sell_quantity == position.quantity:
            # Close entire position
            del self.positions[symbol]
        else:
            # Partial close
            position.quantity -= sell_quantity
        
        # Add cash
        self.cash += net_proceeds
        
        # Log the trade
        self.trade_log.append({
            'date': self.current_date,
            'symbol': symbol,
            'action': 'sell',
            'quantity': sell_quantity,
            'price': price,
            'value': trade_value,
            'commission': self.commission,
            'pnl': pnl,
            'cash_after': self.cash,
            'reason': reason
        })
        
        logger.debug(f"SELL: {sell_quantity} shares of {symbol} @ ${price:.2f}, P&L: ${pnl:.2f}")
    
    def _open_position(self, symbol: str, quantity: int, price: float, side: str, reason: str):
        """Open a new position."""
        position = Position(
            symbol=symbol,
            entry_date=self.current_date,
            entry_price=price,
            quantity=quantity,
            side=side,
            current_price=price,
            entry_reason=reason
        )
        
        self.positions[symbol] = position
    
    def _close_position(self, symbol: str, position: Position, price: float, reason: str):
        """Close a position."""
        # This would be implemented for short positions
        pass
    
    def _close_all_positions(self, final_data: pd.DataFrame, reason: str):
        """Close all remaining positions at final prices."""
        positions_to_close = list(self.positions.items())
        
        for symbol, position in positions_to_close:
            if symbol in final_data.index:
                final_price = final_data.loc[symbol, 'close']
                self._execute_sell(symbol, position.quantity, final_price, reason)
    
    def _calculate_portfolio_value(self, day_data: pd.DataFrame) -> float:
        """Calculate total portfolio value."""
        positions_value = 0.0
        
        for symbol, position in self.positions.items():
            if symbol in day_data.index:
                current_price = day_data.loc[symbol, 'close']
                position_value = position.quantity * current_price
                positions_value += position_value
        
        return self.cash + positions_value
    
    def _compile_results(self, strategy: Strategy) -> Dict[str, Any]:
        """Compile backtest results."""
        portfolio_df = pd.DataFrame(self.portfolio_history)
        
        if portfolio_df.empty:
            return {'error': 'No portfolio history generated'}
        
        portfolio_df.set_index('date', inplace=True)
        
        # Calculate returns
        portfolio_df['returns'] = portfolio_df['portfolio_value'].pct_change()
        
        # Performance metrics
        metrics = calculate_performance_metrics(
            portfolio_df['portfolio_value'],
            self.trades,
            self.initial_capital
        )
        
        return {
            'strategy_name': strategy.get_name(),
            'strategy_config': strategy.get_config(),
            'start_date': portfolio_df.index[0],
            'end_date': portfolio_df.index[-1],
            'initial_capital': self.initial_capital,
            'final_value': portfolio_df['portfolio_value'].iloc[-1],
            'total_trades': len(self.trades),
            'portfolio_history': portfolio_df,
            'trades': self.trades,
            'trade_log': self.trade_log,
            'metrics': metrics
        }