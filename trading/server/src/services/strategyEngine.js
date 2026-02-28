const { getDb } = require('../config/database');

class StrategyEngine {
    constructor() {
        this.strategyConfigs = {
            momentum: {
                name: "Momentum Rider",
                description: "Follows strong price trends using RSI and EMA indicators. Buys when momentum is building, sells when it weakens.",
                type: "momentum",
                config: {
                    rsi_period: 14,
                    ema_short: 12,
                    ema_long: 26,
                    buy_threshold: 1.5,
                    sell_threshold: -1.5,
                    max_positions: 8
                }
            },
            mean_reversion: {
                name: "Contrarian",
                description: "Capitalizes on price swings by buying oversold stocks and selling overbought ones using Bollinger Bands and Z-scores.",
                type: "mean_reversion",
                config: {
                    bb_period: 20,
                    bb_std: 2,
                    zscore_entry: -2,
                    zscore_exit: 0,
                    max_positions: 6
                }
            },
            sector_rotation: {
                name: "Sector Rotator",
                description: "Systematically rotates between sector ETFs based on relative strength and economic cycles.",
                type: "sector_rotation",
                config: {
                    rebalance_days: 20,
                    top_sectors: 3,
                    sector_etfs: ["XLK","XLF","XLE","XLV","XLI","XLP","XLU","XLY","XLC","XLRE","XLB"],
                    max_positions: 5
                }
            },
            value_dividend: {
                name: "Dividend Hunter",
                description: "Focuses on undervalued dividend-paying stocks with strong fundamentals and sustainable payouts.",
                type: "value_dividend",
                config: {
                    min_dividend_yield: 0.02,
                    max_pe_ratio: 20,
                    rebalance_days: 30,
                    max_positions: 10
                }
            },
            volatility_breakout: {
                name: "Volatility Trader",
                description: "Exploits short-term price volatility by trading breakouts with tight risk management.",
                type: "volatility_breakout",
                config: {
                    atr_period: 14,
                    breakout_multiplier: 1.5,
                    volume_surge: 2.0,
                    max_hold_days: 5,
                    max_positions: 6
                }
            }
        };
    }

    /**
     * Initialize all 5 strategies if they don't exist
     */
    async initializeStrategies() {
        const db = getDb();
        
        for (const [key, strategyData] of Object.entries(this.strategyConfigs)) {
            // Check if strategy already exists
            const existing = db.prepare('SELECT id FROM strategies_v2 WHERE type = ?').get(strategyData.type);
            
            if (!existing) {
                const result = db.prepare(`
                    INSERT INTO strategies_v2 (name, description, type, config_json)
                    VALUES (?, ?, ?, ?)
                `).run(
                    strategyData.name,
                    strategyData.description,
                    strategyData.type,
                    JSON.stringify(strategyData.config)
                );

                console.log(`✅ Initialized strategy: ${strategyData.name} (ID: ${result.lastInsertRowid})`);
            }
        }
    }

    /**
     * Get comprehensive stats for a strategy
     */
    async getStrategyStats(strategyId) {
        const db = getDb();
        
        // Get strategy info
        const strategy = db.prepare('SELECT * FROM strategies_v2 WHERE id = ?').get(strategyId);
        if (!strategy) {
            throw new Error(`Strategy ${strategyId} not found`);
        }

        // Get current positions
        const positions = db.prepare(`
            SELECT * FROM strategy_positions 
            WHERE strategy_id = ? 
            ORDER BY opened_at DESC
        `).all(strategyId);

        // Calculate positions value
        const positionsValue = positions.reduce((sum, pos) => {
            return sum + (pos.quantity * (pos.current_price || pos.avg_entry_price));
        }, 0);

        // Get recent trades
        const recentTrades = db.prepare(`
            SELECT * FROM strategy_trades 
            WHERE strategy_id = ? 
            ORDER BY executed_at DESC 
            LIMIT 10
        `).all(strategyId);

        // Calculate total portfolio value
        const portfolioValue = strategy.cash_balance + positionsValue;
        const totalPnL = portfolioValue - strategy.starting_capital;
        const totalPnLPct = (totalPnL / strategy.starting_capital) * 100;

        // Get trade stats
        const tradeStats = db.prepare(`
            SELECT 
                COUNT(*) as total_trades,
                SUM(CASE WHEN pnl > 0 THEN 1 ELSE 0 END) as winning_trades,
                AVG(pnl) as avg_pnl,
                MAX(pnl) as max_win,
                MIN(pnl) as max_loss
            FROM strategy_trades 
            WHERE strategy_id = ? AND pnl IS NOT NULL
        `).get(strategyId);

        const winRate = tradeStats.total_trades > 0 ? 
            (tradeStats.winning_trades / tradeStats.total_trades) * 100 : 0;

        return {
            ...strategy,
            positions,
            recentTrades,
            stats: {
                portfolioValue,
                positionsValue,
                totalPnL,
                totalPnLPct,
                winRate,
                totalTrades: tradeStats.total_trades || 0,
                avgPnL: tradeStats.avg_pnl || 0,
                maxWin: tradeStats.max_win || 0,
                maxLoss: tradeStats.max_loss || 0,
                numPositions: positions.length
            }
        };
    }

