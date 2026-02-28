#!/usr/bin/env python3

"""
Portfolio Performance Report Script
Generates a comprehensive performance report for all 5 virtual strategy portfolios.
"""

import sqlite3
import json
import sys
import os
import argparse
from datetime import datetime, timedelta
from typing import Dict, List, Tuple, Optional
import requests

# Add parent directory to path for imports
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

# Database path - adjust for EC2 when deploying
DB_PATH = os.getenv('DB_PATH', '/Users/moltbot/clawd/PersonalWebsite/trading/server/data/trading.db')
if os.getenv('NODE_ENV') == 'production':
    DB_PATH = '/home/ubuntu/trading-server/data/trading.db'

# Alpaca API configuration (for real-time prices)
ALPACA_API_KEY = os.getenv('ALPACA_API_KEY', 'PKTEST_API_KEY_PLACEHOLDER')
ALPACA_SECRET_KEY = os.getenv('ALPACA_SECRET_KEY', 'SECRET_PLACEHOLDER')
ALPACA_BASE_URL = 'https://paper-api.alpaca.markets'

class PortfolioReporter:
    def __init__(self, db_path: str = DB_PATH):
        self.db_path = db_path
        self.alpaca_headers = {
            'APCA-API-KEY-ID': ALPACA_API_KEY,
            'APCA-API-SECRET-KEY': ALPACA_SECRET_KEY
        }
    
    def get_current_prices(self, symbols: List[str]) -> Dict[str, float]:
        """Get current market prices for symbols from Alpaca."""
        prices = {}
        
        try:
            # Alpaca v2 API endpoint for quotes
            url = f"{ALPACA_BASE_URL}/v2/stocks/quotes/latest"
            params = {'symbols': ','.join(symbols)}
            
            response = requests.get(url, headers=self.alpaca_headers, params=params)
            
            if response.status_code == 200:
                data = response.json()
                for symbol, quote_data in data.get('quotes', {}).items():
                    if quote_data:
                        # Use mid price (bid + ask) / 2
                        bid = quote_data.get('bid_price', 0)
                        ask = quote_data.get('ask_price', 0)
                        if bid and ask:
                            prices[symbol] = (bid + ask) / 2
                        else:
                            # Fallback to last trade price
                            prices[symbol] = quote_data.get('ask_price', quote_data.get('bid_price', 0))
            
            # Fallback to bars if quotes fail
            if not prices:
                url = f"{ALPACA_BASE_URL}/v2/stocks/bars/latest"
                params = {'symbols': ','.join(symbols)}
                
                response = requests.get(url, headers=self.alpaca_headers, params=params)
                if response.status_code == 200:
                    data = response.json()
                    for symbol, bar_data in data.get('bars', {}).items():
                        if bar_data:
                            prices[symbol] = bar_data.get('c', 0)  # Close price
                        
        except Exception as e:
            print(f"Warning: Could not fetch real-time prices: {e}")
            # Use fallback prices or last known prices from DB
            
        return prices
    
    def get_strategy_portfolios(self) -> List[Dict]:
        """Get all strategy portfolios from the database."""
        with sqlite3.connect(self.db_path) as conn:
            conn.row_factory = sqlite3.Row
            cursor = conn.cursor()
            
            cursor.execute("""
                SELECT id, name, type, starting_capital, cash_balance, 
                       config_json, created_at, updated_at
                FROM strategies_v2
                WHERE is_active = 1
                ORDER BY id
            """)
            
            return [dict(row) for row in cursor.fetchall()]
    
    def get_strategy_positions(self, strategy_id: int) -> List[Dict]:
        """Get current positions for a strategy."""
        with sqlite3.connect(self.db_path) as conn:
            conn.row_factory = sqlite3.Row
            cursor = conn.cursor()
            
            cursor.execute("""
                SELECT symbol, quantity, avg_entry_price, current_price,
                       unrealized_pl, opened_at, updated_at
                FROM strategy_positions
                WHERE strategy_id = ?
                ORDER BY symbol
            """, (strategy_id,))
            
            return [dict(row) for row in cursor.fetchall()]
    
    def get_strategy_trades(self, strategy_id: int, days: int = 30) -> List[Dict]:
        """Get recent trades for a strategy."""
        with sqlite3.connect(self.db_path) as conn:
            conn.row_factory = sqlite3.Row
            cursor = conn.cursor()
            
            since_date = datetime.now() - timedelta(days=days)
            
            cursor.execute("""
                SELECT symbol, side, quantity, price, total_value,
                       reason, pnl, executed_at
                FROM strategy_trades
                WHERE strategy_id = ? AND executed_at >= ?
                ORDER BY executed_at DESC
            """, (strategy_id, since_date.isoformat()))
            
            return [dict(row) for row in cursor.fetchall()]
    
    def get_latest_snapshot(self, strategy_id: int) -> Optional[Dict]:
        """Get the latest portfolio snapshot for a strategy."""
        with sqlite3.connect(self.db_path) as conn:
            conn.row_factory = sqlite3.Row
            cursor = conn.cursor()
            
            cursor.execute("""
                SELECT portfolio_value, cash_balance, positions_value,
                       total_pnl, total_pnl_pct, num_positions, snapshot_at
                FROM strategy_snapshots
                WHERE strategy_id = ?
                ORDER BY snapshot_at DESC
                LIMIT 1
            """, (strategy_id,))
            
            row = cursor.fetchone()
            return dict(row) if row else None
    
    def calculate_performance_metrics(self, strategy_id: int) -> Dict:
        """Calculate comprehensive performance metrics for a strategy."""
        with sqlite3.connect(self.db_path) as conn:
            cursor = conn.cursor()
            
            # Get all snapshots for this strategy
            cursor.execute("""
                SELECT portfolio_value, total_pnl, total_pnl_pct, snapshot_at
                FROM strategy_snapshots
                WHERE strategy_id = ?
                ORDER BY snapshot_at
            """, (strategy_id,))
            
            snapshots = cursor.fetchall()
            
            # Get trade statistics
            cursor.execute("""
                SELECT 
                    COUNT(*) as total_trades,
                    COUNT(CASE WHEN side = 'buy' THEN 1 END) as buy_trades,
                    COUNT(CASE WHEN side = 'sell' THEN 1 END) as sell_trades,
                    COUNT(CASE WHEN pnl > 0 THEN 1 END) as winning_trades,
                    AVG(CASE WHEN pnl IS NOT NULL THEN pnl END) as avg_pnl,
                    MAX(pnl) as max_win,
                    MIN(pnl) as max_loss,
                    SUM(CASE WHEN pnl > 0 THEN pnl ELSE 0 END) as total_wins,
                    SUM(CASE WHEN pnl < 0 THEN pnl ELSE 0 END) as total_losses
                FROM strategy_trades
                WHERE strategy_id = ?
            """, (strategy_id,))
            
            trade_stats = cursor.fetchone()
            
        # Calculate metrics
        metrics = {
            'total_trades': trade_stats[0] or 0,
            'buy_trades': trade_stats[1] or 0,
            'sell_trades': trade_stats[2] or 0,
            'winning_trades': trade_stats[3] or 0,
            'win_rate': (trade_stats[3] or 0) / max(trade_stats[2] or 1, 1),  # wins / sells
            'avg_pnl': trade_stats[4] or 0,
            'max_win': trade_stats[5] or 0,
            'max_loss': trade_stats[6] or 0,
            'total_wins': trade_stats[7] or 0,
            'total_losses': trade_stats[8] or 0,
            'profit_factor': abs(trade_stats[7] or 0) / abs(trade_stats[8] or 1) if trade_stats[8] else 0
        }
        
        # Calculate volatility and Sharpe ratio if we have enough snapshots
        if len(snapshots) >= 7:  # Need at least a week of data
            returns = []
            for i in range(1, len(snapshots)):
                prev_value = snapshots[i-1][0]
                curr_value = snapshots[i][0]
                if prev_value > 0:
                    returns.append((curr_value - prev_value) / prev_value)
            
            if returns:
                import statistics
                avg_return = statistics.mean(returns)
                volatility = statistics.stdev(returns) if len(returns) > 1 else 0
                # Annualize (assuming daily snapshots)
                annual_return = avg_return * 252
                annual_volatility = volatility * (252 ** 0.5)
                sharpe_ratio = annual_return / annual_volatility if annual_volatility > 0 else 0
                
                metrics.update({
                    'avg_daily_return': avg_return,
                    'volatility': annual_volatility,
                    'sharpe_ratio': sharpe_ratio
                })
        
        return metrics
    
    def update_position_values(self, positions: List[Dict]) -> List[Dict]:
        """Update position values with current market prices."""
        if not positions:
            return positions
        
        symbols = [pos['symbol'] for pos in positions]
        current_prices = self.get_current_prices(symbols)
        
        updated_positions = []
        for position in positions:
            pos = position.copy()
            symbol = pos['symbol']
            quantity = pos['quantity']
            avg_entry = pos['avg_entry_price']
            
            current_price = current_prices.get(symbol)
            if current_price:
                pos['current_price'] = current_price
                pos['market_value'] = quantity * current_price
                pos['unrealized_pl'] = (current_price - avg_entry) * quantity
                pos['unrealized_pl_pct'] = (current_price - avg_entry) / avg_entry if avg_entry > 0 else 0
            else:
                # Keep existing values if price unavailable
                pos['market_value'] = quantity * pos.get('current_price', avg_entry)
                
            updated_positions.append(pos)
        
        return updated_positions
    
    def generate_report(self, format_type: str = 'text') -> str:
        """Generate comprehensive performance report."""
        strategies = self.get_strategy_portfolios()
        
        if format_type == 'json':
            return self._generate_json_report(strategies)
        elif format_type == 'telegram':
            return self._generate_telegram_report(strategies)
        else:
            return self._generate_text_report(strategies)
    
    def _generate_text_report(self, strategies: List[Dict]) -> str:
        """Generate human-readable text report."""
        report_lines = []
        report_lines.append("="*80)
        report_lines.append("FANTASY TRADING PLATFORM - STRATEGY PERFORMANCE REPORT")
        report_lines.append(f"Generated: {datetime.now().strftime('%Y-%m-%d %H:%M:%S EST')}")
        report_lines.append("="*80)
        
        # Calculate overall rankings
        strategy_rankings = []
        
        for strategy in strategies:
            positions = self.get_strategy_positions(strategy['id'])
            positions = self.update_position_values(positions)
            latest_snapshot = self.get_latest_snapshot(strategy['id'])
            metrics = self.calculate_performance_metrics(strategy['id'])
            
            # Calculate current portfolio value
            cash_balance = strategy['cash_balance']
            positions_value = sum(pos.get('market_value', 0) for pos in positions)
            total_value = cash_balance + positions_value
            
            total_pnl = total_value - strategy['starting_capital']
            total_pnl_pct = total_pnl / strategy['starting_capital']
            
            strategy_rankings.append({
                'name': strategy['name'],
                'type': strategy['type'],
                'total_value': total_value,
                'total_pnl': total_pnl,
                'total_pnl_pct': total_pnl_pct,
                'positions': positions,
                'metrics': metrics,
                'cash_balance': cash_balance,
                'num_positions': len(positions)
            })
        
        # Sort by performance (total P&L %)
        strategy_rankings.sort(key=lambda x: x['total_pnl_pct'], reverse=True)
        
        # Leaderboard
        report_lines.append("\n📊 STRATEGY LEADERBOARD")
        report_lines.append("-" * 80)
        report_lines.append(f"{'Rank':<4} {'Strategy':<20} {'Value':<12} {'P&L':<12} {'P&L%':<8} {'Positions':<9}")
        report_lines.append("-" * 80)
        
        for i, strat in enumerate(strategy_rankings, 1):
            pnl_sign = "+" if strat['total_pnl'] >= 0 else ""
            report_lines.append(
                f"{i:<4} {strat['name']:<20} "
                f"${strat['total_value']:>9,.0f} "
                f"{pnl_sign}${strat['total_pnl']:>9,.0f} "
                f"{pnl_sign}{strat['total_pnl_pct']:>6.1%} "
                f"{strat['num_positions']:<9}"
            )
        
        # Detailed breakdown for each strategy
        for i, strat in enumerate(strategy_rankings, 1):
            report_lines.append(f"\n\n{i}. {strat['name'].upper()} ({strat['type']})")
            report_lines.append("=" * 60)
            
            report_lines.append(f"Portfolio Value: ${strat['total_value']:,.2f}")
            pnl_sign = "+" if strat['total_pnl'] >= 0 else ""
            report_lines.append(f"Total P&L: {pnl_sign}${strat['total_pnl']:,.2f} ({pnl_sign}{strat['total_pnl_pct']:.1%})")
            report_lines.append(f"Cash Balance: ${strat['cash_balance']:,.2f}")
            report_lines.append(f"Positions Value: ${strat['total_value'] - strat['cash_balance']:,.2f}")
            
            # Trading metrics
            metrics = strat['metrics']
            if metrics['total_trades'] > 0:
                report_lines.append(f"\nTrading Stats:")
                report_lines.append(f"  Total Trades: {metrics['total_trades']}")
                report_lines.append(f"  Win Rate: {metrics['win_rate']:.1%}")
                report_lines.append(f"  Avg P&L per Trade: ${metrics['avg_pnl']:.2f}")
                report_lines.append(f"  Best Win: ${metrics['max_win']:.2f}")
                report_lines.append(f"  Worst Loss: ${metrics['max_loss']:.2f}")
                if 'sharpe_ratio' in metrics:
                    report_lines.append(f"  Sharpe Ratio: {metrics['sharpe_ratio']:.2f}")
            
            # Current positions
            positions = strat['positions']
            if positions:
                report_lines.append(f"\nCurrent Positions ({len(positions)}):")
                report_lines.append(f"{'Symbol':<8} {'Qty':<8} {'Entry':<8} {'Current':<8} {'P&L':<10} {'P&L%':<8}")
                report_lines.append("-" * 60)
                
                for pos in positions:
                    pnl_sign = "+" if pos.get('unrealized_pl', 0) >= 0 else ""
                    pnl_pct_sign = "+" if pos.get('unrealized_pl_pct', 0) >= 0 else ""
                    report_lines.append(
                        f"{pos['symbol']:<8} "
                        f"{pos['quantity']:<8} "
                        f"${pos['avg_entry_price']:<7.2f} "
                        f"${pos.get('current_price', 0):<7.2f} "
                        f"{pnl_sign}${pos.get('unrealized_pl', 0):<8.2f} "
                        f"{pnl_pct_sign}{pos.get('unrealized_pl_pct', 0):<7.1%}"
                    )
            else:
                report_lines.append("\nNo current positions")
        
        return "\n".join(report_lines)
    
    def _generate_telegram_report(self, strategies: List[Dict]) -> str:
        """Generate Telegram-formatted report."""
        lines = []
        lines.append("🤖 <b>Fantasy Trading Update</b>")
        lines.append(f"📅 {datetime.now().strftime('%Y-%m-%d %H:%M EST')}")
        lines.append("")
        
        # Calculate rankings
        strategy_rankings = []
        for strategy in strategies:
            positions = self.get_strategy_positions(strategy['id'])
            positions = self.update_position_values(positions)
            
            cash_balance = strategy['cash_balance']
            positions_value = sum(pos.get('market_value', 0) for pos in positions)
            total_value = cash_balance + positions_value
            total_pnl_pct = (total_value - strategy['starting_capital']) / strategy['starting_capital']
            
            strategy_rankings.append({
                'name': strategy['name'],
                'total_value': total_value,
                'total_pnl_pct': total_pnl_pct,
                'num_positions': len(positions)
            })
        
        strategy_rankings.sort(key=lambda x: x['total_pnl_pct'], reverse=True)
        
        lines.append("🏆 <b>Strategy Leaderboard:</b>")
        for i, strat in enumerate(strategy_rankings, 1):
            emoji = "🥇" if i == 1 else "🥈" if i == 2 else "🥉" if i == 3 else "📊"
            pnl_sign = "+" if strat['total_pnl_pct'] >= 0 else ""
            lines.append(
                f"{emoji} <b>{strat['name']}</b>: "
                f"${strat['total_value']:,.0f} ({pnl_sign}{strat['total_pnl_pct']:.1%}) "
                f"[{strat['num_positions']} positions]"
            )
        
        return "\n".join(lines)
    
    def _generate_json_report(self, strategies: List[Dict]) -> str:
        """Generate JSON report for API consumption."""
        strategy_data = []
        
        for strategy in strategies:
            positions = self.get_strategy_positions(strategy['id'])
            positions = self.update_position_values(positions)
            metrics = self.calculate_performance_metrics(strategy['id'])
            
            cash_balance = strategy['cash_balance']
            positions_value = sum(pos.get('market_value', 0) for pos in positions)
            total_value = cash_balance + positions_value
            
            strategy_data.append({
                'id': strategy['id'],
                'name': strategy['name'],
                'type': strategy['type'],
                'starting_capital': strategy['starting_capital'],
                'current_value': total_value,
                'cash_balance': cash_balance,
                'positions_value': positions_value,
                'total_pnl': total_value - strategy['starting_capital'],
                'total_pnl_pct': (total_value - strategy['starting_capital']) / strategy['starting_capital'],
                'num_positions': len(positions),
                'positions': positions,
                'metrics': metrics,
                'created_at': strategy['created_at'],
                'updated_at': datetime.now().isoformat()
            })
        
        # Sort by performance
        strategy_data.sort(key=lambda x: x['total_pnl_pct'], reverse=True)
        
        return json.dumps({
            'generated_at': datetime.now().isoformat(),
            'total_strategies': len(strategy_data),
            'strategies': strategy_data
        }, indent=2)

def main():
    parser = argparse.ArgumentParser(description='Generate strategy portfolio performance report')
    parser.add_argument('--format', choices=['text', 'json', 'telegram'], default='text',
                       help='Output format (default: text)')
    parser.add_argument('--output', '-o', help='Output file (default: stdout)')
    parser.add_argument('--db-path', help='Database path')
    
    args = parser.parse_args()
    
    # Override DB path if provided
    db_path = args.db_path or DB_PATH
    
    # Check if database exists
    if not os.path.exists(db_path):
        print(f"Error: Database not found at {db_path}", file=sys.stderr)
        print("Run the setup script first: node scripts/setup_strategies.js", file=sys.stderr)
        return 1
    
    try:
        reporter = PortfolioReporter(db_path)
        report = reporter.generate_report(args.format)
        
        if args.output:
            with open(args.output, 'w') as f:
                f.write(report)
            print(f"Report saved to {args.output}")
        else:
            print(report)
        
        return 0
        
    except Exception as e:
        print(f"Error generating report: {e}", file=sys.stderr)
        return 1

if __name__ == '__main__':
    exit(main())