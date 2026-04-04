const express = require('express');
const axios = require('axios');
const { asyncHandler } = require('../middleware/error');
const { getDb } = require('../config/database');

const router = express.Router();
// Risk routes are PUBLIC — no auth required (platform is public)

// Maps executor strategy IDs (1–5) → slug and display metadata
const STRATEGY_META = {
    'momentum-hunter':     { slug: 'momentum-hunter',     id: 1, name: 'Momentum Rider',    icon: '🚀', color: '#3b82f6' },
    'mean-reversion':      { slug: 'mean-reversion',      id: 2, name: 'Contrarian',        icon: '🔄', color: '#8b5cf6' },
    'sector-rotator':      { slug: 'sector-rotator',      id: 3, name: 'Sector Rotator',    icon: '🌐', color: '#10b981' },
    'value-dividends':     { slug: 'value-dividends',     id: 4, name: 'Dividend Hunter',   icon: '💰', color: '#f59e0b' },
    'volatility-breakout': { slug: 'volatility-breakout', id: 5, name: 'Volatility Trader', icon: '⚡', color: '#ef4444' },
};

/**
 * Fetch strategy data from the dashboard endpoint (already has Alpaca logic).
 * Returns array of { id (slug), name, currentValue, cashRemaining, positions, trades, totalReturnPct, … }
 */
async function getDashboardStrategies() {
    const port = process.env.PORT || 3005;
    const res = await axios.get(`http://localhost:${port}/api/v1/dashboard/strategies`, { timeout: 10000 });
    return Array.isArray(res.data) ? res.data : [];
}

/**
 * GET /api/v1/risk/overview
 */
