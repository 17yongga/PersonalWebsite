const alpacaService = require('./alpaca');
const { ApiError } = require('../middleware/error');

class MarketService {
    /**
     * Get latest quote for a symbol
     */
    static async getQuote(symbol) {
        try {
            const quote = await alpacaService.getLatestQuote(symbol.toUpperCase());
            
            if (!quote || !quote.quote) {
                throw new ApiError(`No quote data found for ${symbol}`, 404);
            }

            return {
                symbol: symbol.toUpperCase(),
                bid: quote.quote.bp || 0,
                ask: quote.quote.ap || 0,
                bid_size: quote.quote.bs || 0,
                ask_size: quote.quote.as || 0,
                timestamp: quote.quote.t,
                midpoint: ((quote.quote.bp || 0) + (quote.quote.ap || 0)) / 2
            };
        } catch (error) {
            if (error.status === 404) {
                throw new ApiError(`Symbol ${symbol} not found`, 404);
            }
            throw error;
        }
    }

    /**
     * Get latest bar (OHLCV) for a symbol
     */
    static async getLatestBar(symbol) {
        try {
            const response = await alpacaService.getLatestBar(symbol.toUpperCase());
            
            if (!response || !response.bar) {
                throw new ApiError(`No bar data found for ${symbol}`, 404);
            }

            const bar = response.bar;
            return {
                symbol: symbol.toUpperCase(),
                open: bar.o,
                high: bar.h,
                low: bar.l,
                close: bar.c,
                volume: bar.v,
                timestamp: bar.t,
                vwap: bar.vw || null
            };
        } catch (error) {
            if (error.status === 404) {
                throw new ApiError(`Symbol ${symbol} not found`, 404);
            }
            throw error;
        }
    }

    /**
     * Get historical bars for a symbol
     */
    static async getHistoricalBars(symbol, params = {}) {
        try {
            const {
                timeframe = '1Day',
                start = null,
                end = null,
                limit = 100
            } = params;

            const barParams = {
                timeframe,
                limit: Math.min(limit, 1000) // Cap at 1000 bars
            };

            if (start) barParams.start = start;
            if (end) barParams.end = end;

            const response = await alpacaService.getBars(symbol.toUpperCase(), barParams);
            
            if (!response || !response.bars || !Array.isArray(response.bars)) {
                return {
                    symbol: symbol.toUpperCase(),
                    bars: [],
                    next_page_token: null
                };
            }

            const bars = response.bars.map(bar => ({
                timestamp: bar.t,
                open: bar.o,
                high: bar.h,
                low: bar.l,
                close: bar.c,
                volume: bar.v,
                vwap: bar.vw || null,
                trade_count: bar.n || null
            }));

            return {
                symbol: symbol.toUpperCase(),
                timeframe,
                bars,
                next_page_token: response.next_page_token || null
            };
        } catch (error) {
            if (error.status === 404) {
                throw new ApiError(`Symbol ${symbol} not found`, 404);
            }
            throw error;
        }
    }

    /**
     * Search for symbols
     */
    static async searchSymbols(query, limit = 20) {
        try {
            if (!query || query.length < 1) {
                throw new ApiError('Search query is required', 400);
            }

            const assets = await alpacaService.searchAssets(query.toUpperCase(), {
                limit: Math.min(limit, 100)
            });

            if (!Array.isArray(assets)) {
                return [];
            }

            return assets.map(asset => ({
                symbol: asset.symbol,
                name: asset.name,
                exchange: asset.exchange,
                asset_class: asset.class,
                status: asset.status,
                tradable: asset.tradable,
                marginable: asset.marginable,
                shortable: asset.shortable,
                easy_to_borrow: asset.easy_to_borrow
            })).filter(asset => asset.tradable && asset.status === 'active');
        } catch (error) {
            console.warn('Symbol search failed:', error.message);
            return [];
        }
    }

