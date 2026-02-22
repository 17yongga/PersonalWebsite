// Crash Game — Multiplier climbs, cash out before it crashes!

class CrashGame {
  constructor(casinoManager) {
    this.casino = casinoManager;
    this.socket = null;
    this.canvas = null;
    this.ctx = null;
    this.phase = 'waiting'; // waiting, betting, running, crashed
    this.multiplier = 1.00;
    this.myBet = null;
    this.myCashedOut = false;
    this.autoCashout = 0;
    this.history = [];
    this.liveFeed = [];
    this.bettingTimeLeft = 0;
    this.curvePoints = [];
    this.animFrame = null;
    this.startTime = 0;
    this._destroyed = false;
    this._listeners = [];
    this.init();
  }

  init() {
    const gv = document.getElementById('crashGame');
    gv.innerHTML = `
      <div class="crash-container">
        <h2 class="game-title">🚀 Crash</h2>
        <div class="crash-layout">
          <div class="crash-main">
            <div class="crash-canvas-wrap">
              <canvas id="crashCanvas" width="700" height="360"></canvas>
              <div id="crashMultiplier" class="crash-multiplier">1.00x</div>
              <div id="crashStatus" class="crash-status"></div>
            </div>
            <div id="crashHistory" class="crash-history"></div>
          </div>
          <div class="crash-sidebar">
            <div class="crash-bet-section">
              <h3>Place Your Bet</h3>
              <div class="crash-bet-group">
                <label>Bet Amount</label>
                <input type="number" id="crashBetAmount" value="100" min="1" step="10">
                <div class="crash-quick-bets">
                  <button class="cqb" data-amt="50">50</button>
                  <button class="cqb" data-amt="100">100</button>
                  <button class="cqb" data-amt="250">250</button>
                  <button class="cqb" data-amt="500">500</button>
                </div>
              </div>
              <div class="crash-bet-group">
                <label>Auto Cash-Out (0 = off)</label>
                <input type="number" id="crashAutoCashout" value="0" min="0" step="0.1">
              </div>
              <button id="crashBetBtn" class="btn btn-primary btn-full">Place Bet</button>
              <button id="crashCashoutBtn" class="btn btn-full crash-cashout-btn hidden">Cash Out</button>
              <p id="crashBetStatus" class="crash-bet-status"></p>
            </div>
            <div class="crash-feed-section">
              <h3>Live Feed</h3>
              <div id="crashFeed" class="crash-feed"></div>
            </div>
          </div>
        </div>
      </div>
    `;

    this.canvas = document.getElementById('crashCanvas');
    this.ctx = this.canvas.getContext('2d');
    this.attachEvents();
    this.connectSocket();
    this.resizeCanvas();
    window.addEventListener('resize', () => this.resizeCanvas());
  }

  resizeCanvas() {
    const wrap = this.canvas?.parentElement;
    if (!wrap || !this.canvas) return;
    
    // Better mobile responsive sizing
    const isMobile = window.innerWidth <= 768;
    const w = isMobile ? Math.min(wrap.clientWidth - 20, 600) : Math.min(wrap.clientWidth, 700);
    
    const dpr = window.devicePixelRatio || 1;
    this.canvas.width = w * dpr;
    this.canvas.height = Math.floor(w * 0.52) * dpr;
    this.canvas.style.width = w + 'px';
    this.canvas.style.height = Math.floor(w * 0.52) + 'px';
    
    // Reset transform and apply DPR scaling
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.drawFrame();
  }

  connectSocket() {
    this.socket = this.casino.getSocket();
    if (!this.socket) return;
    this.setupListeners();
    if (this.socket.connected) this.socket.emit('joinCrash');
  }

  _on(e, fn) { this.socket.on(e, fn); this._listeners.push({e, fn}); }

