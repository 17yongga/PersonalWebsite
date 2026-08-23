// Blackjack Game Module

const BLACKJACK_DEAL_CADENCE_MS = 460;
const BLACKJACK_SPLIT_SEPARATION_MS = 360;
const BLACKJACK_HAND_SETTLEMENT_CADENCE_MS = 360;

function blackjackHands(state) {
  if (Array.isArray(state?.playerHands) && state.playerHands.length) return state.playerHands;
  if (!state) return [];
  return [{ cards: state.playerHand || [], score: state.playerScore, result: state.result, payout: state.payout }];
}

function buildBlackjackTransitionPlan({
  previousState = null,
  nextState,
  acceptedAction = null,
  acceptedStart = false,
  initialHydration = false,
  reducedMotion = false
}) {
  const empty = {
    kind: initialHydration ? 'hydrate' : 'update',
    reducedMotion: Boolean(reducedMotion),
    replaySettlement: false,
    splitCreated: false,
    activeHandChanged: false,
    previousActiveHandIndex: 0,
    nextActiveHandIndex: Number.isSafeInteger(nextState?.activeHandIndex) ? nextState.activeHandIndex : 0,
    preservedSplitCardIndices: [],
    playerCardsByHand: [],
    dealerCards: [],
    revealDealerAtMs: null,
    handoffAtMs: 0,
    handSettlementAtMs: [],
    walletCommitAtMs: 0,
    summaryAtMs: 0,
    completionMs: 0
  };
  if (!nextState || initialHydration) return empty;

  const previousHands = blackjackHands(previousState);
  const nextHands = blackjackHands(nextState);
  const previousActiveHandIndex = Number.isSafeInteger(previousState?.activeHandIndex) ? previousState.activeHandIndex : 0;
  const nextActiveHandIndex = Number.isSafeInteger(nextState.activeHandIndex) ? nextState.activeHandIndex : 0;
  const splitCreated = previousHands.length === 1 && nextHands.length === 2 && acceptedAction === 'split';
  const newlySettled = Boolean(nextState.settled && !previousState?.settled);
  const activeHandChanged = Boolean(previousState && previousActiveHandIndex !== nextActiveHandIndex);
  const scale = reducedMotion ? 0 : 1;
  const playerCardsByHand = nextHands.map((hand, handIndex) => {
    let previousCount = previousHands[handIndex]?.cards?.length || 0;
    let baseDelay = 0;
    if (acceptedStart) {
      previousCount = 0;
      baseDelay = handIndex * BLACKJACK_DEAL_CADENCE_MS;
    } else if (splitCreated) {
      previousCount = 1;
      baseDelay = BLACKJACK_SPLIT_SEPARATION_MS + handIndex * BLACKJACK_DEAL_CADENCE_MS;
    }
    return (hand.cards || []).slice(previousCount).map((card, offset) => ({
      index: previousCount + offset,
      delayMs: scale * (acceptedStart
        ? (offset * 2) * BLACKJACK_DEAL_CADENCE_MS
        : baseDelay + offset * BLACKJACK_DEAL_CADENCE_MS)
    }));
  });
  const previousDealerCount = acceptedStart ? 0 : (previousState?.dealerHand?.length || 0);
  const revealDealerAtMs = newlySettled ? 0 : null;
  const dealerBaseDelay = newlySettled ? BLACKJACK_DEAL_CADENCE_MS : 0;
  const dealerCards = (nextState.dealerHand || []).slice(previousDealerCount).map((card, offset) => ({
    index: previousDealerCount + offset,
    delayMs: scale * (acceptedStart
      ? (offset * 2 + 1) * BLACKJACK_DEAL_CADENCE_MS
      : dealerBaseDelay + offset * BLACKJACK_DEAL_CADENCE_MS)
  }));

  const latestPlayerCardMs = Math.max(0, ...playerCardsByHand.flat().map(card => card.delayMs));
  const latestDealerCardMs = Math.max(0, ...dealerCards.map(card => card.delayMs));
  const hasCardMotion = playerCardsByHand.some(cards => cards.length) || dealerCards.length > 0;
  let kind = acceptedStart ? 'deal' : splitCreated ? 'split' : activeHandChanged ? 'hand-handoff' : acceptedAction || 'update';
  let handoffAtMs = scale * (hasCardMotion ? Math.max(latestPlayerCardMs, latestDealerCardMs) + 420 : 180);
  let handSettlementAtMs = [];
  let walletCommitAtMs = 0;
  let summaryAtMs = 0;
  let completionMs = scale * (hasCardMotion ? Math.max(latestPlayerCardMs, latestDealerCardMs) + 760 : activeHandChanged ? 360 : acceptedAction ? 620 : 0);

  if (newlySettled) {
    kind = 'settlement';
    const dealerCompleteAtMs = scale * (Math.max(BLACKJACK_DEAL_CADENCE_MS, latestDealerCardMs) + 760);
    handSettlementAtMs = nextHands.map((hand, index) => dealerCompleteAtMs + scale * index * BLACKJACK_HAND_SETTLEMENT_CADENCE_MS);
    const lastHandAtMs = handSettlementAtMs.at(-1) || dealerCompleteAtMs;
    walletCommitAtMs = lastHandAtMs + scale * 320;
    summaryAtMs = walletCommitAtMs + scale * 260;
    completionMs = summaryAtMs + scale * 420;
    handoffAtMs = 0;
  }

  return {
    ...empty,
    kind,
    replaySettlement: newlySettled,
    splitCreated,
    activeHandChanged,
    previousActiveHandIndex,
    nextActiveHandIndex,
    preservedSplitCardIndices: splitCreated ? [0, 1] : [],
    playerCardsByHand,
    dealerCards,
    revealDealerAtMs,
    handoffAtMs,
    handSettlementAtMs,
    walletCommitAtMs,
    summaryAtMs,
    completionMs
  };
}

class BlackjackGame {
  constructor(casinoManager) {
    this.casino = casinoManager;
    this.deck = [];
    this.playerHand = [];
    this.playerHands = [];
    this.activeHandIndex = 0;
    this.serverCapabilities = { canHit: false, canStand: false, canDouble: false, canSplit: false };
    this.dealerHand = [];
    this.gameOver = false;
    this.betAmount = 0;
    this.currentBet = 0;
    this.insuranceBet = 0;
    this.hasDoubledDown = false;
    this.hasTakenInsurance = false;
    this.insuranceOffered = false;
    this.lastHideFirstStates = {};
    this.initialHandSize = 2; // Track initial hand size (2 cards)
    this.soundHydrated = false;
    this.soundAcceptedRoundId = null;
    this.presentationTimers = new Set();
    this.presentationGeneration = 0;
    this.presentationInProgress = false;
    this.lastServerState = null;
    this.pendingAction = null;
    this.pendingActionRequest = null;
    this.roundRevision = 0;
    this.reducedMotion = Boolean(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches);
    this.defaultStake = Math.min(100, Math.max(0, Math.floor(this.casino.credits || 0)));
    this.stakeChips = this.defaultStake === 100 ? [100] : [];
    this.boundKeyboardHandler = event => this.handleKeyboard(event);
    this.init();
  }

