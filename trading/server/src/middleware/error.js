const config = require('../config');

/**
 * Global error handler middleware
 * Must be defined after all other middleware and routes
 */
function errorHandler(err, req, res, next) {
    console.error(`Error in ${req.method} ${req.path}:`, err);

    // Default error
    let error = {
        message: 'Internal server error',
        status: 500
    };

    // Validation errors
    if (err.name === 'ValidationError') {
        error = {
            message: 'Validation failed',
            details: err.details || err.message,
            status: 400
        };
    }

    // Database constraint errors
    if (err.code === 'SQLITE_CONSTRAINT_UNIQUE') {
        error = {
            message: 'Resource already exists',
            status: 409
        };
    }

    if (err.code === 'SQLITE_CONSTRAINT_FOREIGN_KEY') {
        error = {
            message: 'Referenced resource does not exist',
            status: 400
        };
    }

    // JWT errors
    if (err.name === 'JsonWebTokenError') {
        error = {
            message: 'Invalid token',
            status: 401
        };
    }

    if (err.name === 'TokenExpiredError') {
        error = {
            message: 'Token expired',
            status: 401
        };
    }

    // Alpaca API errors
    if (err.name === 'AlpacaError') {
        error = {
            message: err.message || 'Trading API error',
            status: err.status || 503
        };
    }

    // Custom API errors
    if (err.status || err.statusCode) {
        error = {
            message: err.message,
            status: err.status || err.statusCode
        };
    }

    // Send error response
    const response = {
        error: error.message,
        success: false
    };

    // Include error details in development
    if (config.nodeEnv === 'development') {
        response.details = error.details;
        response.stack = err.stack;
    }

    res.status(error.status).json(response);
}

/**
 * 404 handler for unmatched routes
 */
function notFoundHandler(req, res) {
    res.status(404).json({
        error: `Route ${req.method} ${req.path} not found`,
        success: false
    });
}

/**
 * Async error wrapper to catch errors in async route handlers
 */
function asyncHandler(fn) {
    return function(req, res, next) {
        const result = fn(req, res, next);
        if (result && typeof result.catch === 'function') {
            result.catch(next);
        }
        return result;
    };
}

/**
 * Create custom API error
 */
class ApiError extends Error {
    constructor(message, status = 500) {
        super(message);
        this.status = status;
        this.name = 'ApiError';
    }
}

module.exports = {
    errorHandler,
    notFoundHandler,
    asyncHandler,
    ApiError
};