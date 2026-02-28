const path = require('path');
// Try multiple .env locations: project root, then config dir
require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });
require('dotenv').config({ path: path.resolve(__dirname, '../../../config/.env') });

const config = {
    // Server
    port: process.env.PORT || 3002,
    nodeEnv: process.env.NODE_ENV || 'development',
    
    // JWT
    jwtSecret: process.env.JWT_SECRET || 'your-super-secret-jwt-key-change-in-production',
    jwtExpiry: process.env.JWT_EXPIRY || '15m',
    refreshTokenExpiry: process.env.REFRESH_TOKEN_EXPIRY || '7d',
    
    // Database
    dbPath: process.env.DB_PATH || './data/trading.db',
    
    // Alpaca API
    alpaca: {
        baseUrl: process.env.ALPACA_BASE_URL || 'https://paper-api.alpaca.markets',
        dataUrl: process.env.ALPACA_DATA_URL || 'https://data.alpaca.markets',
        apiKey: process.env.ALPACA_API_KEY,
        secretKey: process.env.ALPACA_SECRET_KEY
    },
    
    // CORS
    corsOrigins: process.env.CORS_ORIGINS ? 
        process.env.CORS_ORIGINS.split(',') : 
        ['http://localhost:3000', 'http://localhost:3001', 'http://localhost:3002', 'http://127.0.0.1:3002', 'https://gary-yong.com', 'https://www.gary-yong.com'],
    
    // WebSocket
    wsPort: process.env.WS_PORT || 3003,
    
    // Trading
    initialCapital: parseFloat(process.env.INITIAL_CAPITAL || '10000'),
    
    // Rate limiting
    rateLimitWindow: 15 * 60 * 1000, // 15 minutes
    rateLimitMax: 100 // requests per window
};

// Validate required config
function validateConfig() {
    const required = [];
    
    if (!config.jwtSecret || config.jwtSecret === 'your-super-secret-jwt-key-change-in-production') {
        console.warn('⚠️  Using default JWT_SECRET - set a secure one in production!');
    }
    
    if (!config.alpaca.apiKey) {
        console.warn('⚠️  ALPACA_API_KEY not set - Alpaca API calls will fail');
    }
    
    if (!config.alpaca.secretKey) {
        console.warn('⚠️  ALPACA_SECRET_KEY not set - Alpaca API calls will fail');
    }
    
    if (required.length > 0) {
        throw new Error(`Missing required configuration: ${required.join(', ')}`);
    }
}

validateConfig();

module.exports = config;