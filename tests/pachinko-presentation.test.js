'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'games', 'pachinko-casino.js'), 'utf8');

function loadPachinko({ elements = {}, controls = [], timers = [] } = {}) {
  const sandbox = {
    window: {
      innerWidth: 1200,
      devicePixelRatio: 1,
      addEventListener() {},
      removeEventListener() {},
      casinoSound: { play() {}, playOnce() {} }
    },
    document: {
      getElementById: id => elements[id] || null,
      querySelectorAll: () => controls
    },
    globalThis: { crypto: { randomUUID: () => `pachinko-test-${Math.random()}` } },
    Math,
    performance: { now: () => 1000 },
    console,
    requestAnimationFrame: () => 1,
    cancelAnimationFrame() {},
    setTimeout: callback => { timers.push(callback); return timers.length; },
    clearTimeout() {},
    setInterval,
    clearInterval
  };
  vm.runInNewContext(source, sandbox);
  return sandbox.window.PachinkoGame;
}

function blankGame(PachinkoGame, casino) {
  const game = Object.create(PachinkoGame.prototype);
  Object.assign(game, {
    casino,
    W: 500,
    H: 700,
    ROWS: 16,
    risk: 'medium',
    betAmount: 100,
    ballCount: 1,
    balls: [],
    pegs: [],
    slots: [],
    results: [],
    dropTimers: [],
    pendingBatches: new Map(),
    latestAuthoritativeBalance: null,
    unresolvedPayout: 0,
    queuedBallCount: 0,
    dropRequestChain: Promise.resolve(),
    _destroyed: false,
    animFrame: null
  });
  game.setupBoard();
  return game;
}

function confirmLanding(game, ball) {
  game.resolveBall(ball, game.slots[ball.serverResult.slotIndex], 'test-landing');
  assert.ok(ball.landingHoldFrames > 0, 'ball visibly holds inside its multiplier slot');
  while (ball.landingHoldFrames > 0) game.update();
}

test('Pachinko confirms balance only after the ball visibly holds inside the authoritative slot', () => {
  const button = { disabled: false };
  const PachinkoGame = loadPachinko({ elements: { pachDropBtn: button } });
  const balanceUpdates = [];
  const game = blankGame(PachinkoGame, { setCredits: value => balanceUpdates.push(value) });

  game.pendingBatches.set('geometry-batch', { remaining: 1, payout: 350 });
  game.latestAuthoritativeBalance = 1250;
  game.unresolvedPayout = 350;
  const targetIndex = 14;
  const target = game.slots[targetIndex];
  const ball = {
    x: game.W / 2,
    y: game.H * 0.02,
    vx: -0.5,
    vy: 1,
    r: 5,
    active: true,
    trail: [],
    hue: 50,
    bet: 100,
    stuckFrames: 0,
    lastY: 0,
    pegSoundAt: Object.create(null),
    guidePhase: 0.25,
    batchId: 'geometry-batch',
    serverResult: { slotIndex: targetIndex, multiplier: target.multiplier, payout: 350 },
    soundKey: 'geometry',
    targetX: target.x + target.w / 2
  };
  game.balls.push(ball);

  for (let step = 0; step < 1200 && ball.active; step += 1) game.update();

  assert.equal(ball.active, false, `unfinished trajectory: ${JSON.stringify({ x: ball.x, y: ball.y, vx: ball.vx, vy: ball.vy, stuckFrames: ball.stuckFrames, landing: ball.landing })}`);
  assert.equal(ball.landedSlot, target);
  assert.ok(game.isBallAlignedForSlot(ball, target), 'landed ball remains horizontally inside its authoritative slot');
  assert.ok(ball.y >= target.y && ball.y <= target.y + target.h, 'landed ball remains visibly inside its slot');
  assert.ok(ball.landingHoldFrames > 0, 'landed ball remains visible before confirmation');
  assert.deepEqual(balanceUpdates, [], 'slot arrival alone cannot reveal the final balance');

  while (ball.landingHoldFrames > 0) game.update();
  assert.deepEqual(balanceUpdates, [1250], 'final balance reveals after the visible confirmation hold');
});

