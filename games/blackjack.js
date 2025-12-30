// Blackjack Game Module

class BlackjackGame {
  constructor(casinoManager) {
    this.casino = casinoManager;
    this.deck = [];
    this.playerHand = [];
    this.dealerHand = [];
    this.gameOver = false;
    this.betAmount = 0;
    this.currentBet = 0;
    this.lastHideFirstStates = {};
    this.initialHandSize = 2; // Track initial hand size (2 cards)
    this.init();
  }

  init() {
    const gameView = document.getElementById('blackjackGame');
    gameView.innerHTML = `
      <div class="blackjack-container">
        <h2 class="game-title">🃏 Blackjack</h2>
        
        <div class="betting-section">
          <label>Place Your Bet:</label>
          <div class="bet-input-group">
            <input type="number" id="blackjackBet" min="1" max="${this.casino.credits}" value="100" step="10">
            <div class="quick-bets">
              <button class="quick-bet-btn" data-amount="50">50</button>
              <button class="quick-bet-btn" data-amount="100">100</button>
              <button class="quick-bet-btn" data-amount="250">250</button>
              <button class="quick-bet-btn" data-amount="500">500</button>
            </div>
          </div>
          <button id="placeBetBtn" class="btn btn-primary">Place Bet</button>
        </div>

        <div id="gameArea" class="game-area hidden">
          <div class="dealer-section">
            <h3>Dealer</h3>
            <div class="score-display">Score: <span id="dealerScore">0</span></div>
            <div id="dealerCards" class="cards-container"></div>
          </div>

          <div class="result-display" id="resultDisplay"></div>

          <div class="player-section">
            <h3>You</h3>
            <div class="score-display">Score: <span id="playerScore">0</span></div>
            <div id="playerCards" class="cards-container"></div>
          </div>

          <div class="game-controls">
            <button id="hitBtn" class="btn btn-primary">Hit</button>
            <button id="standBtn" class="btn btn-secondary">Stand</button>
            <button id="newGameBtn" class="btn btn-secondary">New Game</button>
          </div>
        </div>
      </div>
    `;

    this.attachEventListeners();
  }

