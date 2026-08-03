'use strict';

const fs = require('node:fs');
const path = require('node:path');
const puppeteer = require('puppeteer');

const baseUrl = process.env.CASINO_QA_URL || 'http://127.0.0.1:8767/casino.html';
const outputRoot = process.env.CASINO_QA_OUT || path.join(__dirname, 'baseline');
const viewports = process.env.CASINO_QA_VIEWPORTS
  ? JSON.parse(process.env.CASINO_QA_VIEWPORTS)
  : [{ name: 'compact', width: 375, height: 667 }, { name: 'standard', width: 390, height: 844 }];
const screens = (process.env.CASINO_QA_SCREENS || 'login,register,lobby,menu,tour,history,howto,blackjack,roulette,coinflip,coinflip-rooms,crash,pachinko,poker,poker-tables,cs2betting,cs2betting-populated,cases').split(',');
const games = new Set(['blackjack', 'roulette', 'coinflip', 'crash', 'pachinko', 'poker', 'cs2betting', 'cases']);
const shotsDir = path.join(outputRoot, 'screenshots');
fs.mkdirSync(shotsDir, { recursive: true });

function fixtureCatalog() {
  return {
    success: true,
    cases: [
      {
        id: 'qa-neon-case', name: 'Neon Championship Archive With A Deliberately Long Name', era: 'modern',
        generation: 'cs2', price: 250, accent: '#ff5aa8', expectedReturn: 0.95,
        description: 'A deterministic modern case fixture with long responsive copy.',
        items: [{
          id: 'qa-item', name: 'AK-47 | Asiimov Factory New Championship Edition', weapon: 'AK-47',
          rarity: 'classified', rarityLabel: 'Classified', color: '#b56cff', value: 475,
          image: '/assets/cs2-skins/ak-47-asiimov-09205674e246.png', weight: 70000,
          chance: 7, chanceLabel: '7%'
        }]
      }
    ]
  };
}

