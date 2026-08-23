/* global crypto */
'use strict';

class CaseOpeningGame {
  constructor(casinoManager) {
    this.casino = casinoManager;
    this.root = document.getElementById('caseOpeningGame');
    this.catalog = [];
    this.selectedCaseId = null;
    this.openCount = 1;
    this.fastOpen = false;
    this.dropTableExpanded = false;
    this.caseDetailsExpanded = false;
    this.view = 'open';
    this.era = 'all';
    this.battleQueue = [];
    this.battleOpponent = 'bot';
    this.busy = false;
    this.latestProof = null;
    this.pollTimer = null;
    this.destroyed = false;
    this.presentationTimers = new Set();
    this.presentationToken = null;
    this.presentingBattleKey = null;
    this.lastPresentedBattleKey = null;
    this.lastRevealedItems = [];
    this.inventoryItems = [];
    this.pending = { open: null, battle: null, joins: new Map(), cancels: new Map(), sells: new Map(), sellAll: null };
    try { this.activeBattleId = sessionStorage.getItem('neon777ActiveCaseBattle') || null; } catch (_) { this.activeBattleId = null; }
    this.socketHandler = () => this.view === 'battle' && this.loadBattles();
    this.clickHandler = event => this.handleClick(event);
    this.keyHandler = event => this.handleKeydown(event);
    this.renderShell();
    this.bind();
    this.init();
  }

  id(prefix) {
    const token = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    return `${prefix}-${token}`;
  }

  rememberBattle(battleId) {
    this.activeBattleId = battleId || null;
    try {
      if (this.activeBattleId) sessionStorage.setItem('neon777ActiveCaseBattle', this.activeBattleId);
      else sessionStorage.removeItem('neon777ActiveCaseBattle');
    } catch (_) { /* Storage can be unavailable in privacy modes. */ }
  }

