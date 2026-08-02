'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'casino-sound.js'), 'utf8');

function createHarness(stored = null) {
  const storage = new Map();
  if (stored !== null) storage.set('neon777:sound-effects', stored);
  const makeParam = () => ({ value: 0, setValueAtTime() {}, exponentialRampToValueAtTime() {} });
  const makeNode = () => ({
    gain: makeParam(), frequency: makeParam(), detune: makeParam(), pan: makeParam(),
    connect() { return this; }, start() {}, stop() {}, type: '', buffer: null
  });
  let contextCount = 0;
  let bufferCount = 0;
  let nextContextState = 'running';
  class FakeAudioContext {
    constructor() { contextCount += 1; this.currentTime = 1; this.sampleRate = 44100; this.destination = makeNode(); this.state = nextContextState; this.resumeRejects = false; }
    createGain() { return makeNode(); }
    createOscillator() { return makeNode(); }
    createStereoPanner() { return makeNode(); }
    createBiquadFilter() { return makeNode(); }
    createBufferSource() { return makeNode(); }
    createBuffer(channels, frames) { bufferCount += 1; return { getChannelData: () => new Float32Array(frames) }; }
    resume() { if (this.resumeRejects) return Promise.reject(new Error('resume failed')); this.state = 'running'; return Promise.resolve(); }
    close() { this.state = 'closed'; return Promise.resolve(); }
  }
  const makeButton = () => {
    const attrs = new Map();
    const classes = new Set();
    const icon = { textContent: '' };
    const label = { textContent: '' };
    let clickHandler = null;
    return {
      dataset: {}, title: '', icon, label,
      classList: { toggle(name, value) { value ? classes.add(name) : classes.delete(name); }, contains: name => classes.has(name) },
      setAttribute(name, value) { attrs.set(name, value); },
      getAttribute(name) { return attrs.get(name); },
      querySelector(selector) { return selector === '[data-sound-icon]' ? icon : selector === '[data-sound-label]' ? label : null; },
      addEventListener(type, fn) { if (type === 'click') clickHandler = fn; },
      click() { clickHandler?.({ type: 'click', isTrusted: true }); }
    };
  };
  const buttons = [makeButton(), makeButton()];
  const documentListeners = new Map();
  const document = {
    readyState: 'complete',
    visibilityState: 'visible',
    querySelectorAll(selector) { return selector === '[data-sound-toggle]' ? buttons : []; },
    addEventListener(type, fn) {
      if (!documentListeners.has(type)) documentListeners.set(type, new Set());
      documentListeners.get(type).add(fn);
    },
    removeEventListener(type, fn) { documentListeners.get(type)?.delete(fn); },
    fire(type, event = {}) { documentListeners.get(type)?.forEach(fn => fn({ type, ...event })); }
  };
  const played = [];
  class FakeCustomEvent { constructor(type, init) { this.type = type; this.detail = init?.detail; } }
  const window = {
    AudioContext: FakeAudioContext,
    webkitAudioContext: null,
    casinoManager: { currentGame: 'blackjack' },
    dispatchEvent(event) { played.push(event.detail); }
  };
  const context = vm.createContext({
    window, document, localStorage: { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value) },
    performance: { now: (() => { let now = 0; return () => (now += 100); })() },
    CustomEvent: FakeCustomEvent, Float32Array, Math, Date, Set, Map, console: { warn() {} }
  });
  vm.runInContext(source, context, { filename: 'casino-sound.js' });
  return {
    manager: window.casinoSound, window, document, buttons, storage, played,
    setNextContextState(value) { nextContextState = value; },
    get contextCount() { return contextCount; },
    get bufferCount() { return bufferCount; }
  };
}

test('sound is opt-in and creates no AudioContext before a user enables it', () => {
  const harness = createHarness();
  assert.equal(harness.manager.enabled, false);
  assert.equal(harness.contextCount, 0);
  assert.equal(harness.buttons[0].getAttribute('aria-pressed'), 'false');
  assert.equal(harness.buttons[0].label.textContent, 'Sound off');
  harness.buttons[0].click();
  assert.equal(harness.manager.enabled, true);
  assert.equal(harness.contextCount, 1);
  assert.equal(harness.storage.get('neon777:sound-effects'), 'on');
  assert.equal(harness.buttons[1].getAttribute('aria-pressed'), 'true');
  assert.equal(harness.buttons[1].label.textContent, 'Sound on');
});

test('sound preference persists and duplicate authoritative event keys play once', () => {
  const harness = createHarness('on');
  assert.equal(harness.manager.enabled, true);
  assert.equal(harness.contextCount, 0, 'persisted preference must not create audio before interaction');
  assert.equal(harness.manager.playOnce('round:1:result', 'win', { game: 'blackjack' }), false);
  assert.equal(harness.contextCount, 0, 'pre-gesture gameplay events must stay locked');
  harness.document.fire('pointerdown', { isTrusted: true });
  assert.equal(harness.contextCount, 1);
  assert.equal(harness.manager.playOnce('round:1:result', 'win', { game: 'blackjack' }), true);
  assert.equal(harness.manager.playOnce('round:1:result', 'win', { game: 'blackjack' }), false);
  assert.equal(harness.manager.playOnce('round:2:result', 'win', { game: 'blackjack' }), true);
  assert.equal(harness.played.filter(event => event.effect === 'win').length, 2);
});