async function prepare(page, screen) {
  await page.evaluateOnNewDocument(() => {
    const nativeAdd = EventTarget.prototype.addEventListener;
    const nativeRemove = EventTarget.prototype.removeEventListener;
    const registry = new WeakMap();
    let listenerCount = 0;
    EventTarget.prototype.addEventListener = function(type, listener, options) {
      const isGlobalTarget = this === window || this === document || this === document.documentElement || this === document.body;
      if (listener && isGlobalTarget) {
        let byType = registry.get(this);
        if (!byType) { byType = new Map(); registry.set(this, byType); }
        let listeners = byType.get(type);
        if (!listeners) { listeners = new Set(); byType.set(type, listeners); }
        if (!listeners.has(listener)) { listeners.add(listener); listenerCount += 1; }
      }
      return nativeAdd.call(this, type, listener, options);
    };
    EventTarget.prototype.removeEventListener = function(type, listener, options) {
      const isGlobalTarget = this === window || this === document || this === document.documentElement || this === document.body;
      const listeners = isGlobalTarget ? registry.get(this)?.get(type) : null;
      if (listeners?.delete(listener)) listenerCount -= 1;
      return nativeRemove.call(this, type, listener, options);
    };
    const nativeSetInterval = window.setInterval.bind(window);
    const nativeClearInterval = window.clearInterval.bind(window);
    const intervals = new Set();
    window.setInterval = (...args) => { const id = nativeSetInterval(...args); intervals.add(id); return id; };
    window.clearInterval = id => { intervals.delete(id); return nativeClearInterval(id); };
    const nativeRaf = window.requestAnimationFrame.bind(window);
    const nativeCancelRaf = window.cancelAnimationFrame.bind(window);
    const rafs = new Set();
    window.requestAnimationFrame = callback => {
      let id;
      id = nativeRaf(time => { rafs.delete(id); callback(time); });
      rafs.add(id);
      return id;
    };
    window.cancelAnimationFrame = id => { rafs.delete(id); return nativeCancelRaf(id); };
    window.__qaRuntimeCounts = () => ({ listeners: listenerCount, intervals: intervals.size, rafs: rafs.size });
  });
  await page.setRequestInterception(true);
  page.on('request', request => {
    const url = request.url();
    if ((url.includes('127.0.0.1:3001') || url.includes('localhost:3001') || url.includes('api.gary-yong.com')) && url.includes('/api/cs2/')) {
      request.respond({
        status: 200,
        contentType: 'application/json',
        headers: { 'Access-Control-Allow-Origin': '*' },
        body: JSON.stringify({ success: true, events: [], bets: [], balance: 987654.32 })
      });
      return;
    }
    request.continue();
  });
  await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForFunction(() => window.casinoManager, { timeout: 15000 });
  await page.evaluate(async ({ screen, catalog }) => {
    const manager = window.casinoManager;
    const games = new Set(['blackjack', 'roulette', 'coinflip', 'crash', 'pachinko', 'poker', 'cs2betting', 'cases']);
    const listeners = new Map();
    const socket = {
      connected: true,
      on(event, handler) { const list = listeners.get(event) || []; list.push(handler); listeners.set(event, list); return this; },
      off(event, handler) { const list = listeners.get(event) || []; listeners.set(event, handler ? list.filter(item => item !== handler) : []); return this; },
      removeAllListeners(event) { if (event) listeners.delete(event); else listeners.clear(); return this; },
      emit(event, ...args) {
        const callback = typeof args.at(-1) === 'function' ? args.at(-1) : null;
        if (callback && event === 'getBetHistory') callback([]);
        else if (callback) callback({ success: false, error: 'Deterministic QA transport: no monetary mutation performed' });
        return this;
      },
      timeout() { return this; },
      disconnect() { this.connected = false; },
      __dispatch(event, payload) { for (const handler of listeners.get(event) || []) handler(payload); },
      __listenerCount() { return [...listeners.values()].reduce((total, handlers) => total + handlers.length, 0); }
    };
    const response = payload => Promise.resolve({ ok: true, status: 200, json: async () => payload });
    manager.username = 'QA_MOBILE_USERNAME_WITH_LONG_TEXT';
    manager.credits = 987654.32;
    manager.socket = socket;
    manager.getSocket = () => socket;
    manager.apiFetch = async requestPath => {
      if (String(requestPath).includes('/api/cases/catalog')) return response(catalog);
      if (String(requestPath).includes('/api/cases/battles')) return response({ success: true, battles: [] });
      if (String(requestPath).includes('/api/cases/inventory')) return response({ success: true, inventory: [] });
      return response({ success: true, events: [], bets: [], data: [] });
    };
    manager.authFetch = manager.apiFetch;
    window.__qaSocket = socket;

    if (screen === 'register') {
      manager.showRegisterForm();
      return;
    }
    if (screen === 'login') return;
    manager.showMainScreen();
    const game = screen.split('-')[0];
    if (!games.has(game)) {
      if (screen === 'menu') document.getElementById('mobileMenuToggle')?.click();
      if (screen === 'tour') manager.showTour();
      if (screen === 'history') await manager.showBetHistory();
      if (screen === 'howto') manager.showHowToPlay('blackjack');
      if (screen === 'lifecycle') {
        const order = ['blackjack', 'roulette', 'coinflip', 'crash', 'pachinko', 'poker', 'cs2betting', 'cases'];
        for (const gameName of order) {
          manager.startGame(gameName);
          await new Promise(resolve => setTimeout(resolve, 70));
          manager.backToLobby();
          await new Promise(resolve => setTimeout(resolve, 30));
        }
        await new Promise(resolve => setTimeout(resolve, 150));
        const before = { ...window.__qaRuntimeCounts(), sockets: socket.__listenerCount(), nodes: document.querySelectorAll('*').length };
        for (let index = 0; index < 20; index += 1) {
          manager.startGame(order[index % order.length]);
          await new Promise(resolve => setTimeout(resolve, 70));
          manager.backToLobby();
          await new Promise(resolve => setTimeout(resolve, 30));
        }
        await new Promise(resolve => setTimeout(resolve, 150));
        const after = { ...window.__qaRuntimeCounts(), sockets: socket.__listenerCount(), nodes: document.querySelectorAll('*').length };
        window.__qaLifecycle = { before, after };
      }
      return;
    }
    const started = manager.startGame(game);
    if (!started) throw new Error(`Unable to start ${game}`);
  }, { screen, catalog: fixtureCatalog() });

  const game = screen.split('-')[0];
  if (games.has(game)) await new Promise(resolve => setTimeout(resolve, game === 'cases' || game === 'cs2betting' ? 700 : 450));

  await page.evaluate(screen => {
    const instance = window.currentGameInstance;
    const longName = 'Player_With_An_Exceptionally_Long_Responsive_Test_Name_2026';
    if (screen === 'roulette' && instance) {
      instance.currentBet = { color: 'black', amount: 987654 };
      instance.allBets = { qa: { username: longName, color: 'black', amount: 987654 } };
      instance.history = [0, 14, 13, 12, 11, 10, 9, 8, 7];
      instance.updateBetDisplay?.();
      instance.renderAllBets?.();
      instance.renderHistory?.();
      const result = document.getElementById('rlLastResult');
      if (result) result.textContent = 'BLACK — 987,654 credits • Authoritative settlement accepted';
    }
    if (screen === 'coinflip') {
      document.getElementById('toggleCreateRoomBtn')?.click();
    }
    if (screen === 'coinflip-rooms') {
      instance?.updateRoomList?.([{ roomId: 'room-with-an-exceptionally-long-responsive-identifier', creatorName: longName, betAmount: 987654, creatorChoice: 'heads' }]);
    }
    if (screen === 'crash' && instance) {
      instance.phase = 'running'; instance.multiplier = 12.34;
      instance.myBet = { amount: 987654 }; instance.cashoutPending = true;
      instance.liveFeed = [{ username: longName, multiplier: 12.34, amount: 987654 }];
      instance.updateUI?.(); instance.renderFeed?.(); instance.renderHistory?.();
    }
    if (screen === 'pachinko') {
      const results = document.getElementById('pachResults');
      if (results) results.innerHTML = `<div class="pach-result big-win"><span>220× championship multiplier</span><span>+987,654.32 credits</span></div>`.repeat(3);
    }
    if (screen === 'poker') {
      document.getElementById('createTableBtn')?.click();
      const name = document.getElementById('tableNameInput');
      if (name) name.value = 'Championship Table With A Very Long Mobile Name';
    }
    if (screen === 'poker-tables') {
      instance?.renderTablesList?.([{ tableId: 'qa-poker-table-with-long-id', name: 'International Championship Invitational Table With Long Name', smallBlind: 25, bigBlind: 50, minBuyIn: 1000, maxBuyIn: 5000, playerCount: 5, maxPlayers: 6 }]);
    }
    if (screen === 'cs2betting-populated' && instance) {
      instance.events = [{
        id: 'qa-cs2-event', status: 'live', bettingStatus: 'open',
        tournamentName: 'International Championship Organisation Major With A Long Name',
        homeTeam: 'International Championship Organisation With Long Name',
        awayTeam: 'Opponent Academy Roster With Long Name',
        commenceTime: new Date(Date.now() - 60000).toISOString(),
        odds: { team1: 12.345, team2: 1.234 }
      }];
      instance.renderEvents?.();
    }
  }, screen);
  await new Promise(resolve => setTimeout(resolve, 400));
}

