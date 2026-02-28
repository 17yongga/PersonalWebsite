const express = require('express');
const { authenticateToken } = require('../middleware/auth');
const { ApiError, asyncHandler } = require('../middleware/error');
const TradingService = require('../services/trading');
const PortfolioService = require('../services/portfolio');

const router = express.Router();

// All trading routes require authentication
router.use(authenticateToken);

/**
 * POST /api/v1/trading/orders
 * Place a new order
 */
router.post('/orders', asyncHandler(async (req, res) => {
    const { 
        portfolioId, 
        symbol, 
        side, 
        type, 
        quantity, 
        limitPrice, 
        stopPrice,
        source = 'manual'
    } = req.body;

    if (!portfolioId || !symbol || !side || !type || !quantity) {
        throw new ApiError('Portfolio ID, symbol, side, type, and quantity are required', 400);
    }

    // Verify portfolio ownership
    const portfolio = PortfolioService.getPortfolio(portfolioId);
    if (portfolio.user_id !== req.user.id) {
        throw new ApiError('Access denied', 403);
    }

    const order = await TradingService.placeOrder(portfolioId, {
        symbol,
        side,
        type,
        quantity: parseFloat(quantity),
        limitPrice: limitPrice ? parseFloat(limitPrice) : null,
        stopPrice: stopPrice ? parseFloat(stopPrice) : null,
        source
    });

    res.status(201).json({
        success: true,
        order
    });
}));

/**
 * GET /api/v1/trading/orders
 * Get orders for a portfolio
 */
router.get('/orders', asyncHandler(async (req, res) => {
    const { portfolioId, status, symbol, limit } = req.query;

    if (!portfolioId) {
        throw new ApiError('Portfolio ID is required', 400);
    }

    // Verify portfolio ownership
    const portfolio = PortfolioService.getPortfolio(parseInt(portfolioId));
    if (portfolio.user_id !== req.user.id) {
        throw new ApiError('Access denied', 403);
    }

    const params = {};
    if (status) params.status = status;
    if (symbol) params.symbol = symbol;
    if (limit) params.limit = parseInt(limit);

    const orders = TradingService.getPortfolioOrders(parseInt(portfolioId), params);

    res.json({
        success: true,
        orders
    });
}));

/**
 * GET /api/v1/trading/orders/:id
 * Get specific order
 */
router.get('/orders/:id', asyncHandler(async (req, res) => {
    const orderId = parseInt(req.params.id);
    
    if (isNaN(orderId)) {
        throw new ApiError('Invalid order ID', 400);
    }

    const order = TradingService.getOrder(orderId);
    
    // Verify portfolio ownership
    const portfolio = PortfolioService.getPortfolio(order.portfolio_id);
    if (portfolio.user_id !== req.user.id) {
        throw new ApiError('Access denied', 403);
    }

    res.json({
        success: true,
        order
    });
}));

/**
 * DELETE /api/v1/trading/orders/:id
 * Cancel an order
 */
router.delete('/orders/:id', asyncHandler(async (req, res) => {
    const orderId = parseInt(req.params.id);
    
    if (isNaN(orderId)) {
        throw new ApiError('Invalid order ID', 400);
    }

    const order = TradingService.getOrder(orderId);
    
    // Verify portfolio ownership
    const portfolio = PortfolioService.getPortfolio(order.portfolio_id);
    if (portfolio.user_id !== req.user.id) {
        throw new ApiError('Access denied', 403);
    }

    const cancelledOrder = await TradingService.cancelOrder(orderId);

    res.json({
        success: true,
        order: cancelledOrder,
        message: 'Order cancelled successfully'
    });
}));

/**
 * GET /api/v1/trading/positions/:portfolioId
 * Get positions for a portfolio
 */
router.get('/positions/:portfolioId', asyncHandler(async (req, res) => {
    const portfolioId = parseInt(req.params.portfolioId);
    
    if (isNaN(portfolioId)) {
        throw new ApiError('Invalid portfolio ID', 400);
    }

    // Verify portfolio ownership
    const portfolio = PortfolioService.getPortfolio(portfolioId);
    if (portfolio.user_id !== req.user.id) {
        throw new ApiError('Access denied', 403);
    }

    const positions = TradingService.getPortfolioPositions(portfolioId);

    res.json({
        success: true,
        positions
    });
}));

/**
 * GET /api/v1/trading/transactions
 * Get transaction history for a portfolio
 */
router.get('/transactions', asyncHandler(async (req, res) => {
    const { portfolioId, limit } = req.query;

    if (!portfolioId) {
        throw new ApiError('Portfolio ID is required', 400);
    }

    // Verify portfolio ownership
    const portfolio = PortfolioService.getPortfolio(parseInt(portfolioId));
    if (portfolio.user_id !== req.user.id) {
        throw new ApiError('Access denied', 403);
    }

    const transactions = TradingService.getPortfolioTransactions(
        parseInt(portfolioId), 
        limit ? parseInt(limit) : 50
    );

    res.json({
        success: true,
        transactions
    });
}));

/**
 * POST /api/v1/trading/orders/:id/fill
 * Manually fill an order (for testing purposes)
 */
router.post('/orders/:id/fill', asyncHandler(async (req, res) => {
    const orderId = parseInt(req.params.id);
    const { fillPrice, quantity } = req.body;
    
    if (isNaN(orderId)) {
        throw new ApiError('Invalid order ID', 400);
    }

    if (!fillPrice || fillPrice <= 0) {
        throw new ApiError('Fill price must be positive', 400);
    }

    const order = TradingService.getOrder(orderId);
    
    // Verify portfolio ownership
    const portfolio = PortfolioService.getPortfolio(order.portfolio_id);
    if (portfolio.user_id !== req.user.id) {
        throw new ApiError('Access denied', 403);
    }

    const filledOrder = TradingService.fillOrder(
        orderId, 
        parseFloat(fillPrice), 
        quantity ? parseFloat(quantity) : null
    );

    res.json({
        success: true,
        order: filledOrder,
        message: 'Order filled successfully'
    });
}));

/**
 * POST /api/v1/trading/sync
 * Sync orders with Alpaca (check for fills)
 */
router.post('/sync', asyncHandler(async (req, res) => {
    await TradingService.syncOrdersWithAlpaca();

    res.json({
        success: true,
        message: 'Order sync completed'
    });
}));

/**
 * GET /api/v1/trading/summary
 * Get trading summary across all user portfolios
 */
router.get('/summary', asyncHandler(async (req, res) => {
    const portfolios = PortfolioService.getUserPortfolios(req.user.id);
    
    let totalValue = 0;
    let totalReturn = 0;
    let totalStartingBalance = 0;
    let totalPositions = 0;
    let totalCash = 0;

    for (const portfolio of portfolios) {
        totalValue += portfolio.total_value;
        totalReturn += portfolio.total_return;
        totalStartingBalance += portfolio.starting_balance;
        totalPositions += portfolio.position_count;
        totalCash += portfolio.cash_balance;
    }

    const totalReturnPct = totalStartingBalance > 0 ? 
        (totalReturn / totalStartingBalance) * 100 : 0;

    const summary = {
        portfolio_count: portfolios.length,
        total_value: totalValue,
        total_cash: totalCash,
        total_positions_value: totalValue - totalCash,
        total_return: totalReturn,
        total_return_pct: totalReturnPct,
        total_positions: totalPositions,
        cash_pct: totalValue > 0 ? (totalCash / totalValue) * 100 : 0,
        positions_pct: totalValue > 0 ? ((totalValue - totalCash) / totalValue) * 100 : 0
    };

    res.json({
        success: true,
        summary
    });
}));

module.exports = router;