    /**
     * Execute a virtual trade
     */
    async executeTrade(strategyId, symbol, side, quantity, price, reason = '') {
        const db = getDb();
        
        const strategy = db.prepare('SELECT * FROM strategies_v2 WHERE id = ?').get(strategyId);
        if (!strategy) {
            throw new Error(`Strategy ${strategyId} not found`);
        }

        const totalValue = quantity * price;
        let pnl = null;

        if (side === 'buy') {
            // Check if we have enough cash
            if (strategy.cash_balance < totalValue) {
                throw new Error(`Insufficient cash: need $${totalValue}, have $${strategy.cash_balance}`);
            }

            // Update cash balance
            db.prepare('UPDATE strategies_v2 SET cash_balance = cash_balance - ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
                .run(totalValue, strategyId);

            // Add or update position
            const existingPosition = db.prepare('SELECT * FROM strategy_positions WHERE strategy_id = ? AND symbol = ?')
                .get(strategyId, symbol);

            if (existingPosition) {
                // Update existing position with new average price
                const newQuantity = existingPosition.quantity + quantity;
                const newAvgPrice = ((existingPosition.quantity * existingPosition.avg_entry_price) + totalValue) / newQuantity;
                
                db.prepare(`
                    UPDATE strategy_positions 
                    SET quantity = ?, avg_entry_price = ?, updated_at = CURRENT_TIMESTAMP 
                    WHERE strategy_id = ? AND symbol = ?
                `).run(newQuantity, newAvgPrice, strategyId, symbol);
            } else {
                // Create new position
                db.prepare(`
                    INSERT INTO strategy_positions (strategy_id, symbol, quantity, avg_entry_price)
                    VALUES (?, ?, ?, ?)
                `).run(strategyId, symbol, quantity, price);
            }

        } else if (side === 'sell') {
            // Get existing position
            const position = db.prepare('SELECT * FROM strategy_positions WHERE strategy_id = ? AND symbol = ?')
                .get(strategyId, symbol);

            if (!position) {
                throw new Error(`No position found for ${symbol}`);
            }

            if (position.quantity < quantity) {
                throw new Error(`Cannot sell ${quantity} shares, only have ${position.quantity}`);
            }

            // Calculate P&L
            pnl = (price - position.avg_entry_price) * quantity;

            // Update cash balance
            db.prepare('UPDATE strategies_v2 SET cash_balance = cash_balance + ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
                .run(totalValue, strategyId);

            // Update or remove position
            if (position.quantity === quantity) {
                // Remove entire position
                db.prepare('DELETE FROM strategy_positions WHERE strategy_id = ? AND symbol = ?')
                    .run(strategyId, symbol);
            } else {
                // Partial sell - update quantity
                db.prepare(`
                    UPDATE strategy_positions 
                    SET quantity = quantity - ?, updated_at = CURRENT_TIMESTAMP 
                    WHERE strategy_id = ? AND symbol = ?
                `).run(quantity, strategyId, symbol);
            }
        }

        // Record the trade
        const tradeResult = db.prepare(`
            INSERT INTO strategy_trades (strategy_id, symbol, side, quantity, price, total_value, reason, pnl)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `).run(strategyId, symbol, side, quantity, price, totalValue, reason, pnl);

        // Check for notable events
        await this.checkForEvents(strategyId, { trade: { side, symbol, pnl, totalValue } });

        return {
            tradeId: tradeResult.lastInsertRowid,
            pnl
        };
    }

    /**
     * Update current prices for all positions (mock implementation - would use Alpaca API in real system)
     */
    async updatePrices(strategyId) {
        const db = getDb();
        
        const positions = db.prepare('SELECT * FROM strategy_positions WHERE strategy_id = ?').all(strategyId);
        
        for (const position of positions) {
            // Mock price update - in real system, fetch from Alpaca
            const priceChange = (Math.random() - 0.5) * 0.02; // Random +/- 1%
            const newPrice = position.avg_entry_price * (1 + priceChange);
            const unrealizedPL = (newPrice - position.avg_entry_price) * position.quantity;
            
            db.prepare(`
                UPDATE strategy_positions 
                SET current_price = ?, unrealized_pl = ?, updated_at = CURRENT_TIMESTAMP 
                WHERE id = ?
            `).run(newPrice, unrealizedPL, position.id);
        }
    }

    /**
     * Take a snapshot of current portfolio state
     */
    async takeSnapshot(strategyId) {
        const db = getDb();
        
        const stats = await this.getStrategyStats(strategyId);
        
        const result = db.prepare(`
            INSERT INTO strategy_snapshots 
            (strategy_id, portfolio_value, cash_balance, positions_value, total_pnl, total_pnl_pct, num_positions)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        `).run(
            strategyId,
            stats.stats.portfolioValue,
            stats.cash_balance,
            stats.stats.positionsValue,
            stats.stats.totalPnL,
            stats.stats.totalPnLPct,
            stats.stats.numPositions
        );

        return result.lastInsertRowid;
    }

    /**
     * Check for notable events and record them
     */
    async checkForEvents(strategyId, context = {}) {
        const db = getDb();
        
        if (context.trade && context.trade.pnl) {
            const { pnl, side, symbol, totalValue } = context.trade;
            
            // Big win (>$1000 profit on single trade)
            if (pnl > 1000) {
                db.prepare(`
                    INSERT INTO strategy_events (strategy_id, event_type, title, description, value)
                    VALUES (?, ?, ?, ?, ?)
                `).run(
                    strategyId,
                    'big_win',
                    `🎉 Big Win on ${symbol}`,
                    `Sold ${symbol} for a profit of $${pnl.toFixed(2)}`,
                    pnl
                );
            }
            
            // Big loss (>$1000 loss on single trade)
            if (pnl < -1000) {
                db.prepare(`
                    INSERT INTO strategy_events (strategy_id, event_type, title, description, value)
                    VALUES (?, ?, ?, ?, ?)
                `).run(
                    strategyId,
                    'big_loss',
                    `📉 Significant Loss on ${symbol}`,
                    `Sold ${symbol} for a loss of $${Math.abs(pnl).toFixed(2)}`,
                    pnl
                );
            }
        }

        // Check for portfolio milestones
        const stats = await this.getStrategyStats(strategyId);
        const { totalPnL, portfolioValue } = stats.stats;
        
        // First profit milestone
        if (totalPnL > 0) {
            const existingProfit = db.prepare(`
                SELECT id FROM strategy_events 
                WHERE strategy_id = ? AND event_type = 'milestone' AND title LIKE '%first profit%'
            `).get(strategyId);
            
            if (!existingProfit) {
                db.prepare(`
                    INSERT INTO strategy_events (strategy_id, event_type, title, description, value)
                    VALUES (?, ?, ?, ?, ?)
                `).run(
                    strategyId,
                    'milestone',
                    '💰 First Profit Achieved',
                    `Portfolio reached profitability with $${totalPnL.toFixed(2)} in gains`,
                    totalPnL
                );
            }
        }

        // $10k profit milestone
        if (totalPnL > 10000) {
            const existing10k = db.prepare(`
                SELECT id FROM strategy_events 
                WHERE strategy_id = ? AND event_type = 'milestone' AND title LIKE '%10,000%'
            `).get(strategyId);
            
            if (!existing10k) {
                db.prepare(`
                    INSERT INTO strategy_events (strategy_id, event_type, title, description, value)
                    VALUES (?, ?, ?, ?, ?)
                `).run(
                    strategyId,
                    'milestone',
                    '🚀 $10,000 Profit Milestone',
                    `Portfolio profits exceeded $10,000 (current: $${totalPnL.toFixed(2)})`,
                    totalPnL
                );
            }
        }
    }
}

module.exports = new StrategyEngine();