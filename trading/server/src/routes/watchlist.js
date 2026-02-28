const express = require('express');
const { authenticateToken } = require('../middleware/auth');
const { ApiError, asyncHandler } = require('../middleware/error');
const { getDb } = require('../config/database');
const MarketService = require('../services/market');

const router = express.Router();

// All watchlist routes require authentication
router.use(authenticateToken);

/**
 * GET /api/v1/watchlist
 * Get user's watchlist with current prices
 */
router.get('/', asyncHandler(async (req, res) => {
    const db = getDb();
    
    const watchlistItems = db.prepare(`
        SELECT * FROM watchlist 
        WHERE user_id = ?
        ORDER BY added_at DESC
    `).all(req.user.id);

    // Get current prices for all symbols
    const symbols = watchlistItems.map(item => item.symbol);
    const quotes = {};
    
    if (symbols.length > 0) {
        try {
            const quotesData = await MarketService.getMultipleQuotes(symbols);
            Object.assign(quotes, quotesData);
        } catch (error) {
            console.warn('Failed to get quotes for watchlist:', error.message);
        }
    }

    // Combine watchlist items with quotes
    const watchlistWithPrices = watchlistItems.map(item => ({
        id: item.id,
        symbol: item.symbol,
        added_at: item.added_at,
        quote: quotes[item.symbol] || null,
        current_price: quotes[item.symbol]?.midpoint || null,
        bid: quotes[item.symbol]?.bid || null,
        ask: quotes[item.symbol]?.ask || null
    }));

    res.json({
        success: true,
        watchlist: watchlistWithPrices
    });
}));

/**
 * POST /api/v1/watchlist
 * Add symbol to watchlist
 */
router.post('/', asyncHandler(async (req, res) => {
    const { symbol } = req.body;

    if (!symbol || typeof symbol !== 'string') {
        throw new ApiError('Symbol is required', 400);
    }

    const upperSymbol = symbol.toUpperCase();

    // Validate symbol exists (try to get asset info)
    try {
        await MarketService.getAssetInfo(upperSymbol);
    } catch (error) {
        if (error.status === 404) {
            throw new ApiError(`Symbol ${upperSymbol} not found or not tradeable`, 404);
        }
        // If API is down, allow adding anyway
        console.warn(`Could not validate symbol ${upperSymbol}:`, error.message);
    }

    const db = getDb();

    // Check if already in watchlist
    const existing = db.prepare(`
        SELECT id FROM watchlist 
        WHERE user_id = ? AND symbol = ?
    `).get(req.user.id, upperSymbol);

    if (existing) {
        throw new ApiError('Symbol already in watchlist', 409);
    }

    // Add to watchlist
    const stmt = db.prepare(`
        INSERT INTO watchlist (user_id, symbol)
        VALUES (?, ?)
    `);

    const result = stmt.run(req.user.id, upperSymbol);

    // Get the added item with quote
    let quote = null;
    try {
        quote = await MarketService.getQuote(upperSymbol);
    } catch (error) {
        console.warn(`Failed to get quote for ${upperSymbol}:`, error.message);
    }

    const watchlistItem = {
        id: result.lastInsertRowid,
        symbol: upperSymbol,
        added_at: new Date().toISOString(),
        quote: quote,
        current_price: quote?.midpoint || null,
        bid: quote?.bid || null,
        ask: quote?.ask || null
    };

    res.status(201).json({
        success: true,
        item: watchlistItem,
        message: `${upperSymbol} added to watchlist`
    });
}));

/**
 * DELETE /api/v1/watchlist/:symbol
 * Remove symbol from watchlist
 */
router.delete('/:symbol', asyncHandler(async (req, res) => {
    const { symbol } = req.params;

    if (!symbol) {
        throw new ApiError('Symbol is required', 400);
    }

    const upperSymbol = symbol.toUpperCase();
    const db = getDb();

    const stmt = db.prepare(`
        DELETE FROM watchlist 
        WHERE user_id = ? AND symbol = ?
    `);

    const result = stmt.run(req.user.id, upperSymbol);

    if (result.changes === 0) {
        throw new ApiError('Symbol not found in watchlist', 404);
    }

    res.json({
        success: true,
        message: `${upperSymbol} removed from watchlist`
    });
}));

/**
 * GET /api/v1/watchlist/:symbol
 * Get specific watchlist item with detailed quote
 */
