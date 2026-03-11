/**
 * Backtest API Routes
 * POST /api/v1/backtest/run  — run a strategy backtest via the Python engine
 * GET  /api/v1/backtest/strategies — list available strategies + metadata
 */

const express = require('express');
const { spawn } = require('child_process');
const path = require('path');
const { authenticateToken } = require('../middleware/auth');
const { ApiError, asyncHandler } = require('../middleware/error');

const router = express.Router();

// Absolute path to the quant directory on the server
// In production this runs on EC2 at /home/ubuntu/PersonalWebsite/trading/
const QUANT_DIR = path.resolve(__dirname, '../../../../quant');
const PYTHON_BIN = path.join(QUANT_DIR, 'venv', 'bin', 'python3');
const RUNNER_SCRIPT = path.join(QUANT_DIR, 'backtest_runner.py');

const STRATEGY_META = {
    momentum: {
        name: 'Momentum Rider',
        slug: 'momentum-hunter',
        description: 'RSI, MACD & EMA crossover trend-following across mega-cap tech',
        icon: '🚀',
        symbols: ['AAPL', 'MSFT', 'GOOGL', 'NVDA', 'META', 'TSLA', 'AMZN', 'JPM', 'V', 'MA'],
        color: '#3b82f6',
    },
    mean_reversion: {
        name: 'Contrarian',
        slug: 'mean-reversion',
        description: 'Bollinger Band & Z-score mean-reversion on large-cap equities',
        icon: '🔄',
        symbols: ['AAPL', 'MSFT', 'GOOGL', 'NVDA', 'META', 'TSLA', 'AMZN', 'JPM', 'V', 'MA'],
        color: '#8b5cf6',
    },
    sector_rotation: {
        name: 'Sector Rotator',
        slug: 'sector-rotator',
        description: 'Relative-strength rotation across 11 SPDR sector ETFs',
        icon: '🌐',
        symbols: ['XLK', 'XLF', 'XLE', 'XLV', 'XLI', 'XLP', 'XLU', 'XLY', 'XLC', 'XLRE', 'XLB'],
        color: '#10b981',
    },
    value_dividend: {
        name: 'Dividend Hunter',
        slug: 'value-dividends',
        description: 'Low P/E, high-yield dividend stocks — value with income',
        icon: '💰',
        symbols: ['VZ', 'T', 'KO', 'PEP', 'PG', 'JNJ', 'XOM', 'CVX', 'ABBV', 'PFE'],
        color: '#f59e0b',
    },
    volatility_breakout: {
        name: 'Volatility Trader',
        slug: 'volatility-breakout',
        description: 'ATR-based volume breakout on high-beta momentum stocks',
        icon: '⚡',
        symbols: ['TSLA', 'NVDA', 'AMD', 'COIN', 'MSTR', 'SQ', 'SHOP', 'ROKU', 'PLTR', 'SNAP'],
        color: '#ef4444',
    },
};

/**
 * GET /api/v1/backtest/strategies
 * Public — returns the list of backtestable strategies with metadata.
 */
router.get('/strategies', (req, res) => {
    res.json({ success: true, strategies: STRATEGY_META });
});

/**
 * POST /api/v1/backtest/run
 * Authenticated — runs a backtest via the Python engine.
 *
 * Body: { strategy, startDate, endDate, initialCapital }
 */
router.post('/run', authenticateToken, asyncHandler(async (req, res) => {
    const { strategy, startDate, endDate, initialCapital = 10000 } = req.body;

    // ── Validation ────────────────────────────────────────────────────────
    if (!strategy || !STRATEGY_META[strategy]) {
        throw new ApiError(`Unknown strategy "${strategy}". Valid: ${Object.keys(STRATEGY_META).join(', ')}`, 400);
    }

    const start = startDate || new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    const end = endDate || new Date().toISOString().split('T')[0];

    if (new Date(start) >= new Date(end)) {
        throw new ApiError('startDate must be before endDate', 400);
    }
    if (new Date(end) > new Date()) {
        throw new ApiError('endDate cannot be in the future', 400);
    }
    if (initialCapital < 1000 || initialCapital > 10_000_000) {
        throw new ApiError('initialCapital must be between 1,000 and 10,000,000', 400);
    }

    // Limit max range to 5 years to prevent absurdly long runs
    const diffDays = (new Date(end) - new Date(start)) / (1000 * 60 * 60 * 24);
    if (diffDays > 5 * 365) {
        throw new ApiError('Date range cannot exceed 5 years', 400);
    }

    // ── Spawn Python runner ───────────────────────────────────────────────
    const result = await runPythonBacktest({
        strategy,
        start,
        end,
        capital: initialCapital,
    });

    if (!result.success) {
        throw new ApiError(`Backtest engine error: ${result.error}`, 500);
    }

    res.json({
        success: true,
        data: result,
        meta: STRATEGY_META[strategy],
    });
}));

// ── Helpers ───────────────────────────────────────────────────────────────────

function runPythonBacktest({ strategy, start, end, capital }) {
    return new Promise((resolve, reject) => {
        const args = [
            RUNNER_SCRIPT,
            '--strategy', strategy,
            '--start', start,
            '--end', end,
            '--capital', String(capital),
        ];

        // Try venv python first, fall back to system python3
        const pythonBin = require('fs').existsSync(PYTHON_BIN) ? PYTHON_BIN : 'python3';

        const proc = spawn(pythonBin, args, {
            cwd: QUANT_DIR,
            env: { ...process.env, PYTHONPATH: QUANT_DIR },
            timeout: 120_000, // 2 minute timeout
        });

        let stdout = '';
        let stderr = '';

        proc.stdout.on('data', (data) => { stdout += data.toString(); });
        proc.stderr.on('data', (data) => { stderr += data.toString(); });

        proc.on('error', (err) => {
            console.error('[backtest] spawn error:', err.message);
            reject(new Error(`Failed to start Python process: ${err.message}`));
        });

        proc.on('close', (code) => {
            if (stderr) {
                console.warn('[backtest] python stderr:', stderr.slice(0, 500));
            }

            try {
                const parsed = JSON.parse(stdout.trim());
                resolve(parsed);
            } catch (e) {
                console.error('[backtest] failed to parse output:', stdout.slice(0, 500));
                resolve({
                    success: false,
                    error: `Python process exited with code ${code}. Output: ${stdout.slice(0, 200)}`,
                });
            }
        });
    });
}

module.exports = router;
