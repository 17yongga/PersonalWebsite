const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const { initialize, enableAutosave, disableAutosave, getDbPath, getManifestPath, getDbStats, queryOne, saveDb } = require('./database');

const app = express();
const PORT = process.env.PORT || 3002;

app.use(cors({
  origin: [
    'https://gary-yong.com',
    'https://www.gary-yong.com',
    'https://useflowt.app',
    'https://www.useflowt.app',
    'http://localhost:8080',
    'http://127.0.0.1:8080'
  ],
  credentials: true
}));
app.use(express.json({ limit: '6mb' }));

app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`);
  next();
});

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', service: 'finsync-api', timestamp: new Date().toISOString() });
});

function assertProductionDatabase() {
  if (process.env.NODE_ENV !== 'production') return;

  const resolvedDbPath = path.resolve(getDbPath());
  const expectedDbPath = process.env.EXPECTED_BUDGET_DB_PATH
    ? path.resolve(process.env.EXPECTED_BUDGET_DB_PATH)
    : null;
  const expectedBasename = process.env.EXPECTED_BUDGET_DB_BASENAME || 'finsync.db';

  if (process.env.ALLOW_NONCANONICAL_BUDGET_DB !== 'true') {
    if (expectedDbPath && resolvedDbPath !== expectedDbPath) {
      throw new Error(`Production DB path mismatch: expected ${expectedDbPath}, got ${resolvedDbPath}`);
    }
    if (!expectedDbPath && path.basename(resolvedDbPath) !== expectedBasename) {
      throw new Error(`Production DB file mismatch: expected ${expectedBasename}, got ${resolvedDbPath}`);
    }
  }

  const minUsers = Number(process.env.MIN_PRODUCTION_USERS || 2);
  const minHouseholds = Number(process.env.MIN_PRODUCTION_HOUSEHOLDS || 1);
  const minExpenses = Number(process.env.MIN_PRODUCTION_EXPENSES || 0);
  const minMaxExpenseId = Number(process.env.MIN_PRODUCTION_MAX_EXPENSE_ID || 0);
  const users = queryOne('SELECT COUNT(*) AS count FROM users')?.count || 0;
  const households = queryOne('SELECT COUNT(*) AS count FROM households')?.count || 0;
  const stats = getDbStats() || { users, households, expenses: 0, maxExpenseId: 0 };

  if (users < minUsers || households < minHouseholds || stats.expenses < minExpenses || stats.maxExpenseId < minMaxExpenseId) {
    throw new Error(
      `Production DB sanity check failed for ${resolvedDbPath}: users=${users}, households=${households}, ` +
      `expenses=${stats.expenses}, maxExpenseId=${stats.maxExpenseId}; ` +
      `minimum users=${minUsers}, households=${minHouseholds}, expenses=${minExpenses}, maxExpenseId=${minMaxExpenseId}`
    );
  }

  if (process.env.ALLOW_DB_REGRESSION !== 'true') {
    const manifestPath = getManifestPath();
    if (fs.existsSync(manifestPath)) {
      const previous = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
      const previousStats = previous.stats || {};
      const regressions = [];
      for (const key of ['users', 'households', 'expenses', 'maxExpenseId', 'expenseSplits', 'notifications']) {
        const currentValue = Number(stats[key] || 0);
        const previousValue = Number(previousStats[key] || 0);
        if (currentValue < previousValue) {
          regressions.push(`${key}: ${currentValue} < previous ${previousValue}`);
        }
      }
      if (regressions.length > 0) {
        throw new Error(
          `Production DB regression check failed for ${resolvedDbPath} vs ${manifestPath}: ${regressions.join(', ')}. ` +
          `Set ALLOW_DB_REGRESSION=true only during an intentional, verified restore.`
        );
      }
    }
  }

  console.log(`[startup-check] Production DB OK: ${resolvedDbPath} (${users} users, ${households} households, ${stats.expenses} expenses, maxExpenseId=${stats.maxExpenseId})`);
}

function installShutdownHandlers(server) {
  let shuttingDown = false;
  const shutdown = (signal) => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`[shutdown] ${signal} received; flushing Flowt DB before exit`);
    try {
      disableAutosave();
      saveDb();
    } catch (err) {
      console.error('[shutdown] Failed to flush Flowt DB:', err);
      process.exitCode = 1;
    }
    server.close(() => process.exit(process.exitCode || 0));
    setTimeout(() => process.exit(process.exitCode || 0), 3000).unref();
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

async function start() {
  await initialize();
  assertProductionDatabase();

  // Load routes after DB is ready
  const { router: authRouter } = require('./auth');
  const householdsRouter = require('./households');
  const aiRouter = require('./ai');
  const promoCodesRouter = require('./promoCodes');
  const notificationsRouter = require('./notifications');

  app.use('/api/auth', authRouter);
  app.use('/api/households', householdsRouter);
  app.use('/api/ai', aiRouter);
  app.use('/api/promo-codes', promoCodesRouter);
  app.use('/api/notifications', notificationsRouter);

  app.use('/api', (req, res) => {
    res.status(404).json({ error: `API route not found: ${req.method} ${req.path}` });
  });

  app.use((err, req, res, next) => {
    if (err?.type === 'entity.too.large') {
      return res.status(413).json({ error: 'Upload is too large. Please choose a smaller image.' });
    }
    next(err);
  });

  saveDb();
  enableAutosave();
  const server = app.listen(PORT, '0.0.0.0', () => {
    console.log(`FinSync API running on port ${PORT}`);
  });
  installShutdownHandlers(server);
}

start().catch(err => {
  console.error('Failed to start:', err);
  process.exit(1);
});
