const express = require('express');
const { authenticateToken } = require('../middleware/auth');
const { ApiError, asyncHandler } = require('../middleware/error');
const { getDb } = require('../config/database');
const config = require('../config');

const router = express.Router();

// In-memory candle cache: key -> { data, expiry }
const candleCache = new Map();

// Strategy slug to name mapping for public routes
const STRATEGY_SLUG_MAP = {
    'momentum-hunter': 'Momentum Rider',
    'mean-reversion': 'Contrarian',
    'sector-rotator': 'Sector Rotator',
    'value-dividends': 'Dividend Hunter',
    'volatility-breakout': 'Volatility Trader'
};

/**
 * Resolve a strategy param that may be a numeric ID or a slug.
 * Returns { strategy, isSlug } or throws ApiError.
 */
function resolveStrategy(db, idParam, userId) {
    const numericId = parseInt(idParam);
    if (!isNaN(numericId)) {
        // Numeric ID — check both tables
        const strategy = userId
            ? db.prepare('SELECT * FROM strategies WHERE id = ? AND user_id = ?').get(numericId, userId)
            : null;
        const strategyV2 = !strategy
            ? db.prepare('SELECT * FROM strategies_v2 WHERE id = ?').get(numericId)
            : null;
        return strategy || strategyV2 || null;
    }
    // Slug-based lookup via strategies_v2 name
    const slugName = STRATEGY_SLUG_MAP[idParam];
    if (slugName) {
        return db.prepare('SELECT * FROM strategies_v2 WHERE name = ?').get(slugName) || null;
    }
    return null;
}

// ─── Public routes (no auth required) ───────────────────────────

/**
 * GET /api/v1/strategies/:id/candles
 * Get candlestick data for a strategy's symbol (public)
 */
router.get('/:id/candles', asyncHandler(async (req, res) => {
    const db = getDb();
    const strat = resolveStrategy(db, req.params.id, null);
    if (!strat) throw new ApiError('Strategy not found', 404);

    const stratConfig = strat.config ? JSON.parse(strat.config) : (strat.config_json ? JSON.parse(strat.config_json) : {});
    const symbol = req.query.symbol || stratConfig.symbol || 'SOXL';
    const timeframe = req.query.timeframe || '1Day';
    const from = req.query.from || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    const to = req.query.to || new Date().toISOString().split('T')[0];

    const cacheKey = `${symbol}_${timeframe}_${from}_${to}`;
    const now = Date.now();
    const cached = candleCache.get(cacheKey);
    if (cached && cached.expiry > now) {
        return res.json(cached.data);
    }

    const isToday = to === new Date().toISOString().split('T')[0];
    const ttl = isToday ? 5 * 60 * 1000 : 24 * 60 * 60 * 1000;

    try {
        const url = new URL(`${config.alpaca.dataUrl}/v2/stocks/${symbol}/bars`);
        url.searchParams.set('timeframe', timeframe);
        url.searchParams.set('start', from);
        url.searchParams.set('end', to);
        url.searchParams.set('limit', '1000');

        const response = await fetch(url.toString(), {
            headers: {
                'APCA-API-KEY-ID': config.alpaca.apiKey,
                'APCA-API-SECRET-KEY': config.alpaca.secretKey,
            }
        });

        if (!response.ok) {
            throw new Error(`Alpaca responded ${response.status}: ${response.statusText}`);
        }

        const data = await response.json();
        const candles = (data.bars || []).map(bar => ({
            time: bar.t.split('T')[0],
            open: bar.o,
            high: bar.h,
            low: bar.l,
            close: bar.c,
            volume: bar.v
        }));

        const result = { candles, simulated: false, symbol, timeframe };
        candleCache.set(cacheKey, { data: result, expiry: now + ttl });
        return res.json(result);
    } catch (error) {
        console.error(`Alpaca candles fetch failed for ${symbol}:`, error.message);

        const candles = generateMockCandles(from, to);
        const result = { candles, simulated: true, symbol, timeframe };
        candleCache.set(cacheKey, { data: result, expiry: now + ttl });
        return res.json(result);
    }
}));

