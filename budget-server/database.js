const fs = require('fs');
const path = require('path');
const initSqlJs = require('sql.js');

const DB_PATH = path.join(__dirname, 'finsync.db');
let db = null;

async function getDb() {
  if (db) return db;

  const SQL = await initSqlJs();

  if (fs.existsSync(DB_PATH)) {
    const buffer = fs.readFileSync(DB_PATH);
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
  fs.writeFileSync(DB_PATH, buffer);
}

// Auto-save every 5 seconds if there are changes
setInterval(saveDb, 5000);

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

  db.run(`
    CREATE TABLE IF NOT EXISTS households (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      invite_code TEXT UNIQUE NOT NULL,
      created_by INTEGER NOT NULL,
      created_at TEXT DEFAULT (datetime('now'))
    )
  `);

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
      amount REAL NOT NULL,
      date TEXT NOT NULL,
      notes TEXT,
      created_at TEXT DEFAULT (datetime('now'))
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

module.exports = { getDb, initialize, queryAll, queryOne, runSql, saveDb };
