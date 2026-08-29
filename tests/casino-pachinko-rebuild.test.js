'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'games', 'pachinko-casino.js'), 'utf8');
const css = fs.readFileSync(path.join(root, 'games', 'premium-games.css'), 'utf8');

function loadGame() {
  const sandbox = {
    window: {},
    document: {},
    globalThis: { crypto: { randomUUID: () => 'fixture-id' } },
    Math,
    performance: { now: () => 0 },
    console,
    requestAnimationFrame: () => 1,
    cancelAnimationFrame() {},
    setTimeout,
    clearTimeout
  };
  vm.runInNewContext(source, sandbox);
  return sandbox.window.PachinkoGame;
}

test('Pachinko rebuild exposes pure normalized geometry and deterministic path planning', () => {
  const Game = loadGame();
  assert.equal(typeof Game.createGeometry, 'function');
  assert.equal(typeof Game.planPresentationPath, 'function');

  const geometry = Game.createGeometry(390, 'medium');
  assert.equal(geometry.rows, 16);
  assert.equal(geometry.slots.length, 17);
  assert.equal(geometry.slotCenters.length, 17);
  assert.ok(geometry.height > geometry.width * 0.9 && geometry.height < geometry.width * 1.1);
});

test('every authoritative slot has bounded downward paths with an immutable terminal x', () => {
  const Game = loadGame();
  for (const width of [320, 390, 760]) {
    const geometry = Game.createGeometry(width, 'high');
    for (let slotIndex = 0; slotIndex < 17; slotIndex += 1) {
      for (const seed of [1, 17, 98123]) {
        const path = Game.planPresentationPath(geometry, slotIndex, seed);
        assert.ok(path.points.length >= geometry.rows + 3);
        assert.equal(path.slotIndex, slotIndex);
        assert.equal(path.points.at(-1).x, geometry.slotCenters[slotIndex]);
        assert.ok(path.terminalLockIndex > geometry.rows - 2);

        let previous = path.points[0];
        for (const point of path.points.slice(1)) {
          assert.ok(Number.isFinite(point.x) && Number.isFinite(point.y) && Number.isFinite(point.t));
          assert.ok(point.y >= previous.y, `slot ${slotIndex} moves downward`);
          assert.ok(point.t > previous.t, `slot ${slotIndex} time increases`);
          assert.ok(point.x >= geometry.boardLeft && point.x <= geometry.boardRight);
          assert.ok(Math.abs(point.x - previous.x) <= geometry.slotWidth * 0.8,
            `slot ${slotIndex} has no horizontal teleport`);
          previous = point;
        }

        const terminalX = path.points[path.terminalLockIndex].x;
        for (const point of path.points.slice(path.terminalLockIndex)) {
          assert.equal(point.x, terminalX, `slot ${slotIndex} cannot move horizontally below the final peg row`);
        }
      }
    }
  }
});

test('the same seed reproduces the same route while different seeds vary middle lanes', () => {
  const Game = loadGame();
  const geometry = Game.createGeometry(390, 'medium');
  const first = Game.planPresentationPath(geometry, 7, 42);
  const replay = Game.planPresentationPath(geometry, 7, 42);
  const variant = Game.planPresentationPath(geometry, 7, 43);
  assert.deepEqual(first.points, replay.points);
  assert.notDeepEqual(first.decisions, variant.decisions);
  assert.equal(first.decisions.filter(value => value > 0).length, 7);
  assert.equal(variant.decisions.filter(value => value > 0).length, 7);
});

test('reduced motion keeps the same authoritative route and terminal lock without a long wait', () => {
  const Game = loadGame();
  const geometry = Game.createGeometry(390, 'medium');
  const path = Game.planPresentationPath(geometry, 12, 2026);
  const reduced = Game.reduceMotionPath(path);
  assert.equal(reduced.duration, 280);
  assert.equal(reduced.slotIndex, path.slotIndex);
  assert.equal(reduced.terminalLockIndex, path.terminalLockIndex);
  assert.deepEqual(reduced.points.map(point => [point.x, point.y]), path.points.map(point => [point.x, point.y]));
  assert.equal(reduced.points.at(-1).x, geometry.slotCenters[12]);
});

test('Pachinko cabinet keeps controls, board, and result tray in one responsive composition', () => {
  assert.match(source, /pachinko-cabinet/);
  assert.match(source, /pachinko-static-canvas/);
  assert.match(source, /pachinko-dynamic-canvas/);
  assert.match(source, /ResizeObserver/);
  assert.match(source, /presentationGeneration/);
  assert.match(css, /\.pachinko-cabinet\s*\{/);
  assert.match(css, /\.pachinko-stage\s*\{/);
  assert.match(css, /@media \(max-width:768px\)[\s\S]*\.pachinko-cabinet[^}]*grid-template-areas:\s*"controls"\s*"board"/);
  assert.doesNotMatch(css, /grid-template-areas:\s*"controls"\s*"board"\s*"results"/);
  assert.doesNotMatch(source, /trail\.shift\(/);
});
