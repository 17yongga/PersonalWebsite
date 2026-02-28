const { getDb } = require('../config/database');
const { ApiError } = require('../middleware/error');
const alpacaService = require('./alpaca');

class PortfolioService {
    /**
     * Create a new portfolio
     */
    static createPortfolio(userId, { name, startingBalance = 10000, type = 'manual', strategyId = null }) {
        const db = getDb();
        
        const stmt = db.prepare(`
            INSERT INTO portfolios (user_id, name, starting_balance, cash_balance, type, strategy_id)
            VALUES (?, ?, ?, ?, ?, ?)
        `);

        const result = stmt.run(userId, name, startingBalance, startingBalance, type, strategyId);
        
        return this.getPortfolio(result.lastInsertRowid);
    }

    /**
     * Get portfolio by ID
     */
    static getPortfolio(portfolioId) {
        const db = getDb();
        
        const portfolio = db.prepare(`
            SELECT p.*, s.name as strategy_name 
            FROM portfolios p
            LEFT JOIN strategies s ON p.strategy_id = s.id
            WHERE p.id = ?
        `).get(portfolioId);

        if (!portfolio) {
            throw new ApiError('Portfolio not found', 404);
        }

        // Calculate total value
        const positions = this.getPortfolioPositions(portfolioId);
        const totalValue = positions.reduce((sum, pos) => sum + (pos.quantity * pos.current_price), portfolio.cash_balance);
        const totalReturn = totalValue - portfolio.starting_balance;
        const totalReturnPct = (totalReturn / portfolio.starting_balance) * 100;

        return {
            ...portfolio,
            total_value: totalValue,
            total_return: totalReturn,
            total_return_pct: totalReturnPct,
            positions: positions
        };
    }

    /**
     * Get all portfolios for a user
     */
    static getUserPortfolios(userId) {
        const db = getDb();
        
        const portfolios = db.prepare(`
            SELECT p.*, s.name as strategy_name 
            FROM portfolios p
            LEFT JOIN strategies s ON p.strategy_id = s.id
            WHERE p.user_id = ?
            ORDER BY p.created_at DESC
        `).all(userId);

        return portfolios.map(portfolio => {
            const positions = this.getPortfolioPositions(portfolio.id);
            const totalValue = positions.reduce((sum, pos) => sum + (pos.quantity * pos.current_price), portfolio.cash_balance);
            const totalReturn = totalValue - portfolio.starting_balance;
            const totalReturnPct = (totalReturn / portfolio.starting_balance) * 100;

            return {
                ...portfolio,
                total_value: totalValue,
                total_return: totalReturn,
                total_return_pct: totalReturnPct,
                position_count: positions.length
            };
        });
    }

    /**
     * Update portfolio
     */
    static updatePortfolio(portfolioId, updates) {
        const db = getDb();
        
        const allowedFields = ['name', 'cash_balance'];
        const fields = [];
        const values = [];

        for (const [key, value] of Object.entries(updates)) {
            if (allowedFields.includes(key)) {
                fields.push(`${key} = ?`);
                values.push(value);
            }
        }

        if (fields.length === 0) {
            throw new ApiError('No valid fields to update', 400);
        }

        values.push(portfolioId);
        
        const stmt = db.prepare(`
            UPDATE portfolios 
            SET ${fields.join(', ')} 
            WHERE id = ?
        `);

        const result = stmt.run(...values);
        
        if (result.changes === 0) {
            throw new ApiError('Portfolio not found', 404);
        }

        return this.getPortfolio(portfolioId);
    }

    /**
     * Delete portfolio
     */
    static deletePortfolio(portfolioId) {
        const db = getDb();
        
        const stmt = db.prepare('DELETE FROM portfolios WHERE id = ?');
        const result = stmt.run(portfolioId);
        
        if (result.changes === 0) {
            throw new ApiError('Portfolio not found', 404);
        }

        return { success: true };
    }

    /**
     * Reset portfolio to starting balance
     */
    static resetPortfolio(portfolioId) {
        const db = getDb();
        
        const portfolio = db.prepare('SELECT * FROM portfolios WHERE id = ?').get(portfolioId);
        
        if (!portfolio) {
            throw new ApiError('Portfolio not found', 404);
        }

        // Begin transaction
        const deletePositions = db.prepare('DELETE FROM positions WHERE portfolio_id = ?');
        const deleteOrders = db.prepare('DELETE FROM orders WHERE portfolio_id = ?');
        const deleteTransactions = db.prepare('DELETE FROM transactions WHERE portfolio_id = ?');
        const resetCash = db.prepare('UPDATE portfolios SET cash_balance = starting_balance WHERE id = ?');

        const transaction = db.transaction(() => {
            deletePositions.run(portfolioId);
            deleteOrders.run(portfolioId);
            deleteTransactions.run(portfolioId);
            resetCash.run(portfolioId);
        });

        transaction();

        return this.getPortfolio(portfolioId);
    }

    /**
     * Get positions for a portfolio
     */
    static getPortfolioPositions(portfolioId) {
        const db = getDb();
        
        const positions = db.prepare(`
            SELECT * FROM positions WHERE portfolio_id = ?
        `).all(portfolioId);

        // Add current prices (mock data for now since we don't have real-time feeds)
        return positions.map(position => ({
            ...position,
            current_price: position.avg_cost_basis * (0.95 + Math.random() * 0.1), // Mock price variation
            unrealized_pnl: 0 // Will be calculated with real prices
        }));
    }

    /**
     * Update position in portfolio
     */
    static updatePosition(portfolioId, symbol, quantity, price) {
        const db = getDb();
        
        const existingPosition = db.prepare(`
            SELECT * FROM positions WHERE portfolio_id = ? AND symbol = ?
        `).get(portfolioId, symbol);

        if (existingPosition) {
            // Update existing position
            const newQuantity = existingPosition.quantity + quantity;
            
            if (newQuantity === 0) {
                // Close position
                db.prepare('DELETE FROM positions WHERE id = ?').run(existingPosition.id);
            } else {
                // Update quantity and average cost
                const newAvgCost = ((existingPosition.quantity * existingPosition.avg_cost_basis) + (quantity * price)) / newQuantity;
                
                db.prepare(`
                    UPDATE positions 
                    SET quantity = ?, avg_cost_basis = ?, updated_at = CURRENT_TIMESTAMP
                    WHERE id = ?
                `).run(newQuantity, newAvgCost, existingPosition.id);
            }
        } else if (quantity > 0) {
            // Create new position
            db.prepare(`
                INSERT INTO positions (portfolio_id, symbol, quantity, avg_cost_basis)
                VALUES (?, ?, ?, ?)
            `).run(portfolioId, symbol, quantity, price);
        }
    }

    /**
     * Update portfolio cash balance
     */
    static updateCashBalance(portfolioId, amount) {
        const db = getDb();
        
        const stmt = db.prepare(`
            UPDATE portfolios 
            SET cash_balance = cash_balance + ? 
            WHERE id = ?
        `);

        stmt.run(amount, portfolioId);
    }
}

module.exports = PortfolioService;