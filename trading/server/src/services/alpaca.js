// Node 18+ has native fetch
const config = require('../config');

class AlpacaService {
    constructor() {
        this.baseUrl = config.alpaca.baseUrl;
        this.dataUrl = config.alpaca.dataUrl;
        this.apiKey = config.alpaca.apiKey;
        this.secretKey = config.alpaca.secretKey;
        
        if (!this.apiKey || !this.secretKey) {
            console.warn('⚠️ Alpaca API credentials not configured - trading features will be disabled');
        }
    }

    /**
     * Make authenticated request to Alpaca API
     */
    async makeRequest(url, options = {}) {
        if (!this.apiKey || !this.secretKey) {
            throw new AlpacaError('Alpaca API credentials not configured', 503);
        }

        const headers = {
            'APCA-API-KEY-ID': this.apiKey,
            'APCA-API-SECRET-KEY': this.secretKey,
            'Content-Type': 'application/json',
            ...options.headers
        };

        const response = await fetch(url, {
            ...options,
            headers
        });

        const data = await response.json().catch(() => ({}));

        if (!response.ok) {
            throw new AlpacaError(
                data.message || `Alpaca API error: ${response.status}`,
                response.status
            );
        }

        return data;
    }

    /**
     * Get account information
     */
    async getAccount() {
        const url = `${this.baseUrl}/v2/account`;
        return this.makeRequest(url);
    }

    /**
     * Get all positions
     */
    async getPositions() {
        const url = `${this.baseUrl}/v2/positions`;
        return this.makeRequest(url);
    }

    /**
     * Get specific position
     */
    async getPosition(symbol) {
        const url = `${this.baseUrl}/v2/positions/${symbol}`;
        try {
            return await this.makeRequest(url);
        } catch (error) {
            if (error.status === 404) {
                return null; // No position in this symbol
            }
            throw error;
        }
    }

    /**
     * Place order
     */
    async placeOrder(orderData) {
        const url = `${this.baseUrl}/v2/orders`;
        
        // Validate required fields
        const required = ['symbol', 'qty', 'side', 'type', 'time_in_force'];
        for (const field of required) {
            if (!orderData[field]) {
                throw new AlpacaError(`Missing required field: ${field}`, 400);
            }
        }

        // Default time_in_force if not specified
        if (!orderData.time_in_force) {
            orderData.time_in_force = 'day';
        }

        return this.makeRequest(url, {
            method: 'POST',
            body: JSON.stringify(orderData)
        });
    }

    /**
     * Get orders
     */
    async getOrders(params = {}) {
        const url = new URL(`${this.baseUrl}/v2/orders`);
        
        // Add query parameters
        Object.keys(params).forEach(key => {
            if (params[key] !== undefined) {
                url.searchParams.append(key, params[key]);
            }
        });

        return this.makeRequest(url.toString());
    }

    /**
     * Get specific order
     */
    async getOrder(orderId) {
        const url = `${this.baseUrl}/v2/orders/${orderId}`;
        return this.makeRequest(url);
    }

    /**
     * Cancel order
     */
    async cancelOrder(orderId) {
        const url = `${this.baseUrl}/v2/orders/${orderId}`;
        return this.makeRequest(url, { method: 'DELETE' });
    }

    /**
     * Get asset info
     */
    async getAsset(symbol) {
        const url = `${this.baseUrl}/v2/assets/${symbol}`;
        return this.makeRequest(url);
    }

    /**
     * Get latest quote for symbol
     */
    async getLatestQuote(symbol) {
        const url = `${this.dataUrl}/v2/stocks/${symbol}/quotes/latest`;
        return this.makeRequest(url);
    }

    /**
     * Get latest bar for symbol
     */
    async getLatestBar(symbol) {
        const url = `${this.dataUrl}/v2/stocks/${symbol}/bars/latest`;
        return this.makeRequest(url);
    }

    /**
     * Get historical bars
     */
    async getBars(symbol, params = {}) {
        const url = new URL(`${this.dataUrl}/v2/stocks/${symbol}/bars`);
        
        // Default parameters
        const defaultParams = {
            timeframe: '1Day',
            limit: 100
        };

        const finalParams = { ...defaultParams, ...params };
        
        Object.keys(finalParams).forEach(key => {
            if (finalParams[key] !== undefined) {
                url.searchParams.append(key, finalParams[key]);
            }
        });

        return this.makeRequest(url.toString());
    }

    /**
     * Search for tradeable assets
     */
    async searchAssets(query, params = {}) {
        const url = new URL(`${this.baseUrl}/v2/assets`);
        
        const searchParams = {
            search: query,
            status: 'active',
            asset_class: 'us_equity',
            ...params
        };

        Object.keys(searchParams).forEach(key => {
            if (searchParams[key] !== undefined) {
                url.searchParams.append(key, searchParams[key]);
            }
        });

        return this.makeRequest(url.toString());
    }

    /**
     * Get portfolio history
     */
    async getPortfolioHistory(params = {}) {
        const url = new URL(`${this.baseUrl}/v2/account/portfolio/history`);
        
        Object.keys(params).forEach(key => {
            if (params[key] !== undefined) {
                url.searchParams.append(key, params[key]);
            }
        });

        return this.makeRequest(url.toString());
    }
}

/**
 * Custom error class for Alpaca API errors
 */
class AlpacaError extends Error {
    constructor(message, status = 500) {
        super(message);
        this.name = 'AlpacaError';
        this.status = status;
    }
}

// Export singleton instance
module.exports = new AlpacaService();