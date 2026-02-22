// WebSocket Client with Auto-reconnect and Event Handling

import { auth } from './auth.js';
import { store } from './store.js';

class WebSocketClient {
    constructor() {
        this.ws = null;
        this.url = this.getWebSocketURL();
        this.reconnectAttempts = 0;
        this.maxReconnectAttempts = 10;
        this.reconnectDelay = 1000; // Start with 1 second
        this.maxReconnectDelay = 30000; // Max 30 seconds
        this.heartbeatInterval = null;
        this.heartbeatTimeout = null;
        this.isConnecting = false;
        this.isDestroyed = false;
        this.eventListeners = new Map();
        this.subscriptions = new Set();
        
        // Store connection status in global store
        store.setState('wsConnected', false);
        store.setState('wsReconnectAttempts', 0);
    }

    getWebSocketURL() {
        const hostname = window.location.hostname;
        
        if (hostname === 'localhost' || hostname === '127.0.0.1') {
            return 'ws://localhost:3002/ws';
        } else {
            return 'wss://api.gary-yong.com/ws';
        }
    }

    connect() {
        if (this.isDestroyed || this.isConnecting || (this.ws && this.ws.readyState === WebSocket.OPEN)) {
            return;
        }

        this.isConnecting = true;
        
        try {
            console.log(`Connecting to WebSocket: ${this.url}`);
            this.ws = new WebSocket(this.url);
            
            this.ws.onopen = this.handleOpen.bind(this);
            this.ws.onmessage = this.handleMessage.bind(this);
            this.ws.onclose = this.handleClose.bind(this);
            this.ws.onerror = this.handleError.bind(this);
            
        } catch (error) {
            console.error('Failed to create WebSocket connection:', error);
            this.isConnecting = false;
            this.scheduleReconnect();
        }
    }

    handleOpen() {
        console.log('WebSocket connected');
        this.isConnecting = false;
        this.reconnectAttempts = 0;
        this.reconnectDelay = 1000;
        
        // Update store
        store.setState('wsConnected', true);
        store.setState('wsReconnectAttempts', 0);
        
        // Send authentication token if available
        const token = auth.getToken();
        if (token) {
            this.send({
                type: 'auth',
                token: token
            });
        }
        
        // Restore any active subscriptions
        this.restoreSubscriptions();
        
        // Start heartbeat
        this.startHeartbeat();
        
        // Emit connected event
        this.emit('connected');
    }

    handleMessage(event) {
        try {
            const data = JSON.parse(event.data);
            this.processMessage(data);
        } catch (error) {
            console.error('Failed to parse WebSocket message:', error, event.data);
        }
    }

    processMessage(data) {
        const { type, ...payload } = data;

        switch (type) {
            case 'auth_success':
                console.log('WebSocket authentication successful');
                this.emit('authenticated', payload);
                break;
                
            case 'auth_error':
                console.error('WebSocket authentication failed:', payload);
                this.emit('auth_error', payload);
                break;
                
            case 'price':
                this.emit('price', payload);
                break;
                
            case 'portfolio':
                this.emit('portfolio', payload);
                break;
                
            case 'trade':
                this.emit('trade', payload);
                break;
                
            case 'order':
                this.emit('order', payload);
                break;
                
            case 'market_data':
                this.emit('market_data', payload);
                break;
                
            case 'pong':
                this.handlePong();
                break;
                
            case 'error':
                console.error('WebSocket server error:', payload);
                this.emit('error', payload);
                break;
                
            case 'subscription_success':
                console.log('Subscription successful:', payload);
                this.emit('subscription_success', payload);
                break;
                
            case 'subscription_error':
                console.error('Subscription failed:', payload);
                this.emit('subscription_error', payload);
                break;
                
            default:
                console.warn('Unknown WebSocket message type:', type, payload);
                this.emit('message', data);
        }
    }

    handleClose(event) {
        console.log('WebSocket disconnected:', event.code, event.reason);
        
        this.isConnecting = false;
        this.stopHeartbeat();
        
        // Update store
        store.setState('wsConnected', false);
        
        // Emit disconnected event
        this.emit('disconnected', { code: event.code, reason: event.reason });
        
        // Schedule reconnect if not a clean close and not destroyed
        if (event.code !== 1000 && !this.isDestroyed) {
            this.scheduleReconnect();
        }
    }

    handleError(error) {
        console.error('WebSocket error:', error);
        this.emit('ws_error', error);
    }

    scheduleReconnect() {
        if (this.isDestroyed || this.reconnectAttempts >= this.maxReconnectAttempts) {
            console.log('Max reconnect attempts reached or client destroyed');
            return;
        }

        this.reconnectAttempts++;
        store.setState('wsReconnectAttempts', this.reconnectAttempts);
        
        console.log(`Scheduling reconnect attempt ${this.reconnectAttempts} in ${this.reconnectDelay}ms`);
        
        setTimeout(() => {
            if (!this.isDestroyed) {
                this.connect();
            }
        }, this.reconnectDelay);
        
        // Exponential backoff with jitter
        this.reconnectDelay = Math.min(
            this.reconnectDelay * 2 + Math.random() * 1000,
            this.maxReconnectDelay
        );
    }

