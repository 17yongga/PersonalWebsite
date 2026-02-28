const express = require('express');
const { authenticateToken } = require('../middleware/auth');
const { ApiError, asyncHandler } = require('../middleware/error');
const MarketService = require('../services/market');

const router = express.Router();

// All market routes require authentication
router.use(authenticateToken);

/**
 * GET /api/v1/market/quote/:symbol
 * Get latest quote for a symbol
 */
router.get('/quote/:symbol', asyncHandler(async (req, res) => {
    const { symbol } = req.params;
    
    if (!symbol) {
        throw new ApiError('Symbol is required', 400);
    }

    const quote = await MarketService.getQuote(symbol);

    res.json({
        success: true,
        quote
    });
}));

/**
 * POST /api/v1/market/quotes
 * Get quotes for multiple symbols
 */
router.post('/quotes', asyncHandler(async (req, res) => {
    const { symbols } = req.body;

    if (!symbols || !Array.isArray(symbols)) {
        throw new ApiError('Symbols array is required', 400);
    }

    if (symbols.length > 20) {
        throw new ApiError('Maximum 20 symbols allowed per request', 400);
    }

    const quotes = await MarketService.getMultipleQuotes(symbols);

    res.json({
        success: true,
        quotes
    });
}));

/**
 * GET /api/v1/market/bar/:symbol
 * Get latest bar (OHLCV) for a symbol
 */
router.get('/bar/:symbol', asyncHandler(async (req, res) => {
    const { symbol } = req.params;
    
    if (!symbol) {
        throw new ApiError('Symbol is required', 400);
    }

    const bar = await MarketService.getLatestBar(symbol);

    res.json({
        success: true,
        bar
    });
}));

/**
 * GET /api/v1/market/bars/:symbol
 * Get historical bars for a symbol
 */
router.get('/bars/:symbol', asyncHandler(async (req, res) => {
    const { symbol } = req.params;
    const { timeframe, start, end, limit } = req.query;
    
    if (!symbol) {
        throw new ApiError('Symbol is required', 400);
    }

    const params = {};
    if (timeframe) params.timeframe = timeframe;
    if (start) params.start = start;
    if (end) params.end = end;
    if (limit) params.limit = parseInt(limit);

    const data = await MarketService.getHistoricalBars(symbol, params);

    res.json({
        success: true,
        data
    });
}));

/**
 * GET /api/v1/market/search
 * Search for symbols
 */
router.get('/search', asyncHandler(async (req, res) => {
    const { q, limit } = req.query;
    
    if (!q) {
        throw new ApiError('Search query (q) is required', 400);
    }

    if (q.length < 1) {
        throw new ApiError('Search query must be at least 1 character', 400);
    }

    const results = await MarketService.searchSymbols(
        q, 
        limit ? parseInt(limit) : 20
    );

    res.json({
        success: true,
        results
    });
}));

/**
 * GET /api/v1/market/asset/:symbol
 * Get asset information
 */
router.get('/asset/:symbol', asyncHandler(async (req, res) => {
    const { symbol } = req.params;
    
    if (!symbol) {
        throw new ApiError('Symbol is required', 400);
    }

    const asset = await MarketService.getAssetInfo(symbol);

    res.json({
        success: true,
        asset
    });
}));

/**
 * GET /api/v1/market/status
 * Get market status
 */
router.get('/status', asyncHandler(async (req, res) => {
    const status = await MarketService.getMarketStatus();

    res.json({
        success: true,
        status
    });
}));

/**
 * GET /api/v1/market/trending
 * Get trending/popular symbols (mock data for now)
 */