/**
 * GET /api/v1/strategies/:id/trades
 * Get trades for a strategy with pagination and parsed reasoning (public)
 */
router.get('/:id/trades', asyncHandler(async (req, res) => {
    const db = getDb();
    const strat = resolveStrategy(db, req.params.id, null);
    if (!strat) throw new ApiError('Strategy not found', 404);

    const strategyId = strat.id;
    const limit = Math.min(parseInt(req.query.limit) || 50, 200);
    const offset = parseInt(req.query.offset) || 0;

    const total = db.prepare('SELECT COUNT(*) as count FROM strategy_trades WHERE strategy_id = ?').get(strategyId).count;

    const trades = db.prepare(`
        SELECT * FROM strategy_trades
        WHERE strategy_id = ?
        ORDER BY executed_at DESC
        LIMIT ? OFFSET ?
    `).all(strategyId, limit, offset);

    const parsedTrades = trades.map(trade => ({
        ...trade,
        reasoning: trade.reasoning ? JSON.parse(trade.reasoning) : null
    }));

    res.json({
        success: true,
        trades: parsedTrades,
        total,
        limit,
        offset
    });
}));

// ─── Authenticated routes ───────────────────────────────────────

/**
 * GET /api/v1/strategies
 * Get all strategies for the authenticated user
 */
router.get('/', authenticateToken, asyncHandler(async (req, res) => {
    const db = getDb();
    
    const strategies = db.prepare(`
        SELECT s.*, p.name as portfolio_name
        FROM strategies s
        LEFT JOIN portfolios p ON s.portfolio_id = p.id
        WHERE s.user_id = ?
        ORDER BY s.created_at DESC
    `).all(req.user.id);

    // Parse config JSON for each strategy
    const strategiesWithParsedConfig = strategies.map(strategy => ({
        ...strategy,
        config: strategy.config ? JSON.parse(strategy.config) : {}
    }));

    res.json({
        success: true,
        strategies: strategiesWithParsedConfig
    });
}));

/**
 * POST /api/v1/strategies
 * Create a new strategy
 */
router.post('/', authenticateToken, asyncHandler(async (req, res) => {
    const { name, type, config, portfolioId } = req.body;

    if (!name || !type || !config) {
        throw new ApiError('Name, type, and config are required', 400);
    }

    const validTypes = ['momentum', 'mean_reversion', 'sentiment', 'custom'];
    if (!validTypes.includes(type)) {
        throw new ApiError(`Strategy type must be one of: ${validTypes.join(', ')}`, 400);
    }

    // Validate config is an object
    if (typeof config !== 'object') {
        throw new ApiError('Config must be an object', 400);
    }

    // If portfolio specified, verify ownership
    if (portfolioId) {
        const db = getDb();
        const portfolio = db.prepare(`
            SELECT id FROM portfolios 
            WHERE id = ? AND user_id = ?
        `).get(portfolioId, req.user.id);

        if (!portfolio) {
            throw new ApiError('Portfolio not found or access denied', 404);
        }
    }

    const db = getDb();
    const stmt = db.prepare(`
        INSERT INTO strategies (user_id, name, type, config, portfolio_id)
        VALUES (?, ?, ?, ?, ?)
    `);

    const result = stmt.run(
        req.user.id,
        name,
        type,
        JSON.stringify(config),
        portfolioId || null
    );

    const strategy = db.prepare(`
        SELECT s.*, p.name as portfolio_name
        FROM strategies s
        LEFT JOIN portfolios p ON s.portfolio_id = p.id
        WHERE s.id = ?
    `).get(result.lastInsertRowid);

    res.status(201).json({
        success: true,
        strategy: {
            ...strategy,
            config: JSON.parse(strategy.config)
        }
    });
}));

/**
 * GET /api/v1/strategies/:id
 * Get strategy details
 */
