'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

function loadCaseOpeningClass() {
  const window = {};
  vm.runInNewContext(read('games/case-opening-casino.js'), {
    window,
    document: {},
    globalThis: {},
    crypto: {},
    console,
    Math,
    Date,
    Map,
    Set,
    Symbol,
    Uint8Array,
    TextEncoder,
    DataView,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    requestAnimationFrame: callback => callback(),
    matchMedia: () => ({ matches: false })
  });
  return window.CaseOpeningGame;
}

test('case presentation keeps one stage node for preparing, rolling, and revealed states', () => {
  const CaseOpeningGame = loadCaseOpeningClass();
  const game = Object.create(CaseOpeningGame.prototype);
  const header = { innerHTML: '' };
  const body = { innerHTML: '' };
  const attributes = new Map();
  const stage = {
    className: 'case-presentation-stage is-idle',
    querySelector(selector) {
      if (selector === '.case-presentation-header') return header;
      if (selector === '.case-presentation-body') return body;
      return null;
    },
    setAttribute(name, value) { attributes.set(name, value); }
  };
  game.root = { querySelector: selector => selector === '#casePresentationStage' ? stage : null };

  const preparingStage = game.updateCasePresentation('preparing', {
    headerMarkup: '<strong>Publishing commitment</strong>',
    bodyMarkup: '<p>Preparing</p>'
  });
  const rollingStage = game.updateCasePresentation('rolling', {
    headerMarkup: '<strong>Authoritative reveal</strong>',
    bodyMarkup: '<div class="case-reel-lane"></div>'
  });
  const revealedStage = game.updateCasePresentation('revealed', {
    headerMarkup: '<strong>Unboxed</strong>',
    bodyMarkup: '<div class="case-result-grid"></div>'
  });

  assert.equal(preparingStage, stage);
  assert.equal(rollingStage, stage);
  assert.equal(revealedStage, stage);
  assert.equal(game.root.querySelector('#casePresentationStage'), stage);
  assert.equal(attributes.get('aria-busy'), 'false');
  assert.equal(stage.className, 'case-presentation-stage is-revealed');
  assert.match(body.innerHTML, /case-result-grid/);
});

test('case image preparation cannot hang forever when WebKit decode never settles', async () => {
  const CaseOpeningGame = loadCaseOpeningClass();
  const game = Object.create(CaseOpeningGame.prototype);
  const stalledImage = { complete: true, decode: () => new Promise(() => {}) };
  const stage = { querySelectorAll: () => [stalledImage] };
  const startedAt = Date.now();

  await game.prepareReelImages(stage, 15);

  assert.ok(Date.now() - startedAt < 100, 'bounded image preparation must release the authoritative reveal');
});

test('case reveal is permanently mounted, scroll-neutral, image-prepared, and cleans reel acceleration', () => {
  const source = read('games/case-opening-casino.js');
  const renderOpen = source.slice(source.indexOf('renderOpen()'), source.indexOf('isDefinitiveError'));
  const animateStart = source.indexOf('async animateDrops');
  const animateDrops = source.slice(animateStart, source.indexOf('\n  renderBattle()', animateStart));

  assert.match(renderOpen, /id="casePresentationStage"/);
  assert.match(renderOpen, /class="case-presentation-header"/);
  assert.match(renderOpen, /class="case-presentation-body"/);
  assert.doesNotMatch(animateDrops, /stabilizeGameViewport|scrollIntoView|scrollTo\s*\(/);
  assert.match(animateDrops, /await this\.prepareReelImages\(stage\)/);
  assert.match(animateDrops, /this\.finishReels\(stage\)/);
  assert.match(source, /Promise\.allSettled\(images\.map/);
  assert.match(source, /track\.style\.removeProperty\('--reel-duration'\)/);
});

test('mobile betslip has a compact fixed header, one owned scroll body, summary, and anchored action footer', () => {
  const source = read('cs2-betting-modern.js');
  const css = read('cs2-modern-betting-ui.css');
  const modal = source.slice(source.indexOf('id="cs2BetSlipModal"'), source.indexOf('<!-- Credit History Modal -->'));

  assert.match(modal, /class="betslip-modal-header"[\s\S]*class="betslip-title-group"/);
  assert.equal((modal.match(/class="betslip-scroll-body"/g) || []).length, 1);
  assert.match(modal, /class="betslip-scroll-body"[\s\S]*id="cs2BetSlip"[\s\S]*id="cs2BetControls"[\s\S]*id="cs2PotentialPayout"/);
  assert.match(modal, /<footer id="cs2BetActions" class="betslip-actions betslip-action-footer hidden">/);
  assert.ok(modal.indexOf('id="cs2PotentialPayout"') < modal.indexOf('id="cs2BetActions"'), 'summary must precede the action footer');
  assert.match(css, /\.betslip-scroll-body\s*\{[^}]*min-height:\s*0;[^}]*overflow-y:\s*auto;/s);
  assert.match(css, /\.betslip-action-footer\s*\{[^}]*flex:\s*0 0 auto;/s);
  assert.match(css, /@media \(max-width:\s*768px\)[\s\S]*\.cs2-betslip-modal-content\s*\{[^}]*height:\s*min\(100dvh,\s*844px\)/);
  assert.match(css, /\.parlay-leg,\.betslip-parlay-leg,\.parlay-card-leg\s*\{[^}]*min-height:\s*44px;/s);
});

test('shared mobile density tokens are defined centrally and consumed by owning game styles', () => {
  const casinoCss = read('casino.css');
  const casesCss = read('games/case-opening.css');
  const cs2Css = read('cs2-modern-betting-ui.css');

  for (const token of ['--casino-mobile-density-pad', '--casino-mobile-density-gap', '--casino-mobile-label-size', '--casino-mobile-art-height']) {
    assert.match(casinoCss, new RegExp(`${token}:`));
  }
  assert.match(casesCss, /var\(--casino-mobile-density-pad\)/);
  assert.match(casesCss, /var\(--casino-mobile-art-height\)/);
  assert.match(cs2Css, /var\(--casino-mobile-density-pad\)/);
  const densityBlock = cs2Css.slice(cs2Css.lastIndexOf('@media (max-width:768px)'));
  assert.doesNotMatch(densityBlock, /\bzoom\s*:|transform\s*:\s*scale\s*\(/);
});
