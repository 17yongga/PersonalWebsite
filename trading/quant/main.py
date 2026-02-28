#!/usr/bin/env python3
"""Main entry point for the quantitative trading engine."""

import argparse
import logging
import sys
import os
from datetime import datetime, timedelta
from typing import Dict, Optional
import pandas as pd

# Add project root to path
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import config
from alpaca_client import client
from signals.generator import signal_generator
from backtesting.engine import BacktestEngine
from backtesting.metrics import generate_performance_report
from strategies.momentum import MomentumStrategy
from strategies.mean_reversion import MeanReversionStrategy
from strategies.sector_rotation import SectorRotationStrategy
from strategies.value_dividend import ValueDividendStrategy
from strategies.volatility_breakout import VolatilityBreakoutStrategy
from strategies.sector_rotation import SectorRotationStrategy
from strategies.value_dividend import ValueDividendStrategy
from utils.risk import risk_manager

# Configure logging
def setup_logging(log_level: str = 'INFO', log_file: str = None):
    """Setup logging configuration."""
    level = getattr(logging, log_level.upper(), logging.INFO)
    
    formatter = logging.Formatter(
        '%(asctime)s - %(name)s - %(levelname)s - %(message)s'
    )
    
    # Console handler
    console_handler = logging.StreamHandler()
    console_handler.setLevel(level)
    console_handler.setFormatter(formatter)
    
    # File handler (if specified)
    handlers = [console_handler]
    if log_file:
        os.makedirs(os.path.dirname(log_file), exist_ok=True)
        file_handler = logging.FileHandler(log_file)
        file_handler.setLevel(level)
        file_handler.setFormatter(formatter)
        handlers.append(file_handler)
    
    # Configure root logger
    logging.basicConfig(
        level=level,
        handlers=handlers,
        force=True
    )

def get_market_data(symbols: list, days: int = 252) -> Dict[str, pd.DataFrame]:
    """
    Fetch historical market data for symbols.
    
    Args:
        symbols: List of symbols to fetch
        days: Number of days of history
    
    Returns:
        Dictionary mapping symbols to OHLCV DataFrames
    """
    logger = logging.getLogger(__name__)
    
    end_date = datetime.now().strftime('%Y-%m-%d')
    start_date = (datetime.now() - timedelta(days=days + 30)).strftime('%Y-%m-%d')
    
    data = {}
    
    for symbol in symbols:
        try:
            logger.info(f"Fetching data for {symbol}")
            bars = client.get_bars_for_symbol(
                symbol,
                timeframe='1Day',
                start=start_date,
                end=end_date
            )
            
            if bars:
                df = pd.DataFrame(bars)
                if not df.empty:
                    # Convert timestamp to datetime (Alpaca v2 uses 't' for timestamp)
                    ts_col = 't' if 't' in df.columns else 'timestamp'
                    df['timestamp'] = pd.to_datetime(df[ts_col])
                    df.set_index('timestamp', inplace=True)
                    
                    # Rename columns to standard format (Alpaca v2 uses short names)
                    column_mapping = {
                        'o': 'open',
                        'h': 'high',
                        'l': 'low',
                        'c': 'close',
                        'v': 'volume'
                    }
                    df.rename(columns=column_mapping, inplace=True)
                    
                    # Ensure we have required columns
                    required_cols = ['open', 'high', 'low', 'close', 'volume']
                    if all(col in df.columns for col in required_cols):
                        data[symbol] = df[required_cols].sort_index()
                        logger.info(f"Loaded {len(df)} days of data for {symbol}")
                    else:
                        logger.warning(f"Missing required columns for {symbol}")
            
        except Exception as e:
            logger.error(f"Error fetching data for {symbol}: {e}")
            
            # Create mock data for backtesting if API fails
            logger.info(f"Creating mock data for {symbol}")
            dates = pd.date_range(start=start_date, end=end_date, freq='D')
            # Simple random walk for mock data
            import numpy as np
            np.random.seed(hash(symbol) % 2**32)  # Deterministic seed based on symbol
            
            price = 100.0  # Starting price
            prices = [price]
            
            for _ in range(len(dates) - 1):
                change = np.random.normal(0, 0.02)  # 2% daily volatility
                price *= (1 + change)
                prices.append(price)
            
            df = pd.DataFrame({
                'open': prices,
                'high': [p * (1 + abs(np.random.normal(0, 0.005))) for p in prices],
                'low': [p * (1 - abs(np.random.normal(0, 0.005))) for p in prices],
                'close': prices,
                'volume': [np.random.randint(100000, 1000000) for _ in prices]
            }, index=dates)
            
            data[symbol] = df
    
    logger.info(f"Loaded data for {len(data)} symbols")
    return data

