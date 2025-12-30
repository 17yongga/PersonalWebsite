// Coinflip Game Module - Adapted from coinflip folder for casino integration

class CoinflipGame {
  constructor(casinoManager) {
    this.casino = casinoManager;
    this.socket = null;
    this.currentRoomId = null;
    this.isCreator = false;
    this.gameFinished = false;
    this.createChoice = null;
    this.init();
  }

  init() {
    const gameView = document.getElementById('coinflipGame');
    gameView.innerHTML = `
      <div class="coinflip-casino-container">
        <h2 class="game-title">🪙 Coinflip</h2>
        
        <div id="connectionStatus" class="connection-status" style="margin-top: 15px; font-size: 0.9rem; color: var(--text-secondary); text-align: center;">
          <span id="statusIndicator">●</span> Connecting...
        </div>

        <!-- Room Selection Section -->
        <div id="roomSelection" class="game-section">
          <h3>Available Rooms</h3>
          
          <!-- Bet Setup Section (for creating a room) -->
          <div class="bet-setup-section">
            <h4>Create a New Coin Flip Room</h4>
            <p class="setup-description">Set your bet amount and choice, then create the room</p>
            
            <div class="bet-input-group">
              <label for="createBetAmountInput">Bet Amount:</label>
              <input type="number" id="createBetAmountInput" placeholder="Enter bet amount" min="1" step="1">
              <div class="quick-bet-buttons">
                <button class="btn-quick-bet" data-amount="50">50</button>
                <button class="btn-quick-bet" data-amount="100">100</button>
                <button class="btn-quick-bet" data-amount="250">250</button>
                <button class="btn-quick-bet" data-amount="500">500</button>
                <button class="btn-quick-bet" data-amount="0">All</button>
              </div>
            </div>
            
            <div class="choice-buttons">
              <button id="createChooseHeadsBtn" class="btn-choice btn-heads">
                <span class="choice-icon">🪙</span>
                <span>Heads</span>
              </button>
              <button id="createChooseTailsBtn" class="btn-choice btn-tails">
                <span class="choice-icon">🪙</span>
                <span>Tails</span>
              </button>
            </div>
            
            <button id="createRoomBtn" class="btn btn-primary" disabled>Create Room</button>
          </div>

          <!-- Available Rooms List -->
          <div id="roomList" class="room-list"></div>
        </div>

        <!-- Game Room Section -->
        <div id="gameRoom" class="game-room-section hidden">
          <div class="room-header">
            <div class="room-id-display">
              <span>Room:</span>
              <span id="currentRoomId"></span>
            </div>
            <button id="leaveRoomBtn" class="btn btn-small">Leave Room</button>
          </div>

          <!-- Players Info -->
          <div class="players-container">
            <div class="player-card" id="player1Card">
              <div class="player-card-header">
                <span class="player-card-name" id="player1Name">You</span>
              </div>
              <div class="player-card-bet" id="player1Bet">No bet</div>
              <div class="player-card-choice" id="player1Choice"></div>
            </div>

            <div class="coin-container">
              <div id="coin" class="coin">
                <div class="coin-face coin-front">
                  <span class="coin-text">H</span>
                </div>
                <div class="coin-face coin-back">
                  <span class="coin-text">T</span>
                </div>
              </div>
              <div id="coinResult" class="coin-result"></div>
            </div>

            <div class="player-card" id="player2Card">
              <div class="player-card-header">
                <span class="player-card-name" id="player2Name">Opponent</span>
              </div>
              <div class="player-card-bet" id="player2Bet">No bet</div>
              <div class="player-card-choice" id="player2Choice"></div>
            </div>
          </div>

          <!-- Game Status -->
          <div id="gameStatus" class="game-status">
            <p id="statusMessage" class="status-message">Waiting for opponent...</p>
          </div>

          <!-- Confirmation Section (for joiner) -->
          <div id="confirmationSection" class="confirmation-section hidden">
            <div class="confirmation-info">
              <h3>Coin Flip Details</h3>
              <p><strong>Bet Amount:</strong> <span id="confirmBetAmount" class="credit-amount">0</span> credits</p>
              <div class="choice-comparison">
                <div class="choice-item">
                  <p><strong>Creator's Choice:</strong></p>
                  <div id="confirmCreatorChoice" class="choice-display"></div>
                </div>
                <div class="choice-item">
                  <p><strong>Your Choice:</strong></p>
                  <div id="confirmJoinerChoice" class="choice-display confirm-choice"></div>
                </div>
              </div>
              <p class="confirm-description">You will match the bet amount and bet on the opposite side of the creator.</p>
            </div>
            <div class="confirmation-buttons">
              <button id="confirmParticipationBtn" class="btn btn-primary">Confirm Participation</button>
              <button id="cancelParticipationBtn" class="btn btn-secondary">Leave Room</button>
            </div>
          </div>

          <!-- Results Section -->
          <div id="resultsSection" class="results-section hidden">
            <div id="resultMessage" class="result-message"></div>
          </div>
        </div>
      </div>
    `;

    this.attachEventListeners();
    
    // Connect to coinflip server after UI is rendered
    this.connectToServer();
  }

