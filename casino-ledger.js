'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const Database = require('better-sqlite3');
const DATABASE_APPLICATION_ID = 'neon777-casino-ledger';

function assertCasinoDatabaseIdentity(dbPath) {
  const resolved = path.resolve(dbPath);
  if (!fs.existsSync(resolved)) throw new Error(`Casino database does not exist: ${resolved}`);
  const db = new Database(resolved, { readonly: true, fileMustExist: true });
  try {
    const table = db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='casino_metadata'").get();
    if (!table) throw new Error('Casino database identity metadata is missing');
    const row = db.prepare("SELECT value FROM casino_metadata WHERE key='application_id'").get();
    if (!row || row.value !== DATABASE_APPLICATION_ID) throw new Error('Casino database identity does not match NEON 777');
    return resolved;
  } finally {
    db.close();
  }
}

function assertId(value, label, max = 160) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9:_-]+$/.test(value) || value.length > max) {
    throw new TypeError(`${label} must be a safe identifier`);
  }
  return value;
}

function assertUserId(value) {
  if (typeof value !== 'string' || value.length < 1 || value.length > 64 || value.trim() !== value || /[\u0000-\u001f\u007f]/.test(value)) {
    throw new TypeError('userId must be a stable printable identifier');
  }
  return value;
}

function assertCredits(value, label = 'credits') {
  if (!Number.isFinite(value) || value < 0) throw new TypeError(`${label} must be a non-negative number`);
  toMilli(value, label);
  return value;
}

function assertDelta(value) {
  if (!Number.isFinite(value)) throw new TypeError('delta must be finite');
  toMilli(value, 'delta');
  return value;
}

function toMilli(value, label = 'credits') {
  const text = typeof value === 'string' ? value.trim() : String(value);
  const match = /^(-?)(\d+)(?:\.(\d{1,3}))?$/.exec(text);
  if (!match) throw new TypeError(`${label} must have at most three decimal places`);
  const milli = BigInt(match[2]) * 1000n + BigInt((match[3] || '').padEnd(3, '0') || '0');
  const signed = match[1] ? -milli : milli;
  const number = Number(signed);
  if (!Number.isSafeInteger(number)) throw new RangeError(`${label} exceeds the safe milli-credit range`);
  return number;
}

function fromMilli(value) {
  if (!Number.isSafeInteger(value)) throw new TypeError('stored milli-credit value is invalid');
  return value / 1000;
}

function stringify(value) {
  return JSON.stringify(value ?? null);
}

function parseJson(value, fallback = null) {
  if (value == null) return fallback;
  try { return JSON.parse(value); } catch { return fallback; }
}

function canonicalize(value) {
  if (value === undefined) return null;
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(canonicalize);
  return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonicalize(value[key])]));
}

function mutationHash({ userId, game, action, referenceId = null, deltaMilli, metadata = null }) {
  return crypto.createHash('sha256').update(JSON.stringify(canonicalize({
    userId, game, action, referenceId, deltaMilli, metadata
  }))).digest('hex');
}

class IdempotencyConflictError extends Error {
  constructor(message = 'Idempotency key was already used for a different request') {
    super(message);
    this.name = 'IdempotencyConflictError';
    this.code = 'idempotency_conflict';
    this.statusCode = 409;
  }
}

class CasinoLedger {
  constructor({ dbPath, readonly = false, now = () => Date.now() }) {
    if (!dbPath) throw new TypeError('dbPath is required');
    this.dbPath = path.resolve(dbPath);
    this.now = now;
    fs.mkdirSync(path.dirname(this.dbPath), { recursive: true, mode: 0o750 });
    this.db = new Database(this.dbPath, { readonly, fileMustExist: readonly });
    this.db.pragma('foreign_keys = ON');
    this.db.pragma('busy_timeout = 5000');
    if (!readonly) {
      this.db.pragma('journal_mode = WAL');
      this.db.pragma('synchronous = FULL');
      this._migrate();
      try { fs.chmodSync(this.dbPath, 0o600); } catch {}
    }
    this._prepare();
  }

