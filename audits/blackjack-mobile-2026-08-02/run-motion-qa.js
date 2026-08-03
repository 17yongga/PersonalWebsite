'use strict';

const puppeteer = require('puppeteer');
const fs = require('node:fs');
const path = require('node:path');

const outputDir = process.env.BLACKJACK_MOTION_QA_OUT || path.join(__dirname, 'motion');
const baseUrl = process.env.BLACKJACK_MOTION_QA_URL || 'http://127.0.0.1:8765/audits/blackjack-mobile-2026-08-02/blackjack-harness.html';
fs.mkdirSync(outputDir, { recursive: true });

const splitState = {
  roundId:'qa-pair', baseBet:100, bet:200, insuranceBet:0, phase:'player', settled:false,
  activeHandIndex:0,
  playerHands:[
    { cards:[{ value:'8', suit:'hearts' },{ value:'3', suit:'clubs' }], score:11, bet:100, doubled:false, complete:false, result:null, payout:0 },
    { cards:[{ value:'8', suit:'spades' },{ value:'2', suit:'diamonds' }], score:10, bet:100, doubled:false, complete:false, result:null, payout:0 }
  ],
  dealerHand:[null,{ value:'6', suit:'hearts' }], dealerScore:6,
  canHit:true, canStand:true, canDouble:true, canSplit:false, payout:0, result:null
};
const handoffState = {
  ...splitState,
  activeHandIndex:1,
  playerHands:[
    { ...splitState.playerHands[0], complete:true },
    splitState.playerHands[1]
  ]
};
const settledState = {
  ...handoffState,
  phase:'settled', settled:true, activeHandIndex:1,
  playerHands:[
    { ...handoffState.playerHands[0], complete:true, result:'loss', payout:0 },
    { ...handoffState.playerHands[1], complete:true, result:'win', payout:200 }
  ],
  dealerHand:[
    { value:'10', suit:'clubs' }, { value:'6', suit:'hearts' },
    { value:'5', suit:'spades' }, { value:'2', suit:'diamonds' }
  ],
  dealerScore:23, canHit:false, canStand:false, canDouble:false, canSplit:false,
  payout:200, result:'split_push'
};

async function sample(page, label, takeScreenshot = true) {
  const data = await page.evaluate(sampleLabel => ({
    label: sampleLabel,
    shell: document.querySelector('.blackjack-table-shell')?.className || '',
    action: document.querySelector('.blackjack-table-shell')?.dataset.action || null,
    hands: [...document.querySelectorAll('.blackjack-player-hand')].map(hand => ({
      classes: hand.className,
      badge: hand.querySelector('.blackjack-hand-result')?.textContent || '',
      active: hand.getAttribute('aria-current'),
      cardIds: [...hand.querySelectorAll('.blackjack-card')].map(card => card.dataset.qaIdentity || null),
      cards: hand.querySelectorAll('.blackjack-card').length
    })),
    dealerScore: document.querySelector('#dealerScore')?.textContent || '',
    dealerResult: document.querySelector('#dealerResult')?.textContent || '',
    dealerCards: document.querySelectorAll('#dealerCards .blackjack-card').length,
    hiddenDealerCards: document.querySelectorAll('#dealerCards .blackjack-card.is-hidden').length,
    result: document.querySelector('#resultDisplay')?.textContent || '',
    credits: window.__blackjackGame.casino.credits,
    presenting: window.__blackjackGame.presentationInProgress,
    timers: window.__blackjackGame.presentationTimers.size,
    newRoundVisible: !document.querySelector('#newGameBtn')?.classList.contains('hidden'),
    newRoundDisabled: Boolean(document.querySelector('#newGameBtn')?.disabled),
    visibleActionCount: [...document.querySelectorAll('.game-controls .btn:not(.hidden)')].length,
    splitDealingCards: document.querySelectorAll('.blackjack-card.is-dealing').length,
    width: document.documentElement.scrollWidth,
    viewport: innerWidth
  }), label);
  if (takeScreenshot) await page.screenshot({ path: path.join(outputDir, `${label}.png`) });
  return data;
}

