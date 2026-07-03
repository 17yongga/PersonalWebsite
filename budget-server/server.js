const express = require('express');
const cors = require('cors');
const path = require('path');
const { initialize, enableAutosave, getDbPath, queryOne } = require('./database');

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
  const users = queryOne('SELECT COUNT(*) AS count FROM users')?.count || 0;
  const households = queryOne('SELECT COUNT(*) AS count FROM households')?.count || 0;

  if (users < minUsers || households < minHouseholds) {
    throw new Error(
      `Production DB sanity check failed for ${resolvedDbPath}: users=${users}, households=${households}, ` +
      `minimum users=${minUsers}, households=${minHouseholds}`
    );
  }

  console.log(`[startup-check] Production DB OK: ${resolvedDbPath} (${users} users, ${households} households)`);
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

  enableAutosave();
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`FinSync API running on port ${PORT}`);
  });
}

start().catch(err => {
  console.error('Failed to start:', err);
  process.exit(1);
});
