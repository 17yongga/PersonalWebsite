'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'cs2-betting-modern.js'), 'utf8');
const css = fs.readFileSync(path.join(root, 'cs2-desktop-workspace.css'), 'utf8');
const theme = fs.readFileSync(path.join(root, 'neon777-cs2-theme.css'), 'utf8');

function createGame() {
  const sandbox = {
    window: { matchMedia: () => ({ matches:true }) },
    navigator: {},
    document: {},
    console,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval
  };
  vm.runInNewContext(source, sandbox);
  const Game = sandbox.window.CS2ModernBettingGame;
  const game = Object.create(Game.prototype);
  game.hasValidOdds = event => Number(event?.odds?.team1) > 1 && Number(event?.odds?.team2) > 1;
  game.escapeHtml = value => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#039;');
  game.getTeamLogo = () => 'fallback.png';
  game.getFallbackLogo = () => 'fallback.png';
  return game;
}

const openLive = {
  id:'open', status:'live', bettingStatus:'open', homeTeam:'Spirit', awayTeam:'Vitality',
  odds:{ team1:1.8, team2:2.1 }, oddsUpdatedAt:'2026-08-29T00:00:00Z', bestOf:3
};
const pausedLive = {
  id:'paused', status:'live', bettingStatus:'suspended', homeTeam:'MIBR', awayTeam:'Keyd Stars',
  odds:{ team1:1.7, team2:2.2 }, reason:'Market paused · odds last updated 113 min ago', bestOf:3
};

test('live events are split into actionable and watch-only groups with actionable markets first', () => {
  const game = createGame();
  const grouped = game.groupEventsByTournament([pausedLive, openLive]);
  assert.deepEqual(Object.keys(grouped), ['BETTABLE LIVE', 'WATCHING · MARKETS PAUSED']);
  assert.equal(grouped['BETTABLE LIVE'][0].id, 'open');
  assert.equal(grouped['WATCHING · MARKETS PAUSED'][0].id, 'paused');
});

test('paused live matches render as compact truthful rows without stale odds controls', () => {
  const game = createGame();
  const html = game.renderEventCard(pausedLive);
  assert.match(html, /paused-live-card/);
  assert.match(html, /Match live/);
  assert.match(html, /Betting paused/);
  assert.match(html, /1h 53m ago/);
  assert.doesNotMatch(html, /class="odds-pill/);
  assert.doesNotMatch(html, /team-logo-large/);
});

test('fresh open live matches retain real betting controls and explicit BET LIVE state', () => {
  const game = createGame();
  const html = game.renderEventCard(openLive);
  assert.match(html, /BET LIVE/);
  assert.equal((html.match(/class="odds-pill/g) || []).length, 2);
  assert.doesNotMatch(html, /paused-live-card/);
});

test('mobile live betting CSS enforces compact paused rows and accessible open controls', () => {
  assert.match(css, /\.paused-live-card\s*\{/);
  assert.match(css, /\.paused-live-reason\s*\{/);
  assert.match(theme, /@media \(max-width:\s*768px\)[\s\S]*\.paused-live-card/);
  assert.match(theme, /\.cs2-event-card\.live-market-open[\s\S]*\.odds-pill/);
});