def cmd_run(args):
    """Execute one cycle of all active strategies."""
    logger = logging.getLogger(__name__)
    logger.info("Starting strategy execution cycle")
    
    try:
        # Validate configuration
        if not config.ALPACA_API_KEY or not config.ALPACA_SECRET_KEY:
            logger.warning("No Alpaca API keys configured - running in mock mode")
        
        # Check if market is open
        if config.ALPACA_API_KEY:
            try:
                market_open = client.is_market_open()
                if not market_open and not args.force:
                    logger.info("Market is closed. Use --force to run anyway.")
                    return
            except Exception as e:
                logger.warning(f"Could not check market status: {e}")
        
        # Get current positions and account info
        try:
            account = client.get_account()
            positions = client.get_positions()
            portfolio_value = float(account.get('portfolio_value', config.INITIAL_CAPITAL))
            
            logger.info(f"Current portfolio value: ${portfolio_value:,.2f}")
            logger.info(f"Current positions: {len(positions)}")
            
            risk_manager.update_portfolio_value(portfolio_value)
        except Exception as e:
            logger.warning(f"Could not get account info: {e}")
            portfolio_value = config.INITIAL_CAPITAL
        
        # Get market data
        universe = signal_generator.get_universe()
        data = get_market_data(universe, days=100)  # Last 100 days
        
        if not data:
            logger.error("No market data available")
            return
        
        # Generate signals
        logger.info("Generating trading signals...")
        signals = signal_generator.generate_signals(data)
        
        logger.info(f"Generated {len(signals)} signals")
        
        # Execute signals (if not in dry-run mode)
        if signals and not args.dry_run:
            for signal in signals:
                try:
                    logger.info(f"Executing: {signal.action.upper()} {signal.quantity} shares of {signal.symbol} @ ${signal.price:.2f}")
                    logger.info(f"Reason: {signal.reason}")
                    
                    if signal.action == 'buy':
                        order = client.place_order(
                            symbol=signal.symbol,
                            qty=signal.quantity,
                            side='buy',
                            order_type='market'
                        )
                    elif signal.action == 'sell':
                        order = client.place_order(
                            symbol=signal.symbol,
                            qty=signal.quantity,
                            side='sell',
                            order_type='market'
                        )
                    
                    logger.info(f"Order placed successfully: {order.get('id')}")
                    
                except Exception as e:
                    logger.error(f"Failed to execute signal for {signal.symbol}: {e}")
        
        elif signals and args.dry_run:
            logger.info("DRY RUN - Signals that would be executed:")
            for signal in signals:
                logger.info(f"  {signal.action.upper()}: {signal.quantity} shares of {signal.symbol} @ ${signal.price:.2f}")
                logger.info(f"    Confidence: {signal.confidence:.2%}")
                logger.info(f"    Reason: {signal.reason}")
        
        else:
            logger.info("No signals generated")
        
        logger.info("Strategy execution cycle completed")
        
    except Exception as e:
        logger.error(f"Error in strategy execution: {e}")
        raise