  escape(value) {
    return this.casino.escapeHTML ? this.casino.escapeHTML(value) : String(value ?? '').replace(/[&<>"']/g, '');
  }

  credits(value) {
    return this.casino.formatCredits ? this.casino.formatCredits(value) : String(Math.round(Number(value) || 0));
  }

  centerHorizontalControl(selector) {
    if (this.destroyed) return;
    const element = this.root?.querySelector(selector);
    const scroller = element?.parentElement;
    if (!element || !scroller || scroller.scrollWidth <= scroller.clientWidth) return;
    scroller.scrollLeft = Math.max(0, element.offsetLeft - (scroller.clientWidth - element.offsetWidth) / 2);
  }

  async request(path, options = {}) {
    const response = await this.casino.apiFetch(path, options);
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data.success === false) {
      const error = new Error(data.error || 'Request failed');
      error.status = response.status;
      error.code = data.code;
      throw error;
    }
    return data;
  }

  post(path, body) {
    return this.request(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
  }

  renderShell() {
    if (!this.root) return;
    this.root.innerHTML = `
      <div class="case-game-shell">
        <header class="case-hero">
          <div>
            <span class="case-eyebrow">NEON ARMORY</span>
            <h2>Counter-Strike Cases</h2>
            <p>Original virtual skins. Transparent drop tables. No Steam inventory or cash value.</p>
          </div>
          <div class="case-fair-chip" title="A server-seed commitment is published before every debit">
            <span class="case-fair-dot"></span>
            PROVABLY FAIR
          </div>
        </header>

        <nav class="case-mode-nav" role="tablist" aria-label="Case game modes">
          <button class="case-mode active" id="caseTabOpen" role="tab" aria-selected="true" aria-controls="caseOpenView" data-case-view="open">Open cases</button>
          <button class="case-mode" id="caseTabBattle" role="tab" aria-selected="false" aria-controls="caseBattleView" tabindex="-1" data-case-view="battle">Case battles</button>
          <button class="case-mode" id="caseTabInventory" role="tab" aria-selected="false" aria-controls="caseInventoryView" tabindex="-1" data-case-view="inventory">Inventory</button>
          <button class="case-mode" id="caseTabFairness" role="tab" aria-selected="false" aria-controls="caseFairnessView" tabindex="-1" data-case-view="fairness">Fairness</button>
        </nav>

        <div class="case-status" id="caseStatus" role="status" aria-live="polite"></div>
        <section class="case-view" id="caseOpenView" role="tabpanel" aria-labelledby="caseTabOpen"></section>
        <section class="case-view hidden" id="caseBattleView" role="tabpanel" aria-labelledby="caseTabBattle" hidden></section>
        <section class="case-view hidden" id="caseInventoryView" role="tabpanel" aria-labelledby="caseTabInventory" hidden></section>
        <section class="case-view hidden" id="caseFairnessView" role="tabpanel" aria-labelledby="caseTabFairness" hidden></section>
      </div>`;
  }

  bind() {
    if (!this.root) return;
    this.root.addEventListener('click', this.clickHandler);
    this.root.addEventListener('keydown', this.keyHandler);
    const socket = this.casino.getSocket?.();
    socket?.on('caseBattlesUpdated', this.socketHandler);
  }

  async init() {
    try {
      const data = await this.request('/api/cases/catalog');
      if (this.destroyed) return;
      this.catalog = data.cases || [];
      this.selectedCaseId = this.catalog[0]?.id || null;
      this.renderOpen();
      this.pollTimer = setInterval(() => {
        if (this.view === 'battle' && !document.hidden) this.loadBattles();
      }, 10000);
    } catch (error) {
      if (this.destroyed) return;
      this.message(error.message, 'error');
      this.renderEmpty('Cases are temporarily unavailable.');
    }
  }

  handleClick(event) {
    const button = event.target.closest('button');
    if (!button || !this.root.contains(button)) return;
    if (button.dataset.caseView) return this.switchView(button.dataset.caseView);
    if (button.dataset.era) { this.era = button.dataset.era; return this.renderOpen(); }
    if (button.dataset.selectCase) { this.selectedCaseId = button.dataset.selectCase; this.renderOpen(); return this.casino.stabilizeGameViewport?.(this.root.querySelector('.case-mobile-summary')); }
    if (button.dataset.openCount) { this.openCount = Number(button.dataset.openCount); return this.renderOpen(); }
    if (button.dataset.action === 'toggle-drops') { this.dropTableExpanded = !this.dropTableExpanded; return this.renderOpen(); }
    if (button.dataset.action === 'toggle-fast') { this.fastOpen = !this.fastOpen; return this.renderOpen(); }
    if (button.dataset.action === 'toggle-case-details') return this.toggleCaseDetails();
    if (button.dataset.action === 'open-again') return this.openSelected();
    if (button.dataset.action === 'view-inventory') return this.switchView('inventory');
    if (button.dataset.action === 'view-proof') return this.switchView('fairness');
    if (button.dataset.action === 'new-battle') return this.renderBattle();
    if (button.dataset.keepItem) {
      const card = button.closest('.case-result-card');
      card?.classList.add('is-kept');
      card.dataset.decision = 'kept';
      this.lastRevealedItems = this.lastRevealedItems.filter(item => item.inventoryId !== button.dataset.keepItem);
      button.textContent = 'KEPT';
      button.disabled = true;
      card.querySelector('[data-sell-item]')?.setAttribute('disabled', '');
      this.syncResultSellAll();
      return;
    }
    if (button.dataset.action === 'open') return this.openSelected();
    if (button.dataset.battleAdd) { if (this.battleQueue.length < 12) this.battleQueue.push(button.dataset.battleAdd); return this.renderBattle(); }
    if (button.dataset.battleRemove) { this.battleQueue.splice(Number(button.dataset.battleRemove), 1); return this.renderBattle(); }
    if (button.dataset.opponent) { this.battleOpponent = button.dataset.opponent; return this.renderBattle(); }
    if (button.dataset.action === 'create-battle') return this.createBattle();
    if (button.dataset.joinBattle) return this.joinBattle(button.dataset.joinBattle);
    if (button.dataset.cancelBattle) return this.cancelBattle(button.dataset.cancelBattle);
    if (button.dataset.sellItem) return this.sellItem(button.dataset.sellItem, button);
    if (button.dataset.action === 'sell-all') return this.sellAll(button.dataset.scope === 'results' ? this.lastRevealedItems : this.inventoryItems, button);
    if (button.dataset.action === 'refresh-inventory') return this.loadInventory();
    if (button.dataset.action === 'refresh-battles') return this.loadBattles();
    if (button.dataset.action === 'verify-proof') return this.verifyLatestProof();
  }

  handleKeydown(event) {
    const tab = event.target.closest?.('[role="tab"][data-case-view]');
    if (!tab || !this.root?.contains(tab) || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    const tabs = [...this.root.querySelectorAll('[role="tab"][data-case-view]')];
    let index = tabs.indexOf(tab);
    if (event.key === 'Home') index = 0;
    else if (event.key === 'End') index = tabs.length - 1;
    else index = (index + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
    event.preventDefault();
    tabs[index].focus();
    this.switchView(tabs[index].dataset.caseView);
  }

  switchView(view) {
    if (!['open', 'battle', 'inventory', 'fairness'].includes(view)) return;
    this.view = view;
    if (view !== 'battle') this.root.classList.remove('battle-final-active');
    this.root.querySelectorAll('.case-mode').forEach(button => {
      const active = button.dataset.caseView === view;
      button.classList.toggle('active', active);
      button.setAttribute('aria-selected', String(active));
      button.tabIndex = active ? 0 : -1;
    });
    this.root.querySelectorAll('.case-view').forEach(section => {
      section.classList.add('hidden');
      section.hidden = true;
    });
    const panel = this.root.querySelector(`#case${view[0].toUpperCase()}${view.slice(1)}View`);
    panel?.classList.remove('hidden');
    if (panel) panel.hidden = false;
    if (view === 'open') this.renderOpen();
    if (view === 'battle') { this.renderBattle(); this.loadBattles(); }
    if (view === 'inventory') this.loadInventory();
    if (view === 'fairness') this.renderFairness();
    this.centerHorizontalControl('.case-mode-nav .case-mode.active');
  }

  caseArtwork(caseData, size = 'large') {
    const short = this.escape(caseData.name.replace(/Case$/i, '').trim());
    const featured = [...(caseData.items || [])].sort((a, b) => Number(b.value) - Number(a.value)).slice(0, 3);
    return `<div class="case-art case-visual-stack ${size}" style="--case-accent:${caseData.accent}">
      <div class="case-visual-glow" aria-hidden="true"></div>
      <div class="case-visual-weapons" aria-hidden="true">${featured.map((item, index) => `<img src="${this.escape(item.image)}" alt="" loading="${size === 'large' ? 'eager' : 'lazy'}" decoding="async" data-stack-index="${index}">`).join('')}</div>
      <div class="case-visual-core"><span>${short}</span><small>${caseData.generation === 'csgo' ? 'LEGACY' : 'CS2'}</small></div>
    </div>`;
  }

  weaponArt(item) {
    return `<div class="skin-art" style="--skin-color:${item.color}">
      <img class="skin-image" src="${this.escape(item.image)}" alt="${this.escape(item.name)}" loading="lazy" decoding="async" draggable="false">
      <span>${this.escape(item.weapon)}</span>
    </div>`;
  }

  wait(ms) {
    if (!ms || this.destroyed) return Promise.resolve();
    return new Promise(resolve => {
      const timer = setTimeout(() => {
        this.presentationTimers.delete(timer);
        resolve();
      }, ms);
      this.presentationTimers.add(timer);
    });
  }

  clearPresentationTimers() {
    for (const timer of this.presentationTimers) clearTimeout(timer);
    this.presentationTimers.clear();
    this.presentationToken = null;
    this.presentingBattleKey = null;
  }

  reelItems(winner, laneIndex = 0) {
    const owner = this.catalog.find(caseData => caseData.items?.some(item => item.id === winner?.id))
      || this.catalog.find(caseData => caseData.id === this.selectedCaseId);
    const pool = owner?.items?.length ? owner.items : this.catalog.flatMap(caseData => caseData.items || []);
    const cards = Array.from({ length: 26 }, (_, index) => pool[(laneIndex * 3 + index * 7) % pool.length]);
    cards[22] = winner;
    return cards;
  }

  reelLaneMarkup(winner, laneIndex = 0, label = 'Case opening reel') {
    const cards = this.reelItems(winner, laneIndex);
    return `<div class="case-reel-lane" aria-label="${this.escape(label)}">
      <div class="case-reel-window">
        <div class="case-reel-marker" aria-hidden="true"></div>
        <div class="case-reel-track">
          ${cards.map((item, index) => `<article class="case-reel-card${index === 22 ? ' reel-winner' : ''}" style="--skin-color:${item.color}" data-reel-index="${index}">
            ${this.weaponArt(item)}<strong>${this.escape(item.weapon)}</strong><span>${this.escape(item.finish)}</span>
          </article>`).join('')}
        </div>
      </div>
    </div>`;
  }

  startReels(container, duration = 3600) {
    const lanes = [...container.querySelectorAll('.case-reel-lane')];
    lanes.forEach((lane, index) => {
      const windowElement = lane.querySelector('.case-reel-window');
      const track = lane.querySelector('.case-reel-track');
      const winner = lane.querySelector('.reel-winner');
      if (!windowElement || !track || !winner) return;
      const stop = windowElement.clientWidth / 2 - (winner.offsetLeft + winner.offsetWidth / 2);
      track.style.setProperty('--reel-stop', `${stop}px`);
      track.style.setProperty('--reel-duration', `${duration + index * 110}ms`);
    });
    void container.offsetWidth;
    container.classList.add('is-rolling');
  }

  toggleCaseDetails() {
    this.caseDetailsExpanded = !this.caseDetailsExpanded;
    this.root?.querySelectorAll('.case-secondary-details').forEach(element => element.classList.toggle('is-expanded', this.caseDetailsExpanded));
    const button = this.root?.querySelector('[data-action="toggle-case-details"]');
    if (button) {
      button.setAttribute('aria-expanded', String(this.caseDetailsExpanded));
      button.textContent = this.caseDetailsExpanded ? 'Hide details' : 'Details & odds';
    }
  }

  renderOpen() {
    const view = this.root?.querySelector('#caseOpenView');
    if (!view) return;
    const visible = this.catalog.filter(item => this.era === 'all' || item.generation === this.era);
    const selected = this.catalog.find(item => item.id === this.selectedCaseId) || visible[0];
    if (selected && !visible.includes(selected)) this.selectedCaseId = visible[0]?.id;
    const active = this.catalog.find(item => item.id === this.selectedCaseId) || visible[0];
    const featured = active ? [...active.items].sort((a, b) => Number(b.value) - Number(a.value)).slice(0, 3) : [];
    const totalCost = active ? active.price * this.openCount : 0;
    view.innerHTML = `
      <section class="case-market">
        <div class="case-market-toolbar">
          <div><span class="case-eyebrow">CHOOSE YOUR CASE</span><h3>Armory collection</h3></div>
          <div class="case-era-switch" role="group" aria-label="Case collection filter">
            ${[['all','All cases'],['csgo','CS:GO Legacy'],['cs2','CS2 Collection']].map(([id,label]) => `<button data-era="${id}" aria-pressed="${this.era === id}" class="${this.era === id ? 'active' : ''}">${label}</button>`).join('')}
          </div>
        </div>
        <div class="case-shelf" role="group" aria-label="Available cases">
          ${visible.map(item => { const top = [...item.items].sort((a,b) => Number(b.value) - Number(a.value))[0]; return `<button class="case-tile ${item.id === active?.id ? 'selected' : ''}" aria-pressed="${item.id === active?.id}" aria-label="${this.escape(item.name)}, ${this.credits(item.price)} credits" data-select-case="${item.id}">
            ${this.caseArtwork(item, 'small')}<span class="case-tile-copy"><strong>${this.escape(item.name)}</strong><span>${this.credits(item.price)} credits</span><small>Top drop · ${this.escape(top?.weapon || '—')}</small></span>
          </button>`; }).join('')}
        </div>
      </section>
      ${active ? `<div class="case-opening-stage" style="--case-accent:${active.accent}">
        <section class="case-focus">
          <div class="case-mobile-summary">
            ${this.caseArtwork(active, 'small')}
            <div><span>${active.generation === 'csgo' ? 'CS:GO LEGACY' : 'COUNTER-STRIKE 2'}</span><strong>${this.escape(active.name)}</strong><small>${this.credits(active.price)} each · ${Math.round(active.expectedReturn * 100)}% RTP</small></div>
            <button data-action="toggle-case-details" aria-expanded="${this.caseDetailsExpanded}">${this.caseDetailsExpanded ? 'Hide details' : 'Details & odds'}</button>
          </div>
          <div class="case-focus-visual case-secondary-details ${this.caseDetailsExpanded ? 'is-expanded' : ''}">${this.caseArtwork(active)}</div>
          <div class="case-focus-copy">
            <div class="case-secondary-details ${this.caseDetailsExpanded ? 'is-expanded' : ''}">
              <span class="case-collection-label">${active.generation === 'csgo' ? 'CS:GO LEGACY COLLECTION' : 'COUNTER-STRIKE 2 COLLECTION'}</span>
              <h3>${this.escape(active.name)}</h3>
              <p>Five disclosed outcomes. Every item is fixed by the server before the reveal.</p>
              <div class="case-facts"><div><span>PRICE EACH</span><strong>${this.credits(active.price)}</strong></div><div><span>DISCLOSED RTP</span><strong>${Math.round(active.expectedReturn * 100)}%</strong></div><div><span>TOP DROP</span><strong>${this.credits(featured[0]?.value || 0)}</strong></div></div>
              ${featured[0] ? `<div class="case-featured-drop" style="--skin-color:${featured[0].color}">${this.weaponArt(featured[0])}<div><span>FEATURED DROP</span><strong>${this.escape(featured[0].name)}</strong><small>${this.escape(featured[0].officialRarity || featured[0].rarity)} · ${this.credits(featured[0].value)} credits</small></div></div>` : ''}
            </div>
            <div class="case-open-dock">
              <div class="case-count-row"><div class="case-count-control" role="group" aria-label="Cases to open">${[1,3,5].map(count => `<button data-open-count="${count}" aria-pressed="${this.openCount === count}" class="${this.openCount === count ? 'active' : ''}">${count}×</button>`).join('')}</div><button class="case-fast-toggle ${this.fastOpen ? 'active' : ''}" data-action="toggle-fast" aria-pressed="${this.fastOpen}">⚡ Fast reveal</button></div>
              <div class="case-open-total"><span>Total</span><strong>${this.credits(totalCost)} credits</strong></div>
              <button class="case-primary-action" data-action="open" ${this.busy ? 'disabled' : ''}>${this.busy ? 'PUBLISHING COMMITMENT…' : `OPEN ${this.openCount} ${this.openCount === 1 ? 'CASE' : 'CASES'}`}</button>
              <p class="case-no-cash">Virtual items only · no cash, Steam, withdrawal, or external trading value</p>
            </div>
          </div>
        </section>
        <aside class="case-drop-table case-secondary-details ${this.caseDetailsExpanded ? 'is-expanded' : ''} ${this.dropTableExpanded ? 'is-expanded-drops' : ''}">
          <div class="case-section-heading"><div><span>EXACT ODDS</span><h3>Possible skins</h3></div><button class="case-drop-toggle" data-action="toggle-drops" aria-expanded="${this.dropTableExpanded}">${this.dropTableExpanded ? 'Hide full table' : 'View all 5 drops'}</button></div>
          <div class="case-drop-preview" tabindex="0" role="region" aria-label="Featured possible drops">${featured.map(item => `<article style="--skin-color:${item.color}">${this.weaponArt(item)}<strong>${this.escape(item.weapon)}</strong><span>${this.escape(item.finish)}</span><b>${item.chanceLabel}</b></article>`).join('')}</div>
          <div class="case-drop-list">${active.items.slice().reverse().map(item => `<div class="case-drop-row" style="--skin-color:${item.color}">${this.weaponArt(item)}<div><strong>${this.escape(item.name)}</strong><span>${this.escape(item.officialRarity || item.rarity)}</span></div><div class="case-drop-value"><strong>${this.credits(item.value)}</strong><span>${item.chanceLabel}</span></div></div>`).join('')}</div>
          <footer>Odds total 100% · ${Math.round(active.expectedReturn * 100)}% disclosed RTP · virtual values only</footer>
        </aside>
      </div><div class="case-results" id="caseResults" aria-live="polite"></div>` : ''}`;
    this.centerHorizontalControl('.case-era-switch button.active');
    this.centerHorizontalControl('.case-shelf .case-tile.selected');
  }

  isDefinitiveError(error) {
    return Number.isInteger(error?.status) && error.status < 500;
  }

  async prepare(game, action) {
    action.prepareRequestId ||= this.id('prepare');
    action.clientSeed ||= `${this.casino.username || 'player'}-${Date.now()}`;
    const data = await this.post('/api/cases/prepare', {
      game,
      requestId: action.prepareRequestId,
      clientSeed: action.clientSeed
    });
    this.latestProof = { ...data.prepared, clientSeed: action.clientSeed, state: 'committed' };
    this.message(`Fairness commitment published: ${data.prepared.commitment.slice(0, 16)}…`, 'fair');
    return { ...data.prepared, clientSeed: action.clientSeed };
  }

  async openSelected() {
    if (this.busy || !this.selectedCaseId) return;
    this.setBusy(true);
    const signature = `${this.selectedCaseId}:${this.openCount}`;
    if (!this.pending.open || this.pending.open.signature !== signature) {
      this.pending.open = { signature, requestId: this.id('open') };
    }
    const action = this.pending.open;
    try {
      const prepared = await this.prepare('case_opening', action);
      const data = await this.post('/api/cases/open', {
        caseId: this.selectedCaseId,
        count: this.openCount,
        requestId: action.requestId,
        fairRoundId: prepared.roundId,
        clientSeed: prepared.clientSeed
      });
      this.pending.open = null;
      this.casino.setCredits(data.balance);
      this.latestProof = data.proof;
      const inventoryById = new Map((data.inventory || []).map(item => [item.inventoryId, item]));
      const revealedItems = (data.items || []).map(item => ({ ...item, ...(inventoryById.get(item.inventoryId) || {}) }));
      await this.animateDrops(revealedItems);
      this.message(`${data.items.length} ${data.items.length === 1 ? 'skin' : 'skins'} added to inventory.`, 'success');
    } catch (error) {
      if (this.isDefinitiveError(error)) this.pending.open = null;
      this.message(error.message, 'error');
    } finally {
      this.setBusy(false);
    }
  }

  async animateDrops(items) {
    const results = this.root.querySelector('#caseResults');
    if (!results) return;
    const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
    const token = Symbol('case-opening');
    this.presentationToken = token;
    results.innerHTML = `<section class="case-reel-stage" aria-live="polite">
      <header><div><span>OPENING ${items.length} ${items.length === 1 ? 'CASE' : 'CASES'}</span><h3>Authoritative reveal</h3></div><strong>${this.fastOpen ? 'FAST REVEAL' : 'Result fixed by server'}</strong></header>
      ${items.map((item, index) => this.reelLaneMarkup(item, index)).join('')}
    </section>`;
    this.casino.stabilizeGameViewport?.(results, { force: true, retryDelays: [] });
    if (!reducedMotion) {
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      if (this.presentationToken !== token || this.destroyed) return;
      const stage = results.querySelector('.case-reel-stage');
      this.startReels(stage, this.fastOpen ? 700 : 2700);
      window.casinoSound?.play('caseReel', { game: 'cases' });
      await this.wait((this.fastOpen ? 980 : 3100) + Math.max(0, items.length - 1) * (this.fastOpen ? 30 : 80));
      if (this.presentationToken !== token || this.destroyed) return;
    }
    window.casinoSound?.play('caseReveal', { game: 'cases' });
    const totalValue = items.reduce((sum, item) => sum + (Number(item.value) || 0), 0);
    this.lastRevealedItems = items.filter(item => item.inventoryId);
    results.innerHTML = `<section class="case-result-stage"><header><div><span class="case-eyebrow">UNBOXED</span><h3>${items.length} ${items.length === 1 ? 'item' : 'items'} added to your armory</h3></div><div class="case-result-batch-actions"><strong>${this.credits(totalValue)} credits total</strong>${this.lastRevealedItems.length ? `<button class="case-sell-all" data-action="sell-all" data-scope="results">SELL ALL · ${this.credits(totalValue)}</button>` : ''}</div></header>
      <div class="case-result-grid">${items.map((item, index) => `<article class="case-result-card" data-inventory-id="${this.escape(item.inventoryId || '')}" style="--skin-color:${item.color};--reveal-delay:${index * 90}ms">
        <span class="case-result-rarity">${this.escape(item.officialRarity || item.rarity)}</span>${this.weaponArt(item)}
        <h4>${this.escape(item.weapon)}</h4><p>${this.escape(item.finish)}</p><strong>${this.credits(item.value)} credits</strong><small>✓ Added to inventory</small>${item.inventoryId ? `<footer><button data-keep-item="${this.escape(item.inventoryId)}">KEEP</button><button data-sell-item="${this.escape(item.inventoryId)}">SELL · ${this.credits(item.value)}</button></footer>` : ''}
      </article>`).join('')}</div>
      <div class="case-result-actions"><button class="case-primary-action" data-action="open-again">OPEN AGAIN</button><button data-action="view-inventory">VIEW INVENTORY</button><button data-action="view-proof">VERIFY RESULT</button></div></section>`;
    this.presentationToken = null;
    this.casino.stabilizeGameViewport?.(results, { force: true, retryDelays: [] });
  }

  renderBattle() {
    const view = this.root?.querySelector('#caseBattleView');
    if (!view) return;
    this.root.classList.remove('battle-final-active');
    const total = this.battleQueue.reduce((sum, id) => sum + (this.catalog.find(item => item.id === id)?.price || 0), 0);
    view.innerHTML = `
      <div class="battle-builder">
        <div class="battle-builder-main">
          <div class="case-section-heading"><div><span>BUILD A BATTLE</span><h3>Choose an identical case sequence</h3></div><small>${this.battleQueue.length}/12 cases</small></div>
          <div class="battle-case-picker">${this.catalog.map(item => `<button data-battle-add="${item.id}" ${this.battleQueue.length >= 12 ? 'disabled' : ''}>
            ${this.caseArtwork(item, 'micro')}<span><strong>${this.escape(item.name)}</strong><small>${this.credits(item.price)}</small></span><b>＋</b>
          </button>`).join('')}</div>
        </div>
        <aside class="battle-ticket">
          <span class="case-eyebrow">BATTLE TICKET</span><h3>${this.battleQueue.length ? `${this.battleQueue.length} case sequence` : 'Add cases to begin'}</h3>
          <div class="battle-queue">${this.battleQueue.map((id,index) => { const item = this.catalog.find(value => value.id === id); return `<div>${this.caseArtwork(item, 'micro')}<span>${this.escape(item.name)}</span><button aria-label="Remove ${this.escape(item.name)}" data-battle-remove="${index}">×</button></div>`; }).join('') || '<p>Your sequence is empty.</p>'}</div>
          <div class="battle-opponent-toggle" role="group" aria-label="Battle opponent"><button data-opponent="bot" aria-pressed="${this.battleOpponent === 'bot'}" class="${this.battleOpponent === 'bot' ? 'active' : ''}">NEON BOT</button><button data-opponent="human" aria-pressed="${this.battleOpponent === 'human'}" class="${this.battleOpponent === 'human' ? 'active' : ''}">PUBLIC 1V1</button></div>
          <div class="battle-total"><span>Your entry</span><strong>${this.credits(total)} credits</strong></div>
          <button class="case-primary-action" data-action="create-battle" ${!this.battleQueue.length || this.busy ? 'disabled' : ''}>${this.battleOpponent === 'bot' ? 'BATTLE THE BOT' : 'CREATE PUBLIC BATTLE'}</button>
          <p>Highest combined skin value wins all drops.</p>
        </aside>
      </div>
      <div class="battle-arena" id="battleArena"></div>
      <section class="battle-lobby"><div class="case-section-heading"><div><span>PUBLIC LOBBY</span><h3>Open battles</h3></div><button data-action="refresh-battles">Refresh</button></div><div id="battleList" class="battle-list"><div class="case-loader">Loading battles…</div></div></section>`;
  }

  async createBattle() {
    if (this.busy || !this.battleQueue.length) return;
    this.setBusy(true);
    const signature = JSON.stringify({ opponent: this.battleOpponent, caseIds: this.battleQueue });
    if (!this.pending.battle || this.pending.battle.signature !== signature) {
      this.pending.battle = { signature, requestId: this.id('battle') };
    }
    const action = this.pending.battle;
    try {
      const prepared = await this.prepare('case_battle', action);
      const data = await this.post('/api/cases/battles', {
        opponent: this.battleOpponent,
        caseIds: this.battleQueue,
        requestId: action.requestId,
        fairRoundId: prepared.roundId,
        clientSeed: prepared.clientSeed
      });
      this.pending.battle = null;
      this.rememberBattle(data.battle.battleId);
      this.casino.setCredits(data.balance);
      this.latestProof = data.battle.proof ? { ...data.battle.proof, clientSeeds: data.battle.clientSeeds } : this.latestProof;
      await this.presentBattleResult(data.battle);
      this.message(data.battle.status === 'waiting' ? 'Public battle created. Waiting for an opponent.' : 'Battle settled.', 'success');
      this.loadBattles();
    } catch (error) {
      if (this.isDefinitiveError(error)) this.pending.battle = null;
      this.message(error.message, 'error');
    }
    finally { this.setBusy(false); }
  }

  renderBattleResult(battle) {
    const arena = this.root.querySelector('#battleArena');
    if (!arena) return;
    if (battle.status === 'waiting') {
      this.root.classList.remove('battle-final-active');
      arena.innerHTML = `<div class="battle-waiting"><span class="case-loader"></span><h3>Waiting for a challenger</h3><p>Battle ${this.escape(battle.battleId.slice(-10))}</p><button data-cancel-battle="${battle.battleId}">Cancel &amp; refund</button></div>`;
      return;
    }
    const results = battle.results || [];
    this.root.classList.add('battle-final-active');
    const winner = results.find(result => battle.winnerId === result.userId);
    arena.innerHTML = `<section class="battle-final"><header><div><span class="case-eyebrow">BATTLE COMPLETE</span><h3>${this.escape(winner?.userId || 'Winner')} takes all</h3></div><strong>Winner-takes-all virtual inventory</strong></header><div class="battle-versus">${results.map((result,index) => `<article class="battle-player ${battle.winnerId === result.userId ? 'winner' : ''}">
      <header><span>${index === 0 ? 'PLAYER 1' : (battle.opponentType === 'bot' ? 'ROBOT' : 'PLAYER 2')}</span><h3>${this.escape(result.userId)}</h3><strong>${this.credits(result.total)} total</strong></header>
      <div class="battle-drops">${result.drops.map(item => `<div style="--skin-color:${item.color}">${this.weaponArt(item)}<span>${this.escape(item.finish)}</span><b>${this.credits(item.value)}</b></div>`).join('')}</div>
      ${battle.winnerId === result.userId ? '<div class="battle-winner-ribbon">WINNER · TAKES ALL</div>' : ''}
    </article>`).join('<div class="battle-vs-mark">VS</div>')}</div><div class="battle-final-actions"><button class="case-primary-action" data-action="new-battle">BUILD ANOTHER BATTLE</button><button data-action="view-proof">VERIFY BATTLE</button><button data-action="view-inventory">VIEW INVENTORY</button></div></section>`;
  }

  async presentBattleResult(battle) {
    if (battle.status !== 'settled') {
      this.renderBattleResult(battle);
      return;
    }
    const key = `${battle.battleId}:${battle.settledAt || 'settled'}`;
    if (this.presentingBattleKey === key) return;
    if (this.lastPresentedBattleKey === key) {
      this.renderBattleResult(battle);
      return;
    }
    const arena = this.root.querySelector('#battleArena');
    if (!arena) return;
    this.root.classList.add('battle-presentation-active');
    this.presentingBattleKey = key;
    const token = Symbol(key);
    this.presentationToken = token;
    const results = battle.results || [];
    const roundCount = Math.max(0, ...results.map(result => result.drops?.length || 0));
    const runningTotals = results.map(() => 0);
    const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
    arena.innerHTML = `<section class="battle-presentation" aria-live="polite">
      <header class="battle-round-header"><div><span>CASE BATTLE</span><h3>Round-by-round reveal</h3></div><strong id="battleRoundProgress">Preparing ${roundCount} rounds…</strong></header>
      <div class="battle-scoreboard">${results.map((result, index) => `<div><span>${this.escape(result.userId)}</span><strong id="battleRunningTotal${index}">0</strong></div>`).join('')}</div>
      <div class="battle-round-stage" id="battleRoundStage"></div>
    </section>`;
    this.casino.stabilizeGameViewport?.(arena, { force: true, retryDelays: [] });
    const stage = arena.querySelector('#battleRoundStage');
    for (let roundIndex = 0; roundIndex < roundCount; roundIndex += 1) {
      if (this.presentationToken !== token || this.destroyed) return;
      const progress = arena.querySelector('#battleRoundProgress');
      if (progress) progress.textContent = `Round ${roundIndex + 1} of ${roundCount}`;
      arena.classList.remove('is-rolling');
      stage.innerHTML = results.map((result, playerIndex) => {
        const drop = result.drops[roundIndex];
        return `<article class="battle-round-player"><span>${this.escape(result.userId)}</span>${this.reelLaneMarkup(drop, roundIndex + playerIndex, `${this.escape(result.userId)} round ${roundIndex + 1}`)}</article>`;
      }).join('<div class="battle-vs-mark">VS</div>');
      if (!reducedMotion) {
        await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        if (this.presentationToken !== token || this.destroyed) return;
        this.startReels(arena, 1350);
        window.casinoSound?.play('caseReel', { game: 'cases' });
        await this.wait(1650);
      }
      if (this.presentationToken !== token || this.destroyed) return;
      stage.innerHTML = results.map((result, playerIndex) => {
        const drop = result.drops[roundIndex];
        runningTotals[playerIndex] += Number(drop.value) || 0;
        const total = arena.querySelector(`#battleRunningTotal${playerIndex}`);
        if (total) total.textContent = this.credits(runningTotals[playerIndex]);
        return `<article class="battle-round-player revealed" style="--skin-color:${drop.color}"><span>${this.escape(result.userId)}</span>${this.weaponArt(drop)}<h4>${this.escape(drop.name)}</h4><strong>${this.credits(drop.value)} credits</strong></article>`;
      }).join('<div class="battle-vs-mark">VS</div>');
      window.casinoSound?.play('caseReveal', { game: 'cases' });
      if (!reducedMotion) await this.wait(620);
    }
    if (this.presentationToken !== token || this.destroyed) return;
    this.lastPresentedBattleKey = key;
    this.presentingBattleKey = null;
    this.presentationToken = null;
    this.root.classList.remove('battle-presentation-active');
    this.renderBattleResult(battle);
  }

  async loadBattles() {
    const list = this.root?.querySelector('#battleList');
    if (!list) return;
    try {
      const data = await this.request('/api/cases/battles');
      const allBattles = data.battles || [];
      const activeBattle = this.activeBattleId ? allBattles.find(battle => battle.battleId === this.activeBattleId) : null;
      if (activeBattle) {
        this.latestProof = activeBattle.proof ? { ...activeBattle.proof, clientSeeds: activeBattle.clientSeeds } : this.latestProof;
        if (activeBattle.status === 'settled') this.presentBattleResult(activeBattle);
        else this.renderBattleResult(activeBattle);
      }
      const battles = allBattles.filter(battle => battle.opponentType === 'human').slice(0, 20);
      list.innerHTML = battles.length ? battles.map(battle => {
        const own = battle.creatorId === this.casino.username;
        return `<article class="battle-list-row ${battle.status}">
          <div><span>${battle.status.toUpperCase()}</span><strong>${this.escape(battle.creatorId)}</strong><small>${battle.caseIds.length} cases · ${this.credits(battle.entryCost)} credits</small></div>
          <div class="battle-mini-cases">${battle.caseIds.slice(0,5).map(id => this.caseArtwork(this.catalog.find(item => item.id === id), 'micro')).join('')}${battle.caseIds.length > 5 ? `<b>+${battle.caseIds.length - 5}</b>` : ''}</div>
          ${battle.status === 'waiting' ? (own ? `<button data-cancel-battle="${battle.battleId}">Cancel</button>` : `<button data-join-battle="${battle.battleId}">Join</button>`) : `<button data-join-battle="${battle.battleId}" disabled>${battle.winnerId === this.casino.username ? 'Won' : 'Settled'}</button>`}
        </article>`;
      }).join('') : '<div class="case-empty"><h3>No public battles yet</h3><p>Create the first one.</p></div>';
    } catch (error) { list.innerHTML = `<div class="case-empty"><p>${this.escape(error.message)}</p></div>`; }
  }

  async joinBattle(battleId) {
    if (this.busy) return;
    this.setBusy(true);
    let action = this.pending.joins.get(battleId);
    if (!action) {
      action = {
        requestId: this.id('join'),
        clientSeed: `${this.casino.username || 'player'}-${Date.now()}`
      };
      this.pending.joins.set(battleId, action);
    }
    try {
      const data = await this.post(`/api/cases/battles/${encodeURIComponent(battleId)}/join`, action);
      this.pending.joins.delete(battleId);
      this.rememberBattle(data.battle.battleId);
      this.casino.setCredits(data.balance);
      this.latestProof = { ...data.battle.proof, clientSeeds: data.battle.clientSeeds };
      await this.presentBattleResult(data.battle);
      this.message('Battle settled. The winner received every drop.', 'success');
      this.loadBattles();
    } catch (error) {
      if (this.isDefinitiveError(error)) this.pending.joins.delete(battleId);
      this.message(error.message, 'error');
    }
    finally { this.setBusy(false); }
  }

  async cancelBattle(battleId) {
    if (this.busy) return;
    this.setBusy(true);
    let action = this.pending.cancels.get(battleId);
    if (!action) {
      action = { requestId: this.id('cancel') };
      this.pending.cancels.set(battleId, action);
    }
    try {
      const data = await this.post(`/api/cases/battles/${encodeURIComponent(battleId)}/cancel`, action);
      this.pending.cancels.delete(battleId);
      this.rememberBattle(data.battle.battleId);
      this.casino.setCredits(data.balance);
      this.latestProof = data.battle.proof;
      this.renderBattleResult(data.battle);
      this.message('Battle cancelled and entry refunded.', 'success');
      this.loadBattles();
    } catch (error) {
      if (this.isDefinitiveError(error)) this.pending.cancels.delete(battleId);
      this.message(error.message, 'error');
    }
    finally { this.setBusy(false); }
  }

  async loadInventory() {
    const view = this.root?.querySelector('#caseInventoryView');
    if (!view) return;
    view.innerHTML = '<div class="case-loader">Loading inventory…</div>';
    try {
      const data = await this.request('/api/cases/inventory');
      this.inventoryItems = data.items || [];
      const value = this.inventoryItems.reduce((sum,item) => sum + item.value, 0);
      view.innerHTML = `<div class="inventory-header"><div><span class="case-eyebrow">YOUR ARMORY</span><h3 data-inventory-count>${this.inventoryItems.length} virtual skins</h3><p data-inventory-value>Collection value: ${this.credits(value)} credits</p></div><div class="inventory-header-actions">${this.inventoryItems.length ? `<button class="case-sell-all" data-action="sell-all" data-scope="inventory">SELL ALL · ${this.credits(value)}</button>` : ''}<button data-action="refresh-inventory">Refresh</button></div></div>
        <div class="inventory-grid">${this.inventoryItems.map(item => `<article class="inventory-card" data-inventory-id="${this.escape(item.inventoryId)}" style="--skin-color:${item.color}">
          <span>${this.escape(item.rarity)}</span>${this.weaponArt(item)}<h4>${this.escape(item.weapon)}</h4><p>${this.escape(item.finish)}</p>
          <footer><strong>${this.credits(item.value)} credits</strong><button data-sell-item="${this.escape(item.inventoryId)}">SELL</button></footer>
        </article>`).join('') || '<div class="case-empty"><h3>Your armory is empty</h3><p>Open a case or win a battle to collect skins.</p></div>'}</div>`;
    } catch (error) { view.innerHTML = `<div class="case-empty"><p>${this.escape(error.message)}</p></div>`; }
  }

  saleItems() {
    return new Map([...this.inventoryItems, ...this.lastRevealedItems].filter(item => item?.inventoryId).map(item => [item.inventoryId, item]));
  }

  markSoldCards(inventoryIds, valueById) {
    const ids = new Set(inventoryIds);
    this.root?.querySelectorAll('[data-inventory-id]').forEach(card => {
      const id = card.dataset.inventoryId;
      if (!ids.has(id)) return;
      const value = Number(valueById.get(id)?.value || 0);
      card.classList.add('is-sold');
      card.querySelectorAll('button').forEach(button => {
        button.disabled = true;
        button.removeAttribute('aria-busy');
        button.dataset.saleState = 'sold';
        if (button.dataset.sellItem) button.textContent = `SOLD · +${this.credits(value)}`;
        if (button.dataset.keepItem) button.hidden = true;
      });
      const status = card.querySelector(':scope > small');
      if (status) status.textContent = '✓ Sold to balance';
    });
  }

  syncInventorySummary() {
    const value = this.inventoryItems.reduce((sum, item) => sum + Number(item.value || 0), 0);
    const count = this.root?.querySelector('[data-inventory-count]');
    const total = this.root?.querySelector('[data-inventory-value]');
    if (count) count.textContent = `${this.inventoryItems.length} virtual skins`;
    if (total) total.textContent = `Collection value: ${this.credits(value)} credits`;
  }

  syncResultSellAll() {
    const button = this.root?.querySelector('.case-result-stage [data-action="sell-all"]');
    if (!button || button.dataset.saleState === 'sold') return;
    const value = this.lastRevealedItems.reduce((sum, item) => sum + Number(item.value || 0), 0);
    button.disabled = this.lastRevealedItems.length === 0;
    button.textContent = this.lastRevealedItems.length
      ? `SELL ${this.lastRevealedItems.length} UNDECIDED · ${this.credits(value)}`
      : 'ALL ITEMS DECIDED';
  }

  async sellItem(inventoryId) {
    if (this.busy) return;
    this.busy = true;
    let action = this.pending.sells.get(inventoryId);
    if (!action) {
      action = { requestId: this.id('sell') };
      this.pending.sells.set(inventoryId, action);
    }
    const buttons = [...(this.root?.querySelectorAll('[data-sell-item]') || [])].filter(button => button.dataset.sellItem === inventoryId);
    const batchButtons = [...(this.root?.querySelectorAll('[data-action="sell-all"]') || [])];
    buttons.forEach(button => { button.disabled = true; button.setAttribute('aria-busy', 'true'); button.textContent = 'SELLING…'; });
    batchButtons.forEach(button => { button.disabled = true; });
    try {
      const data = await this.post(`/api/cases/inventory/${encodeURIComponent(inventoryId)}/sell`, action);
      this.pending.sells.delete(inventoryId);
      this.casino.setCredits(data.balance);
      const item = this.saleItems().get(inventoryId) || { inventoryId, value: data.value };
      this.inventoryItems = this.inventoryItems.filter(entry => entry.inventoryId !== inventoryId);
      this.lastRevealedItems = this.lastRevealedItems.filter(entry => entry.inventoryId !== inventoryId);
      this.markSoldCards([inventoryId], new Map([[inventoryId, item]]));
      this.syncInventorySummary();
      this.syncResultSellAll();
    } catch (error) {
      if (this.isDefinitiveError(error)) this.pending.sells.delete(inventoryId);
      buttons.forEach(button => { button.disabled = false; button.removeAttribute('aria-busy'); button.textContent = 'SELL FAILED · RETRY'; button.title = error.message; });
    } finally {
      batchButtons.forEach(button => { if (button.dataset.saleState !== 'sold') button.disabled = false; });
      this.busy = false;
    }
  }

  async sellAll(items, sourceButton) {
    if (this.busy) return;
    const available = (items || []).filter(item => item?.inventoryId);
    const inventoryIds = [...new Set(available.map(item => item.inventoryId))].sort();
    if (!inventoryIds.length) return;
    const signature = JSON.stringify(inventoryIds);
    if (!this.pending.sellAll || this.pending.sellAll.signature !== signature) {
      this.pending.sellAll = { signature, requestId: this.id('sell-all') };
    }
    const action = this.pending.sellAll;
    const value = available.reduce((sum, item) => sum + Number(item.value || 0), 0);
    this.busy = true;
    sourceButton.disabled = true;
    sourceButton.setAttribute('aria-busy', 'true');
    sourceButton.textContent = `SELLING ${inventoryIds.length}…`;
    const itemButtons = [...(this.root?.querySelectorAll('[data-sell-item]') || [])].filter(button => inventoryIds.includes(button.dataset.sellItem));
    itemButtons.forEach(button => { button.disabled = true; button.setAttribute('aria-busy', 'true'); button.textContent = 'SELLING…'; });
    try {
      const data = await this.post('/api/cases/inventory/sell-all', { requestId: action.requestId, inventoryIds });
      this.pending.sellAll = null;
      this.casino.setCredits(data.balance);
      const valueById = new Map(available.map(item => [item.inventoryId, item]));
      this.inventoryItems = this.inventoryItems.filter(item => !inventoryIds.includes(item.inventoryId));
      this.lastRevealedItems = this.lastRevealedItems.filter(item => !inventoryIds.includes(item.inventoryId));
      this.markSoldCards(inventoryIds, valueById);
      this.syncInventorySummary();
      sourceButton.removeAttribute('aria-busy');
      sourceButton.dataset.saleState = 'sold';
      sourceButton.textContent = `SOLD ${data.count} · +${this.credits(data.value)}`;
    } catch (error) {
      if (this.isDefinitiveError(error)) this.pending.sellAll = null;
      sourceButton.disabled = false;
      sourceButton.removeAttribute('aria-busy');
      sourceButton.textContent = `SELL ALL · ${this.credits(value)}`;
      sourceButton.title = error.message;
      itemButtons.forEach(button => { button.disabled = false; button.removeAttribute('aria-busy'); button.textContent = 'SELL'; });
    } finally { this.busy = false; }
  }

  renderFairness() {
    const view = this.root?.querySelector('#caseFairnessView');
    if (!view) return;
    const proof = this.latestProof;
    view.innerHTML = `<div class="fairness-explainer">
      <div><span class="case-eyebrow">VERIFY EVERY ROUND</span><h3>Commit first. Reveal after settlement.</h3><p>The server publishes a SHA-256 commitment before credits are debited. The hidden server seed, your client seed, nonce and deterministic HMAC method are revealed only after the inventory or battle result commits.</p></div>
      <ol><li><b>1</b><span><strong>Commitment</strong> Published before the wager</span></li><li><b>2</b><span><strong>Deterministic rolls</strong> One counter per case and player</span></li><li><b>3</b><span><strong>Atomic settlement</strong> Balance, inventory and result commit together</span></li><li><b>4</b><span><strong>Reveal</strong> Recompute SHA-256 and HMAC-SHA256</span></li></ol>
    </div>
    <div class="fairness-proof-card"><span class="case-eyebrow">LATEST PROOF</span>${proof ? `<dl>
      <dt>Round</dt><dd>${this.escape(proof.roundId || '—')}</dd><dt>Commitment</dt><dd>${this.escape(proof.commitment || '—')}</dd>
      ${proof.clientSeeds ? `<dt>Creator seed</dt><dd>${this.escape(proof.clientSeeds.creatorClientSeed)}</dd><dt>Opponent seed</dt><dd>${this.escape(proof.clientSeeds.opponentClientSeed)}</dd><dt>Combined seed</dt><dd>${this.escape(proof.clientSeeds.combinedClientSeed)}</dd>` : `<dt>Client seed</dt><dd>${this.escape(proof.clientSeed || '—')}</dd>`}
      <dt>Nonce</dt><dd>${this.escape(proof.nonce ?? '—')}</dd><dt>Server seed</dt><dd>${this.escape(proof.serverSeed || 'Hidden until settlement')}</dd>
    </dl>${proof.serverSeed ? '<button class="case-primary-action fairness-verify" data-action="verify-proof">VERIFY THIS PROOF</button>' : ''}` : '<p>Open a case or complete a battle to see its proof here.</p>'}</div>`;
  }

  renderEmpty(message) {
    const view = this.root?.querySelector('#caseOpenView');
    if (view) view.innerHTML = `<div class="case-empty"><p>${this.escape(message)}</p></div>`;
  }

  hexBytes(value) {
    const hex = String(value || '');
    if (!/^[a-f0-9]+$/i.test(hex) || hex.length % 2) throw new Error('Proof contains invalid hexadecimal data');
    return Uint8Array.from(hex.match(/../g), byte => Number.parseInt(byte, 16));
  }

  async verifyLatestProof() {
    const proof = this.latestProof;
    if (!proof?.serverSeed) return this.message('The server seed is revealed only after settlement.', 'error');
    if (!globalThis.crypto?.subtle) return this.message('Proof verification is unavailable in this browser.', 'error');
    try {
      const seed = this.hexBytes(proof.serverSeed);
      const commitmentBytes = new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', seed));
      const commitment = [...commitmentBytes].map(byte => byte.toString(16).padStart(2, '0')).join('');
      if (commitment !== proof.commitment) throw new Error('Server-seed commitment does not match');
      const key = await globalThis.crypto.subtle.importKey('raw', seed, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
      const result = proof.result || {};
      const rolls = result.type === 'case_battle' ? (result.rolls || []).flat() : (result.items || []);
      if (!rolls.length) throw new Error('Proof contains no rolls to verify');
      for (const roll of rolls) {
        const expected = Number(roll.roll);
        let block = Number(roll.counter);
        let computed;
        const limit = Math.floor(0x100000000 / 1_000_000) * 1_000_000;
        while (computed === undefined) {
          const message = new TextEncoder().encode(`${proof.game}:${proof.clientSeed}:${proof.nonce}:${block++}`);
          const digest = new DataView(await globalThis.crypto.subtle.sign('HMAC', key, message));
          for (let offset = 0; offset <= digest.byteLength - 4; offset += 4) {
            const value = digest.getUint32(offset, false);
            if (value < limit) { computed = value % 1_000_000; break; }
          }
        }
        if (computed !== expected) throw new Error(`Roll ${roll.counter} does not match`);
      }
      this.message(`Proof verified: commitment and ${rolls.length} deterministic ${rolls.length === 1 ? 'roll' : 'rolls'} match.`, 'success');
    } catch (error) {
      this.message(`Verification failed: ${error.message}`, 'error');
    }
  }

  setBusy(busy) {
    this.busy = busy;
    this.root?.querySelectorAll('[data-action="open"],[data-action="create-battle"],[data-action="sell-all"],[data-join-battle],[data-cancel-battle],[data-sell-item]').forEach(button => {
      button.disabled = busy || button.dataset.saleState === 'sold';
    });
  }

  message(text, type = 'info') {
    const status = this.root?.querySelector('#caseStatus');
    if (!status) return;
    status.className = `case-status visible ${type}`;
    status.textContent = text;
    clearTimeout(this.messageTimer);
    this.messageTimer = setTimeout(() => status.classList.remove('visible'), 5500);
  }

  destroy() {
    this.destroyed = true;
    this.clearPresentationTimers();
    this.root?.classList.remove('battle-presentation-active');
    this.root?.classList.remove('battle-final-active');
    clearInterval(this.pollTimer);
    clearTimeout(this.messageTimer);
    const socket = this.casino.getSocket?.();
    socket?.off('caseBattlesUpdated', this.socketHandler);
    this.root?.removeEventListener('click', this.clickHandler);
    this.root?.removeEventListener('keydown', this.keyHandler);
    this.root?.replaceChildren();
  }
}

window.CaseOpeningGame = CaseOpeningGame;
