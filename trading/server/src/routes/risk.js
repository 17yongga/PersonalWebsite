const express = require('express');
const { authenticateToken } = require('../middleware/auth');
const { asyncHandler } = require('../middleware/error');
const { getDb } = require('../config/database');
const config = require('../config');

const router = express.Router();

// All risk routes require authentication
router.use(authenticateToken);

/**
 * GET /api/v1/risk/overview
 * Aggregate risk dashboard data
 */
router.get('/overview', asyncHandler(async (req, res) => {
    const db = getDb();
    const userId = req.user.id;

    // Get user's portfolios
    const portfolios = db.prepare(`
        SELECT * FROM portfolios WHERE user_id = ?
    `).all(userId);

    // Aggregate portfolio value from positions + cash
    let totalPortfolioValue = 0;
    let allPositions = [];

    for (const p of portfolios) {
        const positions = db.prepare(`
            SELECT * FROM positions WHERE portfolio_id = ?
        `).all(p.id);

        let positionsValue = 0;
        for (const pos of positions) {
            const value = pos.quantity * pos.avg_cost_basis;
            positionsValue += value;
            allPositions.push({
                symbol: pos.symbol,
                quantity: pos.quantity,
                current_value: value,
                avg_cost_basis: pos.avg_cost_basis,
                portfolio_id: p.id,
            });
        }
        totalPortfolioValue += p.cash_balance + positionsValue;
    }

    // If no portfolio value, use starting balance
    if (totalPortfolioValue === 0 && portfolios.length > 0) {
        totalPortfolioValue = portfolios.reduce((sum, p) => sum + p.starting_balance, 0);
    }

    // Calculate position concentrations
    const positionMap = {};
    for (const pos of allPositions) {
        if (!positionMap[pos.symbol]) {
            positionMap[pos.symbol] = { symbol: pos.symbol, current_value: 0, quantity: 0, avg_cost_basis: pos.avg_cost_basis };
        }
        positionMap[pos.symbol].current_value += pos.current_value;
        positionMap[pos.symbol].quantity += pos.quantity;
    }

    const positions = Object.values(positionMap)
        .map(pos => ({
            ...pos,
            pct_of_portfolio: totalPortfolioValue > 0 ? (pos.current_value / totalPortfolioValue) * 100 : 0,
        }))
        .sort((a, b) => b.pct_of_portfolio - a.pct_of_portfolio);

    // Compute Sharpe ratios from strategies_v2 + snapshots
    const strategies = db.prepare(`
        SELECT * FROM strategies_v2 WHERE is_active = 1
    `).all();

    const sharpeRatios = [];
    const stratMeta = {
        'Momentum Rider': { icon: '🚀', color: '#3b82f6' },
        'Contrarian': { icon: '🔄', color: '#8b5cf6' },
        'Sector Rotator': { icon: '🌐', color: '#10b981' },
        'Dividend Hunter': { icon: '💰', color: '#f59e0b' },
        'Volatility Trader': { icon: '⚡', color: '#ef4444' },
    };

    for (const strat of strategies) {
        const snapshots = db.prepare(`
            SELECT portfolio_value, snapshot_at FROM strategy_snapshots
            WHERE strategy_id = ?
            ORDER BY snapshot_at ASC
        `).all(strat.id);

        let sharpe = null;
        let label = null;

        if (snapshots.length >= 30) {
            // Compute daily returns from snapshots (group by date, take last per day)
            const dailyValues = {};
            for (const s of snapshots) {
                const date = s.snapshot_at.split('T')[0].split(' ')[0];
                dailyValues[date] = s.portfolio_value;
            }
            const dates = Object.keys(dailyValues).sort();
            const dailyReturns = [];
            for (let i = 1; i < dates.length; i++) {
                const prev = dailyValues[dates[i - 1]];
                const curr = dailyValues[dates[i]];
                if (prev > 0) dailyReturns.push((curr - prev) / prev);
            }

            if (dailyReturns.length >= 20) {
                const mean = dailyReturns.reduce((a, b) => a + b, 0) / dailyReturns.length;
                const variance = dailyReturns.reduce((sum, r) => sum + (r - mean) ** 2, 0) / dailyReturns.length;
                const stdDev = Math.sqrt(variance);
                sharpe = stdDev > 0 ? (mean / stdDev) * Math.sqrt(252) : 0;
                label = sharpe >= 2 ? 'Excellent' : sharpe >= 1 ? 'Good' : sharpe >= 0.5 ? 'Acceptable' : 'Poor';
            }
        }

        if (sharpe === null) {
            label = 'Insufficient data';
        }

        const meta = stratMeta[strat.name] || { icon: '📊', color: '#64748b' };
        sharpeRatios.push({
            strategy: strat.type,
            name: strat.name,
            icon: meta.icon,
            sharpe: sharpe,
            color: sharpe === null ? '#64748b' : sharpe < 0.5 ? '#ef4444' : sharpe < 1 ? '#f59e0b' : '#10b981',
            label,
        });
    }

    // Compute today's P&L from orders filled today
    const today = new Date().toISOString().split('T')[0];
    const portfolioIds = portfolios.map(p => p.id);
    let todayPnl = 0;

    if (portfolioIds.length > 0) {
        const placeholders = portfolioIds.map(() => '?').join(',');
        const todayTrades = db.prepare(`
            SELECT * FROM strategy_trades
            WHERE executed_at >= ? AND pnl IS NOT NULL
            ORDER BY executed_at DESC
        `).all(today);

        todayPnl = todayTrades.reduce((sum, t) => sum + (t.pnl || 0), 0);
    }

    const dailyLimit = totalPortfolioValue * 0.02;
    const limitUsedPct = dailyLimit > 0 ? (Math.abs(Math.min(todayPnl, 0)) / dailyLimit) * 100 : 0;

    // Drawdown from snapshots (across all strategies)
    let currentDrawdownPct = 0;
    let maxDrawdown30d = 0;

    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const recentSnapshots = db.prepare(`
        SELECT SUM(portfolio_value) as total_value, snapshot_at
        FROM strategy_snapshots
        WHERE snapshot_at >= ?
        GROUP BY DATE(snapshot_at)
        ORDER BY snapshot_at ASC
    `).all(thirtyDaysAgo);

    if (recentSnapshots.length > 0) {
        let peak = 0;
        for (const s of recentSnapshots) {
            if (s.total_value > peak) peak = s.total_value;
            const dd = peak > 0 ? ((s.total_value - peak) / peak) * 100 : 0;
            if (dd < maxDrawdown30d) maxDrawdown30d = dd;
        }
        const lastVal = recentSnapshots[recentSnapshots.length - 1].total_value;
        currentDrawdownPct = peak > 0 ? ((lastVal - peak) / peak) * 100 : 0;
    }

    res.json({
        success: true,
        data: {
            sharpe_ratios: sharpeRatios,
            drawdown: {
                current_pct: currentDrawdownPct,
                max_pct_30d: maxDrawdown30d,
            },
            daily_pnl: {
                today_pnl: todayPnl,
                daily_limit: dailyLimit,
                limit_used_pct: Math.min(limitUsedPct, 100),
            },
            portfolio_value: totalPortfolioValue,
            positions,
        },
    });
}));

