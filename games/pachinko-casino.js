// Pachinko — server-authoritative outcomes with deterministic presentation paths.

class PachinkoGame {
  static ROWS = 16;

  static MULTIPLIERS = {
    low:    [5, 2.5, 1.6, 1.3, 1.15, 1.05, 0.95, 0.9, 0.85, 0.9, 0.95, 1.05, 1.15, 1.3, 1.6, 2.5, 5],
    medium: [50, 18, 6, 3, 1.8, 1.2, 0.9, 0.75, 0.6, 0.75, 0.9, 1.2, 1.8, 3, 6, 18, 50],
    high:   [220, 55, 18, 7, 2.6, 1.25, 0.78, 0.48, 0.28, 0.48, 0.78, 1.25, 2.6, 7, 18, 55, 220]
  };

  static MOTION = Object.freeze({
    minDuration: 2600,
    durationVariation: 360,
    launchY: 0.035,
    pegStartY: 0.12,
    pegEndY: 0.70,
    terminalGateY: 0.755,
    slotY: 0.79,
    slotHeight: 0.17,
    landingY: 0.875,
    resultHoldMs: 360,
    trailLength: 9
  });

  static createGeometry(width, risk = 'medium') {
    const safeWidth = Math.max(280, Math.min(760, Number(width) || 390));
    const height = Math.round(safeWidth * 1.02);
    const rows = PachinkoGame.ROWS;
    const boardLeft = safeWidth * 0.06;
    const boardRight = safeWidth * 0.94;
    const slotWidth = (boardRight - boardLeft) / (rows + 1);
    const pegStartY = height * PachinkoGame.MOTION.pegStartY;
    const pegEndY = height * PachinkoGame.MOTION.pegEndY;
    const pegRowHeight = (pegEndY - pegStartY) / (rows - 1);
    const pegRadius = Math.max(2.2, safeWidth * 0.0065);
    const multipliers = PachinkoGame.MULTIPLIERS[risk] || PachinkoGame.MULTIPLIERS.medium;
    const pegRows = [];
    const pegs = [];

    for (let row = 0; row < rows; row += 1) {
      const count = row + 3;
      const rowWidth = (count - 1) * slotWidth;
      const startX = (safeWidth - rowWidth) / 2;
      const current = [];
      for (let col = 0; col < count; col += 1) {
        const peg = {
          id: `${row}:${col}`,
          row,
          x: startX + col * slotWidth,
          y: pegStartY + row * pegRowHeight,
          r: pegRadius
        };
        current.push(peg);
        pegs.push(peg);
      }
      pegRows.push(current);
    }

    const slotY = height * PachinkoGame.MOTION.slotY;
    const slotHeight = height * PachinkoGame.MOTION.slotHeight;
    const slots = multipliers.map((multiplier, index) => ({
      index,
      x: boardLeft + index * slotWidth,
      y: slotY,
      w: slotWidth,
      h: slotHeight,
      multiplier
    }));

    return {
      width: safeWidth,
      height,
      rows,
      boardLeft,
      boardRight,
      slotWidth,
      slotCenters: slots.map(slot => slot.x + slot.w / 2),
      pegStartY,
      pegEndY,
      pegRowHeight,
      pegRadius,
      pegRows,
      pegs,
      slots,
      terminalGateY: height * PachinkoGame.MOTION.terminalGateY,
      landingY: height * PachinkoGame.MOTION.landingY
    };
  }

  static seededRandom(seed) {
    let value = (Number(seed) || 1) >>> 0;
    return () => {
      value ^= value << 13;
      value ^= value >>> 17;
      value ^= value << 5;
      return (value >>> 0) / 4294967296;
    };
  }

