// Roulette Game Module

class RouletteGame {
  constructor(casinoManager) {
    this.casino = casinoManager;
    this.betAmount = 0;
    this.selectedBets = [];
    this.spinning = false;
    this.init();
  }

  init() {
    const gameView = document.getElementById('rouletteGame');
    gameView.innerHTML = `
      <div class="roulette-container">
        <h2 class="game-title">🎲 Roulette</h2>
        
        <div class="betting-section">
          <label>Place Your Bet:</label>
          <div class="bet-input-group">
            <input type="number" id="rouletteBet" min="1" max="${this.casino.credits}" value="100" step="10">
            <div class="quick-bets">
              <button class="quick-bet-btn" data-amount="50">50</button>
              <button class="quick-bet-btn" data-amount="100">100</button>
              <button class="quick-bet-btn" data-amount="250">250</button>
              <button class="quick-bet-btn" data-amount="500">500</button>
            </div>
          </div>
        </div>

        <div class="roulette-game-area">
          <div class="roulette-display-container">
            <div class="digital-roulette-display">
              <div class="display-header">
                <span class="display-label">🎰 ROULETTE</span>
              </div>
              <div id="rouletteDisplay" class="roulette-display">
                <div class="number-display" id="numberDisplay">--</div>
                <div class="color-indicator" id="colorIndicator"></div>
              </div>
              <div id="winningNumber" class="winning-number"></div>
            </div>
          </div>

          <div class="betting-board">
            <div class="betting-options">
              <h3>Betting Options:</h3>
              
              <div class="bet-group">
                <h4>Color Bets (2x payout)</h4>
                <div class="color-bets">
                  <button class="bet-option red-bet" data-bet="red">Red</button>
                  <button class="bet-option black-bet" data-bet="black">Black</button>
                  <button class="bet-option green-bet" data-bet="green">Green (0)</button>
                </div>
              </div>

              <div class="bet-group">
                <h4>Number Range (2x payout)</h4>
                <div class="range-bets">
                  <button class="bet-option" data-bet="1-18">1-18</button>
                  <button class="bet-option" data-bet="19-36">19-36</button>
                  <button class="bet-option" data-bet="even">Even</button>
                  <button class="bet-option" data-bet="odd">Odd</button>
                </div>
              </div>

              <div class="bet-group">
                <h4>Single Number (36x payout)</h4>
                <div class="number-grid" id="numberGrid"></div>
              </div>
            </div>

            <div class="bet-summary">
              <h3>Your Bets:</h3>
              <div id="betSummary"></div>
              <button id="spinBtn" class="btn btn-primary" disabled>Spin</button>
              <button id="clearBetsBtn" class="btn btn-secondary">Clear Bets</button>
            </div>
          </div>
        </div>
      </div>
    `;

    this.createNumberGrid();
    this.attachEventListeners();
  }

  createNumberGrid() {
    const grid = document.getElementById('numberGrid');
    const numbers = [];
    
    // Add 0 (green)
    numbers.push({ num: 0, color: 'green' });
    
    // Add 1-36 (alternating red/black)
    for (let i = 1; i <= 36; i++) {
      const color = this.getNumberColor(i);
      numbers.push({ num: i, color });
    }

    numbers.forEach(({ num, color }) => {
      const btn = document.createElement('button');
      btn.className = `number-btn ${color}`;
      btn.textContent = num;
      btn.dataset.number = num;
      btn.dataset.color = color;
      btn.addEventListener('click', () => this.addNumberBet(num, color));
      grid.appendChild(btn);
    });
  }

  getNumberColor(num) {
    // Match server's roulette numbers: 0-14
    // 0 = green, then alternating red/black starting with 1=red
    if (num === 0) return 'green';
    // Odd numbers (1, 3, 5, 7, 9, 11, 13) = red
    // Even numbers (2, 4, 6, 8, 10, 12, 14) = black
    return num % 2 === 1 ? 'red' : 'black';
  }

