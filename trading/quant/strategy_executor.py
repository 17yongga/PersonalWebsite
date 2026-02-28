#!/usr/bin/env python3
"""
Strategy Execution Engine for 5 Trading Strategies

Executes the following strategies with real Alpaca market data:
1. Momentum Hunter - Top 20 S&P 500 with momentum signals
2. Mean Reversion - Top 20 S&P 500 with mean reversion 
3. Sector Rotator - 11 SPDR sector ETFs with momentum rotation
4. Value & Dividends - High-dividend stocks with RSI signals
5. Volatility Breakout - High-beta stocks with breakout signals
"""

import os
import sys
import json
import logging
import sqlite3
import requests
import numpy as np
import pandas as pd
from datetime import datetime, timedelta
from typing import Dict, List, Optional, Any, Tuple
import ta

# Add the project root to Python path
sys.path.append(os.path.dirname(os.path.abspath(__file__)))

from alpaca_client import client
import config

# Configure logging
logging.basicConfig(
    level=getattr(logging, config.LOG_LEVEL),
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
    handlers=[
        logging.FileHandler(config.LOG_FILE),
        logging.StreamHandler()
    ]
)
logger = logging.getLogger(__name__)

class StrategyExecutor:
    """Main strategy execution engine."""
    
    def __init__(self):
        self.alpaca = client
        self.db_path = os.path.join(os.path.dirname(__file__), '../server/data/trading.db')
        self.api_base = "https://api.gary-yong.com/api/v1"
        self.api_fallback = "http://localhost:3005/api/v1"
        
        # Strategy definitions - Direction B: Real Alpaca execution with $20K per strategy
        self.strategies = {
            1: {
                'name': 'Momentum Hunter',
                'slug': 'mh',  # For client_order_id prefix
                'type': 'momentum_hunter',
                'universe': ['AAPL', 'MSFT', 'GOOGL', 'NVDA', 'META', 'TSLA', 'AMZN', 'JPM', 'V', 'MA'],
                'max_positions': 8,
                'initial_capital': 20000
            },
            2: {
                'name': 'Mean Reversion',
                'slug': 'mr',  # For client_order_id prefix
                'type': 'mean_reversion', 
                'universe': ['AAPL', 'MSFT', 'GOOGL', 'NVDA', 'META', 'TSLA', 'AMZN', 'JPM', 'V', 'MA'],
                'max_positions': 6,
                'initial_capital': 20000
            },
            3: {
                'name': 'Sector Rotator',
                'slug': 'sr',  # For client_order_id prefix
                'type': 'sector_rotator',
                'universe': ['XLK', 'XLF', 'XLE', 'XLV', 'XLI', 'XLP', 'XLU', 'XLY', 'XLC', 'XLRE', 'XLB'],
                'max_positions': 3,
                'initial_capital': 20000
            },
            4: {
                'name': 'Value & Dividends',
                'slug': 'vd',  # For client_order_id prefix
                'type': 'value_dividends',
                'universe': ['VZ', 'T', 'KO', 'PEP', 'PG', 'JNJ', 'XOM', 'CVX', 'ABBV', 'PFE', 'IBM', 'MMM'],
                'max_positions': 10,
                'initial_capital': 20000
            },
            5: {
                'name': 'Volatility Breakout',
                'slug': 'vb',  # For client_order_id prefix
                'type': 'volatility_breakout',
                'universe': ['TSLA', 'NVDA', 'AMD', 'COIN', 'MSTR', 'SQ', 'SHOP', 'ROKU', 'PLTR', 'SNAP'],
                'max_positions': 6,
                'initial_capital': 20000
            }
        }
        
    def _get_sp500_top20(self):
        """Get top 20 S&P 500 stocks by market cap."""
        return ['AAPL', 'MSFT', 'GOOGL', 'AMZN', 'NVDA', 'META', 'TSLA', 'BRK.B', 
                'UNH', 'JNJ', 'V', 'XOM', 'WMT', 'JPM', 'PG', 'MA', 'HD', 'CVX', 'ABBV', 'PFE']
    
    def get_historical_data(self, symbols: List[str], days: int = 60) -> Dict[str, pd.DataFrame]:
        """Fetch historical data for symbols."""
        end_date = datetime.now().strftime('%Y-%m-%d')
        start_date = (datetime.now() - timedelta(days=days)).strftime('%Y-%m-%d')
        
        try:
            data = self.alpaca.get_historical_bars(
                symbols=symbols,
                timeframe='1Day',
                start=start_date,
                end=end_date,
                limit=1000
            )
            
            result = {}
            for symbol in symbols:
                bars = data.get('bars', {}).get(symbol, [])
                if bars:
                    df = pd.DataFrame(bars)
                    df['timestamp'] = pd.to_datetime(df['t'])  # 't' is the timestamp field from Alpaca
                    df.set_index('timestamp', inplace=True)
                    df = df.rename(columns={'c': 'close', 'o': 'open', 'h': 'high', 'l': 'low', 'v': 'volume'})
                    result[symbol] = df
                else:
                    logger.warning(f"No data available for {symbol}")
            
            return result
        except Exception as e:
            logger.error(f"Error fetching historical data: {e}")
            return {}
    
    def get_latest_prices(self, symbols: List[str]) -> Dict[str, float]:
        """Get latest prices for symbols."""
        try:
            quotes = self.alpaca.get_latest_quotes(symbols)
            prices = {}
            for symbol in symbols:
                quote = quotes.get('quotes', {}).get(symbol, {})
                if quote:
                    # Use bid-ask midpoint
                    bid = quote.get('bp', 0)
                    ask = quote.get('ap', 0)
                    if bid > 0 and ask > 0:
                        prices[symbol] = (bid + ask) / 2
                    else:
                        prices[symbol] = quote.get('bp', quote.get('ap', 0))
            return prices
        except Exception as e:
            logger.error(f"Error fetching latest prices: {e}")
            return {}
    
    def place_real_order(self, strategy_id: int, symbol: str, side: str, qty: int, price: float, reason: str) -> Tuple[bool, Optional[Dict]]:
        """Place a real Alpaca order with strategy prefix in client_order_id."""
        import time
        
        if strategy_id not in self.strategies:
            logger.error(f"Unknown strategy ID: {strategy_id}")
            return False, None
        
        strategy = self.strategies[strategy_id]
        strategy_slug = strategy['slug']
        client_order_id = f"{strategy_slug}-{symbol}-{int(time.time())}"
        
        try:
            result = self.alpaca.place_order(
                symbol=symbol,
                qty=qty,
                side=side,
                order_type='market',
                time_in_force='day',
                client_order_id=client_order_id
            )
            logger.info(f"Alpaca order placed: {client_order_id} — {reason}")
            return True, result
        except Exception as e:
            logger.error(f"Order failed for {strategy['name']}: {e}")
            return False, None
    
    def get_alpaca_positions_for_strategy(self, strategy_id: int) -> Dict[str, Dict]:
        """Get current Alpaca positions for a specific strategy based on order history."""
        if strategy_id not in self.strategies:
            return {}
        
        strategy = self.strategies[strategy_id]
        strategy_slug = strategy['slug']
        
        try:
            # Get all filled orders for this strategy
            orders = self.alpaca.get_orders_by_client_prefix(strategy_slug, status='filled')
            
            # Calculate net positions from order history
            positions = {}
            for order in orders:
                symbol = order.get('symbol')
                side = order.get('side')
                qty = float(order.get('filled_qty', 0))
                fill_price = float(order.get('filled_avg_price', 0))
                
                if symbol not in positions:
                    positions[symbol] = {'quantity': 0, 'total_cost': 0}
                
                if side == 'buy':
                    positions[symbol]['quantity'] += qty
                    positions[symbol]['total_cost'] += qty * fill_price
                elif side == 'sell':
                    positions[symbol]['quantity'] -= qty
                    # For sells, we don't adjust total_cost (keep original cost basis)
            
            # Calculate average cost basis and filter out zero positions
            final_positions = {}
            for symbol, pos in positions.items():
                if pos['quantity'] > 0:
                    avg_cost = pos['total_cost'] / pos['quantity'] if pos['quantity'] > 0 else 0
                    final_positions[symbol] = {
                        'quantity': pos['quantity'],
                        'avg_cost_basis': avg_cost,
                        'updated_at': datetime.now().isoformat()
                    }
            
            return final_positions
        except Exception as e:
            logger.error(f"Error getting Alpaca positions for strategy {strategy_id}: {e}")
            return {}
    
    def execute_trade_via_api(self, strategy_id: int, symbol: str, side: str, quantity: int, price: float, reason: str) -> bool:
        """Execute a virtual trade via the trading server API."""
        trade_data = {
            "symbol": symbol,
            "side": side,
            "quantity": quantity,
            "price": price,
            "reason": reason
        }
        
        # Try main API first, then fallback
        for api_url in [self.api_base, self.api_fallback]:
            try:
                url = f"{api_url}/dashboard/strategies/{strategy_id}/trade"
                response = requests.post(url, json=trade_data, timeout=10)
                if response.status_code == 200:
                    logger.info(f"Trade executed via API: {side} {quantity} {symbol} @ ${price:.2f}")
                    return True
                elif response.status_code == 404:
                    logger.warning(f"API endpoint not found at {api_url}")
                    continue
                else:
                    logger.warning(f"API returned {response.status_code}: {response.text}")
                    continue
            except requests.exceptions.RequestException as e:
                logger.warning(f"API request failed for {api_url}: {e}")
                continue
        
        # Fallback to direct database write
        logger.info("API unavailable, falling back to direct database write")
        return self.execute_trade_via_db(strategy_id, symbol, side, quantity, price, reason)
    
    def execute_trade_via_db(self, strategy_id: int, symbol: str, side: str, quantity: int, price: float, reason: str) -> bool:
        """Execute a virtual trade via direct database write."""
        try:
            conn = sqlite3.connect(self.db_path)
            cursor = conn.cursor()
            
            # Get portfolio_id for this strategy
            cursor.execute("SELECT portfolio_id FROM strategies WHERE id = ?", (strategy_id,))
            result = cursor.fetchone()
            if not result:
                logger.error(f"Strategy {strategy_id} not found")
                return False
            
            portfolio_id = result[0]
            total = quantity * price
            
            # Insert order
            cursor.execute("""
                INSERT INTO orders (portfolio_id, symbol, side, type, quantity, fill_price, status, source)
                VALUES (?, ?, ?, 'market', ?, ?, 'filled', 'strategy')
            """, (portfolio_id, symbol, side, quantity, price))
            order_id = cursor.lastrowid
            
            # Insert transaction
            cursor.execute("""
                INSERT INTO transactions (portfolio_id, order_id, symbol, side, quantity, price, total)
                VALUES (?, ?, ?, ?, ?, ?, ?)
            """, (portfolio_id, order_id, symbol, side, quantity, price, total))
            
            # Update position
            if side == 'buy':
                cursor.execute("""
                    INSERT OR REPLACE INTO positions (portfolio_id, symbol, quantity, avg_cost_basis, updated_at)
                    VALUES (?, ?, 
                        COALESCE((SELECT quantity FROM positions WHERE portfolio_id = ? AND symbol = ?), 0) + ?,
                        (COALESCE((SELECT quantity * avg_cost_basis FROM positions WHERE portfolio_id = ? AND symbol = ?), 0) + ?) / 
                        (COALESCE((SELECT quantity FROM positions WHERE portfolio_id = ? AND symbol = ?), 0) + ?),
                        CURRENT_TIMESTAMP)
                """, (portfolio_id, symbol, portfolio_id, symbol, quantity, 
                     portfolio_id, symbol, total, portfolio_id, symbol, quantity))
            else:  # sell
                cursor.execute("""
                    UPDATE positions 
                    SET quantity = quantity - ?, updated_at = CURRENT_TIMESTAMP
                    WHERE portfolio_id = ? AND symbol = ?
                """, (quantity, portfolio_id, symbol))
                
                # Remove position if quantity is 0 or negative
                cursor.execute("""
                    DELETE FROM positions WHERE portfolio_id = ? AND symbol = ? AND quantity <= 0
                """, (portfolio_id, symbol))
            
            # Update cash balance
            cash_change = -total if side == 'buy' else total
            cursor.execute("""
                UPDATE portfolios 
                SET cash_balance = cash_balance + ?
                WHERE id = ?
            """, (cash_change, portfolio_id))
            
            conn.commit()
            conn.close()
            
            logger.info(f"Trade executed via DB: {side} {quantity} {symbol} @ ${price:.2f} - {reason}")
            return True
            
        except Exception as e:
            logger.error(f"Error executing trade via DB: {e}")
            if 'conn' in locals():
                conn.rollback()
                conn.close()
            return False
    
    def update_prices_via_api(self, strategy_id: int, prices: Dict[str, float]) -> bool:
        """Update position prices via API."""
        for api_url in [self.api_base, self.api_fallback]:
            try:
                url = f"{api_url}/dashboard/strategies/{strategy_id}/update-prices"
                response = requests.post(url, json={"prices": prices}, timeout=10)
                if response.status_code == 200:
                    return True
            except requests.exceptions.RequestException:
                continue
        return False
    
    def take_snapshot_via_api(self, strategy_id: int) -> bool:
        """Take a portfolio snapshot via API."""
        for api_url in [self.api_base, self.api_fallback]:
            try:
                url = f"{api_url}/dashboard/strategies/{strategy_id}/snapshot"
                response = requests.post(url, timeout=10)
                if response.status_code == 200:
                    return True
            except requests.exceptions.RequestException:
                continue
        return False
    
    def get_current_positions(self, strategy_id: int) -> Dict[str, Dict]:
        """Get current positions for a strategy from Alpaca."""
        return self.get_alpaca_positions_for_strategy(strategy_id)
    
    def momentum_hunter_signals(self, data: Dict[str, pd.DataFrame]) -> List[Dict]:
        """
        Momentum Hunter Strategy Logic:
        Buy: price > 20-day EMA AND RSI > 50 AND MACD histogram > 0
        Sell: price < 20-day EMA OR RSI < 40
        """
        signals = []
        
        for symbol, df in data.items():
            if len(df) < 50:  # Need enough data
                continue
            
            try:
                # Calculate indicators
                df['ema20'] = ta.trend.EMAIndicator(df['close'], window=20).ema_indicator()
                df['rsi'] = ta.momentum.RSIIndicator(df['close'], window=14).rsi()
                macd = ta.trend.MACD(df['close'])
                df['macd_histogram'] = macd.macd_diff()
                
                latest = df.iloc[-1]
                price = latest['close']
                ema20 = latest['ema20']
                rsi = latest['rsi']
                macd_hist = latest['macd_histogram']
                
                # Buy signal
                if (price > ema20 and rsi > 50 and macd_hist > 0 and 
                    not pd.isna(ema20) and not pd.isna(rsi) and not pd.isna(macd_hist)):
                    reason = f"Momentum buy: Price ${price:.2f} > EMA20 ${ema20:.2f}, RSI {rsi:.1f} > 50, MACD hist {macd_hist:.4f} > 0"
                    signals.append({
                        'symbol': symbol,
                        'action': 'buy',
                        'price': price,
                        'reason': reason,
                        'confidence': min(1.0, (rsi - 50) / 30 + (price/ema20 - 1) * 5)
                    })
                
                # Sell signal  
                elif price < ema20 or rsi < 40:
                    reason = f"Momentum sell: "
                    if price < ema20:
                        reason += f"Price ${price:.2f} < EMA20 ${ema20:.2f}"
                    if rsi < 40:
                        reason += f"RSI {rsi:.1f} < 40"
                    
                    signals.append({
                        'symbol': symbol,
                        'action': 'sell',
                        'price': price,
                        'reason': reason,
                        'confidence': 0.8
                    })
                    
            except Exception as e:
                logger.warning(f"Error calculating momentum signals for {symbol}: {e}")
                continue
        
        return signals
    
    def mean_reversion_signals(self, data: Dict[str, pd.DataFrame]) -> List[Dict]:
        """
        Mean Reversion Strategy Logic:
        Buy: price < lower Bollinger Band AND Z-score < -2
        Sell: price >= 20-day SMA OR price >= upper Bollinger Band
        """
        signals = []
        
        for symbol, df in data.items():
            if len(df) < 30:
                continue
            
            try:
                # Calculate indicators
                bb = ta.volatility.BollingerBands(df['close'], window=20, window_dev=2)
                df['bb_lower'] = bb.bollinger_lband()
                df['bb_upper'] = bb.bollinger_hband()
                df['sma20'] = ta.trend.SMAIndicator(df['close'], window=20).sma_indicator()
                
                # Z-score calculation
                df['close_std'] = df['close'].rolling(window=20).std()
                df['z_score'] = (df['close'] - df['sma20']) / df['close_std']
                
                latest = df.iloc[-1]
                price = latest['close']
                bb_lower = latest['bb_lower']
                bb_upper = latest['bb_upper']
                sma20 = latest['sma20']
                z_score = latest['z_score']
                
                # Buy signal
                if (price < bb_lower and z_score < -2 and 
                    not pd.isna(bb_lower) and not pd.isna(z_score)):
                    reason = f"Mean reversion buy: Price ${price:.2f} < BB Lower ${bb_lower:.2f}, Z-score {z_score:.2f} < -2"
                    signals.append({
                        'symbol': symbol,
                        'action': 'buy', 
                        'price': price,
                        'reason': reason,
                        'confidence': min(1.0, abs(z_score) / 3)
                    })
                
                # Sell signal
                elif (price >= sma20 or price >= bb_upper) and not pd.isna(sma20) and not pd.isna(bb_upper):
                    reason = f"Mean reversion sell: "
                    if price >= sma20:
                        reason += f"Price ${price:.2f} >= SMA20 ${sma20:.2f}"
                    if price >= bb_upper:
                        reason += f"Price ${price:.2f} >= BB Upper ${bb_upper:.2f}"
                    
                    signals.append({
                        'symbol': symbol,
                        'action': 'sell',
                        'price': price,
                        'reason': reason,
                        'confidence': 0.8
                    })
                    
            except Exception as e:
                logger.warning(f"Error calculating mean reversion signals for {symbol}: {e}")
                continue
        
        return signals
    
    def sector_rotator_signals(self, data: Dict[str, pd.DataFrame]) -> List[Dict]:
        """
        Sector Rotator Strategy Logic:
        Every 20 trading days, rank sectors by 20-day momentum (rate of change)
        Buy top 3 sectors, sell others
        """
        signals = []
        
        # Calculate 20-day momentum for each sector
        sector_momentum = {}
        for symbol, df in data.items():
            if len(df) < 25:
                continue
            
            try:
                # 20-day rate of change
                current_price = df['close'].iloc[-1]
                price_20_days_ago = df['close'].iloc[-21]
                momentum = (current_price - price_20_days_ago) / price_20_days_ago * 100
                sector_momentum[symbol] = {
                    'momentum': momentum,
                    'price': current_price
                }
            except Exception as e:
                logger.warning(f"Error calculating momentum for {symbol}: {e}")
                continue
        
        if not sector_momentum:
            return signals
        
        # Sort by momentum, get top 3
        sorted_sectors = sorted(sector_momentum.items(), key=lambda x: x[1]['momentum'], reverse=True)
        top_3_sectors = [s[0] for s in sorted_sectors[:3]]
        
        # Generate signals
        for symbol, data_point in sector_momentum.items():
            price = data_point['price']
            momentum = data_point['momentum']
            
            if symbol in top_3_sectors:
                reason = f"Sector rotation buy: {symbol} momentum {momentum:.2f}% (top 3)"
                signals.append({
                    'symbol': symbol,
                    'action': 'buy',
                    'price': price,
                    'reason': reason,
                    'confidence': 0.9
                })
            else:
                reason = f"Sector rotation sell: {symbol} momentum {momentum:.2f}% (not top 3)"
                signals.append({
                    'symbol': symbol,
                    'action': 'sell',
                    'price': price,
                    'reason': reason,
                    'confidence': 0.7
                })
        
        return signals
    
    def value_dividends_signals(self, data: Dict[str, pd.DataFrame]) -> List[Dict]:
        """
        Value & Dividends Strategy Logic:
        Buy: RSI < 40 (oversold value stocks)
        Sell: RSI > 70 OR price up 10% from entry
        """
        signals = []
        
        for symbol, df in data.items():
            if len(df) < 20:
                continue
            
            try:
                # Calculate RSI
                df['rsi'] = ta.momentum.RSIIndicator(df['close'], window=14).rsi()
                
                latest = df.iloc[-1]
                price = latest['close']
                rsi = latest['rsi']
                
                if pd.isna(rsi):
                    continue
                
                # Buy signal
                if rsi < 40:
                    reason = f"Value buy: {symbol} RSI {rsi:.1f} < 40 (oversold dividend stock)"
                    signals.append({
                        'symbol': symbol,
                        'action': 'buy',
                        'price': price,
                        'reason': reason,
                        'confidence': (40 - rsi) / 40
                    })
                
                # Sell signal
                elif rsi > 70:
                    reason = f"Value sell: {symbol} RSI {rsi:.1f} > 70 (overbought)"
                    signals.append({
                        'symbol': symbol,
                        'action': 'sell',
                        'price': price,
                        'reason': reason,
                        'confidence': (rsi - 70) / 30
                    })
                    
            except Exception as e:
                logger.warning(f"Error calculating value signals for {symbol}: {e}")
                continue
        
        return signals
    
    def volatility_breakout_signals(self, data: Dict[str, pd.DataFrame]) -> List[Dict]:
        """
        Volatility Breakout Strategy Logic:
        Buy: today's price > yesterday's high + 1.5x ATR(14) AND volume > 2x avg
        Sell: price < entry - 1x ATR OR after 5 days max hold
        """
        signals = []
        
        for symbol, df in data.items():
            if len(df) < 20:
                continue
            
            try:
                # Calculate ATR and average volume
                df['atr'] = ta.volatility.AverageTrueRange(df['high'], df['low'], df['close'], window=14).average_true_range()
                df['avg_volume'] = df['volume'].rolling(window=20).mean()
                
                latest = df.iloc[-1]
                previous = df.iloc[-2]
                
                price = latest['close']
                yesterday_high = previous['high']
                atr = latest['atr']
                volume = latest['volume']
                avg_volume = latest['avg_volume']
                
                if pd.isna(atr) or pd.isna(avg_volume):
                    continue
                
                breakout_threshold = yesterday_high + (1.5 * atr)
                volume_threshold = 2 * avg_volume
                
                # Buy signal
                if price > breakout_threshold and volume > volume_threshold:
                    reason = f"Volatility buy: {symbol} ${price:.2f} > breakout ${breakout_threshold:.2f}, volume {volume:,.0f} > {volume_threshold:,.0f}"
                    signals.append({
                        'symbol': symbol,
                        'action': 'buy',
                        'price': price,
                        'reason': reason,
                        'confidence': min(1.0, (price / breakout_threshold - 1) * 10)
                    })
                    
            except Exception as e:
                logger.warning(f"Error calculating breakout signals for {symbol}: {e}")
                continue
        
        return signals
    
    def check_volatility_breakout_exits(self, strategy_id: int, positions: Dict[str, Dict]) -> List[Dict]:
        """Check exit conditions for volatility breakout positions."""
        signals = []
        
        if not positions:
            return signals
        
        symbols = list(positions.keys())
        data = self.get_historical_data(symbols, days=10)  # Short lookback for exit signals
        
        for symbol in symbols:
            if symbol not in data:
                continue
            
            try:
                df = data[symbol]
                if len(df) < 5:
                    continue
                
                # Calculate ATR for exit logic
                df['atr'] = ta.volatility.AverageTrueRange(df['high'], df['low'], df['close'], window=14).average_true_range()
                
                latest = df.iloc[-1]
                price = latest['close']
                atr = latest['atr']
                
                if pd.isna(atr):
                    continue
                
                position = positions[symbol]
                entry_price = position['avg_cost_basis']
                
                # Check exit conditions
                days_held = (pd.Timestamp.now() - pd.Timestamp(position['updated_at'])).days
                stop_loss_price = entry_price - atr
                
                if price < stop_loss_price:
                    reason = f"Volatility exit: {symbol} ${price:.2f} < stop ${stop_loss_price:.2f} (entry - 1x ATR)"
                    signals.append({
                        'symbol': symbol,
                        'action': 'sell',
                        'price': price,
                        'reason': reason,
                        'confidence': 0.9
                    })
                elif days_held >= 5:
                    reason = f"Volatility exit: {symbol} max hold period (5 days) reached"
                    signals.append({
                        'symbol': symbol,
                        'action': 'sell', 
                        'price': price,
                        'reason': reason,
                        'confidence': 0.8
                    })
                    
            except Exception as e:
                logger.warning(f"Error checking volatility exit for {symbol}: {e}")
                continue
        
        return signals
    
    def check_value_dividend_exits(self, strategy_id: int, positions: Dict[str, Dict]) -> List[Dict]:
        """Check exit conditions for value dividend positions."""
        signals = []
        
        if not positions:
            return signals
        
        symbols = list(positions.keys())
        data = self.get_historical_data(symbols, days=30)
        
        for symbol in symbols:
            if symbol not in data:
                continue
            
            try:
                position = positions[symbol]
                entry_price = position['avg_cost_basis']
                
                df = data[symbol]
                latest = df.iloc[-1]
                current_price = latest['close']
                
                # 10% profit target
                profit_pct = (current_price - entry_price) / entry_price * 100
                
                if profit_pct >= 10:
                    reason = f"Value exit: {symbol} up {profit_pct:.1f}% from entry (10% target reached)"
                    signals.append({
                        'symbol': symbol,
                        'action': 'sell',
                        'price': current_price,
                        'reason': reason,
                        'confidence': 0.8
                    })
                    
            except Exception as e:
                logger.warning(f"Error checking value exit for {symbol}: {e}")
                continue
        
        return signals
    
    def execute_strategy(self, strategy_id: int) -> Dict[str, Any]:
        """Execute a single strategy."""
        if strategy_id not in self.strategies:
            logger.error(f"Strategy {strategy_id} not found")
            return {'success': False, 'error': 'Strategy not found'}
        
        strategy = self.strategies[strategy_id]
        logger.info(f"Executing strategy: {strategy['name']}")
        
        try:
            # Get current positions
            positions = self.get_current_positions(strategy_id)
            
            # Get historical data for the universe
            data = self.get_historical_data(strategy['universe'], days=60)
            if not data:
                logger.warning(f"No data available for strategy {strategy_id}")
                return {'success': False, 'error': 'No market data available'}
            
            # Generate signals based on strategy type
            signals = []
            if strategy['type'] == 'momentum_hunter':
                signals = self.momentum_hunter_signals(data)
            elif strategy['type'] == 'mean_reversion':
                signals = self.mean_reversion_signals(data)
            elif strategy['type'] == 'sector_rotator':
                signals = self.sector_rotator_signals(data)
            elif strategy['type'] == 'value_dividends':
                signals = self.value_dividends_signals(data)
                # Also check exit conditions for existing positions
                signals.extend(self.check_value_dividend_exits(strategy_id, positions))
            elif strategy['type'] == 'volatility_breakout':
                signals = self.volatility_breakout_signals(data)
                # Also check exit conditions for existing positions
                signals.extend(self.check_volatility_breakout_exits(strategy_id, positions))
            
            # Execute trades
            executed_trades = 0
            for signal in signals:
                symbol = signal['symbol']
                action = signal['action']
                price = signal['price']
                reason = signal['reason']
                
                # Position sizing logic for real Alpaca orders
                if action == 'buy':
                    if symbol in positions:
                        logger.info(f"Already holding {symbol}, skipping buy signal")
                        continue
                    
                    if len(positions) >= strategy['max_positions']:
                        logger.info(f"Max positions ({strategy['max_positions']}) reached, skipping buy signal for {symbol}")
                        continue
                    
                    # Calculate position size: max 25% of $20K = $5K per position
                    max_position_value = strategy['initial_capital'] * 0.25
                    quantity = max(1, int(max_position_value / price))
                    
                    success, order_result = self.place_real_order(strategy_id, symbol, 'buy', quantity, price, reason)
                    if success:
                        positions[symbol] = {'quantity': quantity, 'avg_cost_basis': price}
                        executed_trades += 1
                
                elif action == 'sell':
                    if symbol not in positions:
                        logger.info(f"No position in {symbol}, skipping sell signal")
                        continue
                    
                    quantity = int(positions[symbol]['quantity'])
                    if quantity <= 0:
                        continue
                    
                    success, order_result = self.place_real_order(strategy_id, symbol, 'sell', quantity, price, reason)
                    if success:
                        del positions[symbol]
                        executed_trades += 1
            
            # Update position prices
            if positions:
                latest_prices = self.get_latest_prices(list(positions.keys()))
                if latest_prices:
                    self.update_prices_via_api(strategy_id, latest_prices)
            
            # Take snapshot
            self.take_snapshot_via_api(strategy_id)
            
            logger.info(f"Strategy {strategy['name']} executed: {executed_trades} trades, {len(positions)} positions")
            
            return {
                'success': True,
                'strategy': strategy['name'],
                'trades_executed': executed_trades,
                'positions_count': len(positions),
                'signals_generated': len(signals)
            }
            
        except Exception as e:
            logger.error(f"Error executing strategy {strategy_id}: {e}")
            return {'success': False, 'error': str(e)}
    
    def run_all_strategies(self) -> Dict[str, Any]:
        """Execute all 5 strategies."""
        logger.info("Starting execution of all 5 trading strategies")
        
        results = {}
        total_trades = 0
        
        for strategy_id in self.strategies.keys():
            result = self.execute_strategy(strategy_id)
            results[f"strategy_{strategy_id}"] = result
            if result.get('success'):
                total_trades += result.get('trades_executed', 0)
        
        logger.info(f"All strategies executed. Total trades: {total_trades}")
        
        return {
            'timestamp': datetime.now().isoformat(),
            'total_trades': total_trades,
            'strategies': results
        }
    
    def initialize_strategies(self) -> Dict[str, Any]:
        """Initialize all 5 strategies in the database with $100K each."""
        logger.info("Initializing all 5 strategies in database")
        
        try:
            conn = sqlite3.connect(self.db_path)
            cursor = conn.cursor()
            
            # Assume user_id = 1 (first user in the database)
            user_id = 1
            
            initialized = []
            for strategy_id, strategy in self.strategies.items():
                # Check if strategy already exists
                cursor.execute("SELECT id FROM strategies WHERE id = ?", (strategy_id,))
                if cursor.fetchone():
                    logger.info(f"Strategy {strategy_id} ({strategy['name']}) already exists")
                    continue
                
                # Create portfolio for the strategy
                cursor.execute("""
                    INSERT INTO portfolios (user_id, name, starting_balance, cash_balance, type)
                    VALUES (?, ?, ?, ?, 'strategy')
                """, (user_id, f"{strategy['name']} Portfolio", strategy['initial_capital'], strategy['initial_capital']))
                portfolio_id = cursor.lastrowid
                
                # Create strategy
                config_json = json.dumps({
                    'universe': strategy['universe'],
                    'max_positions': strategy['max_positions'],
                    'initial_capital': strategy['initial_capital']  # Now $20K per strategy
                })
                
                cursor.execute("""
                    INSERT INTO strategies (id, user_id, name, type, config, status, portfolio_id)
                    VALUES (?, ?, ?, ?, ?, 'active', ?)
                """, (strategy_id, user_id, strategy['name'], strategy['type'], config_json, portfolio_id))
                
                initialized.append({
                    'id': strategy_id,
                    'name': strategy['name'], 
                    'portfolio_id': portfolio_id,
                    'initial_capital': strategy['initial_capital']
                })
                
                logger.info(f"Initialized strategy {strategy_id}: {strategy['name']}")
            
            conn.commit()
            conn.close()
            
            return {
                'success': True,
                'initialized_strategies': initialized,
                'message': f"Initialized {len(initialized)} strategies with $20K each (Direction B: Real Alpaca execution)"
            }
            
        except Exception as e:
            logger.error(f"Error initializing strategies: {e}")
            if 'conn' in locals():
                conn.rollback()
                conn.close()
            return {'success': False, 'error': str(e)}
    
    def get_status(self) -> Dict[str, Any]:
        """Get status of all strategies."""
        try:
            conn = sqlite3.connect(self.db_path)
            cursor = conn.cursor()
            
            status = {}
            for strategy_id, strategy in self.strategies.items():
                # Get strategy info
                cursor.execute("""
                    SELECT s.name, s.status, p.cash_balance, p.starting_balance
                    FROM strategies s
                    LEFT JOIN portfolios p ON s.portfolio_id = p.id
                    WHERE s.id = ?
                """, (strategy_id,))
                
                result = cursor.fetchone()
                if not result:
                    status[f"strategy_{strategy_id}"] = {'error': 'Not found in database'}
                    continue
                
                name, db_status, cash_balance, starting_balance = result
                
                # Get positions
                cursor.execute("""
                    SELECT symbol, quantity, avg_cost_basis
                    FROM positions p
                    JOIN strategies s ON p.portfolio_id = s.portfolio_id
                    WHERE s.id = ? AND quantity > 0
                """, (strategy_id,))
                
                positions = []
                total_position_value = 0
                for pos_row in cursor.fetchall():
                    symbol, quantity, avg_cost = pos_row
                    positions.append({
                        'symbol': symbol,
                        'quantity': quantity,
                        'avg_cost_basis': avg_cost
                    })
                    total_position_value += quantity * avg_cost
                
                # Get latest prices for P&L calculation
                if positions:
                    symbols = [p['symbol'] for p in positions]
                    latest_prices = self.get_latest_prices(symbols)
                    current_position_value = sum(
                        p['quantity'] * latest_prices.get(p['symbol'], p['avg_cost_basis'])
                        for p in positions
                    )
                else:
                    current_position_value = 0
                
                total_portfolio_value = cash_balance + current_position_value
                total_return_pct = ((total_portfolio_value - starting_balance) / starting_balance * 100) if starting_balance > 0 else 0
                
                status[f"strategy_{strategy_id}"] = {
                    'name': name,
                    'status': db_status,
                    'starting_balance': starting_balance,
                    'cash_balance': cash_balance,
                    'position_value': current_position_value,
                    'total_value': total_portfolio_value,
                    'total_return_pct': round(total_return_pct, 2),
                    'positions_count': len(positions),
                    'positions': positions
                }
            
            conn.close()
            return {'success': True, 'strategies': status}
            
        except Exception as e:
            logger.error(f"Error getting status: {e}")
            return {'success': False, 'error': str(e)}


