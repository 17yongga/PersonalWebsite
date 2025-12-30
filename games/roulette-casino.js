// Roulette Game Module - Shared Session with Auto-Spin

class RouletteGame {
  constructor(casinoManager) {
    this.casino = casinoManager;
    this.socket = null;
    this.currentBet = null;
    this.spinning = false;
    this.nextSpinTime = null;
    this.allBets = {};
    this.timerInterval = null;
    this.history = [];
    this.init();
  }

  init() {
    const gameView = document.getElementById('rouletteGame');
    gameView.innerHTML = `
      <div class="roulette-casino-container">
        <h2 class="game-title">🎲 Roulette</h2>
        
        <div class="roulette-game-area">
          <div class="roulette-wheel-section">
            <div class="digital-roulette-display">
              <div id="rouletteDisplay" class="roulette-display">
                <div class="number-display" id="numberDisplay">--</div>
                <div class="color-indicator" id="colorIndicator"></div>
              </div>
              <div id="winningNumber" class="winning-number"></div>
              <div id="nextSpinTimer" class="next-spin-timer"></div>
            </div>
          </div>

          <div class="betting-section-roulette">
            <div class="betting-controls">
              <h3>Place Your Bet</h3>
              <div class="bet-input-group">
                <label>Bet Amount:</label>
                <input type="number" id="rouletteBetAmount" min="1" value="100" step="10">
                <div class="quick-bets">
                  <button class="quick-bet-btn" data-amount="50">50</button>
                  <button class="quick-bet-btn" data-amount="100">100</button>
                  <button class="quick-bet-btn" data-amount="250">250</button>
                  <button class="quick-bet-btn" data-amount="500">500</button>
                </div>
              </div>

              <div class="color-bets-section">
                <h4>Choose Color</h4>
                <div class="color-buttons">
                  <button id="betRed" class="color-bet-btn red-btn">Red (2x)</button>
                  <button id="betBlack" class="color-bet-btn black-btn">Black (2x)</button>
                  <button id="betGreen" class="color-bet-btn green-btn">Green (14x)</button>
                </div>
              </div>

              <div class="current-bet-display">
                <p id="currentBetText">No bet placed</p>
                <button id="clearBetBtn" class="btn btn-secondary" disabled>Clear Bet</button>
              </div>
            </div>

            <div class="all-bets-section">
              <h3>All Players' Bets</h3>
              <div id="allBetsList" class="all-bets-list">
                <p class="no-bets">No bets placed yet</p>
              </div>
            </div>
          </div>
        </div>

        <!-- History Section -->
        <div class="roulette-history-section">
          <h3>Recent Results (Last 50)</h3>
          <div id="rouletteHistory" class="roulette-history">
            <p class="no-history">No history yet</p>
          </div>
        </div>
      </div>
    `;

    this.createWheel();
    this.attachEventListeners();
    
    // Connect to casino server after UI is rendered
    this.connectToServer();
  }

  connectToServer() {
    // Wait for socket.io to be available
    if (typeof io === 'undefined') {
      // Try again after a short delay
      setTimeout(() => this.connectToServer(), 100);
      return;
    }

    // Use shared socket from casino manager if available
    this.socket = this.casino.getSocket();
    
    if (!this.socket) {
      // Fallback: create own connection if casino manager doesn't have one
      try {
        const serverUrl = window.CASINO_SERVER_URL || window.location.origin;
        this.socket = io(serverUrl, {
          reconnection: true,
          reconnectionDelay: 1000,
          reconnectionAttempts: 5,
          timeout: 20000
        });
      } catch (error) {
        console.error('Error connecting to roulette server:', error);
        return;
      }
    }
    
    this.setupSocketListeners();
    
    // Join casino if already connected
    if (this.socket.connected && this.casino.username) {
      this.socket.emit('joinCasino', { username: this.casino.username });
    }
  }

  createWheel() {
    // Digital display doesn't need wheel creation
    // This method is kept for compatibility but does nothing
    // The display is already created in the HTML template
  }

  getNumberColor(num) {
    // Match server's roulette numbers: 0-14
    // 0 = green, then alternating red/black starting with 1=red
    if (num === 0) return 'green';
    // Odd numbers (1, 3, 5, 7, 9, 11, 13) = red
    // Even numbers (2, 4, 6, 8, 10, 12, 14) = black
    return num % 2 === 1 ? 'red' : 'black';
  }

