"""Risk management utilities for trading strategies."""

import pandas as pd
import numpy as np
from typing import Dict, List, Tuple, Optional
import logging
import config

logger = logging.getLogger(__name__)

class RiskManager:
    """Portfolio risk management system."""
    
    def __init__(self, portfolio_value: float = None):
        self.portfolio_value = portfolio_value or config.INITIAL_CAPITAL
        self.daily_loss_limit = self.portfolio_value * config.DAILY_LOSS_LIMIT_PCT
        self.daily_pnl = 0.0
        self.positions = {}  # symbol -> {quantity, avg_price, current_value}
    
    def update_portfolio_value(self, value: float) -> None:
        """Update current portfolio value."""
        self.portfolio_value = value
        self.daily_loss_limit = value * config.DAILY_LOSS_LIMIT_PCT
    
    def update_daily_pnl(self, pnl: float) -> None:
        """Update daily P&L."""
        self.daily_pnl = pnl
    
    def calculate_position_size(
        self, 
        symbol: str, 
        price: float, 
        method: str = 'fixed_fractional',
        volatility: Optional[float] = None,
        win_rate: Optional[float] = None,
        avg_win: Optional[float] = None,
        avg_loss: Optional[float] = None
    ) -> int:
        """
        Calculate optimal position size using various methods.
        
        Args:
            symbol: Stock symbol
            price: Current stock price
            method: Position sizing method ('fixed_fractional', 'kelly', 'volatility_target')
            volatility: Stock volatility (for volatility targeting)
            win_rate: Historical win rate (for Kelly criterion)
            avg_win: Average winning trade (for Kelly criterion)
            avg_loss: Average losing trade (for Kelly criterion)
        
        Returns:
            Number of shares to trade
        """
        max_position_value = self.portfolio_value * config.MAX_POSITION_PCT
        max_shares_by_position = int(max_position_value / price)
        
        if method == 'fixed_fractional':
            shares = self._fixed_fractional_sizing(price)
        elif method == 'kelly' and all([win_rate, avg_win, avg_loss]):
            shares = self._kelly_criterion_sizing(price, win_rate, avg_win, avg_loss)
        elif method == 'volatility_target' and volatility:
            shares = self._volatility_target_sizing(price, volatility)
        else:
            # Default to fixed fractional
            shares = self._fixed_fractional_sizing(price)
        
        # Apply position size limits
        shares = min(shares, max_shares_by_position)
        shares = max(1, shares)  # Minimum 1 share
        
        logger.info(f"Position size for {symbol}: {shares} shares @ ${price:.2f}")
        return shares
    
    def _fixed_fractional_sizing(self, price: float, risk_pct: float = 0.02) -> int:
        """Fixed fractional position sizing (risk percentage of portfolio)."""
        risk_amount = self.portfolio_value * risk_pct
        shares = int(risk_amount / price)
        return shares
    
    def _kelly_criterion_sizing(
        self, 
        price: float, 
        win_rate: float, 
        avg_win: float, 
        avg_loss: float
    ) -> int:
        """Kelly criterion position sizing."""
        if avg_loss == 0:
            return self._fixed_fractional_sizing(price)
        
        # Kelly formula: f = (bp - q) / b
        # where b = avg_win/avg_loss, p = win_rate, q = 1 - win_rate
        b = avg_win / abs(avg_loss)
        p = win_rate
        q = 1 - win_rate
        
        kelly_fraction = (b * p - q) / b
        
        # Cap Kelly fraction to be conservative
        kelly_fraction = max(0, min(kelly_fraction, 0.25))  # Max 25% of portfolio
        
        position_value = self.portfolio_value * kelly_fraction
        shares = int(position_value / price)
        
        return shares
    
    def _volatility_target_sizing(self, price: float, volatility: float, target_vol: float = 0.15) -> int:
        """Volatility targeting position sizing."""
        if volatility == 0:
            return self._fixed_fractional_sizing(price)
        
        # Scale position size inversely with volatility
        vol_multiplier = target_vol / volatility
        vol_multiplier = min(vol_multiplier, 3.0)  # Cap at 3x
        
        base_position_value = self.portfolio_value * 0.1  # 10% base allocation
        adjusted_position_value = base_position_value * vol_multiplier
        
        shares = int(adjusted_position_value / price)
        return shares
    
    def check_position_limits(self, symbol: str, quantity: int, price: float) -> Tuple[bool, str]:
        """Check if a trade violates position limits."""
        position_value = quantity * price
        
        # Check maximum position size
        max_position_value = self.portfolio_value * config.MAX_POSITION_PCT
        if position_value > max_position_value:
            return False, f"Position exceeds maximum size: ${position_value:.2f} > ${max_position_value:.2f}"
        
        # Check portfolio allocation limits
        current_allocation = self._calculate_total_allocation()
        new_allocation = current_allocation + (position_value / self.portfolio_value)
        
        if new_allocation > config.MAX_PORTFOLIO_PCT:
            return False, f"Portfolio allocation exceeds limit: {new_allocation:.1%} > {config.MAX_PORTFOLIO_PCT:.1%}"
        
        # Check maximum number of positions
        current_positions = len(self.positions)
        if symbol not in self.positions and current_positions >= config.MAX_POSITIONS:
            return False, f"Maximum number of positions reached: {current_positions}"
        
        return True, "Position limits OK"
    
    def check_daily_loss_limit(self) -> Tuple[bool, str]:
        """Check if daily loss limit is reached."""
        if self.daily_pnl < -self.daily_loss_limit:
            return False, f"Daily loss limit reached: ${self.daily_pnl:.2f} < ${-self.daily_loss_limit:.2f}"
        
        return True, "Daily loss limit OK"
    
    def calculate_stop_loss(self, entry_price: float, side: str) -> float:
        """Calculate stop loss price."""
        stop_loss_pct = config.STOP_LOSS_PCT
        
        if side.lower() == 'buy':
            stop_price = entry_price * (1 - stop_loss_pct)
        else:  # sell/short
            stop_price = entry_price * (1 + stop_loss_pct)
        
        return round(stop_price, 2)
    
    def calculate_portfolio_heat(self) -> float:
        """
        Calculate portfolio heat (total risk exposure).
        
        Returns:
            Portfolio heat as percentage of total portfolio value
        """
        total_risk = 0.0
        
        for symbol, position in self.positions.items():
            # Risk per position = position_value * stop_loss_pct
            position_value = abs(position['quantity']) * position['current_price']
            position_risk = position_value * config.STOP_LOSS_PCT
            total_risk += position_risk
        
        heat = total_risk / self.portfolio_value
        return heat
    
    def update_position(self, symbol: str, quantity: int, price: float) -> None:
        """Update position information."""
        if symbol not in self.positions:
            self.positions[symbol] = {
                'quantity': 0,
                'avg_price': 0.0,
                'current_price': price
            }
        
        position = self.positions[symbol]
        
        # Update average price if adding to position
        if (position['quantity'] > 0 and quantity > 0) or (position['quantity'] < 0 and quantity < 0):
            total_value = position['quantity'] * position['avg_price'] + quantity * price
            total_quantity = position['quantity'] + quantity
            position['avg_price'] = total_value / total_quantity if total_quantity != 0 else price
        else:
            position['avg_price'] = price
        
        position['quantity'] += quantity
        position['current_price'] = price
        
        # Remove position if quantity is zero
        if position['quantity'] == 0:
            del self.positions[symbol]
    
    def _calculate_total_allocation(self) -> float:
        """Calculate current total portfolio allocation."""
        total_value = 0.0
        
        for position in self.positions.values():
            position_value = abs(position['quantity']) * position['current_price']
            total_value += position_value
        
        return total_value / self.portfolio_value
    
    def get_position_summary(self) -> Dict:
        """Get summary of current positions and risk metrics."""
        total_value = 0.0
        total_pnl = 0.0
        
        position_details = []
        
        for symbol, position in self.positions.items():
            current_value = position['quantity'] * position['current_price']
            cost_basis = position['quantity'] * position['avg_price']
            pnl = current_value - cost_basis
            
            total_value += abs(current_value)
            total_pnl += pnl
            
            position_details.append({
                'symbol': symbol,
                'quantity': position['quantity'],
                'avg_price': position['avg_price'],
                'current_price': position['current_price'],
                'current_value': current_value,
                'pnl': pnl,
                'pnl_pct': (pnl / abs(cost_basis)) * 100 if cost_basis != 0 else 0
            })
        
        return {
            'positions': position_details,
            'total_positions': len(self.positions),
            'total_value': total_value,
            'total_pnl': total_pnl,
            'portfolio_allocation': total_value / self.portfolio_value,
            'portfolio_heat': self.calculate_portfolio_heat(),
            'daily_pnl': self.daily_pnl,
            'cash_remaining': self.portfolio_value - total_value
        }

def calculate_var(returns: pd.Series, confidence: float = 0.05) -> float:
    """
    Calculate Value at Risk (VaR) using historical method.
    
    Args:
        returns: Series of portfolio returns
        confidence: Confidence level (0.05 for 95% VaR)
    
    Returns:
        VaR value (positive number representing potential loss)
    """
    if len(returns) < 10:
        return 0.0
    
    var = np.percentile(returns, confidence * 100)
    return abs(var)

def calculate_expected_shortfall(returns: pd.Series, confidence: float = 0.05) -> float:
    """
    Calculate Expected Shortfall (Conditional VaR).
    
    Args:
        returns: Series of portfolio returns
        confidence: Confidence level
    
    Returns:
        Expected shortfall value
    """
    if len(returns) < 10:
        return 0.0
    
    var = calculate_var(returns, confidence)
    shortfall_returns = returns[returns <= -var]
    
    if len(shortfall_returns) == 0:
        return var
    
    return abs(shortfall_returns.mean())

# Global risk manager instance
risk_manager = RiskManager()