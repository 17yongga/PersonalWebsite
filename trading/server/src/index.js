const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const cors = require('cors');
const helmet = require('helmet');
const cookieParser = require('cookie-parser');
const path = require('path');

const config = require('./config');
const { dbManager, getDb } = require('./config/database');
const { errorHandler, notFoundHandler } = require('./middleware/error');

// Route imports
const authRoutes = require('./routes/auth');
const portfolioRoutes = require('./routes/portfolios');
const tradingRoutes = require('./routes/trading');
const marketRoutes = require('./routes/market');
const strategyRoutes = require('./routes/strategies');
const watchlistRoutes = require('./routes/watchlist');
const dashboardRoutes = require('./routes/dashboard');
const backtestRoutes = require('./routes/backtest');
const riskRouter = require('./routes/risk');
const compareRouter = require('./routes/compare');

const app = express();

// Security and CORS
app.use(helmet({
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'"],
            scriptSrc: ["'self'", "'unsafe-inline'"],
            styleSrc: ["'self'", "'unsafe-inline'"],
            imgSrc: ["'self'", "data:", "https:"],
            connectSrc: ["'self'", "ws:", "wss:"]
        }
    }
}));

app.use(cors({
    origin: config.corsOrigins,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With']
}));

// Body parsing middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(cookieParser());

// Request logging in development
if (config.nodeEnv === 'development') {
    app.use((req, res, next) => {
        console.log(`${new Date().toISOString()} - ${req.method} ${req.path}`);
        next();
    });
}

// Health check endpoint
app.get('/api/v1/health', (req, res) => {
    const db = getDb();
    let dbStatus = 'ok';
    
    try {
        // Test database connection
        db.prepare('SELECT 1').get();
    } catch (error) {
        dbStatus = 'error';
        console.error('Database health check failed:', error.message);
    }

    res.json({
        success: true,
        status: 'healthy',
        timestamp: new Date().toISOString(),
        version: '1.0.0',
        database: dbStatus,
        environment: config.nodeEnv
    });
});

// API Routes
app.use('/api/v1/auth', authRoutes);
app.use('/api/v1/portfolios', portfolioRoutes);
app.use('/api/v1/trading', tradingRoutes);
app.use('/api/v1/market', marketRoutes);
app.use('/api/v1/strategies', strategyRoutes);
app.use('/api/v1/watchlist', watchlistRoutes);
app.use('/api/v1/dashboard', dashboardRoutes); // Public dashboard routes
app.use('/api/v1/backtest', backtestRoutes);   // Backtesting engine
app.use('/api/v1/risk', riskRouter);           // Risk dashboard
app.use('/api/v1/compare', compareRouter);     // Strategy comparison

// Serve static files in production
if (config.nodeEnv === 'production') {
    app.use(express.static(path.join(__dirname, '../../')));
    
    // Catch all handler for SPA
    app.get('*', (req, res) => {
        if (!req.path.startsWith('/api/')) {
            res.sendFile(path.join(__dirname, '../../index.html'));
        } else {
            res.status(404).json({ error: 'API endpoint not found' });
        }
    });
}

// Error handling
app.use(notFoundHandler);
app.use(errorHandler);

// Create HTTP server
const server = http.createServer(app);

// WebSocket Server
const wss = new WebSocket.Server({ 
    server,
    path: '/ws',
    verifyClient: (info) => {
        // Basic origin check
        const origin = info.origin;
        return config.corsOrigins.some(allowedOrigin => 
            allowedOrigin === '*' || origin === allowedOrigin
        );
    }
});

// WebSocket connection handling
const clients = new Map(); // Store client connections with metadata

wss.on('connection', (ws, req) => {
    const clientId = generateClientId();
    const clientInfo = {
        id: clientId,
        ip: req.socket.remoteAddress,
        userAgent: req.headers['user-agent'],
        connectedAt: new Date(),
        subscriptions: new Set(),
        authenticated: false,
        userId: null
    };
    
    clients.set(clientId, { ws, info: clientInfo });
    console.log(`WebSocket client connected: ${clientId}`);

    // Send welcome message
    ws.send(JSON.stringify({
        type: 'connection',
        data: {
            clientId,
            message: 'Connected to PaperTrade WebSocket server',
            timestamp: new Date().toISOString()
        }
    }));

    // Handle messages
    ws.on('message', (data) => {
        try {
            const message = JSON.parse(data.toString());
            handleWebSocketMessage(clientId, message);
        } catch (error) {
            console.error('WebSocket message parse error:', error.message);
            ws.send(JSON.stringify({
                type: 'error',
                data: { message: 'Invalid JSON message' }
            }));
        }
    });

    // Handle disconnect
    ws.on('close', (code, reason) => {
        console.log(`WebSocket client disconnected: ${clientId} (${code})`);
        clients.delete(clientId);
    });

    // Handle errors
    ws.on('error', (error) => {
        console.error(`WebSocket client error: ${clientId}`, error.message);
    });
});

