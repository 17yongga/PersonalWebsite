const fs = require('fs');
const path = require('path');
const initSqlJs = require('sql.js');

let db = null;
let dbPath = null;
let autosaveTimer = null;

function getDbPath() {
  return process.env.BUDGET_DB_PATH || path.join(__dirname, 'finsync.db');
}

async function getDb() {
  if (db) return db;

  dbPath = getDbPath();

  const SQL = await initSqlJs();

  if (fs.existsSync(dbPath)) {
    const buffer = fs.readFileSync(dbPath);
    db = new SQL.Database(buffer);
  } else {
    db = new SQL.Database();
  }

  // Enable foreign keys
  db.run('PRAGMA foreign_keys = ON');

  return db;
}

function saveDb() {
  if (!db) return;
  const data = db.export();
  const buffer = Buffer.from(data);
  fs.writeFileSync(dbPath || getDbPath(), buffer);
}

function enableAutosave(intervalMs = 5000) {
  if (autosaveTimer) return autosaveTimer;
  autosaveTimer = setInterval(saveDb, intervalMs);
  return autosaveTimer;
}

function disableAutosave() {
  if (!autosaveTimer) return;
  clearInterval(autosaveTimer);
  autosaveTimer = null;
}

async function initialize() {
  const db = await getDb();

  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      name TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now'))
    )
  `);

  const userColumns = db.exec(`PRAGMA table_info(users)`)[0]?.values.map(row => row[1]) || [];
  const addUserColumn = (name, definition) => {
    if (!userColumns.includes(name)) {
      db.run(`ALTER TABLE users ADD COLUMN ${name} ${definition}`);
    }
  };
  addUserColumn('subscription_status', 'TEXT');
  addUserColumn('current_entitlement', 'TEXT');
  addUserColumn('subscription_expires_at', 'TEXT');
  addUserColumn('promo_grant_source', 'TEXT');
  addUserColumn('avatar_url', 'TEXT');
  addUserColumn('etransfer_email', 'TEXT');

  db.run(`
    CREATE TABLE IF NOT EXISTS households (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      invite_code TEXT UNIQUE NOT NULL,
      created_by INTEGER NOT NULL,
      relationship_type TEXT DEFAULT 'partner',
      created_at TEXT DEFAULT (datetime('now'))
    )
  `);

  const householdColumns = db.exec(`PRAGMA table_info(households)`)[0]?.values.map(row => row[1]) || [];
  if (!householdColumns.includes('relationship_type')) {
    db.run(`ALTER TABLE households ADD COLUMN relationship_type TEXT DEFAULT 'partner'`);
  }

  db.run(`
    CREATE TABLE IF NOT EXISTS household_members (
      household_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      role TEXT NOT NULL DEFAULT 'member',
      partner_name TEXT,
      joined_at TEXT DEFAULT (datetime('now')),
      PRIMARY KEY (household_id, user_id)
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS expenses (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      household_id INTEGER NOT NULL,
      amount REAL NOT NULL,
      category TEXT NOT NULL,
      paid_by INTEGER NOT NULL,
      split_type TEXT DEFAULT '50/50',
      custom_split REAL,
      date TEXT NOT NULL,
      notes TEXT,
      is_recurring INTEGER DEFAULT 0,
      is_shared INTEGER DEFAULT 1,
      created_by INTEGER NOT NULL,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS expense_splits (
      expense_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      share_amount REAL NOT NULL,
      share_percent REAL,
      created_at TEXT DEFAULT (datetime('now')),
      PRIMARY KEY (expense_id, user_id)
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS budgets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      household_id INTEGER NOT NULL,
      category TEXT,
      amount REAL NOT NULL,
      budget_type TEXT NOT NULL DEFAULT 'shared',
      user_id INTEGER,
      month TEXT NOT NULL
    )
  `);

  // Create unique index for budgets (can't use UNIQUE constraint with NULLs easily)
  try {
    db.run(`CREATE UNIQUE INDEX IF NOT EXISTS idx_budgets_unique ON budgets(household_id, COALESCE(category,''), budget_type, COALESCE(user_id,0), month)`);
  } catch(e) { /* index may already exist */ }

  db.run(`
    CREATE TABLE IF NOT EXISTS categories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      household_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      UNIQUE(household_id, name)
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS settlements (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      household_id INTEGER NOT NULL,
      settled_by INTEGER NOT NULL,
      from_user_id INTEGER,
      to_user_id INTEGER,
      amount REAL NOT NULL,
      date TEXT NOT NULL,
      notes TEXT,
      settlement_type TEXT DEFAULT 'legacy',
      balance_snapshot_json TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    )
  `);

  const settlementColumns = db.exec(`PRAGMA table_info(settlements)`)[0]?.values.map(row => row[1]) || [];
  const addSettlementColumn = (name, definition) => {
    if (!settlementColumns.includes(name)) {
      db.run(`ALTER TABLE settlements ADD COLUMN ${name} ${definition}`);
    }
  };
  addSettlementColumn('from_user_id', 'INTEGER');
  addSettlementColumn('to_user_id', 'INTEGER');
  addSettlementColumn('settlement_type', `TEXT DEFAULT 'legacy'`);
  addSettlementColumn('balance_snapshot_json', 'TEXT');

  db.run(`
    CREATE TABLE IF NOT EXISTS activity_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      household_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      action TEXT NOT NULL,
      entity_type TEXT NOT NULL,
      entity_id INTEGER,
      details TEXT,
      created_at TEXT
    )
  `);

  // Password reset tokens — one-time use, 1 hour expiry
  // token_hash stores SHA-256 of the raw token (never store raw tokens)
  db.run(`
    CREATE TABLE IF NOT EXISTS password_reset_tokens (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      token_hash TEXT NOT NULL UNIQUE,
      expires_at TEXT NOT NULL,
      used INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS promo_codes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      code_hash TEXT NOT NULL UNIQUE,
      label TEXT,
      duration_days INTEGER NOT NULL DEFAULT 31,
      max_redemptions INTEGER NOT NULL DEFAULT 1,
      redemption_count INTEGER NOT NULL DEFAULT 0,
      active INTEGER NOT NULL DEFAULT 1,
      expires_at TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS promo_code_redemptions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      promo_code_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      redeemed_at TEXT NOT NULL,
      grant_expires_at TEXT NOT NULL,
      UNIQUE(promo_code_id, user_id),
      FOREIGN KEY (promo_code_id) REFERENCES promo_codes(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `);

  saveDb();
}

// Helper: run a query that returns rows (SELECT)
function queryAll(sql, params = []) {
  const stmt = db.prepare(sql);
  stmt.bind(params);
  const results = [];
  while (stmt.step()) {
    results.push(stmt.getAsObject());
  }
  stmt.free();
  return results;
}

// Helper: run a query that returns one row
function queryOne(sql, params = []) {
  const rows = queryAll(sql, params);
  return rows.length > 0 ? rows[0] : null;
}

// Helper: run an INSERT/UPDATE/DELETE and return info
function runSql(sql, params = []) {
  db.run(sql, params);
  const lastId = db.exec("SELECT last_insert_rowid() as id")[0]?.values[0]?.[0];
  const changes = db.getRowsModified();
  saveDb();
  return { lastInsertRowid: lastId, changes };
}

module.exports = { getDb, initialize, queryAll, queryOne, runSql, saveDb, enableAutosave, disableAutosave, getDbPath };
