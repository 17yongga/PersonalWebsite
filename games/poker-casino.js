// Poker Game Module - Texas Hold'em Multiplayer

class PokerGame {
  constructor(casinoManager) {
    this.casino = casinoManager;
    this.socket = null;
    this.currentTableId = null;
    this.tableState = null;
    this.mySeat = null;
    this.pendingTableCreation = null;
    this._destroyed = false;
    this._socketListeners = [];
    this._pendingBetAction = 'bet';
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
            <p class="no-tables">No tables available. Create one to get started!</p>
          </div>
        </div>

        <!-- Create Table Modal -->
        <div id="createTableModal" class="poker-modal hidden">
          <div class="poker-modal-overlay"></div>
          <div class="poker-modal-content">
            <div class="poker-modal-header">
              <h3>Create Poker Table</h3>
              <button id="closeCreateTableBtn" class="btn-close-modal">&times;</button>
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
              <div class="form-group checkbox-group">
                <label><input type="checkbox" id="privateTableCheckbox"> Private Table</label>
              </div>
              <button id="confirmCreateTableBtn" type="button" class="btn btn-primary btn-full">Create Table</button>
            </div>
          </div>
        </div>

        <!-- Join Table Modal -->
        <div id="joinTableModal" class="poker-modal hidden">
          <div class="poker-modal-overlay"></div>
          <div class="poker-modal-content">
            <div class="poker-modal-header">
              <h3 id="joinTableTitle">Join Table</h3>
              <button id="closeJoinTableBtn" class="btn-close-modal">&times;</button>
            </div>
            <div class="poker-modal-body">
              <div id="joinTableInfo" class="join-table-info"></div>
              <div class="form-group">
                <label>Buy-In Amount</label>
                <input type="number" id="buyInInput" min="400" max="2000" value="400" step="10">
                <div class="quick-buy-in">
                  <button class="quick-buy-btn" data-amount="min">Min</button>
                  <button class="quick-buy-btn" data-amount="mid">Mid</button>
                  <button class="quick-buy-btn" data-amount="max">Max</button>
                </div>
              </div>
              <button id="confirmJoinTableBtn" class="btn btn-primary btn-full">Join Table</button>
            </div>
          </div>
        </div>

        <!-- Table View -->
        <div id="pokerTable" class="poker-table-view hidden">
          <div class="poker-table-top-bar">
            <div class="poker-table-info">
              <span id="tableNameDisplay" class="table-name-label"></span>
              <span class="table-blinds-label">Blinds: <span id="blindsDisplay"></span></span>
            </div>
            <button id="leaveTableBtn" class="btn btn-secondary btn-small">Leave Table</button>
          </div>

          <!-- The Poker Table -->
          <div class="poker-felt-wrapper">
            <div class="poker-felt">
              <!-- Pot & Community Cards (center) -->
              <div class="felt-center">
                <div class="pot-display">
                  <span class="pot-icon">💰</span> Pot: <span id="potAmount" class="pot-value">0</span>
                </div>
                <div id="communityCards" class="community-cards"></div>
                <div id="winnerAnnouncement" class="winner-announcement hidden"></div>
              </div>

              <!-- 6 Seats positioned around the felt -->
              <div class="poker-seat seat-0" data-seat="0">
                <div class="seat-cards"></div>
                <div class="seat-panel">
                  <div class="seat-name">Seat 1</div>
                  <div class="seat-chips"></div>
                  <div class="seat-badge-row"></div>
                </div>
                <div class="seat-bet-chip"></div>
              </div>
              <div class="poker-seat seat-1" data-seat="1">
                <div class="seat-cards"></div>
                <div class="seat-panel">
                  <div class="seat-name">Seat 2</div>
                  <div class="seat-chips"></div>
                  <div class="seat-badge-row"></div>
                </div>
                <div class="seat-bet-chip"></div>
              </div>
              <div class="poker-seat seat-2" data-seat="2">
                <div class="seat-cards"></div>
                <div class="seat-panel">
                  <div class="seat-name">Seat 3</div>
                  <div class="seat-chips"></div>
                  <div class="seat-badge-row"></div>
                </div>
                <div class="seat-bet-chip"></div>
              </div>
              <div class="poker-seat seat-3" data-seat="3">
                <div class="seat-cards"></div>
                <div class="seat-panel">
                  <div class="seat-name">Seat 4</div>
                  <div class="seat-chips"></div>
                  <div class="seat-badge-row"></div>
                </div>
                <div class="seat-bet-chip"></div>
              </div>
              <div class="poker-seat seat-4" data-seat="4">
                <div class="seat-cards"></div>
                <div class="seat-panel">
                  <div class="seat-name">Seat 5</div>
                  <div class="seat-chips"></div>
                  <div class="seat-badge-row"></div>
                </div>
                <div class="seat-bet-chip"></div>
              </div>
              <div class="poker-seat seat-5" data-seat="5">
                <div class="seat-cards"></div>
                <div class="seat-panel">
                  <div class="seat-name">Seat 6</div>
                  <div class="seat-chips"></div>
                  <div class="seat-badge-row"></div>
                </div>
                <div class="seat-bet-chip"></div>
              </div>
            </div>
          </div>

          <!-- Game Status (waiting) -->
          <div id="gameStatus" class="poker-game-status">
            <p id="statusMessage">Waiting for players...</p>
            <button id="startHandBtn" class="btn btn-primary hidden">Deal Cards</button>
          </div>

          <!-- Action Controls -->
          <div id="pokerActions" class="poker-actions hidden">
            <div class="poker-actions-info">
              <span id="currentBetInfo"></span>
            </div>
            <div class="poker-action-btns">
              <button id="foldBtn" class="pa-btn pa-fold">Fold</button>
              <button id="checkBtn" class="pa-btn pa-check hidden">Check</button>
              <button id="callBtn" class="pa-btn pa-call hidden">Call <span id="callAmount"></span></button>
              <button id="betBtn" class="pa-btn pa-bet hidden">Bet</button>
              <button id="raiseBtn" class="pa-btn pa-raise hidden">Raise</button>
              <button id="allInBtn" class="pa-btn pa-allin">All In</button>
            </div>
            <div id="betControls" class="poker-bet-controls hidden">
              <input type="range" id="betSlider" min="0" max="1000" value="0" step="10">
              <div class="bet-ctrl-row">
                <input type="number" id="betAmountInput" value="0" min="0" step="10">
                <div class="bet-presets">
                  <button class="bp-btn" data-preset="min">Min</button>
                  <button class="bp-btn" data-preset="half">½ Pot</button>
                  <button class="bp-btn" data-preset="pot">Pot</button>
                  <button class="bp-btn" data-preset="max">All-In</button>
                </div>
                <button id="confirmBetBtn" class="btn btn-primary">Confirm</button>
              </div>
            </div>
          </div>

          <!-- Chat -->
          <div class="poker-chat-section">
            <div class="poker-chat-toggle-bar" id="chatToggle">💬 Chat</div>
            <div class="poker-chat-body hidden" id="chatPanel">
              <div id="chatMessages" class="poker-chat-msgs"></div>
              <div class="poker-chat-input-row">
                <input type="text" id="chatInput" placeholder="Type a message..." maxlength="200">
                <button id="sendChatBtn" class="btn btn-primary btn-small">Send</button>
              </div>
            </div>
          </div>
        </div>
      </div>
    `;

    this.attachEventListeners();
    this.connectToServer();
  }

  // ---- Socket ----

  connectToServer() {
    if (this._destroyed) return;
    try {
      this.socket = this.casino.getSocket();
      if (!this.socket) {
        const serverUrl = window.CASINO_SERVER_URL || window.location.origin;
        this.socket = io(serverUrl);
      }
      this.setupSocketListeners();
      if (this.socket.connected) this.socket.emit('joinPokerLobby');
    } catch (e) { console.error('[Poker] connect error:', e); }
  }

  _on(evt, fn) { this.socket.on(evt, fn); this._socketListeners.push({evt,fn}); }

  setupSocketListeners() {
    if (!this.socket || this._destroyed) return;
    for (const {evt,fn} of this._socketListeners) this.socket.off(evt, fn);
    this._socketListeners = [];

    this._on('connect', () => { if (!this._destroyed) this.socket.emit('joinPokerLobby'); });
    this._on('pokerTablesUpdate', t => { if (!this._destroyed) this.renderTablesList(t); });
    this._on('pokerTableCreated', ({tableId}) => {
      if (this._destroyed) return;
      const buyIn = this.pendingTableCreation?.minBuyIn;
      this.pendingTableCreation = null;
      if (buyIn) this.joinTable(tableId, buyIn, null);
    });
    this._on('pokerTableState', state => {
      if (this._destroyed) return;
      this.tableState = state;
      if (state.tableId === this.currentTableId) {
        document.getElementById('pokerLobby')?.classList.add('hidden');
        document.getElementById('pokerTable')?.classList.remove('hidden');
        try { this.renderTable(state); } catch(e) { console.error('[Poker] render error:', e); }
      }
    });
    this._on('pokerChatMessage', ({username, message}) => {
      if (!this._destroyed) this.addChatMessage(username, message);
    });
  }

  // ---- Event Listeners ----

  attachEventListeners() {
    const $ = id => document.getElementById(id);
    $('createTableBtn')?.addEventListener('click', () => $('createTableModal')?.classList.remove('hidden'));
    $('closeCreateTableBtn')?.addEventListener('click', () => $('createTableModal')?.classList.add('hidden'));
    $('confirmCreateTableBtn')?.addEventListener('click', e => { e.preventDefault(); this.createTable(); });
    $('closeJoinTableBtn')?.addEventListener('click', () => $('joinTableModal')?.classList.add('hidden'));
    $('confirmJoinTableBtn')?.addEventListener('click', () => this.confirmJoinTable());
    document.querySelectorAll('.poker-modal-overlay').forEach(o => o.addEventListener('click', () => o.closest('.poker-modal')?.classList.add('hidden')));
    $('leaveTableBtn')?.addEventListener('click', () => this.leaveTable());
    $('startHandBtn')?.addEventListener('click', () => this.startHand());
    $('foldBtn')?.addEventListener('click', () => this.pokerAction('fold'));
    $('checkBtn')?.addEventListener('click', () => this.pokerAction('check'));
    $('callBtn')?.addEventListener('click', () => this.pokerAction('call'));
    $('betBtn')?.addEventListener('click', () => { this._pendingBetAction = 'bet'; this.showBetControls(); });
    $('raiseBtn')?.addEventListener('click', () => { this._pendingBetAction = 'raise'; this.showBetControls(); });
    $('allInBtn')?.addEventListener('click', () => this.pokerAction('allin'));
    $('confirmBetBtn')?.addEventListener('click', () => {
      const amt = parseInt($('betAmountInput').value) || 0;
      if (amt > 0) { this.pokerAction(this._pendingBetAction || 'bet', amt); $('betControls')?.classList.add('hidden'); }
    });
    const slider = $('betSlider'), numInput = $('betAmountInput');
    slider?.addEventListener('input', e => { if (numInput) numInput.value = e.target.value; });
    numInput?.addEventListener('input', e => { if (slider) slider.value = e.target.value; });
    document.querySelectorAll('.bp-btn').forEach(b => b.addEventListener('click', e => this.setBetPreset(e.target.dataset.preset)));
    $('chatToggle')?.addEventListener('click', () => $('chatPanel')?.classList.toggle('hidden'));
    $('sendChatBtn')?.addEventListener('click', () => this.sendChatMessage());
    $('chatInput')?.addEventListener('keypress', e => { if (e.key === 'Enter') this.sendChatMessage(); });
    document.querySelectorAll('.quick-buy-btn').forEach(b => b.addEventListener('click', e => {
      const p = e.target.dataset.amount, t = this.selectedTable; if (!t) return;
      const inp = $('buyInInput');
      if (p === 'min') inp.value = t.minBuyIn;
      else if (p === 'max') inp.value = t.maxBuyIn;
      else inp.value = Math.floor((t.minBuyIn + t.maxBuyIn) / 2);
    }));
    $('smallBlindInput')?.addEventListener('input', e => {
      const sb = parseInt(e.target.value) || 10;
      $('bigBlindInput').value = sb * 2;
      $('minBuyInInput').value = sb * 40;
      $('maxBuyInInput').value = sb * 200;
    });
  }

  // ---- Lobby ----

  renderTablesList(tables) {
    const el = document.getElementById('pokerTablesList');
    if (!el) return;
    if (!tables || tables.length === 0) {
      el.innerHTML = '<p class="no-tables">No tables available. Create one to get started!</p>';
      return;
    }
    el.innerHTML = tables.map(t => `
      <div class="poker-table-card" data-table-id="${t.tableId}">
        <div class="ptc-header">
          <h4>${this.esc(t.tableName)}</h4>
          <span class="ptc-status ${t.gameState}">${t.gameState === 'waiting' ? 'Open' : 'In Play'}</span>
        </div>
        <div class="ptc-stats">
          <div><span>Blinds</span><span>${t.smallBlind}/${t.bigBlind}</span></div>
          <div><span>Buy-In</span><span>${t.minBuyIn}-${t.maxBuyIn}</span></div>
          <div><span>Players</span><span>${t.playerCount}/${t.maxPlayers}</span></div>
        </div>
        <button class="btn btn-primary btn-full btn-join-table" data-table-id="${t.tableId}">Join Table</button>
      </div>
    `).join('');
    el.querySelectorAll('.btn-join-table').forEach(b => b.addEventListener('click', e => {
      const table = tables.find(t => t.tableId === e.target.dataset.tableId);
      if (table) this.showJoinTableModal(table);
    }));
  }

  showJoinTableModal(table) {
    this.selectedTable = table;
    document.getElementById('joinTableTitle').textContent = `Join ${table.tableName}`;
    document.getElementById('joinTableInfo').innerHTML = `
      <div><span>Blinds:</span><strong>${table.smallBlind}/${table.bigBlind}</strong></div>
      <div><span>Buy-In:</span><strong>${table.minBuyIn} - ${table.maxBuyIn}</strong></div>
      <div><span>Players:</span><strong>${table.playerCount}/${table.maxPlayers}</strong></div>
    `;
    const inp = document.getElementById('buyInInput');
    inp.min = table.minBuyIn; inp.max = table.maxBuyIn; inp.value = table.minBuyIn;
    document.getElementById('joinTableModal').classList.remove('hidden');
  }

  confirmJoinTable() {
    if (!this.selectedTable) return;
    const buyIn = parseInt(document.getElementById('buyInInput').value);
    if (buyIn < this.selectedTable.minBuyIn || buyIn > this.selectedTable.maxBuyIn) {
      alert(`Buy-in must be between ${this.selectedTable.minBuyIn} and ${this.selectedTable.maxBuyIn}`);
      return;
    }
    this.joinTable(this.selectedTable.tableId, buyIn, null);
    document.getElementById('joinTableModal').classList.add('hidden');
  }

  createTable() {
    const name = document.getElementById('tableNameInput').value.trim() || 'My Table';
    const sb = parseInt(document.getElementById('smallBlindInput').value) || 10;
    const bb = parseInt(document.getElementById('bigBlindInput').value) || 20;
    const minB = parseInt(document.getElementById('minBuyInInput').value) || 400;
    const maxB = parseInt(document.getElementById('maxBuyInInput').value) || 2000;
    const priv = document.getElementById('privateTableCheckbox').checked;
    if (bb !== sb * 2) { alert('Big blind must be 2x the small blind'); return; }
    this.pendingTableCreation = { minBuyIn: minB };
    this.socket.emit('createPokerTable', { tableName: name, smallBlind: sb, bigBlind: bb, minBuyIn: minB, maxBuyIn: maxB, isPrivate: priv });
    document.getElementById('createTableModal').classList.add('hidden');
  }

  joinTable(tableId, buyIn) {
    this.currentTableId = tableId;
    if (buyIn !== null) this.socket.emit('joinPokerTable', { tableId, buyIn, seat: null });
  }

  leaveTable() {
    if (!this.currentTableId) return;
    this.socket.emit('leavePokerTable', { tableId: this.currentTableId });
    this.currentTableId = null; this.mySeat = null;
    document.getElementById('pokerLobby')?.classList.remove('hidden');
    document.getElementById('pokerTable')?.classList.add('hidden');
    this.socket.emit('joinPokerLobby');
  }

  startHand() { if (this.currentTableId) this.socket.emit('startPokerHand', { tableId: this.currentTableId }); }

  pokerAction(action, amount) {
    if (!this.currentTableId) return;
    this.socket.emit('pokerAction', { tableId: this.currentTableId, action, amount: amount || 0 });
    document.getElementById('betControls')?.classList.add('hidden');
  }

  showBetControls() {
    document.getElementById('betControls')?.classList.remove('hidden');
    if (!this.tableState?.currentHand) return;
    const hand = this.tableState.currentHand;
    const myP = hand.players.find(p => p.socketId === this.socket?.id);
    if (!myP) return;
    const minBet = hand.currentBet > 0 ? hand.currentBet * 2 : (this.tableState.bigBlind || 20);
    const maxBet = myP.chips + (myP.totalBetThisRound || 0);
    const sl = document.getElementById('betSlider'), inp = document.getElementById('betAmountInput');
    if (sl) { sl.min = minBet; sl.max = maxBet; sl.value = minBet; }
    if (inp) inp.value = minBet;
  }

  setBetPreset(preset) {
    if (!this.tableState?.currentHand) return;
    const hand = this.tableState.currentHand;
    const myP = hand.players.find(p => p.socketId === this.socket?.id);
    if (!myP) return;
    const maxBet = myP.chips + (myP.totalBetThisRound || 0);
    const minBet = hand.currentBet > 0 ? hand.currentBet * 2 : (this.tableState.bigBlind || 20);
    let amt = minBet;
    if (preset === 'half') amt = Math.max(Math.floor(hand.pot / 2), minBet);
    else if (preset === 'pot') amt = Math.max(hand.pot, minBet);
    else if (preset === 'max') amt = maxBet;
    amt = Math.min(amt, maxBet);
    document.getElementById('betSlider').value = amt;
    document.getElementById('betAmountInput').value = amt;
  }

  sendChatMessage() {
    if (!this.currentTableId) return;
    const inp = document.getElementById('chatInput');
    const msg = inp.value.trim(); if (!msg) return;
    this.socket.emit('pokerChat', { tableId: this.currentTableId, message: msg });
    inp.value = '';
  }

  addChatMessage(username, message) {
    const el = document.getElementById('chatMessages');
    if (!el) return;
    const d = document.createElement('div'); d.className = 'poker-chat-msg';
    d.innerHTML = `<strong>${this.esc(username)}:</strong> ${this.esc(message)}`;
    el.appendChild(d); el.scrollTop = el.scrollHeight;
    while (el.children.length > 100) el.removeChild(el.firstChild);
  }

  // ---- Render Table ----

  renderTable(state) {
    if (!state) return;
    document.getElementById('tableNameDisplay').textContent = state.tableName;
    document.getElementById('blindsDisplay').textContent = `${state.smallBlind}/${state.bigBlind}`;

    // Find my seat
    this.mySeat = null;
    const myInfo = state.players.find(p => p.socketId === this.socket?.id);
    if (myInfo) this.mySeat = myInfo.seat;

    // Render each seat
    for (let i = 0; i < 6; i++) {
      const seatEl = document.querySelector(`.poker-seat.seat-${i}`);
      if (!seatEl) continue;
      const sd = state.seats[i];
      const hand = state.currentHand;
      const hp = hand ? hand.players.find(p => p.seat === i) : null;

      // Reset classes
      seatEl.className = `poker-seat seat-${i}`;
      if (!sd) {
        seatEl.classList.add('empty');
        seatEl.querySelector('.seat-name').textContent = `Seat ${i+1}`;
        seatEl.querySelector('.seat-chips').textContent = '';
        seatEl.querySelector('.seat-cards').innerHTML = '';
        seatEl.querySelector('.seat-badge-row').innerHTML = '';
        seatEl.querySelector('.seat-bet-chip').innerHTML = '';
        continue;
      }

      seatEl.classList.add('occupied');
      if (this.mySeat === i) seatEl.classList.add('is-me');
      if (hp?.isFolded) seatEl.classList.add('folded');
      if (hp?.isAllIn) seatEl.classList.add('all-in');

      // Active turn
      if (hand && hand.currentPlayerIndex !== undefined) {
        const curP = hand.players[hand.currentPlayerIndex];
        if (curP?.seat === i) seatEl.classList.add('active-turn');
      }

      seatEl.querySelector('.seat-name').textContent = sd.username;
      seatEl.querySelector('.seat-chips').textContent = `💰 ${sd.chips}`;

      // Badges (D, SB, BB)
      let badges = '';
      if (hand) {
        const dp = hand.players[hand.dealerPosition];
        const sbp = hand.players[hand.smallBlindPosition];
        const bbp = hand.players[hand.bigBlindPosition];
        if (dp?.seat === i) badges += '<span class="badge badge-d">D</span>';
        if (sbp?.seat === i) badges += '<span class="badge badge-sb">SB</span>';
        if (bbp?.seat === i) badges += '<span class="badge badge-bb">BB</span>';
      }
      seatEl.querySelector('.seat-badge-row').innerHTML = badges;

      // Bet chip
      const betAmt = sd.betAmount || 0;
      seatEl.querySelector('.seat-bet-chip').innerHTML = betAmt > 0
        ? `<div class="chip-bet"><span class="chip-icon"></span>${betAmt}</div>` : '';

      // Cards
      this.renderSeatCards(seatEl, hp, i, state.gameState);
    }

    // Community cards & pot
    if (state.currentHand) {
      document.getElementById('potAmount').textContent = state.currentHand.pot;
      this.renderCommunityCards(state.currentHand.communityCards || []);
      this.updateActionControls(state);
    } else {
      document.getElementById('potAmount').textContent = '0';
      document.getElementById('communityCards').innerHTML = this.renderPlaceholderCards(5);
      document.getElementById('pokerActions')?.classList.add('hidden');
      document.getElementById('betControls')?.classList.add('hidden');
    }

    // Winner
    this.renderWinners(state);

    // Game status
    if (state.currentHand && state.gameState !== 'showdown') {
      document.getElementById('gameStatus')?.classList.add('hidden');
    } else if (state.gameState === 'showdown') {
      document.getElementById('gameStatus')?.classList.add('hidden');
    } else {
      document.getElementById('gameStatus')?.classList.remove('hidden');
      const active = state.players.filter(p => p.isActive);
      if (active.length >= 2) {
        document.getElementById('startHandBtn')?.classList.remove('hidden');
        document.getElementById('statusMessage').textContent = `${active.length} players ready — click Deal Cards!`;
      } else {
        document.getElementById('startHandBtn')?.classList.add('hidden');
        document.getElementById('statusMessage').textContent = `Waiting for players... (${active.length}/2 minimum)`;
      }
    }
  }

  // ---- Card Rendering ----

  renderSeatCards(seatEl, hp, seatIdx, gameState) {
    const container = seatEl.querySelector('.seat-cards');
    if (!hp || !hp.cards || hp.cards.length === 0) { container.innerHTML = ''; return; }

    const isMe = this.mySeat === seatIdx;
    const isShowdown = gameState === 'showdown';
    let html = '';
    for (const card of hp.cards) {
      if (card === '??' || card === '?') {
        html += this.cardBackHTML();
      } else if (isMe || (isShowdown && !hp.isFolded)) {
        html += this.cardHTML(card, isMe);
      } else {
        html += this.cardBackHTML();
      }
    }
    // Hand label at showdown
    if (isShowdown && hp.handResult && !hp.isFolded) {
      html += `<div class="hand-label">${hp.handResult.name}</div>`;
    }
    container.innerHTML = html;
  }

  cardHTML(cardStr, highlight) {
    if (!cardStr || cardStr.length < 2) return '';
    const r = cardStr[0], s = cardStr[1];
    const rankMap = {'2':'2','3':'3','4':'4','5':'5','6':'6','7':'7','8':'8','9':'9','T':'10','J':'J','Q':'Q','K':'K','A':'A'};
    const suitMap = {'h':'♥','d':'♦','c':'♣','s':'♠'};
    const color = (s === 'h' || s === 'd') ? 'red' : 'black';
    const cls = `playing-card ${color}${highlight ? ' my-card' : ''}`;
    return `<div class="${cls}">
      <div class="card-corner card-tl"><span class="card-rank">${rankMap[r]||r}</span><span class="card-suit-sm">${suitMap[s]||s}</span></div>
      <div class="card-center-suit">${suitMap[s]||s}</div>
      <div class="card-corner card-br"><span class="card-rank">${rankMap[r]||r}</span><span class="card-suit-sm">${suitMap[s]||s}</span></div>
    </div>`;
  }

  cardBackHTML() {
    return `<div class="playing-card card-back"><div class="card-back-pattern"></div></div>`;
  }

  renderPlaceholderCards(n) {
    let html = '';
    for (let i = 0; i < n; i++) html += '<div class="playing-card card-placeholder"></div>';
    return html;
  }

  renderCommunityCards(cards) {
    const el = document.getElementById('communityCards');
    if (!el) return;
    let html = '';
    for (let i = 0; i < 5; i++) {
      if (i < cards.length) html += this.cardHTML(cards[i], false);
      else html += '<div class="playing-card card-placeholder"></div>';
    }
    el.innerHTML = html;
  }

  renderWinners(state) {
    const el = document.getElementById('winnerAnnouncement');
    if (!el) return;
    if (state.gameState === 'showdown' && state.currentHand?.winners) {
      el.innerHTML = state.currentHand.winners.map(w =>
        `<div class="winner-line">🏆 <strong>${this.esc(w.username)}</strong> wins ${w.amount} — ${w.handName}</div>`
      ).join('');
      el.classList.remove('hidden');
    } else {
      el.classList.add('hidden'); el.innerHTML = '';
    }
  }

  updateActionControls(state) {
    const hand = state?.currentHand;
    if (!hand) { document.getElementById('pokerActions')?.classList.add('hidden'); return; }
    const myP = hand.players.find(p => p.socketId === this.socket?.id);
    if (!myP || myP.isFolded || myP.isAllIn) { document.getElementById('pokerActions')?.classList.add('hidden'); return; }
    const isMyTurn = hand.currentPlayerIndex !== undefined && hand.players[hand.currentPlayerIndex]?.socketId === this.socket?.id;
    if (!isMyTurn) { document.getElementById('pokerActions')?.classList.add('hidden'); return; }

    document.getElementById('pokerActions')?.classList.remove('hidden');
    document.getElementById('betControls')?.classList.add('hidden');
    const toCall = hand.currentBet - (myP.totalBetThisRound || 0);
    document.getElementById('checkBtn')?.classList.toggle('hidden', toCall > 0);
    document.getElementById('callBtn')?.classList.toggle('hidden', toCall <= 0);
    if (toCall > 0) document.getElementById('callAmount').textContent = Math.min(toCall, myP.chips);
    document.getElementById('betBtn')?.classList.toggle('hidden', hand.currentBet > 0);
    document.getElementById('raiseBtn')?.classList.toggle('hidden', hand.currentBet === 0 || myP.chips <= toCall);
    document.getElementById('currentBetInfo').textContent =
      `Bet: ${hand.currentBet} · Your bet: ${myP.totalBetThisRound||0} · Chips: ${myP.chips}`;
  }

  esc(t) { const d = document.createElement('div'); d.textContent = t; return d.innerHTML; }

  destroy() {
    this._destroyed = true;
    if (this.socket) for (const {evt,fn} of this._socketListeners) this.socket.off(evt, fn);
    this._socketListeners = [];
    if (this.currentTableId && this.socket) this.socket.emit('leavePokerTable', { tableId: this.currentTableId });
    this.currentTableId = null; this.mySeat = null;
  }
}

window.PokerGame = PokerGame;
