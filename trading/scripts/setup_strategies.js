#!/usr/bin/env node

/**
 * Setup script for 5 virtual strategy portfolios
 * Creates system user and 5 strategy portfolios in the trading platform DB
 */

const Database = require('../server/node_modules/better-sqlite3');
const path = require('path');

// Database path - adjust for EC2 when deploying
const DB_PATH = process.env.NODE_ENV === 'production' 
  ? '/home/ubuntu/trading-server/data/trading.db'
  : path.join(__dirname, '../server/data/trading.db');

console.log('Database path:', DB_PATH);

const db = new Database(DB_PATH);

// Enable WAL mode for better concurrent access
db.pragma('journal_mode = WAL');

const strategies = [
  {
    name: 'momentum-hunter',
    description: 'Momentum/trend following strategy using RSI, MACD, EMA crossovers',
    type: 'momentum',
    config: {
      universe: ['AAPL', 'MSFT', 'GOOGL', 'AMZN', 'TSLA', 'NVDA', 'META', 'NFLX', 'CRM', 'AMD'],
      rsi_period: 14,
      rsi_oversold: 30,
      rsi_overbought: 70,
      ema_short: 12,
      ema_long: 26,
      macd_signal: 9,
      position_size: 0.1 // 10% per position
    }
  },
  {
    name: 'mean-reversion',
    description: 'Mean reversion strategy using Bollinger Bands, Z-score, RSI extremes',
    type: 'mean_reversion',
    config: {
      universe: ['SPY', 'QQQ', 'IWM', 'GLD', 'TLT', 'VIX', 'AAPL', 'MSFT', 'GOOGL', 'AMZN'],
      bollinger_period: 20,
      bollinger_std: 2,
      zscore_threshold: 2,
      rsi_oversold: 20,
      rsi_overbought: 80,
      position_size: 0.15
    }
  },
  {
    name: 'sector-rotator',
    description: 'Sector rotation strategy focusing on sector ETFs based on relative momentum',
    type: 'sector_rotation',
    config: {
      universe: ['XLK', 'XLF', 'XLE', 'XLV', 'XLY', 'XLP', 'XLI', 'XLU', 'XLRE'],
      lookback_period: 60,
      momentum_threshold: 0.05,
      rebalance_frequency: 'weekly',
      max_positions: 3,
      position_size: 0.33
    }
  },
  {
    name: 'value-dividends',
    description: 'Value + dividends strategy focusing on high-quality dividend stocks',
    type: 'value_dividend',
    config: {
      universe: ['JNJ', 'KO', 'PG', 'WMT', 'XOM', 'VZ', 'T', 'JPM', 'BAC', 'HD'],
      min_dividend_yield: 0.02,
      max_pe_ratio: 20,
      min_market_cap: 50000000000, // $50B
      rsi_oversold: 35,
      volatility_threshold: 0.02,
      position_size: 0.12
    }
  },
  {
    name: 'volatility-breakout',
    description: 'Volatility breakout strategy targeting high-momentum, high-volatility stocks',
    type: 'volatility_breakout',
    config: {
      universe: ['NVDA', 'TSLA', 'MSTR', 'PLTR', 'COIN', 'ARKK', 'SOXL', 'TQQQ', 'UPRO', 'SPXL'],
      atr_period: 14,
      atr_multiplier: 2.5,
      volume_threshold: 1.5, // 1.5x avg volume
      breakout_period: 20,
      max_positions: 4,
      position_size: 0.08 // Smaller size due to high risk
    }
  }
];

function setupStrategies() {
  console.log('🚀 Setting up 5 virtual strategy portfolios...\n');

  try {
    // Start transaction
    db.exec('BEGIN TRANSACTION');

    // 1. Create system user if not exists
    console.log('1. Creating system user...');
    const createUser = db.prepare(`
      INSERT OR IGNORE INTO users (id, email, password_hash, display_name)
      VALUES (1, 'system@papertrade.ai', 'system_hash', 'Trading System')
    `);
    const userResult = createUser.run();
    console.log('   System user created:', userResult.changes > 0 ? 'NEW' : 'EXISTS');

    // 2. Create strategy portfolios in strategies_v2 table
    console.log('\n2. Creating strategy portfolios...');
    const createStrategy = db.prepare(`
      INSERT OR REPLACE INTO strategies_v2 
      (name, description, type, starting_capital, cash_balance, config_json, is_active)
      VALUES (?, ?, ?, 100000, 100000, ?, 1)
    `);

    strategies.forEach((strategy, index) => {
      const result = createStrategy.run(
        strategy.name,
        strategy.description,
        strategy.type,
        JSON.stringify(strategy.config)
      );
      console.log(`   ✅ ${strategy.name} (ID: ${result.lastInsertRowid})`);
    });

    // 3. Create initial portfolio snapshots
    console.log('\n3. Creating initial portfolio snapshots...');
    const createSnapshot = db.prepare(`
      INSERT INTO strategy_snapshots 
      (strategy_id, portfolio_value, cash_balance, positions_value, total_pnl, total_pnl_pct, num_positions)
      VALUES (?, 100000, 100000, 0, 0, 0, 0)
    `);

    const getStrategies = db.prepare('SELECT id, name FROM strategies_v2 ORDER BY id');
    const strategyList = getStrategies.all();

    strategyList.forEach(strat => {
      createSnapshot.run(strat.id);
      console.log(`   📊 Initial snapshot for ${strat.name}`);
    });

    // 4. Add initial system event
    console.log('\n4. Adding initial system events...');
    const createEvent = db.prepare(`
      INSERT INTO strategy_events 
      (strategy_id, event_type, title, description, value)
      VALUES (?, 'milestone', 'Strategy Initialized', 'Virtual portfolio created with $100,000 starting capital', 100000)
    `);

    strategyList.forEach(strat => {
      createEvent.run(strat.id);
      console.log(`   🎯 Initial event for ${strat.name}`);
    });

    // Commit transaction
    db.exec('COMMIT');

    console.log('\n✅ Setup complete! All 5 strategy portfolios are ready.');
    console.log('\nStrategy Summary:');
    console.log('================');
    
    const summaryQuery = db.prepare(`
      SELECT name, type, starting_capital, cash_balance, 
             json_extract(config_json, '$.universe') as universe
      FROM strategies_v2 
      ORDER BY id
    `);
    
    const summary = summaryQuery.all();
    summary.forEach(strat => {
      console.log(`📈 ${strat.name}:`);
      console.log(`   Type: ${strat.type}`);
      console.log(`   Capital: $${strat.starting_capital.toLocaleString()}`);
      console.log(`   Universe: ${JSON.parse(strat.universe || '[]').slice(0, 5).join(', ')}...`);
      console.log('');
    });

  } catch (error) {
    // Rollback on error
    db.exec('ROLLBACK');
    console.error('❌ Error setting up strategies:', error.message);
    process.exit(1);
  } finally {
    db.close();
  }
}

// Run if called directly
if (require.main === module) {
  setupStrategies();
}

module.exports = setupStrategies;