router.get('/:id', authenticateToken, asyncHandler(async (req, res) => {
    const strategyId = parseInt(req.params.id);

    if (isNaN(strategyId)) {
        throw new ApiError('Invalid strategy ID', 400);
    }

    const db = getDb();
    const strategy = db.prepare(`
        SELECT s.*, p.name as portfolio_name
        FROM strategies s
        LEFT JOIN portfolios p ON s.portfolio_id = p.id
        WHERE s.id = ? AND s.user_id = ?
    `).get(strategyId, req.user.id);

    if (!strategy) {
        throw new ApiError('Strategy not found', 404);
    }

    res.json({
        success: true,
        strategy: {
            ...strategy,
            config: JSON.parse(strategy.config)
        }
    });
}));

/**
 * PATCH /api/v1/strategies/:id
 * Update strategy
 */
router.patch('/:id', authenticateToken, asyncHandler(async (req, res) => {
    const strategyId = parseInt(req.params.id);
    
    if (isNaN(strategyId)) {
        throw new ApiError('Invalid strategy ID', 400);
    }

    const db = getDb();
    
    // Check ownership
    const existingStrategy = db.prepare(`
        SELECT * FROM strategies WHERE id = ? AND user_id = ?
    `).get(strategyId, req.user.id);

    if (!existingStrategy) {
        throw new ApiError('Strategy not found', 404);
    }

    const { name, type, config, status, portfolioId } = req.body;
    const updates = {};
    const values = [];

    if (name) {
        updates.name = name;
    }

    if (type) {
        const validTypes = ['momentum', 'mean_reversion', 'sentiment', 'custom'];
        if (!validTypes.includes(type)) {
            throw new ApiError(`Strategy type must be one of: ${validTypes.join(', ')}`, 400);
        }
        updates.type = type;
    }

    if (config) {
        if (typeof config !== 'object') {
            throw new ApiError('Config must be an object', 400);
        }
        updates.config = JSON.stringify(config);
    }

    if (status) {
        const validStatuses = ['active', 'paused', 'backtest'];
        if (!validStatuses.includes(status)) {
            throw new ApiError(`Status must be one of: ${validStatuses.join(', ')}`, 400);
        }
        updates.status = status;
    }

    if (portfolioId !== undefined) {
        if (portfolioId) {
            // Verify portfolio ownership
            const portfolio = db.prepare(`
                SELECT id FROM portfolios 
                WHERE id = ? AND user_id = ?
            `).get(portfolioId, req.user.id);

            if (!portfolio) {
                throw new ApiError('Portfolio not found or access denied', 404);
            }
        }
        updates.portfolio_id = portfolioId || null;
    }

    if (Object.keys(updates).length === 0) {
        throw new ApiError('No valid fields to update', 400);
    }

    // Build update query
    const setClause = Object.keys(updates).map(key => `${key} = ?`).join(', ');
    const updateValues = Object.values(updates);
    updateValues.push(strategyId);

    const stmt = db.prepare(`
        UPDATE strategies 
        SET ${setClause} 
        WHERE id = ?
    `);

    stmt.run(...updateValues);

    // Return updated strategy
    const updatedStrategy = db.prepare(`
        SELECT s.*, p.name as portfolio_name
        FROM strategies s
        LEFT JOIN portfolios p ON s.portfolio_id = p.id
        WHERE s.id = ?
    `).get(strategyId);

    res.json({
        success: true,
        strategy: {
            ...updatedStrategy,
            config: JSON.parse(updatedStrategy.config)
        }
    });
}));

/**
 * DELETE /api/v1/strategies/:id
 * Delete strategy
 */
router.delete('/:id', authenticateToken, asyncHandler(async (req, res) => {
    const strategyId = parseInt(req.params.id);
    
    if (isNaN(strategyId)) {
        throw new ApiError('Invalid strategy ID', 400);
    }

    const db = getDb();
    
    const stmt = db.prepare(`
        DELETE FROM strategies 
        WHERE id = ? AND user_id = ?
    `);

    const result = stmt.run(strategyId, req.user.id);

    if (result.changes === 0) {
        throw new ApiError('Strategy not found', 404);
    }

    res.json({
        success: true,
        message: 'Strategy deleted successfully'
    });
}));

