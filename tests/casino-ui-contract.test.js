'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

test('CS2 owns its interactive selectors and tears down global listeners', () => {
  const source = read('cs2-betting-modern.js');
  assert.doesNotMatch(source, /document\.getElementById\('placeBetBtn'\)/);
  assert.doesNotMatch(source, /document\.querySelectorAll\('\.quick-bet-btn'\)/);
  assert.doesNotMatch(source, /document\.querySelectorAll\('\.bet-tab'\)/);
  assert.match(source, /this\.root\?\.querySelector\('#placeBetBtn'\)/);
  assert.match(source, /removeEventListener\(listener\.type, listener\.handler/);
});

test('invalid Coinflip and Roulette inputs are validated before navigation is locked', () => {
  const coinflip = read('games/coinflip-casino.js');
  const roulette = read('games/roulette-casino.js');
  const coinMethod = coinflip.slice(coinflip.indexOf('  createRoom() {'), coinflip.indexOf('  showTemporaryMessage('));
  const rouletteMethod = roulette.slice(roulette.indexOf('  placeBet(color) {'), roulette.indexOf('  clearBet() {'));
  assert.ok(coinMethod.indexOf("if (!amount || amount <= 0") < coinMethod.indexOf('setBetPlacementInProgress(true)'));
  assert.ok(rouletteMethod.indexOf("if (!amount || amount < 1)") < rouletteMethod.indexOf('this.setBetMutationPending(true)'));
});

test('Roulette uses a sequenced authoritative set/replace acknowledgement before showing a bet', () => {
  const client = read('games/roulette-casino.js');
  const server = read('casino-server.js');
  assert.match(client, /socket\.timeout\(5000\)\.emit\('setRouletteBet'/);
  assert.ok(client.indexOf("socket.timeout(5000).emit('setRouletteBet'") < client.indexOf('this.currentBet = response.bet'));
  assert.match(client, /sequence !== this\.betMutationSequence/);
  assert.match(client, /if \(roundId && this\.roundId && roundId !== this\.roundId\) return;/);
  assert.match(server, /socket\.on\('setRouletteBet', handleSetRouletteBet\)/);
  assert.match(server, /casinoLedger\.replaceEscrow/);
});

test('Coinflip and Poker references remain unique across process restarts', () => {
  const server = read('casino-server.js');
  assert.doesNotMatch(server, /coinflipRoomCounter|pokerTableCounter/);
  assert.match(server, /const roomId = `room-\$\{crypto\.randomUUID\(\)\}`/);
  assert.match(server, /const tableId = `poker_\$\{crypto\.randomUUID\(\)\}`/);
});

test('opt-in sound controls and authoritative game sound hooks ship in the immutable release', () => {
  const builder = read('scripts/build-casino-release.js');
  const html = read('casino.html');
  const sound = read('casino-sound.js');
  const gameSources = [
    'games/blackjack.js', 'games/roulette-casino.js', 'games/coinflip-casino.js',
    'games/crash-casino.js', 'games/pachinko-casino.js', 'games/poker-casino.js',
    'cs2-betting-modern.js'
  ].map(read);
  assert.match(builder, /casino-sound\.js/);
  assert.match(builder, /casino-sound\.css/);
  assert.match(html, /id="soundToggle"[^>]+data-sound-toggle/);
  assert.match(html, /id="soundToggleMobile"[^>]+data-sound-toggle/);
  assert.match(html, /casino-sound\.js/);
  assert.match(html, /casino-sound\.css/);
  assert.match(sound, /localStorage\.getItem\(STORAGE_KEY\) === 'on'/);
  assert.match(sound, /window\.AudioContext \|\| window\.webkitAudioContext/);
  assert.match(sound, /const currentGame = window\.casinoManager\?\.currentGame \|\| null/);
  assert.match(sound, /options\.game === 'lobby'/);
  assert.match(sound, /playOnce\(key, effect/);
  gameSources.forEach(source => assert.match(source, /window\.casinoSound|const sound = window\.casinoSound/));
});

test('release and UI contracts include cards, truthful auth copy, safe mobile nav and accessible muted text', () => {
  const builder = read('scripts/build-casino-release.js');
  const html = read('casino.html');
  const css = read('casino.css');
  const blackjack = read('games/blackjack.js');
  const premiumGames = read('games/premium-games.css');
  assert.match(builder, /'blackjack\/images'/);
  assert.match(builder, /games\/premium-games\.css/);
  assert.match(html, /games\/premium-games\.css/);
  assert.match(blackjack, /blackjack-card-inner/);
  assert.doesNotMatch(blackjack, /backgroundImage = `url\('blackjack\/images/);
  assert.match(blackjack, /boundKeyboardHandler/);
  assert.match(blackjack, /removeEventListener\('keydown', this\.boundKeyboardHandler\)/);
  assert.match(premiumGames, /@keyframes bj-deal/);
  assert.match(premiumGames, /@keyframes bj-reveal/);
  assert.match(premiumGames, /prefers-reduced-motion/);
  assert.match(builder, /CASINO_BUILD_INSTALL_DEPS/);
  assert.match(builder, /\['ci', '--omit=dev', '--no-audit', '--no-fund'\]/);
  assert.match(builder, /Immutable release must not contain symlinks/);
  assert.doesNotMatch(html, /247 FLOOR TONIGHT|\$1\.2M PAID OUT TODAY/i);
  assert.match(css, /body\.casino-game-active \.neon-bottom-nav/);
  assert.match(css, /body\.casino-dialog-open \.neon-bottom-nav/);
  assert.match(css, /\.achievement-card\.locked \{ opacity:1; \}/);
  assert.match(css, /\.stats-modal \.stat-label[^\n]+font-size:11px; color:#b8ada8/);
});
