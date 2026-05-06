const fs = require('fs');
const http = require('http');
const path = require('path');
const puppeteer = require(path.resolve(process.cwd(), 'node_modules/puppeteer'));

const ROOT = path.resolve(__dirname, '..', '..');
const PACK = path.resolve(__dirname, '..');
const SCREENSHOT_ROOT = path.join(PACK, 'screenshots');
const DATA_DIR = path.join(PACK, 'data');

const VIEWPORTS = {
  desktop: { width: 1440, height: 1000, deviceScaleFactor: 1, isMobile: false },
  mobile: { width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
  tablet: { width: 820, height: 1180, deviceScaleFactor: 1, isMobile: false, hasTouch: true }
};

const SCREENSHOTS = [];

function ensureDirs() {
  for (const dir of [
    SCREENSHOT_ROOT,
    path.join(SCREENSHOT_ROOT, 'desktop'),
    path.join(SCREENSHOT_ROOT, 'mobile'),
    path.join(SCREENSHOT_ROOT, 'tablet'),
    DATA_DIR
  ]) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function mimeFor(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  return {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon',
    '.woff': 'font/woff',
    '.woff2': 'font/woff2',
    '.ttf': 'font/ttf'
  }[ext] || 'application/octet-stream';
}

function startStaticServer() {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const requestUrl = new URL(req.url, 'http://127.0.0.1');
      let pathname = decodeURIComponent(requestUrl.pathname);
      if (pathname === '/') pathname = '/casino.html';

      const target = path.resolve(ROOT, '.' + pathname.replace(/\//g, path.sep));
      if (!target.startsWith(ROOT)) {
        res.writeHead(403);
        res.end('Forbidden');
        return;
      }

      fs.stat(target, (statErr, stat) => {
        if (statErr || !stat.isFile()) {
          res.writeHead(404);
          res.end('Not found');
          return;
        }

        res.writeHead(200, {
          'Content-Type': mimeFor(target),
          'Cache-Control': 'no-store'
        });
        fs.createReadStream(target).pipe(res);
      });
    });

    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({ server, baseUrl: `http://127.0.0.1:${port}/casino.html?marketing=${Date.now()}` });
    });
  });
}