def cmd_backtest(args):
    """Run backtest for a specific strategy."""
    logger = logging.getLogger(__name__)
    logger.info(f"Starting backtest for {args.strategy} strategy")
    
    # Initialize strategy
    if args.strategy == 'momentum':
        strategy = MomentumStrategy()
    elif args.strategy == 'mean_reversion':
        strategy = MeanReversionStrategy()
    elif args.strategy == 'volatility_breakout':
        strategy = VolatilityBreakoutStrategy()
    elif args.strategy == 'sector_rotation':
        strategy = SectorRotationStrategy()
    elif args.strategy == 'value_dividend':
        strategy = ValueDividendStrategy()
    else:
        logger.error(f"Unknown strategy: {args.strategy}")
        return
    
    # Get historical data
    symbols = [args.symbol] if args.symbol else signal_generator.get_universe()
    data = get_market_data(symbols, days=args.days)
    
    if not data:
        logger.error("No data available for backtesting")
        return
    
    # Run backtest
    engine = BacktestEngine(initial_capital=config.INITIAL_CAPITAL)
    
    # Calculate date range
    end_date = datetime.now().strftime('%Y-%m-%d')
    start_date = (datetime.now() - timedelta(days=args.days)).strftime('%Y-%m-%d')
    
    results = engine.run_backtest(
        strategy=strategy,
        data=data,
        start_date=start_date,
        end_date=end_date
    )
    
    # Display results
    print("\n" + "="*80)
    print(f"BACKTEST RESULTS: {strategy.get_name()}")
    print("="*80)
    
    metrics = results['metrics']
    report = generate_performance_report(metrics)
    print(report)
    
    # Save detailed results if requested
    if args.output:
        import json
        
        # Convert non-serializable objects
        serializable_results = {
            'strategy_name': results['strategy_name'],
            'strategy_config': results['strategy_config'],
            'start_date': str(results['start_date']),
            'end_date': str(results['end_date']),
            'initial_capital': results['initial_capital'],
            'final_value': results['final_value'],
            'total_trades': results['total_trades'],
            'metrics': metrics
        }
        
        with open(args.output, 'w') as f:
            json.dump(serializable_results, f, indent=2)
        
        logger.info(f"Detailed results saved to {args.output}")

def cmd_status(args):
    """Show account and position status."""
    logger = logging.getLogger(__name__)
    
    try:
        # Account information
        account = client.get_account()
        portfolio_value = float(account.get('portfolio_value', 0))
        buying_power = float(account.get('buying_power', 0))
        cash = float(account.get('cash', 0))
        
        print("\n" + "="*50)
        print("ACCOUNT STATUS")
        print("="*50)
        print(f"Portfolio Value:  ${portfolio_value:,.2f}")
        print(f"Cash:             ${cash:,.2f}")
        print(f"Buying Power:     ${buying_power:,.2f}")
        
        # Positions
        positions = client.get_positions()
        print(f"\nPositions ({len(positions)}):")
        print("-" * 50)
        
        if positions:
            total_pnl = 0
            for pos in positions:
                symbol = pos['symbol']
                qty = int(pos['qty'])
                market_value = float(pos['market_value'])
                unrealized_pl = float(pos['unrealized_pl'])
                unrealized_plpc = float(pos['unrealized_plpc']) * 100
                
                total_pnl += unrealized_pl
                
                print(f"{symbol:>6}: {qty:>6} shares | "
                      f"Value: ${market_value:>8,.2f} | "
                      f"P&L: ${unrealized_pl:>7.2f} ({unrealized_plpc:>5.1f}%)")
            
            print("-" * 50)
            print(f"Total Unrealized P&L: ${total_pnl:,.2f}")
        else:
            print("No open positions")
        
        # Recent orders
        orders = client.get_orders(status='all', limit=10)
        print(f"\nRecent Orders ({len(orders)}):")
        print("-" * 50)
        
        for order in orders[:5]:  # Show last 5 orders
            symbol = order['symbol']
            side = order['side']
            qty = order['qty']
            status = order['status']
            created = order['created_at'][:10]  # Date only
            
            print(f"{created} | {symbol} {side.upper()} {qty} shares - {status}")
        
    except Exception as e:
        logger.error(f"Error getting status: {e}")

