const express = require('express');
const { asyncHandler } = require('../middleware/error');
const { getDb } = require('../config/database');
const axios = require('axios');

const router = express.Router();

// Alpaca API Configuration
const ALPACA_CONFIG = {
    API_KEY: process.env.ALPACA_API_KEY,
    SECRET_KEY: process.env.ALPACA_SECRET_KEY,
    BASE_URL: process.env.ALPACA_BASE_URL || 'https://paper-api.alpaca.markets/v2'
};

// Strategy slug to prefix mapping (for client_order_id filtering)
const STRATEGY_SLUGS = {
    'momentum-hunter': 'mh',
    'mean-reversion': 'mr', 
    'sector-rotator': 'sr',
    'value-dividends': 'vd',
    'volatility-breakout': 'vb'
};

/**
 * Helper function to make Alpaca API requests
 */
async function alpacaRequest(endpoint, method = 'GET', data = null) {
    const config = {
        method,
        url: `${ALPACA_CONFIG.BASE_URL}${endpoint}`,
        headers: {
            'APCA-API-KEY-ID': ALPACA_CONFIG.API_KEY,
            'APCA-API-SECRET-KEY': ALPACA_CONFIG.SECRET_KEY,
            'Content-Type': 'application/json'
        }
    };
    
    if (data) {
        config.data = data;
    }
    
    try {
        const response = await axios(config);
        return response.data;
    } catch (error) {
        console.error(`Alpaca API error on ${endpoint}:`, error.response?.data || error.message);
        throw error;
    }
}

/**
 * Get Alpaca positions and orders, calculate P&L for each strategy
 */