function browserMockScript() {
  return `
(() => {
  const now = Date.now();
  const plusHours = hours => new Date(now + hours * 3600000).toISOString();
  const minusHours = hours => new Date(now - hours * 3600000).toISOString();
  const profile = { username: 'StudioDemo', credits: 18420 };

  const history = [
    { game: 'blackjack', bet: 250, payout: 625, multiplier: 2.5, result: 'Blackjack', timestamp: minusHours(1) },
    { game: 'cs2betting', bet: 500, payout: 910, multiplier: 1.82, result: 'MOUZ NXT won', timestamp: minusHours(3) },
    { game: 'crash', bet: 100, payout: 440, multiplier: 4.4, result: 'Cashed out', timestamp: minusHours(6) },
    { game: 'roulette', bet: 200, payout: 0, multiplier: 0, result: 'Black missed', timestamp: minusHours(9) },
    { game: 'pachinko', bet: 150, payout: 900, multiplier: 6, result: 'High slot', timestamp: minusHours(18) },
    { game: 'coinflip', bet: 300, payout: 600, multiplier: 2, result: 'Heads', timestamp: minusHours(30) },
    { game: 'poker', bet: 800, payout: 1450, multiplier: 1.81, result: 'Two pair', timestamp: minusHours(42) }
  ];

  const leaderboard = [
    { username: 'neon_nova', gamesPlayed: 138, winRate: 61, netPL: 38400, biggestWin: 18400 },
    { username: 'StudioDemo', gamesPlayed: 72, winRate: 57, netPL: 12450, biggestWin: 6200 },
    { username: 'ace_spades', gamesPlayed: 95, winRate: 52, netPL: 8800, biggestWin: 12000 },
    { username: 'cherrybomb', gamesPlayed: 42, winRate: 48, netPL: -2100, biggestWin: 4800 }
  ];

  const achievements = [
    { id: 'first_win', name: 'First Win', icon: '*', description: 'Win your first bet', earned: true },
    { id: 'high_roller', name: 'High Roller', icon: '$', description: 'Place a 5,000 credit bet', earned: true },
    { id: 'hot_streak', name: 'Hot Streak', icon: 'x3', description: 'Win three games in a row', earned: true },
    { id: 'blackjack_pro', name: 'Blackjack Pro', icon: '21', description: 'Hit blackjack five times', earned: false },
    { id: 'casino_king', name: 'Casino King', icon: 'K', description: 'Reach 100,000 credits', earned: false },
    { id: 'cs2_oracle', name: 'CS2 Oracle', icon: 'CS2', description: 'Win ten match bets', earned: false }
  ];

  const stats = {
    totalGames: 72,
    winRate: 57,
    netPL: 12450,
    rank: 2,
    biggestWin: 6200,
    currentStreak: 4,
    bestStreak: 8,
    favoriteGame: 'CS2 Betting',
    weeklyStats: { gamesPlayed: 18, totalWagered: 9400, totalWon: 12850 },
    gameBreakdown: {
      blackjack: { played: 16, won: 10 },
      roulette: { played: 8, won: 3 },
      coinflip: { played: 10, won: 6 },
      crash: { played: 12, won: 7 },
      poker: { played: 6, won: 3 },
      pachinko: { played: 7, won: 4 },
      cs2betting: { played: 13, won: 8 }
    }
  };

  const events = [
    {
      id: 'marketing_mouz_furia',
      homeTeam: 'MOUZ NXT',
      awayTeam: 'FURIA Academy',
      tournamentName: 'ESL Challenger League',
      commenceTime: plusHours(8),
      status: 'scheduled',
      bestOf: '3',
      hasOdds: true,
      odds: { team1: 1.82, team2: 2.04 }
    },
    {
      id: 'marketing_navi_liquid',
      homeTeam: 'NAVI Junior',
      awayTeam: 'Liquid Academy',
      tournamentName: 'BLAST Rising',
      commenceTime: plusHours(15),
      status: 'scheduled',
      bestOf: '3',
      hasOdds: true,
      odds: { team1: 1.46, team2: 2.72 }
    },
    {
      id: 'marketing_pain_genone',
      homeTeam: 'paiN Academy',
      awayTeam: 'GenOne',
      tournamentName: 'CCT Europe Series',
      commenceTime: plusHours(26),
      status: 'scheduled',
      bestOf: '1',
      hasOdds: true,
      odds: { team1: 2.35, team2: 1.58 }
    }
  ];

  const cs2Bets = [
    { id: 'bet-open-001', eventId: 'marketing_mouz_furia', homeTeam: 'MOUZ NXT', awayTeam: 'FURIA Academy', selection: 'team1', selectionName: 'MOUZ NXT', amount: 500, odds: 1.82, potentialPayout: 910, status: 'pending', placedAt: minusHours(2) },
    { id: 'bet-won-002', eventId: 'marketing_navi_liquid', homeTeam: 'NAVI Junior', awayTeam: 'Liquid Academy', selection: 'team2', selectionName: 'Liquid Academy', amount: 300, odds: 2.48, potentialPayout: 744, status: 'won', placedAt: minusHours(24), settledAt: minusHours(20) },
    { id: 'bet-lost-003', eventId: 'marketing_pain_genone', homeTeam: 'paiN Academy', awayTeam: 'GenOne', selection: 'team1', selectionName: 'paiN Academy', amount: 200, odds: 1.91, potentialPayout: 382, status: 'lost', placedAt: minusHours(48), settledAt: minusHours(44) }
  ];

  const rouletteState = {
    currentBets: {
      p1: { playerName: 'neon_nova', color: 'red', amount: 500 },
      p2: { playerName: 'ace_spades', color: 'black', amount: 250 },
      p3: { playerName: 'StudioDemo', color: 'green', amount: 100 }
    },
    nextSpinTime: now + 18000,
    history: [
      { number: 7, color: 'red' },
      { number: 2, color: 'black' },
      { number: 0, color: 'green' },
      { number: 11, color: 'red' }
    ],
    lastResult: { number: 7, color: 'red' },
    spinning: false
  };

  const rooms = [
    { id: 'ROOM777', betAmount: 500, creatorChoice: 'heads', creatorName: 'neon_nova', players: ['neon_nova'] },
    { id: 'VIP21', betAmount: 1200, creatorChoice: 'tails', creatorName: 'ace_spades', players: ['ace_spades'] }
  ];

  const pokerTables = [
    { tableId: 'table_marketing_1', tableName: 'Neon High Roller', smallBlind: 25, bigBlind: 50, minBuyIn: 1000, maxBuyIn: 5000, playerCount: 4, maxPlayers: 6, gameState: 'waiting', isPrivate: false },
    { tableId: 'table_marketing_2', tableName: 'Midnight Holdem', smallBlind: 10, bigBlind: 20, minBuyIn: 400, maxBuyIn: 2000, playerCount: 2, maxPlayers: 6, gameState: 'playing', isPrivate: false }
  ];

  const crashState = {
    phase: 'running',
    multiplier: 2.47,
    history: [1.14, 3.55, 1.78, 8.2, 2.01, 4.4, 1.03, 6.7],
    bettingTimeLeft: 0,
    startTime: now - 4000,
    bets: {
      a: { username: 'neon_nova', amount: 300, cashedOut: true, cashoutMultiplier: 2.2 },
      b: { username: 'cherrybomb', amount: 150, cashedOut: true, cashoutMultiplier: 1.8 }
    }
  };

  function fire(listeners, event, ...args) {
    (listeners[event] || []).slice().forEach(fn => {
      try { fn(...args); } catch (error) { console.error('[marketing mock]', event, error); }
    });
  }

  function makeSocket() {
    const listeners = {};
    const socket = {
      id: 'marketing-socket-1',
      connected: true,
      on(event, handler) {
        if (!listeners[event]) listeners[event] = [];
        listeners[event].push(handler);
        if (event === 'connect') setTimeout(() => handler(), 10);
        if (event === 'rouletteState') setTimeout(() => handler(rouletteState), 30);
        if (event === 'availableRooms') setTimeout(() => handler(rooms), 30);
        if (event === 'pokerTablesUpdate') setTimeout(() => handler(pokerTables), 30);
        if (event === 'crashState') setTimeout(() => handler(crashState), 30);
        return this;
      },
      off(event, handler) {
        if (!listeners[event]) return this;
        listeners[event] = listeners[event].filter(fn => fn !== handler);
        return this;
      },
      removeAllListeners(event) {
        if (event) listeners[event] = [];
        return this;
      },
      emit(event, ...args) {
        const cb = typeof args[args.length - 1] === 'function' ? args.pop() : null;
        if (event === 'joinCasino') {
          setTimeout(() => fire(listeners, 'playerData', { username: profile.username, credits: profile.credits }), 20);
          setTimeout(() => fire(listeners, 'rouletteState', rouletteState), 40);
        }
        if (event === 'joinGame') setTimeout(() => fire(listeners, 'availableRooms', rooms), 20);
        if (event === 'joinCrash') setTimeout(() => fire(listeners, 'crashState', crashState), 20);
        if (event === 'joinPokerLobby') setTimeout(() => fire(listeners, 'pokerTablesUpdate', pokerTables), 20);
        if (event === 'getBetHistory' && cb) setTimeout(() => cb(history), 20);
        if (event === 'getLeaderboard' && cb) setTimeout(() => cb(leaderboard), 20);
        if (event === 'getGameLeaderboard' && cb) {
          const game = args[0]?.game || 'blackjack';
          setTimeout(() => cb(leaderboard.map((p, i) => ({
            username: p.username,
            played: Math.max(8, p.gamesPlayed - i * 12),
            winRate: p.winRate,
            score: Math.max(1200, p.biggestWin - i * 700),
            metric: game === 'crash' ? 'best cashout' : 'top score'
          }))), 20);
        }
        if (event === 'getAchievements' && cb) setTimeout(() => cb({ available: achievements }), 20);
        if (event === 'getUserStats' && cb) setTimeout(() => cb(stats), 20);
        return this;
      },
      disconnect() {
        this.connected = false;
        fire(listeners, 'disconnect', 'marketing-demo');
      }
    };
    return socket;
  }

  const sharedSocket = makeSocket();
  window.io = function io() {
    return sharedSocket;
  };
  window.__marketingSocket = sharedSocket;

  const originalFetch = window.fetch ? window.fetch.bind(window) : null;
  function json(data, status = 200) {
    return Promise.resolve(new Response(JSON.stringify(data), {
      status,
      headers: { 'Content-Type': 'application/json' }
    }));
  }

  window.fetch = function(input, init) {
    const href = typeof input === 'string' ? input : input.url;
    const url = new URL(href, window.location.href);
    if (url.pathname === '/api/login') return json({ success: true, username: profile.username, credits: profile.credits });
    if (url.pathname === '/api/register') return json({ success: true, username: profile.username });
    if (url.pathname === '/api/cs2/balance') return json({ success: true, balance: profile.credits });
    if (url.pathname === '/api/cs2/events') return json({ success: true, events });
    if (url.pathname.match(/\\/api\\/cs2\\/events\\/[^/]+\\/odds$/)) {
      const eventId = url.pathname.split('/')[4];
      const event = events.find(e => e.id === eventId) || events[0];
      return json({ success: true, event });
    }
    if (url.pathname === '/api/cs2/bets') {
      return json({
        success: true,
        bets: cs2Bets,
        currentBalance: profile.credits,
        totalWagered: 1000,
        totalWon: 744,
        netProfit: -256,
        winRate: 33
      });
    }
    if (url.pathname === '/api/cs2/sync') return json({ success: true, newCount: 2, updatedCount: 1 });
    if (url.pathname === '/api/cs2/bets' && init?.method === 'POST') return json({ success: true });
    return originalFetch ? originalFetch(input, init) : json({ success: true });
  };
})();
`;
}