/**
 * POST /api/v1/strategies/:id/backtest
 * Run backtest for strategy
 */
router.post('/:id/backtest', authenticateToken, asyncHandler(async (req, res) => {
    const strategyId = parseInt(req.params.id);
    
    if (isNaN(strategyId)) {
        throw new ApiError('Invalid strategy ID', 400);
    }

    const { startDate, endDate, initialCapital = 10000 } = req.body;

    const db = getDb();
    
    // Check ownership
    const strategy = db.prepare(`
        SELECT * FROM strategies WHERE id = ? AND user_id = ?
    `).get(strategyId, req.user.id);

    if (!strategy) {
        throw new ApiError('Strategy not found', 404);
    }

    // For now, create a mock backtest run
    // In production, this would trigger the Python quant engine
    const mockResults = {
        total_return: Math.random() * 20 - 5, // -5% to +15%
        sharpe_ratio: Math.random() * 2 + 0.5, // 0.5 to 2.5
        max_drawdown: -(Math.random() * 15 + 2), // -2% to -17%
        trades_count: Math.floor(Math.random() * 50) + 10,
        win_rate: Math.random() * 40 + 40, // 40% to 80%
        profit_factor: Math.random() * 2 + 0.8, // 0.8 to 2.8
        volatility: Math.random() * 25 + 10 // 10% to 35%
    };

    const stmt = db.prepare(`
        INSERT INTO strategy_runs (strategy_id, run_type, start_date, end_date, total_return, sharpe_ratio, max_drawdown, trades_count, results)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const result = stmt.run(
        strategyId,
        'backtest',
        startDate || '2023-01-01',
        endDate || new Date().toISOString().split('T')[0],
        mockResults.total_return,
        mockResults.sharpe_ratio,
        mockResults.max_drawdown,
        mockResults.trades_count,
        JSON.stringify(mockResults)
    );

    const run = db.prepare(`
        SELECT * FROM strategy_runs WHERE id = ?
    `).get(result.lastInsertRowid);

    res.status(201).json({
        success: true,
        run: {
            ...run,
            results: JSON.parse(run.results)
        },
        message: 'Backtest completed successfully'
    });
}));

/**
 * GET /api/v1/strategies/:id/runs
 * Get strategy run history
 */
router.get('/:id/runs', authenticateToken, asyncHandler(async (req, res) => {
    const strategyId = parseInt(req.params.id);
    const { limit = 50, runType } = req.query;
    
    if (isNaN(strategyId)) {
        throw new ApiError('Invalid strategy ID', 400);
    }

    const db = getDb();
    
    // Check ownership
    const strategy = db.prepare(`
        SELECT id FROM strategies WHERE id = ? AND user_id = ?
    `).get(strategyId, req.user.id);

    if (!strategy) {
        throw new ApiError('Strategy not found', 404);
    }

    let query = `
        SELECT * FROM strategy_runs 
        WHERE strategy_id = ?
    `;
    const params = [strategyId];

    if (runType) {
        query += ' AND run_type = ?';
        params.push(runType);
    }

    query += ' ORDER BY created_at DESC LIMIT ?';
    params.push(parseInt(limit));

    const runs = db.prepare(query).all(...params);

    const runsWithParsedResults = runs.map(run => ({
        ...run,
        results: run.results ? JSON.parse(run.results) : {}
    }));

    res.json({
        success: true,
        runs: runsWithParsedResults
    });
}));

/**
 * GET /api/v1/strategies/:id/signals
 * Get latest signals for strategy
 */
router.get('/:id/signals', authenticateToken, asyncHandler(async (req, res) => {
    const strategyId = parseInt(req.params.id);
    
    if (isNaN(strategyId)) {
        throw new ApiError('Invalid strategy ID', 400);
    }

    const db = getDb();
    
    // Check ownership
    const strategy = db.prepare(`
        SELECT * FROM strategies WHERE id = ? AND user_id = ?
    `).get(strategyId, req.user.id);

    if (!strategy) {
        throw new ApiError('Strategy not found', 404);
    }

    // Mock signals for now
    // In production, this would come from the Python quant engine
    const mockSignals = [
        {
            symbol: 'AAPL',
            action: 'buy',
            confidence: 0.75,
            price_target: 185.50,
            stop_loss: 170.00,
            timestamp: new Date().toISOString(),
            reason: 'RSI oversold, MACD bullish crossover'
        },
        {
            symbol: 'TSLA',
            action: 'sell',
            confidence: 0.60,
            price_target: 180.00,
            stop_loss: 200.00,
            timestamp: new Date(Date.now() - 30 * 60 * 1000).toISOString(),
            reason: 'Overbought conditions, negative sentiment'
        }
    ];

    res.json({
        success: true,
        signals: mockSignals,
        strategy_id: strategyId,
        timestamp: new Date().toISOString()
    });
}));


/**
 * Generate ~30 realistic mock candles for fallback
 */
function generateMockCandles(from, to) {
    const candles = [];
    let price = 28 + Math.random() * 4; // SOXL-like base ~$28-32
    const startDate = new Date(from);
    const endDate = new Date(to);
    const dayMs = 24 * 60 * 60 * 1000;
    const totalDays = Math.ceil((endDate - startDate) / dayMs);
    const step = Math.max(1, Math.floor(totalDays / 30));

    for (let d = new Date(startDate); d <= endDate; d.setDate(d.getDate() + step)) {
        if (d.getDay() === 0 || d.getDay() === 6) continue; // skip weekends
        const dailyReturn = (Math.random() - 0.5) * 0.04; // +/- 2%
        const open = price;
        const close = open * (1 + dailyReturn);
        const high = Math.max(open, close) * (1 + Math.random() * 0.01);
        const low = Math.min(open, close) * (1 - Math.random() * 0.01);
        const volume = Math.floor(5000000 + Math.random() * 15000000);

        candles.push({
            time: d.toISOString().split('T')[0],
            open: +open.toFixed(2),
            high: +high.toFixed(2),
            low: +low.toFixed(2),
            close: +close.toFixed(2),
            volume
        });
        price = close;
    }
    return candles;
}

/**
 * GET /api/v1/strategies/types
 * Get available strategy types and their configurations
 */
router.get('/types', authenticateToken, (req, res) => {
    const strategyTypes = {
        momentum: {
            name: 'Momentum Strategy',
            description: 'Follows trends using moving averages and momentum indicators',
            parameters: {
                lookback_period: { type: 'number', default: 20, min: 5, max: 100 },
                rsi_period: { type: 'number', default: 14, min: 5, max: 50 },
                ma_short: { type: 'number', default: 10, min: 5, max: 50 },
                ma_long: { type: 'number', default: 30, min: 10, max: 200 }
            }
        },
        mean_reversion: {
            name: 'Mean Reversion Strategy',
            description: 'Buys oversold and sells overbought conditions',
            parameters: {
                bb_period: { type: 'number', default: 20, min: 10, max: 50 },
                bb_std: { type: 'number', default: 2.0, min: 1.0, max: 3.0 },
                rsi_oversold: { type: 'number', default: 30, min: 10, max: 40 },
                rsi_overbought: { type: 'number', default: 70, min: 60, max: 90 }
            }
        },
        sentiment: {
            name: 'Sentiment Strategy',
            description: 'Uses news sentiment and social media data',
            parameters: {
                sentiment_threshold: { type: 'number', default: 0.6, min: 0.1, max: 1.0 },
                news_weight: { type: 'number', default: 0.7, min: 0.1, max: 1.0 },
                social_weight: { type: 'number', default: 0.3, min: 0.1, max: 1.0 }
            }
        },
        custom: {
            name: 'Custom Strategy',
            description: 'User-defined strategy with custom parameters',
            parameters: {}
        }
    };

    res.json({
        success: true,
        types: strategyTypes
    });
});

module.exports = router;