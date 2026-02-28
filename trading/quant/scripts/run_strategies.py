#!/usr/bin/env python3
"""
PM2 entry point: runs all strategies every 5 minutes during market hours.
Direction B: Real Alpaca paper trading execution.
"""

import os
import sys
import time
import schedule
import logging
from datetime import datetime

# Add the parent directory to Python path
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from strategy_executor import StrategyExecutor

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
    handlers=[
        logging.FileHandler(os.path.join(os.path.dirname(__file__), '../logs/strategy_runner.log')),
        logging.StreamHandler()
    ]
)
logger = logging.getLogger(__name__)

def run_strategies():
    """Execute all strategies if market is open."""
    try:
        executor = StrategyExecutor()
        
        # Check if market is open
        if not executor.alpaca.is_market_open():
            logger.info("Market is closed, skipping strategy execution")
            return
        
        logger.info("Market is open, executing all strategies...")
        result = executor.run_all_strategies()
        
        if result:
            total_trades = result.get('total_trades', 0)
            logger.info(f"Strategy execution completed: {total_trades} total trades executed")
        else:
            logger.warning("Strategy execution returned no result")
            
    except Exception as e:
        logger.error(f"Error in strategy execution: {e}")

def main():
    """Main entry point for PM2 process."""
    logger.info("Strategy Runner started (Direction B: Real Alpaca execution)")
    
    # Schedule strategy execution every 5 minutes
    schedule.every(5).minutes.do(run_strategies)
    
    # Run once on startup (if market is open)
    run_strategies()
    
    # Main loop
    while True:
        try:
            schedule.run_pending()
            time.sleep(30)  # Check every 30 seconds
        except KeyboardInterrupt:
            logger.info("Strategy Runner shutting down...")
            break
        except Exception as e:
            logger.error(f"Unexpected error in main loop: {e}")
            time.sleep(60)  # Wait a minute before retrying

if __name__ == "__main__":
    main()