  connectToServer() {
    // Wait for socket.io to be available
    if (typeof io === 'undefined') {
      // Try again after a short delay
      setTimeout(() => this.connectToServer(), 100);
      return;
    }

    try {
      // Use shared socket from casino manager if available
      this.socket = this.casino.getSocket();
      
      if (!this.socket) {
        // Fallback: create own connection if casino manager doesn't have one
        const serverUrl = window.CASINO_SERVER_URL || window.location.origin;
        this.socket = io(serverUrl, {
          reconnection: true,
          reconnectionDelay: 1000,
          reconnectionAttempts: 5,
          timeout: 10000,
          transports: ['websocket', 'polling'],
          forceNew: false // Don't force new connection if sharing socket
        });
      }
      
      this.setupSocketListeners();
      
      // Set a timeout to show error if connection doesn't establish
      this.connectionTimeout = setTimeout(() => {
        if (this.socket && !this.socket.connected) {
          this.updateConnectionStatus('Connection timeout - Make sure casino server is running', false);
        }
      }, 5000);
      
      // If already connected, join game immediately
      if (this.socket.connected && this.casino.username) {
        this.socket.emit('joinGame', this.casino.username, this.casino.credits);
      }
      
    } catch (error) {
      console.error('Error connecting to coinflip server:', error);
      this.updateConnectionStatus('Connection failed - Server may not be running', false);
    }
  }

  setupSocketListeners() {
    if (!this.socket) return;

    this.socket.on('connect', () => {
      console.log('Coinflip: Connected to server');
      // Clear connection timeout
      if (this.connectionTimeout) {
        clearTimeout(this.connectionTimeout);
        this.connectionTimeout = null;
      }
      this.updateConnectionStatus('Connected', true);
      // Join game with casino username and current credits
      if (this.casino.username) {
        this.socket.emit('joinGame', this.casino.username, this.casino.credits);
      }
    });

    this.socket.on('disconnect', (reason) => {
      console.log('Coinflip: Disconnected', reason);
      if (reason === 'io server disconnect') {
        // Server disconnected the client, don't try to reconnect
        this.updateConnectionStatus('Disconnected by server - Please refresh', false);
      } else {
        // Client-side disconnect, will try to reconnect
        this.updateConnectionStatus('Disconnected - Reconnecting...', false);
      }
    });

    this.socket.on('connect_error', (error) => {
      console.error('Coinflip connection error:', error);
      // Don't show error immediately - socket.io will try to reconnect
      // The timeout will handle showing the error if connection fails
    });

    this.socket.on('reconnect_attempt', (attemptNumber) => {
      console.log(`Coinflip: Reconnection attempt ${attemptNumber}`);
      this.updateConnectionStatus(`Connecting... (attempt ${attemptNumber})`, false);
    });

    this.socket.on('reconnect_failed', () => {
      console.error('Coinflip: Reconnection failed');
      this.updateConnectionStatus('Connection failed - Make sure casino server is running', false);
    });

    this.socket.on('error', (message) => {
      alert(message);
    });

    this.socket.on('playerData', (data) => {
      // Only update credits if they're higher (server might have old data)
      // Or if we don't have credits yet (initial load)
      if (this.casino.credits === 0 || data.credits > this.casino.credits) {
        this.casino.credits = data.credits;
        this.casino.updateCreditsDisplay();
      }
    });

    this.socket.on('availableRooms', (rooms) => {
      this.updateRoomList(rooms);
    });

    this.socket.on('roomCreated', ({ roomId, betAmount, choice, credits }) => {
      this.currentRoomId = roomId;
      this.isCreator = true;
      this.gameFinished = false;
      this.casino.credits = credits;
      this.casino.updateCreditsDisplay();
      this.showGameRoom(roomId, betAmount, choice);
    });

    this.socket.on('joinedRoom', ({ roomId, betAmount, creatorChoice, creatorName }) => {
      this.currentRoomId = roomId;
      this.isCreator = false;
      this.gameFinished = false;
      this.showConfirmation(roomId, betAmount, creatorChoice);
    });

    this.socket.on('opponentJoined', ({ opponentName }) => {
      const statusMessage = document.getElementById('statusMessage');
      if (statusMessage) {
        statusMessage.textContent = `${opponentName} joined! Waiting for them to confirm participation...`;
      }
    });

    this.socket.on('playersUpdate', ({ player1, player2, betAmount, creatorChoice }) => {
      this.updatePlayersDisplay(player1, player2, betAmount, creatorChoice);
    });

    this.socket.on('coinFlipResult', ({ coinResult, results, betAmount, creatorChoice, choices }) => {
      this.gameFinished = true;
      this.showCoinFlipResult(coinResult, results, choices);
      const playerId = this.socket.id;
      if (results[playerId]) {
        this.casino.credits = results[playerId].newCredits;
        this.casino.updateCreditsDisplay();
      }
    });

    this.socket.on('opponentLeft', () => {
      if (!this.gameFinished) {
        const statusMessage = document.getElementById('statusMessage');
        if (statusMessage) {
          statusMessage.textContent = 'Opponent left. Waiting for another player to join...';
        }
        this.resetGameUI();
      }
    });

    this.socket.on('leftRoom', () => {
      this.currentRoomId = null;
      this.isCreator = false;
      this.showRoomSelection();
    });
  }

