// Blackjack Game Module

const BLACKJACK_DEAL_CADENCE_MS = 460;

function buildCardPresentation({ acceptedStart, initialHydration, previousPlayerCount, previousDealerCount, playerCount, dealerCount, dealerRevealed }) {
  if (initialHydration) return { player: [], dealer: [], revealDealer: false, completionMs: 0 };
  if (acceptedStart) {
    const player = Array.from({ length: playerCount }, (_, index) => ({ index, delayMs: index * BLACKJACK_DEAL_CADENCE_MS * 2 }));
    const dealer = Array.from({ length: dealerCount }, (_, index) => ({ index, delayMs: (index * 2 + 1) * BLACKJACK_DEAL_CADENCE_MS }));
    return {
      player,
      dealer,
      revealDealer: false,
      completionMs: Math.max(0, (playerCount + dealerCount - 1) * BLACKJACK_DEAL_CADENCE_MS + 760)
    };
  }

  const revealDelay = dealerRevealed ? 0 : -1;
  const player = Array.from({ length: Math.max(0, playerCount - previousPlayerCount) }, (_, offset) => ({
    index: previousPlayerCount + offset,
    delayMs: offset * BLACKJACK_DEAL_CADENCE_MS
  }));
  const dealerStart = revealDelay >= 0 ? BLACKJACK_DEAL_CADENCE_MS : 0;
  const dealer = Array.from({ length: Math.max(0, dealerCount - previousDealerCount) }, (_, offset) => ({
    index: previousDealerCount + offset,
    delayMs: dealerStart + offset * BLACKJACK_DEAL_CADENCE_MS
  }));
  const lastDelay = Math.max(revealDelay, ...player.map(card => card.delayMs), ...dealer.map(card => card.delayMs), 0);
  return { player, dealer, revealDealer: dealerRevealed, completionMs: lastDelay + (player.length || dealer.length || dealerRevealed ? 760 : 0) };
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
    this.presentationTimer = null;
    this.presentationGeneration = 0;
    this.presentationInProgress = false;
    this.stakeChips = [100];
    this.boundKeyboardHandler = event => this.handleKeyboard(event);
    this.init();
  }

  init() {
    const gameView = document.getElementById('blackjackGame');
    this.root = gameView;
    gameView.innerHTML = `
      <div class="blackjack-container">
        <div class="blackjack-ambient" aria-hidden="true"></div>
        <header class="blackjack-table-header">
          <div>
            <span class="blackjack-eyebrow">NEON 777 PRIVATE TABLE</span>
            <h2 class="game-title"><span class="game-title-mark" aria-hidden="true"></span><span>Blackjack</span></h2>
          </div>
          <div class="blackjack-rules" aria-label="Table rules">
            <span>BLACKJACK PAYS 3:2</span>
            <span>DEALER STANDS ON 17</span>
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
                <input type="number" id="blackjackBet" min="1" max="${this.casino.credits}" value="100" step="10" inputmode="numeric" aria-describedby="blackjackBetUnit">
                <span id="blackjackBetUnit">CREDITS</span>
              </div>
              <div class="blackjack-chip-rack">
                <span class="blackjack-chip-rack-label">Add chips</span>
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
              <div class="blackjack-hand-heading"><h3>Dealer</h3><div class="score-display"><span class="score-label">HAND</span><span id="dealerScore">0</span></div></div>
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
        this.addStakeChip(amount);
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

  addStakeChip(amount) {
    const current = Number(this.getElement('blackjackBet')?.value) || 0;
    if (current + amount > this.casino.credits) return this.showError('That chip would exceed your available credits.');
    this.stakeChips.push(amount);
    this.setStakeAmount(current + amount);
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
    const counts = this.stakeChips.reduce((map, value) => map.set(value, (map.get(value) || 0) + 1), new Map());
    this.root?.querySelectorAll('.quick-bet-btn').forEach(chip => {
      const amount = Number(chip.dataset.amount);
      const count = counts.get(amount) || 0;
      const selected = count > 0;
      chip.classList.toggle('is-selected', selected);
      chip.setAttribute('aria-pressed', String(selected));
      chip.dataset.count = count ? String(count) : '';
      chip.setAttribute('aria-label', `${amount} credit chip${count ? `, ${count} allocated` : ''}`);
    });
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
    this.setBusy(true);
    try {
      const response = await this.casino.apiFetch('/api/games/blackjack/action', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ roundId: this.roundId, action })
      });
      const data = await response.json();
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
      this.setBusy(false);
      this.updateGameControls();
    }
  }

  applyServerState(state, balance) {
    const previousRoundId = this.roundId;
    const sameRound = previousRoundId === state.roundId;
    const nextHands = Array.isArray(state.playerHands) && state.playerHands.length
      ? state.playerHands
      : [{ cards: state.playerHand || [], score: state.playerScore, bet: state.bet, active: !state.settled, result: state.result, payout: state.payout }];
    const previousActiveIndex = sameRound ? this.activeHandIndex : 0;
    const previousPlayerCount = sameRound ? (this.playerHands[previousActiveIndex]?.cards?.length || this.playerHand.length) : 0;
    const previousDealerCount = sameRound ? this.dealerHand.length : 0;
    const wasSettled = sameRound ? this.gameOver : false;
    const acceptedStart = Boolean(state.roundId && this.soundAcceptedRoundId === state.roundId);
    const initialHydration = !this.soundHydrated && !acceptedStart;
    const activeHandIndex = Number.isSafeInteger(state.activeHandIndex) ? state.activeHandIndex : 0;
    const activeCards = nextHands[activeHandIndex]?.cards || nextHands[0].cards;
    const presentation = buildCardPresentation({
      acceptedStart,
      initialHydration,
      previousPlayerCount,
      previousDealerCount,
      playerCount: activeCards.length,
      dealerCount: state.dealerHand.length,
      dealerRevealed: sameRound && !wasSettled && state.settled
    });
    this.soundHydrated = true;
    if (acceptedStart) this.soundAcceptedRoundId = null;
    this.roundId = state.roundId;
    this.currentBet = state.bet;
    this.insuranceBet = state.insuranceBet;
    this.playerHands = nextHands;
    this.activeHandIndex = activeHandIndex;
    this.playerHand = activeCards;
    this.dealerHand = state.dealerHand;
    this.gameOver = state.settled;
    this.hasDoubledDown = Boolean(nextHands[activeHandIndex]?.doubled);
    this.insuranceOffered = state.phase === 'insurance';
    this.serverCapabilities = {
      canHit: state.canHit !== false,
      canStand: state.canStand !== false,
      canDouble: Boolean(state.canDouble),
      canSplit: Boolean(state.canSplit)
    };

    this.root?.querySelector('.betting-section')?.classList.add('is-locked');
    const betInput = this.getElement('blackjackBet');
    betInput?.setAttribute('aria-readonly', 'true');
    if (betInput) betInput.readOnly = true;
    this.renderPlayerHands(nextHands, activeHandIndex, state.settled, presentation.player);
    this.displayCards('dealerCards', this.dealerHand, !state.settled, presentation.dealer);

    const sound = window.casinoSound;
    if (sound && state.roundId) {
      if (acceptedStart) sound.playOnce(`blackjack:${state.roundId}:wager`, 'wager', { game: 'blackjack' });
      const dealtCards = [
        ...presentation.player.map(card => ({ ...card, hand: `player-${activeHandIndex}` })),
        ...presentation.dealer.map(card => ({ ...card, hand: 'dealer' }))
      ].sort((a, b) => a.delayMs - b.delayMs);
      dealtCards.forEach(card => {
        sound.playOnce(`blackjack:${state.roundId}:deal:${card.hand}:${card.index}`, 'cardDeal', {
          delay: card.delayMs / 1000,
          cooldown: 0,
          game: 'blackjack',
          pan: card.hand === 'dealer' ? .18 : -.18
        });
      });
      if (presentation.revealDealer) {
        sound.playOnce(`blackjack:${state.roundId}:reveal`, 'cardFlip', { cooldown: 0, game: 'blackjack' });
      }
      if (state.settled && !wasSettled && !initialHydration) {
        const totalStake = state.bet + (state.insuranceBet || 0);
        const resultSound = state.payout > totalStake ? 'win' : state.payout === totalStake ? 'push' : 'lose';
        sound.playOnce(`blackjack:${state.roundId}:result`, resultSound, {
          delay: Math.max(.34, presentation.completionMs / 1000),
          cooldown: 0,
          game: 'blackjack'
        });
      }
    }

    const insurance = this.getElement('insuranceSection');
    insurance?.classList.toggle('hidden', state.phase !== 'insurance');
    this.root?.querySelector('.blackjack-container')?.classList.toggle('insurance-active', state.phase === 'insurance');
    this.root?.querySelector('.blackjack-table-shell')?.classList.toggle('has-split-hands', nextHands.length > 1);

    const result = this.getElement('resultDisplay');
    const revealPresentation = () => {
      if (result) {
        const totalStake = state.bet + (state.insuranceBet || 0);
        const net = state.payout - totalStake;
        const handResults = nextHands.map(hand => hand.result).filter(Boolean);
        const mixedHands = new Set(handResults).size > 1;
        const visualResult = mixedHands ? 'MIXED' : state.payout > totalStake ? 'WIN' : state.payout === totalStake ? 'PUSH' : 'LOSS';
        const amount = net > 0 ? `+${net}` : net < 0 ? String(net) : 'EVEN';
        result.textContent = state.settled ? `${visualResult} · ${amount} CREDITS` : '';
        result.setAttribute('aria-label', state.settled ? `Round complete. ${visualResult}. Payout ${state.payout} credits.` : '');
        result.className = `result-display ${state.settled ? (state.payout > totalStake ? 'win' : state.payout === totalStake ? 'tie' : 'lose') : ''}`;
      }
      this.renderPlayerHandResults(nextHands, state.settled);
      this.getElement('dealerScore').textContent = state.settled ? String(state.dealerScore) : String(state.dealerScore || '?');
      this.presentationInProgress = false;
      this.root?.querySelector('.blackjack-table-shell')?.classList.remove('is-presenting');
      this.updateGameControls();
    };
    clearTimeout(this.presentationTimer);
    const generation = ++this.presentationGeneration;
    this.presentationInProgress = presentation.completionMs > 0;
    this.root?.querySelector('.blackjack-table-shell')?.classList.toggle('is-presenting', this.presentationInProgress);
    if (this.presentationInProgress) {
      if (result) result.textContent = '';
      this.presentationTimer = setTimeout(() => {
        if (generation === this.presentationGeneration) revealPresentation();
      }, presentation.completionMs);
    } else {
      revealPresentation();
    }
    if (Number.isSafeInteger(balance)) this.casino.setCredits(balance);
    this.updateGameControls();
  }

  renderPlayerHands(hands, activeHandIndex, settled, animatedCards = []) {
    const host = this.getElement('playerHands');
    if (!host) return;
    if (host.children.length !== hands.length) {
      host.replaceChildren();
      hands.forEach((hand, index) => {
        const article = document.createElement('article');
        article.className = 'blackjack-player-hand';
        article.dataset.handIndex = String(index);
        const heading = document.createElement('div');
        heading.className = 'blackjack-hand-heading';
        const title = document.createElement('h3');
        title.textContent = hands.length > 1 ? `Hand ${index + 1}` : 'You';
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
        host.appendChild(article);
      });
    }

    hands.forEach((hand, index) => {
      const article = host.querySelector(`[data-hand-index="${index}"]`);
      article?.classList.toggle('is-active', !settled && index === activeHandIndex);
      const score = this.getElement(index ? `playerScore${index}` : 'playerScore');
      if (score) score.textContent = String(hand.score ?? this.calculateScore(hand.cards || []));
      this.displayCards(index ? `playerCards${index}` : 'playerCards', hand.cards || [], false,
        index === activeHandIndex ? animatedCards : []);
      const cards = this.getElement(index ? `playerCards${index}` : 'playerCards');
      cards?.classList.toggle('is-crowded', (hand.cards?.length || 0) >= 4);
      cards?.style.setProperty('--hand-size', String(hand.cards?.length || 0));
    });
    this.renderPlayerHandResults(hands, settled);
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

  calculateScore(hand) {
    let score = 0;
    let aces = 0;

    hand.forEach(card => {
      if (card.value === 'ace') {
        aces++;
        score += 11;
      } else if (['king', 'queen', 'jack'].includes(card.value)) {
        score += 10;
      } else {
        score += parseInt(card.value);
      }
    });

    while (score > 21 && aces > 0) {
      score -= 10;
      aces--;
    }

    return score;
  }

  calculateScoreWithAces(hand, isInitialHand = false) {
    // Returns both scores when aces are present: { high: number, low: number, hasAce: boolean, showBoth: boolean }
    let score = 0;
    let aces = 0;

    hand.forEach(card => {
      if (card.value === 'ace') {
        aces++;
        score += 11;
      } else if (['king', 'queen', 'jack'].includes(card.value)) {
        score += 10;
      } else {
        score += parseInt(card.value);
      }
    });

    const highScore = score;
    let lowScore = score;
    
    // Calculate low score (all aces as 1)
    let tempScore = 0;
    hand.forEach(card => {
      if (card.value === 'ace') {
        tempScore += 1;
      } else if (['king', 'queen', 'jack'].includes(card.value)) {
        tempScore += 10;
      } else {
        tempScore += parseInt(card.value);
      }
    });
    lowScore = tempScore;

    const hasAce = aces > 0 && highScore !== lowScore;
    const best = highScore > 21 ? lowScore : highScore;
    
    // Show "xx/xx" format only when:
    // 1. It's the initial hand (exactly 2 cards) - only for starting hands
    // 2. Has ace (high and low scores differ)
    // 3. Both high and low values are <= 21 (right number in xx/xx doesn't exceed 21)
    // After drawing more cards (3+), just show the best single score
    const showBoth = isInitialHand && hasAce && highScore <= 21 && lowScore <= 21;

    return {
      high: highScore > 21 ? lowScore : highScore,
      low: lowScore,
      hasAce: hasAce,
      best: best,
      showBoth: showBoth
    };
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
    newGame?.classList.toggle('hidden', !this.gameOver);
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

  resetGame() {
    if (this.roundId && !this.gameOver) {
      this.showError('Finish the active round before starting a new one.');
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
    clearTimeout(this.presentationTimer);
    this.presentationGeneration += 1;
    this.presentationInProgress = false;
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
    clearTimeout(this.presentationTimer);
    this.presentationGeneration += 1;
  }
}

window.BlackjackGame = BlackjackGame;