    /**
     * Get asset details
     */
    static async getAssetInfo(symbol) {
        try {
            const asset = await alpacaService.getAsset(symbol.toUpperCase());
            
            return {
                symbol: asset.symbol,
                name: asset.name,
                exchange: asset.exchange,
                asset_class: asset.class,
                status: asset.status,
                tradable: asset.tradable,
                marginable: asset.marginable,
                shortable: asset.shortable,
                easy_to_borrow: asset.easy_to_borrow,
                fractionable: asset.fractionable || false,
                min_order_size: asset.min_order_size || null,
                min_trade_increment: asset.min_trade_increment || null
            };
        } catch (error) {
            if (error.status === 404) {
                throw new ApiError(`Symbol ${symbol} not found`, 404);
            }
            throw error;
        }
    }

    /**
     * Get multiple quotes at once
     */
    static async getMultipleQuotes(symbols) {
        if (!Array.isArray(symbols) || symbols.length === 0) {
            throw new ApiError('Symbols array is required', 400);
        }

        // Limit to reasonable number of requests
        const limitedSymbols = symbols.slice(0, 20);
        
        const quotes = await Promise.allSettled(
            limitedSymbols.map(symbol => this.getQuote(symbol))
        );

        const results = {};
        
        quotes.forEach((result, index) => {
            const symbol = limitedSymbols[index].toUpperCase();
            if (result.status === 'fulfilled') {
                results[symbol] = result.value;
            } else {
                results[symbol] = {
                    error: result.reason.message || 'Failed to get quote'
                };
            }
        });

        return results;
    }

    /**
     * Get market status
     */
    static async getMarketStatus() {
        try {
            // This would typically come from Alpaca's clock endpoint
            // For now, we'll return a simplified version
            const now = new Date();
            const hour = now.getUTCHours() - 5; // EST offset
            const dayOfWeek = now.getUTCDay();
            
            // Simple market hours check (9:30 AM - 4:00 PM EST, Monday-Friday)
            const isWeekday = dayOfWeek >= 1 && dayOfWeek <= 5;
            const isMarketHours = hour >= 9.5 && hour < 16;
            
            return {
                is_open: isWeekday && isMarketHours,
                next_open: null, // Would calculate next market open
                next_close: null, // Would calculate next market close
                timestamp: now.toISOString()
            };
        } catch (error) {
            console.warn('Failed to get market status:', error.message);
            return {
                is_open: false,
                next_open: null,
                next_close: null,
                timestamp: new Date().toISOString()
            };
        }
    }

    /**
     * Generate mock price data for development/testing
     */
    static generateMockQuote(symbol, basePrice = 100) {
        const variation = (Math.random() - 0.5) * 0.1; // ±5% variation
        const price = basePrice * (1 + variation);
        const spread = price * 0.001; // 0.1% spread
        
        return {
            symbol: symbol.toUpperCase(),
            bid: price - spread / 2,
            ask: price + spread / 2,
            bid_size: Math.floor(Math.random() * 1000) + 100,
            ask_size: Math.floor(Math.random() * 1000) + 100,
            timestamp: new Date().toISOString(),
            midpoint: price
        };
    }

    /**
     * Generate mock historical data
     */
    static generateMockBars(symbol, days = 30, basePrice = 100) {
        const bars = [];
        let currentPrice = basePrice;
        const startDate = new Date();
        startDate.setDate(startDate.getDate() - days);

        for (let i = 0; i < days; i++) {
            const date = new Date(startDate);
            date.setDate(date.getDate() + i);
            
            const dailyChange = (Math.random() - 0.5) * 0.05; // ±2.5% daily change
            const open = currentPrice;
            const close = open * (1 + dailyChange);
            const high = Math.max(open, close) * (1 + Math.random() * 0.02);
            const low = Math.min(open, close) * (1 - Math.random() * 0.02);
            const volume = Math.floor(Math.random() * 1000000) + 100000;

            bars.push({
                timestamp: date.toISOString(),
                open: open,
                high: high,
                low: low,
                close: close,
                volume: volume,
                vwap: (high + low + close) / 3,
                trade_count: Math.floor(volume / 100)
            });

            currentPrice = close;
        }

        return {
            symbol: symbol.toUpperCase(),
            timeframe: '1Day',
            bars,
            next_page_token: null
        };
    }
}

module.exports = MarketService;