  init() {
    const gameView = document.getElementById('blackjackGame');
    this.root = gameView;
    gameView.innerHTML = `
      <div class="blackjack-container is-wagering">
        <div class="blackjack-ambient" aria-hidden="true"></div>
        <header class="blackjack-table-header">
          <div>
            <span class="blackjack-eyebrow">NEON 777 PRIVATE TABLE</span>
            <h2 class="game-title"><span class="game-title-mark" aria-hidden="true"></span><span>Blackjack</span></h2>
          </div>
          <div class="blackjack-rules" aria-label="Table rules">
            <span>BLACKJACK PAYS 3:2</span>
            <span>DEALER STANDS ON ALL 17</span>
          </div>
        </header>

        <div class="blackjack-table-shell">
          <div class="betting-section blackjack-wager-rail">
            <div class="blackjack-bet-heading">
              <div><span class="blackjack-step">01</span><label for="blackjackBet">Choose your stake</label></div>
              <span class="blackjack-minimum">MIN 1 CREDIT</span>
            </div>
            <div class="bet-input-group blackjack-stake-composer">
              <div class="blackjack-bet-input-wrap">
                <input type="number" id="blackjackBet" min="1" max="${this.casino.credits}" value="${this.defaultStake}" step="10" inputmode="numeric" aria-describedby="blackjackBetUnit blackjackStakeStatus">
                <span id="blackjackBetUnit">CREDITS</span>
              </div>
              <div class="blackjack-chip-rack">
                <div class="blackjack-chip-rack-header">
                  <span class="blackjack-chip-rack-label">Quick select</span>
                  <output id="blackjackStakeStatus" for="blackjackBet" aria-live="polite"></output>
                </div>
                <div class="quick-bets" role="group" aria-label="Casino chip values">
                  <button type="button" class="quick-bet-btn casino-chip chip-50" data-amount="50" aria-pressed="false"><span>50</span></button>
                  <button type="button" class="quick-bet-btn casino-chip chip-100" data-amount="100" aria-pressed="false"><span>100</span></button>
                  <button type="button" class="quick-bet-btn casino-chip chip-250" data-amount="250" aria-pressed="false"><span>250</span></button>
                  <button type="button" class="quick-bet-btn casino-chip chip-500" data-amount="500" aria-pressed="false"><span>500</span></button>
                </div>
              </div>
              <div class="blackjack-stake-actions" aria-label="Stake controls">
                <button type="button" id="blackjackUndoStake" class="blackjack-stake-action">Undo</button>
                <button type="button" id="blackjackClearStake" class="blackjack-stake-action">Clear</button>
                <button type="button" id="blackjackMaxStake" class="blackjack-stake-action">Max</button>
              </div>
            </div>
            <button type="button" id="placeBetBtn" class="btn btn-primary blackjack-deal-btn"><span>Deal cards</span><span aria-hidden="true">→</span></button>
          </div>

          <div id="gameArea" class="game-area">
            <div class="blackjack-table-insignia" aria-hidden="true"><span>777</span><small>BLACKJACK</small></div>
            <div class="dealer-section">
              <div class="blackjack-hand-heading"><h3>Dealer</h3><span id="dealerResult" class="blackjack-hand-result dealer-result" aria-hidden="true"></span><div class="score-display"><span class="score-label">HAND</span><span id="dealerScore">0</span></div></div>
              <div id="dealerCards" class="cards-container"></div>
            </div>

            <div class="result-display" id="resultDisplay" role="status" aria-live="polite"></div>

            <div class="player-section">
              <div id="playerHands" class="blackjack-player-hands">
                <article class="blackjack-player-hand is-active" data-hand-index="0">
                  <div class="blackjack-hand-heading"><h3>You</h3><span class="blackjack-hand-result" aria-hidden="true"></span><div class="score-display"><span class="score-label">HAND</span><span id="playerScore">0</span></div></div>
                  <div id="playerCards" class="cards-container"></div>
                </article>
              </div>
            </div>

            <div id="insuranceSection" class="insurance-section hidden">
              <div class="insurance-prompt">
                <p class="insurance-title">Dealer shows an Ace — take insurance?</p>
                <p class="insurance-info">Costs half your bet. Pays 2:1 if dealer has blackjack.</p>
                <div class="insurance-buttons">
                  <button type="button" id="takeInsuranceBtn" class="btn btn-primary">Take insurance</button>
                  <button type="button" id="declineInsuranceBtn" class="btn btn-secondary">No insurance</button>
                </div>
              </div>
            </div>

            <div class="game-controls">
              <button type="button" id="hitBtn" class="btn btn-primary"><span>Hit</span><kbd>H</kbd></button>
              <button type="button" id="standBtn" class="btn btn-secondary"><span>Stand</span><kbd>S</kbd></button>
              <button type="button" id="doubleDownBtn" class="btn btn-secondary hidden"><span>Double</span><kbd>D</kbd></button>
              <button type="button" id="splitBtn" class="btn btn-secondary hidden"><span>Split</span><kbd>P</kbd></button>
              <button type="button" id="newGameBtn" class="btn btn-secondary"><span>New round</span><kbd>N</kbd></button>
            </div>
          </div>
        </div>
      </div>
    `;

    this.attachEventListeners();
    this.updateGameControls();
  }

  getElement(id) {
    return this.root?.querySelector(`#${id}`) || null;
  }