test('Pachinko keeps Drop enabled while locking settings for consecutive submissions', async () => {
  const timers = [];
  const input = { value: '100', disabled: false };
  const button = { disabled: false, dataset: {}, textContent: 'Drop!' };
  const controls = Array.from({ length: 5 }, () => ({ disabled: false }));
  const elements = { pachBet: input, pachDropBtn: button, pachResults: { textContent: '', dataset: {}, setAttribute() {} } };
  const PachinkoGame = loadPachinko({ elements, controls, timers });
  const balanceUpdates = [];
  const casino = {
    credits: 1000,
    setCredits(value) { balanceUpdates.push(value); this.credits = value; },
    async apiFetch() {
      return {
        ok: true,
        async json() {
          return { balance: 1200, payout: 300, results: [{ slotIndex: 3, multiplier: 3, payout: 300 }] };
        }
      };
    }
  };
  const game = blankGame(PachinkoGame, casino);

  await game.dropBalls();

  assert.deepEqual(balanceUpdates, [900], 'accepted wager debit is visible, final result remains hidden');
  assert.equal(button.disabled, false, 'Drop remains available for consecutive submissions');
  assert.equal(input.disabled, true);
  assert.ok(controls.every(control => control.disabled));

  timers.shift()();
  const ball = game.balls[0];
  game.resolveBall(ball, game.slots[ball.serverResult.slotIndex], 'test-landing');
  assert.deepEqual(balanceUpdates, [900], 'slot entry does not reveal the final result');
  while (ball.landingHoldFrames > 0) game.update();

  assert.deepEqual(balanceUpdates, [900, 1200]);
  assert.equal(input.disabled, false);
  assert.ok(controls.every(control => !control.disabled));
});

test('Pachinko serializes two rapid requests and never leaks unresolved payouts', async () => {
  const timers = [];
  const input = { value: '100', disabled: false };
  const button = { disabled: false, dataset: {}, textContent: 'Drop!' };
  const controls = Array.from({ length: 5 }, () => ({ disabled: false }));
  const elements = { pachBet: input, pachDropBtn: button, pachResults: { textContent: '', dataset: {}, setAttribute() {} } };
  const PachinkoGame = loadPachinko({ elements, controls, timers });
  const balanceUpdates = [];
  let inFlight = 0;
  let maxInFlight = 0;
  let call = 0;
  const responses = [
    { balance: 1200, payout: 300, results: [{ slotIndex: 3, multiplier: 3, payout: 300 }] },
    { balance: 1280, payout: 180, results: [{ slotIndex: 4, multiplier: 1.8, payout: 180 }] }
  ];
  const casino = {
    credits: 1000,
    setCredits(value) { balanceUpdates.push(value); this.credits = value; },
    async apiFetch() {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      const payload = responses[call++];
      await Promise.resolve();
      inFlight -= 1;
      return { ok: true, async json() { return payload; } };
    }
  };
  const game = blankGame(PachinkoGame, casino);

  const first = game.dropBalls();
  const second = game.dropBalls();
  await Promise.all([first, second]);

  assert.equal(call, 2);
  assert.equal(maxInFlight, 1, 'authoritative drop requests are settled in click order');
  assert.deepEqual(balanceUpdates, [900, 800], 'later balances subtract every unresolved authoritative payout');
  assert.equal(button.disabled, false);

  timers.shift()();
  timers.shift()();
  const [firstBall, secondBall] = game.balls;
  confirmLanding(game, firstBall);
  assert.deepEqual(balanceUpdates, [900, 800, 1100], 'first payout reveals only after its own ball confirms');
  confirmLanding(game, secondBall);
  assert.deepEqual(balanceUpdates, [900, 800, 1100, 1280]);
});