def main():
    """Main entry point for command line execution."""
    import argparse
    
    parser = argparse.ArgumentParser(description='Trading Strategy Executor')
    parser.add_argument('--init', action='store_true', help='Initialize all 5 strategies')
    parser.add_argument('--run', action='store_true', help='Execute one round of all strategies')
    parser.add_argument('--status', action='store_true', help='Show status of all strategies')
    parser.add_argument('--snapshot', action='store_true', help='Take snapshots for all strategies')
    parser.add_argument('--strategy', type=int, help='Execute specific strategy (1-5)')
    
    args = parser.parse_args()
    
    executor = StrategyExecutor()
    
    if args.init:
        result = executor.initialize_strategies()
        print(json.dumps(result, indent=2))
    elif args.run:
        result = executor.run_all_strategies()
        print(json.dumps(result, indent=2))
    elif args.status:
        result = executor.get_status()
        print(json.dumps(result, indent=2))
    elif args.snapshot:
        for strategy_id in executor.strategies.keys():
            executor.take_snapshot_via_api(strategy_id)
        print("Snapshots taken for all strategies")
    elif args.strategy:
        if args.strategy in executor.strategies:
            result = executor.execute_strategy(args.strategy)
            print(json.dumps(result, indent=2))
        else:
            print(f"Invalid strategy ID: {args.strategy}. Valid IDs: {list(executor.strategies.keys())}")
    else:
        parser.print_help()


if __name__ == "__main__":
    main()