async function newPage(browser, baseUrl, viewportName) {
  const page = await browser.newPage();
  await page.setViewport(VIEWPORTS[viewportName]);
  await page.evaluateOnNewDocument(browserMockScript());
  await page.setRequestInterception(true);
  page.on('request', req => {
    const reqUrl = req.url();
    if (reqUrl.includes('cdn.socket.io')) {
      req.respond({ status: 200, contentType: 'application/javascript', body: 'window.io = window.io || function(){ return window.__marketingSocket; };' });
      return;
    }
    if (reqUrl.includes('fonts.googleapis.com') || reqUrl.includes('fonts.gstatic.com')) {
      req.respond({ status: 200, contentType: 'text/css', body: '' });
      return;
    }
    req.continue();
  });
  await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#signInScreen', { visible: true, timeout: 15000 });
  await settle(page);
  return page;
}

async function settle(page, ms = 700) {
  await new Promise(resolve => setTimeout(resolve, ms));
}

async function setLoggedIn(page) {
  await page.evaluate(() => {
    const manager = (typeof casinoManager !== 'undefined' && casinoManager) || window.casinoManager || new window.CasinoManager();
    window.__marketingCasinoManager = manager;
    manager.username = 'StudioDemo';
    manager.credits = 18420;
    manager.socket = window.__marketingSocket || window.io('marketing');
    manager.socket.connected = true;
    sessionStorage.setItem('casinoUsername', manager.username);
    manager.showMainScreen();
    manager.updateCreditsDisplay();
    manager.renderFloorChat?.();
  });
  await page.waitForSelector('#gameSelection:not(.hidden)', { visible: true, timeout: 10000 });
  await settle(page, 600);
}

