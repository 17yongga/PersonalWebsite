const express = require('express');
const { authenticateToken } = require('../middleware/auth');
const { ApiError, asyncHandler } = require('../middleware/error');
const PortfolioService = require('../services/portfolio');
const config = require('../config');

const router = express.Router();

// All portfolio routes require authentication
router.use(authenticateToken);

/**
 * GET /api/v1/portfolios
 * Get all portfolios for the authenticated user
 */
router.get('/', asyncHandler(async (req, res) => {
    const portfolios = PortfolioService.getUserPortfolios(req.user.id);
    
    res.json({
        success: true,
        portfolios
    });
}));

/**
 * POST /api/v1/portfolios
 * Create a new portfolio
 */
router.post('/', asyncHandler(async (req, res) => {
    const { name, startingBalance, type = 'manual', strategyId } = req.body;

    if (!name) {
        throw new ApiError('Portfolio name is required', 400);
    }

    if (startingBalance && (typeof startingBalance !== 'number' || startingBalance <= 0)) {
        throw new ApiError('Starting balance must be a positive number', 400);
    }

    if (!['manual', 'strategy'].includes(type)) {
        throw new ApiError('Portfolio type must be manual or strategy', 400);
    }

    const portfolio = PortfolioService.createPortfolio(req.user.id, {
        name,
        startingBalance: startingBalance || config.initialCapital,
        type,
        strategyId: type === 'strategy' ? strategyId : null
    });

    res.status(201).json({
        success: true,
        portfolio
    });
}));

/**
 * GET /api/v1/portfolios/:id
 * Get portfolio details
 */
router.get('/:id', asyncHandler(async (req, res) => {
    const portfolioId = parseInt(req.params.id);
    
    if (isNaN(portfolioId)) {
        throw new ApiError('Invalid portfolio ID', 400);
    }

    const portfolio = PortfolioService.getPortfolio(portfolioId);
    
    // Check ownership
    if (portfolio.user_id !== req.user.id) {
        throw new ApiError('Access denied', 403);
    }

    res.json({
        success: true,
        portfolio
    });
}));

/**
 * PATCH /api/v1/portfolios/:id
 * Update portfolio
 */
router.patch('/:id', asyncHandler(async (req, res) => {
    const portfolioId = parseInt(req.params.id);
    
    if (isNaN(portfolioId)) {
        throw new ApiError('Invalid portfolio ID', 400);
    }

    // Check ownership first
    const existingPortfolio = PortfolioService.getPortfolio(portfolioId);
    if (existingPortfolio.user_id !== req.user.id) {
        throw new ApiError('Access denied', 403);
    }

    const { name, cashBalance } = req.body;
    const updates = {};

    if (name) {
        updates.name = name;
    }

    if (cashBalance !== undefined) {
        if (typeof cashBalance !== 'number' || cashBalance < 0) {
            throw new ApiError('Cash balance must be a non-negative number', 400);
        }
        updates.cash_balance = cashBalance;
    }

    const portfolio = PortfolioService.updatePortfolio(portfolioId, updates);

    res.json({
        success: true,
        portfolio
    });
}));

/**
 * DELETE /api/v1/portfolios/:id
 * Delete portfolio
 */
router.delete('/:id', asyncHandler(async (req, res) => {
    const portfolioId = parseInt(req.params.id);
    
    if (isNaN(portfolioId)) {
        throw new ApiError('Invalid portfolio ID', 400);
    }

    // Check ownership first
    const existingPortfolio = PortfolioService.getPortfolio(portfolioId);
    if (existingPortfolio.user_id !== req.user.id) {
        throw new ApiError('Access denied', 403);
    }

    // Prevent deletion of the last portfolio
    const userPortfolios = PortfolioService.getUserPortfolios(req.user.id);
    if (userPortfolios.length <= 1) {
        throw new ApiError('Cannot delete your only portfolio', 400);
    }

    PortfolioService.deletePortfolio(portfolioId);

    res.json({
        success: true,
        message: 'Portfolio deleted successfully'
    });
}));

/**
 * POST /api/v1/portfolios/:id/reset
 * Reset portfolio to starting balance
 */
router.post('/:id/reset', asyncHandler(async (req, res) => {
    const portfolioId = parseInt(req.params.id);
    
    if (isNaN(portfolioId)) {
        throw new ApiError('Invalid portfolio ID', 400);
    }

    // Check ownership first
    const existingPortfolio = PortfolioService.getPortfolio(portfolioId);
    if (existingPortfolio.user_id !== req.user.id) {
        throw new ApiError('Access denied', 403);
    }

    const portfolio = PortfolioService.resetPortfolio(portfolioId);

    res.json({
        success: true,
        portfolio,
        message: 'Portfolio reset to starting balance'
    });
}));

/**
 * GET /api/v1/portfolios/:id/positions
 * Get positions for a portfolio
 */
router.get('/:id/positions', asyncHandler(async (req, res) => {
    const portfolioId = parseInt(req.params.id);
    
    if (isNaN(portfolioId)) {
        throw new ApiError('Invalid portfolio ID', 400);
    }

    // Check ownership first
    const existingPortfolio = PortfolioService.getPortfolio(portfolioId);
    if (existingPortfolio.user_id !== req.user.id) {
        throw new ApiError('Access denied', 403);
    }

    const positions = PortfolioService.getPortfolioPositions(portfolioId);

    res.json({
        success: true,
        positions
    });
}));

/**
 * GET /api/v1/portfolios/:id/summary
 * Get portfolio performance summary
 */
router.get('/:id/summary', asyncHandler(async (req, res) => {
    const portfolioId = parseInt(req.params.id);
    
    if (isNaN(portfolioId)) {
        throw new ApiError('Invalid portfolio ID', 400);
    }

    // Check ownership first
    const portfolio = PortfolioService.getPortfolio(portfolioId);
    if (portfolio.user_id !== req.user.id) {
        throw new ApiError('Access denied', 403);
    }

    // Calculate additional metrics
    const totalValue = portfolio.total_value;
    const dailyReturn = 0; // Would need historical data to calculate
    const weeklyReturn = 0;
    const monthlyReturn = 0;

    const summary = {
        portfolio_id: portfolio.id,
        name: portfolio.name,
        starting_balance: portfolio.starting_balance,
        current_value: totalValue,
        cash_balance: portfolio.cash_balance,
        total_return: portfolio.total_return,
        total_return_pct: portfolio.total_return_pct,
        daily_return: dailyReturn,
        weekly_return: weeklyReturn,
        monthly_return: monthlyReturn,
        position_count: portfolio.positions.length,
        positions_value: totalValue - portfolio.cash_balance,
        cash_pct: (portfolio.cash_balance / totalValue) * 100,
        positions_pct: ((totalValue - portfolio.cash_balance) / totalValue) * 100
    };

    res.json({
        success: true,
        summary
    });
}));

module.exports = router;