test('Pachinko peg collision separates overlap without reflecting a departing ball back into the pin', () => {
  const PachinkoGame = loadPachinko();
  const game = blankGame(PachinkoGame, { setCredits() {} });
  const peg = { x: 250, y: 250, r: 3, glow: 0 };
  game.pegs = [peg];
  const ball = {
    x: 250,
    y: 256,
    vx: 0.2,
    vy: 1,
    r: 5,
    active: true,
    trail: [],
    hue: 50,
    stuckFrames: 0,
    lastY: 250,
    serverResult: null
  };
  game.balls.push(ball);

  game.update();

  const distance = Math.hypot(ball.x - peg.x, ball.y - peg.y);
  assert.ok(distance >= ball.r + peg.r - 1e-9, 'ball is separated from the peg surface');
  assert.ok(ball.vy > 0.8, 'departing downward velocity is not reflected back into the peg');
});

test('Pachinko final slot entry never changes horizontal position', () => {
  const PachinkoGame = loadPachinko();
  const game = blankGame(PachinkoGame, { setCredits() {} });
  const slot = game.slots[12];
  const entryX = slot.x + slot.w * 0.3;
  const ball = {
    x: entryX,
    y: slot.y - 20,
    vx: 0.4,
    vy: 2,
    r: 5,
    active: true,
    trail: [],
    landing: { startX: entryX, startY: slot.y - 20, progress: 0 },
    serverResult: { slotIndex: 12, multiplier: slot.multiplier, payout: 180 }
  };

  for (let frame = 0; frame < 18; frame += 1) {
    game.advanceLanding(ball, slot);
    assert.equal(ball.x, entryX, 'confirmation descent is vertical, not a horizontal correction');
  }
});

test('Pachinko all authoritative results align through the peg field before entering a slot', () => {
  const PachinkoGame = loadPachinko();
  for (const targetIndex of Array.from({ length: 17 }, (_, index) => index)) {
    const game = blankGame(PachinkoGame, { setCredits() {} });
    const slot = game.slots[targetIndex];
    const ball = {
      x: game.W / 2,
      y: game.H * 0.02,
      vx: targetIndex === 0 ? -0.2 : 0.2,
      vy: 0,
      r: 5,
      active: true,
      trail: [],
      hue: 50,
      bet: 100,
      stuckFrames: 0,
      lastY: 0,
      pegSoundAt: Object.create(null),
      guidePhase: targetIndex === 0 ? 0.25 : 0.75,
      serverResult: { slotIndex: targetIndex, multiplier: slot.multiplier, payout: Math.round(100 * slot.multiplier * 1000) / 1000 },
      soundKey: `edge-${targetIndex}`,
      targetX: slot.x + slot.w / 2
    };
    game.balls.push(ball);
    let landingEntryX = null;
    let maxHorizontalStep = 0;
    let previousX = ball.x;
    for (let frame = 0; frame < 1200 && ball.active; frame += 1) {
      game.update();
      maxHorizontalStep = Math.max(maxHorizontalStep, Math.abs(ball.x - previousX));
      previousX = ball.x;
      if (ball.landing && landingEntryX === null) landingEntryX = ball.landing.startX;
    }

    assert.equal(ball.active, false, `edge slot ${targetIndex} completes`);
    assert.equal(ball.slotType, 'server-settled', `edge slot ${targetIndex} does not use escape settlement`);
    assert.ok(landingEntryX >= slot.x + ball.r && landingEntryX <= slot.x + slot.w - ball.r,
      `edge slot ${targetIndex} is horizontally aligned before landing`);
    assert.ok(maxHorizontalStep < slot.w * 0.65,
      `edge slot ${targetIndex} has no bottom horizontal snap`);
  }
});

