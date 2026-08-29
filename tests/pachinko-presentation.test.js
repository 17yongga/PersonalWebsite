'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'games', 'pachinko-casino.js'), 'utf8');

function loadPachinko({ timers = [] } = {}) {
  const sandbox = {
    window: {
      devicePixelRatio: 1,
      addEventListener() {},
      removeEventListener() {},
      casinoSound: { play() {}, playOnce() {} }
    },
    document: { hidden: false, addEventListener() {}, removeEventListener() {} },
    globalThis: { crypto: { randomUUID: () => 'fixture-id' } },
    Math,
    performance: { now: () => 1000 },
    console: { log() {}, error() {}, warn() {} },
    requestAnimationFrame: () => 1,
    cancelAnimationFrame() {},
    setTimeout: callback => { timers.push(callback); return timers.length; },
    clearTimeout() {}
  };
  vm.runInNewContext(source, sandbox);
  return sandbox.window.PachinkoGame;
}

function blankGame(Game, casino = {}) {
  const game = Object.create(Game.prototype);
  const geometry = Game.createGeometry(390, 'medium');
  const controls = Array.from({ length: 8 }, () => ({ disabled: false }));
  Object.assign(game, {
    casino: { credits: 1000, setCredits() {}, ...casino },
    risk: 'medium',
    ballCount: 1,
    betAmount: 100,
    W: geometry.width,
    H: geometry.height,
    ROWS: geometry.rows,
    geometry,
    pegs: geometry.pegs,
    slots: geometry.slots,
    balls: [],
    results: [],
    activeSlotGlows: new Map(),
    pendingBatches: new Map(),
    latestAuthoritativeBalance: null,
    unresolvedPayout: 0,
    queuedBallCount: 0,
    dropRequestChain: Promise.resolve(),
    maxOutstandingBalls: 25,
    presentationGeneration: 1,
    timerHandles: new Set(),
    _destroyed: false,
    animFrame: null,
    resizeFrame: null,
    resizeObserver: null,
    betInput: { value: '100', disabled: false },
    dropButton: { disabled: false, dataset: {} },
    resultsElement: {
      innerHTML: '', dataset: {},
      querySelector(selector) {
        if (selector !== '.pachinko-status-error') return null;
        return { set textContent(value) { this.owner.innerHTML = value; }, owner: this };
      }
    },
    root: { querySelector: () => null, querySelectorAll: () => controls },
    controls
  });
  return game;
}

function validResponse(game, { balance = 1200, payout = 300, slotIndex = 3 } = {}) {
  return {
    ok: true,
    async json() {
      return {
        balance,
        payout,
        results: [{ slotIndex, multiplier: game.slots[slotIndex].multiplier, payout }]
      };
    }
  };
}

test('Pachinko keeps authoritative payout hidden until the landed-ball hold completes', async () => {
  const timers = [];
  const Game = loadPachinko({ timers });
  const balanceUpdates = [];
  const game = blankGame(Game, {
    setCredits: value => balanceUpdates.push(value),
    apiFetch: async () => validResponse(game)
  });

  assert.equal(await game.submitDrop({ bet: 100, risk: 'medium', count: 1, requestId: 'drop-a' }), true);
  assert.deepEqual(balanceUpdates, [900], 'accepted debit is visible while payout remains deferred');
  assert.equal(timers.length, 1);

  timers.shift()();
  const ball = game.balls[0];
  game.updatePresentation(ball.startedAt + ball.path.duration);
  assert.equal(ball.active, false);
  assert.equal(ball.x, game.geometry.slotCenters[ball.serverResult.slotIndex]);
  assert.deepEqual(balanceUpdates, [900], 'landing alone cannot reveal the final balance');

  game.updatePresentation(ball.confirmAt);
  assert.deepEqual(balanceUpdates, [900, 1200]);
  assert.equal(game.pendingBatches.size, 0);
});

test('terminal path sampling never changes x after the final peg row', () => {
  const Game = loadPachinko();
  const game = blankGame(Game);
  for (let slotIndex = 0; slotIndex < 17; slotIndex += 1) {
    const path = Game.planPresentationPath(game.geometry, slotIndex, 100 + slotIndex);
    const lockedX = path.points[path.terminalLockIndex].x;
    const lockTime = path.points[path.terminalLockIndex].t;
    for (let elapsed = lockTime; elapsed <= path.duration; elapsed += 17) {
      assert.equal(game.samplePath(path, elapsed).x, lockedX);
    }
    assert.equal(game.samplePath(path, path.duration).x, lockedX);
  }
});

test('malformed or rejected settlements create no ball and no speculative balance mutation', async () => {
  const Game = loadPachinko();
  const balanceUpdates = [];
  const game = blankGame(Game, {
    setCredits: value => balanceUpdates.push(value),
    apiFetch: async () => ({ ok: true, async json() { return { balance: 900, payout: 999, results: [] }; } })
  });
  assert.equal(await game.submitDrop({ bet: 100, risk: 'medium', count: 1, requestId: 'bad' }), false);
  assert.deepEqual(balanceUpdates, []);
  assert.equal(game.balls.length, 0);
  assert.equal(game.pendingBatches.size, 0);
  assert.match(game.resultsElement.innerHTML, /Invalid Pachinko settlement response/);
});

test('generation-owned delayed launches cannot revive an obsolete view', async () => {
  const timers = [];
  const Game = loadPachinko({ timers });
  const game = blankGame(Game, { apiFetch: async () => validResponse(game) });
  await game.submitDrop({ bet: 100, risk: 'medium', count: 1, requestId: 'stale' });
  assert.equal(timers.length, 1);
  game.presentationGeneration += 1;
  timers.shift()();
  assert.equal(game.balls.length, 0);
});

test('destroy cancels owned work and reveals the latest committed authoritative balance', () => {
  const Game = loadPachinko();
  const balanceUpdates = [];
  const game = blankGame(Game, { setCredits: value => balanceUpdates.push(value) });
  game.latestAuthoritativeBalance = 777.28;
  game.unresolvedPayout = 25;
  game.pendingBatches.set('pending', { remaining: 1, payout: 25 });
  game.timerHandles.add(123);
  game.destroy();
  assert.deepEqual(balanceUpdates, [777.28]);
  assert.equal(game.pendingBatches.size, 0);
  assert.equal(game.timerHandles.size, 0);
  assert.equal(game._destroyed, true);
});

test('results render the exact server-authored fractional payout newest first', () => {
  const Game = loadPachinko();
  const game = blankGame(Game);
  game.results = [
    { multiplier: 0.28, winnings: 0.28, bet: 1 },
    { multiplier: 3, winnings: 300, bet: 100 }
  ];
  game.renderResults();
  assert.match(game.resultsElement.innerHTML, /0\.28×[\s\S]*0\.28 credits/);
  assert.ok(game.resultsElement.innerHTML.indexOf('0.28×') < game.resultsElement.innerHTML.indexOf('3×'));
});
