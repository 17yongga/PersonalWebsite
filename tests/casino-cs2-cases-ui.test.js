'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { getCS2BettingAvailability, CS2_LIVE_ODDS_MAX_AGE_MS, CS2_PREMATCH_ODDS_MAX_AGE_MS } = require('../cs2-market-availability');
const { extractFromBetUpdates } = require('../cs2-bo3gg-client');

const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

test('live markets only open with valid fresh live-source odds', () => {
  const now = Date.parse('2026-07-31T17:00:00Z');
  const base = { status: 'live', odds: { team1: 1.8, team2: 2.1 }, oddsSource: 'bo3gg-live' };
  assert.equal(getCS2BettingAvailability({ ...base, oddsUpdatedAt: new Date(now - 60_000).toISOString() }, now).bettingStatus, 'open');
  assert.equal(getCS2BettingAvailability({ ...base, oddsUpdatedAt: new Date(now - CS2_LIVE_ODDS_MAX_AGE_MS - 1).toISOString() }, now).bettingStatus, 'suspended');
  assert.equal(getCS2BettingAvailability({ ...base, oddsSource: 'ranking-fallback', oddsUpdatedAt: new Date(now).toISOString() }, now).bettingStatus, 'suspended');
  assert.equal(getCS2BettingAvailability({ ...base, odds: { team1: null, team2: 2 } }, now).bettingStatus, 'suspended');
  assert.match(getCS2BettingAvailability({ ...base, oddsUpdatedAt: new Date(now - CS2_LIVE_ODDS_MAX_AGE_MS - 1).toISOString() }, now).reason, /last updated 20 min ago/);
  assert.equal(getCS2BettingAvailability({ ...base, odds: { team1: null, team2: 2 } }, now).reason, 'Market paused · provider has no current odds');
  assert.equal(getCS2BettingAvailability({ ...base }, now).reason, 'Market paused · bookmaker has not published odds');
  assert.doesNotMatch(getCS2BettingAvailability({ ...base }, now).reason, /\blive\b/i);
});

test('scheduled markets require fresh bookmaker odds and finished markets close', () => {
  const now = Date.parse('2026-07-31T17:00:00Z');
  const base = { status: 'scheduled', odds: { team1: 1.4, team2: 2.8 }, oddsSource: 'bo3gg-prematch' };
  assert.equal(getCS2BettingAvailability({ ...base, oddsUpdatedAt: new Date(now - 60_000).toISOString() }, now).bettingStatus, 'open');
  assert.equal(getCS2BettingAvailability({ ...base, oddsSource: 'ranking-fallback', oddsUpdatedAt: new Date(now).toISOString() }, now).bettingStatus, 'suspended');
  assert.equal(getCS2BettingAvailability({ ...base, oddsUpdatedAt: new Date(now - CS2_PREMATCH_ODDS_MAX_AGE_MS - 1).toISOString() }, now).bettingStatus, 'suspended');
  assert.equal(getCS2BettingAvailability({ ...base, status: 'finished', oddsUpdatedAt: new Date(now).toISOString() }, now).bettingStatus, 'closed');
});

test('bo3.gg only accepts active numeric bookmaker markets', () => {
  const active = extractFromBetUpdates({ bet_updates: {
    team_1: { name: 'Alpha', coeff: '1.85', active: true },
    team_2: { name: 'Beta', coeff: 2.1, active: true }
  } });
  assert.equal(active.team1Odds, 1.85);
  assert.equal(active.team2Odds, 2.1);
  const suspended = extractFromBetUpdates({ bet_updates: {
    team_1: { name: 'Alpha', coeff: 1.85, active: false },
    team_2: { name: 'Beta', coeff: 2.1, active: true }
  } });
  assert.equal(suspended.team1Odds, null);
  assert.equal(suspended.team2Odds, 2.1);
});

