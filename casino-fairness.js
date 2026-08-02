'use strict';

const crypto = require('node:crypto');

const FAIR_GAMES = new Set(['blackjack', 'roulette', 'coinflip', 'crash', 'pachinko', 'poker', 'daily_bonus', 'case_opening', 'case_battle']);

function safeText(value, label, max = 128) {
  const text = String(value || '');
  if (!text || text.length > max || !/^[A-Za-z0-9:_.-]+$/.test(text)) throw new TypeError(`${label} is invalid`);
  return text;
}

function commitment(seed) {
  return crypto.createHash('sha256').update(seed, 'hex').digest('hex');
}

function deriveBytes(seedHex, game, clientSeed, nonce, counter = 0) {
  return crypto.createHmac('sha256', Buffer.from(seedHex, 'hex'))
    .update(`${game}:${clientSeed}:${nonce}:${counter}`)
    .digest();
}

function uniformInt(seedHex, game, clientSeed, nonce, maxExclusive, counter = 0) {
  if (!Number.isSafeInteger(maxExclusive) || maxExclusive < 1 || maxExclusive > 0x100000000) throw new RangeError('maxExclusive is invalid');
  let block = counter;
  const limit = Math.floor(0x100000000 / maxExclusive) * maxExclusive;
  while (true) {
    const bytes = deriveBytes(seedHex, game, clientSeed, nonce, block++);
    for (let offset = 0; offset <= bytes.length - 4; offset += 4) {
      const value = bytes.readUInt32BE(offset);
      if (value < limit) return { value: value % maxExclusive, counter: block - 1, offset };
    }
  }
}

class FairnessConflictError extends Error {
  constructor(message = 'Fair round identifier was already bound to different inputs') {
    super(message);
    this.name = 'FairnessConflictError';
    this.code = 'fairness_conflict';
    this.statusCode = 409;
  }
}