  updateConnectionStatus(message, connected) {
    const statusEl = document.getElementById('connectionStatus');
    const indicatorEl = document.getElementById('statusIndicator');
    if (statusEl && indicatorEl) {
      statusEl.innerHTML = `<span id="statusIndicator">●</span> ${message}`;
      statusEl.style.color = connected ? '#10b981' : '#ef4444';
      indicatorEl.style.color = connected ? '#10b981' : '#ef4444';
    }
  }

  attachEventListeners() {
    // Quick bet buttons
    document.querySelectorAll('.btn-quick-bet').forEach(btn => {
      btn.addEventListener('click', () => {
        const amount = btn.dataset.amount === '0' ? this.casino.credits : parseInt(btn.dataset.amount);
        document.getElementById('createBetAmountInput').value = amount;
        this.updateCreateRoomButton();
      });
    });

    document.getElementById('createBetAmountInput')?.addEventListener('input', () => {
      this.updateCreateRoomButton();
    });

    // Choice buttons
    document.getElementById('createChooseHeadsBtn')?.addEventListener('click', () => {
      this.selectCreateChoice('Heads');
    });

    document.getElementById('createChooseTailsBtn')?.addEventListener('click', () => {
      this.selectCreateChoice('Tails');
    });

    // Create room
    document.getElementById('createRoomBtn')?.addEventListener('click', () => {
      this.createRoom();
    });

    // Leave room
    document.getElementById('leaveRoomBtn')?.addEventListener('click', () => {
      this.leaveRoom();
    });

    // Confirm participation
    document.getElementById('confirmParticipationBtn')?.addEventListener('click', () => {
      this.confirmParticipation();
    });

    document.getElementById('cancelParticipationBtn')?.addEventListener('click', () => {
      this.leaveRoom();
    });
  }

  selectCreateChoice(choice) {
    this.createChoice = choice;
    document.getElementById('createChooseHeadsBtn').classList.toggle('selected', choice === 'Heads');
    document.getElementById('createChooseTailsBtn').classList.toggle('selected', choice === 'Tails');
    this.updateCreateRoomButton();
  }

  updateCreateRoomButton() {
    const amount = parseInt(document.getElementById('createBetAmountInput').value) || 0;
    const isValid = amount > 0 && amount <= this.casino.credits && this.createChoice;
    document.getElementById('createRoomBtn').disabled = !isValid;
  }

  createRoom() {
    const amount = parseInt(document.getElementById('createBetAmountInput').value);
    if (!amount || amount <= 0 || amount > this.casino.credits || !this.createChoice) {
      alert('Please set a valid bet amount and choice');
      return;
    }
    this.socket.emit('createRoom', { betAmount: amount, choice: this.createChoice });
  }

  leaveRoom() {
    this.socket.emit('leaveRoom');
  }

  confirmParticipation() {
    if (!this.currentRoomId) return;
    this.socket.emit('confirmParticipation', { roomId: this.currentRoomId });
  }