  setupListeners() {
    if (!this.socket) return;
    for (const {e, fn} of this._listeners) this.socket.off(e, fn);
    this._listeners = [];

    this._on('connect', () => { if (!this._destroyed) this.socket.emit('joinCrash'); });

    this._on('crashState', (data) => {
      if (this._destroyed) return;
      this.phase = data.phase;
      this.multiplier = data.multiplier || 1.00;
      this.history = data.history || [];
      this.bettingTimeLeft = data.bettingTimeLeft || 0;
      this.startTime = data.startTime || Date.now();
      if (data.bets) this.liveFeed = Object.values(data.bets).filter(b => b.cashedOut).map(b => ({
        username: b.username, multiplier: b.cashoutMultiplier, amount: b.amount
      }));
      this.updateUI();
      this.renderHistory();
      if (this.phase === 'running') this.startAnimation();
      else this.drawFrame();
    });

    this._on('crashTick', (data) => {
      if (this._destroyed) return;
      this.multiplier = data.multiplier;
      this.phase = 'running';
      // Check auto-cashout
      if (this.myBet && !this.myCashedOut && this.autoCashout > 0 && this.multiplier >= this.autoCashout) {
        this.doCashout();
      }
      this.updateMultiplierDisplay();
      // Update cashout button with live amount
      if (this.myBet && !this.myCashedOut) {
        const cashBtn = document.getElementById('crashCashoutBtn');
        if (cashBtn && !cashBtn.classList.contains('hidden')) {
          const potentialWin = Math.floor(this.myBet * this.multiplier);
          cashBtn.textContent = `Cash Out $${potentialWin} (${this.multiplier.toFixed(2)}x)`;
        }
      }
    });

    this._on('crashResult', (data) => {
      if (this._destroyed) return;
      this.phase = 'crashed';
      this.multiplier = data.crashPoint;
      this.history = data.history || this.history;
      // Check if I lost
      if (this.myBet && !this.myCashedOut) {
        this.setBetStatus(`💥 Crashed at ${data.crashPoint.toFixed(2)}x — You lost ${this.myBet}!`, 'loss');
        this.casino.recordBet('crash', this.myBet, 'Crashed', 0, data.crashPoint);
        
        // Send stats tracking for crashed bet
        if (this.casino.socket) {
          this.casino.socket.emit('gameResult', {
            gameType: 'crash',
            betAmount: this.myBet,
            won: false,
            payout: 0,
            result: {
              crashPoint: data.crashPoint,
              cashedOut: false
            }
          });
        }
      }
      this.myBet = null;
      this.myCashedOut = false;
      this.updateUI();
      this.renderHistory();
      this.drawFrame();
    });

    this._on('crashBettingStart', (data) => {
      if (this._destroyed) return;
      this.phase = 'betting';
      this.multiplier = 1.00;
      this.bettingTimeLeft = data.timeLeft || 10;
      this.liveFeed = [];
      this.curvePoints = [];
      this.myBet = null;
      this.myCashedOut = false;
      this.updateUI();
      this.drawFrame();
      this.startBettingCountdown(data.timeLeft || 10);
    });

    this._on('crashBetPlaced', (data) => {
      if (this._destroyed) return;
      if (data.success) {
        this.myBet = data.amount;
        // Server already deducted — only update display locally
        this.casino.updateCreditsLocal(-data.amount);
        this.setBetStatus(`Bet placed: ${data.amount} credits`, 'ok');
      } else {
        this.setBetStatus(data.error || 'Bet failed', 'err');
      }
      this.updateUI();
    });

    this._on('crashCashedOut', (data) => {
      if (this._destroyed) return;
      if (data.socketId === this.socket.id) {
        this.myCashedOut = true;
        const winnings = data.winnings;
        // Don't touch credits here — server's playerData event sets the correct absolute balance
        this.casino.recordBet('crash', data.amount, 'Cash Out', winnings, data.multiplier);
        this.setBetStatus(`✅ Cashed out at ${data.multiplier.toFixed(2)}x — Won ${winnings}!`, 'win');
        
        // Send stats tracking for successful cashout
        if (this.casino.socket) {
          this.casino.socket.emit('gameResult', {
            gameType: 'crash',
            betAmount: data.amount,
            won: true,
            payout: winnings,
            result: {
              multiplier: data.multiplier,
              cashedOut: true
            }
          });
        }
        
        this.updateUI();
      }
      this.liveFeed.unshift({ username: data.username, multiplier: data.multiplier, amount: data.amount });
      if (this.liveFeed.length > 20) this.liveFeed.pop();
      this.renderFeed();
    });

    this._on('crashBettingTick', (data) => {
      if (this._destroyed) return;
      this.bettingTimeLeft = data.timeLeft;
      this.updateStatusText();
    });
  }