async function getAlpacaStrategyData() {
    try {
        // Fetch all positions and orders from Alpaca
        const [positions, orders] = await Promise.all([
            alpacaRequest('/positions'),
            alpacaRequest('/orders?status=all&limit=500')
        ]);
        
        const strategies = {};
        const INITIAL_CAPITAL = 20000; // $20K per strategy
        
        // Initialize strategy data
        Object.keys(STRATEGY_SLUGS).forEach(slug => {
            strategies[slug] = {
                id: slug,
                name: slug.split('-').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' '),
                currentValue: INITIAL_CAPITAL,
                totalReturn: 0,
                totalReturnPct: 0,
                totalPnl: 0,
                totalPnlPercent: 0,
                positionsCount: 0,
                tradeCount: 0,
                cashRemaining: INITIAL_CAPITAL,
                trades: [],        // Recent trades for display
                positions: []      // Current positions for display
            };
        });
        
        // Build a live price map from Alpaca positions (symbol → current price)
        const livePriceMap = {};
        positions.forEach(p => {
            livePriceMap[p.symbol] = parseFloat(p.current_price || 0);
        });

        // Sort orders chronologically (oldest first) — critical for correct position tracking.
        // Alpaca returns newest-first by default; if we process sells before their matching buys,
        // position quantities will be wrong (e.g. cyclic buy→sell→buy strategies like SR).
        const ordersChronological = [...orders].sort((a, b) => {
            const tA = new Date(a.filled_at || a.created_at).getTime();
            const tB = new Date(b.filled_at || b.created_at).getTime();
            return tA - tB;
        });

        // Initialize per-strategy owned quantity tracking (separate from Alpaca's aggregated positions)
        // Bug fix: Alpaca aggregates shares from all strategies into one position per symbol.
        // We MUST track each strategy's own share count from its own order history.
        Object.keys(STRATEGY_SLUGS).forEach(slug => {
            strategies[slug].ownedQty = {}; // { symbol: { qty, totalCost } }
            strategies[slug].realizedPnl = 0; // Track P&L from closed trades
            strategies[slug].winTrades = 0;
            strategies[slug].lossTrades = 0;
        });

        // Process filled orders per strategy — track cash flow AND per-strategy owned quantities
        // Use chronological order so buy→sell→buy cycles are tracked correctly
        ordersChronological.forEach(order => {
            const clientOrderId = order.client_order_id || '';
            const prefix = clientOrderId.split('-')[0];
            const strategySlug = Object.keys(STRATEGY_SLUGS).find(slug => STRATEGY_SLUGS[slug] === prefix);
            
            if (!strategySlug || order.status !== 'filled') return;
            
            const symbol = order.symbol;
            const qty = parseFloat(order.filled_qty || 0);
            const price = parseFloat(order.filled_avg_price || 0);
            const cost = qty * price;
            const s = strategies[strategySlug];
            
            // Track cash: buys decrease cash, sells increase cash
            if (order.side === 'buy') {
                s.cashRemaining -= cost;
                // Track owned quantity for this strategy (not Alpaca's aggregated position)
                if (!s.ownedQty[symbol]) s.ownedQty[symbol] = { qty: 0, totalCost: 0 };
                s.ownedQty[symbol].qty += qty;
                s.ownedQty[symbol].totalCost += cost;
            } else {
                s.cashRemaining += cost;
                // Compute realized P&L for win rate tracking
                if (s.ownedQty[symbol] && s.ownedQty[symbol].qty > 0) {
                    const avgCost = s.ownedQty[symbol].totalCost / s.ownedQty[symbol].qty;
                    const pnl = (price - avgCost) * qty;
                    s.realizedPnl += pnl;
                    if (pnl > 0) s.winTrades++;
                    else s.lossTrades++;
                    // Reduce owned quantity
                    const costBasisRemoved = avgCost * qty;
                    s.ownedQty[symbol].qty -= qty;
                    s.ownedQty[symbol].totalCost -= costBasisRemoved;
                    if (s.ownedQty[symbol].qty <= 0.001) delete s.ownedQty[symbol];
                }
            }
            
            s.tradeCount++;
            
            // Store trade for display (most recent first)
            s.trades.push({
                symbol,
                side: order.side,
                qty,
                price,
                cost,
                filledAt: order.filled_at || order.created_at
            });
        });
        
        // Sort trades by time (newest first) and keep top 10 per strategy
        Object.values(strategies).forEach(s => {
            s.trades.sort((a, b) => new Date(b.filledAt) - new Date(a.filledAt));
            s.trades = s.trades.slice(0, 10);
        });
        
        // Build per-strategy positions from owned quantities + live prices
        // This correctly attributes only the shares each strategy actually purchased
        Object.entries(strategies).forEach(([slug, s]) => {
            Object.entries(s.ownedQty).forEach(([symbol, owned]) => {
                if (owned.qty <= 0.001) return;
                const currentPrice = livePriceMap[symbol] || (owned.totalCost / owned.qty);
                const avgEntry = owned.totalCost / owned.qty;
                const bookValue = owned.totalCost; // qty × avg_cost
                const marketValue = owned.qty * currentPrice;
                const unrealizedPl = marketValue - bookValue;
                s.positions.push({
                    symbol,
                    qty: owned.qty,
                    avgEntry:    Math.round(avgEntry    * 100) / 100,
                    currentPrice: Math.round(currentPrice * 100) / 100,
                    bookValue:   Math.round(bookValue   * 100) / 100,
                    marketValue: Math.round(marketValue * 100) / 100,
                    unrealizedPl: Math.round(unrealizedPl * 100) / 100
                });
            });
            s.positionsCount = s.positions.length;
        });
        
        // Calculate currentValue = cashRemaining + sum(own position market values)
        // With per-strategy position tracking, cash + own positions = correct portfolio value
        Object.values(strategies).forEach(s => {
            const positionValue = s.positions.reduce((sum, p) => sum + p.marketValue, 0);
            const rawValue = s.cashRemaining + positionValue;
            s.currentValue = Math.round(rawValue);
            
            const totalReturn = rawValue - INITIAL_CAPITAL;
            const totalReturnPct = (totalReturn / INITIAL_CAPITAL) * 100;
            
            s.totalReturn = Math.round(totalReturn * 100) / 100;
            s.totalReturnPct = Math.round(totalReturnPct * 100) / 100;
            s.totalPnl = s.totalReturn;
            s.totalPnlPercent = s.totalReturnPct;
            
            // Win rate: based on actual closed trades (sells with tracked P&L)
            const totalClosedTrades = s.winTrades + s.lossTrades;
            s.winRate = totalClosedTrades > 0
                ? Math.round((s.winTrades / totalClosedTrades) * 100)
                : 0;
        });

        // Third pass: add allocation % (using finalised currentValue) + round cashRemaining.
        // Allocation = what fraction of the total portfolio each holding represents.
        // Positions are sorted largest-allocation-first for readability.
        Object.values(strategies).forEach(s => {
            const total = s.currentValue || 1; // guard against zero
            s.positions.forEach(p => {
                p.allocation = Math.round((p.marketValue / total) * 1000) / 10; // 1 decimal %
            });
            // Sort positions by allocation descending
            s.positions.sort((a, b) => b.allocation - a.allocation);

            // Cash holding (always present, even when 0)
            s.cashRemaining    = Math.round(s.cashRemaining * 100) / 100;
            s.cashAllocation   = Math.round((s.cashRemaining / total) * 1000) / 10;
        });
        
        return Object.values(strategies);
        
    } catch (error) {
        console.error('Error fetching Alpaca strategy data:', error);
        throw error;
    }
}

