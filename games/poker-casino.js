// Poker Game Module - Texas Hold'em Multiplayer

class PokerGame {
  constructor(casinoManager) {
    this.casino = casinoManager;
    this.socket = null;
    this.currentTableId = null;
    this.tableState = null;
    this.mySeat = null;
    this.pendingTableCreation = null; // Store table creation params for auto-join
    this.init();
  }

  init() {
    const gameView = document.getElementById('pokerGame');
    gameView.innerHTML = `
      <div class="poker-casino-container">
        <h2 class="game-title">🃏 Texas Hold'em Poker</h2>
        
        <!-- Lobby View -->
        <div id="pokerLobby" class="poker-lobby">
          <div class="lobby-header">
            <h3>Poker Tables</h3>
            <button id="createTableBtn" class="btn btn-primary">
              <i class="fas fa-plus"></i> Create Table
            </button>
          </div>
          
          <div id="pokerTablesList" class="poker-tables-list">
            <p class="loading-message">Loading tables...</p>
          </div>
        </div>

        <!-- Create Table Modal -->
        <div id="createTableModal" class="poker-modal hidden">
          <div class="poker-modal-overlay"></div>
          <div class="poker-modal-content">
            <div class="poker-modal-header">
              <h3>Create Poker Table</h3>
              <button id="closeCreateTableBtn" class="btn-close-modal">×</button>
            </div>
            <div class="poker-modal-body">
              <div class="form-group">
                <label>Table Name</label>
                <input type="text" id="tableNameInput" placeholder="My Table" maxlength="30">
              </div>
              <div class="form-group">
                <label>Small Blind</label>
                <input type="number" id="smallBlindInput" value="10" min="1" step="1">
              </div>
              <div class="form-group">
                <label>Big Blind</label>
                <input type="number" id="bigBlindInput" value="20" min="2" step="1">
              </div>
              <div class="form-group">
                <label>Min Buy-In</label>
                <input type="number" id="minBuyInInput" value="400" min="20" step="10">
              </div>
              <div class="form-group">
                <label>Max Buy-In</label>
                <input type="number" id="maxBuyInInput" value="2000" min="100" step="10">
              </div>
              <div class="form-group">
                <label>
                  <input type="checkbox" id="privateTableCheckbox">
                  Private Table
                </label>
              </div>
              <button id="confirmCreateTableBtn" type="button" class="btn btn-primary">Create Table</button>
            </div>
          </div>
        </div>

        <!-- Join Table Modal -->
        <div id="joinTableModal" class="poker-modal hidden">
          <div class="poker-modal-overlay"></div>
          <div class="poker-modal-content">
            <div class="poker-modal-header">
              <h3 id="joinTableTitle">Join Table</h3>
              <button id="closeJoinTableBtn" class="btn-close-modal">×</button>
            </div>
            <div class="poker-modal-body">
              <div id="joinTableInfo" class="table-info"></div>
              <div class="form-group">
                <label>Buy-In Amount</label>
                <input type="number" id="buyInInput" min="400" max="2000" value="400" step="10">
                <div class="quick-buy-in">
                  <button class="quick-buy-btn" data-amount="400">Min</button>
                  <button class="quick-buy-btn" data-amount="1000">Mid</button>
                  <button class="quick-buy-btn" data-amount="2000">Max</button>
                </div>
              </div>
              <div id="availableSeats" class="available-seats">
                <p>Select a seat (or leave empty for auto-assign):</p>
                <div class="seats-selection"></div>
              </div>
              <button id="confirmJoinTableBtn" class="btn btn-primary">Join Table</button>
            </div>
          </div>
        </div>

        <!-- Table View -->
        <div id="pokerTable" class="poker-table-view hidden">
          <div class="table-header">
            <div class="table-info-header">
              <h3 id="tableNameDisplay"></h3>
              <div class="table-stakes">
                <span>Blinds: <span id="blindsDisplay"></span></span>
              </div>
            </div>
            <button id="leaveTableBtn" class="btn btn-secondary">Leave Table</button>
          </div>

          <div class="poker-table-container">
            <!-- Community Cards -->
            <div class="community-cards-area">
              <div class="pot-display">
                Pot: <span id="potAmount">0</span>
              </div>
              <div id="communityCards" class="community-cards"></div>
            </div>

            <!-- Player Seats (arranged in a circle) -->
            <div class="poker-seats-container">
              <div class="poker-seat" data-seat="0">
                <div class="seat-info">
                  <div class="player-name"></div>
                  <div class="player-chips"></div>
                  <div class="player-bet"></div>
                  <div class="seat-indicators"></div>
                </div>
                <div class="player-cards"></div>
              </div>
              <div class="poker-seat" data-seat="1">
                <div class="seat-info">
                  <div class="player-name"></div>
                  <div class="player-chips"></div>
                  <div class="player-bet"></div>
                  <div class="seat-indicators"></div>
                </div>
                <div class="player-cards"></div>
              </div>
              <div class="poker-seat" data-seat="2">
                <div class="seat-info">
                  <div class="player-name"></div>
                  <div class="player-chips"></div>
                  <div class="player-bet"></div>
                  <div class="seat-indicators"></div>
                </div>
                <div class="player-cards"></div>
              </div>
              <div class="poker-seat" data-seat="3">
                <div class="seat-info">
                  <div class="player-name"></div>
                  <div class="player-chips"></div>
                  <div class="player-bet"></div>
                  <div class="seat-indicators"></div>
                </div>
                <div class="player-cards"></div>
              </div>
              <div class="poker-seat" data-seat="4">
                <div class="seat-info">
                  <div class="player-name"></div>
                  <div class="player-chips"></div>
                  <div class="player-bet"></div>
                  <div class="seat-indicators"></div>
                </div>
                <div class="player-cards"></div>
              </div>
              <div class="poker-seat" data-seat="5">
                <div class="seat-info">
                  <div class="player-name"></div>
                  <div class="player-chips"></div>
                  <div class="player-bet"></div>
                  <div class="seat-indicators"></div>
                </div>
                <div class="player-cards"></div>
              </div>
            </div>
          </div>

          <!-- Action Controls -->
          <div id="pokerActions" class="poker-actions hidden">
            <div class="action-info">
              <div id="actionTimer" class="action-timer"></div>
              <div id="currentBetInfo" class="current-bet-info"></div>
            </div>
            <div class="action-buttons">
              <button id="foldBtn" class="btn-action btn-fold">Fold</button>
              <button id="checkBtn" class="btn-action btn-check hidden">Check</button>
              <button id="callBtn" class="btn-action btn-call hidden">Call <span id="callAmount"></span></button>
              <button id="betBtn" class="btn-action btn-bet hidden">Bet</button>
              <button id="raiseBtn" class="btn-action btn-raise hidden">Raise</button>
              <button id="allInBtn" class="btn-action btn-allin">All-In</button>
            </div>
            <div id="betControls" class="bet-controls hidden">
              <input type="range" id="betSlider" min="0" max="1000" value="0" step="10">
              <div class="bet-amount-display">
                <span id="betAmountDisplay">0</span>
                <div class="quick-bet-presets">
                  <button class="quick-preset" data-preset="min">Min</button>
                  <button class="quick-preset" data-preset="pot">Pot</button>
                  <button class="quick-preset" data-preset="max">Max</button>
                </div>
              </div>
            </div>
          </div>

          <!-- Waiting for Players / Game Status -->
          <div id="gameStatus" class="game-status">
            <p id="statusMessage">Waiting for players...</p>
            <button id="startHandBtn" class="btn btn-primary hidden">Start Hand</button>
          </div>

          <!-- Chat -->
          <div class="poker-chat-container">
            <div id="chatMessages" class="chat-messages"></div>
            <div class="chat-input-container">
              <input type="text" id="chatInput" placeholder="Type a message..." maxlength="200">
              <button id="sendChatBtn" class="btn btn-small">Send</button>
            </div>
          </div>
        </div>
      </div>
    `;

    this.attachEventListeners();
    this.connectToServer();
  }

