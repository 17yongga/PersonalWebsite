'use strict';
const puppeteer = require('puppeteer');
const fs = require('node:fs');
const path = require('node:path');

(async () => {
  const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] });
  const outputDir = __dirname;
  const qaBaseUrl = process.env.BLACKJACK_QA_URL_BASE || 'http://127.0.0.1:8765/audits/blackjack-mobile-2026-08-02/blackjack-harness.html';
  const qaWidths = process.env.BLACKJACK_QA_WIDTHS
    ? JSON.parse(process.env.BLACKJACK_QA_WIDTHS)
    : [390, 393, 1280];
  const results = [];
  try {
    for (const width of qaWidths) {
      for (const state of ['wager', 'pair', 'long', 'split']) {
        const page = await browser.newPage();
        const height = width === 390 ? 844 : width === 393 ? 852 : 900;
        await page.setViewport({ width, height, deviceScaleFactor: 1 });
        const errors = [];
        page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
        page.on('pageerror', error => errors.push(error.message));
        page.on('requestfailed', request => errors.push(`${request.url()}: ${request.failure()?.errorText}`));
        await page.goto(`${qaBaseUrl}?state=${state}`, { waitUntil: 'networkidle0' });
        await page.screenshot({ path: path.join(outputDir, `viewport-${state}-${width}.png`) });
        await page.screenshot({ path: path.join(outputDir, `${state}-${width}.png`), fullPage: true });
        const metrics = await page.evaluate(() => {
          const rect = element => element ? (() => {
            const box = element.getBoundingClientRect();
            return { left: box.left, top: box.top, right: box.right, bottom: box.bottom, width: box.width, height: box.height };
          })() : null;
          const shell = rect(document.querySelector('.blackjack-table-shell'));
          const gameArea = rect(document.querySelector('.game-area'));
          const dealerSection = rect(document.querySelector('.dealer-section'));
          const playerSection = rect(document.querySelector('.player-section'));
          const resultDisplay = rect(document.querySelector('.result-display'));
          const gameControls = rect(document.querySelector('.game-controls'));
          const chips = [...document.querySelectorAll('.casino-chip')].map(rect);
          const visibleControls = [...document.querySelectorAll('.game-controls .btn:not(.hidden)')].map(element => ({ id: element.id, ...rect(element) }));
          const cards = [...document.querySelectorAll('.blackjack-card')].map(rect);
          const score = document.querySelector('.score-display>span:last-child');
          const hands = [...document.querySelectorAll('.blackjack-player-hand')].map(element => ({
            classes: element.className,
            badge: element.querySelector('.blackjack-hand-result')?.textContent || ''
          }));
          return {
            viewport: { width: innerWidth, height: innerHeight },
            documentWidth: document.documentElement.scrollWidth,
            documentHeight: document.documentElement.scrollHeight,
            shell,
            gameArea,
            dealerSection,
            playerSection,
            resultDisplay,
            gameControls,
            containerClasses: document.querySelector('.blackjack-container')?.className || '',
            chips,
            visibleControls,
            cards,
            cardsInsideShell: cards.every(card => card.left >= shell.left - .5 && card.right <= shell.right + .5 && card.top >= shell.top - .5 && card.bottom <= shell.bottom + .5),
            controlsEqual: visibleControls.length < 2 || visibleControls.every(control => Math.abs(control.width - visibleControls[0].width) < .5 && Math.abs(control.height - visibleControls[0].height) < .5),
            chipsCircular: chips.every(chip => Math.abs(chip.width - chip.height) < .5),
            scoreTextShadow: score ? getComputedStyle(score).textShadow : null,
            hands,
            dealerClasses: document.querySelector('.dealer-section')?.className || '',
            result: document.querySelector('#resultDisplay')?.textContent || ''
          };
        });
        let interaction = null;
        if (state === 'wager') {
          interaction = { selections: [], keyboard: [], dealRequest: null, statusText: '' };
          for (const amount of [50, 100, 250, 500]) {
            await page.click(`.quick-bet-btn[data-amount="${amount}"]`);
            interaction.selections.push(await page.evaluate(expected => ({
              expected,
              value: Number(document.querySelector('#blackjackBet')?.value),
              pressed: [...document.querySelectorAll('.quick-bet-btn[aria-pressed="true"]')].map(chip => Number(chip.dataset.amount)),
              status: document.querySelector('#blackjackStakeStatus')?.textContent?.trim() || ''
            }), amount));
          }
          for (const [amount, key] of [[250, 'Enter'], [100, 'Space']]) {
            await page.focus(`.quick-bet-btn[data-amount="${amount}"]`);
            await page.keyboard.press(key);
            interaction.keyboard.push(await page.evaluate((expected, activationKey) => ({
              expected,
              key: activationKey,
              value: Number(document.querySelector('#blackjackBet')?.value),
              pressed: [...document.querySelectorAll('.quick-bet-btn[aria-pressed="true"]')].map(chip => Number(chip.dataset.amount))
            }), amount, key));
          }
          await page.evaluate(() => {
            window.__blackjackDealRequest = null;
            window.__blackjackGame.casino.apiFetch = async (url, options = {}) => {
              window.__blackjackDealRequest = { url, method: options.method, body: JSON.parse(options.body || '{}') };
              return { ok: false, json: async () => ({ error: 'QA request captured' }) };
            };
          });
          await page.click('.quick-bet-btn[data-amount="250"]');
          await page.click('#placeBetBtn');
          await page.waitForFunction(() => window.__blackjackDealRequest !== null);
          interaction.dealRequest = await page.evaluate(() => window.__blackjackDealRequest);
          interaction.statusText = await page.evaluate(() => document.querySelector('#blackjackStakeStatus')?.textContent?.trim() || '');
        }
        results.push({ width, state, errors, metrics, interaction });
        await page.close();
      }
    }
  } finally {
    await browser.close();
  }
  fs.writeFileSync(path.join(outputDir, 'metrics.json'), JSON.stringify(results, null, 2));
  const failures = results.flatMap(result => {
    const issues = [];
    if (result.errors.length) issues.push(`errors=${result.errors.join('|')}`);
    if (result.metrics.documentWidth !== result.width) issues.push(`overflow=${result.metrics.documentWidth - result.width}`);
    if (!result.metrics.chipsCircular) issues.push('chips-not-circular');
    if (result.interaction) {
      for (const selection of [...result.interaction.selections, ...result.interaction.keyboard]) {
        if (selection.value !== selection.expected) issues.push(`chip-${selection.key || 'tap'}-${selection.expected}-set-${selection.value}`);
        if (selection.pressed.length !== 1 || selection.pressed[0] !== selection.expected) issues.push(`chip-${selection.expected}-pressed-${selection.pressed.join(',') || 'none'}`);
      }
      if (!result.interaction.selections.every(selection => selection.status.includes(String(selection.expected)))) issues.push('chip-selection-status-not-updated');
      if (result.interaction.dealRequest?.url !== '/api/games/blackjack/start' || result.interaction.dealRequest?.method !== 'POST' || result.interaction.dealRequest?.body?.bet !== 250) issues.push(`deal-payload=${JSON.stringify(result.interaction.dealRequest)}`);
      if (!result.interaction.statusText.includes('250')) issues.push(`deal-status=${result.interaction.statusText || 'missing'}`);
    }
    if (!result.metrics.cardsInsideShell) issues.push('cards-outside-shell');
    if (!result.metrics.controlsEqual) issues.push('controls-not-equal');
    if (result.state === 'split' && !result.metrics.hands.some(hand => hand.classes.includes('is-winner'))) issues.push('split-winner-not-highlighted');
    if (result.state === 'split' && !result.metrics.hands.some(hand => hand.classes.includes('is-loser'))) issues.push('split-loser-not-muted');
    if (result.state !== 'wager' && result.metrics.containerClasses.includes('is-wagering')) issues.push('stale-wagering-layout-state');
    if (result.width <= 400 && result.state === 'wager') {
      if (!result.metrics.containerClasses.includes('is-wagering')) issues.push('missing-wagering-layout-state');
      if (result.metrics.gameArea.height > 140) issues.push(`wager-game-area-too-tall=${result.metrics.gameArea.height}`);
      if (result.metrics.shell.height > 500) issues.push(`wager-shell-too-tall=${result.metrics.shell.height}`);
      if (result.metrics.documentHeight > result.metrics.viewport.height) issues.push(`wager-document-scroll=${result.metrics.documentHeight - result.metrics.viewport.height}`);
      if (result.metrics.resultDisplay.height > .5) issues.push(`empty-result-reserves-space=${result.metrics.resultDisplay.height}`);
      if (result.metrics.gameControls.height > .5) issues.push(`empty-controls-reserve-space=${result.metrics.gameControls.height}`);
      if (result.metrics.dealerSection.height > 120) issues.push(`empty-dealer-too-tall=${result.metrics.dealerSection.height}`);
      if (result.metrics.playerSection.height > 120) issues.push(`empty-player-too-tall=${result.metrics.playerSection.height}`);
    }
    return issues.map(issue => `${result.width}/${result.state}: ${issue}`);
  });
  const mobile = Object.fromEntries(results.filter(result => result.width === 390).map(result => [result.state, result.metrics]));
  if (Math.abs(mobile.wager.gameArea.top - mobile.pair.gameArea.top) > 1) failures.push(`390/layout-shift: ${mobile.wager.gameArea.top} -> ${mobile.pair.gameArea.top}`);
  console.log(JSON.stringify({ cases: results.length, failures, mobileGameAreaTops: Object.fromEntries(Object.entries(mobile).map(([state, value]) => [state, value.gameArea.top])) }, null, 2));
  if (failures.length) process.exitCode = 1;
})();
