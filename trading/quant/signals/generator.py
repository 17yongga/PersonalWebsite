"""Signal aggregation and generation system."""

import pandas as pd
import numpy as np
from typing import Dict, List, Any, Optional
import logging
from datetime import datetime

from strategies.base import Strategy, Signal
from strategies.momentum import MomentumStrategy
from strategies.mean_reversion import MeanReversionStrategy
from strategies.volatility_breakout import VolatilityBreakoutStrategy
from strategies.sector_rotation import SectorRotationStrategy
from strategies.value_dividend import ValueDividendStrategy
from utils.risk import RiskManager
import config

logger = logging.getLogger(__name__)

class SignalAggregator:
    """Aggregates signals from multiple strategies and applies filters."""
    
    def __init__(self, risk_manager: Optional[RiskManager] = None):
        self.strategies = {}
        self.risk_manager = risk_manager or RiskManager()
        self.universe = config.DEFAULT_UNIVERSE
        
    def add_strategy(self, name: str, strategy: Strategy, weight: float = 1.0) -> None:
        """Add a strategy to the aggregator."""
        self.strategies[name] = {
            'strategy': strategy,
            'weight': weight,
            'enabled': True
        }
        logger.info(f"Added strategy: {name} with weight {weight}")
    
    def remove_strategy(self, name: str) -> None:
        """Remove a strategy from the aggregator."""
        if name in self.strategies:
            del self.strategies[name]
            logger.info(f"Removed strategy: {name}")
    
    def enable_strategy(self, name: str, enabled: bool = True) -> None:
        """Enable or disable a strategy."""
        if name in self.strategies:
            self.strategies[name]['enabled'] = enabled
            status = "enabled" if enabled else "disabled"
            logger.info(f"Strategy {name} {status}")
    
    def set_strategy_weight(self, name: str, weight: float) -> None:
        """Set the weight for a strategy."""
        if name in self.strategies:
            self.strategies[name]['weight'] = weight
            logger.info(f"Set weight for {name}: {weight}")
    
    def generate_signals(self, data: Dict[str, pd.DataFrame]) -> List[Signal]:
        """
        Generate aggregated signals from all active strategies.
        
        Args:
            data: Dictionary mapping symbols to OHLCV DataFrames
        
        Returns:
            List of aggregated and filtered signals
        """
        all_signals = []
        strategy_signals = {}
        
        # Generate signals from each strategy
        for strategy_name, strategy_info in self.strategies.items():
            if not strategy_info['enabled']:
                continue
            
            strategy = strategy_info['strategy']
            
            try:
                # Generate signals for each symbol
                for symbol in self.universe:
                    if symbol in data and not data[symbol].empty:
                        # Check if strategy supports symbol parameter
                        import inspect
                        sig = inspect.signature(strategy.generate_signals)
                        if 'symbol' in sig.parameters:
                            symbol_signals = strategy.generate_signals(data[symbol], symbol=symbol)
                        else:
                            symbol_signals = strategy.generate_signals(data[symbol])
                        
                        # Add strategy metadata
                        for signal in symbol_signals:
                            signal.strategy_name = strategy_name
                            signal.strategy_weight = strategy_info['weight']
                        
                        all_signals.extend(symbol_signals)
                        
                        if strategy_name not in strategy_signals:
                            strategy_signals[strategy_name] = []
                        strategy_signals[strategy_name].extend(symbol_signals)
                
                logger.debug(f"Generated {len(strategy_signals.get(strategy_name, []))} signals from {strategy_name}")
                
            except Exception as e:
                logger.error(f"Error generating signals from {strategy_name}: {e}")
                continue
        
        # Aggregate signals by symbol
        aggregated_signals = self._aggregate_signals_by_symbol(all_signals)
        
        # Apply risk filters
        filtered_signals = self._apply_risk_filters(aggregated_signals)
        
        logger.info(f"Generated {len(filtered_signals)} final signals from {len(all_signals)} raw signals")
        return filtered_signals
    
    def _aggregate_signals_by_symbol(self, signals: List[Signal]) -> List[Signal]:
        """Aggregate multiple signals for the same symbol."""
        symbol_signals = {}
        
        # Group signals by symbol and action
        for signal in signals:
            key = (signal.symbol, signal.action)
            if key not in symbol_signals:
                symbol_signals[key] = []
            symbol_signals[key].append(signal)
        
        aggregated = []
        
        for (symbol, action), signal_group in symbol_signals.items():
            if len(signal_group) == 1:
                # Single signal, use as-is
                aggregated.append(signal_group[0])
            else:
                # Multiple signals, aggregate them
                aggregated_signal = self._combine_signals(signal_group)
                aggregated.append(aggregated_signal)
        
        return aggregated
    
    def _combine_signals(self, signals: List[Signal]) -> Signal:
        """Combine multiple signals for the same symbol and action."""
        # Calculate weighted average confidence
        total_weight = sum(getattr(s, 'strategy_weight', 1.0) for s in signals)
        weighted_confidence = sum(
            s.confidence * getattr(s, 'strategy_weight', 1.0) 
            for s in signals
        ) / total_weight
        
        # Use the latest price
        latest_signal = max(signals, key=lambda s: s.timestamp)
        
        # Combine reasons
        reasons = []
        for s in signals:
            strategy_name = getattr(s, 'strategy_name', 'Unknown')
            reasons.append(f"{strategy_name}: {s.reason}")
        
        combined_reason = " | ".join(reasons)
        
        # Create aggregated signal
        aggregated = Signal(
            symbol=latest_signal.symbol,
            action=latest_signal.action,
            confidence=weighted_confidence,
            price=latest_signal.price,
            reason=combined_reason,
            timestamp=latest_signal.timestamp
        )
        
        # Add metadata
        aggregated.num_strategies = len(signals)
        aggregated.strategy_names = [getattr(s, 'strategy_name', 'Unknown') for s in signals]
        
        return aggregated
    
    def _apply_risk_filters(self, signals: List[Signal]) -> List[Signal]:
        """Apply risk management filters to signals."""
        filtered_signals = []
        
        # Sort by confidence (highest first)
        signals.sort(key=lambda s: s.confidence, reverse=True)
        
        for signal in signals:
            # Check daily loss limit
            can_trade_loss, loss_reason = self.risk_manager.check_daily_loss_limit()
            if not can_trade_loss:
                logger.info(f"Skipping {signal.symbol} {signal.action}: {loss_reason}")
                continue
            
            # Calculate position size
            position_size = self.risk_manager.calculate_position_size(
                signal.symbol, signal.price, method='fixed_fractional'
            )
            
            # Check position limits
            can_trade_position, position_reason = self.risk_manager.check_position_limits(
                signal.symbol, position_size, signal.price
            )
            
            if not can_trade_position:
                logger.info(f"Skipping {signal.symbol} {signal.action}: {position_reason}")
                continue
            
            # Apply confidence threshold
            min_confidence = 0.3  # Minimum 30% confidence
            if signal.confidence < min_confidence:
                logger.debug(f"Skipping {signal.symbol} {signal.action}: low confidence {signal.confidence:.2f}")
                continue
            
            # Set calculated position size
            signal.quantity = position_size
            filtered_signals.append(signal)
        
        # Limit total number of signals to prevent over-diversification
        max_signals = config.MAX_POSITIONS
        if len(filtered_signals) > max_signals:
            logger.info(f"Limiting signals to top {max_signals} by confidence")
            filtered_signals = filtered_signals[:max_signals]
        
        return filtered_signals
    
    def get_strategy_summary(self) -> Dict[str, Any]:
        """Get summary of all strategies and their status."""
        summary = {}
        
        for name, info in self.strategies.items():
            strategy = info['strategy']
            summary[name] = {
                'name': strategy.get_name(),
                'description': strategy.get_description(),
                'weight': info['weight'],
                'enabled': info['enabled'],
                'parameters': strategy.get_parameters(),
                'config': strategy.get_config()
            }
        
        return summary
    
    def update_universe(self, symbols: List[str]) -> None:
        """Update the trading universe."""
        self.universe = symbols
        logger.info(f"Updated universe to {len(symbols)} symbols: {symbols}")
    
    def get_universe(self) -> List[str]:
        """Get current trading universe."""
        return self.universe.copy()