router.get('/trending', asyncHandler(async (req, res) => {
    // Mock trending symbols for now
    const trending = [
        { symbol: 'AAPL', name: 'Apple Inc.', change_pct: 2.5 },
        { symbol: 'MSFT', name: 'Microsoft Corporation', change_pct: 1.8 },
        { symbol: 'GOOGL', name: 'Alphabet Inc.', change_pct: -0.5 },
        { symbol: 'AMZN', name: 'Amazon.com Inc.', change_pct: 3.2 },
        { symbol: 'TSLA', name: 'Tesla Inc.', change_pct: -2.1 },
        { symbol: 'NVDA', name: 'NVIDIA Corporation', change_pct: 4.7 },
        { symbol: 'META', name: 'Meta Platforms Inc.', change_pct: 1.2 },
        { symbol: 'NFLX', name: 'Netflix Inc.', change_pct: -1.8 }
    ];

    res.json({
        success: true,
        trending
    });
}));

/**
 * GET /api/v1/market/movers
 * Get market movers (top gainers/losers)
 */
router.get('/movers', asyncHandler(async (req, res) => {
    const { type = 'gainers' } = req.query;
    
    // Mock market movers data
    const gainers = [
        { symbol: 'NVDA', name: 'NVIDIA Corporation', change_pct: 8.5, price: 875.50 },
        { symbol: 'AMD', name: 'Advanced Micro Devices', change_pct: 6.2, price: 195.30 },
        { symbol: 'CRM', name: 'Salesforce Inc.', change_pct: 5.1, price: 240.80 },
        { symbol: 'AAPL', name: 'Apple Inc.', change_pct: 4.3, price: 180.25 },
        { symbol: 'MSFT', name: 'Microsoft Corporation', change_pct: 3.7, price: 415.60 }
    ];

    const losers = [
        { symbol: 'TSLA', name: 'Tesla Inc.', change_pct: -7.2, price: 185.90 },
        { symbol: 'NFLX', name: 'Netflix Inc.', change_pct: -5.8, price: 425.40 },
        { symbol: 'PYPL', name: 'PayPal Holdings', change_pct: -4.5, price: 58.75 },
        { symbol: 'COIN', name: 'Coinbase Global Inc.', change_pct: -3.9, price: 85.20 },
        { symbol: 'ZOOM', name: 'Zoom Video Communications', change_pct: -3.2, price: 68.90 }
    ];

    const movers = type === 'losers' ? losers : gainers;

    res.json({
        success: true,
        type,
        movers
    });
}));

/**
 * GET /api/v1/market/sectors
 * Get sector performance
 */
router.get('/sectors', asyncHandler(async (req, res) => {
    // Mock sector data
    const sectors = [
        { name: 'Technology', change_pct: 2.8, symbol: 'XLK' },
        { name: 'Healthcare', change_pct: 1.5, symbol: 'XLV' },
        { name: 'Financials', change_pct: 0.9, symbol: 'XLF' },
        { name: 'Consumer Discretionary', change_pct: -0.3, symbol: 'XLY' },
        { name: 'Communication Services', change_pct: -1.1, symbol: 'XLC' },
        { name: 'Industrials', change_pct: 1.2, symbol: 'XLI' },
        { name: 'Energy', change_pct: 3.5, symbol: 'XLE' },
        { name: 'Materials', change_pct: 0.7, symbol: 'XLB' },
        { name: 'Real Estate', change_pct: -0.8, symbol: 'XLRE' },
        { name: 'Utilities', change_pct: -1.5, symbol: 'XLU' },
        { name: 'Consumer Staples', change_pct: 0.4, symbol: 'XLP' }
    ];

    res.json({
        success: true,
        sectors
    });
}));

/**
 * GET /api/v1/market/mock/:symbol
 * Generate mock data for testing (development only)
 */
router.get('/mock/:symbol', asyncHandler(async (req, res) => {
    const { symbol } = req.params;
    const { type = 'quote', days } = req.query;

    if (process.env.NODE_ENV === 'production') {
        throw new ApiError('Mock data not available in production', 404);
    }

    let data;
    
    switch (type) {
        case 'quote':
            data = MarketService.generateMockQuote(symbol);
            break;
        case 'bars':
            data = MarketService.generateMockBars(symbol, days ? parseInt(days) : 30);
            break;
        default:
            throw new ApiError('Invalid mock data type', 400);
    }

    res.json({
        success: true,
        data,
        mock: true
    });
}));

module.exports = router;