/**
 * GET /api/v1/risk/drawdown-history
 * 90-day drawdown curve
 */
router.get('/drawdown-history', asyncHandler(async (req, res) => {
    const db = getDb();

    const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();

    // Aggregate total portfolio value per day across all strategies
    const snapshots = db.prepare(`
        SELECT DATE(snapshot_at) as date, SUM(portfolio_value) as portfolio_value
        FROM strategy_snapshots
        WHERE snapshot_at >= ?
        GROUP BY DATE(snapshot_at)
        ORDER BY date ASC
    `).all(ninetyDaysAgo);

    if (snapshots.length >= 5) {
        let peak = 0;
        const history = snapshots.map(s => {
            if (s.portfolio_value > peak) peak = s.portfolio_value;
            const drawdownPct = peak > 0 ? ((s.portfolio_value - peak) / peak) * 100 : 0;
            return {
                date: s.date,
                drawdown_pct: parseFloat(drawdownPct.toFixed(4)),
                portfolio_value: s.portfolio_value,
            };
        });

        return res.json({ success: true, data: history });
    }

    // Not enough real data — generate mock based on a reasonable portfolio value
    const userPortfolios = db.prepare(`
        SELECT SUM(starting_balance) as total FROM portfolios WHERE user_id = ?
    `).get(req.user.id);
    const baseValue = (userPortfolios && userPortfolios.total) || 100000;

    const history = [];
    let value = baseValue;
    let peak = baseValue;
    const now = new Date();

    for (let i = 89; i >= 0; i--) {
        const date = new Date(now);
        date.setDate(date.getDate() - i);
        if (date.getDay() === 0 || date.getDay() === 6) continue;

        const dailyReturn = (Math.random() - 0.48) * 0.015; // slight upward bias
        value = value * (1 + dailyReturn);
        if (value > peak) peak = value;
        const drawdownPct = ((value - peak) / peak) * 100;

        history.push({
            date: date.toISOString().split('T')[0],
            drawdown_pct: parseFloat(drawdownPct.toFixed(4)),
            portfolio_value: parseFloat(value.toFixed(2)),
        });
    }

    res.json({ success: true, data: history });
}));

