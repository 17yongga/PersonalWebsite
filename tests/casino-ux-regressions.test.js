'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

test('Blackjack keeps wagering and active play on one persistent table', () => {
  const source = read('games/blackjack.js');
  assert.doesNotMatch(source, /id="blackjackPreview"/);
  assert.match(source, /id="gameArea" class="game-area"/);
  assert.match(source, /class="[^"]*blackjack-wager-rail/);
  assert.doesNotMatch(source, /getElement\('gameArea'\)\?\.classList\.(?:add|remove)\('hidden'\)/);
  const css = read('games/games.css');
  assert.doesNotMatch(css, /\.blackjack-container \.betting-section\.is-locked\s*\{\s*display:\s*none/);
});

test('Blackjack presentation preserves card identity, reconciles the dealer reveal, and keeps a fixed hand origin', () => {
  const source = read('games/blackjack.js');
  const premium = read('games/premium-games.css');
  assert.match(source, /BLACKJACK_DEAL_CADENCE_MS/);
  assert.match(source, /buildBlackjackTransitionPlan/);
  assert.match(source, /preservedSplitCardIndices/);
  assert.match(source, /prepareSplitHands/);
  assert.match(source, /schedulePresentation/);
  assert.match(source, /existingCard\.classList\.toggle\('is-hidden'/);
  assert.match(source, /this\.updateCardElement\(existingCard, hand\[0\]/);
  assert.match(source, /updateCardElement\(cardEl, card/);
  assert.doesNotMatch(source, /if \(hiddenChanged \|\| handReset \|\| initial\) \{\s*container\.replaceChildren\(\)/);
  assert.match(premium, /--blackjack-hand-origin:/);
  assert.match(premium, /justify-content:flex-start/);
});

test('Blackjack wager composer and visible actions use one coherent equal-size layout', () => {
  const source = read('games/blackjack.js');
  const premium = read('games/premium-games.css');
  assert.match(source, /blackjack-chip-rack/);
  assert.match(source, /blackjack-chip-rack-label/);
  assert.match(premium, /grid-auto-columns:minmax\(0,1fr\)/);
  assert.match(premium, /grid-auto-flow:column/);
});

test('Blackjack exposes split-hand UI, compact visual outcomes, and mobile containment hooks', () => {
  const source = read('games/blackjack.js');
  const premium = read('games/premium-games.css');
  assert.match(source, /id="splitBtn"/);
  assert.match(source, /id="playerHands"/);
  assert.match(source, /renderPlayerHands/);
  assert.match(source, /blackjack-hand-result/);
  assert.match(source, /requestAction\('split'\)/);
  assert.match(premium, /aspect-ratio:1/);
  assert.match(premium, /blackjack-player-hand\.is-winner/);
  assert.match(premium, /blackjack-player-hand\.is-loser/);
  assert.match(premium, /is-crowded/);
  assert.match(premium, /grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/);
});

test('casino wager controls use chip semantics and Roulette preserves green selection', () => {
  const blackjack = read('games/blackjack.js');
  const roulette = read('games/roulette-casino.js');
  const premium = read('games/premium-games.css');
  assert.match(blackjack, /casino-chip/);
  assert.match(blackjack, /aria-pressed="false"/);
  assert.match(blackjack, /selectStakeChip/);
  assert.match(blackjack, /this\.stakeChips = \[amount\]/);
  assert.match(blackjack, /blackjackStakeStatus/);
  assert.match(blackjack, /undoStakeChip/);
  assert.match(blackjack, /clearStake/);
  assert.match(blackjack, /setMaxStake/);
  assert.match(premium, /\.rl-btn-green\.rl-btn-active/);
  assert.match(premium, /\.rl-btn-green \{[^}]+#16a34a[^}]+!important/);
  assert.match(roulette, /startBeltPreSpin/);
  assert.match(roulette, /setInterval\(tick, 100\)/);
  assert.match(premium, /--chip-accent/);
});

test('Roulette publishes and renders the latest settled spins', () => {
  const server = read('casino-server.js');
  const roulette = read('games/roulette-casino.js');
  const historyInsert = server.indexOf('rouletteState.history.unshift({');
  const resultBroadcast = server.indexOf("io.emit('rouletteSpinResult'");
  assert.ok(historyInsert >= 0 && resultBroadcast >= 0 && historyInsert < resultBroadcast,
    'the settled spin must be inserted before its result payload is broadcast');
  assert.match(roulette, /this\.history\.slice\(0, 30\)\.reverse\(\)/,
    'take the newest 30 results before reversing them for chronological display');
  assert.doesNotMatch(roulette, /\[\.\.\.this\.history\]\.reverse\(\)\.slice\(0, 30\)/);

  const historyElement = { innerHTML: '' };
  const sandbox = {
    window: {},
    document: { getElementById: id => id === 'rlHistory' ? historyElement : null },
    console,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval
  };
  vm.runInNewContext(roulette, sandbox);
  const game = Object.create(sandbox.window.RouletteGame.prototype);
  game.history = Array.from({ length: 50 }, (_, index) => ({
    number: 50 - index,
    color: 'red',
    timestamp: 50 - index
  }));
  game.updateHistoryDisplay();
  const displayed = [...historyElement.innerHTML.matchAll(/title="(\d+) \(red\)"/g)].map(match => Number(match[1]));
  assert.deepEqual(displayed, Array.from({ length: 30 }, (_, index) => index + 21));
});

test('Coinflip renders unambiguous semantic Heads and Tails faces', () => {
  const source = read('games/coinflip-casino.js');
  const premium = read('games/premium-games.css');
  assert.match(source, /data-side="heads"/);
  assert.match(source, /data-side="tails"/);
  assert.match(source, />HEADS</);
  assert.match(source, />TAILS</);
  assert.match(source, /prefers-reduced-motion: reduce/);
  assert.match(premium, /\.coin-front \{ background:[^}]+!important/);
  assert.match(premium, /\.coin-back \{ background:[^}]+!important/);
  assert.match(premium, /\.coin-back \{[^}]+rotateY\(180deg\) translateZ\(1px\)/);
  assert.match(premium, /\.coin-front \{[^}]+translateZ\(1px\)/);
  assert.doesNotMatch(premium, /\.coin-face \{[^}]*background:/);
});

test('Crash cash-out exposes an immediate pending state and clears it authoritatively', () => {
  const source = read('games/crash-casino.js');
  const premium = read('games/premium-games.css');
  assert.match(source, /cashoutPending/);
  assert.match(source, /Locked at/);
  assert.match(source, /Cash-out locked at/);
  assert.match(source, /cashoutRequestedMultiplier/);
  assert.match(source, /this\.cashoutPending = false/);
  assert.match(source, /playOnce\(`crash:\$\{this\.soundRoundId/);
  assert.match(source, /Math\.min\(window\.devicePixelRatio \|\| 1, 2\)/);
  assert.match(source, /cancelAnimationFrame\(this\.resizeFrame\)/);
  assert.match(source, /`Starting in \$\{Math\.ceil\(this\.bettingTimeLeft\)\}s`/);
  assert.doesNotMatch(source, /Starting in \$\{Math\.ceil\(this\.bettingTimeLeft\)\}s — Place your bets!/);
  assert.match(premium, /\.crash-multiplier\.betting-label[^}]*top:\s*34%/);
  assert.match(premium, /\.crash-status\.betting[^}]*top:\s*72%[^}]*bottom:\s*auto/);
});

test('Pachinko owns responsive lifecycle and uses multiplier-tier landing audio', () => {
  const source = read('games/pachinko-casino.js');
  assert.doesNotMatch(source, /if \(window\.innerWidth <= 768\)[\s\S]{0,500}insertBefore/);
  assert.match(source, /boundResize/);
  assert.match(source, /removeEventListener\('resize', this\.boundResize\)/);
  assert.match(source, /pachinkoLandingJackpot/);
  assert.match(source, /pachinkoLandingHigh/);
  assert.match(source, /fixedStepMs = \(1000 \/ 60\) \/ 1\.12/);
  assert.match(source, /const gravity = this\.H \* 0\.0003/);
  assert.match(source, /pachinkoPayoutLegend/);
  assert.match(source, /pendingBatches/);
  assert.match(source, /confirmBallPresentation/);
  assert.match(source, /createAuthoritativeRoute/);
  assert.match(source, /routeDecisions/);
  assert.doesNotMatch(source, /const rowWidth = W \* 0\.82/);
  assert.match(source, /b\.active \|\| b\.landingHoldFrames > 0 \|\| b\.trail\.length/);
});

test('CS2 mobile bet slip owns one scroll region and keeps payout text above its actions', () => {
  const css = read('cs2-modern-betting-ui.css');
  const theme = read('neon777-cs2-theme.css');
  assert.match(css, /@media \(max-width: 768px\)[\s\S]*\.cs2-betslip-modal-content[^}]*height:\s*min\(100dvh,\s*760px\)/);
  assert.match(css, /@media \(max-width: 768px\)[\s\S]*\.cs2-bet-controls[^}]*min-height:\s*0[^}]*overflow-y:\s*auto/);
  assert.match(css, /\.payout-info > div[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)\s+minmax\(0,\s*auto\)/);
  assert.match(css, /\.payout-info \.payout-value[^}]*overflow-wrap:\s*anywhere/);
  assert.match(css, /@media \(max-width: 768px\) and \(max-height: 650px\)[\s\S]*\.potential-payout[^}]*min-height:\s*142px/);
  assert.match(theme, /@media \(max-width: 900px\)[\s\S]*\.cs2-betslip-modal-content[^}]*max-height:\s*100dvh/);
});

test('achievement badge tracks unread unlocks and clears when badges are viewed', () => {
  const source = read('casino.js');
  assert.match(source, /achievementSeenStorageKey/);
  assert.match(source, /markAchievementsSeen/);
  assert.match(source, /Math\.max\(0, earnedCount - seenCount\)/);
  assert.match(source, /this\.markAchievementsSeen\(earnedCount\)/);
});

test('daily wheel uses segment-owned labels and lifecycle sounds', () => {
  const source = read('casino.js');
  const css = read('casino.css');
  assert.match(source, /spin-wheel-label-ring/);
  assert.match(source, /wheelTick/);
  assert.match(source, /wheelResult/);
  assert.match(css, /\.spin-wheel-label-ring/);
  assert.match(css, /\.spin-wheel-segment-label span/);
  assert.match(source, /label: '\+300'/);
  assert.match(source, /if \(!overlay\.isConnected\) return/);
});

test('cross-game lifecycle hardening keeps ownership local', () => {
  const roulette = read('games/roulette-casino.js');
  const cs2 = read('cs2-betting-modern.js');
  assert.doesNotMatch(roulette, /removeAllListeners/);
  assert.match(roulette, /this\.socket\.off\(event, handler\)/);
  assert.match(cs2, /previousScrollBehavior/);
  assert.match(cs2, /document\.documentElement\.style\.scrollBehavior = this\.previousScrollBehavior/);
});

test('responsive audit findings retain keyboard access, contrast, and 44px controls', () => {
  const casino = read('casino.js');
  const css = read('casino.css');
  const games = read('games/games.css');
  const premium = read('games/premium-games.css');
  const cs2Theme = read('neon777-cs2-theme.css');
  assert.match(casino, /id="bhList" role="region"[^>]+tabindex="0"/);
  assert.match(casino, /id="statsBody" role="region"[^>]+tabindex="0"/);
  assert.match(casino, /class="tour-steps" role="region"[^>]+tabindex="0"/);
  assert.match(css, /\.bh-filter span \{ opacity:1!important/);
  assert.match(css, /\.stat-val\.loss\s+\{ color:#ff9dcb/);
  assert.match(games, /\.loss, \.bh-value\.loss \{\s*color: #ff9dcb !important/);
  assert.match(premium, /\.rl-amount-row \.rl-adj-btn \{ min-width:44px!important; min-height:44px!important/);
  assert.match(premium, /\.crash-bet-group input \{ min-height:44px!important/);
  assert.match(premium, /\.pach-group input \{ min-height:44px!important/);
  assert.match(cs2Theme, /\.cs2-betting-container \.cs2-refresh-btn \{ min-height:44px!important/);
});

test('all game action buttons share one dimension and focus contract', () => {
  const controls = read('casino-controls.css');
  const blackjack = read('games/blackjack.js');
  const html = read('casino.html');
  assert.match(controls, /--casino-control-min:\s*48px/);
  assert.match(controls, /\.game-view :where\(/);
  assert.match(controls, /margin:\s*0 !important/);
  assert.match(controls, /#hitBtn,#standBtn,#doubleDownBtn,#splitBtn,#newGameBtn/);
  assert.match(controls, /button:focus-visible/);
  assert.match(blackjack, /id="hitBtn" class="btn btn-primary"/);
  assert.match(blackjack, /id="standBtn" class="btn btn-secondary"/);
  assert.match(html, /casino-controls\.css/);
  const coinflip = read('games/coinflip-casino.js');
  assert.match(coinflip, /id="createChooseHeadsBtn"[^>]*aria-pressed="false"/);
  assert.match(coinflip, /heads\.setAttribute\('aria-pressed', String\(choice === 'Heads'\)\)/);
});

test('Blackjack reserves equal dealer and player stages and labels authoritative soft hands', () => {
  const premium = read('games/premium-games.css');
  const blackjack = read('games/blackjack.js');
  assert.match(premium, /--blackjack-hand-stage-min:/);
  assert.match(premium, /\.dealer-section,\.blackjack-container \.player-section[^\{]*\{[^}]*min-height:var\(--blackjack-hand-stage-min\)/s);
  assert.match(premium, /grid-template-rows:minmax\(var\(--blackjack-hand-stage-min\),1fr\)[^;]*minmax\(var\(--blackjack-hand-stage-min\),1fr\)/);
  assert.match(premium, /\.player-section:has\(\.blackjack-player-hand\.is-active\)/);
  assert.match(blackjack, /hand\.isSoft/);
  assert.match(blackjack, /state\.dealerSoft/);
  assert.match(blackjack, /expectedRevision:\s*this\.roundRevision/);
  assert.match(blackjack, /requestId:\s*this\.pendingActionRequest\.requestId/);
});

test('game transitions use the shared viewport stabilizer instead of ad-hoc smooth scrolling', () => {
  const casino = read('casino.js');
  const cases = read('games/case-opening-casino.js');
  const controls = read('casino-controls.css');
  assert.match(casino, /stabilizeGameViewport\(/);
  assert.match(controls, /\.game-view:not\(\.hidden\) \{ overflow-anchor:none; \}/);
  assert.doesNotMatch(cases, /scrollIntoView\(\{\s*behavior:\s*reducedMotion \? 'auto' : 'smooth'/);
  for (const file of [
    'games/blackjack.js', 'games/roulette-casino.js', 'games/coinflip-casino.js',
    'games/crash-casino.js', 'games/pachinko-casino.js', 'games/poker-casino.js',
    'games/case-opening-casino.js', 'cs2-betting-modern.js'
  ]) assert.match(read(file), /stabilizeGameViewport\?\./, `${file} must stabilize its accepted wager transition`);
});
