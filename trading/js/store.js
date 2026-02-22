// Simple Pub/Sub State Store

class Store {
    constructor() {
        this.state = {};
        this.subscribers = new Map();
        this.debugMode = false;
    }

    // Get a value from the state
    getState(key) {
        return key ? this.state[key] : this.state;
    }

    // Set a value in the state and notify subscribers
    setState(key, value) {
        const oldValue = this.state[key];
        
        // Only update and notify if the value actually changed
        if (oldValue !== value) {
            this.state[key] = value;
            
            if (this.debugMode) {
                console.log(`Store: ${key} changed from`, oldValue, 'to', value);
            }
            
            this.notifySubscribers(key, value, oldValue);
        }
        
        return value;
    }

    // Update multiple state values at once
    setMultipleStates(updates) {
        const changes = [];
        
        Object.entries(updates).forEach(([key, value]) => {
            const oldValue = this.state[key];
            if (oldValue !== value) {
                this.state[key] = value;
                changes.push({ key, value, oldValue });
            }
        });
        
        // Notify subscribers for all changes
        changes.forEach(({ key, value, oldValue }) => {
            if (this.debugMode) {
                console.log(`Store: ${key} changed from`, oldValue, 'to', value);
            }
            this.notifySubscribers(key, value, oldValue);
        });
        
        return this.state;
    }

    // Subscribe to changes for a specific key
    subscribe(key, callback) {
        if (typeof callback !== 'function') {
            throw new Error('Callback must be a function');
        }
        
        if (!this.subscribers.has(key)) {
            this.subscribers.set(key, new Set());
        }
        
        this.subscribers.get(key).add(callback);
        
        // Return an unsubscribe function
        return () => this.unsubscribe(key, callback);
    }

    // Unsubscribe from changes for a specific key
    unsubscribe(key, callback) {
        if (this.subscribers.has(key)) {
            this.subscribers.get(key).delete(callback);
            
            // Clean up empty subscriber sets
            if (this.subscribers.get(key).size === 0) {
                this.subscribers.delete(key);
            }
        }
    }

    // Subscribe to changes for multiple keys
    subscribeToMultiple(keys, callback) {
        const unsubscribeFunctions = keys.map(key => this.subscribe(key, callback));
        
        // Return a function that unsubscribes from all
        return () => unsubscribeFunctions.forEach(unsub => unsub());
    }

    // Notify all subscribers for a specific key
    notifySubscribers(key, newValue, oldValue) {
        if (this.subscribers.has(key)) {
            this.subscribers.get(key).forEach(callback => {
                try {
                    callback(newValue, oldValue, key);
                } catch (error) {
                    console.error(`Error in store subscriber for key "${key}":`, error);
                }
            });
        }
    }

    // Clear all state and subscribers
    clear() {
        this.state = {};
        this.subscribers.clear();
        
        if (this.debugMode) {
            console.log('Store: cleared all state and subscribers');
        }
    }

    // Remove a specific key from state
    removeState(key) {
        if (key in this.state) {
            const oldValue = this.state[key];
            delete this.state[key];
            
            if (this.debugMode) {
                console.log(`Store: removed key "${key}" with value`, oldValue);
            }
            
            // Notify subscribers that the value is now undefined
            this.notifySubscribers(key, undefined, oldValue);
        }
    }

    // Check if a key exists in state
    hasState(key) {
        return key in this.state;
    }

    // Get all keys in state
    getKeys() {
        return Object.keys(this.state);
    }

    // Enable/disable debug logging
    setDebugMode(enabled) {
        this.debugMode = !!enabled;
        console.log(`Store debug mode: ${enabled ? 'enabled' : 'disabled'}`);
    }

    // Get debug information
    getDebugInfo() {
        return {
            state: { ...this.state },
            subscriberCounts: Object.fromEntries(
                Array.from(this.subscribers.entries()).map(([key, set]) => [key, set.size])
            ),
            debugMode: this.debugMode
        };
    }
}

// Create and configure the store instance
const store = new Store();