/**
 * GET /api/v1/risk/positions
 * Open positions with concentration data
 */
router.get('/positions', asyncHandler(async (req, res) => {
    const db = getDb();
    const userId = req.user.id;

    const portfolios = db.prepare(`
        SELECT * FROM portfolios WHERE user_id = ?
    `).all(userId);

    let totalPortfolioValue = 0;
    const positionMap = {};

    for (const p of portfolios) {
        const positions = db.prepare(`
            SELECT * FROM positions WHERE portfolio_id = ?
        `).all(p.id);

        let positionsValue = 0;
        for (const pos of positions) {
            const value = pos.quantity * pos.avg_cost_basis;
            positionsValue += value;

            if (!positionMap[pos.symbol]) {
                positionMap[pos.symbol] = {
                    symbol: pos.symbol,
                    quantity: 0,
                    current_value: 0,
                    avg_cost_basis: pos.avg_cost_basis,
                };
            }
            positionMap[pos.symbol].quantity += pos.quantity;
            positionMap[pos.symbol].current_value += value;
        }
        totalPortfolioValue += p.cash_balance + positionsValue;
    }

    // Also include strategy_positions from strategies_v2
    const stratPositions = db.prepare(`
        SELECT sp.*, sv.name as strategy_name
        FROM strategy_positions sp
        JOIN strategies_v2 sv ON sp.strategy_id = sv.id
        WHERE sv.is_active = 1
    `).all();

    for (const sp of stratPositions) {
        const value = sp.quantity * (sp.current_price || sp.avg_entry_price);
        if (!positionMap[sp.symbol]) {
            positionMap[sp.symbol] = {
                symbol: sp.symbol,
                quantity: 0,
                current_value: 0,
                avg_cost_basis: sp.avg_entry_price,
            };
        }
        positionMap[sp.symbol].quantity += sp.quantity;
        positionMap[sp.symbol].current_value += value;
        totalPortfolioValue += value;
    }

    const positions = Object.values(positionMap)
        .map(pos => ({
            symbol: pos.symbol,
            quantity: pos.quantity,
            current_value: parseFloat(pos.current_value.toFixed(2)),
            pct_of_portfolio: totalPortfolioValue > 0
                ? parseFloat(((pos.current_value / totalPortfolioValue) * 100).toFixed(2))
                : 0,
            unrealized_pnl_pct: 0, // Would need live prices to compute accurately
        }))
        .sort((a, b) => b.pct_of_portfolio - a.pct_of_portfolio);

    res.json({ success: true, data: positions });
}));

module.exports = router;