def cmd_signals(args):
    """Generate and display current signals without executing."""
    logger = logging.getLogger(__name__)
    logger.info("Generating current trading signals...")
    
    # Get market data
    universe = signal_generator.get_universe()
    data = get_market_data(universe, days=100)
    
    if not data:
        logger.error("No market data available")
        return
    
    # Generate signals
    signals = signal_generator.generate_signals(data)
    
    print("\n" + "="*80)
    print(f"CURRENT TRADING SIGNALS ({len(signals)})")
    print("="*80)
    
    if signals:
        for i, signal in enumerate(signals, 1):
            print(f"\n{i}. {signal.symbol} - {signal.action.upper()}")
            print(f"   Quantity:    {signal.quantity} shares")
            print(f"   Price:       ${signal.price:.2f}")
            print(f"   Confidence:  {signal.confidence:.1%}")
            print(f"   Reason:      {signal.reason}")
            
            if hasattr(signal, 'strategy_names'):
                print(f"   Strategies:  {', '.join(signal.strategy_names)}")
    else:
        print("No signals generated at this time.")
    
    # Show strategy summary
    print("\n" + "="*80)
    print("STRATEGY STATUS")
    print("="*80)
    
    summary = signal_generator.get_strategy_summary()
    for name, info in summary.items():
        status = "ENABLED" if info['enabled'] else "DISABLED"
        print(f"{info['name']:<20} | Weight: {info['weight']:.1f} | {status}")

def main():
    """Main CLI entry point."""
    parser = argparse.ArgumentParser(
        description='Quantitative Trading Engine',
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  python main.py run                               # Execute trading strategies
  python main.py run --dry-run                     # Show what would be executed
  python main.py backtest --strategy momentum      # Backtest momentum strategy
  python main.py backtest --strategy momentum --symbol AAPL --days 365
  python main.py status                            # Show account status
  python main.py signals                           # Show current signals
        """
    )
    
    parser.add_argument('--log-level', default='INFO', 
                        choices=['DEBUG', 'INFO', 'WARNING', 'ERROR'])
    parser.add_argument('--log-file', help='Log file path')
    
    subparsers = parser.add_subparsers(dest='command', help='Available commands')
    
    # Run command
    run_parser = subparsers.add_parser('run', help='Execute trading strategies')
    run_parser.add_argument('--dry-run', action='store_true', 
                           help='Show signals without executing')
    run_parser.add_argument('--force', action='store_true',
                           help='Run even if market is closed')
    
    # Backtest command
    backtest_parser = subparsers.add_parser('backtest', help='Run strategy backtest')
    backtest_parser.add_argument('--strategy', required=True,
                                choices=['momentum', 'mean_reversion', 'sentiment', 'sector_rotation', 'value_dividend'],
                                help='Strategy to backtest')
    backtest_parser.add_argument('--symbol', help='Single symbol to test (default: all)')
    backtest_parser.add_argument('--days', type=int, default=365,
                                help='Number of days to backtest (default: 365)')
    backtest_parser.add_argument('--output', help='Save results to JSON file')
    
    # Status command
    status_parser = subparsers.add_parser('status', help='Show account and positions')
    
    # Signals command
    signals_parser = subparsers.add_parser('signals', help='Show current trading signals')
    
    # Parse arguments
    args = parser.parse_args()
    
    # Setup logging
    setup_logging(args.log_level, args.log_file)
    logger = logging.getLogger(__name__)
    
    # Execute command
    if not args.command:
        parser.print_help()
        return
    
    try:
        if args.command == 'run':
            cmd_run(args)
        elif args.command == 'backtest':
            cmd_backtest(args)
        elif args.command == 'status':
            cmd_status(args)
        elif args.command == 'signals':
            cmd_signals(args)
    except KeyboardInterrupt:
        logger.info("Interrupted by user")
    except Exception as e:
        logger.error(f"Command failed: {e}")
        if args.log_level == 'DEBUG':
            import traceback
            traceback.print_exc()
        sys.exit(1)

if __name__ == '__main__':
    main()