// WebSocket message handler
function handleWebSocketMessage(clientId, message) {
    const client = clients.get(clientId);
    if (!client) return;

    const { ws, info } = client;
    const { type, data } = message;

    switch (type) {
        case 'auth':
            // Handle authentication
            handleAuth(clientId, data);
            break;
            
        case 'subscribe':
            // Subscribe to price updates for symbols
            handleSubscribe(clientId, data);
            break;
            
        case 'unsubscribe':
            // Unsubscribe from price updates
            handleUnsubscribe(clientId, data);
            break;
            
        case 'ping':
            // Respond to ping with pong
            ws.send(JSON.stringify({
                type: 'pong',
                data: { timestamp: new Date().toISOString() }
            }));
            break;
            
        default:
            ws.send(JSON.stringify({
                type: 'error',
                data: { message: `Unknown message type: ${type}` }
            }));
    }
}

// Handle authentication
function handleAuth(clientId, data) {
    const client = clients.get(clientId);
    if (!client) return;

    // For now, just mark as authenticated
    // In production, verify JWT token here
    client.info.authenticated = true;
    client.info.userId = data.userId || null;

    client.ws.send(JSON.stringify({
        type: 'auth_success',
        data: { message: 'Authenticated successfully' }
    }));
}

// Handle subscription to price feeds
function handleSubscribe(clientId, data) {
    const client = clients.get(clientId);
    if (!client) return;

    const { symbols = [] } = data;
    
    symbols.forEach(symbol => {
        client.info.subscriptions.add(symbol.toUpperCase());
    });

    client.ws.send(JSON.stringify({
        type: 'subscribe_success',
        data: {
            symbols: Array.from(client.info.subscriptions),
            message: 'Subscribed to price updates'
        }
    }));
}

// Handle unsubscription
function handleUnsubscribe(clientId, data) {
    const client = clients.get(clientId);
    if (!client) return;

    const { symbols = [] } = data;
    
    symbols.forEach(symbol => {
        client.info.subscriptions.delete(symbol.toUpperCase());
    });

    client.ws.send(JSON.stringify({
        type: 'unsubscribe_success',
        data: {
            symbols: Array.from(client.info.subscriptions),
            message: 'Unsubscribed from price updates'
        }
    }));
}

// Broadcast message to all connected clients
function broadcastToAll(message) {
    clients.forEach(({ ws, info }) => {
        if (ws.readyState === WebSocket.OPEN) {
            try {
                ws.send(JSON.stringify(message));
            } catch (error) {
                console.error(`Failed to send message to client ${info.id}:`, error.message);
            }
        }
    });
}

// Broadcast to specific clients (e.g., authenticated users)
function broadcastToSubscribers(symbol, data) {
    clients.forEach(({ ws, info }) => {
        if (ws.readyState === WebSocket.OPEN && 
            info.subscriptions.has(symbol.toUpperCase())) {
            try {
                ws.send(JSON.stringify({
                    type: 'price_update',
                    data: {
                        symbol: symbol.toUpperCase(),
                        ...data,
                        timestamp: new Date().toISOString()
                    }
                }));
            } catch (error) {
                console.error(`Failed to send price update to client ${info.id}:`, error.message);
            }
        }
    });
}

// Mock price update simulator (for development)
function startPriceSimulator() {
    const symbols = ['AAPL', 'MSFT', 'GOOGL', 'AMZN', 'TSLA', 'NVDA', 'META'];
    
    setInterval(() => {
        if (clients.size === 0) return;
        
        const symbol = symbols[Math.floor(Math.random() * symbols.length)];
        const basePrice = 100 + Math.random() * 400;
        const change = (Math.random() - 0.5) * 5;
        const price = Math.max(basePrice + change, 1);
        
        broadcastToSubscribers(symbol, {
            price: parseFloat(price.toFixed(2)),
            change: parseFloat(change.toFixed(2)),
            change_pct: parseFloat(((change / basePrice) * 100).toFixed(2))
        });
    }, 2000 + Math.random() * 3000); // Random interval between 2-5 seconds
}

// Generate unique client ID
function generateClientId() {
    return Math.random().toString(36).substr(2, 9) + Date.now().toString(36);
}

// Graceful shutdown
process.on('SIGTERM', () => {
    console.log('SIGTERM received, shutting down gracefully');
    
    // Close WebSocket server
    wss.clients.forEach(ws => ws.terminate());
    wss.close();
    
    // Close HTTP server
    server.close(() => {
        console.log('HTTP server closed');
        
        // Close database connection
        const { close } = require('./config/database');
        close();
        
        process.exit(0);
    });
});

// Initialize database (async - sql.js needs WASM load) and start server
async function startServer() {
    try {
        await dbManager.init();
        console.log('✅ Database initialized successfully');
        
        // Initialize virtual trading strategies
        const strategyEngine = require('./services/strategyEngine');
        await strategyEngine.initializeStrategies();
        console.log('✅ Virtual trading strategies initialized');
        
        server.listen(config.port, () => {
            console.log(`🚀 PaperTrade API server running on port ${config.port}`);
            console.log(`📊 WebSocket server available at ws://localhost:${config.port}/ws`);
            console.log(`🌍 Environment: ${config.nodeEnv}`);
            console.log(`📍 Health check: http://localhost:${config.port}/api/v1/health`);
            
            // Start mock price simulator in development
            if (config.nodeEnv === 'development') {
                startPriceSimulator();
                console.log('📈 Mock price simulator started');
            }
        });
        
    } catch (error) {
        console.error('❌ Failed to start server:', error.message);
        process.exit(1);
    }
}

startServer();

module.exports = app;