  static hashSeed(value) {
    let hash = 2166136261;
    const text = String(value);
    for (let index = 0; index < text.length; index += 1) {
      hash ^= text.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    return hash >>> 0;
  }

  static planPresentationPath(geometry, slotIndex, seed = 1) {
    if (!geometry || !Array.isArray(geometry.slots) || geometry.slots.length !== 17) {
      throw new Error('Pachinko path requires valid 17-slot geometry');
    }
    const destination = Number(slotIndex);
    if (!Number.isInteger(destination) || destination < 0 || destination >= geometry.slots.length) {
      throw new Error('Pachinko path received an invalid authoritative slot');
    }

    const random = PachinkoGame.seededRandom(seed);
    const decisions = Array.from({ length: geometry.rows }, (_, index) => index < destination ? 1 : -1);
    for (let index = decisions.length - 1; index > 0; index -= 1) {
      const swapIndex = Math.floor(random() * (index + 1));
      [decisions[index], decisions[swapIndex]] = [decisions[swapIndex], decisions[index]];
    }

    const duration = PachinkoGame.MOTION.minDuration + Math.round(random() * PachinkoGame.MOTION.durationVariation);
    const pegDuration = duration * 0.82;
    const points = [{ x: geometry.width / 2, y: geometry.height * PachinkoGame.MOTION.launchY, t: 0, kind: 'launch' }];
    let x = geometry.width / 2;

    for (let row = 0; row < geometry.rows; row += 1) {
      x += decisions[row] * geometry.slotWidth * 0.5;
      points.push({
        x,
        y: geometry.pegStartY + row * geometry.pegRowHeight + geometry.pegRowHeight * 0.42,
        t: Math.round(pegDuration * ((row + 1) / geometry.rows)),
        kind: 'peg',
        row
      });
    }

    const targetX = geometry.slotCenters[destination];
    // The route's right-count encodes the destination, so this should be exact.
    x = targetX;
    points[points.length - 1].x = targetX;
    const terminalLockIndex = points.length - 1;
    points.push({ x, y: geometry.terminalGateY, t: Math.round(duration * 0.9), kind: 'gate' });
    points.push({ x, y: geometry.landingY, t: duration, kind: 'landing' });

    return { slotIndex: destination, seed, duration, decisions, points, terminalLockIndex };
  }

  static reduceMotionPath(path, duration = 280) {
    const safeDuration = Math.max(1, Number(duration) || 280);
    const scale = safeDuration / path.duration;
    return {
      ...path,
      duration: safeDuration,
      points: path.points.map(point => ({ ...point, t: Math.round(point.t * scale) }))
    };
  }

  constructor(casinoManager) {
    this.casino = casinoManager;
    this.root = null;
    this.stage = null;
    this.staticCanvas = null;
    this.dynamicCanvas = null;
    this.staticCtx = null;
    this.dynamicCtx = null;
    this.geometry = null;
    this.pegs = [];
    this.slots = [];
    this.W = 390;
    this.H = 398;
    this.ROWS = PachinkoGame.ROWS;
    this.risk = 'medium';
    this.betAmount = 100;
    this.ballCount = 1;
    this.balls = [];
    this.results = [];
    this.activeSlotGlows = new Map();
    this.pendingBatches = new Map();
    this.latestAuthoritativeBalance = null;
    this.unresolvedPayout = 0;
    this.queuedBallCount = 0;
    this.dropRequestChain = Promise.resolve();
    this.maxOutstandingBalls = 25;
    this.presentationGeneration = 1;
    this.animFrame = null;
    this.resizeFrame = null;
    this.resizeObserver = null;
    this.timerHandles = new Set();
    this.pauseStartedAt = null;
    this._destroyed = false;
    this.boundVisibility = () => this.handleVisibilityChange();
    this.boundWindowResize = () => this.scheduleResize();
    this.init();
  }

  init() {
    const root = document.getElementById('pachinkoGame');
    if (!root) throw new Error('Pachinko root is unavailable');
    this.root = root;
    root.innerHTML = `
      <div class="pachinko-container">
        <div class="pachinko-heading">
          <div>
            <span class="pachinko-eyebrow">NEON DROP</span>
            <h2 class="game-title">Pachinko</h2>
          </div>
          <div id="pachinkoPayoutLegend" class="pachinko-payout-legend" aria-live="polite"></div>
        </div>
        <div class="pachinko-cabinet">
          <section class="pachinko-machine" aria-label="Pachinko board">
            <div class="pachinko-stage">
              <canvas id="pachinkoStaticCanvas" class="pachinko-static-canvas" aria-hidden="true"></canvas>
              <canvas id="pachinkoDynamicCanvas" class="pachinko-dynamic-canvas" role="img" aria-label="Animated Pachinko ball board"></canvas>
            </div>
            <div class="pachinko-result-tray">
              <div class="pachinko-result-heading">
                <span>Recent drops</span><span class="pachinko-result-hint">Newest first</span>
              </div>
              <div id="pachResults" class="pach-results" aria-live="polite">
                <div class="pachinko-empty-result">Your landed multipliers appear here.</div>
              </div>
            </div>
          </section>
          <aside class="pachinko-controls" aria-label="Pachinko wager controls">
            <div class="pachinko-control-header"><span>Build your drop</span><span id="pachinkoTotal">100 credits</span></div>
            <div class="pach-group pach-bet-group">
              <label for="pachBet">Bet per ball</label>
              <div class="pach-bet-row"><input type="number" id="pachBet" value="100" min="1" step="10" inputmode="numeric"><span>credits</span></div>
              <div class="pach-quick" aria-label="Quick bet amounts">
                <button type="button" class="pqb" data-a="50" aria-pressed="false">50</button>
                <button type="button" class="pqb active" data-a="100" aria-pressed="true">100</button>
                <button type="button" class="pqb" data-a="250" aria-pressed="false">250</button>
                <button type="button" class="pqb" data-a="500" aria-pressed="false">500</button>
              </div>
            </div>
            <div class="pachinko-choice-grid">
              <div class="pach-group"><label>Risk</label><div class="pach-risk-btns">
                <button type="button" class="prb" data-r="low" aria-pressed="false">Low</button>
                <button type="button" class="prb active" data-r="medium" aria-pressed="true">Med</button>
                <button type="button" class="prb" data-r="high" aria-pressed="false">High</button>
              </div></div>
              <div class="pach-group"><label>Balls</label><div class="pach-ball-btns">
                <button type="button" class="pbb active" data-n="1" aria-pressed="true">1</button>
                <button type="button" class="pbb" data-n="3" aria-pressed="false">3</button>
                <button type="button" class="pbb" data-n="5" aria-pressed="false">5</button>
              </div></div>
            </div>
            <button id="pachDropBtn" class="btn btn-primary btn-full pach-drop-btn"><span>Drop balls</span><span aria-hidden="true">↓</span></button>
            <p class="pachinko-fair-note">Outcome and payout are locked by the server before the animation starts.</p>
          </aside>
        </div>
      </div>`;

    this.stage = root.querySelector('.pachinko-stage');
    this.staticCanvas = root.querySelector('#pachinkoStaticCanvas');
    this.dynamicCanvas = root.querySelector('#pachinkoDynamicCanvas');
    this.staticCtx = this.staticCanvas?.getContext?.('2d') || null;
    this.dynamicCtx = this.dynamicCanvas?.getContext?.('2d') || null;
    if (!this.stage || !this.staticCtx || !this.dynamicCtx) {
      root.innerHTML = '<div class="pachinko-fatal" role="alert">Pachinko could not start. Please reload and try again.</div>';
      throw new Error('Pachinko canvas initialization failed');
    }

    this.cacheElements();
    this.attachEvents();
    this.renderPayoutLegend();
    this.updateTotal();
    this.resizeCanvas(true);

    if (typeof ResizeObserver === 'function') {
      this.resizeObserver = new ResizeObserver(() => this.scheduleResize());
      this.resizeObserver.observe(this.stage);
    } else {
      window.addEventListener('resize', this.boundWindowResize, { passive: true });
    }
    document.addEventListener?.('visibilitychange', this.boundVisibility);
  }

  cacheElements() {
    this.betInput = this.root.querySelector('#pachBet');
    this.dropButton = this.root.querySelector('#pachDropBtn');
    this.resultsElement = this.root.querySelector('#pachResults');
    this.legendElement = this.root.querySelector('#pachinkoPayoutLegend');
    this.totalElement = this.root.querySelector('#pachinkoTotal');
    if (!this.betInput || !this.dropButton || !this.resultsElement || !this.legendElement || !this.totalElement) {
      throw new Error('Pachinko controls failed to initialize');
    }
  }

  attachEvents() {
    this.root.querySelectorAll('.pqb').forEach(button => button.addEventListener('click', event => {
      this.betInput.value = event.currentTarget.dataset.a;
      this.syncBetSelector();
      this.updateTotal();
    }));
    this.betInput.addEventListener('input', () => {
      this.syncBetSelector();
      this.updateTotal();
    });
    this.root.querySelectorAll('.prb').forEach(button => button.addEventListener('click', event => {
      this.risk = event.currentTarget.dataset.r;
      this.syncSelectorState('.prb', control => control.dataset.r === this.risk);
      this.rebuildGeometry();
      this.renderPayoutLegend();
    }));
    this.root.querySelectorAll('.pbb').forEach(button => button.addEventListener('click', event => {
      this.ballCount = Number(event.currentTarget.dataset.n);
      this.syncSelectorState('.pbb', control => Number(control.dataset.n) === this.ballCount);
      this.updateTotal();
    }));
    this.dropButton.addEventListener('click', () => this.dropBalls());
  }

  syncSelectorState(selector, isSelected) {
    this.root.querySelectorAll(selector).forEach(control => {
      const selected = Boolean(isSelected(control));
      control.classList.toggle('active', selected);
      control.setAttribute('aria-pressed', String(selected));
    });
  }

  syncBetSelector() {
    const amount = Number(this.betInput.value);
    this.syncSelectorState('.pqb', control => Number(control.dataset.a) === amount);
  }

  updateTotal() {
    const bet = Number(this.betInput?.value);
    const total = Number.isFinite(bet) && bet > 0 ? bet * this.ballCount : 0;
    if (this.totalElement) this.totalElement.textContent = `${total.toLocaleString()} credits`;
  }

  scheduleResize() {
    if (this.resizeFrame || this._destroyed) return;
    this.resizeFrame = requestAnimationFrame(() => {
      this.resizeFrame = null;
      this.resizeCanvas();
    });
  }

  resizeCanvas(force = false) {
    if (!this.stage || this._destroyed) return;
    const measured = Math.floor(this.stage.getBoundingClientRect?.().width || this.stage.clientWidth || 390);
    const width = Math.max(280, Math.min(760, measured));
    const nextGeometry = PachinkoGame.createGeometry(width, this.risk);
    const dpr = Math.min(Number(window.devicePixelRatio) || 1, width <= 480 ? 1.5 : 2);
    const sameSize = this.geometry && this.geometry.width === nextGeometry.width && this.geometry.height === nextGeometry.height && this.renderDpr === dpr;
    if (!force && sameSize) return;

    const now = performance.now();
    const progressByBall = new Map(this.balls.filter(ball => ball.active).map(ball => [ball, Math.max(0, Math.min(1, (now - ball.startedAt) / ball.path.duration))]));
    this.geometry = nextGeometry;
    this.W = nextGeometry.width;
    this.H = nextGeometry.height;
    this.renderDpr = dpr;
    this.pegs = nextGeometry.pegs;
    this.slots = nextGeometry.slots;
    this.boardMetrics = {
      pegStartY: nextGeometry.pegStartY,
      pegEndY: nextGeometry.pegEndY,
      pegRowHeight: nextGeometry.pegRowHeight,
      terminalGateY: nextGeometry.terminalGateY,
      slotY: nextGeometry.slots[0].y,
      slotWidth: nextGeometry.slotWidth
    };

    for (const canvas of [this.staticCanvas, this.dynamicCanvas]) {
      canvas.width = Math.round(this.W * dpr);
      canvas.height = Math.round(this.H * dpr);
      canvas.style.width = `${this.W}px`;
      canvas.style.height = `${this.H}px`;
    }
    this.staticCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.dynamicCtx.setTransform(dpr, 0, 0, dpr, 0, 0);

    for (const ball of progressByBall.keys()) {
      const progress = progressByBall.get(ball);
      const rebuiltPath = PachinkoGame.planPresentationPath(this.geometry, ball.serverResult.slotIndex, ball.seed);
      ball.path = ball.reducedMotion ? PachinkoGame.reduceMotionPath(rebuiltPath) : rebuiltPath;
      ball.startedAt = now - progress * ball.path.duration;
      ball.r = Math.max(4, this.W * 0.011);
      this.resetTrail(ball);
    }
    this.drawStaticBoard();
    this.drawDynamicFrame(now);
  }

  rebuildGeometry() {
    if (!this.geometry) return this.resizeCanvas(true);
    this.geometry = PachinkoGame.createGeometry(this.geometry.width, this.risk);
    this.pegs = this.geometry.pegs;
    this.slots = this.geometry.slots;
    this.boardMetrics.slotY = this.geometry.slots[0].y;
    this.drawStaticBoard();
    this.drawDynamicFrame(performance.now());
  }

  setupBoard() {
    const geometry = PachinkoGame.createGeometry(this.W, this.risk);
    this.geometry = geometry;
    this.H = geometry.height;
    this.pegs = geometry.pegs;
    this.slots = geometry.slots;
    this.boardMetrics = {
      pegStartY: geometry.pegStartY,
      pegEndY: geometry.pegEndY,
      pegRowHeight: geometry.pegRowHeight,
      terminalGateY: geometry.terminalGateY,
      slotY: geometry.slots[0].y,
      slotWidth: geometry.slotWidth
    };
    return geometry;
  }

  createAuthoritativeRoute(slotIndex, random = Math.random) {
    const decisions = Array.from({ length: this.ROWS }, (_, index) => index < slotIndex ? 1 : -1);
    for (let index = decisions.length - 1; index > 0; index -= 1) {
      const swapIndex = Math.floor(random() * (index + 1));
      [decisions[index], decisions[swapIndex]] = [decisions[swapIndex], decisions[index]];
    }
    return decisions;
  }

  dropBalls() {
    const bet = Number(this.betInput?.value);
    if (!Number.isSafeInteger(bet) || bet < 1) return this.showStatus('Enter a valid whole-number bet.', 'error');
    const count = this.ballCount;
    const totalCost = bet * count;
    if (this.getOutstandingBallCount() === 0 && this.casino.credits < totalCost) return this.showStatus('Not enough credits.', 'error');
    if (this.getOutstandingBallCount() + count > this.maxOutstandingBalls) {
      return this.showStatus(`Let some balls land before queueing more than ${this.maxOutstandingBalls}.`, 'error');
    }

    const requestId = globalThis.crypto?.randomUUID?.() || `drop_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    this.queuedBallCount += count;
    this.setPresentationControlsLocked(true);
    const request = this.dropRequestChain.then(() => this.submitDrop({ bet, risk: this.risk, count, requestId }));
    this.dropRequestChain = request.catch(() => false);
    return request.finally(() => {
      this.queuedBallCount = Math.max(0, this.queuedBallCount - count);
      this.refreshPresentationControls();
    });
  }

  validateSettlement(data, count) {
    if (!data || !Array.isArray(data.results) || data.results.length !== count || !Number.isFinite(data.balance) || !Number.isFinite(data.payout) || data.payout < 0) return false;
    const payoutMilli = Math.round(Number(data.payout) * 1000);
    if (!Number.isSafeInteger(payoutMilli)) return false;
    let resultPayoutMilli = 0;
    for (const result of data.results) {
      const slot = this.slots[result?.slotIndex];
      const resultMilli = Number(result?.payout) * 1000;
      if (!slot || result.multiplier !== slot.multiplier || !Number.isFinite(result.payout) || result.payout < 0 ||
          !Number.isSafeInteger(Math.round(resultMilli)) || Math.abs(resultMilli - Math.round(resultMilli)) >= 1e-6) return false;
      resultPayoutMilli += Math.round(resultMilli);
    }
    return resultPayoutMilli === payoutMilli;
  }

  async submitDrop({ bet, risk, count, requestId }) {
    if (this._destroyed) return false;
    const generation = this.presentationGeneration;
    try {
      const response = await this.casino.apiFetch('/api/games/pachinko/drop', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ risk, bet, count, requestId })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Unable to drop balls');
      if (!this.validateSettlement(data, count)) throw new Error('Invalid Pachinko settlement response');
      if (this._destroyed || generation !== this.presentationGeneration) {
        this.casino.setCredits(data.balance);
        return true;
      }

      this.betAmount = bet;
      this.latestAuthoritativeBalance = data.balance;
      this.unresolvedPayout += data.payout;
      this.pendingBatches.set(requestId, { id: requestId, remaining: count, payout: data.payout });
      this.renderDeferredBalance();
      window.casinoSound?.playOnce(`pachinko:${requestId}:wager`, 'wager', { game: 'pachinko' });
      this.casino.stabilizeGameViewport?.(this.root.querySelector('.pachinko-cabinet'));

      data.results.forEach((serverResult, index) => {
        this.ownTimeout(() => this.launchBall({ serverResult, bet, requestId, index, generation }), index * 260, generation);
      });
      return true;
    } catch (error) {
      console.error('Pachinko drop failed', error);
      this.showStatus(error?.message || 'Pachinko could not complete the drop.', 'error');
      window.casinoSound?.play('error', { game: 'pachinko' });
      return false;
    }
  }

  ownTimeout(callback, delay, generation = this.presentationGeneration) {
    const handle = setTimeout(() => {
      this.timerHandles.delete(handle);
      if (this._destroyed || generation !== this.presentationGeneration) return;
      callback();
    }, delay);
    this.timerHandles.add(handle);
    return handle;
  }

  launchBall({ serverResult, bet, requestId, index, generation }) {
    if (this._destroyed || generation !== this.presentationGeneration) return;
    const seed = PachinkoGame.hashSeed(`${requestId}:${index}:${serverResult.slotIndex}`);
    const plannedPath = PachinkoGame.planPresentationPath(this.geometry, serverResult.slotIndex, seed);
    const reducedMotion = Boolean(window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches);
    const path = reducedMotion ? PachinkoGame.reduceMotionPath(plannedPath) : plannedPath;
    const startedAt = performance.now();
    const first = path.points[0];
    const ball = {
      x: first.x,
      y: first.y,
      r: Math.max(4, this.W * 0.011),
      active: true,
      confirmed: false,
      visuallySettled: false,
      bet,
      serverResult,
      batchId: requestId,
      soundKey: `${requestId}:${index}`,
      seed,
      path,
      reducedMotion,
      startedAt,
      lastPointIndex: 0,
      trail: Array(PachinkoGame.MOTION.trailLength),
      trailCursor: 0,
      trailCount: 0,
      hue: 38 + (seed % 28),
      generation
    };
    this.balls.push(ball);
    window.casinoSound?.playOnce(`pachinko:${requestId}:drop:${index}`, 'pachinkoDrop', { cooldown: 0, game: 'pachinko' });
    this.startAnimation();
  }

  startAnimation() {
    if (this.animFrame || this._destroyed || document.hidden) return;
    const generation = this.presentationGeneration;
    const frame = timestamp => {
      if (this._destroyed || generation !== this.presentationGeneration) return;
      this.animFrame = null;
      this.updatePresentation(timestamp);
      this.drawDynamicFrame(timestamp);
      if (this.balls.length || this.activeSlotGlows.size) this.animFrame = requestAnimationFrame(frame);
    };
    this.animFrame = requestAnimationFrame(frame);
  }

  updatePresentation(timestamp) {
    for (const ball of this.balls) {
      if (ball.generation !== this.presentationGeneration) continue;
      if (ball.active) {
        const elapsed = Math.max(0, Math.min(ball.path.duration, timestamp - ball.startedAt));
        const position = this.samplePath(ball.path, elapsed);
        ball.x = position.x;
        ball.y = position.y;
        this.recordTrail(ball, ball.x, ball.y);
        if (position.pointIndex > ball.lastPointIndex) {
          const latestPeg = Math.min(position.pointIndex, this.ROWS);
          for (let point = ball.lastPointIndex + 1; point <= latestPeg; point += 1) this.playPegImpact(ball, point - 1);
          ball.lastPointIndex = position.pointIndex;
        }
        if (elapsed >= ball.path.duration) this.completeBall(ball, timestamp);
      } else if (!ball.confirmed && timestamp >= ball.confirmAt) {
        ball.confirmed = true;
        this.confirmBallPresentation(ball);
      }
    }

    for (const [slotIndex, expiresAt] of this.activeSlotGlows) {
      if (timestamp >= expiresAt) this.activeSlotGlows.delete(slotIndex);
    }
    this.balls = this.balls.filter(ball => ball.active || !ball.confirmed || timestamp < ball.confirmAt + 240);
  }

  samplePath(path, elapsed) {
    const points = path.points;
    let upper = 1;
    while (upper < points.length && elapsed > points[upper].t) upper += 1;
    if (upper >= points.length) return { ...points.at(-1), pointIndex: points.length - 1 };
    const from = points[upper - 1];
    const to = points[upper];
    const span = Math.max(1, to.t - from.t);
    const linear = Math.max(0, Math.min(1, (elapsed - from.t) / span));
    const eased = linear * linear * (3 - 2 * linear);
    const terminal = upper - 1 >= path.terminalLockIndex;
    return {
      x: terminal ? from.x : from.x + (to.x - from.x) * eased,
      y: from.y + (to.y - from.y) * linear,
      pointIndex: upper
    };
  }

  resetTrail(ball) {
    ball.trail = Array(PachinkoGame.MOTION.trailLength);
    ball.trailCursor = 0;
    ball.trailCount = 0;
  }

  recordTrail(ball, x, y) {
    const length = PachinkoGame.MOTION.trailLength;
    ball.trail[ball.trailCursor] = { x, y };
    ball.trailCursor = (ball.trailCursor + 1) % length;
    ball.trailCount = Math.min(length, ball.trailCount + 1);
  }

  playPegImpact(ball, row) {
    if (row < 0 || row >= this.ROWS) return;
    window.casinoSound?.play('peg', {
      game: 'pachinko',
      impact: 0.28,
      pan: Math.max(-1, Math.min(1, (ball.x / this.W) * 2 - 1))
    });
  }

  completeBall(ball, timestamp) {
    if (ball.visuallySettled) return;
    ball.visuallySettled = true;
    ball.active = false;
    ball.x = this.geometry.slotCenters[ball.serverResult.slotIndex];
    ball.y = this.geometry.landingY;
    ball.confirmAt = timestamp + PachinkoGame.MOTION.resultHoldMs;
    ball.landedSlot = this.slots[ball.serverResult.slotIndex];
    ball.slotType = 'server-settled';
    this.activeSlotGlows.set(ball.serverResult.slotIndex, ball.confirmAt + 420);
    const multiplier = ball.serverResult.multiplier;
    this.results.unshift({ multiplier, winnings: ball.serverResult.payout, bet: ball.bet });
    if (this.results.length > 20) this.results.pop();
    this.renderResults();
    const effect = multiplier >= 10 ? 'pachinkoLandingJackpot' : multiplier >= 3 ? 'pachinkoLandingHigh' : multiplier >= 1 ? 'pachinkoLandingMid' : 'pachinkoLandingLow';
    window.casinoSound?.playOnce(`pachinko:${ball.soundKey}:result`, effect, { volume: multiplier >= 3 ? 0.76 : 0.58, cooldown: 0, game: 'pachinko' });
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

  setPresentationControlsLocked(locked) {
    if (this.betInput) this.betInput.disabled = locked;
    if (this.dropButton) {
      this.dropButton.disabled = false;
      this.dropButton.dataset.consecutive = locked ? 'true' : 'false';
    }
    this.root?.querySelectorAll('.pqb, .prb, .pbb').forEach(control => { control.disabled = locked; });
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
    if (Number.isFinite(this.latestAuthoritativeBalance)) this.casino.setCredits(this.latestAuthoritativeBalance - this.unresolvedPayout);
  }

  revealLatestAuthoritativeBalance() {
    if (!Number.isFinite(this.latestAuthoritativeBalance)) return;
    const balance = this.latestAuthoritativeBalance;
    this.latestAuthoritativeBalance = null;
    this.unresolvedPayout = 0;
    this.pendingBatches.clear();
    this.casino.setCredits(balance);
  }

  renderPayoutLegend() {
    const values = PachinkoGame.MULTIPLIERS[this.risk] || [];
    if (!this.legendElement || !values.length) return;
    const label = this.risk === 'medium' ? 'Medium' : this.risk[0].toUpperCase() + this.risk.slice(1);
    this.legendElement.textContent = `${label} risk · ${Math.min(...values)}×–${Math.max(...values)}×`;
  }

  showStatus(message, type = 'info') {
    if (!this.resultsElement) return;
    this.resultsElement.dataset.status = type;
    if (type === 'error') this.resultsElement.innerHTML = `<div class="pachinko-status-error" role="alert"></div>`;
    const alert = this.resultsElement.querySelector?.('.pachinko-status-error');
    if (alert) alert.textContent = message;
  }

  renderResults() {
    if (!this.resultsElement) return;
    this.resultsElement.dataset.status = 'results';
    this.resultsElement.innerHTML = this.results.slice(0, 8).map((result, index) => {
      const kind = result.multiplier >= 5 ? 'big-win' : result.multiplier >= 1 ? 'win' : 'loss';
      const sign = result.winnings > result.bet ? '+' : '';
      return `<div class="pach-result ${kind}${index === 0 ? ' is-latest' : ''}"><span class="pach-result-mult">${result.multiplier}×</span><span class="pach-result-copy">${sign}${result.winnings} credits</span></div>`;
    }).join('');
  }

  drawStaticBoard() {
    const ctx = this.staticCtx;
    if (!ctx || !this.geometry) return;
    const { width, height, pegs, slots } = this.geometry;
    ctx.clearRect(0, 0, width, height);
    const background = ctx.createLinearGradient(0, 0, 0, height);
    background.addColorStop(0, '#120a19');
    background.addColorStop(0.55, '#090711');
    background.addColorStop(1, '#05060b');
    ctx.fillStyle = background;
    ctx.fillRect(0, 0, width, height);

    const halo = ctx.createRadialGradient(width / 2, height * 0.1, 0, width / 2, height * 0.35, width * 0.52);
    halo.addColorStop(0, 'rgba(192,132,252,.16)');
    halo.addColorStop(1, 'rgba(192,132,252,0)');
    ctx.fillStyle = halo;
    ctx.fillRect(0, 0, width, height * 0.7);

    ctx.strokeStyle = 'rgba(255,220,154,.28)';
    ctx.lineWidth = Math.max(1, width * 0.0025);
    ctx.beginPath();
    ctx.moveTo(width * 0.46, height * 0.018);
    ctx.lineTo(width * 0.485, height * 0.085);
    ctx.moveTo(width * 0.54, height * 0.018);
    ctx.lineTo(width * 0.515, height * 0.085);
    ctx.stroke();

    for (const peg of pegs) {
      ctx.beginPath();
      ctx.arc(peg.x, peg.y, peg.r, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(255,235,194,.82)';
      ctx.shadowColor = 'rgba(255,181,77,.48)';
      ctx.shadowBlur = Math.max(3, width * 0.009);
      ctx.fill();
    }
    ctx.shadowBlur = 0;

    for (const slot of slots) {
      const color = this.slotColor(slot.multiplier);
      ctx.fillStyle = `rgba(${color},.18)`;
      ctx.strokeStyle = `rgba(${color},.58)`;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.roundRect?.(slot.x + 1, slot.y, slot.w - 2, slot.h, Math.min(5, slot.w * 0.18));
      if (typeof ctx.roundRect !== 'function') ctx.rect(slot.x + 1, slot.y, slot.w - 2, slot.h);
      ctx.fill();
      ctx.stroke();
      const label = slot.multiplier >= 100 ? `${slot.multiplier}` : `${slot.multiplier}×`;
      ctx.save();
      ctx.translate(slot.x + slot.w / 2, slot.y + slot.h * 0.58);
      ctx.rotate(-Math.PI / 2);
      ctx.fillStyle = '#fff4dd';
      ctx.font = `800 ${Math.max(8, Math.min(11, slot.w * 0.58))}px "Space Mono", ui-monospace, monospace`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(label, 0, 0);
      ctx.restore();
    }
  }

  slotColor(multiplier) {
    if (multiplier >= 10) return '192,132,252';
    if (multiplier >= 3) return '251,113,133';
    if (multiplier >= 1) return '251,191,36';
    return '100,116,139';
  }

  drawDynamicFrame() {
    const ctx = this.dynamicCtx;
    if (!ctx || !this.geometry) return;
    ctx.clearRect(0, 0, this.W, this.H);
    for (const [slotIndex] of this.activeSlotGlows) {
      const slot = this.slots[slotIndex];
      const color = this.slotColor(slot.multiplier);
      ctx.fillStyle = `rgba(${color},.34)`;
      ctx.shadowColor = `rgb(${color})`;
      ctx.shadowBlur = 18;
      ctx.fillRect(slot.x + 1, slot.y, slot.w - 2, slot.h);
      ctx.shadowBlur = 0;
    }

    for (const ball of this.balls) {
      for (let index = 0; index < ball.trailCount; index += 1) {
        const trailIndex = (ball.trailCursor - ball.trailCount + index + ball.trail.length) % ball.trail.length;
        const point = ball.trail[trailIndex];
        ctx.beginPath();
        ctx.arc(point.x, point.y, ball.r * 0.58, 0, Math.PI * 2);
        ctx.fillStyle = `hsla(${ball.hue},95%,62%,${((index + 1) / ball.trailCount) * 0.24})`;
        ctx.fill();
      }
      if (!ball.active && ball.confirmed) continue;
      const gradient = ctx.createRadialGradient(ball.x - ball.r * 0.35, ball.y - ball.r * 0.4, 1, ball.x, ball.y, ball.r);
      gradient.addColorStop(0, '#fff8d8');
      gradient.addColorStop(0.35, `hsl(${ball.hue},100%,68%)`);
      gradient.addColorStop(1, `hsl(${ball.hue},92%,43%)`);
      ctx.beginPath();
      ctx.arc(ball.x, ball.y, ball.r, 0, Math.PI * 2);
      ctx.fillStyle = gradient;
      ctx.shadowColor = `hsl(${ball.hue},95%,60%)`;
      ctx.shadowBlur = 14;
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.strokeStyle = 'rgba(255,255,255,.72)';
      ctx.lineWidth = 1;
      ctx.stroke();
    }
  }

  handleVisibilityChange() {
    if (document.hidden) {
      this.pauseStartedAt = performance.now();
      if (this.animFrame) cancelAnimationFrame(this.animFrame);
      this.animFrame = null;
      return;
    }
    if (this.pauseStartedAt !== null) {
      const pausedFor = Math.max(0, performance.now() - this.pauseStartedAt);
      for (const ball of this.balls) ball.startedAt += pausedFor;
      this.pauseStartedAt = null;
    }
    if (this.balls.length) this.startAnimation();
  }

  destroy() {
    if (this._destroyed) return;
    this._destroyed = true;
    this.presentationGeneration += 1;
    this.revealLatestAuthoritativeBalance();
    this.queuedBallCount = 0;
    this.setPresentationControlsLocked(false);
    if (this.animFrame) cancelAnimationFrame(this.animFrame);
    if (this.resizeFrame) cancelAnimationFrame(this.resizeFrame);
    this.animFrame = null;
    this.resizeFrame = null;
    for (const handle of this.timerHandles) clearTimeout(handle);
    this.timerHandles.clear();
    this.resizeObserver?.disconnect();
    window.removeEventListener?.('resize', this.boundWindowResize);
    document.removeEventListener?.('visibilitychange', this.boundVisibility);
    this.balls = [];
    this.activeSlotGlows.clear();
  }
}

window.PachinkoGame = PachinkoGame;
