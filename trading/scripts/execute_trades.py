#!/usr/bin/env python3
"""
Automated Trading Execution Script - Enhanced Version

This script runs all 5 trading strategies with 5-minute execution during market hours.
It features dynamic universe selection, time-based execution, and equity snapshots.

Key Features:
- 5-minute execution for fast strategies (momentum-hunter, mean-reversion, volatility-breakout)
- Daily/weekly execution for slow strategies (sector-rotator, value-dividends) 
- Dynamic universe selection based on market conditions
- Equity snapshot recording every 5 minutes
- Risk management and portfolio tracking

Usage:
    python execute_trades.py              # Execute trades
    python execute_trades.py --dry-run    # Simulate without executing
    python execute_trades.py --status     # Check strategy status
    python execute_trades.py --verbose    # Detailed logging
"""

import sys
import os
import json
import logging
import argparse
import sqlite3
import requests
import pandas as pd
import numpy as np
from datetime import datetime, timedelta
from typing import Dict, List, Optional, Any
import yfinance as yf

# Add the quant directory to Python path
quant_dir = os.path.join(os.path.dirname(__file__), '..', 'quant')
sys.path.insert(0, os.path.abspath(quant_dir))

try:
    from strategy_executor import StrategyExecutor
    from alpaca_client import client as alpaca_client
    import config
except ImportError as e:
    print(f"Error importing quant modules: {e}")
    print(f"Current path: {sys.path}")
    sys.exit(1)

# Configure logging
log_dir = os.path.join(os.path.dirname(__file__), '..', 'logs')
os.makedirs(log_dir, exist_ok=True)
log_file = os.path.join(log_dir, 'trading.log')

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
    handlers=[
        logging.FileHandler(log_file),
        logging.StreamHandler()
    ]
)
logger = logging.getLogger(__name__)


