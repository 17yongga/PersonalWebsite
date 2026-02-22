const express = require('express');
const cors = require('cors');
const { initialize } = require('./database');

const app = express();
const PORT = process.env.PORT || 3002;

app.use(cors({
  origin: ['https://gary-yong.com', 'https://www.gary-yong.com', 'http://localhost:8080', 'http://127.0.0.1:8080'],
  credentials: true
}));
app.use(express.json());

app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`);
  next();
});

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', service: 'finsync-api', timestamp: new Date().toISOString() });
});

async function start() {
  await initialize();

  // Load routes after DB is ready
  const { router: authRouter } = require('./auth');
  const householdsRouter = require('./households');

  app.use('/api/auth', authRouter);
  app.use('/api/households', householdsRouter);

  app.listen(PORT, '127.0.0.1', () => {
    console.log(`FinSync API running on port ${PORT}`);
  });
}

start().catch(err => {
  console.error('Failed to start:', err);
  process.exit(1);
});
