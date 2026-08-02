// Pachinko Game — Drop balls through pegs, hit big multipliers!

class PachinkoGame {
  constructor(casinoManager) {
    this.casino = casinoManager;
    this.canvas = null;
    this.ctx = null;
    this.balls = [];
    this.pegs = [];
    this.slots = [];
    this.risk = 'medium';
    this.betAmount = 100;
    this.results = [];
    this.animFrame = null;
    this.dropTimers = [];
    this._destroyed = false;
    this.pendingBatches = new Map();
    this.latestAuthoritativeBalance = null;
    this.unresolvedPayout = 0;
    this.queuedBallCount = 0;
    this.dropRequestChain = Promise.resolve();
    this.maxOutstandingBalls = 25;
    this.resizeFrame = null;
    this.lastAnimationTimestamp = null;
    this.animationAccumulator = 0;
    this.boundResize = () => {
      if (this.resizeFrame) return;
      this.resizeFrame = requestAnimationFrame(() => {
        this.resizeFrame = null;
        if (!this._destroyed) this.resizeCanvas();
      });
    };
    this.W = 500;
    this.H = 600;
    this.ROWS = 16;
    this.init();
  }

  // Multiplier maps - balanced by binomial slot probability.
  // Approx RTP: low 94.7%, medium 94.3%, high 94.3%.
  // Risk changes variance: low is steady, high is rare-jackpot heavy.
  // 17 slots for 16 rows. Calibrated for the in-game physics distribution.
  static MULTIPLIERS = {
    low:    [5,   2.5, 1.6, 1.3, 1.15, 1.05, 0.95, 0.9,  0.85, 0.9,  0.95, 1.05, 1.15, 1.3, 1.6, 2.5, 5],
    medium: [50,  18,  6,   3,   1.8,  1.2,  0.9,  0.75, 0.6,  0.75, 0.9,  1.2,  1.8,  3,   6,   18,  50],
    high:   [220, 55,  18,  7,   2.6,  1.25, 0.78, 0.48, 0.28, 0.48, 0.78, 1.25, 2.6,  7,   18,  55,  220]
  };

  init() {
    const gv = document.getElementById('pachinkoGame');
    gv.innerHTML = `
      <div class="pachinko-container">
        <h2 class="game-title">🔮 Pachinko</h2>
        <div class="pachinko-layout">
          <div class="pachinko-canvas-wrap">
            <canvas id="pachinkoCanvas"></canvas>
            <div id="pachinkoPayoutLegend" class="pachinko-payout-legend" aria-live="polite"></div>
          </div>
          <div class="pachinko-controls">
            <div class="pach-group">
              <label for="pachBet">Bet Per Ball</label>
              <input type="number" id="pachBet" value="100" min="1" step="10">
              <div class="pach-quick">
                <button class="pqb" data-a="50">50</button>
                <button class="pqb" data-a="100">100</button>
                <button class="pqb" data-a="250">250</button>
                <button class="pqb" data-a="500">500</button>
              </div>
            </div>
            <div class="pach-group">
              <label>Risk</label>
              <div class="pach-risk-btns">
                <button class="prb" data-r="low">Low</button>
                <button class="prb active" data-r="medium">Medium</button>
                <button class="prb" data-r="high">High</button>
              </div>
            </div>
            <div class="pach-group">
              <label>Balls</label>
              <div class="pach-ball-btns">
                <button class="pbb active" data-n="1">1</button>
                <button class="pbb" data-n="3">3</button>
                <button class="pbb" data-n="5">5</button>
              </div>
            </div>
            <button id="pachDropBtn" class="btn btn-primary btn-full pach-drop-btn">🔮 Drop!</button>
          </div>
          <div id="pachResults" class="pach-results"></div>
        </div>
      </div>
    `;


    this.canvas = document.getElementById('pachinkoCanvas');
    this.ctx = this.canvas.getContext('2d');
    this.ballCount = 1;
    this.setupBoard();
    this.renderPayoutLegend();
    this.attachEvents();
    this.resizeCanvas();
    window.addEventListener('resize', this.boundResize, { passive: true });
    this.drawFrame();
  }

