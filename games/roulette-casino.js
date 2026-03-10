// Roulette Game — Flat Modern Design (Belt-style, CSGOEmpire/Stake inspired)

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
    this.wheelAnimationComplete = false;
    this.pendingResult = null;

    // Belt config
    this.CHIP_W = 96;    // updated after first build by measuring real DOM width
    this.TOTAL_CHIPS = 45; // 3 full cycles of 15 numbers (0-14)
    // TARGET_IDX is dynamic: winningNumber + 30 always lands on the correct chip

    this.init();
  }

  getNumberColor(num) {
    if (num === 0) return 'green';
    return num % 2 === 1 ? 'red' : 'black';
  }

  init() {
    const gameView = document.getElementById('rouletteGame');
    gameView.innerHTML = `
      <div class="rl-container">

        <!-- Belt Spinner -->
        <div class="rl-belt-section">
          <div class="rl-belt-wrapper" id="rlBeltWrapper">
            <div class="rl-belt-track" id="rlBeltTrack"></div>
            <div class="rl-belt-indicator"></div>
            <div class="rl-belt-fade rl-fade-l"></div>
            <div class="rl-belt-fade rl-fade-r"></div>
          </div>
        </div>

        <!-- Status Row -->
        <div class="rl-status-row">
          <div class="rl-last-result" id="rlLastResult">Waiting for first spin…</div>
          <div class="rl-countdown" id="rlCountdown"></div>
        </div>

        <!-- Main Grid -->
        <div class="rl-main-grid">

          <!-- Left: Betting -->
          <div class="rl-bet-panel">
            <div class="rl-panel-title">Place Your Bet</div>

            <div class="rl-amount-row">
              <button class="rl-adj-btn" id="rlHalf">½</button>
              <input type="number" id="rlBetAmount" min="1" value="100" step="10" class="rl-amount-input">
              <button class="rl-adj-btn" id="rlDouble">2×</button>
            </div>

            <div class="rl-quick-row">
              <button class="rl-quick-btn" data-amount="50">50</button>
              <button class="rl-quick-btn" data-amount="100">100</button>
              <button class="rl-quick-btn" data-amount="250">250</button>
              <button class="rl-quick-btn" data-amount="500">500</button>
              <button class="rl-quick-btn" data-amount="1000">1K</button>
            </div>

            <div class="rl-color-grid">
              <button id="rlBetRed" class="rl-color-btn rl-btn-red">
                <span class="rl-cname">Red</span>
                <span class="rl-codds">2×</span>
                <span class="rl-cnums">1 3 5 7 9 11 13</span>
              </button>
              <button id="rlBetBlack" class="rl-color-btn rl-btn-black">
                <span class="rl-cname">Black</span>
                <span class="rl-codds">2×</span>
                <span class="rl-cnums">2 4 6 8 10 12 14</span>
              </button>
              <button id="rlBetGreen" class="rl-color-btn rl-btn-green">
                <span class="rl-cname">Green</span>
                <span class="rl-codds">14×</span>
                <span class="rl-cnums">0 only</span>
              </button>
            </div>

            <div class="rl-active-bet" id="rlActiveBet">
              <span id="rlActiveBetText">No bet placed</span>
              <button id="rlClearBet" class="rl-clear-btn" disabled>✕ Clear</button>
            </div>
          </div>

          <!-- Right: Players + History -->
          <div class="rl-info-panel">
            <div class="rl-panel-title">This Round</div>
            <div id="rlAllBets" class="rl-players-list">
              <div class="rl-empty-msg">No bets yet</div>
            </div>

            <div class="rl-panel-title" style="margin-top:1rem">Recent Results</div>
            <div id="rlHistory" class="rl-history-strip">
              <div class="rl-empty-msg">No history</div>
            </div>
          </div>

        </div>
      </div>
    `;

    // Defer buildBelt so the DOM has fully painted before we measure/populate
    requestAnimationFrame(() => this.buildBelt());
    this.attachEventListeners();
    this.connectToServer();
  }

  // ─── Belt ───────────────────────────────────────────────────────

  buildBelt() {
    const track = document.getElementById('rlBeltTrack');
    if (!track) return;

    // Fixed repeating sequence: 0,1,2,...,14,0,1,2,...
    // This guarantees: green every 15 chips, strict G→R→B→R→B alternation, no adjacent same color
    track.innerHTML = Array.from({ length: this.TOTAL_CHIPS }, (_, i) => {
      const n = i % 15;
      const color = this.getNumberColor(n);
      return `<div class="rl-chip rl-chip-${color}" data-idx="${i}">${n}</div>`;
    }).join('');

    // Measure actual rendered chip width (handles responsive breakpoints)
    track.offsetHeight;
    const firstChip = track.querySelector('.rl-chip');
    if (firstChip) this.CHIP_W = firstChip.offsetWidth || this.CHIP_W;

    // Idle: show chips starting from 0 so green is immediately visible
    const wrapper = document.getElementById('rlBeltWrapper');
    const half = wrapper ? wrapper.offsetWidth / 2 : 400;
    const idleTX = half - (1 * this.CHIP_W + this.CHIP_W / 2); // chip 1 centred
    track.style.transition = 'none';
    track.style.transform = `translate3d(${idleTX}px, 0, 0)`;
    track.offsetHeight; // force reflow
  }

  animateBeltSpin(winningNumber) {
    const track = document.getElementById('rlBeltTrack');
    if (!track) { this.wheelAnimationComplete = true; return; }

    this.wheelAnimationComplete = false;

    // Rebuild the fixed belt, then compute the exact target chip.
    // winningNumber + 30 is guaranteed to be in range [30,44] for numbers 0-14,
    // and (winningNumber + 30) % 15 === winningNumber, so the chip at that index
    // always shows the correct number with the correct color — no adjacent conflicts.
    this.buildBelt();
    const targetIdx = winningNumber + 30;

    const wrapper = document.getElementById('rlBeltWrapper');
    const half = wrapper ? wrapper.offsetWidth / 2 : 400;
    const targetTX = half - (targetIdx * this.CHIP_W + this.CHIP_W / 2);

    setTimeout(() => {
      // Smooth deceleration: fast start, gentle ease-out landing
      track.style.transition = 'transform 4s cubic-bezier(0.0, 0.0, 0.15, 1.0)';
      track.style.transform = `translate3d(${targetTX}px, 0, 0)`;

      setTimeout(() => {
        this.wheelAnimationComplete = true;
        const winner = track.querySelector(`[data-idx="${targetIdx}"]`);
        if (winner) winner.classList.add('rl-chip-winner');
      }, 4200);
    }, 60);
  }

  // ─── Socket ─────────────────────────────────────────────────────

  connectToServer() {
    if (typeof io === 'undefined') {
      setTimeout(() => this.connectToServer(), 100);
      return;
    }

    this.socket = this.casino.getSocket();
    if (!this.socket) {
      try {
        const serverUrl = window.CASINO_SERVER_URL || window.location.origin;
        this.socket = io(serverUrl, {
          reconnection: true,
          reconnectionDelay: 1000,
          reconnectionAttempts: 5,
          timeout: 20000
        });
      } catch (err) {
        console.error('Roulette socket error:', err);
        return;
      }
    }

    this.setupSocketListeners();

    if (this.socket.connected) {
      setTimeout(() => {
        if (this.socket?.connected && this.casino.username) {
          this.socket.emit('joinCasino', { username: this.casino.username });
        }
      }, 100);
    }
  }

  setupSocketListeners() {
    if (!this.socket) return;

    this.socket.removeAllListeners('rouletteState');
    this.socket.removeAllListeners('rouletteBetsUpdate');
    this.socket.removeAllListeners('rouletteSpinStart');
    this.socket.removeAllListeners('rouletteSpinResult');
    this.socket.removeAllListeners('nextSpinTime');

    this.socket.on('rouletteState', (state) => {
      this.allBets = state.currentBets || {};
      this.nextSpinTime = state.nextSpinTime;
      this.history = state.history || [];
      this.updateAllBetsDisplay();
      this.updateCountdown();
      this.updateHistoryDisplay();
      if (state.lastResult) this.showLastResult(state.lastResult);
      if (state.spinning) this.spinning = true;
    });

    this.socket.on('rouletteBetsUpdate', ({ bets }) => {
      this.allBets = bets;
      this.updateAllBetsDisplay();
    });

    this.socket.on('rouletteSpinStart', ({ winningNumber, winningColor, bets }) => {
      this.spinning = true;
      this.allBets = bets;
      this.updateAllBetsDisplay();
      const cd = document.getElementById('rlCountdown');
      if (cd) cd.textContent = 'Spinning…';
      this.animateBeltSpin(winningNumber);
    });

    this.socket.on('rouletteSpinResult', ({ winningNumber, winningColor, results, bets, history }) => {
      this.pendingResult = { winningNumber, winningColor, results, bets };
      if (history) {
        this.history = history;
        this.updateHistoryDisplay();
      }
      const check = () => {
        if (this.wheelAnimationComplete) {
          this.spinning = false;
          this.allBets = {};
          this.updateAllBetsDisplay();
          this.showResult(winningNumber, winningColor, results);

          const pid = this.socket.id;
          if (results[pid]) {
            const bet = results[pid].bet;
            if (bet) {
              const payout = results[pid].won ? results[pid].winnings : 0;
              const mult = bet.color === 'green' ? 14 : 2;
              this.casino.recordBet(
                'roulette', bet.amount,
                results[pid].won ? 'Win' : 'Loss',
                payout,
                results[pid].won ? mult : 0,
                `${bet.color} → ${winningColor}`
              );
            }
            this.currentBet = null;
            this.updateCurrentBetDisplay();
          }
        } else {
          setTimeout(check, 100);
        }
      };
      check();
    });

    this.socket.on('nextSpinTime', ({ time }) => {
      this.nextSpinTime = time;
      this.updateCountdown();
    });
  }

  // ─── Event Listeners ────────────────────────────────────────────

  attachEventListeners() {
    document.getElementById('rlHalf')?.addEventListener('click', () => {
      const inp = document.getElementById('rlBetAmount');
      inp.value = Math.max(1, Math.floor(parseInt(inp.value || 0) / 2));
    });

    document.getElementById('rlDouble')?.addEventListener('click', () => {
      const inp = document.getElementById('rlBetAmount');
      inp.value = Math.min(this.casino.credits, parseInt(inp.value || 0) * 2);
    });

    document.querySelectorAll('.rl-quick-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.getElementById('rlBetAmount').value = btn.dataset.amount;
      });
    });

    document.getElementById('rlBetRed')?.addEventListener('click', () => this.placeBet('red'));
    document.getElementById('rlBetBlack')?.addEventListener('click', () => this.placeBet('black'));
    document.getElementById('rlBetGreen')?.addEventListener('click', () => this.placeBet('green'));
    document.getElementById('rlClearBet')?.addEventListener('click', () => this.clearBet());
  }

  // ─── Bet Logic ──────────────────────────────────────────────────

  placeBet(color) {
    try {
      if (this.casino?.setBetPlacementInProgress) this.casino.setBetPlacementInProgress(true);

      if (this.spinning) { this.showMsg('Wait for the spin to finish', 'error'); return; }
      if (this.currentBet) { this.showMsg('Clear your current bet first', 'error'); return; }

      const amount = parseInt(document.getElementById('rlBetAmount').value);
      if (!amount || amount < 1) { this.showMsg('Enter a valid bet amount', 'error'); return; }
      if (amount > this.casino.credits) { this.showMsg('Insufficient credits', 'error'); return; }

      this.currentBet = { color, amount };
      this.socket.emit('placeRouletteBet', { color, amount });
      this.updateCurrentBetDisplay();

      // Highlight the selected button
      document.querySelectorAll('.rl-color-btn').forEach(b => b.classList.remove('rl-btn-active'));
      const map = { red: 'rlBetRed', black: 'rlBetBlack', green: 'rlBetGreen' };
      document.getElementById(map[color])?.classList.add('rl-btn-active');

      setTimeout(() => {
        if (this.casino?.setBetPlacementInProgress) this.casino.setBetPlacementInProgress(false);
      }, 1000);
    } catch (err) {
      if (this.casino?.setBetPlacementInProgress) this.casino.setBetPlacementInProgress(false);
      console.error('[Roulette] placeBet error:', err);
    }
  }

  clearBet() {
    if (this.spinning) { this.showMsg('Cannot clear while spinning', 'error'); return; }
    if (this.currentBet) {
      this.socket.emit('clearRouletteBet');
      this.currentBet = null;
      this.updateCurrentBetDisplay();
      document.querySelectorAll('.rl-color-btn').forEach(b => b.classList.remove('rl-btn-active'));
    }
  }

  // ─── UI Updates ─────────────────────────────────────────────────

  updateCurrentBetDisplay() {
    const text = document.getElementById('rlActiveBetText');
    const btn = document.getElementById('rlClearBet');
    const wrap = document.getElementById('rlActiveBet');

    if (this.currentBet) {
      text.textContent = `${this.currentBet.color.toUpperCase()} — ${this.currentBet.amount.toLocaleString()} credits`;
      btn.disabled = false;
      wrap.classList.add('rl-has-bet', `rl-bet-${this.currentBet.color}`);
    } else {
      text.textContent = 'No bet placed';
      btn.disabled = true;
      wrap.className = 'rl-active-bet';
    }
  }

  updateAllBetsDisplay() {
    const el = document.getElementById('rlAllBets');
    if (!el) return;
    const bets = Object.values(this.allBets);
    if (bets.length === 0) {
      el.innerHTML = '<div class="rl-empty-msg">No bets yet</div>';
      return;
    }
    el.innerHTML = bets.map(bet => `
      <div class="rl-player-row">
        <span class="rl-dot rl-dot-${bet.color}"></span>
        <span class="rl-pname">${bet.playerName}</span>
        <span class="rl-pamt">${bet.amount.toLocaleString()}</span>
      </div>
    `).join('');
  }

  showResult(winningNumber, winningColor, results) {
    const el = document.getElementById('rlLastResult');
    const pid = this.socket.id;
    const pr = results[pid];

    let html = `
      <span class="rl-res-chip rl-res-${winningColor}">${winningNumber}</span>
      <span class="rl-res-label">${winningColor.toUpperCase()}</span>
    `;

    if (pr) {
      html += pr.won
        ? `<span class="rl-res-win">+${pr.winnings.toLocaleString()} credits 🎉</span>`
        : `<span class="rl-res-loss">Better luck next round</span>`;
    }

    if (el) el.innerHTML = html;
  }

  showLastResult(result) {
    const el = document.getElementById('rlLastResult');
    if (el) {
      el.innerHTML = `
        <span class="rl-res-label">Last:</span>
        <span class="rl-res-chip rl-res-${result.color}">${result.number}</span>
        <span class="rl-res-label">${result.color.toUpperCase()}</span>
      `;
    }
  }

  updateCountdown() {
    if (this.timerInterval) {
      clearInterval(this.timerInterval);
      this.timerInterval = null;
    }
    if (!this.nextSpinTime) return;

    const el = document.getElementById('rlCountdown');
    const tick = () => {
      const left = Math.max(0, Math.floor((this.nextSpinTime - Date.now()) / 1000));
      if (el) el.textContent = left > 0 ? `Next spin in ${left}s` : 'Spinning…';
      if (left <= 0) { clearInterval(this.timerInterval); this.timerInterval = null; }
    };
    tick();
    this.timerInterval = setInterval(tick, 1000);
  }

  updateHistoryDisplay() {
    const el = document.getElementById('rlHistory');
    if (!el) return;
    if (!this.history?.length) {
      el.innerHTML = '<div class="rl-empty-msg">No history</div>';
      return;
    }
    el.innerHTML = [...this.history].reverse().slice(0, 30).map(r => `
      <div class="rl-hist-chip rl-hist-${r.color}" title="${r.number} (${r.color})">${r.number}</div>
    `).join('');
  }

  showMsg(msg, type) {
    const el = document.getElementById('rlActiveBetText');
    if (!el) return;
    const orig = el.textContent;
    el.textContent = msg;
    el.style.color = type === 'error' ? '#ff5555' : '#22c55e';
    setTimeout(() => { el.textContent = orig; el.style.color = ''; }, 2000);
  }

  // ─── Cleanup ────────────────────────────────────────────────────

  destroy() {
    if (this.timerInterval) { clearInterval(this.timerInterval); this.timerInterval = null; }
    if (this.socket) {
      ['rouletteState', 'rouletteBetsUpdate', 'rouletteSpinStart', 'rouletteSpinResult', 'nextSpinTime']
        .forEach(ev => this.socket.removeAllListeners(ev));
    }
    if (this.currentBet && this.socket?.connected) this.socket.emit('clearRouletteBet');
  }
}

window.RouletteGame = RouletteGame;