// Public routes - no auth required

/**
 * GET /api/v1/dashboard/strategies
 * Direction B: Real Alpaca paper trading data for 5 competing strategies
 */
router.get('/strategies', asyncHandler(async (req, res) => {
    // Check if Alpaca credentials are available
    if (!ALPACA_CONFIG.API_KEY || !ALPACA_CONFIG.SECRET_KEY) {
        console.warn('Alpaca credentials not configured, using mock data');
        return res.json([]);
    }

    try {
        // Fetch real Alpaca strategy data
        const strategies = await getAlpacaStrategyData();
        
        // Sort by performance (totalReturnPct descending)
        strategies.sort((a, b) => b.totalReturnPct - a.totalReturnPct);
        
        // Add ranking — winRate is already computed correctly in getAlpacaStrategyData()
        strategies.forEach((strategy, index) => {
            strategy.rank = index + 1;
            strategy.createdAt = new Date().toISOString();
        });
        
        console.log(`Dashboard strategies: Returning ${strategies.length} real Alpaca strategies`);
        res.json(strategies);
        
    } catch (error) {
        console.error('Failed to fetch Alpaca strategy data:', error.message);
        // Return empty array to let frontend handle with mock data
        res.json([]);
    }
}));

/**
 * GET /api/v1/dashboard/summary
 * Overall platform summary stats (public)
 */
router.get('/summary', asyncHandler(async (req, res) => {
    const db = getDb();

    let summary = {
        totalPortfolios: 0,
        totalTrades: 0,
        totalVolume: 0,
        bestReturn: 0,
        uptime: '99.9%',
        strategiesActive: 5
    };

    try {
        const portfolioStats = db.prepare(`
            SELECT COUNT(*) as count, 
                   MAX((SELECT total_pnl_pct FROM strategy_snapshots 
                        WHERE strategy_id = s.id 
                        ORDER BY snapshot_at DESC LIMIT 1)) as best_return
            FROM strategies_v2 s
            WHERE s.is_active = 1
        `).get();

        const tradeStats = db.prepare(`
            SELECT COUNT(*) as count, SUM(ABS(total_value)) as volume
            FROM strategy_trades
        `).get();

        const activeStrategies = db.prepare(`
            SELECT COUNT(*) as count FROM strategies_v2 WHERE is_active = 1
        `).get();

        summary = {
            totalPortfolios: portfolioStats?.count || 5,
            totalTrades: tradeStats?.count || 0,
            totalVolume: tradeStats?.volume || 0,
            bestReturn: (portfolioStats?.best_return || 0) * 100, // Convert to percentage
            uptime: '99.9%',
            strategiesActive: activeStrategies?.count || 5
        };
    } catch (err) {
        console.warn('Dashboard summary DB query failed:', err.message);
    }

    res.json(summary);
}));