  connectToServer() {
    if (typeof io === 'undefined') {
      setTimeout(() => this.connectToServer(), 100);
      return;
    }

    try {
      this.socket = this.casino.getSocket();
      
      if (!this.socket) {
        const serverUrl = window.CASINO_SERVER_URL || window.location.origin;
        this.socket = io(serverUrl);
      }
      
      this.setupSocketListeners();
      
      if (this.socket.connected) {
        this.socket.emit('joinPokerLobby');
      }
    } catch (error) {
      console.error('Error connecting to poker server:', error);
    }
  }

  setupSocketListeners() {
    if (!this.socket) return;

    // Remove all existing listeners to prevent accumulation (like other games do)
    this.socket.removeAllListeners('connect');
    this.socket.removeAllListeners('disconnect');
    this.socket.removeAllListeners('connect_error');
    this.socket.removeAllListeners('error');
    this.socket.removeAllListeners('pokerTablesUpdate');
    this.socket.removeAllListeners('pokerTableCreated');
    this.socket.removeAllListeners('pokerTableState');
    this.socket.removeAllListeners('pokerChatMessage');
    this.socket.removeAllListeners('playerData');

    this.socket.on('connect', () => {
      this.socket.emit('joinPokerLobby');
    });

    this.socket.on('pokerTablesUpdate', (tables) => {
      this.renderTablesList(tables);
    });

    this.socket.on('pokerTableCreated', ({ tableId }) => {
      // Auto-join the created table with the minBuyIn that was used to create it
      const buyIn = this.pendingTableCreation ? this.pendingTableCreation.minBuyIn : null;
      this.pendingTableCreation = null; // Clear after use
      if (buyIn) {
        this.joinTable(tableId, buyIn, null);
      }
    });

    this.socket.on('pokerTableState', (state) => {
      this.tableState = state;
      if (state.tableId === this.currentTableId) {
        // Show table view BEFORE rendering
        const lobbyEl = document.getElementById('pokerLobby');
        const tableEl = document.getElementById('pokerTable');
        if (lobbyEl && tableEl) {
          lobbyEl.classList.add('hidden');
          tableEl.classList.remove('hidden');
        }
        try {
          this.renderTable(state);
        } catch (error) {
          console.error('Error in pokerTableState handler:', error);
        }
      }
    });

    this.socket.on('pokerChatMessage', ({ username, message, timestamp }) => {
      this.addChatMessage(username, message, timestamp);
    });

    this.socket.on('error', (error) => {
      alert(error);
    });
  }