class SignalGenerator:
    """Main signal generation system with pre-configured strategies."""
    
    def __init__(self):
        self.aggregator = SignalAggregator()
        self._initialize_default_strategies()
    
    def _initialize_default_strategies(self):
        """Initialize all 5 virtual strategy portfolios with their specific configurations."""
        
        # 1. Momentum Hunter - Momentum/trend following
        momentum_config = {
            'rsi_period': 14,
            'macd_fast': 12,
            'macd_slow': 26,
            'macd_signal': 9,
            'ema_fast': 20,
            'ema_slow': 50,
            'buy_threshold': 2,
            'sell_threshold': -2
        }
        momentum_strategy = MomentumStrategy(momentum_config)
        self.aggregator.add_strategy('momentum-hunter', momentum_strategy, weight=1.0)
        
        # 2. Mean Reversion
        mean_rev_config = {
            'bb_period': 20,
            'bb_std': 2.0,
            'zscore_period': 20,
            'zscore_buy_threshold': -2.0,
            'zscore_sell_threshold': 2.0
        }
        mean_rev_strategy = MeanReversionStrategy(mean_rev_config)
        self.aggregator.add_strategy('mean-reversion', mean_rev_strategy, weight=1.0)
        
        # 3. Sector Rotator - Sector rotation strategy
        sector_config = {
            'lookback_period': 60,
            'momentum_threshold': 0.05,
            'max_positions': 3,
            'position_size': 0.33
        }
        sector_strategy = SectorRotationStrategy(sector_config)
        self.aggregator.add_strategy('sector-rotator', sector_strategy, weight=1.0)
        
        # 4. Value Dividends - Value + dividends strategy
        value_config = {
            'rsi_oversold': 35,
            'rsi_overbought': 65,
            'position_size': 0.12,
            'max_positions': 8,
            'volatility_threshold': 0.02
        }
        value_strategy = ValueDividendStrategy(value_config)
        self.aggregator.add_strategy('value-dividends', value_strategy, weight=1.0)
        
        # 5. Volatility Breakout — ATR expansion + volume spike + price breakout
        volatility_config = {
            'breakout_period': 20,
            'volume_factor': 1.5,
            'atr_threshold': 1.2,
            'min_volume': 1000000,
            'stop_loss': -0.08,
            'take_profit': 0.15
        }
        volatility_strategy = VolatilityBreakoutStrategy(volatility_config)
        self.aggregator.add_strategy('volatility-breakout', volatility_strategy, weight=1.0)
        
        logger.info("Initialized all 5 virtual strategy portfolios")
    
    def generate_signals(self, data: Dict[str, pd.DataFrame]) -> List[Signal]:
        """Generate signals using the aggregator."""
        return self.aggregator.generate_signals(data)
    
    def get_strategy(self, name: str) -> Optional[Strategy]:
        """Get a strategy by name."""
        strategy_info = self.aggregator.strategies.get(name)
        return strategy_info['strategy'] if strategy_info else None
    
    def configure_strategy(self, name: str, config: Dict[str, Any]) -> bool:
        """Update strategy configuration."""
        try:
            strategy = self.get_strategy(name)
            if strategy:
                strategy.update_config(config)
                logger.info(f"Updated configuration for {name}")
                return True
            return False
        except Exception as e:
            logger.error(f"Error configuring {name}: {e}")
            return False
    
    def enable_strategy(self, name: str, enabled: bool = True) -> bool:
        """Enable or disable a strategy."""
        self.aggregator.enable_strategy(name, enabled)
        return True
    
    def set_strategy_weight(self, name: str, weight: float) -> bool:
        """Set strategy weight."""
        self.aggregator.set_strategy_weight(name, weight)
        return True
    
    def get_available_strategies(self) -> List[str]:
        """Get list of available strategy names."""
        return list(self.aggregator.strategies.keys())
    
    def get_strategy_summary(self) -> Dict[str, Any]:
        """Get summary of all strategies."""
        return self.aggregator.get_strategy_summary()
    
    def update_universe(self, symbols: List[str]) -> None:
        """Update trading universe."""
        self.aggregator.update_universe(symbols)
    
    def get_universe(self) -> List[str]:
        """Get current trading universe."""
        return self.aggregator.get_universe()

# Global signal generator instance
signal_generator = SignalGenerator()