async function measure(page, screen) {
  return page.evaluate(screenName => {
    const visible = element => {
      if (!(element instanceof Element)) return false;
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity) !== 0 && rect.width > 0 && rect.height > 0;
    };
    const details = element => {
      const rect = element.getBoundingClientRect();
      return {
        selector: element.id ? `#${element.id}` : `${element.tagName.toLowerCase()}.${String(element.className || '').trim().split(/\s+/).slice(0, 3).join('.')}`,
        text: String(element.innerText || element.getAttribute('aria-label') || '').trim().replace(/\s+/g, ' ').slice(0, 120),
        rect: { left: +rect.left.toFixed(1), top: +rect.top.toFixed(1), right: +rect.right.toFixed(1), bottom: +rect.bottom.toFixed(1), width: +rect.width.toFixed(1), height: +rect.height.toFixed(1) }
      };
    };
    const intentionallyClipped = element => element.closest('.rl-belt-wrapper,.case-shelf,.case-mode-nav,[aria-hidden="true"],.visually-hidden,.cs2-sr-only');
    const visibleElements = [...document.querySelectorAll('body *')].filter(element => visible(element) && !element.matches('.visually-hidden,.cs2-sr-only'));
    const viewportEscape = visibleElements.filter(element => {
      if (['HTML', 'BODY', 'SCRIPT', 'STYLE', 'PATH'].includes(element.tagName) || intentionallyClipped(element)) return false;
      const rect = element.getBoundingClientRect();
      return rect.left < -1 || rect.right > innerWidth + 1;
    }).map(details).slice(0, 80);
    const clippedText = visibleElements.filter(element => {
      if (!element.childNodes.length || ![...element.childNodes].some(node => node.nodeType === Node.TEXT_NODE && node.textContent.trim())) return false;
      const style = getComputedStyle(element);
      if (!['hidden', 'clip'].includes(style.overflowX)) return false;
      return element.scrollWidth > element.clientWidth + 1;
    }).map(details).slice(0, 80);
    const controls = [...document.querySelectorAll('button,input,select,textarea,a[href],[role="button"]')]
      .filter(element => visible(element) && !element.matches('.visually-hidden,.cs2-sr-only,input[type="checkbox"]'));
    const smallTargets = controls.filter(element => !element.disabled && (element.getBoundingClientRect().width < 43.5 || element.getBoundingClientRect().height < 43.5)).map(details).slice(0, 80);
    const bottomNav = document.querySelector('.neon-bottom-nav');
    const navRect = bottomNav && visible(bottomNav) ? bottomNav.getBoundingClientRect() : null;
    const navOverlaps = navRect ? controls.filter(element => {
      if (bottomNav.contains(element)) return false;
      const rect = element.getBoundingClientRect();
      return rect.left < navRect.right && rect.right > navRect.left && rect.top < navRect.bottom && rect.bottom > navRect.top;
    }).map(details).slice(0, 80) : [];
    const visibleRoot = document.querySelector('.game-view:not(.hidden), #gameSelection:not(.hidden), #loginSection:not(.hidden), #registerSection:not(.hidden)');
    return {
      screen: screenName,
      viewport: { width: innerWidth, height: innerHeight },
      document: { width: document.documentElement.scrollWidth, height: document.documentElement.scrollHeight },
      overflowX: document.documentElement.scrollWidth > innerWidth + 1,
      root: visibleRoot ? details(visibleRoot) : null,
      viewportEscape,
      clippedText,
      smallTargets,
      navOverlaps,
      activeGame: document.body.dataset.currentCasinoGame || null,
      lifecycle: window.__qaLifecycle || null
    };
  }, screen);
}