  attachEventListeners() {
    // Betting
    this.getElement('placeBetBtn')?.addEventListener('click', () => this.placeBet());
    this.root?.querySelectorAll('.quick-bet-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const amount = parseInt(btn.dataset.amount);
        this.selectStakeChip(amount);
      });
    });
    this.getElement('blackjackUndoStake')?.addEventListener('click', () => this.undoStakeChip());
    this.getElement('blackjackClearStake')?.addEventListener('click', () => this.clearStake());
    this.getElement('blackjackMaxStake')?.addEventListener('click', () => this.setMaxStake());
    this.getElement('blackjackBet')?.addEventListener('input', () => {
      this.stakeChips = [];
      this.syncSelectedChip();
    });
    this.syncSelectedChip();

    // Game controls
    this.getElement('hitBtn')?.addEventListener('click', () => this.hit());
    this.getElement('standBtn')?.addEventListener('click', () => this.stand());
    this.getElement('doubleDownBtn')?.addEventListener('click', () => this.doubleDown());
    this.getElement('splitBtn')?.addEventListener('click', () => this.split());
    this.getElement('newGameBtn')?.addEventListener('click', () => this.resetGame());
    
    // Insurance controls
    this.getElement('takeInsuranceBtn')?.addEventListener('click', () => this.takeInsurance());
    this.getElement('declineInsuranceBtn')?.addEventListener('click', () => this.declineInsurance());
    document.addEventListener('keydown', this.boundKeyboardHandler);
  }

  setStakeAmount(amount) {
    const input = this.getElement('blackjackBet');
    if (input) input.value = String(Math.max(0, Math.floor(amount)));
    this.syncSelectedChip();
  }

  selectStakeChip(amount) {
    if (amount > this.casino.credits) return this.showError('That chip exceeds your available credits.');
    this.stakeChips = [amount];
    this.setStakeAmount(amount);
    window.casinoSound?.play('chip', { game: 'blackjack' });
  }

  undoStakeChip() {
    if (!this.stakeChips.length) return;
    const removed = this.stakeChips.pop();
    const current = Number(this.getElement('blackjackBet')?.value) || 0;
    this.setStakeAmount(current - removed);
    window.casinoSound?.play('betCancelled', { game: 'blackjack', volume: .55 });
  }

  clearStake() {
    this.stakeChips = [];
    this.setStakeAmount(0);
  }

  setMaxStake() {
    this.stakeChips = [];
    this.setStakeAmount(Math.max(0, Math.floor(this.casino.credits)));
  }

  syncSelectedChip() {
    const selectedAmount = this.stakeChips.length === 1 ? this.stakeChips[0] : null;
    this.root?.querySelectorAll('.quick-bet-btn').forEach(chip => {
      const amount = Number(chip.dataset.amount);
      const selected = amount === selectedAmount;
      chip.classList.toggle('is-selected', selected);
      chip.setAttribute('aria-pressed', String(selected));
      chip.dataset.count = '';
      chip.setAttribute('aria-label', `${amount} credits${selected ? ', selected' : ''}`);
    });
    const amount = Number(this.getElement('blackjackBet')?.value) || 0;
    const status = this.getElement('blackjackStakeStatus');
    if (status) status.textContent = amount > 0 ? `${amount} credits selected` : 'No stake selected';
  }

  async placeBet() {
    const betInput = this.getElement('blackjackBet');
    const amount = Number(betInput?.value);
    if (!Number.isSafeInteger(amount) || amount < 1) return this.showError('Enter a valid whole-number bet.');
    if (amount > this.casino.credits) return this.showError('Insufficient credits.');
    this.setBusy(true);
    try {
      const response = await this.casino.apiFetch('/api/games/blackjack/start', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ bet: amount })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Unable to start blackjack');
      this.soundAcceptedRoundId = data.state?.roundId || null;
      this.applyServerState(data.state, data.balance);
      this.casino.stabilizeGameViewport?.(this.getElement('gameArea'));
    } catch (error) {
      this.showError(error.message);
    } finally {
      this.setBusy(false);
    }
  }

  setBusy(isBusy) {
    ['placeBetBtn', 'hitBtn', 'standBtn', 'doubleDownBtn', 'splitBtn', 'takeInsuranceBtn', 'declineInsuranceBtn']
      .forEach(id => { const button = this.getElement(id); if (button) button.disabled = isBusy; });
    this.root?.querySelector('.blackjack-table-shell')?.classList.toggle('is-busy', isBusy);
  }

  showError(message) {
    const result = this.getElement('resultDisplay');
    if (result) {
      result.textContent = message;
      result.className = 'result-display lose';
    }
  }

  async requestAction(action) {
    if (!this.roundId || this.gameOver) return;
    this.pendingAction = action;
    const signature = JSON.stringify({ roundId: this.roundId, revision: this.roundRevision, activeHandIndex: this.activeHandIndex, action });
    if (!this.pendingActionRequest || this.pendingActionRequest.signature !== signature) {
      this.pendingActionRequest = {
        signature,
        requestId: globalThis.crypto?.randomUUID?.() || `blackjack_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`
      };
    }
    let definitiveResponse = false;
    this.setBusy(true);
    try {
      const response = await this.casino.apiFetch('/api/games/blackjack/action', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          roundId: this.roundId,
          action,
          requestId: this.pendingActionRequest.requestId,
          expectedRevision: this.roundRevision,
          activeHandIndex: this.activeHandIndex
        })
      });
      const data = await response.json();
      definitiveResponse = response.status < 500;
      if (!response.ok) throw new Error(data.error || 'Blackjack action failed');
      const actionEffect = {
        hit: 'blackjackHit',
        stand: 'blackjackStand',
        double: 'blackjackDouble',
        split: 'blackjackSplit'
      }[action];
      if (actionEffect) window.casinoSound?.play(actionEffect, { game: 'blackjack' });
      this.applyServerState(data.state, data.balance);
    } catch (error) {
      this.showError(error.message);
      window.casinoSound?.play('error', { game: 'blackjack' });
    } finally {
      if (definitiveResponse) this.pendingActionRequest = null;
      this.pendingAction = null;
      this.setBusy(false);
      this.updateGameControls();
    }
  }

  cancelPresentation() {
    this.presentationTimers.forEach(timer => clearTimeout(timer));
    this.presentationTimers.clear();
    this.presentationGeneration += 1;
    this.presentationInProgress = false;
    const shell = this.root?.querySelector('.blackjack-table-shell');
    shell?.classList.remove('is-presenting', 'is-dealer-turn', 'is-settling', 'is-credit-settling', 'is-resetting');
    shell?.removeAttribute('data-action');
  }

  schedulePresentation(generation, delayMs, callback) {
    if (delayMs <= 0) {
      if (generation === this.presentationGeneration) callback();
      return null;
    }
    const timer = setTimeout(() => {
      this.presentationTimers.delete(timer);
      if (generation === this.presentationGeneration) callback();
    }, delayMs);
    this.presentationTimers.add(timer);
    return timer;
  }

  markAcceptedAction(action) {
    const shell = this.root?.querySelector('.blackjack-table-shell');
    if (!shell || !action) return;
    shell.dataset.action = action;
    const button = this.getElement({ hit: 'hitBtn', stand: 'standBtn', double: 'doubleDownBtn', split: 'splitBtn', insurance: 'takeInsuranceBtn', declineInsurance: 'declineInsuranceBtn' }[action]);
    button?.classList.add('is-action-accepted');
    const generation = this.presentationGeneration;
    this.schedulePresentation(generation, this.reducedMotion ? 0 : 420, () => {
      button?.classList.remove('is-action-accepted');
      if (shell.dataset.action === action) shell.removeAttribute('data-action');
    });
  }

  pulseCredits() {
    const credits = document.getElementById('creditsAmount');
    if (!credits) return;
    credits.classList.remove('blackjack-credit-settled');
    void credits.offsetWidth;
    credits.classList.add('blackjack-credit-settled');
    const generation = this.presentationGeneration;
    this.schedulePresentation(generation, this.reducedMotion ? 0 : 760, () => credits.classList.remove('blackjack-credit-settled'));
  }

  applyServerState(state, balance) {
    const sameRound = this.roundId === state.roundId;
    const previousState = sameRound ? this.lastServerState : null;
    const nextHands = blackjackHands(state);
    const acceptedStart = Boolean(state.roundId && this.soundAcceptedRoundId === state.roundId);
    const initialHydration = !this.soundHydrated && !acceptedStart;
    const acceptedAction = sameRound ? this.pendingAction : null;
    const activeHandIndex = Number.isSafeInteger(state.activeHandIndex) ? state.activeHandIndex : 0;
    const plan = buildBlackjackTransitionPlan({
      previousState,
      nextState: state,
      acceptedAction,
      acceptedStart,
      initialHydration,
      reducedMotion: this.reducedMotion
    });

    this.cancelPresentation();
    const generation = this.presentationGeneration;
    this.presentationInProgress = plan.completionMs > 0;
    this.soundHydrated = true;
    if (acceptedStart) this.soundAcceptedRoundId = null;
    this.roundId = state.roundId;
    this.roundRevision = Number.isSafeInteger(state.revision) ? state.revision : 0;
    this.currentBet = state.bet;
    this.insuranceBet = state.insuranceBet;
    this.playerHands = nextHands;
    this.activeHandIndex = activeHandIndex;
    this.playerHand = nextHands[activeHandIndex]?.cards || nextHands[0]?.cards || [];
    this.dealerHand = state.dealerHand || [];
    this.gameOver = Boolean(state.settled);
    this.hasDoubledDown = Boolean(nextHands[activeHandIndex]?.doubled);
    this.insuranceOffered = state.phase === 'insurance';
    this.serverCapabilities = {
      canHit: state.canHit !== false,
      canStand: state.canStand !== false,
      canDouble: Boolean(state.canDouble),
      canSplit: Boolean(state.canSplit)
    };
    this.lastServerState = state;

    const shell = this.root?.querySelector('.blackjack-table-shell');
    shell?.classList.toggle('is-presenting', this.presentationInProgress);
    shell?.classList.toggle('is-dealer-turn', plan.kind === 'settlement');
    shell?.classList.toggle('is-settling', plan.kind === 'settlement');
    shell?.classList.toggle('has-split-hands', nextHands.length > 1);
    if (acceptedAction) this.markAcceptedAction(acceptedAction);

    this.root?.querySelector('.betting-section')?.classList.add('is-locked');
    const betInput = this.getElement('blackjackBet');
    betInput?.setAttribute('aria-readonly', 'true');
    if (betInput) betInput.readOnly = true;

    const visibleActiveIndex = plan.activeHandChanged && plan.completionMs > 0 ? plan.previousActiveHandIndex : activeHandIndex;
    this.renderPlayerHands(nextHands, visibleActiveIndex, false, plan.playerCardsByHand, {
      preserveSplit: plan.splitCreated,
      showSettledResults: Boolean(state.settled && !plan.replaySettlement)
    });
    this.displayCards('dealerCards', this.dealerHand, !state.settled, plan.dealerCards);
    this.renderDealerOutcome(state, Boolean(state.settled && !plan.replaySettlement));
    this.setScoreSoftState('dealerScore', Boolean(state.dealerSoft));

    const insurance = this.getElement('insuranceSection');
    const insuranceResolving = previousState?.phase === 'insurance'
      && state.phase !== 'insurance'
      && ['insurance', 'declineInsurance'].includes(acceptedAction);
    if (insuranceResolving) {
      insurance?.classList.remove('hidden');
      insurance?.classList.add('is-resolving');
      if (insurance) insurance.dataset.decision = acceptedAction === 'insurance' ? 'Insurance accepted' : 'Insurance declined';
      this.schedulePresentation(generation, this.reducedMotion ? 0 : 420, () => {
        insurance?.classList.add('hidden');
        insurance?.classList.remove('is-resolving');
        insurance?.removeAttribute('data-decision');
        this.root?.querySelector('.blackjack-container')?.classList.remove('insurance-active');
      });
    } else {
      insurance?.classList.toggle('hidden', state.phase !== 'insurance');
      insurance?.classList.remove('is-resolving');
      insurance?.removeAttribute('data-decision');
    }
    this.root?.querySelector('.blackjack-container')?.classList.toggle('insurance-active', state.phase === 'insurance' || insuranceResolving);
    const result = this.getElement('resultDisplay');
    if (result && plan.replaySettlement) {
      result.textContent = '';
      result.removeAttribute('aria-label');
      result.className = 'result-display';
    }
    if (plan.replaySettlement) {
      this.renderPlayerHandResults(nextHands, false);
      this.setActiveHandFocus(-1);
      const dealerScore = this.getElement('dealerScore');
      if (dealerScore) dealerScore.textContent = String(previousState?.dealerScore || '?');
    }

    this.scheduleBlackjackSounds(state, plan, acceptedStart, generation);
    if (plan.activeHandChanged && !state.settled) {
      const previousHand = previousState ? blackjackHands(previousState)[plan.previousActiveHandIndex] : null;
      this.schedulePresentation(generation, plan.handoffAtMs, () => {
        this.markCompletedActionHand(plan.previousActiveHandIndex, previousHand, acceptedAction);
        this.setActiveHandFocus(activeHandIndex);
      });
    }

    const validBalance = Number.isFinite(balance) && balance >= 0 && Number.isSafeInteger(Math.round(balance * 1000));
    const commitBalance = () => {
      if (!validBalance) return;
      this.casino.setCredits(balance);
      if (acceptedAction === 'double' || acceptedAction === 'split' || plan.replaySettlement) this.pulseCredits();
    };

    if (plan.replaySettlement) {
      const settledDealerCards = (state.dealerHand || []).filter(Boolean);
      const updateDealerScoreThrough = cardCount => {
        const dealerScore = this.getElement('dealerScore');
        const evaluation = this.calculateScoreDetails(settledDealerCards.slice(0, cardCount));
        if (dealerScore) dealerScore.textContent = String(evaluation.score);
        this.setScoreSoftState('dealerScore', evaluation.isSoft);
      };
      this.schedulePresentation(generation, plan.revealDealerAtMs || 0, () => updateDealerScoreThrough(Math.min(2, settledDealerCards.length)));
      plan.dealerCards.forEach(card => {
        this.schedulePresentation(generation, card.delayMs + (this.reducedMotion ? 0 : 300), () => updateDealerScoreThrough(card.index + 1));
      });
      const dealerCompleteAtMs = plan.handSettlementAtMs[0] ?? 0;
      this.schedulePresentation(generation, dealerCompleteAtMs, () => this.renderDealerOutcome(state, true));
      plan.handSettlementAtMs.forEach((delayMs, index) => {
        this.schedulePresentation(generation, delayMs, () => this.renderPlayerHandResult(nextHands[index], index, true));
      });
      this.schedulePresentation(generation, plan.walletCommitAtMs, () => {
        shell?.classList.add('is-credit-settling');
        commitBalance();
      });
      this.schedulePresentation(generation, plan.summaryAtMs, () => this.renderRoundSummary(state, nextHands));
    } else if (plan.completionMs > 0) {
      this.schedulePresentation(generation, Math.min(plan.completionMs, this.reducedMotion ? 0 : 460), commitBalance);
    } else {
      commitBalance();
      if (state.settled) {
        this.renderPlayerHandResults(nextHands, true);
        this.renderRoundSummary(state, nextHands);
        const dealerScore = this.getElement('dealerScore');
        if (dealerScore) dealerScore.textContent = String(state.dealerScore);
      }
    }

    const finishPresentation = () => {
      this.presentationInProgress = false;
      shell?.classList.remove('is-presenting', 'is-dealer-turn', 'is-settling', 'is-credit-settling');
      this.setActiveHandFocus(state.settled ? -1 : activeHandIndex);
      this.updateGameControls();
      this.casino.stabilizeGameViewport?.(this.getElement('gameArea'));
    };
    if (plan.completionMs > 0) this.schedulePresentation(generation, plan.completionMs, finishPresentation);
    else finishPresentation();
    this.updateGameControls();
  }

  scheduleBlackjackSounds(state, plan, acceptedStart, generation) {
    const sound = window.casinoSound;
    if (!sound || !state.roundId) return;
    if (acceptedStart) sound.playOnce(`blackjack:${state.roundId}:wager`, 'wager', { game: 'blackjack' });
    const dealtCards = [
      ...plan.playerCardsByHand.flatMap((cards, handIndex) => cards.map(card => ({ ...card, hand: `player-${handIndex}` }))),
      ...plan.dealerCards.map(card => ({ ...card, hand: 'dealer' }))
    ].sort((a, b) => a.delayMs - b.delayMs);
    dealtCards.forEach(card => this.schedulePresentation(generation, card.delayMs, () => {
      sound.playOnce(`blackjack:${state.roundId}:deal:${card.hand}:${card.index}`, 'cardDeal', {
        cooldown: 0,
        game: 'blackjack',
        pan: card.hand === 'dealer' ? .18 : -.18
      });
    }));
    if (plan.revealDealerAtMs !== null) {
      this.schedulePresentation(generation, plan.revealDealerAtMs, () => {
        sound.playOnce(`blackjack:${state.roundId}:reveal`, 'cardFlip', { cooldown: 0, game: 'blackjack' });
      });
    }
    if (plan.replaySettlement) {
      const totalStake = state.bet + (state.insuranceBet || 0);
      const resultSound = state.payout > totalStake ? 'win' : state.payout === totalStake ? 'push' : 'lose';
      this.schedulePresentation(generation, plan.summaryAtMs, () => {
        sound.playOnce(`blackjack:${state.roundId}:result`, resultSound, { cooldown: 0, game: 'blackjack' });
      });
    }
  }

  createPlayerHandArticle(index, handCount) {
    const article = document.createElement('article');
    article.className = 'blackjack-player-hand';
    article.dataset.handIndex = String(index);
    const heading = document.createElement('div');
    heading.className = 'blackjack-hand-heading';
    const title = document.createElement('h3');
    title.textContent = handCount > 1 ? `Hand ${index + 1}` : 'You';
    const badge = document.createElement('span');
    badge.className = 'blackjack-hand-result';
    badge.setAttribute('aria-hidden', 'true');
    const score = document.createElement('div');
    score.className = 'score-display';
    score.innerHTML = `<span class="score-label">HAND</span><span id="${index ? `playerScore${index}` : 'playerScore'}">0</span>`;
    const cards = document.createElement('div');
    cards.id = index ? `playerCards${index}` : 'playerCards';
    cards.className = 'cards-container';
    heading.append(title, badge, score);
    article.append(heading, cards);
    return article;
  }

  prepareSplitHands(host, hands) {
    const existingCards = [...host.querySelectorAll('.blackjack-card')].slice(0, 2);
    host.replaceChildren();
    hands.forEach((hand, index) => {
      const article = this.createPlayerHandArticle(index, hands.length);
      article.classList.add('is-splitting');
      const card = existingCards[index];
      if (card) {
        card.classList.add(index === 0 ? 'is-split-left' : 'is-split-right');
        article.querySelector('.cards-container')?.appendChild(card);
      }
      host.appendChild(article);
    });
    const generation = this.presentationGeneration;
    this.schedulePresentation(generation, this.reducedMotion ? 0 : BLACKJACK_SPLIT_SEPARATION_MS + 120, () => {
      host.querySelectorAll('.is-splitting').forEach(element => element.classList.remove('is-splitting'));
      host.querySelectorAll('.is-split-left,.is-split-right').forEach(element => element.classList.remove('is-split-left', 'is-split-right'));
    });
  }

  renderPlayerHands(hands, activeHandIndex, settled, animatedCardsByHand = [], options = {}) {
    const host = this.getElement('playerHands');
    if (!host) return;
    if (options.preserveSplit && host.children.length === 1 && hands.length === 2) {
      this.prepareSplitHands(host, hands);
    } else if (host.children.length !== hands.length) {
      host.replaceChildren(...hands.map((hand, index) => this.createPlayerHandArticle(index, hands.length)));
    }

    hands.forEach((hand, index) => {
      const article = host.querySelector(`[data-hand-index="${index}"]`);
      article?.classList.toggle('is-active', !settled && index === activeHandIndex);
      const score = this.getElement(index ? `playerScore${index}` : 'playerScore');
      if (score) score.textContent = String(hand.score ?? this.calculateScore(hand.cards || []));
      this.setScoreSoftState(index ? `playerScore${index}` : 'playerScore', Boolean(hand.isSoft));
      this.displayCards(index ? `playerCards${index}` : 'playerCards', hand.cards || [], false, animatedCardsByHand[index] || []);
      const cards = this.getElement(index ? `playerCards${index}` : 'playerCards');
      cards?.classList.toggle('is-crowded', (hand.cards?.length || 0) >= 4);
      cards?.style.setProperty('--hand-size', String(hand.cards?.length || 0));
    });
    this.renderPlayerHandResults(hands, Boolean(options.showSettledResults));
  }

  setActiveHandFocus(activeHandIndex) {
    const hands = this.getElement('playerHands')?.querySelectorAll('.blackjack-player-hand') || [];
    hands.forEach((article, index) => {
      const active = index === activeHandIndex;
      article.classList.toggle('is-active', active);
      article.classList.toggle('is-inactive-hand', activeHandIndex >= 0 && !active);
      article.setAttribute('aria-current', active ? 'step' : 'false');
    });
  }

  markCompletedActionHand(index, hand, action) {
    const article = this.getElement('playerHands')?.querySelector(`[data-hand-index="${index}"]`);
    if (!article) return;
    article.classList.add('is-hand-complete');
    const badge = article.querySelector('.blackjack-hand-result');
    const bust = hand?.result === 'bust' || Number(hand?.score) > 21;
    const blackjack = hand?.result === 'blackjack';
    article.classList.toggle('is-bust', bust);
    article.classList.toggle('is-blackjack', blackjack);
    if (badge) badge.textContent = bust ? 'BUST' : blackjack ? 'BLACKJACK' : action === 'stand' ? 'STAND' : hand?.complete ? 'DONE' : '';
  }

  renderPlayerHandResult(hand, index, settled) {
    const article = this.getElement('playerHands')?.querySelector(`[data-hand-index="${index}"]`);
    if (!article) return;
    const winner = settled && ['win', 'blackjack'].includes(hand?.result);
    const loser = settled && ['loss', 'bust', 'dealer_blackjack'].includes(hand?.result);
    const push = settled && hand?.result === 'push';
    article.classList.remove('is-hand-complete', 'is-bust', 'is-blackjack', 'is-winner', 'is-loser', 'is-push');
    article.classList.toggle('is-winner', winner);
    article.classList.toggle('is-loser', loser);
    article.classList.toggle('is-push', push);
    article.classList.add('is-settlement-reveal');
    const badge = article.querySelector('.blackjack-hand-result');
    if (badge) badge.textContent = winner ? (hand.result === 'blackjack' ? 'BLACKJACK' : 'WIN') : loser ? 'LOSS' : push ? 'PUSH' : '';
  }

  renderDealerOutcome(state, settled) {
    const section = this.root?.querySelector('.dealer-section');
    const badge = this.getElement('dealerResult');
    const score = Number(state?.dealerScore);
    const dealerBlackjack = score === 21 && (state?.dealerHand?.length || 0) === 2;
    const bust = score > 21;
    const hands = blackjackHands(state);
    const dealerWon = settled && !bust && hands.every(hand => ['loss', 'bust', 'dealer_blackjack'].includes(hand.result));
    section?.classList.toggle('is-bust', settled && bust);
    section?.classList.toggle('is-blackjack', settled && dealerBlackjack);
    if (badge) badge.textContent = !settled ? '' : bust ? 'BUST' : dealerBlackjack ? 'BLACKJACK' : dealerWon ? 'WINS' : 'STANDS';
  }

  renderRoundSummary(state, hands) {
    const result = this.getElement('resultDisplay');
    if (!result || !state.settled) return;
    this.renderPlayerHandResults(hands, true);
    this.renderDealerOutcome(state, true);
    const totalStake = state.bet + (state.insuranceBet || 0);
    const net = state.payout - totalStake;
    const outcomeKinds = hands.map(hand => ['win', 'blackjack'].includes(hand.result) ? 'win'
      : hand.result === 'push' ? 'push' : 'loss');
    const mixedHands = new Set(outcomeKinds).size > 1;
    const visualResult = mixedHands ? 'MIXED' : net > 0 ? 'WIN' : net === 0 ? 'PUSH' : 'LOSS';
    const amount = net > 0 ? `+${net}` : net < 0 ? String(net) : 'EVEN';
    result.textContent = `${visualResult} · ${amount} CREDITS`;
    result.setAttribute('aria-label', `Round complete. ${visualResult}. Payout ${state.payout} credits.`);
    result.className = `result-display ${state.payout > totalStake ? 'win' : state.payout === totalStake ? 'tie' : 'lose'}`;
  }

  renderPlayerHandResults(hands, settled) {
    let winnerCount = 0;
    let loserCount = 0;
    hands.forEach((hand, index) => {
      const article = this.getElement('playerHands')?.querySelector(`[data-hand-index="${index}"]`);
      if (!article) return;
      const winner = settled && ['win', 'blackjack'].includes(hand.result);
      const loser = settled && ['loss', 'bust', 'dealer_blackjack'].includes(hand.result);
      const push = settled && hand.result === 'push';
      if (winner) winnerCount += 1;
      if (loser) loserCount += 1;
      article.classList.toggle('is-winner', winner);
      article.classList.toggle('is-loser', loser);
      article.classList.toggle('is-push', push);
      const badge = article.querySelector('.blackjack-hand-result');
      if (badge) badge.textContent = winner ? (hand.result === 'blackjack' ? 'BLACKJACK' : 'WIN') : loser ? 'LOSS' : push ? 'PUSH' : '';
    });
    const dealer = this.root?.querySelector('.dealer-section');
    const dealerWinner = settled && loserCount === hands.length;
    const dealerLoser = settled && winnerCount === hands.length;
    dealer?.classList.toggle('is-winner', dealerWinner);
    dealer?.classList.toggle('is-loser', dealerLoser);
  }

  handleKeyboard(event) {
    if (!this.root || this.root.classList.contains('hidden') || event.altKey || event.ctrlKey || event.metaKey) return;
    if (['INPUT', 'TEXTAREA', 'SELECT'].includes(event.target?.tagName)) return;
    const actions = {
      h: () => this.getElement('hitBtn')?.click(),
      s: () => this.getElement('standBtn')?.click(),
      d: () => this.getElement('doubleDownBtn')?.click(),
      p: () => this.getElement('splitBtn')?.click(),
      n: () => this.getElement('newGameBtn')?.click()
    };
    const action = actions[event.key.toLowerCase()];
    if (!action) return;
    event.preventDefault();
    action();
  }

  async startGame() {
    // Legacy local-deck method retained only for compatibility; production rounds are server-authoritative.

    this.createDeck();
    this.shuffleDeck();
    this.playerHand = [];
    this.dealerHand = [];
    this.gameOver = false;

    // Clear card containers
    this.getElement('playerCards').innerHTML = '';
    this.getElement('dealerCards').innerHTML = '';
    this.lastHideFirstStates = {}; // Reset states for new game

    // Deal initial cards with animation delay
    this.dealCard(this.playerHand);
    await this.delay(300);
    this.updateDisplay();
    
    this.dealCard(this.dealerHand);
    await this.delay(300);
    this.updateDisplay();
    
    this.dealCard(this.playerHand);
    await this.delay(300);
    this.updateDisplay();
    
    this.dealCard(this.dealerHand);
    await this.delay(300);
    this.updateDisplay();

    // Check if dealer shows an Ace - offer insurance
    if (this.dealerHand[1] && this.dealerHand[1].value === 'ace') {
      this.insuranceOffered = true;
      this.showInsuranceOption();
      return; // Wait for insurance decision before proceeding
    }

    // Check for player blackjack
    const playerScoreInfo = this.calculateScoreWithAces(this.playerHand, true);
    if (playerScoreInfo.best === 21) {
      // Player gets blackjack - reveal dealer's first card before ending game
      this.gameOver = true;
      this.updateDisplay(); // Reveal dealer's card
      await this.delay(500); // Brief delay to show revealed card
      this.endGame('blackjack');
      return;
    }

    // Show double down button if player has exactly 2 cards
    this.updateGameControls();
  }
  
  delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  createDeck() {
    this.deck = [];
    const suits = ['hearts', 'diamonds', 'clubs', 'spades'];
    const values = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'jack', 'queen', 'king', 'ace'];
    
    suits.forEach(suit => {
      values.forEach(value => {
        this.deck.push({ suit, value });
      });
    });
  }

  shuffleDeck() {
    for (let i = this.deck.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [this.deck[i], this.deck[j]] = [this.deck[j], this.deck[i]];
    }
  }

  dealCard(hand) {
    if (this.deck.length === 0) {
      this.createDeck();
      this.shuffleDeck();
    }
    hand.push(this.deck.pop());
  }

  calculateScoreDetails(hand) {
    let score = 0;
    let usableAces = 0;
    for (const card of hand) {
      if (card.value === 'ace') {
        score += 11;
        usableAces += 1;
      } else if (['king', 'queen', 'jack'].includes(card.value)) {
        score += 10;
      } else {
        score += Number(card.value);
      }
    }
    while (score > 21 && usableAces > 0) {
      score -= 10;
      usableAces -= 1;
    }
    return { score, isSoft: usableAces > 0 };
  }

  calculateScore(hand) {
    return this.calculateScoreDetails(hand).score;
  }

  calculateScoreWithAces(hand) {
    const { score, isSoft } = this.calculateScoreDetails(hand);
    return {
      high: score,
      low: isSoft ? score - 10 : score,
      hasAce: hand.some(card => card.value === 'ace'),
      best: score,
      isSoft,
      showBoth: false
    };
  }

  setScoreSoftState(scoreId, isSoft) {
    const score = this.getElement(scoreId);
    const label = score?.closest('.score-display')?.querySelector('.score-label');
    if (!score || !label) return;
    label.textContent = isSoft ? 'SOFT' : 'HAND';
    score.closest('.score-display')?.classList.toggle('is-soft', Boolean(isSoft));
    score.setAttribute('aria-label', `${isSoft ? 'Soft ' : ''}${score.textContent}`);
  }

  showInsuranceOption() {
    this.root?.querySelector('.blackjack-container')?.classList.add('insurance-active');
    this.getElement('insuranceSection').classList.remove('hidden');
    this.getElement('hitBtn').disabled = true;
    this.getElement('standBtn').disabled = true;
    this.getElement('doubleDownBtn').classList.add('hidden');
  }

  async takeInsurance() {
    await this.requestAction('insurance');
  }

  async declineInsurance() {
    await this.requestAction('declineInsurance');
  }

  updateGameControls() {
    const container = this.root?.querySelector('.blackjack-container');
    container?.classList.toggle('is-wagering', !this.roundId);
    const active = Boolean(this.roundId) && !this.gameOver && !this.insuranceOffered && !this.presentationInProgress;
    const doubleDownBtn = this.getElement('doubleDownBtn');
    doubleDownBtn?.classList.toggle('hidden', !active || !this.serverCapabilities.canDouble);
    const splitBtn = this.getElement('splitBtn');
    splitBtn?.classList.toggle('hidden', !active || !this.serverCapabilities.canSplit);
    const hit = this.getElement('hitBtn');
    const stand = this.getElement('standBtn');
    const newGame = this.getElement('newGameBtn');
    const placeBet = this.getElement('placeBetBtn');
    hit?.classList.toggle('hidden', !active);
    stand?.classList.toggle('hidden', !active);
    if (hit) hit.disabled = !active || !this.serverCapabilities.canHit;
    if (stand) stand.disabled = !active || !this.serverCapabilities.canStand;
    if (doubleDownBtn) doubleDownBtn.disabled = !active || !this.serverCapabilities.canDouble;
    if (splitBtn) splitBtn.disabled = !active || !this.serverCapabilities.canSplit;
    newGame?.classList.toggle('hidden', !this.gameOver || this.presentationInProgress);
    if (newGame) newGame.disabled = !this.gameOver || this.presentationInProgress;
    if (placeBet) {
      placeBet.disabled = Boolean(this.roundId);
      placeBet.innerHTML = this.roundId
        ? '<span>Round in play</span><span aria-hidden="true">●</span>'
        : '<span>Deal cards</span><span aria-hidden="true">→</span>';
    }
  }

  async hit() {
    await this.requestAction('hit');
  }

  async doubleDown() {
    await this.requestAction('double');
  }

  async split() {
    await this.requestAction('split');
  }

  async stand() {
    await this.requestAction('stand');
  }

  endGame() {
    // Settlement is exclusively performed by the authoritative server API.
    this.showError('This round must be completed through the game controls.');
  }

  updateDisplay() {
    // Check if hands are still in initial state (2 cards)
    const playerIsInitialHand = this.playerHand.length === this.initialHandSize;
    const dealerIsInitialHand = this.dealerHand.length === this.initialHandSize;
    
    // Calculate scores with ace handling
    const playerScoreInfo = this.calculateScoreWithAces(this.playerHand, playerIsInitialHand);
    
    // Calculate dealer visible score (excluding first hidden card) before game over
    const dealerVisibleCards = this.dealerHand.slice(1);
    const dealerVisibleIsInitialHand = dealerVisibleCards.length === 1; // Only 1 visible card initially
    const dealerVisibleScoreInfo = dealerVisibleCards.length > 0 
      ? this.calculateScoreWithAces(dealerVisibleCards, dealerVisibleIsInitialHand) 
      : { best: 0, hasAce: false, high: 0, low: 0, showBoth: false };
    
    // Full dealer score (when revealed)
    const dealerScoreInfo = this.calculateScoreWithAces(this.dealerHand, dealerIsInitialHand);

    // Format player score display - only show "xx/xx" if in initial hand and both values valid
    const playerScoreDisplay = playerScoreInfo.showBoth 
      ? `${playerScoreInfo.high}/${playerScoreInfo.low}` 
      : playerScoreInfo.best;
    this.animateScoreChange('playerScore', playerScoreDisplay);
    this.setScoreSoftState('playerScore', playerScoreInfo.isSoft);
    
    // Format dealer score display
    // Before game over: show only visible card(s) score
    // After game over: show full score
    let dealerScoreDisplay;
    if (this.gameOver) {
      // Dealer's turn - show full score, but only "xx/xx" format if still in initial hand and both values valid
      dealerScoreDisplay = dealerScoreInfo.showBoth
        ? `${dealerScoreInfo.high}/${dealerScoreInfo.low}`
        : dealerScoreInfo.best;
    } else {
      // Player's turn - show only visible card score
      // If dealer has only 1 card (first card, which will be hidden), don't show score
      if (this.dealerHand.length === 1) {
        dealerScoreDisplay = '?';
      } else if (this.dealerHand.length > 1) {
        // Dealer has 2+ cards, show only visible card(s) score (excluding first hidden card)
        dealerScoreDisplay = dealerVisibleScoreInfo.showBoth
          ? `${dealerVisibleScoreInfo.high}/${dealerVisibleScoreInfo.low}`
          : dealerVisibleScoreInfo.best;
      } else {
        // No cards yet
        dealerScoreDisplay = '?';
      }
    }
    this.animateScoreChange('dealerScore', dealerScoreDisplay);
    this.setScoreSoftState('dealerScore', this.gameOver ? dealerScoreInfo.isSoft : dealerVisibleScoreInfo.isSoft);

    // Display cards
    // Dealer's first card is hidden until gameOver is true (dealer's turn starts)
    this.displayCards('playerCards', this.playerHand);
    this.displayCards('dealerCards', this.dealerHand, !this.gameOver);
  }
  
  animateScoreChange(elementId, newScore) {
    const scoreEl = this.getElement(elementId);
    if (!scoreEl) return;
    
    scoreEl.style.transform = 'scale(1.2)';
    scoreEl.style.transition = 'transform 0.2s ease';
    scoreEl.textContent = newScore;
    
    setTimeout(() => {
      scoreEl.style.transform = 'scale(1)';
    }, 200);
  }

  getCardPresentation(card) {
    const ranks = { ace: 'A', king: 'K', queen: 'Q', jack: 'J' };
    const suits = {
      hearts: { symbol: '♥', name: 'hearts', color: 'red' },
      diamonds: { symbol: '♦', name: 'diamonds', color: 'red' },
      clubs: { symbol: '♣', name: 'clubs', color: 'black' },
      spades: { symbol: '♠', name: 'spades', color: 'black' }
    };
    const rank = card ? (ranks[card.value] || String(card.value)) : '?';
    const suit = card ? (suits[card.suit] || suits.spades) : suits.spades;
    return { rank, suit, label: card ? `${rank} of ${suit.name}` : 'Hidden card' };
  }

  updateCardElement(cardEl, card, { hidden = false } = {}) {
    const { rank, suit, label } = this.getCardPresentation(card);
    cardEl.classList.toggle('is-red', suit.color === 'red');
    cardEl.classList.toggle('is-black', suit.color !== 'red');
    cardEl.dataset.cardLabel = label;
    cardEl.setAttribute('aria-label', hidden ? "Dealer's hidden card" : label);
    const front = cardEl.querySelector('.blackjack-card-front');
    if (front) {
      front.innerHTML = `<span class="blackjack-card-corner"><strong>${rank}</strong><i>${suit.symbol}</i></span><span class="blackjack-card-pip">${suit.symbol}</span><span class="blackjack-card-corner is-bottom"><strong>${rank}</strong><i>${suit.symbol}</i></span>`;
    }
  }

  createCardElement(card, { hidden = false, reveal = false, animate = false, index = 0, delayMs = 0, hand = 'player' } = {}) {
    const cardEl = document.createElement('div');
    cardEl.className = `card blackjack-card${hidden ? ' is-hidden' : ''}${reveal ? ' is-revealing' : ''}${animate ? ' is-dealing' : ''}`;
    cardEl.style.setProperty('--deal-index', String(index));
    cardEl.style.setProperty('--deal-delay', `${delayMs}ms`);
    cardEl.style.setProperty('--deal-direction', hand === 'dealer' ? '-1' : '1');
    cardEl.setAttribute('role', 'img');

    const inner = document.createElement('div');
    inner.className = 'blackjack-card-inner';
    const front = document.createElement('div');
    front.className = 'blackjack-card-face blackjack-card-front';
    const back = document.createElement('div');
    back.className = 'blackjack-card-face blackjack-card-back';
    back.innerHTML = '<span class="blackjack-card-back-grid"></span><span class="blackjack-card-monogram">777</span>';
    inner.append(front, back);
    cardEl.appendChild(inner);
    this.updateCardElement(cardEl, card, { hidden });
    if (animate) {
      cardEl.addEventListener('animationend', event => {
        if (event.target === cardEl) cardEl.classList.remove('is-dealing');
      }, { once: true });
    }
    return cardEl;
  }

  displayCards(containerId, hand, hideFirst = false, animatedCards = []) {
    const container = this.getElement(containerId);
    if (!container) return;
    const currentCount = container.querySelectorAll('.blackjack-card').length;
    const containerKey = `${containerId}_hideFirst`;
    const lastHidden = this.lastHideFirstStates?.[containerKey];
    const hiddenChanged = lastHidden !== undefined && hideFirst !== lastHidden;
    const handReset = hand.length < currentCount;
    const dealer = containerId === 'dealerCards';
    const animationByIndex = new Map(animatedCards.map(card => [card.index, card.delayMs]));

    if (handReset) {
      container.replaceChildren();
    }

    if (hiddenChanged) {
      const existingCard = container.querySelector('.blackjack-card');
      if (existingCard) {
        this.updateCardElement(existingCard, hand[0], { hidden: hideFirst });
        existingCard.classList.toggle('is-hidden', hideFirst);
        existingCard.classList.toggle('is-revealing', !hideFirst);
        existingCard.setAttribute('aria-label', hideFirst ? "Dealer's hidden card" : existingCard.dataset.cardLabel || 'Dealer card');
        if (!hideFirst) existingCard.addEventListener('animationend', () => existingCard.classList.remove('is-revealing'), { once: true });
      }
    }

    const appendStart = handReset ? 0 : currentCount;
    hand.slice(appendStart).forEach((card, relativeIndex) => {
      const index = appendStart + relativeIndex;
      const cardElement = this.createCardElement(card, {
        hidden: hideFirst && index === 0,
        animate: animationByIndex.has(index),
        delayMs: animationByIndex.get(index) || 0,
        index,
        hand: dealer ? 'dealer' : 'player'
      });
      container.appendChild(cardElement);
    });
    container.classList.toggle('is-crowded', hand.length >= 4);
    container.style.setProperty('--hand-size', String(hand.length));
    this.lastHideFirstStates[containerKey] = hideFirst;
  }

  resetGame(immediate = false) {
    if (this.roundId && !this.gameOver) {
      this.showError('Finish the active round before starting a new one.');
      return;
    }
    if (!immediate && !this.reducedMotion && this.roundId) {
      this.cancelPresentation();
      const generation = this.presentationGeneration;
      this.presentationInProgress = true;
      this.root?.querySelector('.blackjack-table-shell')?.classList.add('is-presenting', 'is-resetting');
      this.updateGameControls();
      this.schedulePresentation(generation, 320, () => this.resetGame(true));
      return;
    }
    this.roundId = null;
    this.gameOver = false;
    this.currentBet = 0;
    this.insuranceBet = 0;
    this.playerHand = [];
    this.playerHands = [];
    this.activeHandIndex = 0;
    this.serverCapabilities = { canHit: false, canStand: false, canDouble: false, canSplit: false };
    this.hasDoubledDown = false;
    this.hasTakenInsurance = false;
    this.insuranceOffered = false;
    this.lastHideFirstStates = {};
    this.initialHandSize = 2;
    this.cancelPresentation();
    this.lastServerState = null;
    this.pendingAction = null;
    this.pendingActionRequest = null;
    this.roundRevision = 0;
    this.root?.querySelector('.blackjack-table-shell')?.classList.remove('is-presenting', 'has-split-hands');
    this.root?.querySelector('.betting-section')?.classList.remove('is-locked');
    const betInput = this.getElement('blackjackBet');
    betInput?.removeAttribute('aria-readonly');
    if (betInput) betInput.readOnly = false;
    const playerHands = this.getElement('playerHands');
    if (playerHands) {
      playerHands.innerHTML = '<article class="blackjack-player-hand is-active" data-hand-index="0"><div class="blackjack-hand-heading"><h3>You</h3><span class="blackjack-hand-result" aria-hidden="true"></span><div class="score-display"><span class="score-label">HAND</span><span id="playerScore">0</span></div></div><div id="playerCards" class="cards-container"></div></article>';
    }
    this.getElement('dealerCards')?.replaceChildren();
    this.getElement('dealerScore').textContent = '0';
    const dealerResult = this.getElement('dealerResult');
    if (dealerResult) dealerResult.textContent = '';
    this.root?.querySelector('.dealer-section')?.classList.remove('is-winner', 'is-loser', 'is-bust', 'is-blackjack');
    this.getElement('insuranceSection').classList.add('hidden');
    this.root?.querySelector('.blackjack-container')?.classList.remove('insurance-active');
    const resultDisplay = this.getElement('resultDisplay');
    if (resultDisplay) {
      resultDisplay.textContent = '';
      resultDisplay.removeAttribute('aria-label');
      resultDisplay.className = 'result-display';
    }
    this.getElement('hitBtn').disabled = true;
    this.getElement('standBtn').disabled = true;
    this.getElement('doubleDownBtn').classList.add('hidden');
    this.getElement('splitBtn').classList.add('hidden');
    this.root?.querySelector('.dealer-section')?.classList.remove('is-winner', 'is-loser');
    this.updateGameControls();
  }

  destroy() {
    document.removeEventListener('keydown', this.boundKeyboardHandler);
    this.cancelPresentation();
  }
}

window.__blackjackPresentation = Object.freeze({ buildBlackjackTransitionPlan });
window.BlackjackGame = BlackjackGame;

