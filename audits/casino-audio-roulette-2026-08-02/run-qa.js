'use strict';

const fs = require('node:fs');
const path = require('node:path');
const puppeteer = require('puppeteer');

const outDir = __dirname;
const url = process.env.CASINO_QA_URL || 'http://127.0.0.1:8766/audits/casino-audio-roulette-2026-08-02/harness.html';

(async () => {
  const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
  const page = await browser.newPage();
  const problems = [];
  page.on('console', message => {
    if (message.type() === 'error') problems.push(`console: ${message.text()}`);
  });
  page.on('pageerror', error => problems.push(`pageerror: ${error.message}`));
  page.on('requestfailed', request => problems.push(`requestfailed: ${request.url()} ${request.failure()?.errorText || ''}`));

  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 1 });
  await page.goto(url, { waitUntil: 'networkidle0' });
  await page.waitForFunction(() => window.qaGame?.roundId === 'roulette_qa_round');
  await page.mouse.click(5, 5);

  await page.click('#rlBetRed');
  await page.waitForFunction(() => window.qaGame.currentBet?.color === 'red' && !window.qaGame.betMutationPending);
  await page.click('.rl-quick-btn[data-amount="250"]');
  await page.click('#rlBetBlack');
  await page.waitForFunction(() => window.qaGame.currentBet?.color === 'black' && !window.qaGame.betMutationPending);
  await page.evaluate(() => window.qaSocket.fire('rouletteBetsUpdate', {
    roundId: 'roulette_stale_round',
    bets: { stale: { playerName: 'QA_User', color: 'green', amount: 999 } }
  }));

  const activeMetrics = await page.evaluate(() => ({
    roundId: window.qaGame.roundId,
    activeText: document.getElementById('rlActiveBetText')?.textContent,
    blackSelected: document.getElementById('rlBetBlack')?.classList.contains('rl-btn-active'),
    redSelected: document.getElementById('rlBetRed')?.classList.contains('rl-btn-active'),
    horizontalOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
    effects: window.qaSounds.map(event => event.effect),
    emittedEvents: window.qaSocket.emits.map(item => item.event)
  }));
  await page.screenshot({ path: path.join(outDir, 'roulette-replaced-390.png'), fullPage: true });

  await page.setViewport({ width: 1280, height: 900, deviceScaleFactor: 1 });
  await page.screenshot({ path: path.join(outDir, 'roulette-replaced-1280.png'), fullPage: true });

  await page.click('#rlClearBet');
  await page.waitForFunction(() => window.qaGame.currentBet === null && !window.qaGame.betMutationPending);
  await page.evaluate(() => { window.qaSocket.rejectNext = true; });
  await page.click('#rlBetGreen');
  await page.waitForFunction(() => !window.qaGame.betMutationPending);

  const initialContexts = await page.evaluate(() => {
    const count = window.qaAudioContexts.length;
    window.casinoSound.context.state = 'closed';
    return count;
  });
  await page.mouse.click(5, 5);
  const lifecycle = await page.evaluate(async initialContextCount => {
    const recreatedContexts = window.qaAudioContexts.length;
    const unknown = window.casinoSound.play('not-a-real-effect', { game: 'roulette' });
    window.qaGame.setupSocketListeners();
    window.qaGame.setupSocketListeners();
    const listenerCountsBeforeDestroy = window.qaSocket.listenerCounts();
    const effects = window.qaSounds.map(event => event.effect);
    const acceptedCount = effects.filter(effect => effect === 'betPlaced').length;
    const replacedCount = effects.filter(effect => effect === 'betReplaced').length;
    const cancelledCount = effects.filter(effect => effect === 'betCancelled').length;
    const errorCount = effects.filter(effect => effect === 'error').length;
    window.qaGame.destroy();
    const listenerCountsAfterDestroy = window.qaSocket.listenerCounts();
    return {
      initialContexts: initialContextCount, recreatedContexts, unknown,
      diagnosticsLength: window.casinoSound.diagnostics.length,
      lastFailure: window.casinoSound.lastFailure?.reason,
      acceptedCount, replacedCount, cancelledCount, errorCount,
      listenerCountsBeforeDestroy, listenerCountsAfterDestroy,
      timerCleared: window.qaGame.timerInterval === null
    };
  }, initialContexts);

  const failures = [];
  if (activeMetrics.roundId !== 'roulette_qa_round') failures.push(`stale round update replaced ${activeMetrics.roundId}`);
  if (activeMetrics.activeText !== 'BLACK — 250 credits') failures.push(`active text: ${activeMetrics.activeText}`);
  if (!activeMetrics.blackSelected || activeMetrics.redSelected) failures.push('authoritative replacement selection mismatch');
  if (activeMetrics.horizontalOverflow) failures.push('mobile horizontal overflow');
  if (!activeMetrics.emittedEvents.includes('setRouletteBet')) failures.push('missing setRouletteBet mutation');
  if (lifecycle.acceptedCount !== 1) failures.push(`accepted cue count ${lifecycle.acceptedCount}`);
  if (lifecycle.replacedCount !== 1) failures.push(`replacement cue count ${lifecycle.replacedCount}`);
  if (lifecycle.cancelledCount !== 1) failures.push(`cancel cue count ${lifecycle.cancelledCount}`);
  if (lifecycle.errorCount !== 1) failures.push(`rejection cue count ${lifecycle.errorCount}`);
  if (lifecycle.recreatedContexts !== lifecycle.initialContexts + 1) failures.push('closed AudioContext did not recreate');
  if (lifecycle.unknown !== false || lifecycle.lastFailure !== 'unknown-effect') failures.push('unknown effect did not fail explicitly');
  if (lifecycle.diagnosticsLength > 50) failures.push('diagnostics exceeded bound');
  if (Object.values(lifecycle.listenerCountsBeforeDestroy).some(count => count !== 1)) failures.push('duplicate socket listeners');
  if (Object.values(lifecycle.listenerCountsAfterDestroy).some(count => count !== 0)) failures.push('socket listeners leaked after destroy');
  if (!lifecycle.timerCleared) failures.push('Roulette timer leaked after destroy');
  failures.push(...problems);

  const report = { activeMetrics, lifecycle, problems, failures, pass: failures.length === 0 };
  fs.writeFileSync(path.join(outDir, 'metrics.json'), JSON.stringify(report, null, 2));
  await browser.close();
  if (failures.length) {
    console.error(JSON.stringify(report, null, 2));
    process.exit(1);
  }
  console.log('CASINO_AUDIO_ROULETTE_QA_PASS');
  console.log(JSON.stringify(report, null, 2));
})().catch(error => {
  console.error(error);
  process.exit(1);
});