(async () => {
  const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] });
  const results = [];
  try {
    for (const viewport of viewports) {
      for (const screen of screens) {
        const page = await browser.newPage();
        await page.setViewport({ width: viewport.width, height: viewport.height, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
        if (viewport.reducedMotion) await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
        const consoleErrors = [];
        const pageErrors = [];
        page.on('console', message => { if (message.type() === 'error') consoleErrors.push(message.text().slice(0, 500)); });
        page.on('pageerror', error => pageErrors.push(String(error).slice(0, 500)));
        await prepare(page, screen);
        const metrics = await measure(page, screen);
        const screenshot = path.join(shotsDir, `${viewport.name}-${screen}.png`);
        await page.screenshot({ path: screenshot, fullPage: true });
        results.push({ viewport: viewport.name, screen, metrics, consoleErrors, pageErrors, screenshot });
        await page.close();
      }
    }
  } finally {
    await browser.close();
  }
  fs.writeFileSync(path.join(outputRoot, 'results.json'), JSON.stringify(results, null, 2));
  const summary = results.map(result => ({
    viewport: result.viewport,
    screen: result.screen,
    overflowX: result.metrics.overflowX,
    escape: result.metrics.viewportEscape.length,
    clippedText: result.metrics.clippedText.length,
    smallTargets: result.metrics.smallTargets.length,
    navOverlaps: result.metrics.navOverlaps.length,
    consoleErrors: result.consoleErrors.length,
    pageErrors: result.pageErrors.length,
    lifecycleDelta: result.metrics.lifecycle ? {
      listeners: result.metrics.lifecycle.after.listeners - result.metrics.lifecycle.before.listeners,
      intervals: result.metrics.lifecycle.after.intervals - result.metrics.lifecycle.before.intervals,
      rafs: result.metrics.lifecycle.after.rafs - result.metrics.lifecycle.before.rafs,
      sockets: result.metrics.lifecycle.after.sockets - result.metrics.lifecycle.before.sockets,
      nodes: result.metrics.lifecycle.after.nodes - result.metrics.lifecycle.before.nodes
    } : null
  }));
  fs.writeFileSync(path.join(outputRoot, 'summary.json'), JSON.stringify(summary, null, 2));
  console.log(JSON.stringify(summary, null, 2));
  if (results.some(result =>
    result.metrics.overflowX ||
    result.metrics.viewportEscape.length ||
    result.metrics.clippedText.length ||
    result.metrics.smallTargets.length ||
    result.metrics.navOverlaps.length ||
    (result.metrics.lifecycle && (
      result.metrics.lifecycle.after.listeners > result.metrics.lifecycle.before.listeners ||
      result.metrics.lifecycle.after.intervals > result.metrics.lifecycle.before.intervals ||
      result.metrics.lifecycle.after.rafs > result.metrics.lifecycle.before.rafs ||
      result.metrics.lifecycle.after.sockets > result.metrics.lifecycle.before.sockets ||
      result.metrics.lifecycle.after.nodes > result.metrics.lifecycle.before.nodes + 5
    )) ||
    result.consoleErrors.length ||
    result.pageErrors.length
  )) process.exitCode = 1;
})().catch(error => { console.error(error); process.exit(1); });
