#!/usr/bin/env python3
"""
Test script to verify full execution logic works correctly.
This script forces market open status to test the trading execution flow.
"""

import sys
import os
import json

# Add the quant directory to Python path
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

from scripts.execute_trades import TradingExecutor

class TestTradingExecutor(TradingExecutor):
    """Test version that forces market to be open."""
    
    def check_market_status(self) -> bool:
        """Override to always return True for testing."""
        print("TEST MODE: Forcing market status to OPEN")
        return True

def main():
    """Run a full execution test."""
    print("Testing full trading execution flow (DRY RUN)...")
    print("=" * 60)
    
    executor = TestTradingExecutor(dry_run=True)
    result = executor.run_strategy_execution()
    
    print("\nFinal Result:")
    print(json.dumps(result, indent=2))

if __name__ == "__main__":
    main()