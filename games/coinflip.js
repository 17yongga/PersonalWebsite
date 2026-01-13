// Coinflip Game Module

class CoinflipGame {
  constructor(casinoManager) {
    this.casino = casinoManager;
    this.betAmount = 0;
    this.playerChoice = null;
    this.flipping = false;
    this.init();
  }

  init() {
    const gameView = document.getElementById('coinflipGame');
    gameView.innerHTML = `
      <div class="coinflip-container">
        <h2 class="game-title">🪙 Coinflip</h2>
        
        <div class="betting-section">
          <label>Place Your Bet:</label>
          <div class="bet-input-group">
            <input type="number" id="coinflipBet" min="1" max="${this.casino.credits}" value="100" step="10">
            <div class="quick-bets">
              <button class="quick-bet-btn" data-amount="50">50</button>
              <button class="quick-bet-btn" data-amount="100">100</button>
              <button class="quick-bet-btn" data-amount="250">250</button>
              <button class="quick-bet-btn" data-amount="500">500</button>
            </div>
          </div>
          
          <div class="choice-section">
            <p>Choose Heads or Tails:</p>
            <div class="choice-buttons">
              <button id="chooseHeads" class="choice-btn heads-btn">
                <span class="choice-icon">🪙</span>
                <span>Heads</span>
              </button>
              <button id="chooseTails" class="choice-btn tails-btn">
                <span class="choice-icon">🪙</span>
                <span>Tails</span>
              </button>
            </div>
          </div>

          <button id="flipCoinBtn" class="btn btn-primary" disabled>Flip Coin</button>
        </div>

        <div id="coinArea" class="coin-area hidden">
          <div class="coin-container">
            <div id="coin" class="coin">
              <div class="coin-face coin-front">
                <span class="coin-text">H</span>
              </div>
              <div class="coin-face coin-back">
                <span class="coin-text">T</span>
              </div>
            </div>
          </div>
          <div id="coinResult" class="coin-result"></div>
          <button id="playAgainBtn" class="btn btn-secondary">Play Again</button>
        </div>
      </div>
    `;

    this.attachEventListeners();
  }

  attachEventListeners() {
    // Betting
    document.querySelectorAll('.quick-bet-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const amount = parseInt(btn.dataset.amount);
        document.getElementById('coinflipBet').value = amount;
        this.updateFlipButton();
      });
    });

    document.getElementById('coinflipBet')?.addEventListener('input', () => {
      this.updateFlipButton();
    });

    // Choice buttons
    document.getElementById('chooseHeads')?.addEventListener('click', () => {
      this.selectChoice('Heads');
    });

    document.getElementById('chooseTails')?.addEventListener('click', () => {
      this.selectChoice('Tails');
    });

    // Flip button
    document.getElementById('flipCoinBtn')?.addEventListener('click', () => {
      this.flipCoin();
    });

    // Play again
    document.getElementById('playAgainBtn')?.addEventListener('click', () => {
      this.resetGame();
    });
  }

  selectChoice(choice) {
    this.playerChoice = choice;
    
    // Update UI
    document.querySelectorAll('.choice-btn').forEach(btn => {
      btn.classList.remove('selected');
    });

    if (choice === 'Heads') {
      document.getElementById('chooseHeads').classList.add('selected');
    } else {
      document.getElementById('chooseTails').classList.add('selected');
    }

    this.updateFlipButton();
  }

  updateFlipButton() {
    const betInput = document.getElementById('coinflipBet');
    const betAmount = parseInt(betInput.value) || 0;
    const flipBtn = document.getElementById('flipCoinBtn');

    if (betAmount > 0 && betAmount <= this.casino.credits && this.playerChoice) {
      flipBtn.disabled = false;
    } else {
      flipBtn.disabled = true;
    }
  }

  flipCoin() {
    if (this.flipping) return;

    const betInput = document.getElementById('coinflipBet');
    this.betAmount = parseInt(betInput.value);

    if (this.betAmount > this.casino.credits) {
      alert('Insufficient credits');
      return;
    }

    this.casino.updateCredits(-this.betAmount);
    this.flipping = true;

    // Show coin area
    document.querySelector('.betting-section').classList.add('hidden');
    document.getElementById('coinArea').classList.remove('hidden');

    // Animate coin flip
    const coin = document.getElementById('coin');
    const result = Math.random() < 0.5 ? 'Heads' : 'Tails';
    
    coin.classList.remove('flipping-heads', 'flipping-tails', 'show-heads', 'show-tails');
    
    if (result === 'Heads') {
      coin.classList.add('flipping-heads');
    } else {
      coin.classList.add('flipping-tails');
    }

    setTimeout(() => {
      coin.classList.remove('flipping-heads', 'flipping-tails');
      if (result === 'Heads') {
        coin.classList.add('show-heads');
      } else {
        coin.classList.add('show-tails');
      }

      // Show result
      this.showResult(result);
    }, 2000);
  }

  showResult(result) {
    const resultEl = document.getElementById('coinResult');
    const won = result === this.playerChoice;
    
    let message = '';
    let winnings = 0;

    if (won) {
      message = `🎉 You Win! ${result} was correct!`;
      winnings = this.betAmount * 2;
      resultEl.className = 'coin-result win';
      this.casino.updateCredits(winnings);
    } else {
      message = `😔 You Lose! Result was ${result}`;
      resultEl.className = 'coin-result lose';
    }

    resultEl.textContent = message;
    this.flipping = false;
  }

  resetGame() {
    this.betAmount = 0;
    this.playerChoice = null;
    this.flipping = false;

    document.querySelector('.betting-section').classList.remove('hidden');
    document.getElementById('coinArea').classList.add('hidden');
    
    document.querySelectorAll('.choice-btn').forEach(btn => {
      btn.classList.remove('selected');
    });

    const coin = document.getElementById('coin');
    coin.classList.remove('flipping-heads', 'flipping-tails', 'show-heads', 'show-tails');

    document.getElementById('coinResult').textContent = '';
    document.getElementById('flipCoinBtn').disabled = true;
  }

  destroy() {
    // Cleanup if needed
  }
}

window.CoinflipGame = CoinflipGame;