test('CS2 client requests the dedicated current feed and maps live odds timestamps', () => {
  const source = read('cs2-bo3gg-client.js');
  assert.match(source, /fetchCurrentMatches/);
  assert.match(source, /filter\[matches\.status\]\[eq\]'\s*:\s*'current'/);
  assert.match(source, /oddsUpdatedAt:\s*fetchedAt/);
  assert.match(source, /market\?\.active === true/);
  assert.match(source, /status:\s*'live'/);
  const server = read('casino-server.js');
  assert.match(server, /hasOdds:\s*matchHasBookmakerOdds/);
  assert.match(server, /bookmaker odds unavailable/);
  assert.doesNotMatch(server.slice(server.indexOf('async function syncCS2Events'), server.indexOf('// Map to internal event format')), /Using ranking-based odds|favoriteOdds|underdogOdds/);
});

test('both CS2 wager clients send a retry-stable requestId', () => {
  for (const file of ['cs2-betting-modern.js', 'games/cs2-betting-casino.js']) {
    const source = read(file);
    assert.match(source, /pendingBetRequestId/);
    assert.match(source, /JSON\.stringify\(\{\s*requestId,/);
    assert.match(source, /response\.ok \|\| response\.status < 500/);
  }
});

test('desktop betting workspace keeps live matches and moves My Bets out of the sidebar', () => {
  const source = read('cs2-betting-modern.js');
  const css = read('cs2-desktop-workspace.css');
  assert.doesNotMatch(source, /return !hasStarted && !isFinished/);
  assert.match(source, /event\.status === 'live'/);
  assert.match(source, /event\.bettingStatus === 'open'/);
  assert.match(source, /cs2-my-bets-workspace/);
  assert.doesNotMatch(source, /class="cs2-sidebar-panel"/);
  assert.match(css, /grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\)/);
  assert.match(css, /\.cs2-my-bets-workspace \.cs2-my-bets/);
  assert.match(css, /grid-template-columns:\s*minmax\(0, 1fr\)\s*!important/);
  assert.match(css, /@media \(max-width:\s*768px\)/);
  assert.doesNotMatch(css, /@media \(max-width:\s*767px\)/);
  assert.doesNotMatch(css, /\.cs2-header-stats\s*\{[\s\S]{0,160}display:\s*flex\s*!important/);
  assert.doesNotMatch(css, /\.cs2-disclaimer\s*\{[\s\S]{0,160}display:\s*block\s*!important/);
  assert.match(css, /\.events-panel-header\s*\{[\s\S]{0,180}flex-direction:\s*row\s*!important/);
  assert.match(css, /\.cs2-my-bets-workspace\s*\{[\s\S]*flex:\s*0 0 100%\s*!important/);
  assert.match(css, /\.cs2-events-list\s*\{[\s\S]*max-height:\s*none\s*!important/);
  assert.match(css, /\.my-bets-header\s*\{[\s\S]{0,160}display:\s*flex\s*!important/);
  assert.match(css, /\.cs2-my-bets\s+\.empty-state\s*\{[\s\S]{0,160}display:\s*flex\s*!important/);
  assert.match(css, /\.cs2-my-bets\s*\{[\s\S]{0,180}max-height:\s*none\s*!important/);
  assert.match(source, /isLive \? '' : `<span class="match-time-countdown/);
  assert.match(source, /const marketMessage = canBet \? 'Betting open'/);
  assert.match(source, /const defaultCollapsed = !isLiveSection/);
});

test('CS2 wager retries are payload-bound and polling preserves the selected portfolio tab', () => {
  const client = read('cs2-betting-modern.js');
  const server = read('casino-server.js');
  assert.match(client, /pendingBetRequestSignature/);
  assert.match(client, /showBets\(this\.currentBetsTab\)/);
  assert.doesNotMatch(client, /e\.key === 'Enter'[\s\S]{0,180}handlePlaceBet/);
  assert.match(server, /Wager request identifier was already used for different inputs/);
  assert.match(server, /storedCS2WagerSignature\(priorBet\) !== requestSignature/);
  assert.match(server, /cs2WagerSignature\(wagerType, amount, requestedLegs\)/);
});

test('CS2 parlays are server-authoritative, bounded, and recover finished events without results', () => {
  const client = read('cs2-betting-modern.js');
  const server = read('casino-server.js');
  const provider = read('cs2-bo3gg-client.js');
  const build = read('scripts/build-casino-release.js');
  assert.match(client, /this\.betMode = 'single'/);
  assert.match(client, /this\.parlayLegs = \[\]/);
  assert.match(client, /data-wager-mode="parlay"/);
  assert.match(client, /legs:\s*this\.parlayLegs\.map/);
  assert.match(client, /renderParlayBetCard/);
  assert.doesNotMatch(client, /highlightValidationStatus/);
  assert.match(server, /validateParlayLegs\(lockedLegs\)/);
  assert.match(server, /evaluateWager\(bet, outcomes\)/);
  assert.match(server, /event\?\.result\?\.winner/);
  assert.match(server, /result:\s*match\.result \|\| existingEvent\?\.result \|\| null/);
  assert.match(server, /result_unavailable_after_grace/);
  assert.match(provider, /fetchResultById/);
  assert.match(provider, /filter\[matches\.id\]\[eq\]/);
  assert.match(build, /cs2-wager-rules\.js/);
  const animations = read('cs2-animations.css');
  assert.doesNotMatch(animations, /^\.btn/m);
  assert.doesNotMatch(animations, /^\s+\.btn/m);
  assert.match(animations, /\.cs2-betting-container \.btn/);
});

test('balance displays two decimals while non-balance credit formatting rounds', () => {
  const casino = read('casino.js');
  const cs2 = read('cs2-betting-modern.js');
  const fallback = read('games/cs2-betting-casino.js');
  assert.match(casino, /formatBalance\(amount\)[\s\S]*minimumFractionDigits:\s*2[\s\S]*maximumFractionDigits:\s*2/);
  assert.match(casino, /formatCredits\(amount\)[\s\S]*Math\.round/);
  assert.match(casino, /creditsEl\.textContent = this\.formatBalance\(this\.credits\)/);
  assert.match(cs2, /this\.casino\.formatBalance\?\.\(this\.currentBalance\)/);
  assert.match(cs2, /formatCredits\(payout\)/);
  assert.match(fallback, /this\.casino\.formatBalance\?\.\(this\.currentBalance\)/);
  assert.match(fallback, /this\.casino\.formatCredits\?\.\(payout\)/);
  assert.doesNotMatch(fallback, /Potential Payout:[^\n]*payout\.toFixed\(2\)/);
});

test('case game is wired into the lobby, game manager, release package and lifecycle cleanup', () => {
  const html = read('casino.html');
  const casino = read('casino.js');
  const build = read('scripts/build-casino-release.js');
  const cases = read('games/case-opening-casino.js');
  assert.match(html, /data-game="cases"/);
  assert.match(html, /id="caseOpeningGame"/);
  assert.match(casino, /cases:\s*\{[^}]*CaseOpeningGame/);
  assert.match(build, /casino-cases\.js/);
  assert.match(build, /case-opening-casino\.js/);
  assert.match(cases, /socket\?\.off\('caseBattlesUpdated', this\.socketHandler\)/);
  assert.match(cases, /clearInterval\(this\.pollTimer\)/);
  assert.match(cases, /removeEventListener\('click', this\.clickHandler\)/);
  assert.match(cases, /role="tab"[^>]*aria-selected/);
  assert.match(cases, /role="tabpanel"/);
  assert.match(cases, /this\.pending = \{ open: null, battle: null, joins: new Map\(\), cancels: new Map\(\), sells: new Map\(\), sellAll: null \}/);
  assert.match(cases, /if \(this\.isDefinitiveError\(error\)\) this\.pending\.open = null/);
  assert.match(cases, /class="skin-image"/);
  assert.doesNotMatch(cases, /<svg viewBox="0 0 180 70"/);
  assert.match(cases, /case-reel-window/);
  assert.match(cases, /--reel-stop/);
  assert.match(cases, /case-visual-stack/);
  assert.match(cases, /case-featured-drop/);
  assert.match(cases, /centerHorizontalControl/);
  assert.match(cases, /\.scrollLeft\s*=/);
  assert.match(cases, /class="case-drop-preview"\s+tabindex="0"\s+role="region"/);
  assert.match(cases, /data-action="toggle-drops"/);
  assert.match(cases, /data-action="toggle-fast"/);
  assert.match(cases, /data-action="open-again"/);
  assert.match(cases, /data-action="view-inventory"/);
  assert.match(cases, /data-keep-item/);
  assert.match(cases, /data-sell-item/);
  assert.match(cases, /case-result-actions/);
  assert.match(cases, /this\.fastOpen \? 700 : 2700/);
  assert.match(cases, /window\.casinoSound\?\.play\('caseReel'/);
  assert.match(cases, /async presentBattleResult/);
  assert.match(cases, /for \(let roundIndex = 0; roundIndex < roundCount/);
  assert.match(cases, /clearPresentationTimers/);
  const caseCss = read('games/case-opening.css');
  assert.match(caseCss, /\.case-reel-window/);
  assert.match(caseCss, /\.case-reel-track/);
  assert.match(caseCss, /\.case-visual-stack/);
  assert.match(caseCss, /\.case-open-dock\s*\{\s*position:static;\s*z-index:auto;/);
  assert.doesNotMatch(caseCss, /\.case-open-dock\s*\{[^}]*position:sticky;/);
  assert.match(caseCss, /\.case-mode-nav,\.battle-ticket\s*\{\s*position:static;/);
  assert.match(caseCss, /\.case-status\s*\{\s*position:fixed;/);
  assert.match(caseCss, /\.case-result-actions/);
  assert.match(caseCss, /scroll-snap-type:\s*x mandatory/);
  assert.match(caseCss, /\.battle-final-actions/);
  assert.match(caseCss, /\.battle-round-stage/);
  assert.match(caseCss, /overflow-wrap:anywhere/);
  assert.match(build, /assets\/cs2-skins/);
  const service = read('casino-cases.js');
  assert.match(service, /results:\s*participants/);
  assert.match(service, /winnerId:\s*row\.winner_id/);
});

test('mobile Cases keeps the opening decision compact and confirms item sales in place', () => {
  const client = read('games/case-opening-casino.js');
  const css = read('games/case-opening.css');
  const server = read('casino-server.js');
  const cases = read('casino-cases.js');
  assert.match(client, /case-mobile-summary/);
  assert.match(client, /data-action="toggle-case-details"/);
  assert.match(client, /data-action="sell-all"/);
  assert.match(client, /lastRevealedItems = this\.lastRevealedItems\.filter\(item => item\.inventoryId !== button\.dataset\.keepItem\)/);
  assert.match(client, /classList\.add\('is-sold'\)/);
  assert.match(client, /aria-busy/);
  assert.match(css, /@media \(max-width:760px\)[\s\S]*\.case-secondary-details:not\(\.is-expanded\)\s*\{\s*display:none/);
  assert.match(server, /\/api\/cases\/inventory\/sell-all/);
  assert.match(cases, /sellAll\(\{ userId, inventoryIds, requestId \}\)/);
});
