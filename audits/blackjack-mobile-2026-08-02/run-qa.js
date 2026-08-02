'use strict';
const puppeteer = require('puppeteer');
const fs = require('node:fs');
const path = require('node:path');

(async () => {
  const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] });
  const outputDir = __dirname;
  const qaBaseUrl = process.env.BLACKJACK_QA_URL_BASE || 'http://127.0.0.1:8765/audits/blackjack-mobile-2026-08-02/blackjack-harness.html';
  const results = [];
  try {
    for (const width of [390, 1280]) {
      for (const state of ['wager', 'pair', 'long', 'split']) {
        const page = await browser.newPage();
        await page.setViewport({ width, height: width === 390 ? 844 : 900, deviceScaleFactor: 1 });
        const errors = [];
        page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
        page.on('pageerror', error => errors.push(error.message));
        page.on('requestfailed', request => errors.push(`${request.url()}: ${request.failure()?.errorText}`));
        await page.goto(`${qaBaseUrl}?state=${state}`, { waitUntil: 'networkidle0' });
        await page.screenshot({ path: path.join(outputDir, `${state}-${width}.png`), fullPage: true });
        const metrics = await page.evaluate(() => {
          const rect = element => element ? (() => {
            const box = element.getBoundingClientRect();
            return { left: box.left, top: box.top, right: box.right, bottom: box.bottom, width: box.width, height: box.height };
          })() : null;
          const shell = rect(document.querySelector('.blackjack-table-shell'));
          const gameArea = rect(document.querySelector('.game-area'));
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
            shell,
            gameArea,
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
        results.push({ width, state, errors, metrics });
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
    if (!result.metrics.cardsInsideShell) issues.push('cards-outside-shell');
    if (!result.metrics.controlsEqual) issues.push('controls-not-equal');
    if (result.state === 'split' && !result.metrics.hands.some(hand => hand.classes.includes('is-winner'))) issues.push('split-winner-not-highlighted');
    if (result.state === 'split' && !result.metrics.hands.some(hand => hand.classes.includes('is-loser'))) issues.push('split-loser-not-muted');
    return issues.map(issue => `${result.width}/${result.state}: ${issue}`);
  });
  const mobile = Object.fromEntries(results.filter(result => result.width === 390).map(result => [result.state, result.metrics]));
  if (Math.abs(mobile.wager.gameArea.top - mobile.pair.gameArea.top) > 1) failures.push(`390/layout-shift: ${mobile.wager.gameArea.top} -> ${mobile.pair.gameArea.top}`);
  console.log(JSON.stringify({ cases: results.length, failures, mobileGameAreaTops: Object.fromEntries(Object.entries(mobile).map(([state, value]) => [state, value.gameArea.top])) }, null, 2));
  if (failures.length) process.exitCode = 1;
})();