/**
 * GET /api/v1/dashboard/equity-history?range=1D|1W|1M|ALL
 * Returns REAL equity curves using actual Alpaca historical HOURLY bar prices.
 * Data points are generated once per market hour (9:30 AM – 4:00 PM ET) —
 * Alpaca's hourly bars are only produced during market-open windows, so no
 * explicit weekday/time filtering is needed; off-hours gaps are absent by design.
 *
 * For each hourly bar: portfolio value = cash_remaining + Σ(qty × bar_close_price)
 * Produces realistic intraday fluctuations instead of flat daily steps.
 */
router.get('/equity-history', asyncHandler(async (req, res) => {
    const { range = 'ALL' } = req.query;

    if (!ALPACA_CONFIG.API_KEY || !ALPACA_CONFIG.SECRET_KEY) {
        return res.json({ snapshots: [], trades: [] });
    }

    try {
        const DATA_URL = (ALPACA_CONFIG.BASE_URL || 'https://paper-api.alpaca.markets/v2')
            .replace('paper-api.alpaca.markets/v2', 'data.alpaca.markets/v2')
            .replace('api.alpaca.markets/v2', 'data.alpaca.markets/v2');

        const INITIAL_CAPITAL = 20000;
        const strategySlugs   = Object.keys(STRATEGY_SLUGS);

        // Fetch orders + live positions in parallel
        const [positions, allOrders] = await Promise.all([
            alpacaRequest('/positions'),
            alpacaRequest('/orders?status=all&limit=500&direction=asc')
        ]);

        // Filter to strategy-tagged filled orders; sort chronologically (oldest first)
        const filledOrders = allOrders
            .filter(o => {
                const prefix = (o.client_order_id || '').split('-')[0];
                return Object.values(STRATEGY_SLUGS).includes(prefix) && o.status === 'filled';
            })
            .sort((a, b) => new Date(a.filled_at || a.created_at) - new Date(b.filled_at || b.created_at));

        if (filledOrders.length === 0) {
            return res.json({ snapshots: [], trades: [] });
        }

        // Collect all unique symbols across all strategies
        const allSymbols = [...new Set(filledOrders.map(o => o.symbol))];

        // Determine chart date range
        const now          = new Date();
        const firstTradeTs = new Date(filledOrders[0].filled_at || filledOrders[0].created_at);
        let   chartStart;
        switch (range) {
            case '1D': chartStart = new Date(now - 24  * 60 * 60 * 1000); break;
            case '1W': chartStart = new Date(now - 7   * 24 * 60 * 60 * 1000); break;
            case '1M': chartStart = new Date(now - 30  * 24 * 60 * 60 * 1000); break;
            default:   chartStart = new Date(firstTradeTs.getTime() - 60 * 60 * 1000); break;
        }
        const fetchStart = new Date(Math.min(chartStart.getTime(), firstTradeTs.getTime() - 60 * 60 * 1000));
        const startStr   = fetchStart.toISOString().split('T')[0];
        const endStr     = now.toISOString().split('T')[0];

        // Fetch HOURLY bars for all symbols from Alpaca data API.
        // Alpaca only emits bars during market hours, so these timestamps are
        // inherently market-hours-only (9:30 AM – 4:00 PM ET, weekdays only).
        const hourlyPrices  = {}; // { symbol: { [ISO_timestamp]: closePrice } }
        const barTimeSorted = {}; // { symbol: [sorted ISO timestamps] } — for binary search

        await Promise.all(allSymbols.map(async (symbol) => {
            try {
                const url = `${DATA_URL}/stocks/${symbol}/bars?timeframe=1Hour&start=${startStr}&end=${endStr}&limit=10000&feed=iex`;
                const resp = await axios.get(url, {
                    headers: {
                        'APCA-API-KEY-ID':     ALPACA_CONFIG.API_KEY,
                        'APCA-API-SECRET-KEY': ALPACA_CONFIG.SECRET_KEY
                    }
                });
                hourlyPrices[symbol] = {};
                (resp.data.bars || []).forEach(bar => {
                    hourlyPrices[symbol][bar.t] = bar.c;
                });
                barTimeSorted[symbol] = Object.keys(hourlyPrices[symbol]).sort();
            } catch (e) {
                console.warn(`Could not fetch hourly bars for ${symbol}: ${e.message}`);
                hourlyPrices[symbol]  = {};
                barTimeSorted[symbol] = [];
            }
        }));

        // Live price fallback from Alpaca positions
        const livePriceMap = {};
        positions.forEach(p => { livePriceMap[p.symbol] = parseFloat(p.current_price || 0); });

        /**
         * Return the most recent close price for a symbol at or before a given ISO timestamp.
         * Uses binary search on the pre-sorted barTimeSorted array — O(log n) per lookup.
         */
        function priceAtTs(symbol, ts) {
            const times = barTimeSorted[symbol];
            if (!times || times.length === 0) return livePriceMap[symbol] || 0;
            let lo = 0, hi = times.length - 1, result = -1;
            while (lo <= hi) {
                const mid = (lo + hi) >> 1;
                if (times[mid] <= ts) { result = mid; lo = mid + 1; }
                else hi = mid - 1;
            }
            return result >= 0 ? hourlyPrices[symbol][times[result]] : (livePriceMap[symbol] || 0);
        }

        // Union of all market-hour timestamps from bar data, filtered to chart range
        const chartStartISO = chartStart.toISOString();
        const allTimestampsSet = new Set();
        Object.values(hourlyPrices).forEach(barMap => {
            Object.keys(barMap).forEach(t => { if (t >= chartStartISO) allTimestampsSet.add(t); });
        });
        const sortedTimestamps = [...allTimestampsSet].sort();

        if (sortedTimestamps.length === 0) {
            return res.json({ snapshots: [], trades: [] });
        }

        // Per-strategy running state (cash + open positions)
        const stratState = {};
        strategySlugs.forEach(s => { stratState[s] = { cash: INITIAL_CAPITAL, pos: {} }; });

        // Opening snapshot: all strategies at $20K
        const snapshots = [{
            timestamp: sortedTimestamps[0],
            ...Object.fromEntries(strategySlugs.map(s => [s, INITIAL_CAPITAL]))
        }];

        // Single O(n) walk: advance order pointer as each hourly bar closes
        let orderIdx = 0;

        for (const ts of sortedTimestamps) {
            // Apply every order filled at or before this bar's close timestamp
            while (orderIdx < filledOrders.length) {
                const order    = filledOrders[orderIdx];
                const orderTs  = order.filled_at || order.created_at;
                if (orderTs > ts) break; // Order is in the future — defer

                const prefix = (order.client_order_id || '').split('-')[0];
                const slug   = strategySlugs.find(s => STRATEGY_SLUGS[s] === prefix);
                if (slug) {
                    const st  = stratState[slug];
                    const qty = parseFloat(order.filled_qty || 0);
                    const prc = parseFloat(order.filled_avg_price || 0);
                    if (order.side === 'buy') {
                        st.cash -= qty * prc;
                        if (!st.pos[order.symbol]) st.pos[order.symbol] = { qty: 0, avgCost: 0 };
                        const p = st.pos[order.symbol];
                        p.avgCost = (p.qty * p.avgCost + qty * prc) / (p.qty + qty);
                        p.qty    += qty;
                    } else {
                        st.cash += qty * prc;
                        if (st.pos[order.symbol]) {
                            st.pos[order.symbol].qty -= qty;
                            if (st.pos[order.symbol].qty <= 0.001) delete st.pos[order.symbol];
                        }
                    }
                }
                orderIdx++;
            }

            // Snapshot: cash + mark-to-market using this hour's close prices
            const snap = { timestamp: ts };
            strategySlugs.forEach(slug => {
                const st       = stratState[slug];
                const posValue = Object.entries(st.pos).reduce((sum, [sym, p]) => {
                    return sum + p.qty * priceAtTs(sym, ts);
                }, 0);
                snap[slug] = Math.round(st.cash + posValue);
            });
            snapshots.push(snap);
        }

        // Trade events for chart marker overlay
        const formattedTrades = filledOrders.map(o => {
            const prefix = (o.client_order_id || '').split('-')[0];
            const slug   = strategySlugs.find(s => STRATEGY_SLUGS[s] === prefix);
            return {
                timestamp: o.filled_at || o.created_at,
                strategy:  slug,
                action:    o.side,
                symbol:    o.symbol,
                quantity:  parseFloat(o.filled_qty        || 0),
                price:     parseFloat(o.filled_avg_price  || 0)
            };
        });

        console.log(`Equity history (hourly, market-hours only): ${snapshots.length} snapshots, ${formattedTrades.length} trades (range: ${range})`);
        res.json({ snapshots, trades: formattedTrades });

    } catch (error) {
        console.error('Equity history error:', error.message);
        // Return minimal $20K flat line on error
        const now   = new Date();
        const start = new Date(now - 24 * 60 * 60 * 1000);
        const flat  = { timestamp: '' };
        Object.keys(STRATEGY_SLUGS).forEach(slug => { flat[slug] = 20000; });
        res.json({
            snapshots: [
                { ...flat, timestamp: start.toISOString() },
                { ...flat, timestamp: now.toISOString() }
            ],
            trades: []
        });
    }
}));

