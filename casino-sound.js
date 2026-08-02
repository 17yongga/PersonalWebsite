(() => {
  'use strict';

  const STORAGE_KEY = 'neon777:sound-effects';
  const MAX_ONCE_KEYS = 512;
  const MAX_DIAGNOSTICS = 50;
  const EFFECTS = new Set([
    'toggleOn', 'toggleOff', 'ui', 'error', 'chip', 'wager', 'betPlaced', 'betCancelled', 'betReplaced',
    'cardDeal', 'cardFlip', 'blackjackHit', 'blackjackStand', 'blackjackDouble', 'blackjackSplit',
    'coinFlip', 'rouletteSpin', 'rouletteTick', 'rouletteCountdown', 'caseReel', 'caseReveal',
    'crashStart', 'crashPulse', 'crash', 'cashout', 'pachinkoDrop', 'peg',
    'pachinkoLandingLow', 'pachinkoLandingMid', 'pachinkoLandingHigh', 'pachinkoLandingJackpot',
    'wheelSpin', 'wheelTick', 'wheelResult', 'pokerAction', 'pokerFold', 'pokerCheck', 'pokerCall',
    'pokerRaise', 'potWin', 'notification', 'push', 'lose', 'win'
  ]);
  const DEFAULT_COOLDOWNS = Object.freeze({
    cardDeal: 70,
    cardFlip: 120,
    chip: 75,
    rouletteTick: 55,
    wheelTick: 55,
    peg: 34,
    pokerAction: 90,
    ui: 70
  });

  class CasinoSoundManager {
    constructor() {
      this.enabled = false;
      this.unlocked = false;
      this.context = null;
      this.master = null;
      this.recent = new Map();
      this.onceKeys = new Set();
      this.listeners = new Set();
      this.playedEvents = [];
      this.effects = EFFECTS;
      this.noiseBuffer = null;
      this.lastFailure = null;
      this.failureCounts = Object.create(null);
      this.diagnostics = [];
      this.warnedFailureReasons = new Set();
      this.enabled = this.readPreference();
      this.bindControls = this.bindControls.bind(this);
      this.boundUnlock = event => {
        if (!this.enabled || !event?.isTrusted) return;
        if (event.type === 'keydown' && (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey || ['Shift', 'Control', 'Alt', 'Meta'].includes(event.key))) return;
        this.unlocked = true;
        this.ensureContext();
      };
      this.boundVisibility = () => {
        if (document.visibilityState === 'visible' && this.enabled && this.unlocked) this.ensureContext();
      };
      document.addEventListener('visibilitychange', this.boundVisibility);
      if (this.enabled) this.bindUnlockGesture();
      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => this.bindControls(document), { once: true });
      } else {
        this.bindControls(document);
      }
    }

    readPreference() {
      try { return localStorage.getItem(STORAGE_KEY) === 'on'; } catch { return false; }
    }

    savePreference() {
      try { localStorage.setItem(STORAGE_KEY, this.enabled ? 'on' : 'off'); } catch { /* private mode */ }
    }

    ensureContext() {
      if (this.context?.state === 'closed') {
        this.context = null;
        this.master = null;
        this.noiseBuffer = null;
      }
      if (this.context) {
        if (this.context.state === 'suspended' || this.context.state === 'interrupted') {
          this.context.resume().catch(error => this.recordFailure('context-resume-failed', null, error));
          if (this.context.state !== 'running') return null;
        }
        return this.context.state === 'running' ? this.context : null;
      }
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      if (!AudioContextClass) {
        this.recordFailure('web-audio-unavailable');
        return null;
      }
      try {
        this.context = new AudioContextClass();
        this.master = this.context.createGain();
        this.master.gain.value = 0.42;
        this.master.connect(this.context.destination);
        this.noiseBuffer = null;
        if (this.context.state === 'suspended' || this.context.state === 'interrupted') {
          this.context.resume().catch(error => this.recordFailure('context-resume-failed', null, error));
        }
        return this.context.state === 'running' ? this.context : null;
      } catch (error) {
        this.context = null;
        this.master = null;
        this.noiseBuffer = null;
        this.recordFailure('context-create', null, error);
        return null;
      }
    }

    bindUnlockGesture() {
      if (this.unlockBound) return;
      this.unlockBound = true;
      document.addEventListener('pointerdown', this.boundUnlock, true);
      document.addEventListener('keydown', this.boundUnlock, true);
    }

    removeUnlockGesture() {
      if (!this.unlockBound) return;
      this.unlockBound = false;
      document.removeEventListener('pointerdown', this.boundUnlock, true);
      document.removeEventListener('keydown', this.boundUnlock, true);
    }

    subscribe(listener) {
      if (typeof listener !== 'function') return () => {};
      this.listeners.add(listener);
      return () => this.listeners.delete(listener);
    }

    emit() {
      this.listeners.forEach(listener => {
        try { listener(this.enabled); } catch { /* listener isolation */ }
      });
      this.syncControls();
    }

    bindControls(root = document) {
      root.querySelectorAll('[data-sound-toggle]').forEach(button => {
        if (button.dataset.soundBound === 'true') return;
        button.dataset.soundBound = 'true';
        button.addEventListener('click', event => this.toggle(event));
      });
      this.syncControls();
    }

    syncControls() {
      document.querySelectorAll('[data-sound-toggle]').forEach(button => {
        const label = this.enabled ? 'Sound effects on' : 'Sound effects off';
        button.setAttribute('aria-pressed', String(this.enabled));
        button.setAttribute('aria-label', `${label}. Activate to turn ${this.enabled ? 'off' : 'on'}.`);
        button.title = label;
        button.classList.toggle('is-on', this.enabled);
        const icon = button.querySelector('[data-sound-icon]');
        const text = button.querySelector('[data-sound-label]');
        if (icon) icon.textContent = this.enabled ? '🔊' : '🔇';
        if (text) text.textContent = this.enabled ? 'Sound on' : 'Sound off';
      });
    }

    setEnabled(next, { userGesture = false } = {}) {
      const enabled = Boolean(next);
      if (enabled === this.enabled) {
        if (enabled && userGesture) {
          this.unlocked = true;
          this.ensureContext();
          this.bindUnlockGesture();
        }
        return;
      }
      if (enabled) {
        this.enabled = true;
        if (userGesture) {
          this.unlocked = true;
          this.ensureContext();
          this.bindUnlockGesture();
        } else {
          this.bindUnlockGesture();
        }
        this.savePreference();
        this.emit();
        if (this.unlocked) this.play('toggleOn', { force: true, cooldown: 0 });
      } else {
        this.play('toggleOff', { force: true, cooldown: 0 });
        this.enabled = false;
        this.removeUnlockGesture();
        this.savePreference();
        this.emit();
      }
    }

    toggle(event) { this.setEnabled(!this.enabled, { userGesture: event?.isTrusted === true }); }

    clearOnce(prefix = '') {
      if (!prefix) return this.onceKeys.clear();
      [...this.onceKeys].forEach(key => { if (key.startsWith(prefix)) this.onceKeys.delete(key); });
    }

    playOnce(key, effect, options = {}) {
      if (!key || this.onceKeys.has(key)) return false;
      const played = this.play(effect, { ...options, key });
      if (played) {
        this.onceKeys.add(key);
        if (this.onceKeys.size > MAX_ONCE_KEYS) this.onceKeys.delete(this.onceKeys.values().next().value);
      }
      return played;
    }

    recordFailure(reason, effect = null, error = null) {
      const entry = {
        reason,
        effect,
        at: Date.now(),
        message: error?.message ? String(error.message).slice(0, 180) : null
      };
      this.lastFailure = entry;
      this.failureCounts[reason] = (this.failureCounts[reason] || 0) + 1;
      this.diagnostics.push(entry);
      if (this.diagnostics.length > MAX_DIAGNOSTICS) this.diagnostics.shift();
      if (error && !this.warnedFailureReasons.has(reason)) {
        this.warnedFailureReasons.add(reason);
        console.warn(`[CasinoSound] ${reason}`, error);
      }
    }

    play(effect, options = {}) {
      if (!EFFECTS.has(effect)) {
        this.recordFailure('unknown-effect', effect);
        return false;
      }
      if (options.game) {
        const currentGame = window.casinoManager?.currentGame || null;
        if (options.game === 'lobby' ? currentGame !== null : currentGame !== options.game) return false;
      }
      if (!this.enabled && !options.force) return false;
      if (!this.unlocked) return false;
      if (document.visibilityState && document.visibilityState !== 'visible') return false;
      const context = this.ensureContext();
      if (!context || !this.master) {
        this.recordFailure('context-unavailable', effect);
        return false;
      }
      const nowMs = performance.now();
      const cooldown = options.cooldown ?? DEFAULT_COOLDOWNS[effect] ?? 0;
      const last = this.recent.get(effect) || -Infinity;
      if (cooldown > 0 && nowMs - last < cooldown) return false;
      const when = context.currentTime + Math.max(0, Number(options.delay || 0));
      const volume = Math.max(0, Math.min(1, Number(options.volume ?? 1)));
      try {
        this.render(effect, when, volume, options);
        this.recent.set(effect, nowMs);
        const event = { effect, at: Date.now(), key: options.key || null };
        this.playedEvents.push(event);
        if (this.playedEvents.length > 200) this.playedEvents.shift();
        window.dispatchEvent(new CustomEvent('casino:sound-play', { detail: event }));
        return true;
      } catch (error) {
        this.recordFailure('render-failed', effect, error);
        return false;
      }
    }

    tone(frequency, duration, { when, volume = 0.12, type = 'sine', endFrequency = null, attack = 0.008, release = 0.08, detune = 0, pan = 0 } = {}) {
      const ctx = this.context;
      const oscillator = ctx.createOscillator();
      const gain = ctx.createGain();
      oscillator.type = type;
      oscillator.frequency.setValueAtTime(Math.max(20, frequency), when);
      oscillator.detune.setValueAtTime(detune, when);
      if (endFrequency) oscillator.frequency.exponentialRampToValueAtTime(Math.max(20, endFrequency), when + duration);
      gain.gain.setValueAtTime(0.0001, when);
      gain.gain.exponentialRampToValueAtTime(Math.max(0.0002, volume), when + attack);
      gain.gain.setValueAtTime(Math.max(0.0002, volume), Math.max(when + attack, when + duration - release));
      gain.gain.exponentialRampToValueAtTime(0.0001, when + duration);
      oscillator.connect(gain);
      if (ctx.createStereoPanner) {
        const panner = ctx.createStereoPanner();
        panner.pan.value = Math.max(-1, Math.min(1, pan));
        gain.connect(panner).connect(this.master);
      } else gain.connect(this.master);
      oscillator.start(when);
      oscillator.stop(when + duration + 0.02);
    }

    noise(duration, { when, volume = 0.05, highpass = 300, lowpass = 7000 } = {}) {
      const ctx = this.context;
      if (!this.noiseBuffer) {
        const frames = Math.max(1, Math.floor(ctx.sampleRate));
        this.noiseBuffer = ctx.createBuffer(1, frames, ctx.sampleRate);
        const channel = this.noiseBuffer.getChannelData(0);
        for (let index = 0; index < frames; index += 1) channel[index] = Math.random() * 2 - 1;
      }
      const source = ctx.createBufferSource();
      const hp = ctx.createBiquadFilter();
      const lp = ctx.createBiquadFilter();
      const gain = ctx.createGain();
      hp.type = 'highpass'; hp.frequency.value = highpass;
      lp.type = 'lowpass'; lp.frequency.value = lowpass;
      gain.gain.setValueAtTime(volume, when);
      gain.gain.exponentialRampToValueAtTime(0.0001, when + duration);
      source.buffer = this.noiseBuffer;
      source.connect(hp).connect(lp).connect(gain).connect(this.master);
      source.start(when);
      source.stop(when + duration + 0.02);
    }

    chord(notes, when, volume, spacing = 0.055, type = 'sine') {
      notes.forEach((frequency, index) => this.tone(frequency, 0.24, { when: when + index * spacing, volume, type, attack: 0.012, release: 0.14 }));
    }

    render(effect, when, volume, options) {
      const v = multiplier => Math.max(0.0002, multiplier * volume);
      switch (effect) {
        case 'toggleOn':
          this.chord([523.25, 659.25, 783.99], when, v(0.07), 0.045, 'sine'); break;
        case 'toggleOff':
          this.chord([659.25, 523.25], when, v(0.055), 0.045, 'sine'); break;
        case 'ui':
          this.tone(620, 0.06, { when, volume: v(0.04), type: 'triangle', endFrequency: 740, release: 0.035 }); break;
        case 'error':
          this.tone(260, .13, { when, volume: v(.045), type: 'triangle', endFrequency: 175, release: .07 }); break;
        case 'chip':
        case 'wager':
        case 'betPlaced':
          this.tone(980, 0.075, { when, volume: v(0.07), type: 'triangle', endFrequency: 720, release: 0.04 });
          this.tone(420, 0.09, { when: when + 0.025, volume: v(0.045), type: 'sine', release: 0.05 }); break;
        case 'betCancelled':
          this.chord([620, 420], when, v(.04), .045, 'triangle'); break;
        case 'betReplaced':
          this.tone(720, .07, { when, volume: v(.05), type: 'triangle', endFrequency: 520, release: .04 });
          this.tone(860, .09, { when: when + .065, volume: v(.055), type: 'triangle', endFrequency: 1040, release: .05 }); break;
        case 'cardDeal':
          this.noise(0.12, { when, volume: v(0.048), highpass: 700, lowpass: 5200 });
          this.tone(190, 0.075, { when: when + 0.055, volume: v(0.025), type: 'triangle', endFrequency: 130, release: 0.04, pan: Number(options.pan || 0) }); break;
        case 'cardFlip':
          this.noise(0.1, { when, volume: v(0.04), highpass: 1100, lowpass: 6500 });
          this.tone(420, 0.11, { when: when + 0.035, volume: v(0.035), type: 'triangle', endFrequency: 680, release: 0.06 }); break;
        case 'blackjackHit':
          this.tone(560, .065, { when, volume: v(.04), type: 'triangle', endFrequency: 720, release: .035 }); break;
        case 'blackjackStand':
          this.tone(420, .1, { when, volume: v(.038), type: 'sine', endFrequency: 350, release: .06 }); break;
        case 'blackjackDouble':
          this.chord([520, 780], when, v(.05), .04, 'triangle'); break;
        case 'blackjackSplit':
          this.chord([740, 520, 740], when, v(.045), .04, 'triangle'); break;
        case 'coinFlip':
          [0, .08, .16, .24, .32].forEach((offset, index) => this.tone(1500 + index * 170, 0.075, { when: when + offset, volume: v(0.045), type: 'triangle', endFrequency: 2100 + index * 110, release: 0.04, pan: index % 2 ? .25 : -.25 })); break;
        case 'rouletteSpin':
          this.noise(0.5, { when, volume: v(0.022), highpass: 900, lowpass: 4200 });
          Array.from({ length: 22 }, (_, index) => .04 * index + .007 * index * index)
            .forEach((offset, index) => this.tone(1080 - index * 12, 0.034, {
              when: when + offset, volume: v(0.024), type: 'square', endFrequency: 760 - index * 5, release: 0.02
            })); break;
        case 'rouletteTick':
          this.tone(1050, 0.035, { when, volume: v(0.025), type: 'square', endFrequency: 720, release: 0.02 }); break;
        case 'rouletteCountdown':
          this.tone(540 + Math.max(0, Math.min(1, Number(options.intensity || 0))) * 280, .055, { when, volume: v(.032), type: 'triangle', release: .03 }); break;
        case 'caseReel':
          Array.from({ length: 30 }, (_, index) => 0.024 * index + 0.0031 * index * index).forEach((offset, index) => {
            this.tone(1080 - index * 7, 0.028, { when: when + offset, volume: v(0.022), type: 'square', endFrequency: 760 - index * 3, release: 0.014, pan: index % 2 ? .18 : -.18 });
          }); break;
        case 'caseReveal':
          this.noise(0.16, { when, volume: v(0.035), highpass: 1200, lowpass: 7000 });
          this.chord([392, 523.25, 659.25, 783.99], when + .04, v(0.065), 0.06, 'triangle');
          this.tone(1174.66, .38, { when: when + .22, volume: v(.04), type: 'sine', endFrequency: 1567.98, release: .24 }); break;
        case 'crashStart':
          this.tone(110, 0.7, { when, volume: v(0.06), type: 'sawtooth', endFrequency: 420, attack: 0.04, release: 0.2 }); break;
        case 'crashPulse': {
          const intensity = Math.max(0, Math.min(1, Number(options.intensity || 0)));
          const pitch = 150 + intensity * 360;
          this.tone(pitch, .085 - intensity * .025, { when, volume: v(.032 + intensity * .026), type: 'triangle', endFrequency: pitch * 1.12, attack: .006, release: .045 }); break;
        }
        case 'crash':
          this.tone(520, 0.52, { when, volume: v(0.08), type: 'sawtooth', endFrequency: 55, attack: 0.006, release: 0.22 });
          this.noise(0.38, { when: when + .04, volume: v(0.06), highpass: 120, lowpass: 2200 }); break;
        case 'cashout':
          this.chord([440, 554.37, 659.25, 880], when, v(0.085), 0.055, 'triangle');
          this.tone(1174.66, 0.34, { when: when + .18, volume: v(0.045), type: 'sine', endFrequency: 1567.98, release: .2 }); break;
        case 'pachinkoDrop':
          this.tone(350, 0.16, { when, volume: v(0.06), type: 'sine', endFrequency: 180, release: 0.08 }); break;
        case 'peg': {
          const impact = Math.max(0, Math.min(1, Number(options.impact ?? .45)));
          const pitch = 680 + impact * 760 + Math.random() * 90;
          this.tone(pitch, 0.04 + impact * .025, { when, volume: v(0.025 + impact * .04), type: 'triangle', endFrequency: pitch * .82, release: 0.025 + impact * .02, pan: Number(options.pan || 0) }); break;
        }
        case 'pachinkoLandingLow':
          this.tone(170, 0.18, { when, volume: v(0.075), type: 'triangle', endFrequency: 105, release: .1 }); break;
        case 'pachinkoLandingMid':
          this.chord([440, 554.37], when, v(0.055), .055, 'triangle'); break;
        case 'pachinkoLandingHigh':
          this.chord([523.25, 659.25, 783.99, 1046.5], when, v(0.072), .055, 'sine'); break;
        case 'pachinkoLandingJackpot':
          this.chord([523.25, 659.25, 783.99, 1046.5, 1318.51], when, v(0.09), .065, 'triangle');
          this.tone(2093, .46, { when: when + .28, volume: v(.05), type: 'sine', release: .3 }); break;
        case 'wheelSpin':
          this.noise(.34, { when, volume: v(.032), highpass: 450, lowpass: 2800 });
          this.tone(120, .5, { when, volume: v(.035), type: 'sawtooth', endFrequency: 260, release: .18 }); break;
        case 'wheelTick':
          this.tone(1180, .035, { when, volume: v(.04), type: 'square', endFrequency: 760, release: .018 }); break;
        case 'wheelResult':
          this.chord([523.25, 659.25, 783.99, 1046.5], when, v(.075), .07, 'sine'); break;
        case 'pokerAction':
          this.tone(260, 0.08, { when, volume: v(0.045), type: 'triangle', endFrequency: 190, release: 0.045 }); break;
        case 'pokerFold':
          this.noise(.085, { when, volume: v(.025), highpass: 900, lowpass: 4000 });
          this.tone(310, .09, { when, volume: v(.03), type: 'triangle', endFrequency: 210, release: .05 }); break;
        case 'pokerCheck':
          this.tone(440, .055, { when, volume: v(.035), type: 'triangle', endFrequency: 500, release: .03 }); break;
        case 'pokerCall':
          this.chord([420, 560], when, v(.035), .04, 'triangle'); break;
        case 'pokerRaise':
          this.chord([440, 620, 820], when, v(.04), .04, 'triangle'); break;
        case 'potWin':
          this.chord([392, 523.25, 659.25, 783.99], when, v(.065), .055, 'triangle'); break;
        case 'notification':
          this.chord([660, 880], when, v(0.045), 0.075, 'sine'); break;
        case 'push':
          this.chord([440, 554.37], when, v(0.045), 0.04, 'sine'); break;
        case 'lose':
          this.tone(330, 0.38, { when, volume: v(0.055), type: 'sine', endFrequency: 185, attack: 0.015, release: 0.16 });
          this.tone(246.94, 0.34, { when: when + .11, volume: v(0.035), type: 'triangle', endFrequency: 146.83, release: 0.17 }); break;
        case 'win':
          this.chord([523.25, 659.25, 783.99, 1046.5], when, v(0.065), 0.07, 'sine');
          this.tone(1318.51, 0.34, { when: when + .24, volume: v(0.035), type: 'triangle', release: 0.22 }); break;
      }
    }
  }

  const manager = new CasinoSoundManager();
  window.CasinoSoundManager = CasinoSoundManager;
  window.casinoSound = manager;
})();