test('Pachinko builds varied row decisions that still encode the authoritative slot', () => {
  const PachinkoGame = loadPachinko();
  const game = blankGame(PachinkoGame, { setCredits() {} });
  const values = [0.91, 0.13, 0.72, 0.34, 0.55, 0.02, 0.81, 0.27, 0.63, 0.44, 0.18, 0.76, 0.49, 0.07, 0.96, 0.39];
  let cursor = 0;
  const route = game.createAuthoritativeRoute(6, () => values[cursor++ % values.length]);
  assert.equal(route.length, game.ROWS);
  assert.equal(route.filter(direction => direction > 0).length, 6);
  assert.equal(route.filter(direction => direction < 0).length, game.ROWS - 6);
  assert.ok(new Set(route).size > 1, 'a middle lane visibly alternates left and right decisions');
});

test('Pachinko peg rows expand from the centre at one stable horizontal pitch', () => {
  const PachinkoGame = loadPachinko();
  const game = blankGame(PachinkoGame, { setCredits() {} });
  const rows = Array.from({ length: game.ROWS }, (_, row) => game.pegs.filter(peg => peg.id.startsWith(`${row}:`)));
  const firstPitch = rows[0][1].x - rows[0][0].x;
  rows.forEach((pegs, row) => {
    assert.equal(pegs.length, row + 3);
    for (let index = 1; index < pegs.length; index += 1) {
      assert.ok(Math.abs((pegs[index].x - pegs[index - 1].x) - firstPitch) < 1e-9);
    }
    assert.ok(Math.abs((pegs[0].x + pegs.at(-1).x) / 2 - game.W / 2) < 1e-9);
  });
});

test('Pachinko rejection creates no visual ball or speculative balance change', async () => {
  const timers = [];
  const input = { value: '100', disabled: false };
  const button = { disabled: false, dataset: {} };
  const controls = Array.from({ length: 3 }, () => ({ disabled: false }));
  const status = { textContent: '', dataset: {}, setAttribute() {} };
  const PachinkoGame = loadPachinko({
    elements: { pachBet: input, pachDropBtn: button, pachResults: status },
    controls,
    timers
  });
  const balanceUpdates = [];
  const game = blankGame(PachinkoGame, {
    credits: 1000,
    setCredits: value => balanceUpdates.push(value),
    async apiFetch() {
      return { ok: false, async json() { return { error: 'Wager rejected' }; } };
    }
  });

  await game.dropBalls();

  assert.equal(status.textContent, 'Wager rejected');
  assert.deepEqual(balanceUpdates, []);
  assert.equal(game.balls.length, 0);
  assert.equal(timers.length, 0);
  assert.equal(game.pendingBatches.size, 0);
  assert.equal(button.disabled, false);
  assert.equal(input.disabled, false);
  assert.ok(controls.every(control => !control.disabled));
});

test('Pachinko flushes the latest committed authoritative balance when the view is destroyed', () => {
  const PachinkoGame = loadPachinko();
  const balanceUpdates = [];
  const game = blankGame(PachinkoGame, { setCredits: value => balanceUpdates.push(value) });
  game.latestAuthoritativeBalance = 777;
  game.pendingBatches.set('pending', { remaining: 1, payout: 100 });
  game.destroy();
  assert.deepEqual(balanceUpdates, [777]);
  assert.equal(game.latestAuthoritativeBalance, null);
  assert.equal(game.pendingBatches.size, 0);
});

test('Pachinko renders the exact server-authored fractional payout', () => {
  const resultsElement = { innerHTML: '' };
  const PachinkoGame = loadPachinko({ elements: { pachResults: resultsElement } });
  const game = blankGame(PachinkoGame, { setCredits() {} });
  const slot = game.slots[8];
  const ball = {
    active: true,
    x: slot.x + slot.w / 2,
    y: slot.y,
    r: 5,
    bet: 1,
    trail: [],
    serverResult: { slotIndex: 8, multiplier: 0.28, payout: 0.28 },
    soundKey: 'fractional-payout'
  };

  game.resolveBall(ball, slot, 'server-settled');
  assert.equal(game.results[0].winnings, 0.28);
  assert.match(resultsElement.innerHTML, />0\.28<\/span>/, 'positive fractional payout is never displayed as zero');
});