  setupSocketListeners() {
    this.socket.on('connect', () => {
      if (this.casino.username) {
        this.socket.emit('joinCasino', { username: this.casino.username });
      }
    });

    this.socket.on('connect_error', (error) => {
      console.error('Roulette connection error:', error);
      // Show error message in the UI instead of alert
      const wheelSection = document.querySelector('.roulette-wheel-section');
      if (wheelSection) {
        const errorMsg = document.createElement('div');
        errorMsg.style.cssText = 'color: #ef4444; padding: 1rem; text-align: center; background: rgba(239, 68, 68, 0.1); border-radius: 8px; margin: 1rem 0;';
        errorMsg.textContent = 'Unable to connect to roulette server. Please make sure the server is running on port 3001.';
        wheelSection.appendChild(errorMsg);
      }
    });

    this.socket.on('playerData', (data) => {
      this.casino.credits = data.credits;
      this.casino.updateCreditsDisplay();
    });

    this.socket.on('rouletteState', (state) => {
      this.allBets = state.currentBets || {};
      this.nextSpinTime = state.nextSpinTime;
      this.history = state.history || [];
      this.updateAllBetsDisplay();
      this.updateNextSpinTimer();
      this.updateHistoryDisplay();
      
      if (state.lastResult) {
        this.showLastResult(state.lastResult);
      }
      
      if (state.spinning) {
        // Wheel is currently spinning
        this.spinning = true;
      }
    });

    this.socket.on('rouletteBetsUpdate', ({ bets }) => {
      this.allBets = bets;
      this.updateAllBetsDisplay();
    });

    this.socket.on('rouletteSpinStart', ({ winningNumber, winningColor, bets }) => {
      this.spinning = true;
      this.allBets = bets;
      this.updateAllBetsDisplay();
      // Clear any previous winning number display
      const winningEl = document.getElementById('winningNumber');
      if (winningEl) {
        winningEl.textContent = '';
        winningEl.className = 'winning-number';
      }
      // Hide timer during spin and result display
      const timerEl = document.getElementById('nextSpinTimer');
      if (timerEl) {
        timerEl.textContent = '';
        timerEl.style.display = 'none';
      }
      this.animateSpin(winningNumber);
    });

    this.socket.on('rouletteSpinResult', ({ winningNumber, winningColor, results, bets, history }) => {
      // Store the result but don't show it until wheel animation completes
      this.pendingResult = { winningNumber, winningColor, results, bets };
      
      // Update history if provided
      if (history) {
        this.history = history;
        this.updateHistoryDisplay();
      }
      
      // Wait for wheel animation to complete
      const checkAnimation = () => {
        if (this.wheelAnimationComplete) {
          this.spinning = false;
          this.allBets = {};
          this.updateAllBetsDisplay();
          this.showResult(winningNumber, winningColor, results);
          
          const playerId = this.socket.id;
          if (results[playerId]) {
            this.casino.credits = results[playerId].newCredits;
            this.casino.updateCreditsDisplay();
            this.currentBet = null;
            this.updateCurrentBetDisplay();
          }
          
          // Timer will be updated when nextSpinTime event is received
        } else {
          // Check again after a short delay
          setTimeout(checkAnimation, 100);
        }
      };
      
      checkAnimation();
    });

    this.socket.on('nextSpinTime', ({ time }) => {
      this.nextSpinTime = time;
      this.updateNextSpinTimer();
    });

    this.socket.on('error', (message) => {
      alert(message);
    });
  }

