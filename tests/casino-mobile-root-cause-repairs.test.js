'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

function loadGame(file, exportName, overrides = {}) {
  const sandbox = {
    window: {
      innerWidth: 390,
      devicePixelRatio: 1,
      addEventListener() {},
      removeEventListener() {},
      casinoSound: { play() {}, playOnce() {} },
      ...overrides.window
    },
    document: overrides.document || { getElementById: () => null },
    globalThis: { crypto: { randomUUID: () => 'test-request' } },
    console,
    Math,
    performance: { now: () => 1000 },
    requestAnimationFrame: callback => { callback(1000); return 1; },
    cancelAnimationFrame() {},
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    ...overrides.globals
  };
  vm.runInNewContext(read(file), sandbox);
  return { Game: sandbox.window[exportName], sandbox };
}

test('Roulette renders newest-first history and mobile information priority', () => {
  const historyElement = { innerHTML: '' };
  const { Game } = loadGame('games/roulette-casino.js', 'RouletteGame', {
    document: { getElementById: id => id === 'rlHistory' ? historyElement : null }
  });
  const game = Object.create(Game.prototype);
  game.history = [
    { number: 14, color: 'black' },
    { number: 7, color: 'red' },
    { number: 0, color: 'green' }
  ];
  game.updateHistoryDisplay();
  const displayed = [...historyElement.innerHTML.matchAll(/title="(\d+) \(/g)].map(match => Number(match[1]));
  assert.deepEqual(displayed, [14, 7, 0]);

  const source = read('games/roulette-casino.js');
  const css = read('games/premium-games.css');
  assert.match(source, /rl-history-panel[\s\S]*Latest Results/);
  assert.match(css, /@media \(max-width:768px\)[\s\S]*\.rl-history-panel\s*\{[^}]*order:\s*1/);
  assert.match(css, /@media \(max-width:768px\)[\s\S]*\.rl-bet-panel\s*\{[^}]*order:\s*3/);
  assert.match(css, /@media \(max-width:768px\)[\s\S]*\.rl-quick-row\s*\{[^}]*grid-template-columns:\s*repeat\(5,minmax\(44px,1fr\)\)/);
});

test('Crash uses stable capped DPR/aspect metrics and avoids redundant allocations', () => {
  for (const [deviceDpr, expectedDpr] of [[1, 1], [2, 2], [3, 2]]) {
    const { Game, sandbox } = loadGame('games/crash-casino.js', 'CrashGame', { window: { devicePixelRatio: deviceDpr } });
    const game = Object.create(Game.prototype);
    game.renderDpr = Game.getRenderDpr(deviceDpr);
    game.canvasAspect = Game.CANVAS_ASPECT;
    game.canvasMetrics = null;
    let widthWrites = 0;
    let heightWrites = 0;
    const canvas = { parentElement: { clientWidth: 500 }, style: {} };
    Object.defineProperty(canvas, 'width', { get: () => 500 * expectedDpr, set: () => { widthWrites += 1; } });
    Object.defineProperty(canvas, 'height', { get: () => 260 * expectedDpr, set: () => { heightWrites += 1; } });
    game.canvas = canvas;
    game.ctx = { setTransform() {} };
    game.drawFrame = () => {};

    assert.equal(game.resizeCanvas(), true);
    assert.equal(game.canvasMetrics.width, 500);
    assert.equal(game.canvasMetrics.height, 260);
    assert.equal(game.canvasMetrics.dpr, expectedDpr);
    assert.equal(widthWrites, 1);
    assert.equal(heightWrites, 1);
    assert.equal(game.resizeCanvas(), false);
    assert.equal(widthWrites, 1, 'same geometry does not reallocate canvas width');
    assert.equal(heightWrites, 1, 'same geometry does not reallocate canvas height');

    if (deviceDpr === 1) {
      sandbox.window.devicePixelRatio = 2;
      assert.equal(game.resizeCanvas(), true, 'DPR-only browser zoom reallocates the backing store');
      assert.equal(game.canvasMetrics.dpr, 2);
      assert.equal(game.renderDpr, 2);
      assert.equal(widthWrites, 2);
      assert.equal(heightWrites, 2);
    }
  }

  const source = read('games/crash-casino.js');
  assert.match(source, /new ResizeObserver/);
  assert.match(source, /this\.resizeObserver\.disconnect\(\)/);
  assert.match(source, /this\.canvasMetrics\?\.dpr \|\| this\.renderDpr/);
  assert.doesNotMatch(source, /c\.width \/ \(window\.devicePixelRatio/);
});

function blankPachinko(Game) {
  const game = Object.create(Game.prototype);
  Object.assign(game, {
    casino: { setCredits() {} }, W: 500, H: 700, ROWS: 16, risk: 'medium',
    balls: [], pegs: [], pegRows: [], slots: [], results: [], pendingBatches: new Map(),
    queuedBallCount: 0, unresolvedPayout: 0, latestAuthoritativeBalance: null, _destroyed: false
  });
  game.setupBoard();
  return game;
}

test('Pachinko locks lane and horizontal position after terminal gate for all 17 slots', () => {
  const { Game } = loadGame('games/pachinko-casino.js', 'PachinkoGame');
  for (let slotIndex = 0; slotIndex < 17; slotIndex += 1) {
    const game = blankPachinko(Game);
    const slot = game.slots[slotIndex];
    const ball = {
      x: game.W / 2, y: game.H * 0.04, vx: 0, vy: 0, r: 5, active: true,
      phase: 'peg-field', trail: [], hue: 50, bet: 100, stuckFrames: 0, lastY: 0,
      pegSoundAt: Object.create(null), guidePhase: 0.5,
      routeDecisions: game.createAuthoritativeRoute(slotIndex, () => 0.5),
      serverResult: { slotIndex, multiplier: slot.multiplier, payout: slot.multiplier * 100 },
      soundKey: `slot-${slotIndex}`, targetX: slot.x + slot.w / 2
    };
    game.balls.push(ball);
    let crossedGate = false;
    let lockedX = null;
    let lockedLane = null;
    let horizontalAfterGate = 0;
    let previousX = ball.x;
    for (let frame = 0; frame < 1600 && ball.active; frame += 1) {
      game.update();
      if (ball.y >= game.boardMetrics.terminalGateY || ball.phase === 'terminal-drop' || ball.phase === 'landed') {
        if (!crossedGate) {
          crossedGate = true;
          lockedX = ball.x;
          lockedLane = ball.laneIndex;
        } else {
          horizontalAfterGate += Math.abs(ball.x - previousX);
          assert.equal(ball.laneIndex, lockedLane, `slot ${slotIndex} lane stays locked`);
        }
      }
      previousX = ball.x;
    }
    assert.equal(ball.active, false, `slot ${slotIndex} lands`);
    assert.equal(lockedLane, slotIndex, `slot ${slotIndex} locks authoritative lane`);
    assert.ok(horizontalAfterGate < 1e-9, `slot ${slotIndex} terminal descent is vertical (${horizontalAfterGate})`);
    assert.ok(Math.abs(ball.x - lockedX) < 1e-9, `slot ${slotIndex} keeps locked x`);
    assert.equal(ball.slotType, 'server-settled');
  }

  const source = read('games/pachinko-casino.js');
  assert.doesNotMatch(source, /rim rebound|targetSlot\.y - ball\.r \* 2[\s\S]{0,180}ball\.vx \+=/);
});
