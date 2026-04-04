const jwt = require('jsonwebtoken');
const config = require('../config');
const { getDb } = require('../config/database');

/**
 * Optional auth middleware — sets req.user if token present, defaults to Gary (id=1) if not.
 * All routes are now public; login is still available but not required.
 */
function authenticateToken(req, res, next) {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) {
        // Default to Gary's account (id=1) for all unauthenticated requests
        req.user = { id: 1, email: 'gary@gary-yong.com', displayName: 'Gary' };
        return next();
    }

    jwt.verify(token, config.jwtSecret, (err, decoded) => {
        if (err) {
            // Bad token — still allow, default to Gary
            req.user = { id: 1, email: 'gary@gary-yong.com', displayName: 'Gary' };
            return next();
        }

        const db = getDb();
        const user = db.prepare('SELECT id, email, display_name FROM users WHERE id = ?')
            .get(decoded.userId);

        req.user = user
            ? { id: user.id, email: user.email, displayName: user.display_name }
            : { id: 1, email: 'gary@gary-yong.com', displayName: 'Gary' };

        next();
    });
}

/**
 * Middleware to verify refresh token from cookie (still used by /auth/refresh)
 */
function verifyRefreshToken(req, res, next) {
    const refreshToken = req.cookies?.refreshToken;

    if (!refreshToken) {
        return res.status(401).json({ error: 'Refresh token required' });
    }

    jwt.verify(refreshToken, config.jwtSecret, (err, decoded) => {
        if (err) {
            res.clearCookie('refreshToken');
            return res.status(403).json({ error: 'Invalid refresh token' });
        }

        const db = getDb();
        const user = db.prepare('SELECT id, email, display_name FROM users WHERE id = ?')
            .get(decoded.userId);

        if (!user) {
            res.clearCookie('refreshToken');
            return res.status(403).json({ error: 'User not found' });
        }

        req.user = { id: user.id, email: user.email, displayName: user.display_name };
        next();
    });
}

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

module.exports = { authenticateToken, verifyRefreshToken, generateTokens };