  updateRoomList(rooms) {
    const roomList = document.getElementById('roomList');
    if (!roomList) return;

    roomList.innerHTML = '';
    if (rooms.length === 0) {
      roomList.innerHTML = '<p style="text-align: center; color: var(--text-secondary);">No rooms available. Create a new room to start playing!</p>';
    } else {
      rooms.forEach(room => {
        const roomItem = document.createElement('div');
        roomItem.className = 'room-item';
        const joinBtn = document.createElement('button');
        joinBtn.className = 'btn btn-primary';
        joinBtn.textContent = 'Join Room';
        joinBtn.addEventListener('click', () => {
          this.socket.emit('joinRoom', { roomId: room.roomId });
        });
        roomItem.innerHTML = `
          <div class="room-item-info">
            <h3>${room.roomId}</h3>
            <p><strong>Creator:</strong> ${room.creatorName}</p>
            <p><strong>Bet Amount:</strong> <span class="credit-amount">${room.betAmount.toLocaleString()}</span> credits</p>
            <p><strong>Choice:</strong> ${room.creatorChoice}</p>
          </div>
        `;
        roomItem.appendChild(joinBtn);
        roomList.appendChild(roomItem);
      });
    }
  }

  showGameRoom(roomId, betAmount, choice) {
    document.getElementById('roomSelection').classList.add('hidden');
    document.getElementById('gameRoom').classList.remove('hidden');
    document.getElementById('currentRoomId').textContent = roomId;
    document.getElementById('player1Bet').textContent = `Bet: ${betAmount.toLocaleString()}`;
    document.getElementById('player1Choice').textContent = choice;
    document.getElementById('player1Choice').className = `player-card-choice ${choice.toLowerCase()}`;
    this.resetGameUI();
  }

  showConfirmation(roomId, betAmount, creatorChoice) {
    document.getElementById('roomSelection').classList.add('hidden');
    document.getElementById('gameRoom').classList.remove('hidden');
    document.getElementById('confirmationSection').classList.remove('hidden');
    document.getElementById('currentRoomId').textContent = roomId;
    document.getElementById('confirmBetAmount').textContent = betAmount.toLocaleString();
    document.getElementById('confirmCreatorChoice').textContent = creatorChoice;
    document.getElementById('confirmCreatorChoice').className = `choice-display ${creatorChoice.toLowerCase()}`;
    const joinerChoice = creatorChoice === 'Heads' ? 'Tails' : 'Heads';
    document.getElementById('confirmJoinerChoice').textContent = joinerChoice;
    document.getElementById('confirmJoinerChoice').className = `choice-display confirm-choice ${joinerChoice.toLowerCase()}`;
  }

  showRoomSelection() {
    document.getElementById('gameRoom').classList.add('hidden');
    document.getElementById('roomSelection').classList.remove('hidden');
    this.resetGameUI();
  }

  updatePlayersDisplay(player1, player2, betAmount, creatorChoice) {
    document.getElementById('player1Name').textContent = player1.name;
    document.getElementById('player2Name').textContent = player2.name;
    document.getElementById('player1Bet').textContent = `Bet: ${betAmount.toLocaleString()}`;
    document.getElementById('player2Bet').textContent = `Bet: ${betAmount.toLocaleString()}`;
    document.getElementById('player1Choice').textContent = creatorChoice;
    document.getElementById('player1Choice').className = `player-card-choice ${creatorChoice.toLowerCase()}`;
    const joinerChoice = creatorChoice === 'Heads' ? 'Tails' : 'Heads';
    document.getElementById('player2Choice').textContent = joinerChoice;
    document.getElementById('player2Choice').className = `player-card-choice ${joinerChoice.toLowerCase()}`;
  }

  showCoinFlipResult(result, results, choices) {
    document.getElementById('confirmationSection').classList.add('hidden');
    document.getElementById('gameStatus').classList.add('hidden');

    const coin = document.getElementById('coin');
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

      const playerId = this.socket.id;
      const playerResult = results[playerId];
      const resultMessage = document.getElementById('resultMessage');
      
      if (playerResult.won) {
        resultMessage.textContent = `🎉 You Won! +${playerResult.winnings.toLocaleString()} credits`;
        resultMessage.className = 'result-message win';
      } else {
        resultMessage.textContent = `😔 You Lost!`;
        resultMessage.className = 'result-message lose';
      }

      document.getElementById('resultsSection').classList.remove('hidden');
    }, 2000);
  }

  resetGameUI() {
    const coin = document.getElementById('coin');
    if (coin) {
      coin.classList.remove('flipping-heads', 'flipping-tails', 'show-heads', 'show-tails');
    }
    document.getElementById('coinResult').textContent = '';
    document.getElementById('resultsSection').classList.add('hidden');
  }

  destroy() {
    if (this.socket) {
      this.socket.disconnect();
    }
  }
}

window.CoinflipGame = CoinflipGame;