router.get('/:symbol', asyncHandler(async (req, res) => {
    const { symbol } = req.params;

    if (!symbol) {
        throw new ApiError('Symbol is required', 400);
    }

    const upperSymbol = symbol.toUpperCase();
    const db = getDb();

    const watchlistItem = db.prepare(`
        SELECT * FROM watchlist 
        WHERE user_id = ? AND symbol = ?
    `).get(req.user.id, upperSymbol);

    if (!watchlistItem) {
        throw new ApiError('Symbol not found in watchlist', 404);
    }

    // Get detailed quote and asset info
    let quote = null;
    let asset = null;

    try {
        [quote, asset] = await Promise.all([
            MarketService.getQuote(upperSymbol),
            MarketService.getAssetInfo(upperSymbol)
        ]);
    } catch (error) {
        console.warn(`Failed to get data for ${upperSymbol}:`, error.message);
    }

    const detailedItem = {
        id: watchlistItem.id,
        symbol: watchlistItem.symbol,
        added_at: watchlistItem.added_at,
        quote: quote,
        asset: asset,
        current_price: quote?.midpoint || null
    };

    res.json({
        success: true,
        item: detailedItem
    });
}));

/**
 * POST /api/v1/watchlist/bulk
 * Add multiple symbols to watchlist
 */
router.post('/bulk', asyncHandler(async (req, res) => {
    const { symbols } = req.body;

    if (!symbols || !Array.isArray(symbols) || symbols.length === 0) {
        throw new ApiError('Symbols array is required', 400);
    }

    if (symbols.length > 20) {
        throw new ApiError('Maximum 20 symbols allowed per request', 400);
    }

    const db = getDb();
    const results = {
        added: [],
        skipped: [],
        errors: []
    };

    for (const symbol of symbols) {
        if (!symbol || typeof symbol !== 'string') {
            results.errors.push({ symbol, error: 'Invalid symbol format' });
            continue;
        }

        const upperSymbol = symbol.toUpperCase();

        try {
            // Check if already in watchlist
            const existing = db.prepare(`
                SELECT id FROM watchlist 
                WHERE user_id = ? AND symbol = ?
            `).get(req.user.id, upperSymbol);

            if (existing) {
                results.skipped.push({ symbol: upperSymbol, reason: 'Already in watchlist' });
                continue;
            }

            // Try to validate symbol
            try {
                await MarketService.getAssetInfo(upperSymbol);
            } catch (error) {
                if (error.status === 404) {
                    results.errors.push({ symbol: upperSymbol, error: 'Symbol not found' });
                    continue;
                }
                // If API is down, allow adding anyway
            }

            // Add to watchlist
            const stmt = db.prepare(`
                INSERT INTO watchlist (user_id, symbol)
                VALUES (?, ?)
            `);

            const result = stmt.run(req.user.id, upperSymbol);
            results.added.push({ 
                symbol: upperSymbol, 
                id: result.lastInsertRowid 
            });

        } catch (error) {
            results.errors.push({ symbol: upperSymbol, error: error.message });
        }
    }

    const statusCode = results.errors.length > 0 ? 207 : 201; // 207 Multi-Status

    res.status(statusCode).json({
        success: results.errors.length === 0,
        results
    });
}));

/**
 * DELETE /api/v1/watchlist
 * Clear entire watchlist
 */
router.delete('/', asyncHandler(async (req, res) => {
    const { confirm } = req.body;

    if (confirm !== true) {
        throw new ApiError('Confirmation required to clear watchlist', 400);
    }

    const db = getDb();
    
    const result = db.prepare(`
        DELETE FROM watchlist WHERE user_id = ?
    `).run(req.user.id);

    res.json({
        success: true,
        message: `Cleared ${result.changes} items from watchlist`
    });
}));

/**
 * GET /api/v1/watchlist/export
 * Export watchlist as CSV or JSON
 */
router.get('/export', asyncHandler(async (req, res) => {
    const { format = 'json' } = req.query;

    const db = getDb();
    
    const watchlistItems = db.prepare(`
        SELECT symbol, added_at FROM watchlist 
        WHERE user_id = ?
        ORDER BY added_at DESC
    `).all(req.user.id);

    if (format === 'csv') {
        const csv = ['Symbol,Added Date']
            .concat(watchlistItems.map(item => `${item.symbol},${item.added_at}`))
            .join('\n');

        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', 'attachment; filename="watchlist.csv"');
        res.send(csv);
    } else {
        res.json({
            success: true,
            watchlist: watchlistItems,
            exported_at: new Date().toISOString()
        });
    }
}));

module.exports = router;