async function runNormal(browser, width) {
  const page = await browser.newPage();
  await page.setViewport({ width, height: width < 500 ? 852 : 900, deviceScaleFactor: 1 });
  const errors = [];
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(`${baseUrl}?state=pair`, { waitUntil:'networkidle0' });
  await page.evaluate(() => {
    const cards = document.querySelectorAll('#playerCards .blackjack-card');
    cards[0].dataset.qaIdentity = 'original-left';
    cards[1].dataset.qaIdentity = 'original-right';
  });
  await page.evaluate(next => {
    const game = window.__blackjackGame;
    game.pendingAction = 'split';
    game.applyServerState(next, 9800);
    game.pendingAction = null;
  }, splitState);
  const frames = [await sample(page, `${width}-split-000`)];
  await new Promise(resolve => setTimeout(resolve, 260));
  frames.push(await sample(page, `${width}-split-260`));
  await new Promise(resolve => setTimeout(resolve, 700));
  frames.push(await sample(page, `${width}-split-960`));

  await page.evaluate(next => {
    const game = window.__blackjackGame;
    game.pendingAction = 'stand';
    game.applyServerState(next, 9800);
    game.pendingAction = null;
  }, handoffState);
  frames.push(await sample(page, `${width}-handoff-000`));
  await new Promise(resolve => setTimeout(resolve, 220));
  frames.push(await sample(page, `${width}-handoff-220`));
  await new Promise(resolve => setTimeout(resolve, 220));
  frames.push(await sample(page, `${width}-handoff-440`));

  await page.evaluate(next => {
    const game = window.__blackjackGame;
    game.pendingAction = 'stand';
    game.applyServerState(next, 10000);
    game.pendingAction = null;
  }, settledState);
  frames.push(await sample(page, `${width}-settle-000`, false));
  await page.waitForFunction(() => {
    const badges = [...document.querySelectorAll('.blackjack-player-hand .blackjack-hand-result')].map(badge => badge.textContent);
    return Boolean(badges[0]) && !badges[1];
  }, { polling:20, timeout:4000 });
  frames.push(await sample(page, `${width}-settle-first-hand`));
  await page.waitForFunction(() => [...document.querySelectorAll('.blackjack-player-hand .blackjack-hand-result')].every(badge => badge.textContent), { timeout:2000 });
  frames.push(await sample(page, `${width}-settle-second-hand`));
  await page.waitForFunction(() => window.__blackjackGame.casino.credits === 10000, { timeout:2000 });
  frames.push(await sample(page, `${width}-settle-wallet`));
  await page.waitForFunction(() => Boolean(document.querySelector('#resultDisplay')?.textContent), { timeout:2000 });
  frames.push(await sample(page, `${width}-settle-summary`));
  await page.waitForFunction(() => !window.__blackjackGame.presentationInProgress, { timeout:2000 });
  frames.push(await sample(page, `${width}-settle-complete`));

  await page.click('#newGameBtn');
  frames.push(await sample(page, `${width}-reset-000`));
  await new Promise(resolve => setTimeout(resolve, 360));
  frames.push(await sample(page, `${width}-reset-360`));
  await page.close();
  return { width, errors, frames };
}

async function runReduced(browser) {
  const page = await browser.newPage();
  await page.emulateMediaFeatures([{ name:'prefers-reduced-motion', value:'reduce' }]);
  await page.setViewport({ width:393, height:852, deviceScaleFactor:1 });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(`${baseUrl}?state=pair`, { waitUntil:'networkidle0' });
  await page.evaluate(next => {
    const game = window.__blackjackGame;
    game.pendingAction = 'stand';
    game.applyServerState(next, 10000);
    game.pendingAction = null;
  }, settledState);
  const frame = await sample(page, '393-reduced-settle-immediate');
  await page.close();
  return { errors, frame };
}

async function runLifecycle(browser) {
  const page = await browser.newPage();
  await page.setViewport({ width:393, height:852, deviceScaleFactor:1 });
  await page.goto(`${baseUrl}?state=pair`, { waitUntil:'networkidle0' });
  const beforeDestroy = await page.evaluate(next => {
    const game = window.__blackjackGame;
    game.pendingAction = 'stand';
    game.applyServerState(next, 10050);
    game.pendingAction = null;
    let blockedCalls = 0;
    game.requestAction = () => { blockedCalls += 1; };
    document.dispatchEvent(new KeyboardEvent('keydown', { key:'h', bubbles:true }));
    const timerCount = game.presentationTimers.size;
    game.destroy();
    return { blockedCalls, timerCount, credits:game.casino.credits };
  }, settledState);
  await new Promise(resolve => setTimeout(resolve, 3200));
  const afterDestroy = await page.evaluate(() => ({
    timers:window.__blackjackGame.presentationTimers.size,
    result:document.querySelector('#resultDisplay')?.textContent || '',
    credits:window.__blackjackGame.casino.credits
  }));
  const reentry = await page.evaluate(next => {
    const manager = window.__blackjackGame.casino;
    const game = new window.BlackjackGame(manager);
    game.init();
    game.applyServerState(next, 10000);
    let calls = 0;
    game.requestAction = () => { calls += 1; };
    document.dispatchEvent(new KeyboardEvent('keydown', { key:'h', bubbles:true }));
    window.__blackjackGame = game;
    return {
      calls,
      timers:game.presentationTimers.size,
      tables:document.querySelectorAll('.blackjack-container').length,
      hands:document.querySelectorAll('.blackjack-player-hand').length
    };
  }, splitState);
  await page.close();
  return { beforeDestroy, afterDestroy, reentry };
}