  resizeCanvas() {
    const wrap = this.canvas?.parentElement;
    if (!wrap) return;
    
    // Fill the available board column. The previous 500px desktop cap and
    // 40px mobile subtraction left a visible dead band inside the wrapper.
    const isMobile = window.innerWidth <= 768;
    const availableW = Math.max(1, Math.floor(wrap.clientWidth));
    const maxW = Math.min(availableW, 760);
    const ratio = maxW / 500;
    
    this.W = maxW;
    this.H = Math.floor(700 * ratio);
    
    const dpr = Math.min(window.devicePixelRatio || 1, isMobile ? 1.5 : 2);
    this.canvas.width = this.W * dpr;
    this.canvas.height = this.H * dpr;
    this.canvas.style.width = this.W + 'px';
    this.canvas.style.height = this.H + 'px';
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    
    this.setupBoard();
    this.drawFrame();
  }

  setupBoard() {
    this.pegs = [];
    this.slots = [];
    const W = this.W, H = this.H;
    const pegR = Math.max(2, W * 0.005);
    const startY = H * 0.08;
    const endY = H * 0.78;
    const rowH = (endY - startY) / this.ROWS;
    const slotCount = this.ROWS + 1; // 17 slots for 16 rows

    for (let row = 0; row < this.ROWS; row++) {
      const pegsInRow = row + 3;
      const rowWidth = W * 0.82;
      const startX = (W - rowWidth) / 2;
      const gap = rowWidth / (pegsInRow - 1);
      for (let col = 0; col < pegsInRow; col++) {
        this.pegs.push({
          id: `${row}:${col}`,
          x: startX + col * gap,
          y: startY + row * rowH,
          r: pegR,
          glow: 0
        });
      }
    }

    // Slots at bottom
    const slotY = H * 0.82;
    const slotH = H * 0.16;
    const slotW = (W * 0.88) / slotCount;
    const slotStartX = (W - slotW * slotCount) / 2;
    const mults = PachinkoGame.MULTIPLIERS[this.risk];

    for (let i = 0; i < slotCount; i++) {
      const m = mults[i] || 0.5;
      this.slots.push({
        x: slotStartX + i * slotW,
        y: slotY,
        w: slotW,
        h: slotH,
        multiplier: m,
        glow: 0
      });
    }
  }

  attachEvents() {
    document.querySelectorAll('.pqb').forEach(b => b.addEventListener('click', e => {
      document.getElementById('pachBet').value = e.target.dataset.a;
    }));
    document.querySelectorAll('.prb').forEach(b => b.addEventListener('click', e => {
      document.querySelectorAll('.prb').forEach(x => x.classList.remove('active'));
      e.target.classList.add('active');
      this.risk = e.target.dataset.r;
      this.setupBoard();
      this.renderPayoutLegend();
      this.drawFrame();
    }));
    document.querySelectorAll('.pbb').forEach(b => b.addEventListener('click', e => {
      document.querySelectorAll('.pbb').forEach(x => x.classList.remove('active'));
      e.target.classList.add('active');
      this.ballCount = parseInt(e.target.dataset.n);
    }));
    document.getElementById('pachDropBtn')?.addEventListener('click', () => this.dropBalls());
  }