  attachEvents() {
    document.querySelectorAll('.cqb').forEach(b => b.addEventListener('click', e => {
      document.getElementById('crashBetAmount').value = e.target.dataset.amt;
    }));
    document.getElementById('crashBetBtn')?.addEventListener('click', () => this.placeBet());
    document.getElementById('crashCashoutBtn')?.addEventListener('click', () => this.doCashout());
  }

  placeBet() {
    const amount = parseInt(document.getElementById('crashBetAmount').value) || 0;
    const auto = parseFloat(document.getElementById('crashAutoCashout').value) || 0;
    if (amount <= 0) return;
    this.autoCashout = auto;
    this.socket.emit('placeCrashBet', { amount, autoCashout: auto });
  }

  doCashout() {
    if (!this.myBet || this.myCashedOut) return;
    this.socket.emit('crashCashOut');
  }

  setBetStatus(msg, type) {
    const el = document.getElementById('crashBetStatus');
    if (!el) return;
    el.textContent = msg;
    el.className = 'crash-bet-status ' + (type || '');
  }

  updateUI() {
    const betBtn = document.getElementById('crashBetBtn');
    const cashBtn = document.getElementById('crashCashoutBtn');
    if (this.phase === 'betting' && !this.myBet) {
      betBtn?.classList.remove('hidden');
      cashBtn?.classList.add('hidden');
    } else if (this.phase === 'running' && this.myBet && !this.myCashedOut) {
      betBtn?.classList.add('hidden');
      cashBtn?.classList.remove('hidden');
      // Update cashout button text with live amount
      const potentialWin = Math.floor(this.myBet * this.multiplier);
      cashBtn.textContent = `Cash Out $${potentialWin} (${this.multiplier.toFixed(2)}x)`;
    } else {
      betBtn?.classList.add('hidden');
      cashBtn?.classList.add('hidden');
    }
    this.updateMultiplierDisplay();
    this.updateStatusText();
    this.renderFeed();
  }

  updateMultiplierDisplay() {
    const el = document.getElementById('crashMultiplier');
    if (!el) return;
    if (this.phase === 'betting') {
      el.textContent = 'NEXT ROUND';
      el.className = 'crash-multiplier betting-label';
    } else {
      el.textContent = this.multiplier.toFixed(2) + 'x';
      if (this.phase === 'crashed') {
        el.className = 'crash-multiplier crashed';
      } else if (this.phase === 'running') {
        el.className = 'crash-multiplier running';
      } else {
        el.className = 'crash-multiplier';
      }
    }
  }

  updateStatusText() {
    const el = document.getElementById('crashStatus');
    if (!el) return;
    if (this.phase === 'betting') {
      el.textContent = `Starting in ${Math.ceil(this.bettingTimeLeft)}s — Place your bets!`;
      el.className = 'crash-status betting';
      el.style.display = '';
    } else if (this.phase === 'running') {
      el.textContent = '';
      el.className = 'crash-status';
      el.style.display = 'none';
    } else if (this.phase === 'crashed') {
      el.textContent = `Crashed @ ${this.multiplier.toFixed(2)}x`;
      el.className = 'crash-status crashed';
      el.style.display = '';
    } else {
      el.textContent = 'Waiting for next round...';
      el.className = 'crash-status';
      el.style.display = '';
    }
  }

  startBettingCountdown(seconds) {
    this.bettingTimeLeft = seconds;
    if (this._bettingInterval) clearInterval(this._bettingInterval);
    this._bettingInterval = setInterval(() => {
      this.bettingTimeLeft -= 0.1;
      if (this.bettingTimeLeft <= 0) { clearInterval(this._bettingInterval); this.bettingTimeLeft = 0; }
      this.updateStatusText();
    }, 100);
  }

  // ---- Canvas Drawing ----

  startAnimation() {
    this.curvePoints = [];
    this.startTime = Date.now();
    const animate = () => {
      if (this._destroyed || this.phase !== 'running') return;
      this.drawFrame();
      this.animFrame = requestAnimationFrame(animate);
    };
    if (this.animFrame) cancelAnimationFrame(this.animFrame);
    animate();
  }

