const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');

const repoDir = path.resolve(__dirname, '..');

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'flowt-server-schema-'));
}

function querySchema(dbPath) {
  const result = spawnSync(process.execPath, ['-e', `
    (async () => {
      process.env.BUDGET_DB_PATH = ${JSON.stringify(dbPath)};
      const database = require('./database');
      const db = await database.getDb();
      const tables = db.exec('SELECT name FROM sqlite_master WHERE type="table" AND name IN ("promo_codes","promo_code_redemptions")')[0]?.values.flat() || [];
      const cols = db.exec('PRAGMA table_info(users)')[0]?.values.map(r => r[1]).filter(n => /subscription|entitlement|promo/.test(String(n))) || [];
      console.log(JSON.stringify({ tables, cols }));
    })().catch((err) => { console.error(err); process.exit(1); });
  `], { cwd: repoDir, encoding: 'utf8', timeout: 10000 });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return JSON.parse(result.stdout.trim());
}

test('starting full server preserves migrated promo schema on disk', async () => {
  const dir = tempDir();
  const dbPath = path.join(dir, 'server-start.db');
  const env = { ...process.env, BUDGET_DB_PATH: dbPath, PORT: '3316', JWT_SECRET: 'server-start-schema-test-secret' };

  const init = spawnSync(process.execPath, ['-e', `
    (async () => {
      process.env.BUDGET_DB_PATH = ${JSON.stringify(dbPath)};
      const { initialize } = require('./database');
      await initialize();
    })().catch((err) => { console.error(err); process.exit(1); });
  `], { cwd: repoDir, encoding: 'utf8', timeout: 10000 });
  assert.equal(init.status, 0, init.stderr || init.stdout);
  assert.deepEqual(querySchema(dbPath).tables.sort(), ['promo_code_redemptions', 'promo_codes']);

  const server = spawn(process.execPath, ['server.js'], { cwd: repoDir, env, stdio: ['ignore', 'ignore', 'ignore'] });
  await new Promise((resolve) => setTimeout(resolve, 1000));
  server.kill('SIGTERM');
  await new Promise((resolve) => server.once('exit', resolve));

  const schema = querySchema(dbPath);
  assert.deepEqual(schema.tables.sort(), ['promo_code_redemptions', 'promo_codes']);
  assert.deepEqual(schema.cols.sort(), ['current_entitlement', 'promo_grant_source', 'subscription_expires_at', 'subscription_status']);
});
