const initSqlJs = require('sql.js');
const fs = require('fs');
const path = require('path');

/**
 * Wrapper that provides a better-sqlite3-compatible API on top of sql.js
 * This allows all service code to use db.prepare(sql).get/run/all() seamlessly.
 */
class BetterSqliteCompat {
    constructor(sqlDb) {
        this._db = sqlDb;
    }

    prepare(sql) {
        const db = this._db;
        return {
            run(...params) {
                db.run(sql, params);
                const changes = db.getRowsModified();
                const lastId = db.exec('SELECT last_insert_rowid() as id');
                const lastInsertRowid = lastId.length > 0 ? lastId[0].values[0][0] : 0;
                return { changes, lastInsertRowid };
            },
            get(...params) {
                const stmt = db.prepare(sql);
                if (params.length) stmt.bind(params);
                if (stmt.step()) {
                    const columns = stmt.getColumnNames();
                    const values = stmt.get();
                    stmt.free();
                    const row = {};
                    columns.forEach((col, i) => { row[col] = values[i]; });
                    return row;
                }
                stmt.free();
                return undefined;  // better-sqlite3 returns undefined, not null
            },
            all(...params) {
                const stmt = db.prepare(sql);
                if (params.length) stmt.bind(params);
                const rows = [];
                while (stmt.step()) {
                    const columns = stmt.getColumnNames();
                    const values = stmt.get();
                    const row = {};
                    columns.forEach((col, i) => { row[col] = values[i]; });
                    rows.push(row);
                }
                stmt.free();
                return rows;
            }
        };
    }

    exec(sql) {
        this._db.run(sql);
    }

    pragma(str) {
        this._db.run(`PRAGMA ${str}`);
    }
}

class DatabaseManager {
    constructor() {
        this.db = null;
        this._rawDb = null;
        this.isInitialized = false;
        this.dbPath = process.env.DB_PATH || './data/trading.db';
        this._initPromise = null;
    }

    async init() {
        if (this.isInitialized) return this.db;
        if (this._initPromise) return this._initPromise;
        this._initPromise = this._doInit();
        return this._initPromise;
    }

    async _doInit() {
        const SQL = await initSqlJs();

        // Ensure data directory exists
        const dbDir = path.dirname(this.dbPath);
        if (!fs.existsSync(dbDir)) {
            fs.mkdirSync(dbDir, { recursive: true });
        }

        // Load existing database or create new one
        if (fs.existsSync(this.dbPath)) {
            const fileBuffer = fs.readFileSync(this.dbPath);
            this._rawDb = new SQL.Database(fileBuffer);
        } else {
            this._rawDb = new SQL.Database();
        }

        // Wrap with better-sqlite3 compat layer
        this.db = new BetterSqliteCompat(this._rawDb);

        // Enable foreign keys
        this.db.pragma('foreign_keys = ON');

        // Run schema
        this.initializeSchema();

        this.isInitialized = true;
        console.log(`✅ Database initialized at: ${this.dbPath}`);

        // Auto-save every 30 seconds
        this._saveInterval = setInterval(() => this.save(), 30000);

        return this.db;
    }

    initializeSchema() {
        const schemaPath = path.join(__dirname, '../models/schema.sql');
        const schema = fs.readFileSync(schemaPath, 'utf8');
        this._rawDb.run(schema);
    }

    getDb() {
        if (!this.isInitialized) {
            throw new Error('Database not initialized. Call dbManager.init() first.');
        }
        return this.db;
    }

    save() {
        if (this._rawDb) {
            const data = this._rawDb.export();
            const buffer = Buffer.from(data);
            fs.writeFileSync(this.dbPath, buffer);
        }
    }

    close() {
        if (this._saveInterval) {
            clearInterval(this._saveInterval);
        }
        if (this._rawDb) {
            this.save();
            this._rawDb.close();
            this._rawDb = null;
            this.db = null;
            this.isInitialized = false;
        }
    }
}

// Singleton instance
const dbManager = new DatabaseManager();

module.exports = {
    dbManager,
    getDb: () => dbManager.getDb(),
    close: () => dbManager.close()
};