// Initialize with default state
store.setMultipleStates({
    // User state
    user: null,
    isAuthenticated: false,
    
    // UI state
    theme: 'dark',
    currentRoute: null,
    sidebarOpen: false,
    
    // Trading state
    portfolios: [],
    activePortfolio: null,
    watchlist: [],
    
    // Market data cache
    quotes: new Map(),
    lastUpdated: null,
    
    // WebSocket connection status
    wsConnected: false,
    wsReconnectAttempts: 0
});

// Helper functions for common operations

// User-related helpers
export const userHelpers = {
    setUser(userData) {
        store.setMultipleStates({
            user: userData,
            isAuthenticated: !!userData
        });
    },
    
    clearUser() {
        store.setMultipleStates({
            user: null,
            isAuthenticated: false
        });
    },
    
    updateUserField(field, value) {
        const currentUser = store.getState('user');
        if (currentUser) {
            store.setState('user', { ...currentUser, [field]: value });
        }
    }
};

// Portfolio-related helpers
export const portfolioHelpers = {
    setPortfolios(portfolios) {
        store.setState('portfolios', portfolios);
        
        // Set active portfolio if not set
        const activePortfolio = store.getState('activePortfolio');
        if (!activePortfolio && portfolios.length > 0) {
            store.setState('activePortfolio', portfolios[0].id);
        }
    },
    
    addPortfolio(portfolio) {
        const portfolios = store.getState('portfolios') || [];
        store.setState('portfolios', [...portfolios, portfolio]);
    },
    
    updatePortfolio(portfolioId, updates) {
        const portfolios = store.getState('portfolios') || [];
        const updatedPortfolios = portfolios.map(p => 
            p.id === portfolioId ? { ...p, ...updates } : p
        );
        store.setState('portfolios', updatedPortfolios);
    },
    
    removePortfolio(portfolioId) {
        const portfolios = store.getState('portfolios') || [];
        store.setState('portfolios', portfolios.filter(p => p.id !== portfolioId));
        
        // Clear active portfolio if it was removed
        if (store.getState('activePortfolio') === portfolioId) {
            const remaining = portfolios.filter(p => p.id !== portfolioId);
            store.setState('activePortfolio', remaining.length > 0 ? remaining[0].id : null);
        }
    }
};

// Watchlist helpers
export const watchlistHelpers = {
    addToWatchlist(symbol) {
        const watchlist = store.getState('watchlist') || [];
        if (!watchlist.includes(symbol)) {
            store.setState('watchlist', [...watchlist, symbol]);
        }
    },
    
    removeFromWatchlist(symbol) {
        const watchlist = store.getState('watchlist') || [];
        store.setState('watchlist', watchlist.filter(s => s !== symbol));
    },
    
    isInWatchlist(symbol) {
        const watchlist = store.getState('watchlist') || [];
        return watchlist.includes(symbol);
    }
};

// Quote data helpers
export const quoteHelpers = {
    setQuote(symbol, data) {
        const quotes = store.getState('quotes') || new Map();
        quotes.set(symbol, { ...data, timestamp: Date.now() });
        store.setState('quotes', quotes);
        store.setState('lastUpdated', Date.now());
    },
    
    getQuote(symbol) {
        const quotes = store.getState('quotes') || new Map();
        return quotes.get(symbol);
    },
    
    setMultipleQuotes(quotesData) {
        const quotes = store.getState('quotes') || new Map();
        Object.entries(quotesData).forEach(([symbol, data]) => {
            quotes.set(symbol, { ...data, timestamp: Date.now() });
        });
        store.setState('quotes', quotes);
        store.setState('lastUpdated', Date.now());
    },
    
    clearQuotes() {
        store.setState('quotes', new Map());
    }
};

// Theme helpers
export const themeHelpers = {
    toggleTheme() {
        const currentTheme = store.getState('theme');
        const newTheme = currentTheme === 'dark' ? 'light' : 'dark';
        store.setState('theme', newTheme);
        return newTheme;
    },
    
    setTheme(theme) {
        store.setState('theme', theme);
    }
};

// Enable debug mode in development
if (typeof window !== 'undefined' && window.location.hostname === 'localhost') {
    store.setDebugMode(true);
    window.store = store; // Make store available in console for debugging
}

export { store };