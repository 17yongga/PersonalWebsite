'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

test('CS2 portfolio uses escrow state as canonical and sorts both tracks newest first', () => {
  const { buildCS2Portfolio } = require('../cs2-portfolio');
  const bets = [
    { id: 'bet-open', userId: 'gary', status: 'lost', amount: 100, odds: 2, placedAt: '2026-08-28T10:00:00Z' },
    { id: 'bet-won', userId: 'gary', status: 'pending', amount: 50, odds: 3, placedAt: '2026-08-29T10:00:00Z' },
    { id: 'bet-void', userId: 'gary', status: 'pending', amount: 25, odds: 2, placedAt: '2026-08-30T10:00:00Z' }
  ];
  const escrows = [
    { escrowId: 'e-open', userId: 'gary', game: 'cs2betting', referenceId: 'bet-open', stake: 100, status: 'active', payout: null, createdAt: Date.parse('2026-08-28T10:00:00Z') },
    { escrowId: 'e-won', userId: 'gary', game: 'cs2betting', referenceId: 'bet-won', stake: 50, status: 'settled', payout: 150, updatedAt: Date.parse('2026-08-29T12:00:00Z') },
    { escrowId: 'e-void', userId: 'gary', game: 'cs2betting', referenceId: 'bet-void', stake: 25, status: 'refunded', payout: 25, updatedAt: Date.parse('2026-08-30T12:00:00Z') }
  ];
  const result = buildCS2Portfolio({ userId: 'gary', bets, escrows, events: {}, now: Date.parse('2026-08-30T14:00:00Z') });
  assert.deepEqual(result.openBets.map(b => [b.id, b.status]), [['bet-open', 'pending']]);
  assert.deepEqual(result.history.map(b => [b.id, b.status]), [['bet-void', 'void'], ['bet-won', 'won']]);
  assert.equal(result.summary.openCount, 1);
  assert.equal(result.summary.historyCount, 2);
  assert.equal(result.summary.openStake, 100);
  assert.equal(result.summary.potentialReturn, 200);
  assert.equal(result.integrity.state, 'ok');
  assert.match(result.revision, /^[a-f0-9]{16}$/);
});

test('CS2 portfolio fails visibly on orphan or mismatched monetary records', () => {
  const { buildCS2Portfolio } = require('../cs2-portfolio');
  const result = buildCS2Portfolio({
    userId: 'gary',
    bets: [{ id: 'missing-escrow', userId: 'gary', status: 'pending', amount: 10, odds: 2, placedAt: '2026-08-30T10:00:00Z' }],
    escrows: [{ escrowId: 'orphan', userId: 'gary', game: 'cs2betting', referenceId: 'missing-wager', stake: 12, status: 'active', metadata: { wagerType: 'parlay' }, createdAt: Date.parse('2026-08-30T11:00:00Z') }],
    events: {},
    now: Date.parse('2026-08-30T14:00:00Z')
  });
  assert.equal(result.integrity.state, 'error');
  assert.deepEqual(new Set(result.integrity.issues.map(issue => issue.code)), new Set(['wager_missing_escrow', 'escrow_missing_wager']));
  assert.equal(result.openBets.length, 1, 'canonical orphan escrow remains visible rather than becoming a false zero');
  assert.equal(result.openBets[0].integrityStatus, 'unavailable');
  assert.equal(result.summary.openStake, 12);
});

test('settled pre-ledger wagers remain visible as legacy history without weakening open-wager integrity', () => {
  const { buildCS2Portfolio } = require('../cs2-portfolio');
  const result = buildCS2Portfolio({
    userId: 'legacy-user',
    bets: [{
      id: 'legacy-won-1',
      userId: 'legacy-user',
      type: 'single',
      status: 'won',
      amount: 25,
      odds: 2,
      potentialPayout: 50,
      eventId: 'event-1',
      selection: 'team1',
      createdAt: '2026-08-01T12:00:00.000Z',
      settledAt: '2026-08-01T14:00:00.000Z'
    }],
    escrows: [],
    events: { 'event-1': { id: 'event-1', homeTeam: 'Vitality', awayTeam: 'Spirit' } }
  });

  assert.equal(result.integrity.ok, true);
  assert.equal(result.openBets.length, 0);
  assert.equal(result.history.length, 1);
  assert.equal(result.history[0].status, 'won');
  assert.equal(result.history[0].integrityStatus, 'legacy');
});

test('CS2 portfolio client suppresses unchanged payloads and coalesces refreshes', () => {
  const client = read('cs2-betting-modern.js');
  assert.match(client, /eventPayloadRevision/);
  assert.match(client, /if \(revision === this\.eventPayloadRevision\) return false/);
  assert.match(client, /eventRefreshPromise/);
  assert.match(client, /portfolioRefreshPromise/);
  assert.match(client, /document\.visibilityState === 'hidden'/);
  assert.match(client, /visibilitychange/);
  assert.match(client, /data-tournament-key/);
  assert.match(client, /replaceChildren\(fragment\)/);
  assert.doesNotMatch(client, /attachEventCardListeners\(\);/);
});

test('CS2 portfolio exposes explicit states and canonical tabs', () => {
  const client = read('cs2-betting-modern.js');
  assert.match(client, /const BET_TABS = Object\.freeze\(\{ OPEN: 'open', HISTORY: 'history' \}\)/);
  assert.match(client, /portfolioState = 'loading'/);
  assert.match(client, /'refreshing'/);
  assert.match(client, /'stale'/);
  assert.match(client, /'integrity'/);
  assert.match(client, /data\.openBets/);
  assert.match(client, /data\.history/);
  assert.match(client, /data\.summary/);
});

test('mobile CS2 hot surfaces avoid fixed noise, blur and transition-all work', () => {
  const css = read('cs2-modern-betting-ui.css');
  const finalMobile = css.slice(css.lastIndexOf('@media (max-width: 768px)'));
  assert.match(finalMobile, /\.cs2-betting-container::before\s*\{[^}]*display:\s*none/s);
  assert.match(finalMobile, /backdrop-filter:\s*none/);
  assert.match(finalMobile, /\.cs2-event-card[^}]*transition:\s*transform[^;]*,\s*opacity/s);
  assert.doesNotMatch(finalMobile, /transition:\s*all/);
});

test('release package includes the CS2 portfolio authority module', () => {
  const build = read('scripts/build-casino-release.js');
  assert.match(build, /'cs2-portfolio\.js'/);
});