  attachEventListeners() {
    // Betting
    document.getElementById('placeBetBtn')?.addEventListener('click', () => this.placeBet());
    document.querySelectorAll('.quick-bet-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const amount = parseInt(btn.dataset.amount);
        document.getElementById('blackjackBet').value = amount;
      });
    });

    // Game controls
    document.getElementById('hitBtn')?.addEventListener('click', () => this.hit());
    document.getElementById('standBtn')?.addEventListener('click', () => this.stand());
    document.getElementById('newGameBtn')?.addEventListener('click', () => this.resetGame());
  }

  placeBet() {
    const betInput = document.getElementById('blackjackBet');
    const amount = parseInt(betInput.value);

    if (!amount || amount < 1) {
      alert('Please enter a valid bet amount');
      return;
    }

    if (amount > this.casino.credits) {
      alert('Insufficient credits');
      return;
    }

    this.currentBet = amount;
    this.casino.updateCredits(-amount);
    this.startGame();
  }

  async startGame() {
    document.querySelector('.betting-section').classList.add('hidden');
    document.getElementById('gameArea').classList.remove('hidden');

    this.createDeck();
    this.shuffleDeck();
    this.playerHand = [];
    this.dealerHand = [];
    this.gameOver = false;

    // Clear card containers
    document.getElementById('playerCards').innerHTML = '';
    document.getElementById('dealerCards').innerHTML = '';
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

    // Check for blackjack
    const playerScoreInfo = this.calculateScoreWithAces(this.playerHand, true);
    if (playerScoreInfo.best === 21) {
      // Player gets blackjack - reveal dealer's first card before ending game
      this.gameOver = true;
      this.updateDisplay(); // Reveal dealer's card
      await this.delay(500); // Brief delay to show revealed card
      this.endGame('blackjack');
    }
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

  async hit() {
    if (this.gameOver) return;

    this.dealCard(this.playerHand);
    await this.delay(400); // Wait for card animation
    this.updateDisplay();

    // After hitting, hand is no longer initial (more than 2 cards)
    const playerScoreInfo = this.calculateScoreWithAces(this.playerHand, false);
    if (playerScoreInfo.best > 21) {
      // Player busts - reveal dealer's first card before ending game
      this.gameOver = true;
      this.updateDisplay(); // Reveal dealer's card
      await this.delay(500); // Brief delay to show revealed card
      this.endGame('bust');
    } else if (playerScoreInfo.best === 21) {
      // Player gets 21 - reveal dealer's first card before ending game
      this.gameOver = true;
      this.updateDisplay(); // Reveal dealer's card
      await this.delay(500); // Brief delay to show revealed card
      this.endGame('blackjack');
    }
  }

  async stand() {
    if (this.gameOver) return;

    // Player stands - now it's dealer's turn
    // Reveal dealer's first card by setting gameOver to true
    this.gameOver = true;
    this.updateDisplay(); // This will reveal the dealer's first card
    await this.delay(500);

    // Dealer plays (draws cards until 17+)
    while (this.calculateScoreWithAces(this.dealerHand, false).best < 17) {
      this.dealCard(this.dealerHand);
      await this.delay(400); // Wait for card animation
      this.updateDisplay();
    }

    this.updateDisplay();
    this.endGame('compare');
  }

  endGame(reason) {
    // gameOver is already set to true in stand(), but set it here for other cases (bust, blackjack)
    this.gameOver = true;
    // At end game, hands may have more than 2 cards, so don't use initial hand format
    const playerScoreInfo = this.calculateScoreWithAces(this.playerHand, false);
    const dealerScoreInfo = this.calculateScoreWithAces(this.dealerHand, false);
    const playerScore = playerScoreInfo.best;
    const dealerScore = dealerScoreInfo.best;
    const resultDisplay = document.getElementById('resultDisplay');

    let message = '';
    let winnings = 0;

    if (reason === 'blackjack' && playerScore === 21) {
      message = '🎉 Blackjack! You Win!';
      winnings = Math.floor(this.currentBet * 2.5); // 2.5x for blackjack
    } else if (reason === 'bust') {
      message = '💥 Bust! Dealer Wins';
      winnings = 0;
    } else if (dealerScore > 21) {
      message = '🎉 Dealer Busts! You Win!';
      winnings = this.currentBet * 2;
    } else if (playerScore > dealerScore) {
      message = '🎉 You Win!';
      winnings = this.currentBet * 2;
    } else if (playerScore < dealerScore) {
      message = '😔 Dealer Wins';
      winnings = 0;
    } else {
      message = '🤝 Push! It\'s a Tie';
      winnings = this.currentBet; // Return bet
    }

    resultDisplay.textContent = message;
    resultDisplay.className = 'result-display ' + (winnings > this.currentBet ? 'win' : winnings === 0 ? 'lose' : 'tie');

    if (winnings > 0) {
      this.casino.updateCredits(winnings);
    }

    // Disable controls
    document.getElementById('hitBtn').disabled = true;
    document.getElementById('standBtn').disabled = true;
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
      if (this.dealerHand.length > 1) {
        dealerScoreDisplay = dealerVisibleScoreInfo.showBoth
          ? `${dealerVisibleScoreInfo.high}/${dealerVisibleScoreInfo.low}`
          : dealerVisibleScoreInfo.best;
      } else {
        dealerScoreDisplay = dealerScoreInfo.showBoth
          ? `${dealerScoreInfo.high}/${dealerScoreInfo.low}`
          : dealerScoreInfo.best;
      }
    }
    this.animateScoreChange('dealerScore', dealerScoreDisplay);

    // Display cards
    // Dealer's first card is hidden until gameOver is true (dealer's turn starts)
    this.displayCards('playerCards', this.playerHand);
    this.displayCards('dealerCards', this.dealerHand, !this.gameOver);
  }
  
  animateScoreChange(elementId, newScore) {
    const scoreEl = document.getElementById(elementId);
    if (!scoreEl) return;
    
    scoreEl.style.transform = 'scale(1.2)';
    scoreEl.style.transition = 'transform 0.2s ease';
    scoreEl.textContent = newScore;
    
    setTimeout(() => {
      scoreEl.style.transform = 'scale(1)';
    }, 200);
  }

  displayCards(containerId, hand, hideFirst = false) {
    const container = document.getElementById(containerId);
    if (!container) return;
    
    const currentCards = container.querySelectorAll('.card');
    const currentCount = currentCards.length;
    const containerKey = containerId + '_hideFirst';
    
    // Store the last hideFirst state for this container
    if (!this.lastHideFirstStates) {
      this.lastHideFirstStates = {};
    }
    
    const lastHideFirstForContainer = this.lastHideFirstStates[containerKey];
    
    // Check if we need to re-render all cards:
    // 1. hideFirst state changed (card reveal)
    // 2. hand was reset (fewer cards)
    // 3. initial state (no previous state recorded)
    // 4. Adding cards when hideFirst is true (need to ensure first card stays hidden)
    const hideFirstChanged = lastHideFirstForContainer !== undefined && hideFirst !== lastHideFirstForContainer;
    const handReset = hand.length < currentCount;
    const isInitialState = lastHideFirstForContainer === undefined;
    // Force re-render when adding cards to dealer's hand while first card should be hidden
    const addingCardsWithHiddenFirst = hand.length > currentCount && hideFirst && containerId === 'dealerCards';
    
    // Re-render all cards if hideFirst changed, hand reset, initial render, or adding cards when first should be hidden
    if (hideFirstChanged || handReset || isInitialState || addingCardsWithHiddenFirst) {
      // Re-render all cards to ensure correct state
      container.innerHTML = '';
      hand.forEach((card, index) => {
        const cardEl = document.createElement('div');
        cardEl.className = 'card';
        
        // Hide first card if hideFirst is true (dealer's first card before player stands)
        if (hideFirst && index === 0) {
          cardEl.className += ' card-back';
          cardEl.textContent = '🂠';
        } else {
          const cardName = `${card.value}_of_${card.suit}`;
          cardEl.style.backgroundImage = `url('blackjack/images/${cardName}.png')`;
          cardEl.style.backgroundSize = 'cover';
          cardEl.style.backgroundPosition = 'center';
        }
        
        // Animate only if card is being revealed (was hidden, now visible)
        const isReveal = hideFirstChanged && index === 0 && lastHideFirstForContainer === true && !hideFirst;
        const shouldAnimate = isReveal || handReset || isInitialState || (addingCardsWithHiddenFirst && index > 0);
        
        if (shouldAnimate && !(hideFirst && index === 0)) {
          // Don't animate the hidden card, just show it immediately
          cardEl.style.opacity = '0';
          cardEl.style.transform = 'translateY(-50px) scale(0.8)';
          cardEl.style.transition = 'opacity 0.4s ease, transform 0.4s ease';
        }
        
        container.appendChild(cardEl);
        
        // Trigger animation for visible cards only
        if (shouldAnimate && !(hideFirst && index === 0)) {
          setTimeout(() => {
            cardEl.style.opacity = '1';
            cardEl.style.transform = 'translateY(0) scale(1)';
          }, index * 150);
        }
      });
      this.lastHideFirstStates[containerKey] = hideFirst;
    } else if (hand.length > currentCount) {
      // Adding new card(s) - only animate the new ones, keep existing cards static
      hand.slice(currentCount).forEach((card, relativeIndex) => {
        const cardEl = document.createElement('div');
        cardEl.className = 'card';
        
        // New cards are never hidden (hideFirst only applies to index 0)
        const cardName = `${card.value}_of_${card.suit}`;
        cardEl.style.backgroundImage = `url('blackjack/images/${cardName}.png')`;
        cardEl.style.backgroundSize = 'cover';
        cardEl.style.backgroundPosition = 'center';
        
        // Animate only the new card
        cardEl.style.opacity = '0';
        cardEl.style.transform = 'translateY(-50px) scale(0.8) rotate(10deg)';
        cardEl.style.transition = 'opacity 0.4s ease, transform 0.4s ease';
        
        container.appendChild(cardEl);
        
        // Trigger animation for the new card only
        setTimeout(() => {
          cardEl.style.opacity = '1';
          cardEl.style.transform = 'translateY(0) scale(1) rotate(0deg)';
        }, relativeIndex * 150);
      });
      // Don't update hideFirst state when just adding cards
    }
    // If hand.length === currentCount and hideFirst hasn't changed, do nothing (cards already displayed correctly)
  }

  resetGame() {
    this.gameOver = false;
    this.currentBet = 0;
    this.lastHideFirstStates = {};
    this.initialHandSize = 2; // Reset initial hand size
    document.querySelector('.betting-section').classList.remove('hidden');
    document.getElementById('gameArea').classList.add('hidden');
    document.getElementById('resultDisplay').textContent = '';
    document.getElementById('hitBtn').disabled = false;
    document.getElementById('standBtn').disabled = false;
  }

  destroy() {
    // Cleanup if needed
  }
}

window.BlackjackGame = BlackjackGame;