test('muted and hidden-game events stay silent without replaying later', () => {
  const muted = createHarness();
  assert.equal(muted.manager.playOnce('round:muted', 'win', { game: 'blackjack' }), false);
  muted.manager.setEnabled(true);
  assert.equal(muted.manager.playOnce('round:muted', 'win', { game: 'blackjack' }), false);

  const scoped = createHarness('on');
  scoped.document.fire('pointerdown', { isTrusted: true });
  scoped.window.casinoManager.currentGame = 'roulette';
  assert.equal(scoped.manager.play('cardDeal', { game: 'blackjack' }), false);
  assert.equal(scoped.manager.play('rouletteSpin', { game: 'roulette' }), true);
});

test('untrusted and hidden-page events cannot unlock or play sound', () => {
  const harness = createHarness('on');
  harness.document.fire('pointerdown', { isTrusted: false });
  assert.equal(harness.contextCount, 0);
  harness.document.fire('pointerdown', { isTrusted: true });
  assert.equal(harness.contextCount, 1);
  harness.document.visibilityState = 'hidden';
  assert.equal(harness.manager.play('win', { game: 'blackjack' }), false);
});

test('closed and interrupted audio contexts recover from trusted gestures', () => {
  const harness = createHarness();
  harness.buttons[0].click();
  assert.equal(harness.contextCount, 1);
  harness.manager.context.state = 'closed';
  harness.document.fire('pointerdown', { isTrusted: true });
  assert.equal(harness.contextCount, 2, 'closed context should be recreated');
  harness.manager.context.state = 'interrupted';
  harness.document.fire('pointerdown', { isTrusted: true });
  assert.equal(harness.manager.context.state, 'running', 'interrupted context should resume');
  assert.equal(harness.manager.play('ui'), true);
});

test('rejected resume does not consume playOnce keys', async () => {
  const harness = createHarness('on');
  harness.setNextContextState('suspended');
  harness.document.fire('pointerdown', { isTrusted: true });
  harness.manager.context.resumeRejects = true;
  harness.manager.context.state = 'suspended';
  assert.equal(harness.manager.playOnce('resume-retry', 'chip', { game: 'blackjack' }), false);
  assert.equal(harness.manager.onceKeys.has('resume-retry'), false);
  await Promise.resolve();
  assert.equal(harness.manager.lastFailure.reason, 'context-resume-failed');
  harness.manager.context.resumeRejects = false;
  harness.document.fire('pointerdown', { isTrusted: true });
  assert.equal(harness.manager.playOnce('resume-retry', 'chip', { game: 'blackjack' }), true);
});

test('unknown and failed effects stay retryable and expose bounded diagnostics', () => {
  const harness = createHarness();
  harness.buttons[0].click();
  assert.equal(harness.manager.play('definitely-not-an-effect'), false);
  assert.equal(harness.manager.lastFailure.reason, 'unknown-effect');
  const originalRender = harness.manager.render.bind(harness.manager);
  harness.manager.render = () => { throw new Error('render exploded'); };
  assert.equal(harness.manager.playOnce('retryable:render', 'win'), false);
  assert.equal(harness.manager.onceKeys.has('retryable:render'), false);
  harness.manager.render = originalRender;
  assert.equal(harness.manager.playOnce('retryable:render', 'win'), true);
  assert.ok(harness.manager.diagnostics.length <= 50);
});

test('noise source data is cached per audio context', () => {
  const harness = createHarness();
  harness.buttons[0].click();
  assert.equal(harness.manager.play('crash'), true);
  assert.equal(harness.manager.play('cardDeal', { cooldown: 0 }), true);
  assert.equal(harness.bufferCount, 1, 'noise buffer should be reused');
  harness.manager.context.state = 'closed';
  harness.document.fire('pointerdown', { isTrusted: true });
  assert.equal(harness.manager.play('crash', { cooldown: 0 }), true);
  assert.equal(harness.bufferCount, 2, 'new context needs one new noise buffer');
});

test('expanded semantic effect catalog accepts gameplay cues', () => {
  const harness = createHarness();
  harness.buttons[0].click();
  for (const effect of ['betCancelled', 'betReplaced', 'error', 'blackjackHit', 'blackjackStand', 'blackjackDouble', 'blackjackSplit', 'rouletteCountdown', 'crashPulse', 'pokerFold', 'pokerCheck', 'pokerCall', 'pokerRaise', 'potWin']) {
    assert.equal(harness.manager.play(effect, { cooldown: 0, intensity: .7 }), true, effect);
  }
});