  dropBalls() {
    const bet = Number(document.getElementById('pachBet')?.value);
    if (!Number.isSafeInteger(bet) || bet < 1) return this.showStatus('Enter a valid whole-number bet.', 'error');
    const totalCost = bet * this.ballCount;
    const risk = this.risk;
    const count = this.ballCount;
    if (this.getOutstandingBallCount() === 0 && this.casino.credits < totalCost) {
      return this.showStatus('Not enough credits.', 'error');
    }
    if (this.getOutstandingBallCount() + count > this.maxOutstandingBalls) {
      return this.showStatus(`Let some balls land before queueing more than ${this.maxOutstandingBalls}.`, 'error');
    }

    const requestId = globalThis.crypto?.randomUUID?.() || `drop_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    this.queuedBallCount += count;
    this.setPresentationControlsLocked(true);

    const request = this.dropRequestChain.then(() => this.submitDrop({ bet, risk, count, requestId }));
    this.dropRequestChain = request.catch(() => false);
    return request.finally(() => {
      this.queuedBallCount = Math.max(0, this.queuedBallCount - count);
      this.refreshPresentationControls();
    });
  }

  async submitDrop({ bet, risk, count, requestId }) {
    if (this._destroyed) return false;
    try {
      const response = await this.casino.apiFetch('/api/games/pachinko/drop', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ risk, bet, count, requestId })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Unable to drop balls');
      if (!Array.isArray(data.results) || data.results.length !== count ||
          !Number.isFinite(data.balance) || !Number.isFinite(data.payout)) {
        throw new Error('Invalid Pachinko settlement response');
      }
      if (this._destroyed) {
        this.casino.setCredits(data.balance);
        return true;
      }

      this.betAmount = bet;
      this.latestAuthoritativeBalance = data.balance;
      this.unresolvedPayout += data.payout;
      this.pendingBatches.set(requestId, {
        id: requestId,
        remaining: data.results.length,
        payout: data.payout
      });
      this.renderDeferredBalance();
      window.casinoSound?.playOnce(`pachinko:${requestId}:wager`, 'wager', { game: 'pachinko' });
      data.results.forEach((serverResult, index) => {
        const timer = setTimeout(() => {
          if (this._destroyed) return;
          window.casinoSound?.playOnce(`pachinko:${requestId}:drop:${index}`, 'pachinkoDrop', { cooldown: 0, game: 'pachinko' });
          const targetSlot = this.slots[serverResult.slotIndex];
          const ball = {
            x: this.W / 2 + (Math.random() - 0.5) * 12, y: this.H * 0.02,
            vx: (Math.random() - 0.5), vy: 0, r: Math.max(4, this.W * 0.009),
            active: true, bet, trail: [], hue: 40 + Math.random() * 40,
            stuckFrames: 0, lastY: 0, serverResult, soundKey: `${requestId}:${index}`,
            pegSoundAt: Object.create(null),
            batchId: requestId, presentationConfirmed: false,
            guidePhase: Math.random(),
            targetX: targetSlot ? targetSlot.x + targetSlot.w / 2 : this.W / 2
          };
          this.balls.push(ball);
          if (!this.animFrame) this.startAnim();
        }, index * 300);
        this.dropTimers.push(timer);
      });
      return true;
    } catch (error) {
      this.showStatus(error.message, 'error');
      window.casinoSound?.play('error', { game: 'pachinko' });
      return false;
    }
  }

  setPresentationControlsLocked(locked) {
    const input = document.getElementById('pachBet');
    const button = document.getElementById('pachDropBtn');
    if (input) input.disabled = locked;
    if (button) {
      button.disabled = false;
      if (button.dataset) button.dataset.consecutive = locked ? 'true' : 'false';
    }
    document.querySelectorAll('.pqb, .prb, .pbb').forEach(control => { control.disabled = locked; });
  }

  getOutstandingBallCount() {
    let active = this.queuedBallCount;
    for (const batch of this.pendingBatches.values()) active += batch.remaining;
    return active;
  }

  refreshPresentationControls() {
    this.setPresentationControlsLocked(this.getOutstandingBallCount() > 0);
  }

  renderDeferredBalance() {
    if (!Number.isFinite(this.latestAuthoritativeBalance)) return;
    this.casino.setCredits(this.latestAuthoritativeBalance - this.unresolvedPayout);
  }

  revealLatestAuthoritativeBalance() {
    if (!Number.isFinite(this.latestAuthoritativeBalance)) return;
    const balance = this.latestAuthoritativeBalance;
    this.latestAuthoritativeBalance = null;
    this.unresolvedPayout = 0;
    this.pendingBatches.clear();
    this.casino.setCredits(balance);
  }

  confirmBallPresentation(ball) {
    if (ball.presentationConfirmed) return;
    ball.presentationConfirmed = true;
    const batch = this.pendingBatches.get(ball.batchId);
    if (!batch) return;
    batch.remaining = Math.max(0, batch.remaining - 1);
    if (batch.remaining === 0) {
      this.unresolvedPayout = Math.max(0, this.unresolvedPayout - batch.payout);
      this.pendingBatches.delete(ball.batchId);
      this.renderDeferredBalance();
    }
    this.refreshPresentationControls();
  }

  renderPayoutLegend() {
    const legend = document.getElementById('pachinkoPayoutLegend');
    const multipliers = PachinkoGame.MULTIPLIERS[this.risk] || [];
    if (legend) legend.textContent = `${this.risk[0].toUpperCase()}${this.risk.slice(1)} risk payouts: ${multipliers.map(value => `${value}×`).join(' · ')}`;
  }

  showStatus(message, type = 'info') {
    const history = document.getElementById('pachResults');
    if (history) {
      history.setAttribute('aria-live', 'polite');
      history.dataset.status = type;
      if (type === 'error') history.textContent = message;
    }
  }

  startAnim() {
    this.lastAnimationTimestamp = null;
    this.animationAccumulator = 0;
    const fixedStepMs = (1000 / 60) / 1.12;
    const step = (timestamp) => {
      if (this._destroyed) return;
      if (this.lastAnimationTimestamp === null) this.lastAnimationTimestamp = timestamp;
      const elapsed = Math.min(80, Math.max(0, timestamp - this.lastAnimationTimestamp));
      this.lastAnimationTimestamp = timestamp;
      this.animationAccumulator += elapsed;
      let updates = 0;
      while (this.animationAccumulator >= fixedStepMs && updates < 5) {
        this.update();
        this.animationAccumulator -= fixedStepMs;
        updates += 1;
      }
      this.drawFrame();
      if (this.balls.some(b => b.active || b.landingHoldFrames > 0 || b.trail.length)) {
        this.animFrame = requestAnimationFrame(step);
      } else {
        this.animFrame = null;
      }
    };
    this.animFrame = requestAnimationFrame(step);
  }

  update() {
    const gravity = this.H * 0.000075;
    const friction = 0.988;
    const bounce = 0.46;
    const maxVy = this.H * 0.0062;
    const maxVx = this.W * 0.006;

    for (const ball of this.balls) {
      if (!ball.active) {
        if (ball.landingHoldFrames > 0) {
          ball.landingHoldFrames -= 1;
          if (ball.landingHoldFrames === 0) this.confirmBallPresentation(ball);
        }
        ball.trail.shift();
        continue;
      }

      const targetSlot = ball.serverResult ? this.slots[ball.serverResult.slotIndex] : null;
      if (ball.landing) {
        this.advanceLanding(ball, targetSlot);
        continue;
      }

      ball.vy += gravity;
      ball.vx *= friction;
      if (targetSlot) this.applyAuthoritativeGuidance(ball, targetSlot);

      // A short deterministic escape guard handles compound peg contacts without
      // leaving a ball visibly pinned in place.
      if (Math.abs(ball.y - ball.lastY) < 0.3) {
        ball.stuckFrames++;
        if (ball.stuckFrames > 8) {
          ball.vy = Math.max(ball.vy, this.H * 0.0008);
          const escapeDirection = Number.isFinite(ball.targetX)
            ? Math.sign(ball.targetX - ball.x) || 1
            : (ball.x <= this.W / 2 ? 1 : -1);
          ball.vx += escapeDirection * this.W * 0.0007;
          ball.stuckFrames = 0;
        }
      } else {
        ball.stuckFrames = 0;
      }
      ball.lastY = ball.y;
      ball.x += ball.vx;
      ball.y += ball.vy;
      if (ball.vy > maxVy) ball.vy = maxVy;
      ball.vx = Math.max(-maxVx, Math.min(maxVx, ball.vx));

      // Trail
      ball.trail.push({x: ball.x, y: ball.y});
      if (ball.trail.length > 8) ball.trail.shift();

      // Wall bounce
      if (ball.x < ball.r) { ball.x = ball.r; ball.vx = Math.abs(ball.vx) * bounce; }
      if (ball.x > this.W - ball.r) { ball.x = this.W - ball.r; ball.vx = -Math.abs(ball.vx) * bounce; }

      // Peg collision
      for (const peg of this.pegs) {
        const dx = ball.x - peg.x;
        const dy = ball.y - peg.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const minD = ball.r + peg.r;
        if (dist < minD && dist > 0) {
          const nx = dx / dist, ny = dy / dist;
          // Separate the overlap first. Velocity is changed only for an inward
          // impact; reflecting an already departing ball sends it back into the
          // same peg and was the source of the visible sticking.
          ball.x = peg.x + nx * (minD + 0.01);
          ball.y = peg.y + ny * (minD + 0.01);
          const dot = ball.vx * nx + ball.vy * ny;
          if (dot < 0) {
            const impact = Math.max(0, Math.min(1, (-dot) / Math.max(0.001, this.H * 0.004)));
            ball.vx -= (1 + bounce) * dot * nx;
            ball.vy -= (1 + bounce) * dot * ny;
            ball.vx += (Math.random() - 0.5) * 0.35;
            ball.vy = Math.max(ball.vy, this.H * 0.0004);
            peg.glow = 1;
            const now = performance.now();
            const lastPegSound = ball.pegSoundAt?.[peg.id] || -Infinity;
            if (impact >= .08 && now - lastPegSound >= 55) {
              ball.pegSoundAt[peg.id] = now;
              window.casinoSound?.play('peg', {
                game: 'pachinko',
                impact,
                pan: Math.max(-1, Math.min(1, (ball.x / this.W) * 2 - 1))
              });
            }
          }
        }
      }

      // The authoritative destination is approached throughout the peg field.
      // Final slot entry starts only after the ball is already inside that lane,
      // so there is no bottom-of-board horizontal correction.
      const lastPegY = this.pegs.reduce((max, peg) => Math.max(max, peg.y), this.H * 0.72);
      const landingGateY = targetSlot
        ? Math.min(targetSlot.y - ball.r * 2.2, lastPegY + this.H * 0.018)
        : Infinity;
      if (targetSlot && ball.y >= landingGateY && this.isBallAlignedForSlot(ball, targetSlot)) {
        ball.landing = { startX: ball.x, startY: ball.y, progress: 0 };
        this.advanceLanding(ball, targetSlot);
      } else if (targetSlot && ball.y >= targetSlot.y - ball.r * 2 && !this.isBallAlignedForSlot(ball, targetSlot)) {
        // A physical-looking rim rebound is the last-resort funnel. It preserves
        // continuous motion instead of teleporting an off-lane ball into place.
        ball.y = targetSlot.y - ball.r * 2;
        ball.vy = -Math.abs(ball.vy) * 0.22;
        ball.vx += Math.sign(ball.targetX - ball.x) * this.W * 0.0008;
      }

      // If physics carries the ball outside the canvas, settle it against the
      // nearest slot instead of treating escape as a jackpot.
      if (ball.y > this.H + 20 || ball.x < -20 || ball.x > this.W + 20) {
        const fallbackSlot = ball.serverResult ? this.slots[ball.serverResult.slotIndex] : this.getNearestSlot(ball.x);
        this.resolveBall(ball, fallbackSlot, 'edge-settle');
      }
    }

    // Decay peg/slot glows
    for (const p of this.pegs) if (p.glow > 0) p.glow -= 0.05;
    for (const s of this.slots) if (s.glow > 0) s.glow -= 0.02;

    this.balls = this.balls.filter(b => b.active || b.landingHoldFrames > 0 || b.trail.length > 0);
  }

  applyAuthoritativeGuidance(ball, slot) {
    const startY = this.H * 0.08;
    const endY = slot.y - ball.r * 2.2;
    if (ball.y <= startY || endY <= startY) return;
    const progress = Math.max(0, Math.min(1, (ball.y - startY) / (endY - startY)));
    const eased = progress * progress * (3 - 2 * progress);
    const targetX = slot.x + slot.w / 2;
    const phase = Number.isFinite(ball.guidePhase) ? ball.guidePhase : 0.5;
    const variation = Math.sin((progress * this.ROWS + phase) * Math.PI)
      * slot.w * 0.2 * (1 - progress);
    const guideX = this.W / 2 + (targetX - this.W / 2) * eased + variation;
    const response = 0.0012 + progress * 0.0028;
    const maxCorrection = this.W * (0.00008 + progress * 0.0005);
    const correction = Math.max(-maxCorrection, Math.min(maxCorrection, (guideX - ball.x) * response));
    ball.vx += correction;
    if (progress > 0.72) ball.vx *= 0.97;
  }

  isBallAlignedForSlot(ball, slot) {
    const inset = Math.max(ball.r, slot.w * 0.12);
    return ball.x >= slot.x + inset && ball.x <= slot.x + slot.w - inset;
  }

  advanceLanding(ball, slot) {
    if (!slot || !ball.landing) return;
    ball.landing.progress = Math.min(1, ball.landing.progress + 1 / 18);
    const progress = ball.landing.progress;
    const targetY = this.getLandingTargetY(ball, slot);
    ball.x = ball.landing.startX;
    ball.y = ball.landing.startY + (targetY - ball.landing.startY) * progress;
    ball.vx = 0;
    ball.vy = 0;
    ball.trail.push({ x: ball.x, y: ball.y });
    if (ball.trail.length > 8) ball.trail.shift();
    if (progress >= 1) this.resolveBall(ball, slot, 'server-settled');
  }

  getNearestSlot(x) {
    return this.slots.reduce((nearest, slot) => {
      const slotCenter = slot.x + slot.w / 2;
      const nearestCenter = nearest.x + nearest.w / 2;
      return Math.abs(slotCenter - x) < Math.abs(nearestCenter - x) ? slot : nearest;
    }, this.slots[0]);
  }

  getLandingTargetY(ball, slot) {
    return Math.min(
      slot.y + slot.h - ball.r * 1.5,
      slot.y + Math.max(ball.r * 1.5, slot.h * 0.42)
    );
  }

  resolveBall(ball, slot, slotType) {
    if (!slot || !ball.active) return;
    ball.x = Math.max(slot.x + ball.r, Math.min(slot.x + slot.w - ball.r, ball.x));
    ball.y = this.getLandingTargetY(ball, slot);
    ball.active = false;
    ball.landing = null;
    ball.landingHoldFrames = 18;
    ball.landedSlot = slot;
    ball.slotType = slotType;
    slot.glow = 1;

    const multiplier = ball.serverResult?.multiplier ?? slot.multiplier;
    const winnings = Math.floor(ball.bet * multiplier);
    this.results.unshift({ multiplier, winnings, bet: ball.bet });
    const landingEffect = multiplier >= 10 ? 'pachinkoLandingJackpot'
      : multiplier >= 3 ? 'pachinkoLandingHigh'
      : multiplier >= 1 ? 'pachinkoLandingMid'
      : 'pachinkoLandingLow';
    window.casinoSound?.playOnce(`pachinko:${ball.soundKey || `${Date.now()}:${multiplier}`}:result`, landingEffect, {
      volume: multiplier >= 3 ? .76 : .58,
      cooldown: 0,
      game: 'pachinko'
    });
    if (this.results.length > 20) this.results.pop();
    this.renderResults();
  }

  drawFrame() {
    const ctx = this.ctx, W = this.W, H = this.H;
    if (!ctx) return;

    // Neon 777 palette — plum/warm-vintage
    // Background
    ctx.fillStyle = '#0a0308';
    ctx.fillRect(0, 0, W, H);

    // Subtle bg pattern (warm amber dots)
    ctx.fillStyle = 'rgba(255,181,77,.03)';
    for (let i = 0; i < W; i += 30) {
      for (let j = 0; j < H; j += 30) {
        ctx.fillRect(i, j, 1, 1);
      }
    }

    // Draw pegs (cream bulbs — match marquee aesthetic)
    for (const peg of this.pegs) {
      const glow = Math.max(0, peg.glow);
      ctx.beginPath();
      ctx.arc(peg.x, peg.y, peg.r, 0, Math.PI * 2);
      if (glow > 0) {
        // Hit bulb — intensify amber glow
        ctx.fillStyle = `rgba(255,217,138,${0.5 + glow * 0.5})`;
        ctx.shadowColor = '#ffd98a';
        ctx.shadowBlur = 14 * glow;
      } else {
        // Resting cream pegs with subtle amber halo
        ctx.fillStyle = 'rgba(255,233,181,.55)';
        ctx.shadowColor = 'rgba(255,181,77,.3)';
        ctx.shadowBlur = 3;
      }
      ctx.fill();
      ctx.shadowBlur = 0;
    }

    // Draw slots
    for (let i = 0; i < this.slots.length; i++) {
      const slot = this.slots[i];
      const m = slot.multiplier;
      const glow = Math.max(0, slot.glow);

      // Neon 777 slot colors by multiplier
      let color;
      if (m >= 10) color = { r: 176, g: 100, b: 255 };       // violet (jackpot)
      else if (m >= 5) color = { r: 255, g: 58, b: 92 };     // neon-red
      else if (m >= 2) color = { r: 255, g: 90, b: 168 };    // neon-pink
      else if (m >= 1) color = { r: 255, g: 181, b: 77 };    // amber
      else color = { r: 120, g: 100, b: 110 };                // muted plum

      const alpha = 0.3 + glow * 0.5;
      ctx.fillStyle = `rgba(${color.r},${color.g},${color.b},${alpha})`;
      if (glow > 0) {
        ctx.shadowColor = `rgb(${color.r},${color.g},${color.b})`;
        ctx.shadowBlur = 15 * glow;
      }
      ctx.fillRect(slot.x + 1, slot.y, slot.w - 2, slot.h);
      ctx.shadowBlur = 0;

      // Slot border
      ctx.strokeStyle = `rgba(${color.r},${color.g},${color.b},0.6)`;
      ctx.lineWidth = 1;
      ctx.strokeRect(slot.x + 1, slot.y, slot.w - 2, slot.h);

      // Multiplier text — fit to slot width
      const label = m >= 1000 ? (m/1000) + 'k' : m + 'x';
      const maxFontSize = Math.min(slot.w * 0.45, slot.h * 0.25);
      const fontSize = Math.max(7, Math.min(maxFontSize, this.W * 0.02));
      ctx.fillStyle = '#fff3e4';
      ctx.font = `bold ${fontSize}px "Space Mono", ui-monospace, monospace`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(label, slot.x + slot.w / 2, slot.y + slot.h / 2);
      ctx.textAlign = 'start';
      ctx.textBaseline = 'alphabetic';
    }

    // Draw balls (with trails)
    for (const ball of this.balls) {
      if (!ball.active && ball.landingHoldFrames <= 0 && ball.trail.length === 0) continue;

      // Trail
      for (let i = 0; i < ball.trail.length; i++) {
        const t = ball.trail[i];
        const alpha = (i / ball.trail.length) * 0.3;
        ctx.beginPath();
        ctx.arc(t.x, t.y, ball.r * 0.6, 0, Math.PI * 2);
        ctx.fillStyle = `hsla(${ball.hue},90%,60%,${alpha})`;
        ctx.fill();
      }

      // Ball
      if (ball.active || ball.landingHoldFrames > 0) {
        ctx.beginPath();
        ctx.arc(ball.x, ball.y, ball.r, 0, Math.PI * 2);
        const grad = ctx.createRadialGradient(ball.x - 2, ball.y - 2, 1, ball.x, ball.y, ball.r);
        grad.addColorStop(0, `hsla(${ball.hue},100%,80%,1)`);
        grad.addColorStop(1, `hsla(${ball.hue},90%,50%,1)`);
        ctx.fillStyle = grad;
        ctx.shadowColor = `hsl(${ball.hue},90%,60%)`;
        ctx.shadowBlur = 12;
        ctx.fill();
        ctx.shadowBlur = 0;
      }
    }
  }

  renderResults() {
    const el = document.getElementById('pachResults');
    if (!el) return;
    el.innerHTML = this.results.slice(0, 10).map(r => {
      const cls = r.multiplier >= 5 ? 'big-win' : r.multiplier >= 1 ? 'win' : 'loss';
      return `<div class="pach-result ${cls}"><span>${r.multiplier}x</span> <span>${r.winnings > r.bet ? '+' : ''}${r.winnings}</span></div>`;
    }).join('');
  }

  destroy() {
    this._destroyed = true;
    this.revealLatestAuthoritativeBalance();
    this.queuedBallCount = 0;
    this.setPresentationControlsLocked(false);
    if (this.animFrame) cancelAnimationFrame(this.animFrame);
    if (this.resizeFrame) cancelAnimationFrame(this.resizeFrame);
    this.dropTimers.forEach(clearTimeout);
    this.dropTimers = [];
    window.removeEventListener('resize', this.boundResize);
  }
}

window.PachinkoGame = PachinkoGame;