  attachEventListeners() {
    // Lobby
    const createTableBtn = document.getElementById('createTableBtn');
    createTableBtn?.addEventListener('click', () => {
      const modal = document.getElementById('createTableModal');
      modal?.classList.remove('hidden');
    });

    document.getElementById('closeCreateTableBtn')?.addEventListener('click', () => {
      document.getElementById('createTableModal').classList.add('hidden');
    });

    const confirmBtn = document.getElementById('confirmCreateTableBtn');
    confirmBtn?.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.createTable();
    });

    document.getElementById('closeJoinTableBtn')?.addEventListener('click', () => {
      document.getElementById('joinTableModal').classList.add('hidden');
    });

    document.getElementById('confirmJoinTableBtn')?.addEventListener('click', () => {
      this.confirmJoinTable();
    });

    // Table view
    document.getElementById('leaveTableBtn')?.addEventListener('click', () => {
      this.leaveTable();
    });

    document.getElementById('startHandBtn')?.addEventListener('click', () => {
      this.startHand();
    });

    // Action buttons
    document.getElementById('foldBtn')?.addEventListener('click', () => {
      this.pokerAction('fold');
    });

    document.getElementById('checkBtn')?.addEventListener('click', () => {
      this.pokerAction('check');
    });

    document.getElementById('callBtn')?.addEventListener('click', () => {
      this.pokerAction('call');
    });

    document.getElementById('betBtn')?.addEventListener('click', () => {
      this.showBetControls();
      this.pokerAction('bet');
    });

    document.getElementById('raiseBtn')?.addEventListener('click', () => {
      this.showBetControls();
      this.pokerAction('raise');
    });

    document.getElementById('allInBtn')?.addEventListener('click', () => {
      this.pokerAction('allin');
    });

    // Bet controls
    const betSlider = document.getElementById('betSlider');
    betSlider?.addEventListener('input', (e) => {
      const amount = parseInt(e.target.value);
      document.getElementById('betAmountDisplay').textContent = amount;
    });

    document.querySelectorAll('.quick-preset').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const preset = e.target.dataset.preset;
        this.setBetPreset(preset);
      });
    });

    // Chat
    document.getElementById('sendChatBtn')?.addEventListener('click', () => {
      this.sendChatMessage();
    });

    document.getElementById('chatInput')?.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') {
        this.sendChatMessage();
      }
    });

    // Quick buy-in buttons
    document.querySelectorAll('.quick-buy-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const amount = parseInt(e.target.dataset.amount);
        document.getElementById('buyInInput').value = amount;
      });
    });

    // Small blind / Big blind sync
    document.getElementById('smallBlindInput')?.addEventListener('input', (e) => {
      const sb = parseInt(e.target.value) || 10;
      document.getElementById('bigBlindInput').value = sb * 2;
      document.getElementById('minBuyInInput').value = sb * 40;
      document.getElementById('maxBuyInInput').value = sb * 100;
    });
  }

  renderTablesList(tables) {
    const listEl = document.getElementById('pokerTablesList');
    if (!listEl) return;

    if (tables.length === 0) {
      listEl.innerHTML = '<p class="no-tables">No tables available. Create one to get started!</p>';
      return;
    }

    listEl.innerHTML = tables.map(table => `
      <div class="poker-table-card" data-table-id="${table.tableId}">
        <div class="table-card-header">
          <h4>${table.tableName}</h4>
          <span class="table-status ${table.gameState}">${table.gameState}</span>
        </div>
        <div class="table-card-info">
          <div class="info-row">
            <span>Blinds:</span>
            <span>${table.smallBlind}/${table.bigBlind}</span>
          </div>
          <div class="info-row">
            <span>Buy-In:</span>
            <span>${table.minBuyIn} - ${table.maxBuyIn}</span>
          </div>
          <div class="info-row">
            <span>Players:</span>
            <span>${table.playerCount}/${table.maxPlayers}</span>
          </div>
        </div>
        <button class="btn btn-primary btn-join-table" data-table-id="${table.tableId}">
          Join Table
        </button>
      </div>
    `).join('');

    // Attach join table listeners
    listEl.querySelectorAll('.btn-join-table').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const tableId = e.target.dataset.tableId;
        const table = tables.find(t => t.tableId === tableId);
        this.showJoinTableModal(table);
      });
    });
  }

  showJoinTableModal(table) {
    this.selectedTable = table;
    document.getElementById('joinTableTitle').textContent = `Join ${table.tableName}`;
    document.getElementById('joinTableInfo').innerHTML = `
      <div class="info-row"><span>Blinds:</span><span>${table.smallBlind}/${table.bigBlind}</span></div>
      <div class="info-row"><span>Buy-In Range:</span><span>${table.minBuyIn} - ${table.maxBuyIn}</span></div>
      <div class="info-row"><span>Players:</span><span>${table.playerCount}/${table.maxPlayers}</span></div>
    `;
    document.getElementById('buyInInput').min = table.minBuyIn;
    document.getElementById('buyInInput').max = table.maxBuyIn;
    document.getElementById('buyInInput').value = table.minBuyIn;
    document.getElementById('joinTableModal').classList.remove('hidden');
  }

  confirmJoinTable() {
    if (!this.selectedTable) return;

    const buyIn = parseInt(document.getElementById('buyInInput').value);
    const seatSelect = document.querySelector('.seats-selection input[type="radio"]:checked');
    const seat = seatSelect ? parseInt(seatSelect.value) : null;

    if (buyIn < this.selectedTable.minBuyIn || buyIn > this.selectedTable.maxBuyIn) {
      alert(`Buy-in must be between ${this.selectedTable.minBuyIn} and ${this.selectedTable.maxBuyIn}`);
      return;
    }

    this.joinTable(this.selectedTable.tableId, buyIn, seat);
    document.getElementById('joinTableModal').classList.add('hidden');
  }

  createTable() {
    const tableName = document.getElementById('tableNameInput').value.trim() || 'My Table';
    const smallBlind = parseInt(document.getElementById('smallBlindInput').value) || 10;
    const bigBlind = parseInt(document.getElementById('bigBlindInput').value) || 20;
    const minBuyIn = parseInt(document.getElementById('minBuyInInput').value) || 400;
    const maxBuyIn = parseInt(document.getElementById('maxBuyInInput').value) || 2000;
    const isPrivate = document.getElementById('privateTableCheckbox').checked;

    if (bigBlind !== smallBlind * 2) {
      alert('Big blind must be exactly 2x the small blind');
      return;
    }
    
    // Store creation params for auto-join after table is created
    this.pendingTableCreation = { minBuyIn };
    
    this.socket.emit('createPokerTable', {
      tableName,
      smallBlind,
      bigBlind,
      minBuyIn,
      maxBuyIn,
      isPrivate
    });

    document.getElementById('createTableModal').classList.add('hidden');
  }

  joinTable(tableId, buyIn, seat) {
    this.currentTableId = tableId;
    
    if (buyIn !== null) {
      this.socket.emit('joinPokerTable', { tableId, buyIn, seat });
    }
  }

  leaveTable() {
    if (!this.currentTableId) return;

    if (confirm('Are you sure you want to leave the table?')) {
      this.socket.emit('leavePokerTable', { tableId: this.currentTableId });
      this.currentTableId = null;
      const pokerLobby = document.getElementById('pokerLobby');
      const pokerTable = document.getElementById('pokerTable');
      if (pokerLobby) pokerLobby.classList.remove('hidden');
      if (pokerTable) pokerTable.classList.add('hidden');
    }
  }

  startHand() {
    if (!this.currentTableId) return;
    this.socket.emit('startPokerHand', { tableId: this.currentTableId });
  }

  pokerAction(action, amount) {
    if (!this.currentTableId) return;

    if (action === 'bet' || action === 'raise') {
      amount = parseInt(document.getElementById('betAmountDisplay').textContent) || 0;
      if (amount <= 0) {
        alert('Please enter a valid bet amount');
        return;
      }
    }

    this.socket.emit('pokerAction', {
      tableId: this.currentTableId,
      action,
      amount
    });
  }

  showBetControls() {
    document.getElementById('betControls').classList.remove('hidden');
  }

  setBetPreset(preset) {
    if (!this.tableState || !this.tableState.currentHand) return;

    const hand = this.tableState.currentHand;
    const myPlayer = this.tableState.players.find(p => p.socketId === this.socket.id);
    if (!myPlayer) return;

    let amount = 0;
    switch (preset) {
      case 'min':
        amount = hand.currentBet * 2;
        break;
      case 'pot':
        amount = hand.pot;
        break;
      case 'max':
        amount = myPlayer.chips;
        break;
    }

    document.getElementById('betSlider').max = myPlayer.chips;
    document.getElementById('betSlider').value = amount;
    document.getElementById('betAmountDisplay').textContent = amount;
  }

  sendChatMessage() {
    if (!this.currentTableId) return;

    const input = document.getElementById('chatInput');
    const message = input.value.trim();
    if (!message) return;

    this.socket.emit('pokerChat', {
      tableId: this.currentTableId,
      message
    });

    input.value = '';
  }

  addChatMessage(username, message, timestamp) {
    const chatEl = document.getElementById('chatMessages');
    if (!chatEl) return;

    const messageEl = document.createElement('div');
    messageEl.className = 'chat-message';
    messageEl.innerHTML = `
      <span class="chat-username">${this.escapeHtml(username)}:</span>
      <span class="chat-text">${this.escapeHtml(message)}</span>
    `;
    chatEl.appendChild(messageEl);
    chatEl.scrollTop = chatEl.scrollHeight;
  }

  renderTable(state) {
    if (!state) return;

    try {
    // Update header
    document.getElementById('tableNameDisplay').textContent = state.tableName;
    document.getElementById('blindsDisplay').textContent = `${state.smallBlind}/${state.bigBlind}`;

    // Update seats
    // Safety check: ensure seats is an array
    if (!Array.isArray(state.seats)) {
      console.error('state.seats is not an array:', state.seats);
    } else {
    state.seats.forEach((seatData, index) => {
      try {
        const seatEl = document.querySelector(`.poker-seat[data-seat="${index}"]`);
        if (!seatEl) return;

      if (!seatData) {
        // Empty seat
        seatEl.classList.remove('occupied');
        seatEl.querySelector('.player-name').textContent = '';
        seatEl.querySelector('.player-chips').textContent = '';
        seatEl.querySelector('.player-bet').textContent = '';
        seatEl.querySelector('.player-cards').innerHTML = '';
        seatEl.querySelector('.seat-indicators').innerHTML = '';
      } else {
        // Occupied seat
        seatEl.classList.add('occupied');
        seatEl.querySelector('.player-name').textContent = seatData.username;
        seatEl.querySelector('.player-chips').textContent = `${seatData.chips} chips`;
        seatEl.querySelector('.player-bet').textContent = seatData.betAmount > 0 ? `Bet: ${seatData.betAmount}` : '';
        
        // Check if this is me
        const isMe = this.socket && state.players.find(p => p.socketId === this.socket.id)?.seat === index;
        if (isMe) {
          this.mySeat = index;
          seatEl.classList.add('my-seat');
        } else {
          seatEl.classList.remove('my-seat');
        }

        // Update indicators (dealer, blinds, etc.)
        this.updateSeatIndicators(seatEl, state, index);
      }
      } catch (seatError) {
        console.error(`Error processing seat ${index}:`, seatError);
      }
    });
    }

    // Update community cards and pot
    if (state.currentHand) {
      const hand = state.currentHand;
      document.getElementById('potAmount').textContent = hand.pot;
      this.renderCommunityCards(hand.communityCards);
      this.renderPlayerCards(state);
      this.updateActionControls(state);
    } else {
      document.getElementById('potAmount').textContent = '0';
      document.getElementById('communityCards').innerHTML = '';
      document.getElementById('pokerActions').classList.add('hidden');
      
      // Show start button if we have enough players
      const activePlayers = state.players.filter(p => p.isActive);
      if (activePlayers.length >= 2 && state.gameState === 'waiting') {
        document.getElementById('startHandBtn').classList.remove('hidden');
        document.getElementById('statusMessage').textContent = 'Ready to start. Click Start Hand when ready.';
      } else {
        document.getElementById('startHandBtn').classList.add('hidden');
        document.getElementById('statusMessage').textContent = `Waiting for players... (${activePlayers.length}/2)`;
      }
    }

    // Update game status
    if (state.gameState === 'betting' || state.gameState === 'dealing') {
      document.getElementById('gameStatus').classList.add('hidden');
    } else {
      document.getElementById('gameStatus').classList.remove('hidden');
    }
    
    } catch (error) {
      console.error('Error rendering table:', error);
    }
  }

  updateSeatIndicators(seatEl, state, seatIndex) {
    const indicatorsEl = seatEl.querySelector('.seat-indicators');
    if (!state.currentHand) {
      indicatorsEl.innerHTML = '';
      return;
    }

    const hand = state.currentHand;
    let indicators = [];

    // Convert player indices to seat numbers
    const dealerPlayer = hand.players[hand.dealerPosition];
    if (dealerPlayer && dealerPlayer.seat === seatIndex) {
      indicators.push('<span class="indicator dealer">D</span>');
    }
    
    const sbPlayer = hand.players[hand.smallBlindPosition];
    if (sbPlayer && sbPlayer.seat === seatIndex) {
      indicators.push('<span class="indicator small-blind">SB</span>');
    }
    
    const bbPlayer = hand.players[hand.bigBlindPosition];
    if (bbPlayer && bbPlayer.seat === seatIndex) {
      indicators.push('<span class="indicator big-blind">BB</span>');
    }
    
    if (hand.currentPlayerIndex !== undefined) {
      const currentPlayer = hand.players[hand.currentPlayerIndex];
      if (currentPlayer && currentPlayer.seat === seatIndex) {
        indicators.push('<span class="indicator current-player">●</span>');
      }
    }

    indicatorsEl.innerHTML = indicators.join('');
  }

  renderCommunityCards(cards) {
    const container = document.getElementById('communityCards');
    if (!container) return;

    container.innerHTML = cards.map(card => `
      <div class="card ${this.getCardSuit(card)}">${this.formatCard(card)}</div>
    `).join('');
  }

  renderPlayerCards(state) {
    if (!state.currentHand) return;

    state.seats.forEach((seatData, index) => {
      const seatEl = document.querySelector(`.poker-seat[data-seat="${index}"]`);
      if (!seatEl || !seatData) return;

      const player = state.currentHand.players.find(p => p.seat === index);
      if (!player || !player.cards || player.cards.length === 0) {
        seatEl.querySelector('.player-cards').innerHTML = '';
        return;
      }

      const isMe = this.mySeat === index;
      const isShowdown = state.gameState === 'showdown';
      
      // Show cards for me always, for opponents only during showdown
      const cardsHtml = player.cards.map(card => {
        if (isMe) {
          return `<div class="card ${this.getCardSuit(card)} my-card">${this.formatCard(card)}</div>`;
        } else if (isShowdown && !player.isFolded) {
          return `<div class="card ${this.getCardSuit(card)} opponent-card">${this.formatCard(card)}</div>`;
        } else {
          return `<div class="card opponent-card">🂠</div>`;
        }
      }).join('');

      seatEl.querySelector('.player-cards').innerHTML = cardsHtml;
    });
  }

  updateActionControls(state) {
    if (!state.currentHand) {
      document.getElementById('pokerActions').classList.add('hidden');
      return;
    }

    const hand = state.currentHand;
    const myPlayer = hand.players.find(p => p.socketId === this.socket.id);
    if (!myPlayer || myPlayer.isFolded || myPlayer.isAllIn) {
      document.getElementById('pokerActions').classList.add('hidden');
      return;
    }

    // Check if it's my turn
    const isMyTurn = hand.currentPlayerIndex !== undefined && 
                     hand.players[hand.currentPlayerIndex]?.socketId === this.socket.id;

    if (!isMyTurn) {
      document.getElementById('pokerActions').classList.add('hidden');
      return;
    }

    document.getElementById('pokerActions').classList.remove('hidden');
    document.getElementById('betControls').classList.add('hidden');

    // Update button visibility
    const canCheck = myPlayer.totalBetThisRound >= hand.currentBet;
    document.getElementById('checkBtn').classList.toggle('hidden', !canCheck);
    
    const callAmount = hand.currentBet - myPlayer.totalBetThisRound;
    const canCall = callAmount > 0 && callAmount <= myPlayer.chips;
    document.getElementById('callBtn').classList.toggle('hidden', !canCall);
    if (canCall) {
      document.getElementById('callAmount').textContent = callAmount;
    }

    const canBet = hand.currentBet === 0;
    document.getElementById('betBtn').classList.toggle('hidden', !canBet);

    const canRaise = hand.currentBet > 0 && myPlayer.chips > callAmount;
    document.getElementById('raiseBtn').classList.toggle('hidden', !canRaise);

    // Update bet slider
    const maxBet = myPlayer.chips;
    document.getElementById('betSlider').max = maxBet;
    document.getElementById('betSlider').value = Math.min(hand.currentBet * 2, maxBet);
    document.getElementById('betAmountDisplay').textContent = document.getElementById('betSlider').value;

    // Update current bet info
    document.getElementById('currentBetInfo').textContent = `Current bet: ${hand.currentBet}, Your bet: ${myPlayer.totalBetThisRound}`;
  }

  formatCard(cardString) {
    if (!cardString || cardString.length < 2) return '';
    const rank = cardString[0];
    const suit = cardString[1];
    const suitSymbols = { 'h': '♥', 'd': '♦', 'c': '♣', 's': '♠' };
    return `${rank}${suitSymbols[suit] || ''}`;
  }

  getCardSuit(cardString) {
    if (!cardString || cardString.length < 2) return '';
    const suit = cardString[1];
    return `suit-${suit}`;
  }

  escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  destroy() {
    if (this.currentTableId) {
      this.leaveTable();
    }
    // Clean up socket listeners if needed
  }
}

window.PokerGame = PokerGame;