  attachEventListeners() {
    // Quick bet buttons
    document.querySelectorAll('.quick-bet-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const amount = parseInt(btn.dataset.amount);
        document.getElementById('rouletteBet').value = amount;
      });
    });

    // Color bets
    document.querySelectorAll('.color-bets .bet-option').forEach(btn => {
      btn.addEventListener('click', () => {
        const betType = btn.dataset.bet;
        this.addBet(betType);
      });
    });

    // Range bets
    document.querySelectorAll('.range-bets .bet-option').forEach(btn => {
      btn.addEventListener('click', () => {
        const betType = btn.dataset.bet;
        this.addBet(betType);
      });
    });

    // Spin and clear
    document.getElementById('spinBtn')?.addEventListener('click', () => {
      this.spin();
    });

    document.getElementById('clearBetsBtn')?.addEventListener('click', () => {
      this.clearBets();
    });
  }

  addBet(betType) {
    const betInput = document.getElementById('rouletteBet');
    const amount = parseInt(betInput.value) || 0;

    if (amount < 1) {
      alert('Please enter a bet amount');
      return;
    }

    if (amount > this.casino.credits) {
      alert('Insufficient credits');
      return;
    }

    // Check if bet already exists
    const existingBet = this.selectedBets.find(b => b.type === betType);
    if (existingBet) {
      existingBet.amount += amount;
    } else {
      this.selectedBets.push({ type: betType, amount });
    }

    this.casino.updateCredits(-amount);
    this.updateBetSummary();
    this.updateSpinButton();
  }

  addNumberBet(number, color) {
    const betInput = document.getElementById('rouletteBet');
    const amount = parseInt(betInput.value) || 0;

    if (amount < 1) {
      alert('Please enter a bet amount');
      return;
    }

    if (amount > this.casino.credits) {
      alert('Insufficient credits');
      return;
    }

    const betType = `number-${number}`;
    const existingBet = this.selectedBets.find(b => b.type === betType);
    if (existingBet) {
      existingBet.amount += amount;
    } else {
      this.selectedBets.push({ type: betType, number, color, amount });
    }

    this.casino.updateCredits(-amount);
    this.updateBetSummary();
    this.updateSpinButton();
  }

  updateBetSummary() {
    const summary = document.getElementById('betSummary');
    if (this.selectedBets.length === 0) {
      summary.innerHTML = '<p>No bets placed</p>';
      return;
    }

    let html = '<ul class="bet-list">';
    let totalBet = 0;
    this.selectedBets.forEach(bet => {
      totalBet += bet.amount;
      const displayName = bet.type.startsWith('number-') 
        ? `Number ${bet.number}` 
        : bet.type.charAt(0).toUpperCase() + bet.type.slice(1);
      html += `<li>${displayName}: ${bet.amount.toLocaleString()} credits</li>`;
    });
    html += `<li class="total"><strong>Total: ${totalBet.toLocaleString()} credits</strong></li>`;
    html += '</ul>';

    summary.innerHTML = html;
  }

  updateSpinButton() {
    const spinBtn = document.getElementById('spinBtn');
    spinBtn.disabled = this.selectedBets.length === 0 || this.spinning;
  }

  clearBets() {
    if (this.spinning) return;
    
    // Return credits
    let totalReturn = 0;
    this.selectedBets.forEach(bet => {
      totalReturn += bet.amount;
    });
    
    if (totalReturn > 0) {
      this.casino.updateCredits(totalReturn);
    }

    this.selectedBets = [];
    this.updateBetSummary();
    this.updateSpinButton();
  }

  spin() {
    if (this.spinning || this.selectedBets.length === 0) return;

    this.spinning = true;
    document.getElementById('spinBtn').disabled = true;

    // Generate winning number (0-36)
    const winningNumber = Math.floor(Math.random() * 37);
    const winningColor = this.getNumberColor(winningNumber);

    // Animate digital number reveal
    this.animateNumberReveal(winningNumber, winningColor);
  }

  animateNumberReveal(winningNumber, winningColor) {
    const numberDisplay = document.getElementById('numberDisplay');
    const colorIndicator = document.getElementById('colorIndicator');
    const displayContainer = document.getElementById('rouletteDisplay');
    
    // Reset display
    numberDisplay.textContent = '--';
    colorIndicator.className = 'color-indicator';
    displayContainer.classList.remove('spinning', winningColor);
    
    // Start spinning animation
    displayContainer.classList.add('spinning');
    
    let currentNumber = 0;
    let iteration = 0;
    const totalIterations = 50 + Math.floor(Math.random() * 30); // 50-80 iterations
    const baseSpeed = 50; // milliseconds between number changes
    let currentSpeed = baseSpeed;
    
    const spinInterval = setInterval(() => {
      iteration++;
      
      // Cycle through numbers rapidly
      currentNumber = Math.floor(Math.random() * 37);
      numberDisplay.textContent = currentNumber;
      
      // Update color indicator
      const currentColor = this.getNumberColor(currentNumber);
      colorIndicator.className = `color-indicator ${currentColor}`;
      
      // Gradually slow down as we approach the end
      if (iteration > totalIterations * 0.7) {
        currentSpeed = baseSpeed + (iteration - totalIterations * 0.7) * 10;
      }
      
      // Stop and reveal winning number
      if (iteration >= totalIterations) {
        clearInterval(spinInterval);
        
        // Final reveal with animation
        setTimeout(() => {
          numberDisplay.textContent = winningNumber;
          colorIndicator.className = `color-indicator ${winningColor}`;
          displayContainer.classList.remove('spinning');
          displayContainer.classList.add(winningColor);
          
          // Add pulse effect
          displayContainer.classList.add('reveal');
          setTimeout(() => {
            displayContainer.classList.remove('reveal');
          }, 1000);
          
          // Calculate winnings after reveal
          setTimeout(() => {
            this.calculateWinnings(winningNumber, winningColor);
            this.spinning = false;
            this.updateSpinButton();
          }, 500);
        }, currentSpeed);
      }
    }, currentSpeed);
  }

  calculateWinnings(winningNumber, winningColor) {
    const winningEl = document.getElementById('winningNumber');
    winningEl.textContent = `Winning Number: ${winningNumber} (${winningColor})`;
    winningEl.className = `winning-number ${winningColor}`;

    let totalWinnings = 0;

    this.selectedBets.forEach(bet => {
      let won = false;
      let multiplier = 1;

      if (bet.type === 'red' && winningColor === 'red') {
        won = true;
        multiplier = 2;
      } else if (bet.type === 'black' && winningColor === 'black') {
        won = true;
        multiplier = 2;
      } else if (bet.type === 'green' && winningNumber === 0) {
        won = true;
        multiplier = 2;
      } else if (bet.type === '1-18' && winningNumber >= 1 && winningNumber <= 18) {
        won = true;
        multiplier = 2;
      } else if (bet.type === '19-36' && winningNumber >= 19 && winningNumber <= 36) {
        won = true;
        multiplier = 2;
      } else if (bet.type === 'even' && winningNumber > 0 && winningNumber % 2 === 0) {
        won = true;
        multiplier = 2;
      } else if (bet.type === 'odd' && winningNumber > 0 && winningNumber % 2 === 1) {
        won = true;
        multiplier = 2;
      } else if (bet.type.startsWith('number-')) {
        const betNumber = parseInt(bet.type.split('-')[1]);
        if (betNumber === winningNumber) {
          won = true;
          multiplier = 36;
        }
      }

      if (won) {
        const winnings = bet.amount * multiplier;
        totalWinnings += winnings;
      }
    });

    if (totalWinnings > 0) {
      this.casino.updateCredits(totalWinnings);
      winningEl.textContent += ` - 🎉 You won ${totalWinnings.toLocaleString()} credits!`;
    } else {
      winningEl.textContent += ' - 😔 No wins this round';
    }

    // Clear bets after showing result
    setTimeout(() => {
      this.selectedBets = [];
      this.updateBetSummary();
      this.updateSpinButton();
      winningEl.textContent = '';
      winningEl.className = 'winning-number';
      
      // Reset display
      const displayContainer = document.getElementById('rouletteDisplay');
      const numberDisplay = document.getElementById('numberDisplay');
      const colorIndicator = document.getElementById('colorIndicator');
      displayContainer.classList.remove('red', 'black', 'green', 'reveal');
      numberDisplay.textContent = '--';
      colorIndicator.className = 'color-indicator';
    }, 3000);
  }

  destroy() {
    // Cleanup if needed
  }
}

window.RouletteGame = RouletteGame;