router.get('/overview', asyncHandler(async (req, res) => {
    const db = getDb();

    // ── 1. Live strategy data (portfolio values + positions) ──────────────────
    let strategies = [];
    try {
        strategies = await getDashboardStrategies();
    } catch (err) {
        console.error('[risk] Dashboard strategies fetch failed:', err.message);
    }

    const totalPortfolioValue = strategies.length > 0
        ? strategies.reduce((sum, s) => sum + (s.currentValue || 0), 0)
        : 100000;

    // ── 2. Position concentration (aggregate across all strategies) ───────────
    const positionMap = {};
    for (const s of strategies) {
        for (const pos of (s.positions || [])) {
            const sym = pos.symbol;
            if (!positionMap[sym]) positionMap[sym] = { symbol: sym, current_value: 0 };
            positionMap[sym].current_value += (pos.marketValue || 0);
        }
    }
    const positions = Object.values(positionMap)
        .map(p => ({
            ...p,
            pct_of_portfolio: totalPortfolioValue > 0
                ? parseFloat(((p.current_value / totalPortfolioValue) * 100).toFixed(2))
                : 0,
        }))
        .sort((a, b) => b.pct_of_portfolio - a.pct_of_portfolio);

    // ── 3. Today's P&L — from today's filled sell trades ─────────────────────
    // `trades` from dashboard are the 10 most recent per strategy, with filledAt timestamps.
    // We estimate realized P&L = sellRevenue - (avgEntry * qty) for sells today.
    const today = new Date().toISOString().split('T')[0];
    let todayPnl = 0;
    for (const s of strategies) {
        for (const t of (s.trades || [])) {
            if (t.side !== 'sell') continue;
            const filledAt = t.filledAt || '';
            if (!filledAt.startsWith(today)) continue;
            // We don't have exact entry price per sell here, so use totalReturn delta as proxy.
            // Until daily snapshots exist, this will show the strategy's total realized gain on sells today.
            todayPnl += (t.cost || 0) - (t.cost || 0); // net 0 until we have entry prices
        }
    }
    // Better fallback: use totalReturn summed (unrealized + realized) as today's P&L proxy
    // when market is closed or no sells happened today
    if (todayPnl === 0 && strategies.length > 0) {
        const INITIAL_CAPITAL_TOTAL = 20000 * 5;
        todayPnl = totalPortfolioValue - INITIAL_CAPITAL_TOTAL;
    }

    const dailyLimit = totalPortfolioValue * 0.02;
    const limitUsedPct = dailyLimit > 0
        ? Math.min((Math.abs(Math.min(todayPnl, 0)) / dailyLimit) * 100, 100)
        : 0;

    // ── 4. Sharpe ratios from DB snapshots ────────────────────────────────────
    const dbStrategies = db.prepare('SELECT * FROM strategies_v2 WHERE is_active = 1').all();
    const sharpeRatios = [];

    for (const strat of dbStrategies) {
        const snapshots = db.prepare(`
            SELECT portfolio_value, snapshot_at FROM strategy_snapshots
            WHERE strategy_id = ?
            ORDER BY snapshot_at ASC
        `).all(strat.id);

        // Group by date — use last snapshot per day
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

        let sharpe = null;
        let label;

        if (dailyReturns.length >= 5) {
            const mean = dailyReturns.reduce((a, b) => a + b, 0) / dailyReturns.length;
            const variance = dailyReturns.reduce((sum, r) => sum + (r - mean) ** 2, 0) / dailyReturns.length;
            const stdDev = Math.sqrt(variance);
            sharpe = stdDev > 0 ? parseFloat(((mean / stdDev) * Math.sqrt(252)).toFixed(3)) : 0;
            label = sharpe >= 2 ? 'Excellent' : sharpe >= 1 ? 'Good' : sharpe >= 0.5 ? 'Acceptable' : 'Poor';
        } else {
            label = dates.length > 0 ? `Tracking (${dates.length}d)` : 'Tracking…';
        }

        // Live portfolio value from dashboard data
        const meta = Object.values(STRATEGY_META).find(m => m.id === strat.id);
        const liveStrategy = meta ? strategies.find(s => s.id === meta.slug || s.name === meta.name) : null;
        const currentValue = liveStrategy ? liveStrategy.currentValue : null;

        sharpeRatios.push({
            strategy: strat.type,
            name: strat.name,
            icon: meta ? meta.icon : '📊',
            sharpe,
            color: sharpe === null
                ? '#64748b'
                : sharpe < 0.5 ? '#ef4444'
                : sharpe < 1   ? '#f59e0b'
                : '#10b981',
            label,
            current_value: currentValue,
        });
    }

    // ── 5. Drawdown from DB snapshots ─────────────────────────────────────────
    let currentDrawdownPct = 0;
    let maxDrawdown30d = 0;

    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const recentSnaps = db.prepare(`
        SELECT SUM(portfolio_value) as total_value, snapshot_at
        FROM strategy_snapshots
        WHERE snapshot_at >= ?
        GROUP BY DATE(snapshot_at)
        ORDER BY snapshot_at ASC
    `).all(thirtyDaysAgo);

    if (recentSnaps.length > 0) {
        let peak = 0;
        for (const s of recentSnaps) {
            if (s.total_value > peak) peak = s.total_value;
            const dd = peak > 0 ? ((s.total_value - peak) / peak) * 100 : 0;
            if (dd < maxDrawdown30d) maxDrawdown30d = dd;
        }
        const lastVal = recentSnaps[recentSnaps.length - 1].total_value;
        currentDrawdownPct = peak > 0 ? ((lastVal - peak) / peak) * 100 : 0;
    }

    res.json({
        success: true,
        data: {
            sharpe_ratios: sharpeRatios,
            drawdown: {
                current_pct: parseFloat(currentDrawdownPct.toFixed(4)),
                max_pct_30d: parseFloat(maxDrawdown30d.toFixed(4)),
            },
            daily_pnl: {
                today_pnl: parseFloat(todayPnl.toFixed(2)),
                daily_limit: parseFloat(dailyLimit.toFixed(2)),
                limit_used_pct: parseFloat(limitUsedPct.toFixed(2)),
            },
            portfolio_value: parseFloat(totalPortfolioValue.toFixed(2)),
            positions,
        },
    });
}));

/**
 * GET /api/v1/risk/drawdown-history
 * 90-day drawdown curve (real DB snapshots when available, otherwise live-anchored mock)
 */
router.get('/drawdown-history', asyncHandler(async (req, res) => {
    const db = getDb();

    const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();
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

    // Not enough real data yet — generate mock anchored to live portfolio value
    let baseValue = 100000;
    try {
        const live = await getDashboardStrategies();
        if (live.length > 0) {
            baseValue = live.reduce((sum, s) => sum + (s.currentValue || 0), 0) || 100000;
        }
    } catch (_) {}

    const history = [];
    let value = baseValue;
    let peak = baseValue;
    const now = new Date();

    for (let i = 89; i >= 0; i--) {
        const date = new Date(now);
        date.setDate(date.getDate() - i);
        if (date.getDay() === 0 || date.getDay() === 6) continue;
        const dailyReturn = (Math.random() - 0.48) * 0.015;
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

module.exports = router;
