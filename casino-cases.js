'use strict';

const crypto = require('node:crypto');
const { IdempotencyConflictError } = require('./casino-ledger');
const CASE_ASSETS = require('./casino-case-assets.json');

const DROP_TABLE = Object.freeze([
  Object.freeze({ rarity: 'consumer', label: 'Consumer', weight: 700000, multiplier: 0.4, color: '#9aa6b2' }),
  Object.freeze({ rarity: 'industrial', label: 'Industrial', weight: 220000, multiplier: 1, color: '#6fa8ff' }),
  Object.freeze({ rarity: 'classified', label: 'Classified', weight: 70000, multiplier: 3, color: '#b56cff' }),
  Object.freeze({ rarity: 'covert', label: 'Covert', weight: 9000, multiplier: 20, color: '#ff506d' }),
  Object.freeze({ rarity: 'contraband', label: 'Contraband', weight: 1000, multiplier: 60, color: '#ffc857' })
]);

const CASE_DEFINITIONS = [
  ['legacy-dust', 'csgo', 'Dust Archive', 100, '#d4a15c'],
  ['legacy-phoenix', 'csgo', 'Phoenix Vault', 250, '#e37048'],
  ['cs2-pulse', 'cs2', 'Pulse Protocol', 150, '#23d8b4'],
  ['cs2-quantum', 'cs2', 'Quantum Cache', 400, '#8f7cff'],
  ['cs2-spectrum', 'cs2', 'Spectrum Array', 500, '#ef67c7'],
  ['cs2-reactor', 'cs2', 'Reactor Prime', 1000, '#ffbf47']
];

const CASE_CATALOG = Object.freeze(CASE_DEFINITIONS.map(([id, generation, name, price, accent]) => Object.freeze({
  id, generation, name, price, accent,
  expectedReturn: 0.95,
  description: generation === 'csgo' ? 'A legacy Counter-Strike-inspired site case.' : 'A modern CS2-inspired site case.',
  items: Object.freeze(DROP_TABLE.map((tier, index) => {
    const asset = CASE_ASSETS[id]?.[index];
    if (!asset) throw new Error(`Missing canonical CS2 asset metadata for ${id}:${index}`);
    return Object.freeze({
      id: `${id}:${tier.rarity}`,
      ...asset,
      rarity: tier.rarity,
      rarityLabel: tier.label,
      color: tier.color,
      weight: tier.weight,
      chance: tier.weight / 10000,
      chanceLabel: `${tier.weight / 10000}%`,
      value: Math.round(price * tier.multiplier)
    });
  }))
})));

const CASE_BY_ID = new Map(CASE_CATALOG.map(entry => [entry.id, entry]));
const ITEM_BY_ID = new Map(CASE_CATALOG.flatMap(entry => entry.items.map(item => [item.id, item])));
const ALLOWED_GAMES = new Set(['case_opening', 'case_battle']);

function canonicalizeItem(item) {
  const canonical = ITEM_BY_ID.get(item?.id);
  return canonical ? { ...item, ...canonical, inventoryId: item.inventoryId, roll: item.roll, counter: item.counter } : item;
}

function stable(value) {
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(stable);
  return Object.fromEntries(Object.keys(value).sort().map(key => [key, stable(value[key])]));
}
function json(value) { return JSON.stringify(stable(value)); }
function parse(value, fallback = null) {
  if (value == null) return fallback;
  try { return JSON.parse(value); } catch { return fallback; }
}
function safe(value, label, max = 160) {
  const text = String(value || '');
  if (!text || text.length > max || !/^[A-Za-z0-9:_.-]+$/.test(text)) throw new TypeError(`${label} is invalid`);
  return text;
}
function identifier(prefix, ...parts) {
  return `${prefix}_${crypto.createHash('sha256').update(parts.join(':')).digest('hex').slice(0, 24)}`;
}
function seedDigest(domain, ...parts) {
  return crypto.createHash('sha256').update([domain, ...parts].join('\0')).digest('hex');
}
function battleSeedBundle({ battleId, commitment, creatorClientSeed, opponentClientSeed }) {
  const opponentSeed = opponentClientSeed || seedDigest('neon777-bot:v1', battleId, commitment);
  return {
    creatorClientSeed,
    opponentClientSeed: opponentSeed,
    combinedClientSeed: seedDigest('case-battle-client:v1', creatorClientSeed, opponentSeed)
  };
}
function catalogPublic() {
  return CASE_CATALOG.map(entry => ({ ...entry, items: entry.items.map(item => ({ ...item })) }));
}
function selectItem(caseEntry, roll) {
  let cursor = 0;
  for (const item of caseEntry.items) {
    cursor += item.weight;
    if (roll < cursor) return item;
  }
  throw new Error('Case drop table is invalid');
}