class FairRng {
  constructor({ db, now = () => Date.now() }) {
    this.db = db;
    this.now = now;
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS fair_seeds (
        game TEXT PRIMARY KEY,
        current_seed TEXT NOT NULL,
        current_commitment TEXT NOT NULL,
        nonce INTEGER NOT NULL DEFAULT 0,
        updated_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS fair_rounds (
        round_id TEXT PRIMARY KEY,
        game TEXT NOT NULL,
        commitment TEXT NOT NULL,
        server_seed TEXT NOT NULL,
        client_seed TEXT NOT NULL,
        nonce INTEGER NOT NULL,
        result_json TEXT,
        revealed_at INTEGER,
        created_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_fair_game_created ON fair_rounds(game, created_at DESC);
    `);
    this.selectSeed = this.db.prepare('SELECT * FROM fair_seeds WHERE game=?');
    this.insertSeed = this.db.prepare('INSERT INTO fair_seeds(game,current_seed,current_commitment,nonce,updated_at) VALUES (?,?,?,?,?)');
    this.rotateSeed = this.db.prepare('UPDATE fair_seeds SET current_seed=?,current_commitment=?,nonce=?,updated_at=? WHERE game=?');
    this.insertRound = this.db.prepare(`INSERT INTO fair_rounds(round_id,game,commitment,server_seed,client_seed,nonce,created_at)
      VALUES (?,?,?,?,?,?,?)`);
    this.revealRound = this.db.prepare('UPDATE fair_rounds SET result_json=?,revealed_at=? WHERE round_id=? AND revealed_at IS NULL');
    this.bindRoundClientSeed = this.db.prepare('UPDATE fair_rounds SET client_seed=? WHERE round_id=? AND client_seed=? AND revealed_at IS NULL');
    this.round = this.db.prepare('SELECT * FROM fair_rounds WHERE round_id=?');
    this._consume = this.db.transaction((game, roundId, clientSeed) => this._consumeInside(game, roundId, clientSeed));
  }

  _ensure(game) {
    if (!FAIR_GAMES.has(game)) throw new RangeError('Unsupported fair game');
    let row = this.selectSeed.get(game);
    if (!row) {
      const seed = crypto.randomBytes(32).toString('hex');
      this.insertSeed.run(game, seed, commitment(seed), 0, this.now());
      row = this.selectSeed.get(game);
    }
    return row;
  }

  current(game) {
    const row = this._ensure(game);
    return { game, commitment: row.current_commitment, nonce: row.nonce };
  }

  _consumeInside(game, roundId, clientSeed) {
    safeText(roundId, 'roundId', 160);
    const normalizedClientSeed = safeText(clientSeed || 'neon777', 'clientSeed', 128);
    const existing = this.round.get(roundId);
    if (existing) {
      if (existing.game !== game || existing.client_seed !== normalizedClientSeed) throw new FairnessConflictError();
      return this._public(existing, false);
    }
    const seed = this._ensure(game);
    const nextSecret = crypto.randomBytes(32).toString('hex');
    const nonce = seed.nonce + 1;
    this.rotateSeed.run(nextSecret, commitment(nextSecret), nonce, this.now(), game);
    this.insertRound.run(roundId, game, seed.current_commitment, seed.current_seed, normalizedClientSeed, nonce, this.now());
    return {
      game, roundId, commitment: seed.current_commitment, clientSeed: normalizedClientSeed, nonce,
      nextCommitment: commitment(nextSecret), serverSeed: seed.current_seed
    };
  }

  consume(game, roundId, clientSeed) {
    if (!FAIR_GAMES.has(game)) throw new RangeError('Unsupported fair game');
    return this._consume(game, roundId, clientSeed);
  }

  int(context, maxExclusive, counter = 0) {
    return uniformInt(context.serverSeed, context.game, context.clientSeed, context.nonce, maxExclusive, counter).value;
  }

  bindClientSeed(roundId, expectedClientSeed, nextClientSeed) {
    const normalizedRoundId = safeText(roundId, 'roundId', 160);
    const expected = safeText(expectedClientSeed, 'expectedClientSeed', 128);
    const next = safeText(nextClientSeed, 'nextClientSeed', 128);
    const row = this.round.get(normalizedRoundId);
    if (!row) throw new Error('Fair round not found');
    if (row.revealed_at) throw new FairnessConflictError('Fair round was already revealed');
    if (row.client_seed === next) return this.getContext(normalizedRoundId);
    if (row.client_seed !== expected || this.bindRoundClientSeed.run(next, normalizedRoundId, expected).changes !== 1) {
      throw new FairnessConflictError('Fair round client seed changed concurrently');
    }
    return this.getContext(normalizedRoundId);
  }

  reveal(roundId, result) {
    const row = this.round.get(safeText(roundId, 'roundId', 160));
    if (!row) throw new Error('Fair round not found');
    if (!row.revealed_at) this.revealRound.run(JSON.stringify(result ?? null), this.now(), roundId);
    return this._public(this.round.get(roundId), true);
  }

  getProof(roundId) {
    const row = this.round.get(safeText(roundId, 'roundId', 160));
    return row ? this._public(row, Boolean(row.revealed_at)) : null;
  }

  // Internal-only context for services that settle against an already published
  // commitment. Never expose this value through an API before settlement.
  getContext(roundId) {
    const row = this.round.get(safeText(roundId, 'roundId', 160));
    if (!row) throw new Error('Fair round not found');
    return {
      game: row.game,
      roundId: row.round_id,
      commitment: row.commitment,
      clientSeed: row.client_seed,
      nonce: row.nonce,
      serverSeed: row.server_seed
    };
  }

  _public(row, includeSeed) {
    return {
      game: row.game,
      roundId: row.round_id,
      commitment: row.commitment,
      clientSeed: row.client_seed,
      nonce: row.nonce,
      ...(includeSeed ? { serverSeed: row.server_seed, result: row.result_json ? JSON.parse(row.result_json) : null, revealedAt: row.revealed_at } : {})
    };
  }

  static verify({ serverSeed, commitment: expected, game, clientSeed, nonce, maxExclusive, counter = 0, expectedValue }) {
    if (commitment(serverSeed) !== expected) return { valid: false, reason: 'commitment_mismatch' };
    const generated = uniformInt(serverSeed, game, clientSeed, nonce, maxExclusive, counter).value;
    return { valid: generated === expectedValue, generated };
  }
}

module.exports = { FairRng, FairnessConflictError, FAIR_GAMES, commitment, deriveBytes, uniformInt };