  _migrate() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version INTEGER PRIMARY KEY,
        applied_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS casino_metadata (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
      INSERT OR IGNORE INTO casino_metadata(key,value) VALUES ('application_id','neon777-casino-ledger');
      CREATE TABLE IF NOT EXISTS accounts (
        user_id TEXT PRIMARY KEY,
        balance INTEGER NOT NULL CHECK(balance >= 0),
        email TEXT UNIQUE,
        email_verified_at INTEGER,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS ledger_transactions (
        tx_id TEXT PRIMARY KEY,
        idempotency_key TEXT NOT NULL UNIQUE,
        user_id TEXT NOT NULL REFERENCES accounts(user_id),
        game TEXT NOT NULL,
        action TEXT NOT NULL,
        reference_id TEXT,
        delta INTEGER NOT NULL,
        balance_before INTEGER NOT NULL CHECK(balance_before >= 0),
        balance_after INTEGER NOT NULL CHECK(balance_after >= 0),
        response_json TEXT,
        metadata_json TEXT,
        created_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_ledger_user_created ON ledger_transactions(user_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_ledger_reference ON ledger_transactions(game, reference_id);
      CREATE TABLE IF NOT EXISTS escrows (
        escrow_id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES accounts(user_id),
        game TEXT NOT NULL,
        reference_id TEXT NOT NULL,
        stake INTEGER NOT NULL CHECK(stake > 0),
        status TEXT NOT NULL CHECK(status IN ('active','settled','refunded')),
        payout INTEGER CHECK(payout IS NULL OR payout >= 0),
        metadata_json TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        UNIQUE(user_id, game, reference_id)
      );
      CREATE INDEX IF NOT EXISTS idx_escrows_status ON escrows(status, created_at);
      CREATE TABLE IF NOT EXISTS game_rounds (
        round_id TEXT PRIMARY KEY,
        game TEXT NOT NULL,
        state_json TEXT NOT NULL,
        status TEXT NOT NULL CHECK(status IN ('active','settled','cancelled')),
        commitment TEXT,
        seed_id TEXT,
        nonce INTEGER,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS recovery_tokens (
        token_hash TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES accounts(user_id),
        expires_at INTEGER NOT NULL,
        used_at INTEGER,
        created_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS verification_tokens (
        token_hash TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES accounts(user_id),
        email TEXT NOT NULL,
        expires_at INTEGER NOT NULL,
        used_at INTEGER,
        created_at INTEGER NOT NULL
      );
      INSERT OR IGNORE INTO schema_migrations(version, applied_at) VALUES (1, unixepoch() * 1000);
    `);
    const txColumns = new Set(this.db.prepare('PRAGMA table_info(ledger_transactions)').all().map(column => column.name));
    if (!txColumns.has('request_hash')) this.db.exec('ALTER TABLE ledger_transactions ADD COLUMN request_hash TEXT');
    const escrowColumns = new Set(this.db.prepare('PRAGMA table_info(escrows)').all().map(column => column.name));
    if (!escrowColumns.has('recovery_payout')) {
      this.db.exec('ALTER TABLE escrows ADD COLUMN recovery_payout INTEGER CHECK(recovery_payout IS NULL OR recovery_payout >= 0)');
      this.db.exec('UPDATE escrows SET recovery_payout=stake WHERE recovery_payout IS NULL');
    }
    const schemaVersion = this.db.prepare('SELECT COALESCE(MAX(version),0) AS version FROM schema_migrations').get().version;
    if (schemaVersion < 2) {
      this.db.transaction(() => {
        this.db.exec(`
          UPDATE accounts SET balance=balance*1000;
          UPDATE ledger_transactions SET delta=delta*1000,balance_before=balance_before*1000,balance_after=balance_after*1000;
          UPDATE escrows SET stake=stake*1000,payout=CASE WHEN payout IS NULL THEN NULL ELSE payout*1000 END,
            recovery_payout=CASE WHEN recovery_payout IS NULL THEN NULL ELSE recovery_payout*1000 END;
          INSERT INTO schema_migrations(version,applied_at) VALUES (2,unixepoch()*1000);
        `);
      })();
    }
  }

  _prepare() {
    this.stmt = {
      account: this.db.prepare('SELECT * FROM accounts WHERE user_id = ?'),
      insertAccount: this.db.prepare('INSERT INTO accounts(user_id,balance,created_at,updated_at) VALUES (?,?,?,?)'),
      updateBalance: this.db.prepare('UPDATE accounts SET balance=?, updated_at=? WHERE user_id=?'),
      txByKey: this.db.prepare('SELECT * FROM ledger_transactions WHERE idempotency_key=?'),
      insertTx: this.db.prepare(`INSERT INTO ledger_transactions
        (tx_id,idempotency_key,request_hash,user_id,game,action,reference_id,delta,balance_before,balance_after,response_json,metadata_json,created_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`),
      escrowById: this.db.prepare('SELECT * FROM escrows WHERE escrow_id=?'),
      escrowByRef: this.db.prepare('SELECT * FROM escrows WHERE user_id=? AND game=? AND reference_id=?'),
      insertEscrow: this.db.prepare(`INSERT INTO escrows
        (escrow_id,user_id,game,reference_id,stake,status,metadata_json,created_at,updated_at)
        VALUES (?,?,?,?,?,'active',?,?,?)`),
      finishEscrow: this.db.prepare('UPDATE escrows SET status=?, payout=?, updated_at=? WHERE escrow_id=? AND status=\'active\''),
      updateRecoveryPayout: this.db.prepare("UPDATE escrows SET recovery_payout=?,updated_at=? WHERE escrow_id=? AND status='active'"),
      activeEscrows: this.db.prepare("SELECT * FROM escrows WHERE status='active' ORDER BY created_at, escrow_id"),
      setEmail: this.db.prepare('UPDATE accounts SET email=?, email_verified_at=?, updated_at=? WHERE user_id=?'),
      insertRecovery: this.db.prepare('INSERT INTO recovery_tokens(token_hash,user_id,expires_at,created_at) VALUES (?,?,?,?)'),
      recovery: this.db.prepare('SELECT * FROM recovery_tokens WHERE token_hash=?'),
      useRecovery: this.db.prepare('UPDATE recovery_tokens SET used_at=? WHERE token_hash=? AND used_at IS NULL'),
      insertVerification: this.db.prepare('INSERT INTO verification_tokens(token_hash,user_id,email,expires_at,created_at) VALUES (?,?,?,?,?)'),
      verification: this.db.prepare('SELECT * FROM verification_tokens WHERE token_hash=?'),
      useVerification: this.db.prepare('UPDATE verification_tokens SET used_at=? WHERE token_hash=? AND used_at IS NULL'),
      saveRound: this.db.prepare(`INSERT INTO game_rounds(round_id,game,state_json,status,commitment,seed_id,nonce,created_at,updated_at)
        VALUES (@roundId,@game,@stateJson,@status,@commitment,@seedId,@nonce,@createdAt,@updatedAt)
        ON CONFLICT(round_id) DO UPDATE SET state_json=excluded.state_json,status=excluded.status,
          commitment=excluded.commitment,seed_id=excluded.seed_id,nonce=excluded.nonce,updated_at=excluded.updated_at`),
      activeRounds: this.db.prepare("SELECT * FROM game_rounds WHERE status='active' ORDER BY created_at")
    };

    this._change = this.db.transaction(input => this._changeInside(input));
    this._reserve = this.db.transaction(input => this._reserveInside(input));
    this._finish = this.db.transaction(input => this._finishInside(input));
    this._finishMany = this.db.transaction(inputs => inputs.map(input => this._finishInside(input)));
    this._replaceEscrow = this.db.transaction(input => {
      const reservation = input?.reservation;
      if (!reservation || typeof reservation !== 'object') throw new TypeError('replacement reservation is required');
      const oldEscrow = this.stmt.escrowById.get(assertId(input.oldEscrowId, 'oldEscrowId'));
      if (!oldEscrow) throw new Error('Escrow not found');
      if (oldEscrow.user_id !== reservation.userId || oldEscrow.game !== reservation.game) {
        throw new Error('Replacement escrow ownership mismatch');
      }
      const refund = this._finishInside({
        escrowId: input.oldEscrowId,
        payout: fromMilli(oldEscrow.stake),
        idempotencyKey: input.refundIdempotencyKey,
        action: 'refund',
        response: input.refundResponse || null,
        metadata: input.refundMetadata || null
      });
      const reserved = this._reserveInside(reservation);
      return {
        refund,
        reservation: reserved,
        balance: reserved.balance,
        replayed: Boolean(refund.replayed && reserved.replayed)
      };
    });
    this._updateRecoveryPayouts = this.db.transaction(items => {
      for (const item of items) {
        assertId(item.escrowId, 'escrowId');
        assertCredits(item.payout, 'recovery payout');
        if (this.stmt.updateRecoveryPayout.run(toMilli(item.payout, 'recovery payout'), this.now(), item.escrowId).changes !== 1) {
          throw new Error(`Active escrow not found: ${item.escrowId}`);
        }
      }
    });
  }

  importAccounts(users) {
    const insert = this.db.transaction(entries => {
      const now = this.now();
      for (const [userId, user] of entries) {
        assertUserId(userId);
        const balance = toMilli(user.credits, 'credits');
        const current = this.stmt.account.get(userId);
        if (!current) this.stmt.insertAccount.run(userId, balance, now, now);
      }
    });
    insert(Object.entries(users));
    return this.listBalances();
  }

  listBalances() {
    return Object.fromEntries(this.db.prepare('SELECT user_id,balance FROM accounts ORDER BY user_id').all().map(row => [row.user_id, fromMilli(row.balance)]));
  }

  balance(userId) {
    return this.publicBalance(userId);
  }

  restoreRecoveryToken(token, userId) {
    if (typeof token !== 'string' || token.length < 32) return false;
    assertUserId(userId);
    const hash = crypto.createHash('sha256').update(token).digest('hex');
    return this.db.prepare('UPDATE recovery_tokens SET used_at=NULL WHERE token_hash=? AND user_id=? AND used_at IS NOT NULL').run(hash, userId).changes === 1;
  }

  rollbackEmptyAccount(userId) {
    assertUserId(userId);
    return this.db.transaction(() => {
      const txCount = this.db.prepare('SELECT COUNT(*) AS count FROM ledger_transactions WHERE user_id=?').get(userId).count;
      const escrowCount = this.db.prepare('SELECT COUNT(*) AS count FROM escrows WHERE user_id=?').get(userId).count;
      if (txCount || escrowCount) throw new Error('Cannot roll back an account with monetary history');
      this.db.prepare('DELETE FROM recovery_tokens WHERE user_id=?').run(userId);
      this.db.prepare('DELETE FROM verification_tokens WHERE user_id=?').run(userId);
      return this.db.prepare('DELETE FROM accounts WHERE user_id=?').run(userId).changes === 1;
    })();
  }

  publicBalance(userId) {
    const row = this.stmt.account.get(assertUserId(userId));
    if (!row) throw new Error('User not found');
    return fromMilli(row.balance);
  }

  _stored(row) {
    return {
      replayed: true,
      txId: row.tx_id,
      balance: fromMilli(row.balance_after),
      response: parseJson(row.response_json),
      metadata: parseJson(row.metadata_json)
    };
  }

  _assertReplay(row, expected) {
    const expectedHash = mutationHash(expected);
    const storedHash = row.request_hash || mutationHash({
      userId: row.user_id,
      game: row.game,
      action: row.action,
      referenceId: row.reference_id,
      deltaMilli: row.delta,
      metadata: parseJson(row.metadata_json)
    });
    if (storedHash !== expectedHash) throw new IdempotencyConflictError();
  }

  _changeInside({ userId, delta, idempotencyKey, game, action, referenceId = null, response = null, metadata = null }) {
    assertUserId(userId);
    assertId(idempotencyKey, 'idempotencyKey');
    assertId(game, 'game', 40);
    assertId(action, 'action', 40);
    if (referenceId != null) assertId(referenceId, 'referenceId');
    assertDelta(delta);
    const deltaMilli = toMilli(delta, 'delta');
    const request = { userId, game, action, referenceId, deltaMilli, metadata };
    const requestHash = mutationHash(request);
    const prior = this.stmt.txByKey.get(idempotencyKey);
    if (prior) {
      this._assertReplay(prior, request);
      return this._stored(prior);
    }
    const account = this.stmt.account.get(userId);
    if (!account) throw new Error('User not found');
    const after = account.balance + deltaMilli;
    if (!Number.isSafeInteger(after) || after < 0) throw new RangeError('resulting balance is invalid');
    const now = this.now();
    const txId = crypto.randomUUID();
    this.stmt.updateBalance.run(after, now, userId);
    const resolvedResponse = typeof response === 'function' ? response({ balanceBefore: fromMilli(account.balance), balanceAfter: fromMilli(after), txId }) : response;
    this.stmt.insertTx.run(txId, idempotencyKey, requestHash, userId, game, action, referenceId, deltaMilli,
      account.balance, after, stringify(resolvedResponse), stringify(canonicalize(metadata)), now);
    return { replayed: false, txId, balance: fromMilli(after), response: resolvedResponse, metadata };
  }

  change(input) { return this._change(input); }

  lookup(idempotencyKey) {
    const row = this.stmt.txByKey.get(assertId(idempotencyKey, 'idempotencyKey'));
    return row ? this._stored(row) : null;
  }

  _reserveInside({ escrowId = crypto.randomUUID(), userId, game, referenceId, stake, idempotencyKey, metadata = null, response = null }) {
    assertId(escrowId, 'escrowId');
    assertUserId(userId);
    assertId(game, 'game', 40);
    assertId(referenceId, 'referenceId');
    assertId(idempotencyKey, 'idempotencyKey');
    assertCredits(stake, 'stake');
    if (stake < 1) throw new RangeError('stake must be positive');
    const stakeMilli = toMilli(stake, 'stake');
    const expected = { userId, game, action: 'reserve', referenceId, deltaMilli: -stakeMilli, metadata };
    const existing = this.stmt.escrowByRef.get(userId, game, referenceId);
    if (existing) {
      const tx = this.stmt.txByKey.get(idempotencyKey);
      if (!tx) throw new IdempotencyConflictError('Wager reference was already reserved with a different idempotency key');
      this._assertReplay(tx, expected);
      if (existing.stake !== stakeMilli) throw new IdempotencyConflictError('Wager reference was already reserved with a different stake');
      return { ...this._stored(tx), escrow: this._publicEscrow(existing) };
    }
    const changed = this._changeInside({ userId, delta: -stake, idempotencyKey, game, action: 'reserve', referenceId, response, metadata });
    const now = this.now();
    this.stmt.insertEscrow.run(escrowId, userId, game, referenceId, stakeMilli, stringify(metadata), now, now);
    this.stmt.updateRecoveryPayout.run(stakeMilli, now, escrowId);
    return { ...changed, escrow: this._publicEscrow(this.stmt.escrowById.get(escrowId)) };
  }

  reserve(input) { return this._reserve(input); }

  importActiveEscrow({ escrowId = crypto.randomUUID(), userId, game, referenceId, stake, recoveryPayout = stake, metadata = null }) {
    assertUserId(userId);
    assertId(game, 'game', 40);
    assertId(referenceId, 'referenceId', 160);
    assertCredits(stake, 'stake');
    assertCredits(recoveryPayout, 'recoveryPayout');
    return this.db.transaction(() => {
      const existing = this.stmt.escrowByRef.get(userId, game, referenceId);
      if (existing) return this._publicEscrow(existing);
      if (!this.stmt.account.get(userId)) throw new Error(`Unknown account: ${userId}`);
      const now = this.now();
      const stakeMilli = toMilli(stake, 'stake');
      this.stmt.insertEscrow.run(assertId(escrowId, 'escrowId'), userId, game, referenceId, stakeMilli,
        stringify({ ...(metadata || {}), imported: true }), now, now);
      this.stmt.updateRecoveryPayout.run(toMilli(recoveryPayout, 'recoveryPayout'), now, escrowId);
      this._changeInside({ userId, delta: 0, idempotencyKey: `import-escrow:${escrowId}`, game,
        action: 'import_reservation', referenceId, response: { imported: true }, metadata });
      return this._publicEscrow(this.stmt.escrowById.get(escrowId));
    })();
  }

  _finishInside({ escrowId, payout, idempotencyKey, action = 'settle', response = null, metadata = null }) {
    assertId(escrowId, 'escrowId');
    assertId(idempotencyKey, 'idempotencyKey');
    assertCredits(payout, 'payout');
    if (!['settle', 'refund'].includes(action)) throw new TypeError('invalid escrow action');
    const escrow = this.stmt.escrowById.get(escrowId);
    if (!escrow) throw new Error('Escrow not found');
    const payoutMilli = toMilli(payout, 'payout');
    const expected = {
      userId: escrow.user_id,
      game: escrow.game,
      action,
      referenceId: escrow.reference_id,
      deltaMilli: payoutMilli,
      metadata
    };
    const prior = this.stmt.txByKey.get(idempotencyKey);
    if (prior) {
      this._assertReplay(prior, expected);
      if (escrow.payout != null && escrow.payout !== payoutMilli) throw new IdempotencyConflictError('Escrow was already finished with a different payout');
      return { ...this._stored(prior), escrow: this._publicEscrow(this.stmt.escrowById.get(escrowId)) };
    }
    if (escrow.status !== 'active') throw new Error(`Escrow already ${escrow.status}`);
    const changed = this._changeInside({
      userId: escrow.user_id, delta: payout, idempotencyKey, game: escrow.game,
      action, referenceId: escrow.reference_id, response, metadata
    });
    const status = action === 'refund' ? 'refunded' : 'settled';
    const updated = this.stmt.finishEscrow.run(status, toMilli(payout, 'payout'), this.now(), escrowId);
    if (updated.changes !== 1) throw new Error('Escrow transition failed');
    return { ...changed, escrow: this._publicEscrow(this.stmt.escrowById.get(escrowId)) };
  }

  settle(input) { return this._finish({ ...input, action: 'settle' }); }
  refund(input) {
    const storedStake = this.stmt.escrowById.get(input.escrowId)?.stake;
    return this._finish({ ...input, payout: input.payout ?? (storedStake == null ? undefined : fromMilli(storedStake)), action: 'refund' });
  }
  settleMany(inputs) { return this._finishMany(inputs.map(input => ({ ...input, action: input.action || 'settle' }))); }
  replaceEscrow(input) { return this._replaceEscrow(input); }
  updateRecoveryPayouts(items) { this._updateRecoveryPayouts(items); }

  recoverActiveEscrows({ reason = 'startup_recovery', preserveGames = [] } = {}) {
    const recovered = [];
    const preserved = new Set(preserveGames);
    for (const escrow of this.stmt.activeEscrows.all()) {
      if (preserved.has(escrow.game)) continue;
      recovered.push(this.refund({
        escrowId: escrow.escrow_id,
        payout: fromMilli(escrow.recovery_payout ?? escrow.stake),
        idempotencyKey: `recovery:${escrow.escrow_id}`,
        response: { recovered: true, reason },
        metadata: { reason }
      }));
    }
    return recovered;
  }

  _publicEscrow(row) {
    return row && {
      escrowId: row.escrow_id, userId: row.user_id, game: row.game, referenceId: row.reference_id,
      stake: fromMilli(row.stake), status: row.status,
      payout: row.payout == null ? null : fromMilli(row.payout),
      recoveryPayout: row.recovery_payout == null ? null : fromMilli(row.recovery_payout),
      metadata: parseJson(row.metadata_json),
      createdAt: row.created_at, updatedAt: row.updated_at
    };
  }

  activeEscrows() { return this.stmt.activeEscrows.all().map(row => this._publicEscrow(row)); }

  escrowsForUser(userId, game = null) {
    const normalizedUserId = assertUserId(userId);
    const rows = game
      ? this.db.prepare('SELECT * FROM escrows WHERE user_id=? AND game=? ORDER BY created_at DESC, escrow_id DESC').all(normalizedUserId, assertId(game, 'game', 40))
      : this.db.prepare('SELECT * FROM escrows WHERE user_id=? ORDER BY created_at DESC, escrow_id DESC').all(normalizedUserId);
    return rows.map(row => this._publicEscrow(row));
  }

  saveRound({ roundId, game, state, status = 'active', commitment = null, seedId = null, nonce = null }) {
    const now = this.now();
    this.stmt.saveRound.run({ roundId: assertId(roundId, 'roundId'), game: assertId(game, 'game', 40),
      stateJson: stringify(state), status, commitment, seedId, nonce, createdAt: now, updatedAt: now });
  }

  activeRounds() {
    return this.stmt.activeRounds.all().map(row => ({
      roundId: row.round_id, game: row.game, state: parseJson(row.state_json, {}), status: row.status,
      commitment: row.commitment, seedId: row.seed_id, nonce: row.nonce
    }));
  }

  account(userId) {
    const row = this.stmt.account.get(assertUserId(userId));
    return row ? { userId: row.user_id, balance: fromMilli(row.balance), email: row.email || null, emailVerified: Boolean(row.email_verified_at) } : null;
  }

  setVerifiedEmail(userId, email, verifiedAt = this.now()) {
    const normalized = String(email || '').trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized) || normalized.length > 254) throw new TypeError('Invalid email');
    if (this.stmt.setEmail.run(normalized, verifiedAt, this.now(), assertUserId(userId)).changes !== 1) throw new Error('User not found');
    return normalized;
  }

  accountByEmail(email) {
    return this.db.prepare('SELECT * FROM accounts WHERE email=? AND email_verified_at IS NOT NULL').get(String(email || '').trim().toLowerCase()) || null;
  }

  createRecoveryToken(userId, ttlMs = 30 * 60 * 1000) {
    this.balance(userId);
    const raw = crypto.randomBytes(32).toString('base64url');
    const hash = crypto.createHash('sha256').update(raw).digest('hex');
    const now = this.now();
    this.stmt.insertRecovery.run(hash, userId, now + ttlMs, now);
    return raw;
  }

  consumeRecoveryToken(raw) {
    const hash = crypto.createHash('sha256').update(String(raw || '')).digest('hex');
    return this.db.transaction(() => {
      const row = this.stmt.recovery.get(hash);
      const now = this.now();
      if (!row || row.used_at || row.expires_at <= now) return null;
      if (this.stmt.useRecovery.run(now, hash).changes !== 1) return null;
      return row.user_id;
    })();
  }

  createVerificationToken(userId, email, ttlMs = 24 * 60 * 60 * 1000) {
    this.balance(userId);
    const normalized = String(email || '').trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) throw new TypeError('Invalid email');
    const raw = crypto.randomBytes(32).toString('base64url');
    const hash = crypto.createHash('sha256').update(raw).digest('hex');
    const now = this.now();
    this.stmt.insertVerification.run(hash, userId, normalized, now + ttlMs, now);
    return raw;
  }

  consumeVerificationToken(raw) {
    const hash = crypto.createHash('sha256').update(String(raw || '')).digest('hex');
    return this.db.transaction(() => {
      const row = this.stmt.verification.get(hash);
      const now = this.now();
      if (!row || row.used_at || row.expires_at <= now) return null;
      this.setVerifiedEmail(row.user_id, row.email, now);
      if (this.stmt.useVerification.run(now, hash).changes !== 1) throw new Error('Verification token transition failed');
      return { userId: row.user_id, email: row.email };
    })();
  }

  integrityCheck() { return this.db.pragma('integrity_check', { simple: true }); }
  checkpoint() { return this.db.pragma('wal_checkpoint(TRUNCATE)'); }
  close() { this.db.close(); }
}

module.exports = { CasinoLedger, IdempotencyConflictError, assertCasinoDatabaseIdentity, assertCredits, assertDelta, assertId, assertUserId, toMilli, fromMilli, mutationHash };
