const { getDb } = require('../config/database');
const { ApiError } = require('../middleware/error');
const alpacaService = require('./alpaca');
const PortfolioService = require('./portfolio');

class TradingService {
    /**
     * Place a new order
     */
    static async placeOrder(portfolioId, orderData) {
        const { symbol, side, type, quantity, limitPrice, stopPrice, source = 'manual' } = orderData;

        // Validate portfolio exists
        const db = getDb();
        const portfolio = db.prepare('SELECT * FROM portfolios WHERE id = ?').get(portfolioId);
        
        if (!portfolio) {
            throw new ApiError('Portfolio not found', 404);
        }

        // Validate order data
        this.validateOrderData(orderData);

        // Check buying power for buy orders
        if (side === 'buy') {
            const requiredCash = type === 'market' ? quantity * 100 : quantity * (limitPrice || 100); // Rough estimate
            if (portfolio.cash_balance < requiredCash) {
                throw new ApiError('Insufficient buying power', 400);
            }
        }

        // Check position for sell orders
        if (side === 'sell') {
            const position = db.prepare(`
                SELECT quantity FROM positions 
                WHERE portfolio_id = ? AND symbol = ?
            `).get(portfolioId, symbol);

            if (!position || position.quantity < quantity) {
                throw new ApiError('Insufficient shares to sell', 400);
            }
        }

        let alpacaOrderId = null;
        let status = 'pending';

        try {
            // Place order with Alpaca if credentials are available
            const alpacaOrder = {
                symbol: symbol.toUpperCase(),
                qty: quantity,
                side,
                type,
                time_in_force: 'day'
            };

            if (limitPrice) alpacaOrder.limit_price = limitPrice;
            if (stopPrice) alpacaOrder.stop_price = stopPrice;

            const alpacaResponse = await alpacaService.placeOrder(alpacaOrder);
            alpacaOrderId = alpacaResponse.id;
            status = alpacaResponse.status || 'pending';
        } catch (error) {
            console.warn('Failed to place order with Alpaca:', error.message);
            // Continue with local order storage even if Alpaca fails
        }

        // Store order locally
        const stmt = db.prepare(`
            INSERT INTO orders (portfolio_id, symbol, side, type, quantity, limit_price, stop_price, status, alpaca_order_id, source)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);

        const result = stmt.run(
            portfolioId, 
            symbol.toUpperCase(), 
            side, 
            type, 
            quantity, 
            limitPrice, 
            stopPrice, 
            status, 
            alpacaOrderId, 
            source
        );

        return this.getOrder(result.lastInsertRowid);
    }

    /**
     * Get order by ID
     */
    static getOrder(orderId) {
        const db = getDb();
        
        const order = db.prepare(`
            SELECT o.*, p.name as portfolio_name
            FROM orders o
            JOIN portfolios p ON o.portfolio_id = p.id
            WHERE o.id = ?
        `).get(orderId);

        if (!order) {
            throw new ApiError('Order not found', 404);
        }

        return order;
    }

    /**
     * Get orders for portfolio
     */
    static getPortfolioOrders(portfolioId, params = {}) {
        const db = getDb();
        
        let query = `
            SELECT o.*, p.name as portfolio_name
            FROM orders o
            JOIN portfolios p ON o.portfolio_id = p.id
            WHERE o.portfolio_id = ?
        `;
        
        const queryParams = [portfolioId];

        if (params.status) {
            query += ' AND o.status = ?';
            queryParams.push(params.status);
        }

        if (params.symbol) {
            query += ' AND o.symbol = ?';
            queryParams.push(params.symbol.toUpperCase());
        }

        query += ' ORDER BY o.created_at DESC';

        if (params.limit) {
            query += ' LIMIT ?';
            queryParams.push(params.limit);
        }

        return db.prepare(query).all(...queryParams);
    }

    /**
     * Cancel an order
     */
    static async cancelOrder(orderId) {
        const db = getDb();
        
        const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId);
        
        if (!order) {
            throw new ApiError('Order not found', 404);
        }

        if (order.status !== 'pending') {
            throw new ApiError('Order cannot be cancelled', 400);
        }

        // Cancel with Alpaca if order was placed there
        if (order.alpaca_order_id) {
            try {
                await alpacaService.cancelOrder(order.alpaca_order_id);
            } catch (error) {
                console.warn('Failed to cancel order with Alpaca:', error.message);
                // Continue with local cancellation
            }
        }

        // Update local order status
        db.prepare('UPDATE orders SET status = ? WHERE id = ?').run('cancelled', orderId);

        return this.getOrder(orderId);
    }

    /**
     * Fill an order (called when order is executed)
     */
    static fillOrder(orderId, fillPrice, quantity = null) {
        const db = getDb();
        
        const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId);
        
        if (!order) {
            throw new ApiError('Order not found', 404);
        }

        const fillQuantity = quantity || order.quantity;
        const total = fillQuantity * fillPrice;
        const cashChange = order.side === 'buy' ? -total : total;
        const positionChange = order.side === 'buy' ? fillQuantity : -fillQuantity;

        // Begin transaction
        const transaction = db.transaction(() => {
            // Update order status
            db.prepare(`
                UPDATE orders 
                SET status = 'filled', fill_price = ? 
                WHERE id = ?
            `).run(fillPrice, orderId);

            // Update portfolio cash
            PortfolioService.updateCashBalance(order.portfolio_id, cashChange);

            // Update position
            PortfolioService.updatePosition(order.portfolio_id, order.symbol, positionChange, fillPrice);

            // Create transaction record
            db.prepare(`
                INSERT INTO transactions (portfolio_id, order_id, symbol, side, quantity, price, total)
                VALUES (?, ?, ?, ?, ?, ?, ?)
            `).run(order.portfolio_id, orderId, order.symbol, order.side, fillQuantity, fillPrice, Math.abs(total));
        });

        transaction();

        return this.getOrder(orderId);
    }

    /**
     * Get portfolio positions
     */
    static getPortfolioPositions(portfolioId) {
        return PortfolioService.getPortfolioPositions(portfolioId);
    }

    /**
     * Get portfolio transactions
     */
    static getPortfolioTransactions(portfolioId, limit = 50) {
        const db = getDb();
        
        return db.prepare(`
            SELECT t.*, o.source as order_source
            FROM transactions t
            LEFT JOIN orders o ON t.order_id = o.id
            WHERE t.portfolio_id = ?
            ORDER BY t.created_at DESC
            LIMIT ?
        `).all(portfolioId, limit);
    }

    /**
     * Sync orders with Alpaca (to check for fills)
     */
    static async syncOrdersWithAlpaca() {
        const db = getDb();
        
        // Get pending orders that have Alpaca IDs
        const pendingOrders = db.prepare(`
            SELECT * FROM orders 
            WHERE status = 'pending' AND alpaca_order_id IS NOT NULL
        `).all();

        for (const order of pendingOrders) {
            try {
                const alpacaOrder = await alpacaService.getOrder(order.alpaca_order_id);
                
                if (alpacaOrder.status === 'filled' && order.status === 'pending') {
                    // Fill the order locally
                    this.fillOrder(order.id, parseFloat(alpacaOrder.filled_avg_price || alpacaOrder.limit_price));
                    console.log(`Filled order ${order.id} from Alpaca sync`);
                } else if (alpacaOrder.status === 'cancelled' && order.status === 'pending') {
                    // Cancel the order locally
                    db.prepare('UPDATE orders SET status = ? WHERE id = ?').run('cancelled', order.id);
                    console.log(`Cancelled order ${order.id} from Alpaca sync`);
                }
            } catch (error) {
                console.warn(`Failed to sync order ${order.id} with Alpaca:`, error.message);
            }
        }
    }

    /**
     * Validate order data
     */
    static validateOrderData(orderData) {
        const { symbol, side, type, quantity, limitPrice, stopPrice } = orderData;

        if (!symbol || typeof symbol !== 'string') {
            throw new ApiError('Symbol is required', 400);
        }

        if (!side || !['buy', 'sell'].includes(side)) {
            throw new ApiError('Side must be buy or sell', 400);
        }

        if (!type || !['market', 'limit', 'stop', 'stop_limit'].includes(type)) {
            throw new ApiError('Invalid order type', 400);
        }

        if (!quantity || quantity <= 0) {
            throw new ApiError('Quantity must be positive', 400);
        }

        if ((type === 'limit' || type === 'stop_limit') && (!limitPrice || limitPrice <= 0)) {
            throw new ApiError('Limit price required for limit orders', 400);
        }

        if ((type === 'stop' || type === 'stop_limit') && (!stopPrice || stopPrice <= 0)) {
            throw new ApiError('Stop price required for stop orders', 400);
        }
    }
}

module.exports = TradingService;