class CaseGameService {
  constructor({ ledger, fairRng, now = () => Date.now() }) {
    if (!ledger || !fairRng) throw new TypeError('ledger and fairRng are required');
    this.ledger = ledger;
    this.fairRng = fairRng;
    this.db = ledger.db;
    this.now = now;
    this._migrate();
    this._prepareStatements();
  }

  _migrate() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS case_preparations (
        round_id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        game TEXT NOT NULL,
        client_seed TEXT NOT NULL,
        status TEXT NOT NULL CHECK(status IN ('prepared','used','cancelled')),
        created_at INTEGER NOT NULL,
        used_at INTEGER
      );
      CREATE TABLE IF NOT EXISTS case_openings (
        opening_id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        request_json TEXT NOT NULL,
        fair_round_id TEXT NOT NULL UNIQUE REFERENCES case_preparations(round_id),
        escrow_id TEXT NOT NULL,
        result_json TEXT NOT NULL,
        balance_after REAL NOT NULL,
        created_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS case_inventory (
        inventory_id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        item_id TEXT NOT NULL,
        item_json TEXT NOT NULL,
        source_type TEXT NOT NULL CHECK(source_type IN ('opening','battle')),
        source_id TEXT NOT NULL,
        source_owner TEXT NOT NULL,
        status TEXT NOT NULL CHECK(status IN ('available','sold')),
        acquired_at INTEGER NOT NULL,
        sold_at INTEGER
      );
      CREATE INDEX IF NOT EXISTS idx_case_inventory_user ON case_inventory(user_id,status,acquired_at DESC);
      CREATE TABLE IF NOT EXISTS case_battles (
        battle_id TEXT PRIMARY KEY,
        creator_id TEXT NOT NULL,
        opponent_id TEXT,
        opponent_type TEXT NOT NULL CHECK(opponent_type IN ('human','bot')),
        status TEXT NOT NULL CHECK(status IN ('waiting','settled','cancelled')),
        request_json TEXT NOT NULL,
        fair_round_id TEXT NOT NULL UNIQUE REFERENCES case_preparations(round_id),
        cases_json TEXT NOT NULL,
        entry_cost INTEGER NOT NULL,
        creator_escrow_id TEXT NOT NULL,
        opponent_escrow_id TEXT,
        result_json TEXT,
        winner_id TEXT,
        created_at INTEGER NOT NULL,
        settled_at INTEGER
      );
      CREATE INDEX IF NOT EXISTS idx_case_battles_status ON case_battles(status,created_at DESC);
    `);
    const columns = new Set(this.db.prepare('PRAGMA table_info(case_battles)').all().map(column => column.name));
    const additions = [
      ['creator_client_seed', 'TEXT'],
      ['opponent_client_seed', 'TEXT'],
      ['combined_client_seed', 'TEXT'],
      ['join_request_json', 'TEXT'],
      ['cancel_request_json', 'TEXT']
    ];
    for (const [name, type] of additions) {
      if (!columns.has(name)) this.db.exec(`ALTER TABLE case_battles ADD COLUMN ${name} ${type}`);
    }
  }

  _prepareStatements() {
    this.stmt = {
      prep: this.db.prepare('SELECT * FROM case_preparations WHERE round_id=?'),
      insertPrep: this.db.prepare("INSERT INTO case_preparations(round_id,user_id,game,client_seed,status,created_at) VALUES (?,?,?,?,'prepared',?)"),
      usePrep: this.db.prepare("UPDATE case_preparations SET status='used',used_at=? WHERE round_id=? AND status='prepared'"),
      cancelPrep: this.db.prepare("UPDATE case_preparations SET status='cancelled',used_at=? WHERE round_id=? AND status='used'"),
      opening: this.db.prepare('SELECT * FROM case_openings WHERE opening_id=?'),
      insertOpening: this.db.prepare('INSERT INTO case_openings(opening_id,user_id,request_json,fair_round_id,escrow_id,result_json,balance_after,created_at) VALUES (?,?,?,?,?,?,?,?)'),
      insertInventory: this.db.prepare("INSERT INTO case_inventory(inventory_id,user_id,item_id,item_json,source_type,source_id,source_owner,status,acquired_at) VALUES (?,?,?,?,?,?,?,'available',?)"),
      inventoryItem: this.db.prepare('SELECT * FROM case_inventory WHERE inventory_id=?'),
      inventoryUser: this.db.prepare('SELECT * FROM case_inventory WHERE user_id=? ORDER BY acquired_at DESC,inventory_id DESC'),
      sellInventory: this.db.prepare("UPDATE case_inventory SET status='sold',sold_at=? WHERE inventory_id=? AND status='available'"),
      battle: this.db.prepare('SELECT * FROM case_battles WHERE battle_id=?'),
      battleByCreatorRequest: this.db.prepare("SELECT * FROM case_battles WHERE creator_id=? AND json_extract(request_json,'$.requestId')=?"),
      insertBattle: this.db.prepare(`INSERT INTO case_battles
        (battle_id,creator_id,opponent_type,status,request_json,fair_round_id,cases_json,entry_cost,creator_escrow_id,
         creator_client_seed,opponent_client_seed,combined_client_seed,created_at)
        VALUES (?,?,?,'waiting',?,?,?,?,?,?,?,?,?)`),
      joinBattle: this.db.prepare(`UPDATE case_battles
        SET opponent_id=?,opponent_escrow_id=?,opponent_client_seed=?,combined_client_seed=?,join_request_json=?
        WHERE battle_id=? AND status='waiting' AND opponent_id IS NULL`),
      settleBattle: this.db.prepare("UPDATE case_battles SET status='settled',result_json=?,winner_id=?,settled_at=? WHERE battle_id=? AND status='waiting'"),
      cancelBattle: this.db.prepare("UPDATE case_battles SET status='cancelled',cancel_request_json=?,settled_at=? WHERE battle_id=? AND status='waiting'"),
      recoverableBattles: this.db.prepare("SELECT * FROM case_battles WHERE status='waiting' AND (opponent_type='bot' OR opponent_id IS NOT NULL) ORDER BY created_at"),
      battles: this.db.prepare("SELECT * FROM case_battles ORDER BY CASE status WHEN 'waiting' THEN 0 ELSE 1 END,created_at DESC LIMIT ?")
    };
  }

  catalog() { return catalogPublic(); }

  prepare({ userId, game, requestId, clientSeed = 'neon777' }) {
    safe(userId, 'userId', 64); safe(requestId, 'requestId', 80); safe(clientSeed, 'clientSeed', 128);
    if (!ALLOWED_GAMES.has(game)) throw new RangeError('Unsupported case game');
    const roundId = identifier(game, userId, requestId);
    const existing = this.stmt.prep.get(roundId);
    if (existing) {
      if (existing.user_id !== userId || existing.game !== game || existing.client_seed !== clientSeed) throw new IdempotencyConflictError('Prepared round was already bound to different inputs');
      const proof = this.fairRng.getProof(roundId);
      return { roundId, game, commitment: proof.commitment, clientSeed, nonce: proof.nonce };
    }
    const context = this.fairRng.consume(game, roundId, clientSeed);
    this.stmt.insertPrep.run(roundId, userId, game, clientSeed, this.now());
    return { roundId, game, commitment: context.commitment, clientSeed, nonce: context.nonce };
  }

  _prepared(userId, game, roundId, clientSeed) {
    const prep = this.stmt.prep.get(safe(roundId, 'fairRoundId'));
    if (!prep || prep.user_id !== userId || prep.game !== game || prep.client_seed !== clientSeed) throw new Error('Prepared fair round not found');
    return prep;
  }

  _caseSequence(caseIds) {
    if (!Array.isArray(caseIds) || caseIds.length < 1 || caseIds.length > 12) throw new RangeError('Choose between 1 and 12 cases');
    return caseIds.map(id => {
      const entry = CASE_BY_ID.get(String(id));
      if (!entry) throw new RangeError(`Unknown case: ${id}`);
      return entry;
    });
  }

  open({ userId, caseId, count = 1, requestId, fairRoundId, clientSeed = 'neon777' }) {
    safe(userId, 'userId', 64); safe(requestId, 'requestId', 80); safe(clientSeed, 'clientSeed', 128);
    const caseEntry = CASE_BY_ID.get(String(caseId));
    if (!caseEntry) throw new RangeError('Unknown case');
    if (![1, 3, 5].includes(count)) throw new RangeError('Open count must be 1, 3, or 5');
    const openingId = identifier('opening', userId, requestId);
    const request = { requestId, caseId, count, fairRoundId, clientSeed };
    const prior = this.stmt.opening.get(openingId);
    if (prior) {
      if (prior.user_id !== userId || prior.request_json !== json(request)) throw new IdempotencyConflictError('Opening identifier was already used for a different request');
      return this._publicOpening(prior, true);
    }
    const prep = this._prepared(userId, 'case_opening', fairRoundId, clientSeed);
    if (prep.status !== 'prepared') throw new IdempotencyConflictError('Prepared fair round was already used');
    const total = caseEntry.price * count;
    const created = this.db.transaction(() => {
      if (this.stmt.usePrep.run(this.now(), fairRoundId).changes !== 1) throw new IdempotencyConflictError('Prepared fair round was already used');
      const context = this.fairRng.getContext(fairRoundId);
      const reserve = this.ledger.reserve({
        userId, game: 'case_opening', referenceId: openingId, stake: total,
        idempotencyKey: `case-open:${openingId}:reserve`, metadata: request
      });
      const items = [];
      for (let index = 0; index < count; index += 1) {
        const roll = this.fairRng.int(context, 1_000_000, index);
        const item = selectItem(caseEntry, roll);
        const inventoryId = identifier('skin', openingId, String(index));
        const dropped = { ...item, caseId, caseName: caseEntry.name, roll, counter: index, inventoryId };
        items.push(dropped);
        this.stmt.insertInventory.run(inventoryId, userId, item.id, json(dropped), 'opening', openingId, userId, this.now());
      }
      const settled = this.ledger.settle({
        escrowId: reserve.escrow.escrowId, payout: 0,
        idempotencyKey: `case-open:${openingId}:settle`, response: { items }, metadata: request
      });
      this.stmt.insertOpening.run(openingId, userId, json(request), fairRoundId, reserve.escrow.escrowId, json({ items }), settled.balance, this.now());
      return this.stmt.opening.get(openingId);
    })();
    this.fairRng.reveal(fairRoundId, { type: 'case_opening', caseId, count, items: parse(created.result_json).items.map(item => ({ itemId: item.id, roll: item.roll, counter: item.counter })) });
    return this._publicOpening(created, true);
  }

  _publicOpening(row, reveal = false) {
    const result = parse(row.result_json, { items: [] });
    if (reveal && !this.fairRng.getProof(row.fair_round_id)?.serverSeed) {
      this.fairRng.reveal(row.fair_round_id, { type: 'case_opening', items: result.items.map(item => ({ itemId: item.id, roll: item.roll, counter: item.counter })) });
    }
    return {
      openingId: row.opening_id, items: result.items.map(canonicalizeItem), balance: row.balance_after,
      inventory: result.items.map(item => this._publicInventory(this.stmt.inventoryItem.get(item.inventoryId))),
      proof: this.fairRng.getProof(row.fair_round_id)
    };
  }

  inventory(userId, { includeSold = false } = {}) {
    safe(userId, 'userId', 64);
    return this.stmt.inventoryUser.all(userId).filter(row => includeSold || row.status === 'available').map(row => this._publicInventory(row));
  }

  _publicInventory(row) {
    if (!row) return null;
    const item = canonicalizeItem(parse(row.item_json, {}));
    return { inventoryId: row.inventory_id, ...item, status: row.status, sourceType: row.source_type, sourceId: row.source_id, sourceOwner: row.source_owner, acquiredAt: row.acquired_at, soldAt: row.sold_at };
  }

  sell({ userId, inventoryId, requestId }) {
    safe(userId, 'userId', 64); safe(inventoryId, 'inventoryId'); safe(requestId, 'requestId', 80);
    const row = this.stmt.inventoryItem.get(inventoryId);
    if (!row || row.user_id !== userId) throw new Error('Inventory item not found');
    const item = parse(row.item_json, {});
    const result = this.db.transaction(() => {
      const changed = this.ledger.change({
        userId, delta: item.value, idempotencyKey: `case-sell:${userId}:${requestId}`,
        game: 'case_opening', action: 'sell_item', referenceId: inventoryId,
        response: { inventoryId, value: item.value }, metadata: { inventoryId, requestId }
      });
      if (row.status === 'available') {
        if (this.stmt.sellInventory.run(this.now(), inventoryId).changes !== 1) throw new Error('Inventory sale transition failed');
      } else if (!changed.replayed) {
        throw new Error('Inventory item already sold');
      }
      return changed;
    })();
    return { inventoryId, value: item.value, balance: this.ledger.balance(userId), item: this._publicInventory(this.stmt.inventoryItem.get(inventoryId)) };
  }

  sellAll({ userId, inventoryIds, requestId }) {
    safe(userId, 'userId', 64); safe(requestId, 'requestId', 80);
    if (!Array.isArray(inventoryIds) || inventoryIds.length < 1 || inventoryIds.length > 500) throw new RangeError('Inventory items are required');
    const ids = [...new Set(inventoryIds.map(id => safe(id, 'inventoryId')))].sort();
    if (ids.length !== inventoryIds.length) throw new RangeError('Inventory items must be unique');
    const rows = ids.map(id => this.stmt.inventoryItem.get(id));
    if (rows.some((row, index) => !row || row.user_id !== userId || row.inventory_id !== ids[index])) throw new Error('Inventory item not found');
    const items = rows.map(row => parse(row.item_json, {}));
    const value = items.reduce((sum, item) => sum + Number(item.value || 0), 0);
    const idempotencyKey = `case-sell-all:${userId}:${requestId}`;
    const metadata = { requestId, inventoryIds: ids };
    const input = {
      userId, delta: value, idempotencyKey, game: 'case_opening', action: 'sell_all',
      referenceId: `sell-all-${requestId}`, response: { inventoryIds: ids, count: ids.length, value }, metadata
    };
    const prior = this.ledger.lookup(idempotencyKey);
    if (prior) {
      this.ledger.change(input);
    } else {
      this.db.transaction(() => {
        if (rows.some(row => row.status !== 'available')) throw new Error('One or more inventory items are already sold');
        this.ledger.change(input);
        const soldAt = this.now();
        for (const id of ids) {
          if (this.stmt.sellInventory.run(soldAt, id).changes !== 1) throw new Error('Inventory sale transition failed');
        }
      })();
    }
    return {
      inventoryIds: ids,
      count: ids.length,
      value,
      balance: this.ledger.balance(userId),
      items: ids.map(id => this._publicInventory(this.stmt.inventoryItem.get(id)))
    };
  }

  createBattle({ userId, opponent = 'human', caseIds, requestId, fairRoundId, clientSeed = 'neon777' }) {
    safe(userId, 'userId', 64); safe(requestId, 'requestId', 80); safe(clientSeed, 'clientSeed', 128);
    if (!['human', 'bot'].includes(opponent)) throw new RangeError('Opponent must be human or bot');
    const sequence = this._caseSequence(caseIds);
    const battleId = identifier('battle', userId, requestId);
    const request = { requestId, opponent, caseIds, fairRoundId, clientSeed };
    const prior = this.stmt.battle.get(battleId);
    if (prior) {
      if (prior.creator_id !== userId || prior.request_json !== json(request)) throw new IdempotencyConflictError('Battle identifier was already used for a different request');
      return prior.opponent_type === 'bot' && prior.status === 'waiting' ? this._settleBattle(prior, 'NEON BOT') : this._publicBattle(prior);
    }
    const prep = this._prepared(userId, 'case_battle', fairRoundId, clientSeed);
    if (prep.status !== 'prepared') throw new IdempotencyConflictError('Prepared fair round was already used');
    const cost = sequence.reduce((sum, entry) => sum + entry.price, 0);
    const created = this.db.transaction(() => {
      if (this.stmt.usePrep.run(this.now(), fairRoundId).changes !== 1) throw new IdempotencyConflictError('Prepared fair round was already used');
      const proof = this.fairRng.getProof(fairRoundId);
      const seeds = opponent === 'bot'
        ? battleSeedBundle({ battleId, commitment: proof.commitment, creatorClientSeed: clientSeed })
        : { creatorClientSeed: clientSeed, opponentClientSeed: null, combinedClientSeed: null };
      if (seeds.combinedClientSeed) this.fairRng.bindClientSeed(fairRoundId, clientSeed, seeds.combinedClientSeed);
      const reserved = this.ledger.reserve({
        userId, game: 'case_battle', referenceId: `${battleId}:creator`, stake: cost,
        idempotencyKey: `case-battle:${battleId}:creator:reserve`, metadata: request
      });
      this.stmt.insertBattle.run(
        battleId, userId, opponent, json(request), fairRoundId, json(caseIds), cost, reserved.escrow.escrowId,
        seeds.creatorClientSeed, seeds.opponentClientSeed, seeds.combinedClientSeed, this.now()
      );
      const row = this.stmt.battle.get(battleId);
      return opponent === 'bot' ? this._settleBattleInside(row, 'NEON BOT') : row;
    })();
    if (opponent === 'bot') this._revealBattle(created);
    return this._publicBattle(created);
  }

  joinBattle({ userId, battleId, requestId, clientSeed = 'neon777' }) {
    safe(userId, 'userId', 64); safe(battleId, 'battleId'); safe(requestId, 'requestId', 80); safe(clientSeed, 'clientSeed', 128);
    let battle = this.stmt.battle.get(battleId);
    if (!battle) throw new Error('Battle not found');
    if (battle.creator_id === userId) throw new Error('You cannot join your own battle');
    if (battle.opponent_type !== 'human') throw new Error('This battle is reserved for the bot');
    if (battle.status === 'settled' && battle.opponent_id === userId) return this._publicBattle(battle);
    if (battle.status === 'waiting' && battle.opponent_id) {
      if (battle.opponent_id !== userId) throw new Error('Battle was joined by another player');
      return this._settleBattle(battle, userId);
    }
    if (battle.status !== 'waiting') throw new Error('Battle is no longer open');
    const joinRequest = { battleId, requestId, clientSeed };
    battle = this.db.transaction(() => {
      const current = this.stmt.battle.get(battleId);
      if (!current || current.status !== 'waiting' || current.opponent_id) throw new Error('Battle was joined by another player');
      const creatorClientSeed = current.creator_client_seed || parse(current.request_json, {}).clientSeed;
      const proof = this.fairRng.getProof(current.fair_round_id);
      const seeds = battleSeedBundle({ battleId, commitment: proof.commitment, creatorClientSeed, opponentClientSeed: clientSeed });
      const reserved = this.ledger.reserve({
        userId, game: 'case_battle', referenceId: `${battleId}:opponent`, stake: current.entry_cost,
        idempotencyKey: `case-battle:${battleId}:${userId}:reserve`, metadata: joinRequest
      });
      this.fairRng.bindClientSeed(current.fair_round_id, creatorClientSeed, seeds.combinedClientSeed);
      if (this.stmt.joinBattle.run(
        userId, reserved.escrow.escrowId, seeds.opponentClientSeed, seeds.combinedClientSeed, json(joinRequest), battleId
      ).changes !== 1) throw new Error('Battle was joined by another player');
      return this._settleBattleInside(this.stmt.battle.get(battleId), userId);
    })();
    this._revealBattle(battle);
    return this._publicBattle(battle);
  }

  _settleBattle(row, opponentId) {
    if (row.status === 'settled') return this._publicBattle(row);
    const settled = this.db.transaction(() => this._settleBattleInside(this.stmt.battle.get(row.battle_id), opponentId))();
    this._revealBattle(settled);
    return this._publicBattle(settled);
  }

  _settleBattleInside(row, opponentId) {
    if (!row) throw new Error('Battle not found');
    if (row.status === 'settled') return row;
    const caseIds = parse(row.cases_json, []);
    const sequence = this._caseSequence(caseIds);
    const creatorClientSeed = row.creator_client_seed || parse(row.request_json, {}).clientSeed;
    let seeds = {
      creatorClientSeed,
      opponentClientSeed: row.opponent_client_seed,
      combinedClientSeed: row.combined_client_seed
    };
    if (!seeds.combinedClientSeed) {
      const proof = this.fairRng.getProof(row.fair_round_id);
      seeds = battleSeedBundle({
        battleId: row.battle_id,
        commitment: proof.commitment,
        creatorClientSeed,
        opponentClientSeed: row.opponent_type === 'bot' ? undefined : seedDigest('case-battle-recovery:v1', row.battle_id, opponentId)
      });
      this.fairRng.bindClientSeed(row.fair_round_id, creatorClientSeed, seeds.combinedClientSeed);
    }
    const context = this.fairRng.getContext(row.fair_round_id);
      const tracks = [
        { id: row.creator_id, type: 'player', drops: [] },
        { id: opponentId, type: opponentId === 'NEON BOT' ? 'bot' : 'player', drops: [] }
      ];
      for (let playerIndex = 0; playerIndex < 2; playerIndex += 1) {
        for (let roundIndex = 0; roundIndex < sequence.length; roundIndex += 1) {
          const counter = playerIndex * sequence.length + roundIndex;
          const roll = this.fairRng.int(context, 1_000_000, counter);
          const item = selectItem(sequence[roundIndex], roll);
          tracks[playerIndex].drops.push({ ...item, caseId: sequence[roundIndex].id, caseName: sequence[roundIndex].name, roll, counter });
        }
        tracks[playerIndex].total = tracks[playerIndex].drops.reduce((sum, item) => sum + item.value, 0);
      }
      const winnerIndex = this._battleWinner(context, tracks);
      const winner = tracks[winnerIndex];
      const rounds = sequence.map((entry, index) => ({ caseId: entry.id, caseName: entry.name, drops: tracks.map(track => ({ participantId: track.id, ...track.drops[index] })) }));
      if (winner.type !== 'bot') {
        for (let playerIndex = 0; playerIndex < tracks.length; playerIndex += 1) {
          for (let dropIndex = 0; dropIndex < tracks[playerIndex].drops.length; dropIndex += 1) {
            const item = tracks[playerIndex].drops[dropIndex];
            const inventoryId = identifier('battle-skin', row.battle_id, String(playerIndex), String(dropIndex));
            this.stmt.insertInventory.run(inventoryId, winner.id, item.id, json({ ...item, inventoryId }), 'battle', row.battle_id, tracks[playerIndex].id, this.now());
          }
        }
      }
      const settlements = [{
        escrowId: row.creator_escrow_id, payout: 0,
        idempotencyKey: `case-battle:${row.battle_id}:creator:settle`, metadata: { battleId: row.battle_id, winner: winner.id }
      }];
      if (row.opponent_escrow_id) settlements.push({
        escrowId: row.opponent_escrow_id, payout: 0,
        idempotencyKey: `case-battle:${row.battle_id}:opponent:settle`, metadata: { battleId: row.battle_id, winner: winner.id }
      });
      this.ledger.settleMany(settlements);
      const result = {
        participants: tracks,
        rounds,
        winner: winner.id,
        tieBreak: 'total_value_then_highest_drop_then_round_order_then_fair_coin',
        clientSeeds: seeds
      };
      if (this.stmt.settleBattle.run(json(result), winner.id, this.now(), row.battle_id).changes !== 1) throw new Error('Battle settlement transition failed');
      return this.stmt.battle.get(row.battle_id);
  }

  _revealBattle(row) {
    const result = parse(row.result_json);
    this.fairRng.reveal(row.fair_round_id, {
      type: 'case_battle', battleId: row.battle_id, winner: result.winner, clientSeeds: result.clientSeeds,
      rolls: result.participants.map(participant => participant.drops.map(drop => ({ itemId: drop.id, roll: drop.roll, counter: drop.counter })))
    });
  }

  _battleWinner(context, tracks) {
    if (tracks[0].total !== tracks[1].total) return tracks[0].total > tracks[1].total ? 0 : 1;
    const max = tracks.map(track => Math.max(...track.drops.map(drop => drop.value)));
    if (max[0] !== max[1]) return max[0] > max[1] ? 0 : 1;
    for (let index = 0; index < tracks[0].drops.length; index += 1) {
      if (tracks[0].drops[index].value !== tracks[1].drops[index].value) return tracks[0].drops[index].value > tracks[1].drops[index].value ? 0 : 1;
    }
    return this.fairRng.int(context, 2, 10000);
  }

  cancelBattle({ userId, battleId, requestId }) {
    safe(userId, 'userId', 64); safe(battleId, 'battleId'); safe(requestId, 'requestId', 80);
    let battle = this.stmt.battle.get(battleId);
    if (!battle || battle.creator_id !== userId) throw new Error('Battle not found');
    const request = json({ battleId, userId, requestId });
    if (battle.status === 'cancelled') {
      if (battle.cancel_request_json && battle.cancel_request_json !== request) throw new IdempotencyConflictError('Battle cancellation identifier was already used for a different request');
      return this._publicBattle(battle);
    }
    if (battle.status !== 'waiting' || battle.opponent_id) throw new Error('Battle cannot be cancelled');
    battle = this.db.transaction(() => {
      this.ledger.refund({
        escrowId: battle.creator_escrow_id,
        idempotencyKey: `case-battle:${battleId}:refund`,
        metadata: { battleId, requestId, reason: 'creator_cancelled' }
      });
      if (this.stmt.cancelBattle.run(request, this.now(), battleId).changes !== 1) throw new Error('Battle cancellation transition failed');
      this.stmt.cancelPrep.run(this.now(), battle.fair_round_id);
      return this.stmt.battle.get(battleId);
    })();
    this.fairRng.reveal(battle.fair_round_id, { type: 'case_battle', battleId, cancelled: true });
    return this._publicBattle(battle);
  }

  recoverPendingBattles() {
    const recovered = [];
    for (const row of this.stmt.recoverableBattles.all()) {
      const opponentId = row.opponent_type === 'bot' ? 'NEON BOT' : row.opponent_id;
      if (opponentId) recovered.push(this._settleBattle(row, opponentId));
    }
    return recovered;
  }

  getBattle(battleId) {
    const row = this.stmt.battle.get(safe(battleId, 'battleId'));
    if (!row) throw new Error('Battle not found');
    return this._publicBattle(row);
  }

  listBattles(limit = 40) {
    const bounded = Number.isSafeInteger(limit) ? Math.max(1, Math.min(limit, 100)) : 40;
    return this.stmt.battles.all(bounded).map(row => this._publicBattle(row));
  }

  _publicBattle(row) {
    const result = parse(row.result_json, {});
    let proof = this.fairRng.getProof(row.fair_round_id);
    // Repair the narrow crash window after the authoritative state commits but
    // before the disclosure write. reveal() is idempotent and never changes the
    // already-settled outcome.
    if ((row.status === 'settled' || row.status === 'cancelled') && proof && !proof.serverSeed) {
      if (row.status === 'settled') this._revealBattle(row);
      else this.fairRng.reveal(row.fair_round_id, { type: 'case_battle', battleId: row.battle_id, cancelled: true });
      proof = this.fairRng.getProof(row.fair_round_id);
    }
    const participants = (result.participants || []).map(participant => ({
      ...participant,
      drops: (participant.drops || []).map(canonicalizeItem),
      userId: participant.id
    }));
    return {
      battleId: row.battle_id, creatorId: row.creator_id,
      opponentId: row.opponent_type === 'bot' ? 'NEON BOT' : row.opponent_id,
      opponentType: row.opponent_type, status: row.status,
      caseIds: parse(row.cases_json, []), entryCost: row.entry_cost,
      commitment: proof?.commitment, participants, results: participants, rounds: result.rounds || [],
      winner: row.winner_id, winnerId: row.winner_id, tieBreak: result.tieBreak || null,
      clientSeeds: row.status === 'waiting' ? undefined : (result.clientSeeds || null),
      proof: row.status === 'waiting' ? undefined : proof,
      createdAt: row.created_at, settledAt: row.settled_at
    };
  }
}

module.exports = { CaseGameService, CASE_CATALOG, DROP_TABLE, selectItem };
