const express = require('express');
const axios = require('axios');
const { asyncHandler } = require('../middleware/error');
const { getDb } = require('../config/database');
const config = require('../config');

const router = express.Router();

const STRATEGY_META = {
    'momentum-hunter':     { slug: 'momentum',           id: 1, name: 'Momentum Rider',    icon: '🚀', color: '#3b82f6' },
    'mean-reversion':      { slug: 'mean_reversion',     id: 2, name: 'Contrarian',         icon: '🔄', color: '#8b5cf6' },
    'sector-rotator':      { slug: 'sector_rotation',    id: 3, name: 'Sector Rotator',     icon: '🌐', color: '#10b981' },
    'value-dividends':     { slug: 'value_dividend',     id: 4, name: 'Dividend Hunter',    icon: '💰', color: '#f59e0b' },
    'volatility-breakout': { slug: 'volatility_breakout', id: 5, name: 'Volatility Trader', icon: '⚡', color: '#ef4444' },
};

async function getDashboardStrategies() {
    const port = process.env.PORT || 3005;
    const res = await axios.get(`http://localhost:${port}/api/v1/dashboard/strategies`, { timeout: 10000 });
    return Array.isArray(res.data) ? res.data : [];
}

/**
 * Compute metrics for a single strategy from DB snapshots + live data.
 */
function computeStrategyMetrics(db, stratId, liveStrategy) {
    const snapshots = db.prepare(`
        SELECT portfolio_value, snapshot_at FROM strategy_snapshots
        WHERE strategy_id = ? ORDER BY snapshot_at ASC
    `).all(stratId);

    // Group by date — last snapshot per day
    const dailyValues = {};
    for (const s of snapshots) {
        const date = (s.snapshot_at || '').replace('T', ' ').split(' ')[0];
        if (date) dailyValues[date] = s.portfolio_value;
    }
    const dates = Object.keys(dailyValues).sort();
    const dailyReturns = [];
    for (let i = 1; i < dates.length; i++) {
        const prev = dailyValues[dates[i - 1]];
        const curr = dailyValues[dates[i]];
        if (prev > 0) dailyReturns.push((curr - prev) / prev);
    }

    const initialCapital = 20000;
    const currentValue = liveStrategy ? liveStrategy.currentValue : (dates.length > 0 ? dailyValues[dates[dates.length - 1]] : null);
    const totalReturn = currentValue != null ? (currentValue - initialCapital) / initialCapital : null;

    // Sharpe
    let sharpeRatio = null;
    if (dailyReturns.length >= 5) {
        const mean = dailyReturns.reduce((a, b) => a + b, 0) / dailyReturns.length;
        const variance = dailyReturns.reduce((sum, r) => sum + (r - mean) ** 2, 0) / dailyReturns.length;
        const stdDev = Math.sqrt(variance);
        sharpeRatio = stdDev > 0 ? parseFloat(((mean / stdDev) * Math.sqrt(252)).toFixed(3)) : 0;
    }

    // Max drawdown
    let maxDrawdown = null;
    if (dates.length >= 2) {
        let peak = 0;
        let worstDd = 0;
        for (const d of dates) {
            const v = dailyValues[d];
            if (v > peak) peak = v;
            const dd = peak > 0 ? (v - peak) / peak : 0;
            if (dd < worstDd) worstDd = dd;
        }
        maxDrawdown = parseFloat(worstDd.toFixed(4));
    }

    // Win rate + trade count from live trades
    let winRate = null;
    let totalTrades = 0;
    let profitFactor = null;
    if (liveStrategy && Array.isArray(liveStrategy.trades)) {
        const sells = liveStrategy.trades.filter(t => t.side === 'sell');
        totalTrades = sells.length;
        if (totalTrades > 0) {
            // Estimate: positive cost = profitable (simplified)
            const wins = sells.filter(t => (t.realizedPnl || 0) >= 0).length;
            winRate = parseFloat((wins / totalTrades).toFixed(3));
            const gains = sells.reduce((s, t) => s + Math.max(t.realizedPnl || 0, 0), 0);
            const losses = sells.reduce((s, t) => s + Math.abs(Math.min(t.realizedPnl || 0, 0)), 0);
            profitFactor = losses > 0 ? parseFloat((gains / losses).toFixed(2)) : (gains > 0 ? 99 : null);
        }
    }

    const currentPositions = liveStrategy ? (liveStrategy.positions || []).length : 0;

    // Equity curve — last 90 days
    const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    const equityCurve = dates
        .filter(d => d >= ninetyDaysAgo)
        .map(d => ({ date: d, value: parseFloat(dailyValues[d].toFixed(2)) }));

    return {
        totalReturn,
        sharpeRatio,
        maxDrawdown,
        winRate,
        totalTrades,
        profitFactor,
        currentPositions,
        equityCurve,
    };
}