    send(data) {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            try {
                this.ws.send(JSON.stringify(data));
                return true;
            } catch (error) {
                console.error('Failed to send WebSocket message:', error);
                return false;
            }
        } else {
            console.warn('Cannot send message: WebSocket not connected');
            return false;
        }
    }

    // Event emitter methods
    on(event, callback) {
        if (!this.eventListeners.has(event)) {
            this.eventListeners.set(event, new Set());
        }
        this.eventListeners.get(event).add(callback);
        
        // Return unsubscribe function
        return () => this.off(event, callback);
    }

    off(event, callback) {
        if (this.eventListeners.has(event)) {
            this.eventListeners.get(event).delete(callback);
        }
    }

    emit(event, data) {
        if (this.eventListeners.has(event)) {
            this.eventListeners.get(event).forEach(callback => {
                try {
                    callback(data);
                } catch (error) {
                    console.error(`Error in WebSocket event handler for ${event}:`, error);
                }
            });
        }
    }

    // Subscription methods
    subscribe(channel, params = {}) {
        const subscription = { channel, params };
        this.subscriptions.add(JSON.stringify(subscription));
        
        return this.send({
            type: 'subscribe',
            channel,
            ...params
        });
    }

    unsubscribe(channel, params = {}) {
        const subscription = { channel, params };
        this.subscriptions.delete(JSON.stringify(subscription));
        
        return this.send({
            type: 'unsubscribe',
            channel,
            ...params
        });
    }

    restoreSubscriptions() {
        this.subscriptions.forEach(subscriptionJson => {
            const subscription = JSON.parse(subscriptionJson);
            this.send({
                type: 'subscribe',
                ...subscription
            });
        });
    }

    // Price subscription helpers
    subscribeToPrices(symbols) {
        if (!Array.isArray(symbols)) {
            symbols = [symbols];
        }
        return this.subscribe('prices', { symbols });
    }

    unsubscribeFromPrices(symbols) {
        if (!Array.isArray(symbols)) {
            symbols = [symbols];
        }
        return this.unsubscribe('prices', { symbols });
    }

    // Portfolio subscription helpers
    subscribeToPortfolio(portfolioId) {
        return this.subscribe('portfolio', { portfolioId });
    }

    unsubscribeFromPortfolio(portfolioId) {
        return this.unsubscribe('portfolio', { portfolioId });
    }

    // Heartbeat management
    startHeartbeat() {
        // Send ping every 25 seconds
        this.heartbeatInterval = setInterval(() => {
            if (this.ws && this.ws.readyState === WebSocket.OPEN) {
                this.send({ type: 'ping' });
                
                // Set timeout for pong response
                this.heartbeatTimeout = setTimeout(() => {
                    console.warn('No pong received, closing connection');
                    this.ws.close();
                }, 5000);
            }
        }, 25000);
    }

    stopHeartbeat() {
        if (this.heartbeatInterval) {
            clearInterval(this.heartbeatInterval);
            this.heartbeatInterval = null;
        }
        
        if (this.heartbeatTimeout) {
            clearTimeout(this.heartbeatTimeout);
            this.heartbeatTimeout = null;
        }
    }

    handlePong() {
        if (this.heartbeatTimeout) {
            clearTimeout(this.heartbeatTimeout);
            this.heartbeatTimeout = null;
        }
    }

    // Connection management
    disconnect() {
        this.isDestroyed = false; // Allow reconnection
        if (this.ws) {
            this.ws.close(1000, 'Client disconnect');
        }
    }

    destroy() {
        console.log('Destroying WebSocket client');
        this.isDestroyed = true;
        this.stopHeartbeat();
        
        if (this.ws) {
            this.ws.close(1000, 'Client destroyed');
        }
        
        this.eventListeners.clear();
        this.subscriptions.clear();
        
        // Update store
        store.setState('wsConnected', false);
        store.setState('wsReconnectAttempts', 0);
    }

    // Status methods
    isConnected() {
        return this.ws && this.ws.readyState === WebSocket.OPEN;
    }

    getStatus() {
        return {
            connected: this.isConnected(),
            connecting: this.isConnecting,
            reconnectAttempts: this.reconnectAttempts,
            subscriptions: Array.from(this.subscriptions).map(s => JSON.parse(s)),
            url: this.url
        };
    }

    // Debugging helper
    getDebugInfo() {
        return {
            ...this.getStatus(),
            eventListeners: Object.fromEntries(
                Array.from(this.eventListeners.entries()).map(([event, listeners]) => [
                    event, 
                    listeners.size
                ])
            )
        };
    }
}

// Create and export WebSocket client instance
export const ws = new WebSocketClient();

// Auto-connect when authenticated
store.subscribe('isAuthenticated', (isAuthenticated) => {
    if (isAuthenticated && !ws.isConnected()) {
        ws.connect();
    } else if (!isAuthenticated && ws.isConnected()) {
        ws.disconnect();
    }
});

// Make WebSocket client available globally for debugging
if (typeof window !== 'undefined') {
    window.ws = ws;
}