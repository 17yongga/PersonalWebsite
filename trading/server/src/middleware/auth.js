const jwt = require('jsonwebtoken');
const config = require('../config');
const { getDb } = require('../config/database');

/**
 * Middleware to verify JWT token from Authorization header
 */
function authenticateToken(req, res, next) {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN

    if (!token) {
        return res.status(401).json({ error: 'Access token required' });
    }

    jwt.verify(token, config.jwtSecret, (err, decoded) => {
        if (err) {
            if (err.name === 'TokenExpiredError') {
                return res.status(401).json({ error: 'Token expired' });
            }
            return res.status(403).json({ error: 'Invalid token' });
        }

        // Verify user still exists in database
        const db = getDb();
        const user = db.prepare('SELECT id, email, display_name FROM users WHERE id = ?')
            .get(decoded.userId);

        if (!user) {
            return res.status(403).json({ error: 'User not found' });
        }

        req.user = {
            id: user.id,
            email: user.email,
            displayName: user.display_name
        };
        
        next();
    });
}

/**
 * Middleware to verify refresh token from cookie
 */
function verifyRefreshToken(req, res, next) {
    const refreshToken = req.cookies?.refreshToken;

    if (!refreshToken) {
        return res.status(401).json({ error: 'Refresh token required' });
    }

    jwt.verify(refreshToken, config.jwtSecret, (err, decoded) => {
        if (err) {
            // Clear invalid cookie
            res.clearCookie('refreshToken');
            return res.status(403).json({ error: 'Invalid refresh token' });
        }

        // Verify user still exists
        const db = getDb();
        const user = db.prepare('SELECT id, email, display_name FROM users WHERE id = ?')
            .get(decoded.userId);

        if (!user) {
            res.clearCookie('refreshToken');
            return res.status(403).json({ error: 'User not found' });
        }

        req.user = {
            id: user.id,
            email: user.email,
            displayName: user.display_name
        };

        next();
    });
}

/**
 * Generate access and refresh tokens
 */
function generateTokens(userId) {
    const accessToken = jwt.sign(
        { userId, type: 'access' },
        config.jwtSecret,
        { expiresIn: config.jwtExpiry }
    );

    const refreshToken = jwt.sign(
        { userId, type: 'refresh' },
        config.jwtSecret,
        { expiresIn: config.refreshTokenExpiry }
    );

    return { accessToken, refreshToken };
}

module.exports = {
    authenticateToken,
    verifyRefreshToken,
    generateTokens
};