  drawFrame() {
    const c = this.canvas, ctx = this.ctx;
    if (!c || !ctx) return;
    const W = c.width / (window.devicePixelRatio || 1);
    const H = c.height / (window.devicePixelRatio || 1);

    // Background
    ctx.fillStyle = '#0a0e1a';
    ctx.fillRect(0, 0, W, H);

    // Grid lines
    ctx.strokeStyle = 'rgba(56,189,248,.08)';
    ctx.lineWidth = 1;
    for (let i = 1; i < 5; i++) {
      const y = H - (H * i / 5);
      ctx.beginPath(); ctx.moveTo(40, y); ctx.lineTo(W, y); ctx.stroke();
      ctx.fillStyle = 'rgba(148,163,184,.3)';
      ctx.font = '11px sans-serif';
      ctx.fillText((1 + i * (Math.max(this.multiplier, 2) - 1) / 5).toFixed(1) + 'x', 2, y + 4);
    }

    // Draw curve
    if (this.phase === 'running' || this.phase === 'crashed') {
      const maxM = Math.max(this.multiplier, 2);
      const elapsed = (Date.now() - this.startTime) / 1000;
      const maxT = Math.max(elapsed, 5);
      
      ctx.beginPath();
      ctx.strokeStyle = this.phase === 'crashed' ? '#ef4444' : '#22c55e';
      ctx.lineWidth = 3;
      ctx.shadowColor = this.phase === 'crashed' ? '#ef4444' : '#22c55e';
      ctx.shadowBlur = 10;

      const padL = 45, padB = 20;
      const graphW = W - padL - 10;
      const graphH = H - padB - 10;

      // We'll draw a curve from 1.00 up to current multiplier
      const steps = 100;
      for (let i = 0; i <= steps; i++) {
        const t = (i / steps) * elapsed;
        // Exponential multiplier simulation
        const m = Math.exp(0.06 * t);
        const clampedM = Math.min(m, this.multiplier);
        const x = padL + (t / maxT) * graphW;
        const y = H - padB - ((clampedM - 1) / (maxM - 1)) * graphH;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
        if (clampedM >= this.multiplier) break;
      }
      ctx.stroke();
      ctx.shadowBlur = 0;

      // Dot at the tip
      if (this.phase === 'running') {
        const tipX = padL + (elapsed / maxT) * graphW;
        const tipY = H - padB - ((this.multiplier - 1) / (maxM - 1)) * graphH;
        ctx.beginPath();
        ctx.arc(tipX, tipY, 5, 0, Math.PI * 2);
        ctx.fillStyle = '#22c55e';
        ctx.fill();
        ctx.shadowBlur = 15;
        ctx.shadowColor = '#22c55e';
        ctx.fill();
        ctx.shadowBlur = 0;
      }
    }

    // Betting phase overlay — just dim the canvas; HTML overlays handle the text
    if (this.phase === 'betting') {
      ctx.fillStyle = 'rgba(10,14,26,.6)';
      ctx.fillRect(0, 0, W, H);
    }
  }

  renderHistory() {
    const el = document.getElementById('crashHistory');
    if (!el) return;
    el.innerHTML = (this.history || []).slice(0, 20).map(h => {
      const v = h.crashPoint || h;
      const cls = v >= 2 ? 'high' : v >= 1.5 ? 'mid' : 'low';
      return `<span class="crash-hist-pill ${cls}">${(typeof v === 'number' ? v : 1).toFixed(2)}x</span>`;
    }).join('');
  }

  renderFeed() {
    const el = document.getElementById('crashFeed');
    if (!el) return;
    if (this.liveFeed.length === 0) {
      el.innerHTML = '<p class="feed-empty">Waiting for cashouts...</p>';
      return;
    }
    el.innerHTML = this.liveFeed.slice(0, 15).map(f =>
      `<div class="feed-item"><span class="feed-name">${this.esc(f.username)}</span> <span class="feed-mult">${f.multiplier.toFixed(2)}x</span> <span class="feed-win">+${Math.floor(f.amount * f.multiplier)}</span></div>`
    ).join('');
  }

  esc(t) { const d = document.createElement('div'); d.textContent = t; return d.innerHTML; }

  destroy() {
    this._destroyed = true;
    if (this.animFrame) cancelAnimationFrame(this.animFrame);
    if (this._bettingInterval) clearInterval(this._bettingInterval);
    if (this.socket) for (const {e, fn} of this._listeners) this.socket.off(e, fn);
    this._listeners = [];
  }
}

window.CrashGame = CrashGame;
