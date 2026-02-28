const express = require('express');
const bcrypt = require('bcryptjs');
const { getDb } = require('../config/database');
const { generateTokens, authenticateToken, verifyRefreshToken } = require('../middleware/auth');
const { ApiError, asyncHandler } = require('../middleware/error');
const config = require('../config');

const router = express.Router();

/**
 * POST /api/v1/auth/register
 * Register a new user
 */
router.post('/register', asyncHandler(async (req, res) => {
    const { email, password, displayName } = req.body;

    // Validate input
    if (!email || !password || !displayName) {
        throw new ApiError('Email, password, and display name are required', 400);
    }

    if (password.length < 6) {
        throw new ApiError('Password must be at least 6 characters', 400);
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
        throw new ApiError('Invalid email format', 400);
    }

    const db = getDb();

    // Check if user already exists
    const existingUser = db.prepare('SELECT id FROM users WHERE email = ?').get(email.toLowerCase());
    if (existingUser) {
        throw new ApiError('User already exists', 409);
    }

    // Hash password
    const saltRounds = 12;
    const passwordHash = await bcrypt.hash(password, saltRounds);

    // Create user
    const stmt = db.prepare(`
        INSERT INTO users (email, password_hash, display_name)
        VALUES (?, ?, ?)
    `);

    const result = stmt.run(email.toLowerCase(), passwordHash, displayName);
    const userId = result.lastInsertRowid;

    // Create default portfolio
    const portfolioStmt = db.prepare(`
        INSERT INTO portfolios (user_id, name, starting_balance, cash_balance, type)
        VALUES (?, ?, ?, ?, ?)
    `);
    
    portfolioStmt.run(userId, 'Main Portfolio', config.initialCapital, config.initialCapital, 'manual');

    // Generate tokens
    const { accessToken, refreshToken } = generateTokens(userId);

    // Set refresh token cookie
    res.cookie('refreshToken', refreshToken, {
        httpOnly: true,
        secure: config.nodeEnv === 'production',
        sameSite: 'strict',
        maxAge: 7 * 24 * 60 * 60 * 1000 // 7 days
    });

    res.status(201).json({
        success: true,
        user: {
            id: userId,
            email: email.toLowerCase(),
            displayName
        },
        accessToken
    });
}));

/**
 * POST /api/v1/auth/login
 * Login user
 */
router.post('/login', asyncHandler(async (req, res) => {
    const { email, password } = req.body;

    if (!email || !password) {
        throw new ApiError('Email and password are required', 400);
    }

    const db = getDb();

    // Find user
    const user = db.prepare(`
        SELECT id, email, password_hash, display_name 
        FROM users 
        WHERE email = ?
    `).get(email.toLowerCase());

    if (!user) {
        throw new ApiError('Invalid credentials', 401);
    }

    // Verify password
    const isValidPassword = await bcrypt.compare(password, user.password_hash);
    if (!isValidPassword) {
        throw new ApiError('Invalid credentials', 401);
    }

    // Generate tokens
    const { accessToken, refreshToken } = generateTokens(user.id);

    // Set refresh token cookie
    res.cookie('refreshToken', refreshToken, {
        httpOnly: true,
        secure: config.nodeEnv === 'production',
        sameSite: 'strict',
        maxAge: 7 * 24 * 60 * 60 * 1000 // 7 days
    });

    res.json({
        success: true,
        user: {
            id: user.id,
            email: user.email,
            displayName: user.display_name
        },
        accessToken
    });
}));

/**
 * POST /api/v1/auth/refresh
 * Refresh access token
 */
router.post('/refresh', verifyRefreshToken, (req, res) => {
    const { accessToken, refreshToken } = generateTokens(req.user.id);

    // Update refresh token cookie
    res.cookie('refreshToken', refreshToken, {
        httpOnly: true,
        secure: config.nodeEnv === 'production',
        sameSite: 'strict',
        maxAge: 7 * 24 * 60 * 60 * 1000 // 7 days
    });

    res.json({
        success: true,
        accessToken
    });
});

/**
 * POST /api/v1/auth/logout
 * Logout user
 */
router.post('/logout', (req, res) => {
    res.clearCookie('refreshToken');
    res.json({
        success: true,
        message: 'Logged out successfully'
    });
});

/**
 * GET /api/v1/auth/me
 * Get current user info
 */
router.get('/me', authenticateToken, (req, res) => {
    res.json({
        success: true,
        user: req.user
    });
});

/**
 * PATCH /api/v1/auth/profile
 * Update user profile
 */
router.patch('/profile', authenticateToken, asyncHandler(async (req, res) => {
    const { displayName } = req.body;

    if (!displayName) {
        throw new ApiError('Display name is required', 400);
    }

    const db = getDb();
    
    const stmt = db.prepare(`
        UPDATE users 
        SET display_name = ? 
        WHERE id = ?
    `);

    const result = stmt.run(displayName, req.user.id);

    if (result.changes === 0) {
        throw new ApiError('User not found', 404);
    }

    res.json({
        success: true,
        user: {
            ...req.user,
            displayName
        }
    });
}));

/**
 * PATCH /api/v1/auth/password
 * Change user password
 */
router.patch('/password', authenticateToken, asyncHandler(async (req, res) => {
    const { currentPassword, newPassword } = req.body;

    if (!currentPassword || !newPassword) {
        throw new ApiError('Current password and new password are required', 400);
    }

    if (newPassword.length < 6) {
        throw new ApiError('New password must be at least 6 characters', 400);
    }

    const db = getDb();

    // Get current password hash
    const user = db.prepare(`
        SELECT password_hash 
        FROM users 
        WHERE id = ?
    `).get(req.user.id);

    if (!user) {
        throw new ApiError('User not found', 404);
    }

    // Verify current password
    const isValidPassword = await bcrypt.compare(currentPassword, user.password_hash);
    if (!isValidPassword) {
        throw new ApiError('Current password is incorrect', 400);
    }

    // Hash new password
    const saltRounds = 12;
    const newPasswordHash = await bcrypt.hash(newPassword, saltRounds);

    // Update password
    const stmt = db.prepare(`
        UPDATE users 
        SET password_hash = ? 
        WHERE id = ?
    `);

    stmt.run(newPasswordHash, req.user.id);

    res.json({
        success: true,
        message: 'Password updated successfully'
    });
}));

module.exports = router;