/**
 * POST /api/v1/dashboard/strategies/:strategyId/snapshot
 * Called by the Python strategy executor after each run.
 * Saves current Alpaca portfolio value to strategy_snapshots for Sharpe/drawdown calculations.
 */
// Map executor strategy IDs (1-5) to dashboard slugs
const EXECUTOR_ID_TO_SLUG = {
    1: 'momentum-hunter',
    2: 'mean-reversion',
    3: 'sector-rotator',
    4: 'value-dividends',
    5: 'volatility-breakout',
};

router.post('/strategies/:strategyId/snapshot', asyncHandler(async (req, res) => {
    const strategyId = parseInt(req.params.strategyId);
    const slug = EXECUTOR_ID_TO_SLUG[strategyId];

    if (!slug) {
        return res.status(400).json({ ok: false, error: `Unknown strategy ID: ${strategyId}` });
    }

    if (!ALPACA_CONFIG.API_KEY || !ALPACA_CONFIG.SECRET_KEY) {
        return res.json({ ok: false, error: 'No Alpaca credentials configured' });
    }

    const db = getDb();
    if (!db) {
        return res.json({ ok: false, error: 'No database connection' });
    }

    try {
        const strategies = await getAlpacaStrategyData();
        const strategy = strategies.find(s => s.id === slug);

        if (!strategy) {
            return res.json({ ok: false, error: `Strategy ${slug} not found in Alpaca data` });
        }

        const INITIAL_CAPITAL = 20000;
        const portfolioValue = strategy.currentValue;
        const cashBalance = strategy.cashRemaining;
        const positionsValue = strategy.positions.reduce((sum, p) => sum + p.marketValue, 0);
        const totalPnl = portfolioValue - INITIAL_CAPITAL;
        const totalPnlPct = (totalPnl / INITIAL_CAPITAL) * 100;
        const numPositions = strategy.positionsCount;

        db.prepare(`
            INSERT INTO strategy_snapshots
                (strategy_id, portfolio_value, cash_balance, positions_value, total_pnl, total_pnl_pct, num_positions, snapshot_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
        `).run(strategyId, portfolioValue, cashBalance, positionsValue, totalPnl, totalPnlPct, numPositions);

        console.log(`[snapshot] Strategy ${strategyId} (${slug}): $${portfolioValue.toFixed(2)}, P&L: ${totalPnlPct.toFixed(2)}%`);

        res.json({
            ok: true,
            strategyId,
            slug,
            portfolioValue,
            totalPnlPct: parseFloat(totalPnlPct.toFixed(4)),
        });
    } catch (error) {
        console.error(`[snapshot] Error for strategy ${strategyId}:`, error.message);
        res.json({ ok: false, error: error.message });
    }
}));

module.exports = router;