class TradingExecutor:
    """Enhanced trading execution orchestrator with 5-minute granularity and dynamic universe selection."""
    
    def __init__(self, dry_run: bool = False, verbose: bool = False):
        self.dry_run = dry_run
        self.verbose = verbose
        if verbose:
            logging.getLogger().setLevel(logging.DEBUG)
            
        self.strategy_executor = StrategyExecutor()
        self.alpaca = alpaca_client
        
        # Base strategy universes for dynamic selection
        self.base_universes = {
            'momentum-hunter': ['AAPL', 'MSFT', 'NVDA', 'TSLA', 'META', 'GOOGL', 'AMZN', 
                               'AMD', 'PLTR', 'APP', 'CRM', 'NOW', 'UBER', 'COIN', 'SNOW'],
            'mean-reversion': ['AAPL', 'MSFT', 'GOOGL', 'AMZN', 'META', 'NVDA', 'TSLA', 
                              'JPM', 'BAC', 'GS', 'V', 'MA', 'UNH', 'HD', 'CRM'],
            'sector-rotator': ['XLK', 'XLF', 'XLE', 'XLV', 'XLY', 'XLP', 'XLI', 'XLU', 
                              'XLRE', 'SPY', 'QQQ'],
            'value-dividends': ['JNJ', 'KO', 'PG', 'WMT', 'JPM', 'BAC', 'HD', 'MMM', 
                               'VZ', 'T', 'XOM', 'CVX', 'IBM', 'INTC', 'MRK'],
            'volatility-breakout': ['TSLA', 'NVDA', 'AMD', 'COIN', 'MSTR', 'APP', 'PLTR', 
                                   'SMCI', 'IONQ', 'RGTI', 'MARA', 'RIOT', 'HOOD', 'SOFI']
        }
        
        # Strategy configuration with timeframes and execution schedules
        self.strategy_config = {
            1: {
                'name': 'momentum-hunter',
                'timeframe': '5Min',
                'execution_schedule': 'daily',  # Once per day at 9:45am
                'execution_time': '09:45',
                'universe_size': 6,
                'fast_strategy': True
            },
            2: {
                'name': 'mean-reversion', 
                'timeframe': '5Min',
                'execution_schedule': 'every_30min',  # Every 30 minutes
                'universe_size': 5,
                'fast_strategy': True
            },
            3: {
                'name': 'sector-rotator',
                'timeframe': '1Day',
                'execution_schedule': 'weekly',  # Weekly on Mondays at 10am
                'execution_time': '10:00',
                'execution_day': 'Monday',
                'universe_size': 4,
                'fast_strategy': False
            },
            4: {
                'name': 'value-dividends',
                'timeframe': '1Day',
                'execution_schedule': 'weekly',  # Weekly on Mondays at 10am
                'execution_time': '10:00',
                'execution_day': 'Monday',
                'universe_size': 7,
                'fast_strategy': False
            },
            5: {
                'name': 'volatility-breakout',
                'timeframe': '5Min',
                'execution_schedule': 'daily',  # Once per day at 9:45am
                'execution_time': '09:45',
                'universe_size': 5,
                'fast_strategy': True
            }
        }
        
        # Cache for dynamic universe selections (to avoid recalculating every 5 minutes)
        self.universe_cache = {}
        
        # Risk management parameters
        self.max_position_size = 2000  # $2,000 per trade (2% of $100K)
        self.max_positions_per_strategy = 5
        self.max_portfolio_allocation = 0.20  # 20% max allocation to one stock
        
        # Equity snapshots file
        self.snapshots_file = os.path.join(
            os.path.dirname(__file__), '..', 'data', 'equity_snapshots.json'
        )

    def should_execute_strategy(self, strategy_id: int) -> bool:
        """Determine if a strategy should execute based on current time and schedule."""
        now = datetime.now()
        ny_time = now - timedelta(hours=5)  # Convert to ET (approximate)
        config = self.strategy_config[strategy_id]
        
        schedule = config['execution_schedule']
        
        if schedule == 'daily':
            # Execute once per day at specified time
            execution_time = config.get('execution_time', '09:45')
            hour, minute = map(int, execution_time.split(':'))
            
            # Check if we're within 5 minutes of execution time
            target_time = ny_time.replace(hour=hour, minute=minute, second=0, microsecond=0)
            time_diff = abs((ny_time - target_time).total_seconds())
            
            should_execute = time_diff <= 300  # Within 5 minutes
            if self.verbose:
                logger.debug(f"Strategy {strategy_id} daily check: target={target_time}, current={ny_time}, diff={time_diff}s, execute={should_execute}")
            return should_execute
            
        elif schedule == 'every_30min':
            # Execute every 30 minutes (at :00, :30)
            return ny_time.minute % 30 == 0
            
        elif schedule == 'weekly':
            # Execute weekly on specified day at specified time
            execution_day = config.get('execution_day', 'Monday')
            execution_time = config.get('execution_time', '10:00')
            
            day_mapping = {
                'Monday': 0, 'Tuesday': 1, 'Wednesday': 2, 'Thursday': 3,
                'Friday': 4, 'Saturday': 5, 'Sunday': 6
            }
            
            target_weekday = day_mapping.get(execution_day, 0)
            hour, minute = map(int, execution_time.split(':'))
            
            # Check if today is the right day and time
            is_right_day = ny_time.weekday() == target_weekday
            target_time = ny_time.replace(hour=hour, minute=minute, second=0, microsecond=0)
            time_diff = abs((ny_time - target_time).total_seconds())
            is_right_time = time_diff <= 300  # Within 5 minutes
            
            should_execute = is_right_day and is_right_time
            if self.verbose:
                logger.debug(f"Strategy {strategy_id} weekly check: day={ny_time.strftime('%A')} (target={execution_day}), time={ny_time.time()} (target={execution_time}), execute={should_execute}")
            return should_execute
            
        return True  # Default: always execute

    def get_cache_key(self, strategy_name: str) -> str:
        """Generate cache key for universe selection."""
        now = datetime.now()
        
        if strategy_name in ['momentum-hunter', 'volatility-breakout']:
            # Cache for the whole day (scanned once at 9:45am)
            return f"{strategy_name}_{now.strftime('%Y-%m-%d')}"
        elif strategy_name == 'mean-reversion':
            # Cache for 30 minutes
            half_hour = now.minute // 30
            return f"{strategy_name}_{now.strftime('%Y-%m-%d_%H')}_{half_hour}"
        elif strategy_name in ['sector-rotator', 'value-dividends']:
            # Cache for the whole week
            year_week = now.strftime('%Y-%W')
            return f"{strategy_name}_{year_week}"
        
        return f"{strategy_name}_{now.strftime('%Y-%m-%d_%H')}"

    def get_dynamic_universe(self, strategy_name: str) -> List[str]:
        """Get dynamically selected universe for a strategy."""
        cache_key = self.get_cache_key(strategy_name)
        
        # Check cache first
        if cache_key in self.universe_cache:
            if self.verbose:
                logger.debug(f"Using cached universe for {strategy_name}: {self.universe_cache[cache_key]}")
            return self.universe_cache[cache_key]
        
        logger.info(f"Calculating dynamic universe for {strategy_name}")
        
        try:
            if strategy_name == 'momentum-hunter':
                universe = self._select_momentum_hunter_universe()
            elif strategy_name == 'mean-reversion':
                universe = self._select_mean_reversion_universe()
            elif strategy_name == 'sector-rotator':
                universe = self._select_sector_rotator_universe()
            elif strategy_name == 'value-dividends':
                universe = self._select_value_dividends_universe()
            elif strategy_name == 'volatility-breakout':
                universe = self._select_volatility_breakout_universe()
            else:
                # Fallback to base universe
                universe = self.base_universes.get(strategy_name, [])
            
            # Cache the result
            self.universe_cache[cache_key] = universe
            logger.info(f"Selected {len(universe)} symbols for {strategy_name}: {universe}")
            return universe
            
        except Exception as e:
            logger.error(f"Error calculating dynamic universe for {strategy_name}: {e}")
            # Fallback to base universe
            fallback = self.base_universes.get(strategy_name, [])
            self.universe_cache[cache_key] = fallback
            return fallback

    def _select_momentum_hunter_universe(self) -> List[str]:
        """Select top 6 symbols by 20-day momentum score."""
        base_universe = self.base_universes['momentum-hunter']
        
        try:
            # Get 30 days of data for momentum calculation
            data = yf.download(base_universe, period='30d', progress=False)
            if 'Close' not in data.columns:
                return base_universe[:6]  # Fallback
            
            scores = {}
            for symbol in base_universe:
                try:
                    if isinstance(data['Close'], pd.DataFrame):
                        prices = data['Close'][symbol].dropna()
                        volumes = data['Volume'][symbol].dropna() if 'Volume' in data.columns else None
                    else:
                        prices = data['Close'].dropna()
                        volumes = data['Volume'].dropna() if 'Volume' in data.columns else None
                    
                    if len(prices) < 20:
                        continue
                    
                    # Calculate 20-day price momentum
                    price_momentum = (prices.iloc[-1] - prices.iloc[-20]) / prices.iloc[-20]
                    
                    # Calculate volume trend if available
                    volume_trend = 0
                    if volumes is not None and len(volumes) >= 20:
                        recent_vol = volumes.iloc[-5:].mean()
                        historic_vol = volumes.iloc[-20:-5].mean()
                        if historic_vol > 0:
                            volume_trend = (recent_vol - historic_vol) / historic_vol
                    
                    # Combined momentum score
                    momentum_score = price_momentum + (0.3 * volume_trend)
                    scores[symbol] = momentum_score
                    
                except Exception as e:
                    logger.warning(f"Error calculating momentum for {symbol}: {e}")
                    continue
            
            # Select top 6 by momentum score
            if scores:
                sorted_symbols = sorted(scores.items(), key=lambda x: x[1], reverse=True)
                selected = [symbol for symbol, score in sorted_symbols[:6]]
                logger.info(f"Momentum scores: {dict(sorted_symbols)}")
                return selected
            else:
                return base_universe[:6]  # Fallback
                
        except Exception as e:
            logger.error(f"Error in momentum hunter selection: {e}")
            return base_universe[:6]  # Fallback

    def _select_mean_reversion_universe(self) -> List[str]:
        """Select top 5 symbols with RSI < 35 or RSI > 68."""
        base_universe = self.base_universes['mean-reversion']
        
        try:
            # Get 50 days of data for RSI calculation
            data = yf.download(base_universe, period='50d', progress=False)
            if 'Close' not in data.columns:
                return base_universe[:5]  # Fallback
            
            candidates = []
            for symbol in base_universe:
                try:
                    if isinstance(data['Close'], pd.DataFrame):
                        prices = data['Close'][symbol].dropna()
                    else:
                        prices = data['Close'].dropna()
                    
                    if len(prices) < 30:
                        continue
                    
                    # Calculate RSI
                    rsi = self._calculate_rsi(prices, period=14)
                    if pd.isna(rsi):
                        continue
                    
                    # Filter for mean reversion opportunities
                    if rsi < 35 or rsi > 68:
                        # Calculate deviation magnitude (furthest from mean)
                        deviation = abs(rsi - 50)
                        candidates.append((symbol, deviation, rsi))
                        
                except Exception as e:
                    logger.warning(f"Error calculating RSI for {symbol}: {e}")
                    continue
            
            # Select top 5 by deviation magnitude
            if candidates:
                candidates.sort(key=lambda x: x[1], reverse=True)
                selected = [symbol for symbol, deviation, rsi in candidates[:5]]
                logger.info(f"Mean reversion candidates: {[(s, f'RSI={r:.1f}') for s, d, r in candidates[:5]]}")
                return selected
            else:
                return base_universe[:5]  # Fallback
                
        except Exception as e:
            logger.error(f"Error in mean reversion selection: {e}")
            return base_universe[:5]  # Fallback

    def _select_sector_rotator_universe(self) -> List[str]:
        """Select top 4 sectors by relative momentum vs SPY."""
        base_universe = self.base_universes['sector-rotator']
        
        try:
            # Get 60 days of data
            symbols_with_spy = base_universe + ['SPY'] if 'SPY' not in base_universe else base_universe
            data = yf.download(symbols_with_spy, period='60d', progress=False)
            if 'Close' not in data.columns:
                return base_universe[:4]  # Fallback
            
            scores = {}
            spy_returns = None
            
            # Calculate SPY returns for comparison
            try:
                if isinstance(data['Close'], pd.DataFrame):
                    spy_prices = data['Close']['SPY'].dropna()
                else:
                    spy_prices = data['Close'].dropna()
                
                if len(spy_prices) >= 20:
                    spy_returns = (spy_prices.iloc[-1] - spy_prices.iloc[-20]) / spy_prices.iloc[-20]
            except:
                spy_returns = 0  # Fallback
            
            for symbol in base_universe:
                if symbol == 'SPY':
                    continue  # Skip SPY itself for sector selection
                    
                try:
                    if isinstance(data['Close'], pd.DataFrame):
                        prices = data['Close'][symbol].dropna()
                    else:
                        prices = data['Close'].dropna()
                    
                    if len(prices) < 20:
                        continue
                    
                    # Calculate relative momentum vs SPY
                    sector_returns = (prices.iloc[-1] - prices.iloc[-20]) / prices.iloc[-20]
                    relative_momentum = sector_returns - (spy_returns if spy_returns is not None else 0)
                    scores[symbol] = relative_momentum
                    
                except Exception as e:
                    logger.warning(f"Error calculating sector momentum for {symbol}: {e}")
                    continue
            
            # Select top 4 sectors plus SPY and QQQ
            if scores:
                sorted_sectors = sorted(scores.items(), key=lambda x: x[1], reverse=True)
                selected = [symbol for symbol, score in sorted_sectors[:4]]
                # Always include SPY and QQQ
                for benchmark in ['SPY', 'QQQ']:
                    if benchmark not in selected and benchmark in base_universe:
                        selected.append(benchmark)
                logger.info(f"Sector momentum scores: {dict(sorted_sectors)}")
                return selected[:11]  # Limit to max universe size
            else:
                return base_universe[:4]  # Fallback
                
        except Exception as e:
            logger.error(f"Error in sector rotator selection: {e}")
            return base_universe[:4]  # Fallback

    def _select_value_dividends_universe(self) -> List[str]:
        """Select top 7 symbols by value score (RSI < 45 + price below 50-day SMA + low volatility)."""
        base_universe = self.base_universes['value-dividends']
        
        try:
            # Get 60 days of data
            data = yf.download(base_universe, period='60d', progress=False)
            if 'Close' not in data.columns:
                return base_universe[:7]  # Fallback
            
            scores = {}
            for symbol in base_universe:
                try:
                    if isinstance(data['Close'], pd.DataFrame):
                        prices = data['Close'][symbol].dropna()
                    else:
                        prices = data['Close'].dropna()
                    
                    if len(prices) < 50:
                        continue
                    
                    # Calculate RSI
                    rsi = self._calculate_rsi(prices, period=14)
                    if pd.isna(rsi):
                        continue
                    
                    # Calculate 50-day SMA
                    sma_50 = prices.rolling(window=50).mean().iloc[-1]
                    current_price = prices.iloc[-1]
                    
                    # Calculate volatility (20-day)
                    returns = prices.pct_change().dropna()
                    if len(returns) >= 20:
                        volatility = returns.rolling(window=20).std().iloc[-1] * np.sqrt(252)  # Annualized
                    else:
                        volatility = returns.std() * np.sqrt(252)
                    
                    # Value score calculation
                    value_score = 0
                    
                    # RSI component (higher score for lower RSI, up to 45)
                    if rsi < 45:
                        value_score += (45 - rsi) / 45  # Normalized to 0-1
                    
                    # Price below SMA component
                    if current_price < sma_50:
                        value_score += (sma_50 - current_price) / sma_50
                    
                    # Low volatility component (inverse volatility, capped)
                    if volatility > 0:
                        vol_score = max(0, 1 - (volatility / 0.5))  # Normalize around 50% annual vol
                        value_score += vol_score * 0.5  # Weight volatility component
                    
                    scores[symbol] = value_score
                    
                except Exception as e:
                    logger.warning(f"Error calculating value score for {symbol}: {e}")
                    continue
            
            # Select top 7 by value score
            if scores:
                sorted_symbols = sorted(scores.items(), key=lambda x: x[1], reverse=True)
                selected = [symbol for symbol, score in sorted_symbols[:7]]
                logger.info(f"Value scores: {dict(sorted_symbols)}")
                return selected
            else:
                return base_universe[:7]  # Fallback
                
        except Exception as e:
            logger.error(f"Error in value dividends selection: {e}")
            return base_universe[:7]  # Fallback

    def _select_volatility_breakout_universe(self) -> List[str]:
        """Select top 5 symbols with high volume and volatility."""
        base_universe = self.base_universes['volatility-breakout']
        
        try:
            # Get 30 days of data
            data = yf.download(base_universe, period='30d', progress=False)
            if 'Close' not in data.columns or 'Volume' not in data.columns:
                return base_universe[:5]  # Fallback
            
            candidates = []
            for symbol in base_universe:
                try:
                    if isinstance(data['Close'], pd.DataFrame):
                        prices = data['Close'][symbol].dropna()
                        volumes = data['Volume'][symbol].dropna()
                    else:
                        prices = data['Close'].dropna()
                        volumes = data['Volume'].dropna()
                    
                    if len(prices) < 20 or len(volumes) < 20:
                        continue
                    
                    # Check volume filter: yesterday's volume > 1.5x 20-day avg
                    avg_volume_20d = volumes.iloc[-21:-1].mean()  # Exclude today
                    yesterday_volume = volumes.iloc[-2]  # Yesterday
                    
                    if yesterday_volume <= avg_volume_20d * 1.5:
                        continue  # Skip if volume not elevated
                    
                    # Calculate ATR percentage
                    highs = data['High'][symbol].dropna() if isinstance(data['High'], pd.DataFrame) else data['High'].dropna()
                    lows = data['Low'][symbol].dropna() if isinstance(data['Low'], pd.DataFrame) else data['Low'].dropna()
                    
                    if len(highs) >= 14 and len(lows) >= 14:
                        tr1 = highs - lows
                        tr2 = (highs - prices.shift(1)).abs()
                        tr3 = (lows - prices.shift(1)).abs()
                        
                        true_range = pd.concat([tr1, tr2, tr3], axis=1).max(axis=1)
                        atr = true_range.rolling(window=14).mean().iloc[-1]
                        atr_percentage = (atr / prices.iloc[-1]) * 100
                        
                        candidates.append((symbol, atr_percentage))
                    
                except Exception as e:
                    logger.warning(f"Error calculating volatility breakout score for {symbol}: {e}")
                    continue
            
            # Select top 5 by ATR percentage
            if candidates:
                candidates.sort(key=lambda x: x[1], reverse=True)
                selected = [symbol for symbol, atr_pct in candidates[:5]]
                logger.info(f"Volatility breakout candidates: {[(s, f'ATR%={a:.2f}') for s, a in candidates[:5]]}")
                return selected
            else:
                return base_universe[:5]  # Fallback
                
        except Exception as e:
            logger.error(f"Error in volatility breakout selection: {e}")
            return base_universe[:5]  # Fallback

    def _calculate_rsi(self, prices: pd.Series, period: int = 14) -> float:
        """Calculate RSI for a price series."""
        try:
            delta = prices.diff()
            gain = delta.where(delta > 0, 0).rolling(window=period).mean()
            loss = (-delta.where(delta < 0, 0)).rolling(window=period).mean()
            rs = gain / loss
            rsi = 100 - (100 / (1 + rs))
            return rsi.iloc[-1] if not pd.isna(rsi.iloc[-1]) else 50.0
        except:
            return 50.0  # Fallback neutral RSI

    def get_market_data(self, symbols: List[str], timeframe: str = '5Min', days: int = 60) -> Optional[pd.DataFrame]:
        """Get market data with specified timeframe."""
        try:
            if timeframe == '5Min':
                # For 5-minute data, we'll get intraday data
                # Note: yfinance doesn't directly support 5Min intervals for all symbols
                # For now, we'll use 1-minute data and resample, or use daily data
                # In a real implementation, you'd use the Alpaca API for 5-minute bars
                period = '5d'  # Get last 5 days for intraday
                interval = '5m'
            else:
                # Daily data
                period = f'{days}d'
                interval = '1d'
            
            data = yf.download(symbols, period=period, interval=interval, progress=False)
            
            if data.empty:
                logger.warning(f"No data retrieved for symbols: {symbols}")
                return None
            
            return data
            
        except Exception as e:
            logger.error(f"Error getting market data: {e}")
            return None

    def record_equity_snapshot(self, trades_executed: List[Dict[str, Any]] = None) -> bool:
        """Record portfolio snapshots and trades to file."""
        try:
            timestamp = datetime.now().isoformat()
            
            # Get current positions from Alpaca
            positions = self.get_alpaca_positions()
            account = self.alpaca.get_account()
            
            # Group positions by strategy (simplified - would need better tracking in real implementation)
            strategy_snapshots = {}
            
            for strategy_id, config in self.strategy_config.items():
                strategy_name = config['name']
                strategy_positions = {}
                strategy_cash = 0
                strategy_value = 0
                
                # For now, we'll estimate strategy allocation
                # In a real implementation, you'd track this properly
                total_value = float(account.get('portfolio_value', 0))
                strategy_value = total_value / len(self.strategy_config)  # Equal allocation estimate
                
                strategy_snapshots[strategy_name] = {
                    'value': round(strategy_value, 2),
                    'cash': round(float(account.get('cash', 0)) / len(self.strategy_config), 2),
                    'positions_value': round(strategy_value - (float(account.get('cash', 0)) / len(self.strategy_config)), 2)
                }
            
            # Create snapshot entry
            snapshot_entry = {
                'timestamp': timestamp,
                'snapshots': strategy_snapshots
            }
            
            # Add trades if any were executed
            if trades_executed:
                snapshot_entry['trades'] = trades_executed
            
            # Load existing snapshots
            snapshots = []
            if os.path.exists(self.snapshots_file):
                try:
                    with open(self.snapshots_file, 'r') as f:
                        snapshots = json.load(f)
                        if not isinstance(snapshots, list):
                            snapshots = []
                except json.JSONDecodeError:
                    snapshots = []
            
            # Append new snapshot
            snapshots.append(snapshot_entry)
            
            # Keep only last 1000 snapshots (approximately 3.5 days at 5-min intervals)
            if len(snapshots) > 1000:
                snapshots = snapshots[-1000:]
            
            # Save back to file
            with open(self.snapshots_file, 'w') as f:
                json.dump(snapshots, f, indent=2)
            
            logger.info(f"Equity snapshot recorded: {len(strategy_snapshots)} strategies, total value: ${total_value:.2f}")
            return True
            
        except Exception as e:
            logger.error(f"Error recording equity snapshot: {e}")
            return False

    def check_market_status(self) -> bool:
        """Check if the market is currently open using Alpaca API."""
        try:
            clock_url = f"{config.ALPACA_BASE_URL}/clock"
            headers = config.get_api_headers()
            response = requests.get(clock_url, headers=headers)
            response.raise_for_status()
            
            clock_data = response.json()
            is_open = clock_data.get('is_open', False)
            next_open = clock_data.get('next_open', '')
            next_close = clock_data.get('next_close', '')
            
            logger.info(f"Market status - Open: {is_open}")
            if self.verbose:
                if next_open:
                    logger.debug(f"Next open: {next_open}")
                if next_close:
                    logger.debug(f"Next close: {next_close}")
                
            return is_open
            
        except Exception as e:
            logger.error(f"Error checking market status: {e}")
            return False
    
    def get_alpaca_positions(self) -> Dict[str, Any]:
        """Get current positions from Alpaca paper account."""
        try:
            positions = self.alpaca.get_positions()
            position_dict = {}
            
            for position in positions:
                symbol = position.get('symbol')
                qty = float(position.get('qty', 0))
                if qty > 0:  # Only track long positions
                    position_dict[symbol] = {
                        'quantity': qty,
                        'avg_cost': float(position.get('avg_cost', 0)),
                        'market_value': float(position.get('market_value', 0)),
                        'unrealized_pl': float(position.get('unrealized_pl', 0))
                    }
            
            logger.info(f"Current Alpaca positions: {len(position_dict)} symbols")
            return position_dict
            
        except Exception as e:
            logger.error(f"Error getting Alpaca positions: {e}")
            return {}
    
    def calculate_position_size(self, price: float, strategy_id: int) -> int:
        """Calculate the number of shares to buy based on risk management rules."""
        # Base position size: $2,000 (2% of $100K)
        position_value = self.max_position_size
        
        # Calculate number of shares
        shares = int(position_value / price)
        
        # Ensure minimum 1 share
        return max(1, shares)
    
    def execute_alpaca_trade(
        self, 
        strategy_id: int, 
        symbol: str, 
        action: str, 
        quantity: int, 
        price: float, 
        reason: str
    ) -> Optional[Dict[str, Any]]:
        """Execute a trade on Alpaca paper account."""
        if self.dry_run:
            logger.info(f"DRY RUN - Would execute: {action} {quantity} {symbol} @ ${price:.2f} - {reason}")
            return {
                'id': f'dry_run_{datetime.now().timestamp()}',
                'symbol': symbol,
                'side': action,
                'qty': quantity,
                'filled_avg_price': price,
                'status': 'filled'
            }
        
        try:
            # Create client_order_id with strategy name and timestamp
            strategy_name = self.strategy_config[strategy_id]['name']
            timestamp = int(datetime.now().timestamp())
            client_order_id = f"{strategy_name}_{action}_{symbol}_{timestamp}"
            
            # Place the order
            order_data = {
                'symbol': symbol,
                'qty': quantity,
                'side': action,
                'type': 'market',
                'time_in_force': 'day',
                'client_order_id': client_order_id
            }
            
            order_url = f"{config.ALPACA_BASE_URL}/orders"
            headers = config.get_api_headers()
            
            logger.info(f"Placing order: {action} {quantity} {symbol} @ market (client_order_id: {client_order_id})")
            response = requests.post(order_url, headers=headers, json=order_data)
            response.raise_for_status()
            
            order = response.json()
            
            logger.info(f"Order placed successfully: {order.get('id')} - {action} {quantity} {symbol}")
            logger.info(f"Reason: {reason}")
            
            return order
            
        except Exception as e:
            logger.error(f"Error executing trade on Alpaca: {e}")
            return None

    def run_strategy_execution(self) -> Dict[str, Any]:
        """Run strategies with 5-minute granularity and dynamic universe selection."""
        logger.info("="*60)
        logger.info("STARTING ENHANCED TRADING EXECUTION")
        logger.info("="*60)
        
        # Check market status first
        if not self.check_market_status():
            logger.info("Market is closed. Recording snapshot and exiting gracefully.")
            self.record_equity_snapshot()
            return {
                'success': True,
                'message': 'Market is closed',
                'trades_executed': 0,
                'strategies_run': 0
            }
        
        logger.info("Market is OPEN - proceeding with strategy execution")
        
        # Get current Alpaca positions for risk management
        current_positions = self.get_alpaca_positions()
        logger.info(f"Current portfolio has {len(current_positions)} positions")
        
        total_trades = 0
        strategy_results = {}
        executed_trades = []
        
        # Check each strategy for execution
        for strategy_id in range(1, 6):
            config = self.strategy_config[strategy_id]
            strategy_name = config['name']
            
            logger.info(f"\n--- Checking Strategy {strategy_id} ({strategy_name}) ---")
            
            # Check if this strategy should execute now
            should_execute = self.should_execute_strategy(strategy_id)
            if not should_execute:
                if self.verbose:
                    logger.debug(f"Strategy {strategy_id} not scheduled to execute now")
                strategy_results[f'strategy_{strategy_id}'] = {
                    'name': strategy_name,
                    'skipped': True,
                    'reason': 'Not scheduled for execution',
                    'trades_executed': 0
                }
                continue
            
            logger.info(f"Executing strategy {strategy_id} ({strategy_name})")
            
            try:
                # Get dynamic universe for this strategy
                universe = self.get_dynamic_universe(strategy_name)
                
                if not universe:
                    logger.warning(f"Empty universe for strategy {strategy_id}")
                    continue
                
                # Get market data with appropriate timeframe
                timeframe = config['timeframe']
                data = self.get_market_data(universe, timeframe=timeframe)
                
                if data is None or data.empty:
                    logger.warning(f"No market data for strategy {strategy_id}")
                    continue
                
                # Generate signals (simplified - in real implementation, use proper strategy logic)
                signals = self.generate_strategy_signals(strategy_id, strategy_name, universe, data)
                
                logger.info(f"Generated {len(signals)} signals for {strategy_name}")
                
                strategy_trades = 0
                
                # Execute trades for signals
                for signal in signals:
                    symbol = signal['symbol']
                    action = signal['action']
                    price = signal['price']
                    reason = signal['reason']
                    confidence = signal.get('confidence', 0.7)
                    
                    logger.info(f"Processing signal: {action} {symbol} @ ${price:.2f} (confidence: {confidence:.3f})")
                    
                    # Risk management checks
                    if action == 'buy':
                        # Check if already holding this position
                        if symbol in current_positions:
                            if self.verbose:
                                logger.debug(f"Already holding {symbol}, skipping buy signal")
                            continue
                        
                        # Calculate position size
                        quantity = self.calculate_position_size(price, strategy_id)
                        
                    elif action == 'sell':
                        # Check if we have this position
                        if symbol not in current_positions:
                            if self.verbose:
                                logger.debug(f"No position in {symbol}, skipping sell signal")
                            continue
                        
                        # Use current position size
                        quantity = int(current_positions[symbol]['quantity'])
                    
                    else:
                        logger.warning(f"Unknown action: {action}")
                        continue
                    
                    # Execute the trade on Alpaca
                    order = self.execute_alpaca_trade(
                        strategy_id, symbol, action, quantity, price, reason
                    )
                    
                    if order:
                        # Track the trade
                        trade_record = {
                            'strategy_id': strategy_id,
                            'strategy_name': strategy_name,
                            'symbol': symbol,
                            'action': action,
                            'quantity': quantity,
                            'price': price,
                            'reason': reason,
                            'confidence': confidence,
                            'order_id': order.get('id'),
                            'timestamp': datetime.now().isoformat()
                        }
                        executed_trades.append(trade_record)
                        
                        # Update our position tracking
                        if action == 'buy':
                            current_positions[symbol] = {
                                'quantity': quantity,
                                'avg_cost': price,
                                'market_value': quantity * price,
                                'unrealized_pl': 0
                            }
                        elif action == 'sell' and symbol in current_positions:
                            del current_positions[symbol]
                        
                        strategy_trades += 1
                        total_trades += 1
                        
                        logger.info(f"✓ Trade executed: {action} {quantity} {symbol} @ ${price:.2f}")
                    else:
                        logger.error(f"✗ Failed to execute trade: {action} {quantity} {symbol}")
                
                strategy_results[f'strategy_{strategy_id}'] = {
                    'name': strategy_name,
                    'universe_size': len(universe),
                    'signals_generated': len(signals),
                    'trades_executed': strategy_trades,
                    'success': True
                }
                
                logger.info(f"Strategy {strategy_id} complete: {strategy_trades} trades executed")
                
            except Exception as e:
                logger.error(f"Error executing strategy {strategy_id}: {e}")
                strategy_results[f'strategy_{strategy_id}'] = {
                    'name': strategy_name,
                    'success': False,
                    'error': str(e)
                }
        
        # Record equity snapshot with executed trades
        self.record_equity_snapshot(executed_trades)
        
        # Final summary
        logger.info("\n" + "="*60)
        logger.info("EXECUTION SUMMARY")
        logger.info("="*60)
        logger.info(f"Total trades executed: {total_trades}")
        logger.info(f"Current positions: {len(current_positions)}")
        
        for strategy_id, result in strategy_results.items():
            if result.get('success'):
                if result.get('skipped'):
                    logger.info(f"{result['name']}: SKIPPED - {result['reason']}")
                else:
                    logger.info(f"{result['name']}: {result['trades_executed']} trades")
            else:
                logger.info(f"{strategy_id}: FAILED - {result.get('error')}")
        
        return {
            'success': True,
            'timestamp': datetime.now().isoformat(),
            'trades_executed': total_trades,
            'strategies_run': len([r for r in strategy_results.values() if r.get('success') and not r.get('skipped')]),
            'strategy_results': strategy_results,
            'executed_trades': executed_trades,
            'final_position_count': len(current_positions)
        }

    def generate_strategy_signals(
        self, 
        strategy_id: int, 
        strategy_name: str, 
        universe: List[str], 
        data: pd.DataFrame
    ) -> List[Dict[str, Any]]:
        """Generate trading signals for a strategy (simplified implementation)."""
        signals = []
        
        try:
            # Get current prices
            if isinstance(data.get('Close'), pd.DataFrame):
                current_prices = data['Close'].iloc[-1]
            else:
                # Single symbol
                current_prices = {universe[0]: data['Close'].iloc[-1]}
            
            # Simple signal generation based on strategy type
            for symbol in universe:
                try:
                    if symbol not in current_prices:
                        continue
                        
                    price = current_prices[symbol]
                    if pd.isna(price):
                        continue
                    
                    # Generate a sample signal (in real implementation, use proper strategy logic)
                    if strategy_name == 'momentum-hunter':
                        # Simple momentum signal: buy if price > 20-day MA
                        if isinstance(data['Close'], pd.DataFrame):
                            prices = data['Close'][symbol].dropna()
                        else:
                            prices = data['Close'].dropna()
                        
                        if len(prices) >= 20:
                            ma_20 = prices.rolling(window=20).mean().iloc[-1]
                            if price > ma_20:
                                signals.append({
                                    'symbol': symbol,
                                    'action': 'buy',
                                    'price': price,
                                    'confidence': 0.7,
                                    'reason': f'Price ${price:.2f} above 20-day MA ${ma_20:.2f}'
                                })
                    
                    elif strategy_name == 'mean-reversion':
                        # Simple mean reversion: buy if RSI < 35, sell if RSI > 70
                        if isinstance(data['Close'], pd.DataFrame):
                            prices = data['Close'][symbol].dropna()
                        else:
                            prices = data['Close'].dropna()
                        
                        if len(prices) >= 30:
                            rsi = self._calculate_rsi(prices)
                            if rsi < 35:
                                signals.append({
                                    'symbol': symbol,
                                    'action': 'buy',
                                    'price': price,
                                    'confidence': 0.75,
                                    'reason': f'Oversold RSI: {rsi:.1f}'
                                })
                            elif rsi > 70:
                                signals.append({
                                    'symbol': symbol,
                                    'action': 'sell',
                                    'price': price,
                                    'confidence': 0.75,
                                    'reason': f'Overbought RSI: {rsi:.1f}'
                                })
                    
                    # Add other strategy signal logic here...
                    
                except Exception as e:
                    logger.warning(f"Error generating signal for {symbol}: {e}")
                    continue
            
        except Exception as e:
            logger.error(f"Error generating signals for {strategy_name}: {e}")
        
        return signals

    def get_status(self) -> Dict[str, Any]:
        """Get comprehensive trading status."""
        try:
            # Market status
            market_open = self.check_market_status()
            
            # Alpaca account info
            account = self.alpaca.get_account()
            positions = self.get_alpaca_positions()
            
            # Strategy execution status
            now = datetime.now()
            execution_status = {}
            
            for strategy_id, config in self.strategy_config.items():
                should_execute = self.should_execute_strategy(strategy_id)
                cache_key = self.get_cache_key(config['name'])
                has_cached_universe = cache_key in self.universe_cache
                
                execution_status[f'strategy_{strategy_id}'] = {
                    'name': config['name'],
                    'timeframe': config['timeframe'],
                    'schedule': config['execution_schedule'],
                    'should_execute_now': should_execute,
                    'has_cached_universe': has_cached_universe,
                    'universe_size': len(self.universe_cache.get(cache_key, [])) if has_cached_universe else 0
                }
            
            return {
                'timestamp': now.isoformat(),
                'market_open': market_open,
                'account': {
                    'portfolio_value': float(account.get('portfolio_value', 0)),
                    'buying_power': float(account.get('buying_power', 0)),
                    'cash': float(account.get('cash', 0)),
                    'equity': float(account.get('equity', 0))
                },
                'positions': positions,
                'position_count': len(positions),
                'strategies': execution_status,
                'universe_cache_size': len(self.universe_cache)
            }
            
        except Exception as e:
            logger.error(f"Error getting status: {e}")
            return {'error': str(e)}


def main():
    """Main entry point."""
    parser = argparse.ArgumentParser(description='Enhanced Automated Trading Execution')
    parser.add_argument('--dry-run', action='store_true', 
                       help='Simulate trading without executing real orders')
    parser.add_argument('--status', action='store_true',
                       help='Show current trading status')
    parser.add_argument('--verbose', action='store_true',
                       help='Enable verbose logging')
    parser.add_argument('--market-check', action='store_true',
                       help='Only check market status')
    
    args = parser.parse_args()
    
    executor = TradingExecutor(dry_run=args.dry_run, verbose=args.verbose)
    
    if args.status:
        status = executor.get_status()
        print(json.dumps(status, indent=2))
        
    elif args.market_check:
        is_open = executor.check_market_status()
        print(f"Market is {'OPEN' if is_open else 'CLOSED'}")
        
    else:
        # Run the main trading execution
        if args.dry_run:
            logger.info("RUNNING IN DRY-RUN MODE - No real trades will be executed")
        
        if args.verbose:
            logger.info("VERBOSE MODE ENABLED")
        
        result = executor.run_strategy_execution()
        print(json.dumps(result, indent=2))


if __name__ == "__main__":
    main()