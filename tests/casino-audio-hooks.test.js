const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');

const sound = read('casino-sound.js');
const crash = read('games/crash-casino.js');
const pachinko = read('games/pachinko-casino.js');
const roulette = read('games/roulette-casino.js');
const blackjack = read('games/blackjack.js');
const poker = read('games/poker-casino.js');
const coinflip = read('games/coinflip-casino.js');

test('Crash rhythm is authoritative-tick driven, monotonic, and lifecycle bounded', () => {
  assert.match(crash, /crashTick[\s\S]{0,900}maybePlayCrashPulse\(\)/);
  assert.match(crash, /multiplier >= 10 \? 170[\s\S]*multiplier >= 5 \? 240[\s\S]*multiplier >= 3 \? 340/);
  assert.match(crash, /Math\.log2\(multiplier\) \/ 4/);
  assert.doesNotMatch(crash, /setInterval\([^)]*crashPulse/);
  assert.match(crash, /phase !== 'running' \|\| this\.myCashedOut \|\| this\._destroyed/);
  assert.ok((crash.match(/lastCrashPulseAt = 0/g) || []).length >= 5);
});

test('Pachinko peg sound uses inward impact, positional pan, threshold and per-peg gate', () => {
  assert.match(pachinko, /const impact = Math\.max\(0, Math\.min\(1, \(-dot\)/);
  assert.match(pachinko, /impact >= \.08 && now - lastPegSound >= 55/);
  assert.match(pachinko, /pegSoundAt: Object\.create\(null\)/);
  assert.match(pachinko, /impact,\s*pan: Math\.max/);
});

test('money and poker action cues occur only after authoritative acceptance/state', () => {
  const blackjackResponse = blackjack.indexOf("if (!response.ok) throw new Error(data.error || 'Blackjack action failed')");
  const blackjackCue = blackjack.indexOf('const actionEffect = {');
  assert.ok(blackjackResponse >= 0 && blackjackCue > blackjackResponse);
  assert.doesNotMatch(poker, /emit\('pokerAction'[\s\S]{0,180}casinoSound\?\.play/);
  assert.match(poker, /previousMe[\s\S]*currentMe[\s\S]*pokerFold[\s\S]*pokerRaise[\s\S]*pokerCall[\s\S]*pokerCheck/);
  assert.match(coinflip, /roomCreated[\s\S]*creator-wager[\s\S]*betPlaced/);
  assert.match(coinflip, /coinflipWagerAccepted[\s\S]*join-wager[\s\S]*betPlaced/);
});

test('Roulette client uses one sequenced authoritative mutation and contextual cues', () => {
  assert.match(roulette, /emit\('setRouletteBet'/);
  assert.doesNotMatch(roulette, /Clear your current bet first/);
  assert.match(roulette, /sequence !== this\.betMutationSequence/);
  assert.match(roulette, /response\.action === 'replaced' \? 'betReplaced'/);
  assert.match(roulette, /play\('betCancelled'/);
  assert.match(roulette, /rouletteCountdown/);
});

test('semantic catalog explicitly contains every new contextual effect', () => {
  for (const effect of [
    'betCancelled', 'betReplaced', 'error', 'blackjackHit', 'blackjackStand',
    'blackjackDouble', 'blackjackSplit', 'rouletteTick', 'rouletteCountdown',
    'crashPulse', 'pokerFold', 'pokerCheck', 'pokerCall', 'pokerRaise', 'potWin'
  ]) {
    assert.match(sound, new RegExp(`['"]${effect}['"]`), `missing catalog effect ${effect}`);
    assert.match(sound, new RegExp(`case ['"]${effect}['"]`), `missing renderer for ${effect}`);
  }
  assert.match(sound, /if \(!EFFECTS\.has\(effect\)\)/);
  assert.doesNotMatch(sound, /default:\s*this\.tone/);
});
