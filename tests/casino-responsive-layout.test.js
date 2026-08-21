'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

function loadGameClass(file, exportName, width) {
  const sandbox = {
    window: { innerWidth: width, devicePixelRatio: 2, addEventListener() {}, removeEventListener() {} },
    document: {}, console, Math, requestAnimationFrame() {}, cancelAnimationFrame() {}, setTimeout, clearTimeout, setInterval, clearInterval
  };
  vm.runInNewContext(read(file), sandbox);
  return sandbox.window[exportName];
}

function resizeFixture(GameClass, wrapWidth) {
  const game = Object.create(GameClass.prototype);
  const style = {};
  game.canvas = {
    parentElement: { clientWidth: wrapWidth },
    style,
    width: 0,
    height: 0
  };
  game.ctx = { setTransform() {} };
  game.setupBoard = () => {};
  game.drawFrame = () => {};
  game.resizeCanvas();
  return { game, style };
}

test('Pachinko canvas consumes its wrapper on desktop and mobile', () => {
  const Desktop = loadGameClass('games/pachinko-casino.js', 'PachinkoGame', 1440);
  const desktop = resizeFixture(Desktop, 690);
  assert.equal(desktop.game.W, 690);
  assert.equal(desktop.style.width, '690px');

  const Mobile = loadGameClass('games/pachinko-casino.js', 'PachinkoGame', 390);
  const mobile = resizeFixture(Mobile, 354);
  assert.equal(mobile.game.W, 354);
  assert.equal(mobile.style.width, '354px');

  const Tablet = loadGameClass('games/pachinko-casino.js', 'PachinkoGame', 768);
  const tablet = resizeFixture(Tablet, 734);
  assert.equal(tablet.game.W, 734);
});

test('Crash canvas consumes its wrapper on desktop and mobile', () => {
  const Desktop = loadGameClass('games/crash-casino.js', 'CrashGame', 1440);
  const desktop = resizeFixture(Desktop, 840);
  assert.equal(desktop.style.width, '840px');

  const Mobile = loadGameClass('games/crash-casino.js', 'CrashGame', 390);
  const mobile = resizeFixture(Mobile, 354);
  assert.equal(mobile.style.width, '354px');

  const Tablet = loadGameClass('games/crash-casino.js', 'CrashGame', 768);
  const tablet = resizeFixture(Tablet, 734);
  assert.equal(tablet.style.width, '734px');

  const Wide = loadGameClass('games/crash-casino.js', 'CrashGame', 1440);
  const wide = resizeFixture(Wide, 1080);
  assert.equal(wide.style.width, '1080px', 'desktop chart has no obsolete 900px dead-band cap');
});

test('game layout stylesheet encodes interaction-priority responsive areas', () => {
  const premium = read('games/premium-games.css');
  const cs2Ui = read('cs2-modern-betting-ui.css');
  const crash = read('games/crash-casino.js');
  assert.match(premium, /--game-shell-wide:\s*1320px/);
  assert.match(premium, /\.crash-layout[^}]*grid-template-areas:\s*"chart controls"\s*"history feed"/s);
  assert.match(premium, /@media \(max-width:768px\)[\s\S]*\.crash-layout[^}]*grid-template-areas:\s*"controls"\s*"chart"\s*"history"\s*"feed"/);
  assert.match(premium, /@media \(max-width:768px\)[\s\S]*\.rl-bet-panel\s*\{[^}]*order:\s*1/);
  assert.match(premium, /@media \(max-width:768px\)[\s\S]*\.rl-info-panel\s*\{[^}]*order:\s*2/);
  assert.match(premium, /@media \(max-width:768px\)[\s\S]*\.pachinko-controls[^}]*grid-template-columns:\s*minmax\(0,1fr\)/);
  assert.match(premium, /\.pach-risk-btns,\.pach-ball-btns[^}]*grid-template-columns:repeat\(3,minmax\(0,1fr\)\)/);
  assert.match(premium, /\.pach-results:empty\s*\{\s*display:none/);
  assert.match(premium, /\.pachinko-canvas-wrap\s*\{[^}]*aspect-ratio:\s*50\s*\/\s*59/s);
  assert.match(cs2Ui, /@media \(max-width: 768px\)[\s\S]*\.cs2-betslip-modal-content[^}]*max-height:\s*100dvh/);
  assert.match(premium, /@media \(max-width:360px\)[\s\S]*\.blackjack-rules[^}]*max-width:\s*100%/);
  assert.match(crash, /class="crash-canvas-wrap"[\s\S]*class="crash-history"[\s\S]*class="crash-bet-section"[\s\S]*class="crash-feed-section"/);
});

test('desktop shells use available width while compact lobbies remain bounded', () => {
  const premium = read('games/premium-games.css');
  const cs2 = read('neon777-cs2-theme.css');
  const cases = read('games/case-opening.css');
  assert.match(premium, /\.blackjack-container[^}]*1180px/s);
  assert.match(premium, /\.rl-container[^}]*1200px/s);
  assert.match(premium, /\.crash-container[^}]*1240px/s);
  assert.match(premium, /\.pachinko-container[^}]*1120px/s);
  assert.match(premium, /\.poker-casino-container[^}]*1280px/s);
  assert.match(premium, /\.poker-lobby[^}]*max-width:\s*900px/s);
  assert.match(premium, /\.coinflip-casino-container \.game-section[^}]*max-width:\s*900px/s);
  assert.match(cs2, /\.cs2-betting-container[^}]*max-width:\s*1320px\s*!important/s);
  assert.match(cases, /@media \(max-width:760px\)[^{]*\{[^}]*\.case-game-shell\s*\{\s*padding:\s*12px/s);
});
