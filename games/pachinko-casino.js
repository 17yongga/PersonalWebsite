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
    this._destroyed = false;
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
          </div>
          <div class="pachinko-controls">
            <div class="pach-group">
              <label>Bet Per Ball</label>
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

    // On mobile, reorder: controls → canvas → results
    if (window.innerWidth <= 768) {
      const layout = gv.querySelector('.pachinko-layout');
      const canvasWrap = gv.querySelector('.pachinko-canvas-wrap');
      const controls = gv.querySelector('.pachinko-controls');
      const results = gv.querySelector('#pachResults');
      if (layout && canvasWrap && controls && results) {
        layout.insertBefore(controls, canvasWrap);
        layout.appendChild(results);
      }
    }

    this.canvas = document.getElementById('pachinkoCanvas');
    this.ctx = this.canvas.getContext('2d');
    this.ballCount = 1;
    this.setupBoard();
    this.attachEvents();
    this.resizeCanvas();
    window.addEventListener('resize', () => this.resizeCanvas());
    this.drawFrame();
  }

  resizeCanvas() {
    const wrap = this.canvas?.parentElement;
    if (!wrap) return;
    
    // Responsive sizing: smaller on mobile for better layout
    const isMobile = window.innerWidth <= 768;
    const maxW = isMobile ? Math.min(wrap.clientWidth - 40, 400) : Math.min(wrap.clientWidth, 500);
    const ratio = maxW / 500;
    
    this.W = maxW;
    this.H = Math.floor(700 * ratio);
    
    const dpr = window.devicePixelRatio || 1;
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
    const bet = Number(document.getElementById('pachBet').value);
    if (!Number.isSafeInteger(bet) || bet < 1) {
      alert('Enter a valid bet amount.');
      return;
    }
    const totalCost = bet * this.ballCount;
    if (this.casino.credits < totalCost) {
      alert('Not enough credits!');
      return;
    }
    this.casino.updateCredits(-totalCost);
    this.betAmount = bet;

    for (let i = 0; i < this.ballCount; i++) {
      setTimeout(() => {
        if (this._destroyed) return;
        const ball = {
          x: this.W / 2 + (Math.random() - 0.5) * 20,
          y: this.H * 0.02,
          vx: (Math.random() - 0.5) * 1.5,
          vy: 0,
          r: Math.max(4, this.W * 0.009),
          active: true,
          bet: bet,
          trail: [],
          hue: 40 + Math.random() * 40, // gold-orange range
          stuckFrames: 0,
          lastY: 0
        };
        this.balls.push(ball);
        if (!this.animFrame) this.startAnim();
      }, i * 300);
    }
  }

  startAnim() {
    const step = () => {
      if (this._destroyed) return;
      this.update();
      this.drawFrame();
      if (this.balls.some(b => b.active)) {
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
    const bounce = 0.5;
    const maxVy = this.H * 0.0058;

    for (const ball of this.balls) {
      if (!ball.active) continue;

      ball.vy += gravity;
      ball.vx *= friction;

      // Stuck detection: if ball hasn't moved down much in 30 frames, nudge it
      if (Math.abs(ball.y - ball.lastY) < 0.3) {
        ball.stuckFrames++;
        if (ball.stuckFrames > 30) {
          ball.vy += gravity * 2;
          ball.vx += (Math.random() - 0.5) * 1.1;
          ball.stuckFrames = 0;
        }
      } else {
        ball.stuckFrames = 0;
      }
      ball.lastY = ball.y;
      ball.x += ball.vx;
      ball.y += ball.vy;
      if (ball.vy > maxVy) ball.vy = maxVy;

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
          // Push ball out
          const nx = dx / dist, ny = dy / dist;
          ball.x = peg.x + nx * minD;
          ball.y = peg.y + ny * minD;
          // Reflect velocity
          const dot = ball.vx * nx + ball.vy * ny;
          ball.vx -= 2 * dot * nx;
          ball.vy -= 2 * dot * ny;
          // Dampen + random nudge
          ball.vx = ball.vx * bounce + (Math.random() - 0.5) * 0.8;
          ball.vy = ball.vy * bounce;
          // Ensure downward movement
          if (ball.vy < 0.18) ball.vy = 0.18;
          peg.glow = 1;
        }
      }

      // Check slot landing
      for (const slot of this.slots) {
        if (ball.y >= slot.y && ball.x >= slot.x && ball.x <= slot.x + slot.w) {
          this.resolveBall(ball, slot, slot.label || 'slot');
          break;
        }
      }

      // If physics carries the ball outside the canvas, settle it against the
      // nearest slot instead of treating escape as a jackpot.
      if (ball.y > this.H + 20 || ball.x < -20 || ball.x > this.W + 20) {
        this.resolveBall(ball, this.getNearestSlot(ball.x), 'edge-settle');
      }
    }

    // Decay peg/slot glows
    for (const p of this.pegs) if (p.glow > 0) p.glow -= 0.05;
    for (const s of this.slots) if (s.glow > 0) s.glow -= 0.02;

    // Clean up old inactive balls
    if (this.balls.length > 30) {
      this.balls = this.balls.filter(b => b.active || b.trail.length > 0);
    }
  }

  getNearestSlot(x) {
    return this.slots.reduce((nearest, slot) => {
      const slotCenter = slot.x + slot.w / 2;
      const nearestCenter = nearest.x + nearest.w / 2;
      return Math.abs(slotCenter - x) < Math.abs(nearestCenter - x) ? slot : nearest;
    }, this.slots[0]);
  }

  resolveBall(ball, slot, slotType) {
    if (!slot) return;
    ball.active = false;
    ball.landedSlot = slot;
    slot.glow = 1;

    const winnings = Math.floor(ball.bet * slot.multiplier);
    const won = winnings >= ball.bet;
    this.casino.updateCredits(winnings);
    this.casino.recordBet('pachinko', ball.bet, won ? 'Win' : 'Loss', winnings, slot.multiplier);

    if (this.casino.socket) {
      this.casino.socket.emit('gameResult', {
        gameType: 'pachinko',
        betAmount: ball.bet,
        won,
        payout: winnings,
        result: {
          multiplier: slot.multiplier,
          slotType
        }
      });
    }

    this.results.unshift({ multiplier: slot.multiplier, winnings, bet: ball.bet });
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

      // Multiplier text: horizontal on roomy boards, rotated on narrow mobile
      // slots so the label remains readable instead of bleeding across cells.
      const label = m >= 1000 ? (m/1000) + 'k' : m + 'x';
      const narrowSlot = slot.w < 24;
      let fontSize = narrowSlot
        ? Math.min(9, Math.max(7, slot.w * 0.55), slot.h * 0.2)
        : Math.min(11, slot.h * 0.26, slot.w * 0.34);
      ctx.font = `bold ${fontSize}px "Space Mono", ui-monospace, monospace`;
      while (!narrowSlot && fontSize > 6 && ctx.measureText(label).width > slot.w - 6) {
        fontSize -= 0.5;
        ctx.font = `bold ${fontSize}px "Space Mono", ui-monospace, monospace`;
      }
      ctx.fillStyle = '#fff3e4';
      ctx.shadowColor = 'rgba(10,3,8,.85)';
      ctx.shadowBlur = 5;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      if (narrowSlot) {
        ctx.save();
        ctx.translate(slot.x + slot.w / 2, slot.y + slot.h / 2);
        ctx.rotate(-Math.PI / 2);
        ctx.strokeStyle = 'rgba(10,3,8,.85)';
        ctx.lineWidth = 3;
        ctx.strokeText(label, 0, 0);
        ctx.fillText(label, 0, 0);
        ctx.restore();
      } else {
        ctx.strokeStyle = 'rgba(10,3,8,.85)';
        ctx.lineWidth = 3;
        ctx.strokeText(label, slot.x + slot.w / 2, slot.y + slot.h / 2);
        ctx.fillText(label, slot.x + slot.w / 2, slot.y + slot.h / 2);
      }
      ctx.shadowBlur = 0;
      ctx.textAlign = 'start';
      ctx.textBaseline = 'alphabetic';
    }

    // Draw balls (with trails)
    for (const ball of this.balls) {
      if (!ball.active && ball.trail.length === 0) continue;

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
      if (ball.active) {
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
    if (this.animFrame) cancelAnimationFrame(this.animFrame);
  }
}

window.PachinkoGame = PachinkoGame;