async function openGame(page, game) {
  await setLoggedIn(page);
  await page.evaluate(gameName => {
    const manager = window.__marketingCasinoManager || (typeof casinoManager !== 'undefined' ? casinoManager : null);
    manager.startGame(gameName);
  }, game);
  const id = game === 'cs2betting' ? 'cs2BettingGame' : `${game}Game`;
  await page.waitForSelector(`#${id}:not(.hidden)`, { visible: true, timeout: 12000 });
  await settle(page, 1200);
}

async function screenshot(page, group, filename, title, viewportName, purpose, fullPage = false) {
  const target = path.join(SCREENSHOT_ROOT, group, filename);
  await page.screenshot({ path: target, fullPage });
  const stat = fs.statSync(target);
  SCREENSHOTS.push({
    file: path.relative(PACK, target).replace(/\\/g, '/'),
    title,
    viewport: viewportName,
    dimensions: `${VIEWPORTS[viewportName].width}x${VIEWPORTS[viewportName].height}`,
    purpose,
    bytes: stat.size
  });
}

async function run() {
  ensureDirs();
  const { server, baseUrl } = await startStaticServer();
  let browser;
  try {
    const chromePath = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
    const launchOptions = {
      headless: 'new',
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    };
    if (fs.existsSync(chromePath)) launchOptions.executablePath = chromePath;
    browser = await puppeteer.launch(launchOptions);

    let page = await newPage(browser, baseUrl, 'desktop');
    await screenshot(page, 'desktop', '01-desktop-login-welcome.png', 'Desktop login and welcome bonus', 'desktop', 'First impression, brand panel, login entry point');
    await page.click('#registerTab');
    await settle(page);
    await screenshot(page, 'desktop', '02-desktop-register-account-creation.png', 'Desktop register form', 'desktop', 'Account creation, welcome credit framing');
    await page.close();

    page = await newPage(browser, baseUrl, 'desktop');
    await setLoggedIn(page);
    await screenshot(page, 'desktop', '03-desktop-lobby-hero-balance.png', 'Desktop lobby hero and player balance', 'desktop', 'Main floor hero, game promise, account state');
    await page.evaluate(() => document.querySelector('.lobby-section-header')?.scrollIntoView({ block: 'start' }));
    await settle(page);
    await screenshot(page, 'desktop', '04-desktop-lobby-game-grid-sidebar.png', 'Desktop game grid and social sidebar', 'desktop', 'Game catalog, filters, live floor context');
    await page.evaluate(() => (window.__marketingCasinoManager || casinoManager).showLeaderboard());
    await page.waitForSelector('#leaderboardModal', { visible: true, timeout: 10000 });
    await settle(page);
    await screenshot(page, 'desktop', '05-desktop-leaderboard-modal.png', 'Desktop leaderboard modal', 'desktop', 'Retention, competition, ranked-player proof point');
    await page.close();

    page = await newPage(browser, baseUrl, 'desktop');
    await openGame(page, 'blackjack');
    await page.click('#placeBetBtn').catch(() => {});
    await settle(page, 1800);
    await screenshot(page, 'desktop', '06-desktop-blackjack-table.png', 'Desktop blackjack table in play', 'desktop', 'Card game interface and betting controls');
    await page.close();

    page = await newPage(browser, baseUrl, 'desktop');
    await openGame(page, 'roulette');
    await screenshot(page, 'desktop', '07-desktop-roulette-live-wheel.png', 'Desktop roulette wheel and betting panel', 'desktop', 'Live-game energy, wheel, round state, wager panel');
    await page.close();

    page = await newPage(browser, baseUrl, 'desktop');
    await openGame(page, 'crash');
    await screenshot(page, 'desktop', '08-desktop-crash-multiplier.png', 'Desktop crash multiplier', 'desktop', 'Fast-action multiplier game and live feed');
    await page.close();

    page = await newPage(browser, baseUrl, 'desktop');
    await openGame(page, 'cs2betting');
    await page.waitForSelector('.cs2-event-card, .cs2-empty-state', { visible: true, timeout: 12000 });
    await settle(page, 1000);
    await screenshot(page, 'desktop', '09-desktop-cs2-match-betting.png', 'Desktop CS2 match betting board', 'desktop', 'Esports betting market, odds cards, tournament grouping');
    const odds = await page.$('.odds-pill:not(.disabled)');
    if (odds) {
      await odds.click();
      await page.waitForSelector('#cs2BetSlipModal.open', { visible: true, timeout: 10000 });
      await settle(page, 700);
      await screenshot(page, 'desktop', '10-desktop-cs2-betslip.png', 'Desktop CS2 bet slip', 'desktop', 'Bet confirmation, stake entry, potential payout');
    }
    await page.close();

    page = await newPage(browser, baseUrl, 'mobile');
    await screenshot(page, 'mobile', '11-mobile-login-welcome.png', 'Mobile login welcome screen', 'mobile', 'Mobile first impression and compact auth');
    await setLoggedIn(page);
    await screenshot(page, 'mobile', '12-mobile-lobby-hero.png', 'Mobile lobby hero', 'mobile', 'Responsive hero, player balance, bottom navigation');
    await page.evaluate(() => document.querySelector('.lobby-section-header')?.scrollIntoView({ block: 'start' }));
    await settle(page);
    await screenshot(page, 'mobile', '13-mobile-game-grid-bottom-nav.png', 'Mobile game grid and bottom nav', 'mobile', 'Scrollable mobile catalog and persistent navigation');
    await page.click('#mobileMenuToggle');
    await settle(page);
    await screenshot(page, 'mobile', '14-mobile-account-menu.png', 'Mobile account menu', 'mobile', 'Mobile account actions and retention surfaces');
    await page.evaluate(() => (window.__marketingCasinoManager || casinoManager).showBetHistory());
    await page.waitForSelector('#betHistoryModal', { visible: true, timeout: 10000 });
    await settle(page);
    await screenshot(page, 'mobile', '15-mobile-bet-history.png', 'Mobile bet history modal', 'mobile', 'Player activity, wager summary, proof of platform depth');
    await page.close();

    page = await newPage(browser, baseUrl, 'mobile');
    await openGame(page, 'pachinko');
    await screenshot(page, 'mobile', '16-mobile-pachinko-game.png', 'Mobile pachinko board', 'mobile', 'Mobile game layout, risk controls, animated board');
    await page.close();

    page = await newPage(browser, baseUrl, 'mobile');
    await openGame(page, 'poker');
    await screenshot(page, 'mobile', '17-mobile-poker-lobby.png', 'Mobile poker lobby', 'mobile', 'Multiplayer table discovery and buy-in framing');
    await page.close();

    page = await newPage(browser, baseUrl, 'tablet');
    await setLoggedIn(page);
    await page.evaluate(() => (window.__marketingCasinoManager || casinoManager).showStats());
    await page.waitForSelector('#statsModal', { visible: true, timeout: 10000 });
    await settle(page);
    await screenshot(page, 'tablet', '18-tablet-player-stats.png', 'Tablet player stats modal', 'tablet', 'Mid-size analytics, player performance, retention hooks');
    await page.close();

    fs.writeFileSync(path.join(DATA_DIR, 'screenshot_manifest.json'), JSON.stringify({
      generatedAt: new Date().toISOString(),
      source: 'Current casino.html frontend served from local static preview with mocked marketing demo API/socket data',
      screenshotCount: SCREENSHOTS.length,
      screenshots: SCREENSHOTS
    }, null, 2));

    console.log(JSON.stringify({ baseUrl, screenshotCount: SCREENSHOTS.length, out: PACK }, null, 2));
  } finally {
    if (browser) await browser.close();
    server.close();
  }
}

run().catch(error => {
  console.error(error);
  process.exit(1);
});