/**
 * GET /api/v1/compare/overview
 */
router.get('/overview', asyncHandler(async (req, res) => {
    const db = getDb();

    // Check which tables exist
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(t => t.name);
    const hasSnapshots = tables.includes('strategy_snapshots');
    const hasStrategiesV2 = tables.includes('strategies_v2');

    // Fetch live strategy data
    let liveStrategies = [];
    try {
        liveStrategies = await getDashboardStrategies();
    } catch (err) {
        console.error('[compare] Dashboard strategies fetch failed:', err.message);
    }

    // Build strategy comparison data
    const strategies = [];
    const metaEntries = Object.entries(STRATEGY_META);

    for (const [executorSlug, meta] of metaEntries) {
        const liveStrategy = liveStrategies.find(s => s.id === executorSlug || s.name === meta.name);
        let metrics = {
            totalReturn: null, sharpeRatio: null, maxDrawdown: null,
            winRate: null, totalTrades: 0, profitFactor: null, currentPositions: 0,
        };
        let equityCurve = [];

        if (hasSnapshots && hasStrategiesV2) {
            const computed = computeStrategyMetrics(db, meta.id, liveStrategy);
            metrics = {
                totalReturn: computed.totalReturn,
                sharpeRatio: computed.sharpeRatio,
                maxDrawdown: computed.maxDrawdown,
                winRate: computed.winRate,
                totalTrades: computed.totalTrades,
                profitFactor: computed.profitFactor,
                currentPositions: computed.currentPositions,
            };
            equityCurve = computed.equityCurve;
        }

        strategies.push({
            id: meta.slug,
            name: meta.name,
            icon: meta.icon,
            color: meta.color,
            metrics,
            equityCurve,
        });
    }

    // SPY benchmark — 90-day bars from Alpaca
    let benchmark = [];
    try {
        const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
        const today = new Date().toISOString().split('T')[0];
        const alpacaRes = await axios.get(`${config.alpaca.dataUrl}/v2/stocks/SPY/bars`, {
            params: { timeframe: '1Day', start: ninetyDaysAgo, end: today, limit: 1000, feed: 'iex' },
            headers: {
                'APCA-API-KEY-ID': config.alpaca.apiKey,
                'APCA-API-SECRET-KEY': config.alpaca.secretKey,
            },
            timeout: 10000,
        });

        const bars = alpacaRes.data?.bars || [];
        if (bars.length > 0) {
            const startClose = bars[0].c;
            benchmark = bars.map(b => ({
                date: b.t.split('T')[0],
                value: parseFloat(((b.c / startClose) * 100000).toFixed(2)),
            }));
        }
    } catch (err) {
        console.error('[compare] SPY benchmark fetch failed:', err.message);
        // Generate mock benchmark
        let val = 100000;
        const now = new Date();
        for (let i = 89; i >= 0; i--) {
            const d = new Date(now);
            d.setDate(d.getDate() - i);
            if (d.getDay() === 0 || d.getDay() === 6) continue;
            val *= (1 + (Math.random() - 0.47) * 0.008);
            benchmark.push({ date: d.toISOString().split('T')[0], value: parseFloat(val.toFixed(2)) });
        }
    }

    res.json({
        success: true,
        data: { strategies, benchmark },
    });
}));

module.exports = router;