  attachEventListeners() {
    // Quick bet buttons
    document.querySelectorAll('.quick-bet-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const amount = parseInt(btn.dataset.amount);
        document.getElementById('rouletteBetAmount').value = amount;
      });
    });

    // Color bet buttons
    document.getElementById('betRed')?.addEventListener('click', () => {
      this.placeBet('red');
    });

    document.getElementById('betBlack')?.addEventListener('click', () => {
      this.placeBet('black');
    });

    document.getElementById('betGreen')?.addEventListener('click', () => {
      this.placeBet('green');
    });

    // Clear bet
    document.getElementById('clearBetBtn')?.addEventListener('click', () => {
      this.clearBet();
    });
  }

  placeBet(color) {
    if (this.spinning) {
      alert('Cannot place bets while wheel is spinning');
      return;
    }

    // Check if player already has a bet placed
    if (this.currentBet) {
      alert('You can only place one bet per round. Please clear your current bet first.');
      return;
    }

    const amount = parseInt(document.getElementById('rouletteBetAmount').value);
    if (!amount || amount < 1) {
      alert('Please enter a valid bet amount');
      return;
    }

    if (amount > this.casino.credits) {
      alert('Insufficient credits');
      return;
    }

    this.currentBet = { color, amount };
    this.socket.emit('placeRouletteBet', { color, amount });
    this.updateCurrentBetDisplay();
  }

  clearBet() {
    if (this.spinning) {
      alert('Cannot clear bets while wheel is spinning');
      return;
    }

    if (this.currentBet) {
      this.socket.emit('clearRouletteBet');
      this.currentBet = null;
      this.updateCurrentBetDisplay();
    }
  }

  updateCurrentBetDisplay() {
    const currentBetText = document.getElementById('currentBetText');
    const clearBetBtn = document.getElementById('clearBetBtn');
    
    if (this.currentBet) {
      currentBetText.textContent = `Your bet: ${this.currentBet.color.toUpperCase()} - ${this.currentBet.amount.toLocaleString()} credits`;
      clearBetBtn.disabled = false;
    } else {
      currentBetText.textContent = 'No bet placed';
      clearBetBtn.disabled = true;
    }
  }

  updateAllBetsDisplay() {
    const allBetsList = document.getElementById('allBetsList');
    const bets = Object.values(this.allBets);
    
    if (bets.length === 0) {
      allBetsList.innerHTML = '<p class="no-bets">No bets placed yet</p>';
      return;
    }

    let html = '<ul class="bets-list">';
    bets.forEach(bet => {
      html += `
        <li class="bet-item ${bet.color}">
          <span class="bet-player">${bet.playerName}</span>
          <span class="bet-color">${bet.color.toUpperCase()}</span>
          <span class="bet-amount">${bet.amount.toLocaleString()} credits</span>
        </li>
      `;
    });
    html += '</ul>';
    allBetsList.innerHTML = html;
  }

  animateSpin(winningNumber) {
    const winningColor = this.getNumberColor(winningNumber);
    this.animateNumberReveal(winningNumber, winningColor);
  }

  animateNumberReveal(winningNumber, winningColor) {
    const numberDisplay = document.getElementById('numberDisplay');
    const colorIndicator = document.getElementById('colorIndicator');
    const displayContainer = document.getElementById('rouletteDisplay');
    
    if (!numberDisplay || !colorIndicator || !displayContainer) {
      console.error('Roulette display elements not found');
      this.wheelAnimationComplete = true;
      return;
    }
    
    // Reset display - remove all color classes
    numberDisplay.textContent = '--';
    colorIndicator.className = 'color-indicator';
    displayContainer.classList.remove('spinning', 'red', 'black', 'green', 'reveal');
    
    // Start spinning animation
    displayContainer.classList.add('spinning');
    this.wheelAnimationComplete = false;
    
    let currentNumber = 0;
    let iteration = 0;
    const totalIterations = 60 + Math.floor(Math.random() * 40); // 60-100 iterations for smoother animation
    const baseSpeed = 40; // milliseconds between number changes (faster start)
    const maxSpeed = 800; // maximum delay at the end (increased for more suspense)
    let currentSpeed = baseSpeed;
    
    const spinInterval = setInterval(() => {
      iteration++;
      
      // Cycle through numbers rapidly - only show numbers 0-14
      currentNumber = Math.floor(Math.random() * 15);
      numberDisplay.textContent = currentNumber;
      
      // Update color indicator
      const currentColor = this.getNumberColor(currentNumber);
      colorIndicator.className = `color-indicator ${currentColor}`;
      
      // Gradually slow down with smooth easing curve
      // Start slowing down earlier (at 40% of iterations) for more dramatic slowdown
      const progress = iteration / totalIterations;
      if (progress > 0.4) {
        // Use quintic easing (more aggressive than cubic) for dramatic slowdown
        const slowdownProgress = (progress - 0.4) / 0.6; // 0 to 1 as we approach end
        const easeOut = 1 - Math.pow(1 - slowdownProgress, 5); // Quintic ease-out for more dramatic effect
        currentSpeed = baseSpeed + (maxSpeed - baseSpeed) * easeOut;
      }
      
      // Stop and reveal winning number
      if (iteration >= totalIterations) {
        clearInterval(spinInterval);
        
        // Final reveal with animation
        setTimeout(() => {
          numberDisplay.textContent = winningNumber;
          colorIndicator.className = `color-indicator ${winningColor}`;
          // Remove all color classes and spinning, then add the correct winning color
          displayContainer.classList.remove('spinning', 'red', 'black', 'green', 'reveal');
          displayContainer.classList.add(winningColor);
          
          // Add pulse effect
          displayContainer.classList.add('reveal');
          setTimeout(() => {
            displayContainer.classList.remove('reveal');
          }, 1000);
          
          // Mark animation as complete
          this.wheelAnimationComplete = true;
        }, currentSpeed);
      }
    }, currentSpeed);
  }

  showResult(winningNumber, winningColor, results) {
    const winningEl = document.getElementById('winningNumber');
    const playerId = this.socket.id;
    const playerResult = results[playerId];

    let message = `Winning Number: ${winningNumber} (${winningColor.toUpperCase()})`;
    
    if (playerResult) {
      if (playerResult.won) {
        message += ` - 🎉 You won ${playerResult.winnings.toLocaleString()} credits!`;
      } else {
        message += ` - 😔 You lost`;
      }
    }

    winningEl.textContent = message;
    winningEl.className = `winning-number ${winningColor}`;
    
    // Timer will be shown when nextSpinTime event is received (after result is displayed)
  }

  showLastResult(result) {
    const winningEl = document.getElementById('winningNumber');
    const displayContainer = document.getElementById('rouletteDisplay');
    const numberDisplay = document.getElementById('numberDisplay');
    const colorIndicator = document.getElementById('colorIndicator');
    
    if (winningEl) {
      winningEl.textContent = `Last Result: ${result.number} (${result.color.toUpperCase()})`;
      winningEl.className = `winning-number ${result.color}`;
    }
    
    // Update display to show last result with correct color
    if (displayContainer && numberDisplay && colorIndicator) {
      displayContainer.classList.remove('red', 'black', 'green', 'spinning', 'reveal');
      displayContainer.classList.add(result.color);
      numberDisplay.textContent = result.number;
      colorIndicator.className = `color-indicator ${result.color}`;
    }
  }

  updateNextSpinTimer() {
    // Clear any existing timer interval
    if (this.timerInterval) {
      clearInterval(this.timerInterval);
      this.timerInterval = null;
    }

    if (!this.nextSpinTime) return;

    const timerEl = document.getElementById('nextSpinTimer');
    if (timerEl) {
      // Show the timer (it was hidden during spin/result display)
      timerEl.style.display = 'inline-block';
    }

    const updateTimer = () => {
      const now = Date.now();
      const timeLeft = Math.max(0, Math.floor((this.nextSpinTime - now) / 1000));
      
      if (timerEl) {
        if (timeLeft > 0) {
          timerEl.textContent = `Next spin in: ${timeLeft}s`;
          timerEl.className = 'next-spin-timer';
        } else {
          timerEl.textContent = 'Spinning...';
          timerEl.className = 'next-spin-timer spinning';
        }
      }

      // Stop the interval if time is up
      if (timeLeft <= 0) {
        if (this.timerInterval) {
          clearInterval(this.timerInterval);
          this.timerInterval = null;
        }
      }
    };

    // Update immediately
    updateTimer();
    
    // Then update every second
    this.timerInterval = setInterval(updateTimer, 1000);
  }

  updateHistoryDisplay() {
    const historyEl = document.getElementById('rouletteHistory');
    if (!historyEl) return;

    if (!this.history || this.history.length === 0) {
      historyEl.innerHTML = '<p class="no-history">No history yet</p>';
      return;
    }

    let html = '<div class="history-grid">';
    this.history.forEach((result, index) => {
      const colorClass = result.color;
      html += `
        <div class="history-item ${colorClass}" title="Number: ${result.number}, Color: ${result.color}">
          <span class="history-number">${result.number}</span>
          <span class="history-color-indicator ${colorClass}"></span>
        </div>
      `;
    });
    html += '</div>';

    historyEl.innerHTML = html;
  }

  destroy() {
    // Clear timer interval
    if (this.timerInterval) {
      clearInterval(this.timerInterval);
      this.timerInterval = null;
    }
    
    if (this.socket) {
      this.socket.disconnect();
    }
  }
}

window.RouletteGame = RouletteGame;