(async () => {
  const browser = await puppeteer.launch({ headless:true, args:['--no-sandbox'] });
  try {
    const runs = [];
    for (const width of [393, 1280]) runs.push(await runNormal(browser, width));
    const reduced = await runReduced(browser);
    const lifecycle = await runLifecycle(browser);
    const failures = [];
    for (const run of runs) {
      if (run.errors.length) failures.push(`${run.width}:errors:${run.errors.join('|')}`);
      if (run.frames.some(frame => frame.width !== frame.viewport)) failures.push(`${run.width}:overflow`);
      const split0 = run.frames.find(frame => frame.label.endsWith('split-000'));
      if (split0.hands.length !== 2) failures.push(`${run.width}:split-hand-count`);
      if (split0.hands[0]?.cardIds[0] !== 'original-left' || split0.hands[1]?.cardIds[0] !== 'original-right') failures.push(`${run.width}:split-card-identity`);
      if (split0.splitDealingCards !== 2) failures.push(`${run.width}:split-new-card-motion=${split0.splitDealingCards}`);
      const handoff0 = run.frames.find(frame => frame.label.endsWith('handoff-000'));
      const handoff220 = run.frames.find(frame => frame.label.endsWith('handoff-220'));
      if (!handoff0.hands[0]?.classes.includes('is-active')) failures.push(`${run.width}:handoff-old-focus-missing`);
      if (!handoff220.hands[1]?.classes.includes('is-active')) failures.push(`${run.width}:handoff-new-focus-missing`);
      const settle0 = run.frames.find(frame => frame.label.endsWith('settle-000'));
      const settleFirst = run.frames.find(frame => frame.label.endsWith('settle-first-hand'));
      const settleSecond = run.frames.find(frame => frame.label.endsWith('settle-second-hand'));
      const settleWallet = run.frames.find(frame => frame.label.endsWith('settle-wallet'));
      const settleSummary = run.frames.find(frame => frame.label.endsWith('settle-summary'));
      const settleComplete = run.frames.find(frame => frame.label.endsWith('settle-complete'));
      if (!settle0.shell.includes('is-dealer-turn') || settle0.result || settle0.credits !== 9800 || settle0.newRoundVisible || !settle0.newRoundDisabled || settle0.hands.some(hand => hand.classes.includes('is-active'))) failures.push(`${run.width}:settlement-start-order`);
      if (!settleFirst.hands[0]?.badge || settleFirst.hands[1]?.badge || settleFirst.credits !== 9800 || settleFirst.dealerResult !== 'BUST') failures.push(`${run.width}:first-hand-settlement-order`);
      if (!settleSecond.hands.every(hand => hand.badge) || settleSecond.credits !== 9800) failures.push(`${run.width}:second-hand-settlement-order`);
      if (settleWallet.credits !== 10000) failures.push(`${run.width}:wallet-order`);
      if (!settleSummary.result) failures.push(`${run.width}:summary-order`);
      if (settleComplete.presenting || !settleComplete.newRoundVisible || settleComplete.newRoundDisabled || settleComplete.timers) failures.push(`${run.width}:settlement-completion`);
      const reset0 = run.frames.find(frame => frame.label.endsWith('reset-000'));
      const reset360 = run.frames.find(frame => frame.label.endsWith('reset-360'));
      if (!reset0.shell.includes('is-resetting')) failures.push(`${run.width}:reset-motion-missing`);
      if (!reset360.shell.includes('blackjack-table-shell') || reset360.hands.length !== 1 || reset360.hands[0].cards !== 0) failures.push(`${run.width}:reset-final-state`);
    }
    if (reduced.errors.length) failures.push(`reduced:errors:${reduced.errors.join('|')}`);
    if (reduced.frame.presenting || reduced.frame.timers || !reduced.frame.result || reduced.frame.credits !== 10000) failures.push('reduced:not-immediate');
    if (lifecycle.beforeDestroy.blockedCalls || lifecycle.beforeDestroy.timerCount < 1) failures.push('lifecycle:action-lock');
    if (lifecycle.afterDestroy.timers || lifecycle.afterDestroy.result || lifecycle.afterDestroy.credits !== lifecycle.beforeDestroy.credits) failures.push('lifecycle:stale-callback');
    if (lifecycle.reentry.calls !== 1 || lifecycle.reentry.timers || lifecycle.reentry.tables !== 1 || lifecycle.reentry.hands !== 2) failures.push('lifecycle:reentry');
    const report = { cases:runs.length, failures, reduced:reduced.frame, lifecycle, runs };
    fs.writeFileSync(path.join(outputDir, 'report.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify({ cases:runs.length, failures, reduced:{ presenting:reduced.frame.presenting, timers:reduced.frame.timers, result:reduced.frame.result }, lifecycle }, null, 2));
    if (failures.length) process.exitCode = 1;
  } finally {
    await browser.close();
  }
})();
