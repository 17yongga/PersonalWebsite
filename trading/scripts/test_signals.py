#!/usr/bin/env python3
"""
Test script to verify signal generation works correctly.
This script bypasses market status checks to test the signal generation logic.
"""

import sys
import os
import json

# Add the quant directory to Python path
quant_dir = os.path.join(os.path.dirname(__file__), '..', 'quant')
sys.path.insert(0, os.path.abspath(quant_dir))

from strategy_executor import StrategyExecutor

def test_signal_generation():
    """Test that all 5 strategies can generate signals correctly."""
    executor = StrategyExecutor()
    
    print("Testing signal generation for all 5 strategies...")
    print("=" * 60)
    
    for strategy_id in range(1, 6):
        strategy = executor.strategies[strategy_id]
        print(f"\n--- Testing Strategy {strategy_id}: {strategy['name']} ---")
        
        # Get market data for this strategy's universe
        universe = strategy['universe']
        print(f"Universe: {universe}")
        
        data = executor.get_historical_data(universe, days=60)
        if not data:
            print("❌ No market data available")
            continue
        
        print(f"✓ Got data for {len(data)} symbols")
        
        # Generate signals based on strategy type
        signals = []
        strategy_type = strategy['type']
        
        try:
            if strategy_type == 'momentum_hunter':
                signals = executor.momentum_hunter_signals(data)
            elif strategy_type == 'mean_reversion':
                signals = executor.mean_reversion_signals(data)
            elif strategy_type == 'sector_rotator':
                signals = executor.sector_rotator_signals(data)
            elif strategy_type == 'value_dividends':
                signals = executor.value_dividends_signals(data)
            elif strategy_type == 'volatility_breakout':
                signals = executor.volatility_breakout_signals(data)
            
            print(f"✓ Generated {len(signals)} signals")
            
            # Show high confidence signals
            high_confidence = [s for s in signals if s.get('confidence', 0) > 0.65]
            print(f"✓ High confidence signals (>0.65): {len(high_confidence)}")
            
            for signal in high_confidence[:3]:  # Show first 3
                print(f"  - {signal['action']} {signal['symbol']} @ ${signal['price']:.2f} (confidence: {signal['confidence']:.3f})")
                print(f"    Reason: {signal['reason']}")
            
            if len(high_confidence) > 3:
                print(f"  ... and {len(high_confidence) - 3} more")
                
        except Exception as e:
            print(f"❌ Error generating signals: {e}")
    
    print("\n" + "=" * 60)
    print("Signal generation test complete!")

if __name__ == "__main__":
    test_signal_generation()