// Casino Main Logic and Credit System

class CasinoManager {
  constructor() {
    this.username = '';
    this.csrfToken = '';
    this.email = null;
    this.emailVerified = false;
    this.credits = 10000; // Starting credits
    this.currentGame = null;
    this.socket = null;
    // Production frontend and API are separate origins; local development uses port 3001.
    const isLocal = ['localhost', '127.0.0.1'].includes(window.location.hostname);
    this.serverUrl = window.CASINO_SERVER_URL || (isLocal ? 'http://localhost:3001' : 'https://api.gary-yong.com');
    this._betPlacementInProgress = false; // Navigation guard flag
    this._lastBalanceFetchAt = null; // When we last fetched balance from API (avoids stale socket overwrite)
    this.init();
  }

  init() {
    // Check if player is already signed in (from session)
    const savedUsername = sessionStorage.getItem('casinoUsername');
    const savedCsrfToken = sessionStorage.getItem('casinoCsrfToken');
    if (savedUsername && savedCsrfToken) {
      this.username = savedUsername;
      this.csrfToken = savedCsrfToken;
      this.restoreSessionAndConnect();
    } else {
      this.showSignInScreen();
    }

    // Auth tab switching
    document.getElementById('loginTab')?.addEventListener('click', () => this.showLoginForm());
    document.getElementById('registerTab')?.addEventListener('click', () => this.showRegisterForm());
    document.querySelectorAll('.password-toggle').forEach(button => button.addEventListener('click', () => this.togglePassword(button)));
    document.getElementById('forgotPasswordBtn')?.addEventListener('click', () => this.showRecoveryDialog());

    document.getElementById('floorNavBtn')?.addEventListener('click', () => this.backToLobby());
    document.getElementById('continueLastGameBtn')?.addEventListener('click', () => this.continueLastGame());
    document.getElementById('takeTourBtn')?.addEventListener('click', () => this.showTour());
    document.getElementById('dailySpinBtn')?.addEventListener('click', () => this.doFreeSpin());

    // Authentication forms
    document.getElementById('loginFormElement')?.addEventListener('submit', event => {
      event.preventDefault();
      this.login();
    });
    document.getElementById('registerFormElement')?.addEventListener('submit', event => {
      event.preventDefault();
      this.register();
    });

    // Header actions
    document.getElementById('logoutBtn')?.addEventListener('click', () => this.logout());
    document.getElementById('betHistoryBtn')?.addEventListener('click', () => this.showBetHistory());
    document.getElementById('leaderboardBtn')?.addEventListener('click', () => this.showLeaderboard());
    document.getElementById('achievementsBtn')?.addEventListener('click', () => this.showAchievements());
    document.getElementById('statsBtn')?.addEventListener('click', () => this.showStats());
    document.getElementById('securityBtn')?.addEventListener('click', () => this.showSecurityDialog());
    document.getElementById('backToLobbyBtn')?.addEventListener('click', () => this.backToLobby());
    document.querySelector('.btn-add-credits')?.addEventListener('click', () => this.doFreeSpin());

    // Mobile menu toggle
    const menuToggleBtn = document.getElementById('mobileMenuToggle');
    if (menuToggleBtn) {
      let lastToggleTime = 0;
      const handleToggle = (e) => {
        e.stopPropagation();
        e.preventDefault();
        const now = Date.now();
        if (now - lastToggleTime < 300) return; // debounce
        lastToggleTime = now;
        this.toggleMobileMenu();
      };
      menuToggleBtn.addEventListener('click', handleToggle);
      menuToggleBtn.addEventListener('touchend', handleToggle);
    }

    // Mobile menu items - use both click and touchend for iOS compatibility
    const mobileMenuActions = [
      { id: 'leaderboardBtnMobile', action: () => this.showLeaderboard() },
      { id: 'achievementsBtnMobile', action: () => this.showAchievements() },
      { id: 'statsBtnMobile', action: () => this.showStats() },
      { id: 'betHistoryBtnMobile', action: () => this.showBetHistory() },
      { id: 'securityBtnMobile', action: () => this.showSecurityDialog() },
      { id: 'logoutBtnMobile', action: () => this.logout() }
    ];
    
    mobileMenuActions.forEach(({ id, action }) => {
      const btn = document.getElementById(id);
      if (!btn) return;
      
      let handled = false;
      const handler = (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (handled) return;
        handled = true;
        setTimeout(() => { handled = false; }, 300);
        this.hideMobileMenu();
        // Small delay to let menu close before showing modal
        setTimeout(() => action(), 50);
      };
      
      btn.addEventListener('touchend', handler, { passive: false });
      btn.addEventListener('click', handler);
    });

    // Close mobile menu when clicking outside
    document.addEventListener('click', (e) => {
      const dropdown = document.getElementById('mobileActionsDropdown');
      const toggle = document.getElementById('mobileMenuToggle');
      if (dropdown && !dropdown.contains(e.target) && toggle && !toggle.contains(e.target)) {
        this.hideMobileMenu();
      }
    });

    // How to Play buttons (lobby cards)
    document.querySelectorAll('.how-to-play-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const game = btn.dataset.game;
        if (game) this.showHowToPlay(game);
      });
    });

    // How to Play button (in-game)
    document.getElementById('inGameHowToPlayBtn')?.addEventListener('click', () => {
      if (this.currentGame) this.showHowToPlay(this.currentGame);
    });

    // Game selection
    document.querySelectorAll('.play-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        console.log('[Casino] Play button clicked');
        const gameCard = e.target.closest('.game-card');
        console.log('[Casino] Game card found:', gameCard);
        const gameName = gameCard?.dataset.game;
        console.log('[Casino] Game name:', gameName);
        if (gameName) {
          console.log(`[Casino] Starting game: ${gameName}`);
          this.startGame(gameName);
        } else {
          console.error('[Casino] No game name found for button click');
        }
      });
    });

    document.querySelectorAll('.neon-bottom-nav-item').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        const action = btn.dataset.navAction;
        this.setBottomNavActive(action);
        if (action === 'floor') {
          this.backToLobby();
          document.getElementById('gameSelection')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        } else if (action === 'live') {
          this.backToLobby();
          document.querySelector('.filter-tab[data-filter="live"]')?.click();
          document.querySelector('.lobby-section-header')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        } else if (action === 'bets') {
          this.showBetHistory();
        } else if (action === 'me') {
          this.showStats();
        }
      });
    });
    
    this.initDialogAccessibility();
    this.handleAccountActionLink();
    console.log(`[Casino] Attached ${document.querySelectorAll('.play-btn').length} play button listeners`);
  }

  initDialogAccessibility() {
    const selector = [
      '.leaderboard-modal', '.achievements-modal', '.stats-modal', '.how-to-play-modal',
      '.bet-history-modal', '.spin-modal-overlay', '.tour-overlay', '.poker-modal',
      '.cs2-betslip-modal', '.credit-history-modal', '.account-modal'
    ].join(',');
    const isVisible = element => element && !element.classList.contains('hidden') && getComputedStyle(element).display !== 'none';
    const visibleDialogs = () => [...document.querySelectorAll(selector)].filter(isVisible);
    const focusable = dialog => [...dialog.querySelectorAll(
      'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
    )].filter(element => element.getClientRects().length > 0);

    const syncDialogs = () => {
      const dialogs = visibleDialogs();
      document.body.classList.toggle('casino-dialog-open', dialogs.length > 0);
      dialogs.forEach(dialog => {
        if (dialog.dataset.a11yDialogReady === 'true') return;
        dialog.dataset.a11yDialogReady = 'true';
        dialog.setAttribute('role', 'dialog');
        dialog.setAttribute('aria-modal', 'true');
        dialog.setAttribute('tabindex', '-1');
        const title = dialog.querySelector('h1, h2, h3, .modal-title, .spin-modal-title, .tour-title');
        if (title) {
          if (!title.id) title.id = `casino-dialog-title-${crypto.randomUUID()}`;
          dialog.setAttribute('aria-labelledby', title.id);
        } else {
          dialog.setAttribute('aria-label', 'Casino dialog');
        }
        this._dialogReturnFocus = document.activeElement;
        requestAnimationFrame(() => (focusable(dialog)[0] || dialog).focus({ preventScroll: true }));
      });
    };

    const observer = new MutationObserver(syncDialogs);
    observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });
    document.addEventListener('keydown', event => {
      const dialog = visibleDialogs().at(-1);
      if (!dialog) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        const close = dialog.querySelector('[data-close], .modal-close, .close-modal, .close-btn, .spin-modal-close, .tour-close, .leaderboard-close, .achievements-close, .stats-close, .bet-history-close');
        if (close) close.click(); else dialog.remove();
        requestAnimationFrame(() => {
          syncDialogs();
          if (!visibleDialogs().length && this._dialogReturnFocus?.isConnected) this._dialogReturnFocus.focus();
        });
        return;
      }
      if (event.key === 'Tab') {
        const items = focusable(dialog);
        if (!items.length) { event.preventDefault(); dialog.focus(); return; }
        const first = items[0];
        const last = items[items.length - 1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
        if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
      }
    });
    syncDialogs();
  }

  setBottomNavActive(action) {
    document.querySelectorAll('.neon-bottom-nav-item').forEach(item => {
      item.classList.toggle('active', item.dataset.navAction === action);
    });
  }

  showLoginForm() {
    document.getElementById('loginTab')?.classList.add('active');
    document.getElementById('registerTab')?.classList.remove('active');
    document.getElementById('loginForm')?.classList.remove('hidden');
    document.getElementById('registerForm')?.classList.add('hidden');
    this.clearErrors();
  }

  showRegisterForm() {
    document.getElementById('registerTab')?.classList.add('active');
    document.getElementById('loginTab')?.classList.remove('active');
    document.getElementById('loginForm')?.classList.add('hidden');
    document.getElementById('registerForm')?.classList.remove('hidden');
    this.clearErrors();
  }

  togglePassword(button) {
    const input = document.getElementById(button.dataset.passwordTarget);
    if (!input) return;
    const showing = input.type === 'text';
    input.type = showing ? 'password' : 'text';
    button.textContent = showing ? 'Show' : 'Hide';
    button.setAttribute('aria-pressed', String(!showing));
    button.setAttribute('aria-label', showing ? 'Show password' : 'Hide password');
    input.focus({ preventScroll: true });
  }

  createAccountModal(title) {
    document.querySelector('.account-modal')?.remove();
    const overlay = document.createElement('div');
    overlay.className = 'account-modal';
    overlay.innerHTML = `<section class="account-modal-card"><button type="button" class="account-modal-close" data-close aria-label="Close">×</button><h2></h2><div class="account-modal-body"></div></section>`;
    overlay.querySelector('h2').textContent = title;
    const close = () => { overlay.remove(); document.body.classList.remove('account-modal-open'); };
    overlay.querySelector('[data-close]').addEventListener('click', close);
    overlay.addEventListener('click', event => { if (event.target === overlay) close(); });
    document.body.classList.add('account-modal-open');
    document.body.appendChild(overlay);
    return { overlay, body: overlay.querySelector('.account-modal-body'), close };
  }

  showRecoveryDialog(token = null) {
    const modal = this.createAccountModal(token ? 'Choose a new password' : 'Reset your password');
    if (token) {
      modal.body.innerHTML = `<form class="account-form"><label>New password<input type="password" name="password" minlength="8" maxlength="128" autocomplete="new-password" required></label><label>Confirm password<input type="password" name="confirm" minlength="8" maxlength="128" autocomplete="new-password" required></label><button class="btn btn-primary" type="submit">Reset password</button><p class="account-form-status" role="status"></p></form>`;
      const form = modal.body.querySelector('form');
      form.addEventListener('submit', async event => {
        event.preventDefault();
        const status = form.querySelector('.account-form-status');
        const password = form.elements.password.value;
        if (password !== form.elements.confirm.value) { status.textContent = 'Passwords do not match.'; return; }
        const response = await this.apiFetch('/api/account/reset-password', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token, password }) });
        const data = await response.json();
        status.textContent = data.message || data.error || 'Unable to reset password.';
        if (response.ok) {
          history.replaceState({}, '', location.pathname);
          setTimeout(() => { modal.close(); this.showLoginForm(); }, 1200);
        }
      });
      return;
    }
    modal.body.innerHTML = `<p>Enter the verified email associated with your account. The response is the same whether or not an account exists.</p><form class="account-form"><label>Email<input type="email" name="email" maxlength="254" autocomplete="email" required></label><button class="btn btn-primary" type="submit">Send reset link</button><p class="account-form-status" role="status"></p></form>`;
    const form = modal.body.querySelector('form');
    form.addEventListener('submit', async event => {
      event.preventDefault();
      const response = await this.apiFetch('/api/account/password-recovery', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: form.elements.email.value }) });
      const data = await response.json();
      form.querySelector('.account-form-status').textContent = data.message || 'If that verified email exists, a reset link has been sent.';
    });
  }

  async handleAccountActionLink() {
    const params = new URLSearchParams(location.search);
    const recoveryToken = params.get('recoveryToken');
    if (recoveryToken) { this.showRecoveryDialog(recoveryToken); return; }
    const verificationToken = params.get('verifyEmailToken');
    if (!verificationToken) return;
    const modal = this.createAccountModal('Verify your email');
    modal.body.innerHTML = '<p class="account-form-status" role="status">Verifying…</p>';
    try {
      const response = await this.apiFetch('/api/account/verify-email', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: verificationToken }) });
      const data = await response.json();
      modal.body.querySelector('.account-form-status').textContent = response.ok ? 'Email verified. You can now use password recovery.' : (data.error || 'Verification failed.');
      if (response.ok) { this.email = data.email; this.emailVerified = true; history.replaceState({}, '', location.pathname); }
    } catch {
      modal.body.querySelector('.account-form-status').textContent = 'Unable to verify the email right now.';
    }
  }

  async fairnessBytes(seedHex, game, clientSeed, nonce, counter) {
    const keyBytes = Uint8Array.from(seedHex.match(/.{2}/g) || [], byte => Number.parseInt(byte, 16));
    const key = await crypto.subtle.importKey('raw', keyBytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    return new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${game}:${clientSeed}:${nonce}:${counter}`)));
  }

  async fairnessInt(proof, maxExclusive, counter = 0) {
    const limit = Math.floor(0x100000000 / maxExclusive) * maxExclusive;
    for (let block = counter; ; block += 1) {
      const bytes = await this.fairnessBytes(proof.serverSeed, proof.game, proof.clientSeed, proof.nonce, block);
      const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      for (let offset = 0; offset <= bytes.length - 4; offset += 4) {
        const value = view.getUint32(offset, false);
        if (value < limit) return value % maxExclusive;
      }
    }
  }

  async verifyFairnessProof(proof) {
    if (!proof?.serverSeed || !proof?.commitment || !proof?.result) return { valid: false, reason: 'Round is not revealed yet' };
    const seed = Uint8Array.from(proof.serverSeed.match(/.{2}/g) || [], byte => Number.parseInt(byte, 16));
    const digest = [...new Uint8Array(await crypto.subtle.digest('SHA-256', seed))].map(byte => byte.toString(16).padStart(2, '0')).join('');
    const verification = { commitmentValid: digest === proof.commitment, outcomeValid: false, game: proof.game };
    if (!verification.commitmentValid) return verification;
    const result = proof.result;
    const same = (left, right) => JSON.stringify(left) === JSON.stringify(right);
    if (proof.game === 'roulette') {
      verification.generated = await this.fairnessInt(proof, 15);
      verification.outcomeValid = verification.generated === result.winningNumber;
    } else if (proof.game === 'daily_bonus') {
      verification.generated = await this.fairnessInt(proof, 8);
      verification.outcomeValid = verification.generated === result.prizeIndex;
    } else if (proof.game === 'coinflip') {
      const value = await this.fairnessInt(proof, 2);
      verification.generated = result.opponent === 'bot' ? (value === 0 ? 'Heads' : 'Tails') : (value === 1 ? 'Heads' : 'Tails');
      verification.outcomeValid = verification.generated === result.coinResult;
    } else if (proof.game === 'crash') {
      const value = await this.fairnessInt(proof, 1_000_000);
      const fraction = value / 1_000_000;
      verification.generated = fraction >= 0.99 ? 1 : Math.max(1, Math.floor(100 * 0.99 / (1 - fraction)) / 100);
      verification.outcomeValid = verification.generated === result.crashPoint;
    } else if (proof.game === 'pachinko') {
      const multipliers = {
        low: [5,2.5,1.6,1.3,1.15,1.05,.95,.9,.85,.9,.95,1.05,1.15,1.3,1.6,2.5,5],
        medium: [50,18,6,3,1.8,1.2,.9,.75,.6,.75,.9,1.2,1.8,3,6,18,50],
        high: [220,55,18,7,2.6,1.25,.78,.48,.28,.48,.78,1.25,2.6,7,18,55,220]
      };
      let counter = 0;
      const generated = [];
      for (let drop = 0; drop < result.count; drop += 1) {
        let slotIndex = 0;
        for (let row = 0; row < 16; row += 1) slotIndex += await this.fairnessInt(proof, 2, counter++);
        generated.push({ slotIndex, multiplier: multipliers[result.risk][slotIndex] });
      }
      verification.generated = generated;
      verification.outcomeValid = same(generated, result.results);
    } else if (proof.game === 'blackjack') {
      const suits = ['hearts','diamonds','clubs','spades'];
      const values = ['2','3','4','5','6','7','8','9','10','jack','queen','king','ace'];
      const deck = suits.flatMap(suit => values.map(value => ({ suit, value })));
      let counter = 0;
      for (let index = deck.length - 1; index > 0; index -= 1) {
        const swap = await this.fairnessInt(proof, index + 1, counter++);
        [deck[index], deck[swap]] = [deck[swap], deck[index]];
      }
      const player = [deck.pop(), deck.pop()];
      const dealer = [deck.pop(), deck.pop()];
      while (player.length < result.playerHand.length) player.push(deck.pop());
      while (dealer.length < result.dealerHand.length) dealer.push(deck.pop());
      verification.generated = { playerHand: player, dealerHand: dealer };
      verification.outcomeValid = same(player, result.playerHand) && same(dealer, result.dealerHand);
    } else if (proof.game === 'poker') {
      const suits = ['h','d','c','s'];
      const ranks = ['2','3','4','5','6','7','8','9','T','J','Q','K','A'];
      const deck = suits.flatMap(suit => ranks.map(rank => rank + suit));
      let counter = 0;
      for (let index = deck.length - 1; index > 0; index -= 1) {
        const swap = await this.fairnessInt(proof, index + 1, counter++);
        [deck[index], deck[swap]] = [deck[swap], deck[index]];
      }
      verification.generated = { deckSha: 'derived locally' };
      verification.outcomeValid = same(deck, result.deck);
    } else {
      verification.reason = 'Unsupported proof game';
    }
    return verification;
  }

  showSecurityDialog() {
    const modal = this.createAccountModal('Account security and fairness');
    const emailText = this.emailVerified ? `Verified email: ${this.email}` : (this.email ? `Verification pending: ${this.email}` : 'No verified recovery email');
    modal.body.innerHTML = `<p class="account-email-status"></p><form class="account-form account-email-form"><label>Add or change recovery email<input type="email" name="email" maxlength="254" autocomplete="email" required></label><button class="btn btn-primary" type="submit">Send verification link</button><p class="account-form-status" role="status"></p></form><hr><h3>Verify a completed game</h3><p>Enter the round ID shown in a completed game result.</p><form class="account-form fairness-form"><label>Round ID<input type="text" name="roundId" maxlength="160" required></label><button class="btn btn-secondary" type="submit">Load proof</button><pre class="fairness-proof" aria-live="polite"></pre></form>`;
    modal.body.querySelector('.account-email-status').textContent = emailText;
    const emailForm = modal.body.querySelector('.account-email-form');
    emailForm.addEventListener('submit', async event => {
      event.preventDefault();
      const response = await this.apiFetch('/api/account/email', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: emailForm.elements.email.value }) });
      const data = await response.json();
      emailForm.querySelector('.account-form-status').textContent = data.message || data.error || 'Unable to send verification email.';
      if (response.ok) { this.email = emailForm.elements.email.value.trim().toLowerCase(); this.emailVerified = false; }
    });
    const fairnessForm = modal.body.querySelector('.fairness-form');
    fairnessForm.addEventListener('submit', async event => {
      event.preventDefault();
      const proof = fairnessForm.querySelector('.fairness-proof');
      proof.textContent = 'Loading proof…';
      try {
        const response = await this.apiFetch(`/api/fairness/proof/${encodeURIComponent(fairnessForm.elements.roundId.value.trim())}`);
        const data = await response.json();
        if (!response.ok) {
          proof.textContent = data.error || 'Proof not found.';
          return;
        }
        const localVerification = await this.verifyFairnessProof(data.proof);
        proof.textContent = JSON.stringify({
          verified: localVerification.commitmentValid === true && localVerification.outcomeValid === true,
          localVerification,
          proof: data.proof
        }, null, 2);
      } catch (error) {
        proof.textContent = `Verification failed: ${error.message}`;
      }
    });
  }

  clearErrors() {
    document.getElementById('loginError')?.classList.add('hidden');
    document.getElementById('registerError')?.classList.add('hidden');
    document.getElementById('registerSuccess')?.classList.add('hidden');
  }

  async apiFetch(path, options = {}) {
    const method = (options.method || 'GET').toUpperCase();
    const headers = { ...(options.headers || {}) };
    if (!['GET', 'HEAD', 'OPTIONS'].includes(method) && this.csrfToken) {
      headers['X-CSRF-Token'] = this.csrfToken;
    }
    return fetch(`${this.serverUrl}${path}`, {
      ...options,
      method,
      headers,
      credentials: 'include'
    });
  }

  async login() {
    const username = document.getElementById('loginUsername')?.value.trim();
    const password = document.getElementById('loginPassword')?.value;

    if (!username || !password) {
      this.showError('loginError', 'Please enter both username and password');
      return;
    }

    try {
      const response = await this.apiFetch('/api/login', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ username, password })
      });

      const data = await response.json();

      if (!response.ok) {
        this.showError('loginError', data.error || 'Login failed');
        return;
      }

      // Success - save username and connect
      this.username = data.username;
      this.credits = data.credits;
      this.csrfToken = data.csrfToken;
      this.email = data.email || null;
      this.emailVerified = Boolean(data.emailVerified);
      sessionStorage.setItem('casinoUsername', this.username);
      sessionStorage.setItem('casinoCsrfToken', this.csrfToken);
      this.updateContinueLastGame();
      this.clearErrors();
      this.connectToServer();
    } catch (error) {
      console.error('Login error:', error);
      this.showError('loginError', 'Connection error. Please try again.');
    }
  }

  async register() {
    const username = document.getElementById('registerUsername')?.value.trim();
    const email = document.getElementById('registerEmail')?.value.trim().toLowerCase();
    const password = document.getElementById('registerPassword')?.value;
    const passwordConfirm = document.getElementById('registerPasswordConfirm')?.value;

    if (!username || !email || !password || !passwordConfirm) {
      this.showError('registerError', 'Please fill in all fields');
      return;
    }

    if (!/^[A-Za-z0-9_-]{3,20}$/.test(username)) {
      this.showError('registerError', 'Use 3–20 letters, numbers, underscores, or hyphens');
      return;
    }

    if (password.length < 8 || password.length > 128) {
      this.showError('registerError', 'Password must be between 8 and 128 characters');
      return;
    }

    if (password !== passwordConfirm) {
      this.showError('registerError', 'Passwords do not match');
      return;
    }

    try {
      const response = await this.apiFetch('/api/register', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ username, email, password })
      });

      const data = await response.json();

      if (!response.ok) {
        this.showError('registerError', data.error || 'Registration failed');
        return;
      }

      // Success - show success message and switch to login
      this.showSuccess('registerSuccess', data.message || 'Account created. Check your email to verify it, then log in.');
      setTimeout(() => {
        this.showLoginForm();
        document.getElementById('loginUsername').value = username;
        document.getElementById('registerUsername').value = '';
        document.getElementById('registerEmail').value = '';
        document.getElementById('registerPassword').value = '';
        document.getElementById('registerPasswordConfirm').value = '';
      }, 1500);
    } catch (error) {
      console.error('Registration error:', error);
      this.showError('registerError', 'Connection error. Please try again.');
    }
  }

  showError(elementId, message) {
    const errorEl = document.getElementById(elementId);
    if (errorEl) {
      errorEl.textContent = message;
      errorEl.classList.remove('hidden');
    }
  }

  showSuccess(elementId, message) {
    const successEl = document.getElementById(elementId);
    if (successEl) {
      successEl.textContent = message;
      successEl.classList.remove('hidden');
    }
  }

  async restoreSessionAndConnect() {
    try {
      const res = await this.apiFetch('/api/session');
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'Session expired');
      this.username = data.username;
      this.credits = data.credits;
      this.csrfToken = data.csrfToken;
      this.email = data.email || null;
      this.emailVerified = Boolean(data.emailVerified);
      sessionStorage.setItem('casinoUsername', this.username);
      sessionStorage.setItem('casinoCsrfToken', this.csrfToken);
      this.updateContinueLastGame();
      this._lastBalanceFetchAt = Date.now();
      this.updateCreditsDisplay();
      this.connectToServer();
    } catch (error) {
      console.warn('[Casino] Session restore failed:', error.message);
      this.clearSession();
      this.showSignInScreen();
    }
  }

  connectToServer() {
    // Log connection attempt
    if (window.casinoDebugLogger) {
      window.casinoDebugLogger.logSocketEvent('connectToServer called', {
        currentGame: this.currentGame,
        hasSocket: !!this.socket,
        username: this.username
      });
    }

    // Initialize socket connection
    if (!this.socket) {
      this.socket = io(this.serverUrl, {
        withCredentials: true,
        auth: { csrfToken: this.csrfToken }
      });

      this.socket.on('connect', () => {
        console.log('[Casino] Connected to server');
        if (window.casinoDebugLogger) {
          window.casinoDebugLogger.logSocketEvent('socket connected', {
            currentGame: this.currentGame
          });
        }
        // Join using the authenticated Socket.IO session.
        this.socket.emit('joinCasino', {}, (result) => {
          if (result?.success) this.loadSidebarData();
        });
      });

      this.socket.on('disconnect', (reason) => {
        console.log('[Casino] Socket disconnected:', reason);
        if (window.casinoDebugLogger) {
          window.casinoDebugLogger.logSocketEvent('socket disconnected', {
            reason,
            currentGame: this.currentGame
          });
        }
      });

      this.socket.on('sessionRevoked', ({ reason } = {}) => {
        this.handleSessionRevoked(reason || 'expired');
      });

      this.socket.on('connect_error', (error) => {
        if (/authentication required|session expired|revoked/i.test(error?.message || '')) {
          this.handleSessionRevoked('expired');
        }
      });

      this.socket.on('reconnect', (attemptNumber) => {
        console.log('[Casino] Socket reconnected after', attemptNumber, 'attempts');
        if (window.casinoDebugLogger) {
          window.casinoDebugLogger.logSocketEvent('socket reconnected', {
            attemptNumber,
            currentGame: this.currentGame
          });
        }
        // Rejoin casino after reconnection
        if (this.username) {
          this.socket.emit('joinCasino', {});
        }
      });

      this.socket.on('playerData', (data) => {
        const socketCredits = data.credits;
        const oldBalance = this.credits;
        if (!Number.isFinite(socketCredits) || socketCredits < 0 || !Number.isSafeInteger(Math.round(socketCredits * 1000))) {
          console.error('[Casino] Rejected invalid canonical balance payload');
          return;
        }

        console.log(`[Casino] playerData received: socket=${socketCredits}, current=${oldBalance}, game=${this.currentGame}`);

        if (window.casinoDebugLogger) {
          window.casinoDebugLogger.logBalanceUpdate(oldBalance, socketCredits, 'socket', {
            currentGame: this.currentGame
          });
        }

        // The server is the only balance authority. Always render its committed value.
        this.credits = socketCredits;
        this.updateCreditsDisplay();
      });

      this.socket.on('error', (error) => {
        console.error('[Casino] Server error:', error);
        if (window.casinoDebugLogger) {
          window.casinoDebugLogger.logError(error, {
            context: 'socket error handler',
            currentGame: this.currentGame
          });
        }
        // Use non-blocking notification instead of alert
        this.showTemporaryError(error?.message || String(error));
      });

      // Achievement notification listener
      this.socket.on('achievementUnlocked', (achievements) => {
        achievements.forEach(achievement => {
          this.showAchievementToast(achievement);
        });
        this.updateAchievementBadge();
      });
    } else {
      // Already connected, rejoin without sending caller-controlled identity.
      this.socket.emit('joinCasino', {});
    }

    // Only show the main screen if not already in a game.
    // This prevents navigation away from games when socket reconnects
    if (!this.currentGame) {
      if (window.casinoDebugLogger) {
        window.casinoDebugLogger.logNavigation('showMainScreen (from connectToServer)', {
          reason: 'not in game'
        });
      }
      this.showMainScreen();
    } else {
      console.log('[Casino] Skipping showMainScreen - already in game:', this.currentGame);
      if (window.casinoDebugLogger) {
        window.casinoDebugLogger.logNavigation('showMainScreen skipped', {
          reason: 'already in game',
          currentGame: this.currentGame
        });
      }
    }
  }

  handleSessionRevoked(reason = 'expired') {
    const socket = this.socket;
    this.socket = null;
    if (socket?.connected) socket.disconnect();
    this.clearSession();
    this.showSignInScreen();
    this.showTemporaryError(reason === 'logout' ? 'Signed out.' : 'Your session expired. Please sign in again.');
  }

  clearSession() {
    this.username = '';
    this.csrfToken = '';
    this.email = null;
    this.emailVerified = false;
    this.credits = 10000;
    sessionStorage.removeItem('casinoUsername');
    sessionStorage.removeItem('casinoCsrfToken');
    this.updateContinueLastGame();
  }

  async logout() {
    try {
      if (this.csrfToken) await this.apiFetch('/api/logout', { method: 'POST' });
    } catch (error) {
      console.warn('[Casino] Logout request failed; clearing the local session:', error.message);
    } finally {
      if (this.socket) {
        this.socket.disconnect();
        this.socket = null;
      }
      this.clearSession();
      this.showSignInScreen();
    }
  }

  showSignInScreen() {
    document.getElementById('signInScreen').classList.remove('hidden');
    document.getElementById('mainCasinoScreen').classList.add('hidden');
  }

  showMainScreen() {
    // Navigation guard: prevent navigation during bet placement
    if (this._betPlacementInProgress) {
      console.warn('[Casino] Navigation blocked - bet placement in progress');
      if (window.casinoDebugLogger) {
        window.casinoDebugLogger.logNavigation('showMainScreen blocked', {
          reason: 'bet placement in progress',
          currentGame: this.currentGame
        });
      }
      return;
    }

    if (window.casinoDebugLogger) {
      window.casinoDebugLogger.logNavigation('showMainScreen', {
        currentGame: this.currentGame,
        stackTrace: new Error().stack
      });
    }

    document.getElementById('signInScreen').classList.add('hidden');
    document.getElementById('mainCasinoScreen').classList.remove('hidden');
    document.getElementById('gameSelection').classList.remove('hidden');
    document.getElementById('gameContainer').classList.add('hidden');
    
    // Update display
    document.getElementById('playerNameDisplay').textContent = this.username;
    this.updateCreditsDisplay();
  }

  setBetPlacementInProgress(inProgress) {
    this._betPlacementInProgress = inProgress;
    if (window.casinoDebugLogger) {
      window.casinoDebugLogger.log('bet', `Bet placement flag: ${inProgress}`, {
        currentGame: this.currentGame
      });
    }
  }

  showTemporaryError(message) {
    // Remove any existing error message
    const existingMsg = document.getElementById('casinoTempError');
    if (existingMsg) {
      existingMsg.remove();
    }

    // Create error message element
    const msgEl = document.createElement('div');
    msgEl.id = 'casinoTempError';
    msgEl.className = 'casino-temp-message casino-temp-message-error';
    msgEl.textContent = message;
    
    // Add to main casino screen
    const mainScreen = document.getElementById('mainCasinoScreen');
    if (mainScreen) {
      mainScreen.appendChild(msgEl);
      
      // Auto-remove after 5 seconds
      setTimeout(() => {
        msgEl.style.opacity = '0';
        msgEl.style.transition = 'opacity 0.3s';
        setTimeout(() => msgEl.remove(), 300);
      }, 5000);
    }
  }

  updateCreditsDisplay() {
    const creditsEl = document.getElementById('creditsAmount');
    if (creditsEl) {
      creditsEl.textContent = this.formatBalance(this.credits);
    }
  }

  loadSidebarData() {
    const leaderboard = document.getElementById('sidebarLeaderboard');
    if (leaderboard && this.socket?.connected) {
      this.socket.emit('getLeaderboard', { type: 'allTime' }, (players = []) => {
        leaderboard.replaceChildren();
        if (!players.length) {
          const empty = document.createElement('div');
          empty.className = 'sidebar-empty';
          empty.textContent = 'No verified results yet.';
          leaderboard.appendChild(empty);
          return;
        }
        players.slice(0, 5).forEach((player, index) => {
          const row = document.createElement('div'); row.className = 'lb-row';
          const rank = document.createElement('span'); rank.className = 'lb-rank'; rank.textContent = String(index + 1);
          const name = document.createElement('span'); name.className = 'lb-name'; name.textContent = String(player.username || 'Player');
          const amount = document.createElement('span');
          amount.className = `lb-amount ${Number(player.netPL) >= 0 ? 'lb-green' : 'lb-pink'}`;
          amount.textContent = `${Number(player.netPL) >= 0 ? '+' : ''}${this.formatCredits(player.netPL || 0)}`;
          row.append(rank, name, amount); leaderboard.appendChild(row);
        });
      });
    }

    if (this.socket?.connected) {
      this.socket.emit('getAchievements', (data = {}) => {
        const earned = Array.isArray(data.achievements) ? data.achievements.length : 0;
        const available = Array.isArray(data.available) ? data.available.length : 18;
        const count = document.querySelector('#sidebarBadges')?.closest('.sidebar-card')?.querySelector('.sidebar-card-sub');
        if (count) count.textContent = `${earned} / ${available}`;
      });
    }
  }

  formatBalance(amount) {
    const value = Number(amount);
    return (Number.isFinite(value) ? value : 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  formatCredits(amount) {
    const value = Number(amount);
    return Math.round(Number.isFinite(value) ? value : 0).toLocaleString();
  }

  escapeHTML(value) {
    return String(value ?? '').replace(/[&<>'"]/g, char => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
    }[char]));
  }

  updateCredits() {
    console.error('[Casino] Rejected client-authoritative balance mutation. Use a server game endpoint.');
    return false;
  }

  updateCreditsLocal(amount) {
    // For SERVER-SIDE games (crash, roulette, coinflip) — display only, server already knows
    this.credits += amount;
    if (this.credits < 0) this.credits = 0;
    this.updateCreditsDisplay();
  }

  setCredits(amount) {
    // Set credits to an absolute value (used when we know the exact balance from server)
    this.credits = Math.max(0, amount);
    this.updateCreditsDisplay();
    // Only mark manual update for CS2 betting (which uses REST API, not socket)
    // Other games use socket and should not be blocked
    if (this.currentGame === 'cs2betting') {
      this._lastManualCreditUpdate = Date.now();
    }
  }

  getSocket() {
    return this.socket;
  }

  gameDefinitions() {
    return {
      blackjack: { label: 'Blackjack', viewId: 'blackjackGame', constructors: ['BlackjackGame'] },
      coinflip: { label: 'Coin Flip', viewId: 'coinflipGame', constructors: ['CoinflipGame'] },
      roulette: { label: 'Roulette', viewId: 'rouletteGame', constructors: ['RouletteGame'] },
      cs2betting: { label: 'CS2 Betting', viewId: 'cs2BettingGame', constructors: ['CS2ModernBettingGame', 'CS2BettingGame'] },
      poker: { label: 'Texas Hold’em', viewId: 'pokerGame', constructors: ['PokerGame'] },
      crash: { label: 'Crash', viewId: 'crashGame', constructors: ['CrashGame'] },
      pachinko: { label: 'Pachinko', viewId: 'pachinkoGame', constructors: ['PachinkoGame'] },
      cases: { label: 'CS Cases', viewId: 'caseOpeningGame', constructors: ['CaseOpeningGame'] }
    };
  }

  lastGameStorageKey() {
    return this.username ? `neon777.lastGame.${this.username}` : null;
  }

  updateContinueLastGame() {
    const button = document.getElementById('continueLastGameBtn');
    const hint = document.getElementById('continueLastGameHint');
    if (!button) return;
    const key = this.lastGameStorageKey();
    let game = null;
    try { game = key ? localStorage.getItem(key) : null; } catch { game = null; }
    const definition = this.gameDefinitions()[game];
    const available = Boolean(definition && document.getElementById(definition.viewId) && definition.constructors.some(name => typeof window[name] === 'function'));
    button.disabled = !available;
    button.textContent = available ? `RETURN TO ${definition.label.toUpperCase()}` : 'CONTINUE LAST GAME';
    if (hint) hint.textContent = available ? `Opens ${definition.label}. Active-round recovery depends on the game.` : 'Choose a game to enable Continue.';
    if (game && !definition && key) try { localStorage.removeItem(key); } catch { /* ignore */ }
  }

  startGame(gameName) {
    console.log(`[Casino] startGame called with: ${gameName}`);
    
    if (window.casinoDebugLogger) {
      window.casinoDebugLogger.logNavigation('startGame', {
        gameName,
        previousGame: this.currentGame,
        stackTrace: new Error().stack
      });
    }
    
    const definition = this.gameDefinitions()[gameName];
    const gameView = definition ? document.getElementById(definition.viewId) : null;
    const GameConstructor = definition?.constructors.map(name => window[name]).find(candidate => typeof candidate === 'function');
    if (!definition || !gameView || !GameConstructor) {
      console.error(`[Casino] Game is unavailable: ${gameName}`);
      this._toast('That game is temporarily unavailable. Please choose another game.');
      this.updateContinueLastGame();
      return false;
    }

    // Clear manual update flag when switching games to allow socket updates
    if (this.currentGame !== gameName) {
      this._lastManualCreditUpdate = null;
    }

    this.currentGame = gameName;
    document.body.classList.toggle('casino-game-active', Boolean(gameName));
    document.body.dataset.currentCasinoGame = gameName;
    this.setBottomNavActive(null);
    // Last-game state is persisted only after successful initialization.
    
    const gameSelectionEl = document.getElementById('gameSelection');
    const gameContainerEl = document.getElementById('gameContainer');
    
    if (!gameSelectionEl || !gameContainerEl) {
      console.error('[Casino] Game selection or container element not found!');
      if (window.casinoDebugLogger) {
        window.casinoDebugLogger.logError(new Error('Game selection or container element not found'), {
          context: 'startGame',
          gameName
        });
      }
      return;
    }
    
    gameSelectionEl.classList.add('hidden');
    gameContainerEl.classList.remove('hidden');

    // Clean up previous game instance
    if (window.currentGameInstance) {
      console.log('[Casino] Cleaning up previous game instance');
      window.currentGameInstance.destroy?.();
      window.currentGameInstance = null;
    }

    // Hide all games
    document.querySelectorAll('.game-view').forEach(view => {
      view.classList.add('hidden');
    });

    console.log(`[Casino] Showing game view: ${definition.viewId}`);
    gameView.classList.remove('hidden');

    try {
      window.currentGameInstance = new GameConstructor(this);
      const key = this.lastGameStorageKey();
      if (key) localStorage.setItem(key, gameName);
      try { localStorage.removeItem('neon777.lastGame'); } catch { /* discard legacy cross-account key */ }
      this.updateContinueLastGame();
      return true;
    } catch (error) {
      console.error(`[Casino] Error initializing game ${gameName}:`, error);
      window.currentGameInstance = null;
      this.currentGame = null;
      gameView.classList.add('hidden');
      gameContainerEl.classList.add('hidden');
      gameSelectionEl.classList.remove('hidden');
      document.body.classList.remove('casino-game-active');
      delete document.body.dataset.currentCasinoGame;
      this._toast('That game failed to load. Please try again.');
      return false;
    }
  }

  backToLobby() {
    if (this._betPlacementInProgress) {
      console.warn('[Casino] Back to lobby blocked - bet placement in progress');
      if (window.casinoDebugLogger) {
        window.casinoDebugLogger.logNavigation('backToLobby blocked', {
          reason: 'bet placement in progress',
          currentGame: this.currentGame
        });
      }
      return;
    }
    if (window.casinoDebugLogger) {
      window.casinoDebugLogger.logNavigation('backToLobby', {
        currentGame: this.currentGame,
        stackTrace: new Error().stack
      });
    }

    document.getElementById('gameContainer').classList.add('hidden');
    document.getElementById('gameSelection').classList.remove('hidden');
    this.currentGame = null;
    document.body.classList.remove('casino-game-active');
    delete document.body.dataset.currentCasinoGame;
    this.setBottomNavActive('floor');

    if (window.currentGameInstance) {
      window.currentGameInstance.destroy?.();
      window.currentGameInstance = null;
    }
  }

  // ========== NEON 777 — DAILY SPIN ==========
  // Availability and prizes are enforced by the server.
  doFreeSpin() {
    this._showSpinModal({ locked: false });
  }

  _showSpinModal({ locked, hoursLeft }) {
    const existing = document.getElementById('spinModalOverlay');
    if (existing) existing.remove();

    const prizes = [
      { label: '+100',    color: 'var(--cream)',       credits: 100 },
      { label: '+250',    color: 'var(--amber)',       credits: 250 },
      { label: '+50',     color: 'var(--cream)',       credits: 50 },
      { label: '+500',    color: 'var(--neon-pink)',   credits: 500 },
      { label: '+100',    color: 'var(--cream)',       credits: 100 },
      { label: '+300',    color: 'var(--neon-violet)', credits: 300 },
      { label: '+250',    color: 'var(--amber)',       credits: 250 },
      { label: 'JACKPOT', color: 'var(--neon-red)',    credits: 2500 },
    ];
    const seg = 360 / prizes.length;
    const gradient = prizes.map((p, i) => `${p.color} ${i * seg}deg ${(i + 1) * seg}deg`).join(',');

    const overlay = document.createElement('div');
    overlay.id = 'spinModalOverlay';
    overlay.className = 'spin-modal-overlay';
    overlay.innerHTML = `
      <div class="spin-modal-content" role="dialog" aria-labelledby="spinModalTitle">
        <div class="spin-modal-header">
          <h2 id="spinModalTitle" class="spin-modal-title">DAILY SPIN</h2>
          <button class="spin-modal-close" aria-label="Close">&times;</button>
        </div>
        <div class="spin-modal-body">
          ${locked ? `
            <div class="spin-locked">
              <div class="spin-locked-icon">⏳</div>
              <div class="spin-locked-heading">Come back later</div>
              <div class="spin-locked-sub">Next pull in about <b>${hoursLeft} hr${hoursLeft === 1 ? '' : 's'}</b></div>
            </div>
          ` : `
            <div class="spin-wheel-wrap">
              <div class="spin-wheel-pointer"></div>
              <div class="spin-wheel" id="spinWheel" style="background:conic-gradient(${gradient});" role="img" aria-label="Daily prize wheel">
                <div class="spin-wheel-label-ring">
                  ${prizes.map((p, i) => `
                    <div class="spin-wheel-segment-label" style="--segment-angle:${(i + 0.5) * seg}deg"><span>${p.label}</span></div>
                  `).join('')}
                </div>
              </div>
              <div class="spin-wheel-hub">777</div>
            </div>
            <div class="spin-prize-result" id="spinPrizeResult"></div>
            <button class="spin-pull-btn" id="spinPullBtn">PULL THE LEVER</button>
          `}
        </div>
      </div>
    `;
    document.body.appendChild(overlay);

    const spinTickTimers = [];
    const clearSpinTicks = () => { while (spinTickTimers.length) clearTimeout(spinTickTimers.pop()); };
    const close = () => { clearSpinTicks(); overlay.remove(); };
    overlay.querySelector('.spin-modal-close')?.addEventListener('click', close);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });

    if (locked) return;

    const pullBtn = overlay.querySelector('#spinPullBtn');
    const wheel = overlay.querySelector('#spinWheel');
    const resultEl = overlay.querySelector('#spinPrizeResult');
    let spinning = false;

    pullBtn.addEventListener('click', async () => {
      if (spinning) return;
      spinning = true;
      pullBtn.disabled = true;
      pullBtn.textContent = 'SPINNING…';
      resultEl.textContent = '';

      try {
        const response = await this.apiFetch('/api/daily-bonus', { method: 'POST' });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || 'Daily spin is unavailable');
        const idx = data.prizeIndex;
        const prize = prizes[idx];
        // The award is authoritative as soon as the response succeeds. Keep the
        // shell balance synchronized even if the modal is closed mid-animation.
        this.setCredits(data.balance);
        const fill = document.querySelector('.freepull-streak-fill');
        if (fill) fill.style.width = Math.min(100, (data.streak / 7) * 100) + '%';
        const label = document.querySelector('.freepull-streak-label');
        if (label) label.textContent = `Streak: ${data.streak} day${data.streak === 1 ? '' : 's'}`;
        const baseTurns = 6;
        const targetDeg = 360 - (idx * seg + seg / 2);
        wheel.style.transition = 'transform 3.2s cubic-bezier(.2,.7,.15,1)';
        wheel.style.transform = `rotate(${baseTurns * 360 + targetDeg}deg)`;
        const spinSoundKey = `daily-wheel:${data.balance}:${idx}`;
        window.casinoSound?.playOnce(`${spinSoundKey}:spin`, 'wheelSpin', { game: 'lobby' });
        let tickAt = 0;
        for (let tick = 0; tick < 30; tick += 1) {
          tickAt += 58 + tick * 3.2;
          if (tickAt >= 3150) break;
          spinTickTimers.push(setTimeout(() => {
            if (overlay.isConnected) window.casinoSound?.play('wheelTick', { cooldown: 0, game: 'lobby' });
          }, tickAt));
        }

        const resultTimer = setTimeout(() => {
          clearSpinTicks();
          if (!overlay.isConnected) return;
          const prizeText = document.createElement('span');
          prizeText.className = 'spin-result-prize';
          prizeText.textContent = prize.label;
          const detail = document.createElement('span');
          detail.className = 'spin-result-sub';
          detail.textContent = `Added to your balance · +${this.formatCredits(data.prize)}`;
          resultEl.replaceChildren(prizeText, detail);
          pullBtn.textContent = 'COME BACK TOMORROW';
          window.casinoSound?.playOnce(`${spinSoundKey}:result`, 'wheelResult', { game: 'lobby' });
        }, 3300);
        spinTickTimers.push(resultTimer);
      } catch (error) {
        clearSpinTicks();
        spinning = false;
        pullBtn.disabled = false;
        pullBtn.textContent = 'TRY AGAIN';
        resultEl.textContent = error.message;
      }
    });
  }

  // ========== NEON 777 — CONTINUE LAST GAME ==========
  continueLastGame() {
    const key = this.lastGameStorageKey();
    let last = null;
    try { last = key ? localStorage.getItem(key) : null; } catch { last = null; }
    const definition = this.gameDefinitions()[last];
    if (!definition) {
      if (key) try { localStorage.removeItem(key); } catch { /* ignore */ }
      this.updateContinueLastGame();
      this._toast('No available recent game — pick one below.');
      return false;
    }
    return this.startGame(last);
  }

  // ========== NEON 777 — TOUR ==========
  showTour() {
    const existing = document.getElementById('tourOverlay');
    if (existing) { existing.remove(); return; }

    const steps = [
      { icon: '🎰', title: 'Seven games', body: 'Blackjack, Roulette, Coinflip, Crash, Pachinko, Hold’em, and available CS2 match odds.' },
      { icon: '💎', title: 'Virtual bankroll', body: 'You start with 10,000 virtual credits. Server-settled wagers and results are written to your history.' },
      { icon: '🎡', title: 'Daily pull', body: 'Once per eligibility window, the server awards one free credit prize.' },
      { icon: '🏆', title: 'Leaderboards', body: 'Verified game results determine the rankings.' },
    ];

    const overlay = document.createElement('div');
    overlay.id = 'tourOverlay';
    overlay.className = 'tour-overlay';
    overlay.innerHTML = `
      <div class="tour-content">
        <div class="tour-header">
          <h2 class="tour-title">TAKE THE TOUR</h2>
          <button class="tour-close" aria-label="Close">&times;</button>
        </div>
        <div class="tour-steps" role="region" aria-label="Casino tour steps" tabindex="0">
          ${steps.map((s, i) => `
            <div class="tour-step">
              <div class="tour-step-icon" aria-hidden="true">${s.icon}</div>
              <div class="tour-step-body">
                <div class="tour-step-title">${String(i + 1).padStart(2, '0')} · ${s.title}</div>
                <div class="tour-step-copy">${s.body}</div>
              </div>
            </div>
          `).join('')}
        </div>
        <div class="tour-footer">
          <button class="tour-cta" id="tourStartBtn">ENTER THE FLOOR</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);

    const close = () => overlay.remove();
    overlay.querySelector('.tour-close')?.addEventListener('click', close);
    overlay.querySelector('#tourStartBtn')?.addEventListener('click', close);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
  }

  // ========== NEON 777 — TOAST ==========
  _toast(msg) {
    let host = document.getElementById('neonToastHost');
    if (!host) {
      host = document.createElement('div');
      host.id = 'neonToastHost';
      host.className = 'neon-toast-host';
      document.body.appendChild(host);
    }
    const t = document.createElement('div');
    t.className = 'neon-toast';
    t.textContent = msg;
    host.appendChild(t);
    setTimeout(() => { t.style.opacity = '0'; t.style.transform = 'translateY(-8px)'; }, 2400);
    setTimeout(() => t.remove(), 3000);
  }

  // ========== BET HISTORY ==========

  recordBet() {
    // Bet history is written only by authoritative server settlements.
  }

  getBetHistory(limit = 100) {
    return new Promise((resolve) => {
      if (!this.socket || !this.socket.connected) { 
        console.warn('[Bet History] Socket not connected');
        resolve([]); 
        return; 
      }
      
      // Add timeout to prevent hanging Promise
      const timeout = setTimeout(() => {
        console.warn('[Bet History] Request timed out after 5 seconds');
        resolve([]);
      }, 5000);
      
      this.socket.emit('getBetHistory', { limit }, (history) => {
        clearTimeout(timeout);
        console.log('[Bet History] Received history:', history?.length || 0, 'entries');
        resolve(history || []);
      });
    });
  }

  _bhRelativeTime(ts) {
    const diff = Date.now() - new Date(ts).getTime();
    const s = Math.floor(diff / 1000);
    if (s < 60) return 'just now';
    const m = Math.floor(s / 60);
    if (m < 60) return `${m}m ago`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h}h ago`;
    const d = Math.floor(h / 24);
    if (d < 7) return `${d}d ago`;
    return new Date(ts).toLocaleDateString();
  }

  _bhGameLabel(game) {
    const labels = {
      blackjack: 'Blackjack',
      pachinko: 'Pachinko',
      roulette: 'Roulette',
      crash: 'Crash',
      coinflip: 'Coin Flip',
      poker: 'Poker',
      cs2betting: 'CS2 Betting'
    };
    return labels[game] || 'Unknown';
  }

  _bhRenderList(history, filterMode) {
    const ICONS = { blackjack: '🃏', pachinko: '🔮', roulette: '🎰', crash: '📈', coinflip: '🪙', poker: '♠️', cs2betting: '🎮' };
    let filtered;
    if (filterMode === 'win') {
      filtered = history.filter(h => (h.payout || 0) > (h.bet || 0));
    } else if (filterMode === 'loss') {
      filtered = history.filter(h => (h.payout || 0) <= (h.bet || 0));
    } else {
      filtered = history;
    }
    if (filtered.length === 0) {
      const msg = filterMode === 'win' ? 'No winning bets yet. Keep playing!' :
                  filterMode === 'loss' ? 'No losses on record. Lucky you!' :
                  'No bets yet. Start playing!';
      return `<div class="bh-empty">${msg}</div>`;
    }
    return filtered.map(h => {
      const net = (h.payout || 0) - (h.bet || 0);
      const isWin = net > 0;
      const icon = ICONS[h.game] || '🎲';
      const label = this._bhGameLabel(h.game);
      const time = this._bhRelativeTime(h.timestamp);
      const fullTime = new Date(h.timestamp).toLocaleString();
      const mult = h.multiplier ? ` <span class="bh-mult">${parseFloat(h.multiplier).toFixed(2)}x</span>` : '';
      return `<div class="bh-row ${isWin ? 'win' : 'loss'}">
        <div class="bh-game-icon">${icon}</div>
        <div class="bh-game-name">${label}${mult}</div>
        <div class="bh-bet">${this.formatCredits(h.bet || 0)}</div>
        <div class="bh-result-badge ${isWin ? 'win' : 'loss'}">${isWin ? 'WIN' : 'LOSS'}</div>
        <div class="bh-payout ${isWin ? 'profit' : 'loss'}" title="${fullTime}">${isWin ? '+' : ''}${this.formatCredits(net)}</div>
      </div>`;
    }).join('');
  }

  _bhInjectMarqueeBulbs(wrapEl) {
    // Generate SVG light bulbs around the full-width header wrap — theater marquee style
    const ns = 'http://www.w3.org/2000/svg';
    const w = wrapEl.offsetWidth;
    const h = wrapEl.offsetHeight;
    if (!w || !h) return;
    const r = 2;
    const spacing = 12;
    const circles = [];
    let delay = 0;
    // Top row
    for (let x = spacing; x <= w - spacing / 2; x += spacing) {
      circles.push(`<circle cx="${Math.round(x)}" cy="${r}" r="${r}" style="animation-delay:${((delay++ * 0.17) % 3).toFixed(2)}s"/>`);
    }
    // Bottom row
    for (let x = spacing; x <= w - spacing / 2; x += spacing) {
      circles.push(`<circle cx="${Math.round(x)}" cy="${h - r}" r="${r}" style="animation-delay:${((delay++ * 0.17) % 3).toFixed(2)}s"/>`);
    }
    // Left column (skip corners)
    for (let y = spacing * 1.5; y <= h - spacing * 1.5; y += spacing) {
      circles.push(`<circle cx="${r}" cy="${Math.round(y)}" r="${r}" style="animation-delay:${((delay++ * 0.17) % 3).toFixed(2)}s"/>`);
    }
    // Right column (skip corners)
    for (let y = spacing * 1.5; y <= h - spacing * 1.5; y += spacing) {
      circles.push(`<circle cx="${w - r}" cy="${Math.round(y)}" r="${r}" style="animation-delay:${((delay++ * 0.17) % 3).toFixed(2)}s"/>`);
    }
    const svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('class', 'bh-bulbs-svg');
    svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
    svg.innerHTML = circles.join('');
    wrapEl.appendChild(svg);
  }

  async showBetHistory() {
    const history = await this.getBetHistory(100);
    document.getElementById('betHistoryModal')?.remove();

    const modal = document.createElement('div');
    modal.id = 'betHistoryModal';
    modal.className = 'bet-history-modal';

    let totalWagered = 0, totalPayout = 0, wins = 0;
    history.forEach(h => {
      totalWagered += h.bet || 0;
      totalPayout += h.payout || 0;
      if ((h.payout || 0) > (h.bet || 0)) wins++;
    });
    const netProfit = totalPayout - totalWagered;
    const winRate = history.length > 0 ? Math.round((wins / history.length) * 100) : 0;
    const losses = history.length - wins;

    modal.innerHTML = `
      <div class="bet-history-content">
        <div class="bh-header-wrap" id="bhHeaderWrap">
          <h2 class="bh-header-title">BET HISTORY</h2>
          <button class="bet-history-close" id="bhCloseBtn">✕</button>
        </div>
        <div class="bet-history-summary">
          <div class="bh-stat">
            <span class="bh-label">Wagered</span>
            <span class="bh-value">${this.formatCredits(totalWagered)}</span>
          </div>
          <div class="bh-stat">
            <span class="bh-label">Net P/L</span>
            <span class="bh-value ${netProfit >= 0 ? 'profit' : 'loss'}">${netProfit >= 0 ? '+' : ''}${this.formatCredits(netProfit)}</span>
          </div>
          <div class="bh-stat">
            <span class="bh-label">Win Rate</span>
            <span class="bh-value ${winRate >= 50 ? 'profit' : ''}">${winRate}%</span>
          </div>
          <div class="bh-stat">
            <span class="bh-label">Bets</span>
            <span class="bh-value">${history.length}</span>
          </div>
        </div>
        <div class="bh-filters">
          <span class="bh-filters-label">Filter</span>
          <button class="bh-filter active" data-filter="all">ALL</button>
          <button class="bh-filter" data-filter="win">WIN <span style="opacity:.6;font-size:10px">${wins}</span></button>
          <button class="bh-filter" data-filter="loss">LOSS <span style="opacity:.6;font-size:10px">${losses}</span></button>
        </div>
        <div class="bet-history-list" id="bhList" role="region" aria-label="Bet history entries" tabindex="0">
          ${this._bhRenderList(history, 'all')}
        </div>
      </div>
    `;

    document.body.appendChild(modal);

    // Inject marquee bulbs around full-width header after DOM is rendered
    requestAnimationFrame(() => {
      const wrapEl = document.getElementById('bhHeaderWrap');
      if (wrapEl) this._bhInjectMarqueeBulbs(wrapEl);
    });

    // Filter click handlers (ALL / WIN / LOSS)
    modal.querySelectorAll('.bh-filter').forEach(btn => {
      btn.addEventListener('click', () => {
        modal.querySelectorAll('.bh-filter').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        document.getElementById('bhList').innerHTML = this._bhRenderList(history, btn.dataset.filter);
      });
    });

    document.getElementById('bhCloseBtn').addEventListener('click', () => modal.remove());
    modal.addEventListener('click', (e) => { if (e.target === modal) modal.remove(); });
  }

  showHowToPlay(game) {
    document.getElementById('howToPlayModal')?.remove();

    const content = this._getHowToPlayContent(game);
    if (!content) return;

    const modal = document.createElement('div');
    modal.id = 'howToPlayModal';
    modal.className = 'how-to-play-modal';
    modal.innerHTML = `
      <div class="how-to-play-content">
        <div class="how-to-play-header">
          <h2>${content.icon} How to Play — ${content.title}</h2>
          <button class="how-to-play-close" id="htpCloseBtn">✕</button>
        </div>
        <div class="how-to-play-body" tabindex="0" aria-label="Game instructions">
          ${content.body}
        </div>
      </div>
    `;

    document.body.appendChild(modal);
    document.getElementById('htpCloseBtn').addEventListener('click', () => modal.remove());
    modal.addEventListener('click', (e) => { if (e.target === modal) modal.remove(); });
  }

  _getHowToPlayContent(game) {
    const guides = {
      blackjack: {
        icon: '🃏', title: 'Blackjack',
        body: `
          <div class="htp-section">
            <h3>🎯 Objective</h3>
            <ul>
              <li>Get a hand value closer to <strong>21</strong> than the dealer — without going over.</li>
              <li>If you bust (go over 21), you lose immediately.</li>
            </ul>
          </div>
          <div class="htp-section">
            <h3>🃏 Card Values</h3>
            <table class="htp-table">
              <tr><th>Card</th><th>Value</th></tr>
              <tr><td>2 – 10</td><td>Face value</td></tr>
              <tr><td>J, Q, K</td><td>10</td></tr>
              <tr><td>Ace</td><td>1 or 11 (whichever helps more)</td></tr>
            </table>
          </div>
          <div class="htp-section">
            <h3>🎮 Actions</h3>
            <ul>
              <li><strong>Hit</strong> — Draw another card</li>
              <li><strong>Stand</strong> — Keep your current hand</li>
              <li><strong>Double Down</strong> — Double your bet and receive exactly one more card</li>
              <li><strong>Split</strong> — Split two same-rank cards into two hands</li>
            </ul>
          </div>
          <div class="htp-section">
            <h3>💰 Payouts</h3>
            <ul>
              <li>Win vs dealer: <span class="htp-tag green">2×</span> your bet</li>
              <li>Blackjack (Ace + 10-value on first deal): <span class="htp-tag green">2.5×</span></li>
              <li>Tie (push): <span class="htp-tag">Bet returned</span></li>
            </ul>
          </div>
          <div class="htp-section">
            <h3>📋 Dealer Rules</h3>
            <ul>
              <li>Dealer must hit on 16 or below and stand on 17 or above.</li>
            </ul>
          </div>
        `
      },
      coinflip: {
        icon: '🪙', title: 'Coin Flip',
        body: `
          <div class="htp-section">
            <h3>🎯 Objective</h3>
            <ul>
              <li>Predict whether the coin lands <strong>Heads</strong> or <strong>Tails</strong>.</li>
              <li>Correct guess doubles your bet. Wrong guess and you lose it.</li>
            </ul>
          </div>
          <div class="htp-section">
            <h3>🎮 Game Modes</h3>
            <ul>
              <li><strong>vs Bot</strong> — Play instantly against AI</li>
              <li><strong>Create Room</strong> — Create a private room and share the code</li>
              <li><strong>Join Room</strong> — Enter a room code to join a friend's game</li>
            </ul>
          </div>
          <div class="htp-section">
            <h3>💰 Payouts</h3>
            <ul>
              <li>Win: <span class="htp-tag green">2×</span> your bet (0% house edge — completely fair)</li>
              <li>In PvP mode, the winner takes the other player's bet</li>
            </ul>
          </div>
          <div class="htp-section">
            <h3>📋 Notes</h3>
            <ul>
              <li>This is the fairest game in the casino — no house edge.</li>
              <li>Both players must commit their bet before the flip happens.</li>
            </ul>
          </div>
        `
      },
      roulette: {
        icon: '🎲', title: 'Roulette',
        body: `
          <div class="htp-section">
            <h3>🎯 Objective</h3>
            <ul>
              <li>Predict where the ball lands on a custom <strong>14-number</strong> wheel.</li>
              <li>Place your bets, spin, and collect if you guess right.</li>
            </ul>
          </div>
          <div class="htp-section">
            <h3>🎲 Bet Types & Payouts</h3>
            <table class="htp-table">
              <tr><th>Bet</th><th>Covers</th><th>Payout</th></tr>
              <tr><td>Single Number</td><td>1 slot</td><td><span class="htp-tag green">14×</span></td></tr>
              <tr><td>Color (Red/Black)</td><td>~half the wheel</td><td><span class="htp-tag green">2×</span></td></tr>
              <tr><td>Low (1–7)</td><td>7 numbers</td><td><span class="htp-tag green">2×</span></td></tr>
              <tr><td>High (8–14)</td><td>7 numbers</td><td><span class="htp-tag green">2×</span></td></tr>
            </table>
          </div>
          <div class="htp-section">
            <h3>📋 Notes</h3>
            <ul>
              <li>Custom 14-number wheel (not a standard 0–36 European wheel).</li>
              <li>House edge: ~6.67%</li>
              <li>You can place multiple bets in a single spin.</li>
            </ul>
          </div>
        `
      },
      crash: {
        icon: '🚀', title: 'Crash',
        body: `
          <div class="htp-section">
            <h3>🎯 Objective</h3>
            <ul>
              <li>A multiplier starts at <strong>1×</strong> and rises rapidly.</li>
              <li>Cash out before it crashes to win: <strong>bet × multiplier</strong>.</li>
              <li>Wait too long and the rocket crashes — you lose your entire bet.</li>
            </ul>
          </div>
          <div class="htp-section">
            <h3>🎮 How to Play</h3>
            <ul>
              <li>Enter your bet amount and click <strong>Place Bet</strong></li>
              <li>Watch the multiplier climb and hit <strong>Cash Out</strong> at the right moment</li>
              <li>Set an <strong>Auto Cash Out</strong> target to exit automatically at your chosen multiplier</li>
            </ul>
          </div>
          <div class="htp-section">
            <h3>💰 Payouts</h3>
            <ul>
              <li>Cash out at 2×: <span class="htp-tag green">2× your bet</span></li>
              <li>Cash out at 5×: <span class="htp-tag green">5× your bet</span></li>
              <li>Crash before you cash out: <span class="htp-tag red">Lose your bet</span></li>
            </ul>
          </div>
          <div class="htp-section">
            <h3>📋 Notes</h3>
            <ul>
              <li>House edge: ~1% (one of the fairest games here).</li>
              <li>The crash point is determined before the round starts — timing is everything.</li>
            </ul>
          </div>
        `
      },
      poker: {
        icon: '♠️', title: 'Texas Hold\'em Poker',
        body: `
          <div class="htp-section">
            <h3>🎯 Objective</h3>
            <ul>
              <li>Make the best 5-card hand using your 2 hole cards + 5 community cards.</li>
              <li>Win the pot by having the best hand or forcing everyone else to fold.</li>
            </ul>
          </div>
          <div class="htp-section">
            <h3>🎮 Round Structure</h3>
            <ul>
              <li><strong>Pre-Flop</strong> — 2 hole cards dealt. Bet or fold.</li>
              <li><strong>Flop</strong> — 3 community cards revealed. Another round of betting.</li>
              <li><strong>Turn</strong> — 1 more community card. Bet again.</li>
              <li><strong>River</strong> — Final community card. Last chance to bet.</li>
              <li><strong>Showdown</strong> — Best hand wins the pot.</li>
            </ul>
          </div>
          <div class="htp-section">
            <h3>🃏 Hand Rankings (Best → Worst)</h3>
            <ul>
              <li>Royal Flush → Straight Flush → Four of a Kind</li>
              <li>Full House → Flush → Straight</li>
              <li>Three of a Kind → Two Pair → Pair → High Card</li>
            </ul>
          </div>
          <div class="htp-section">
            <h3>🎮 Actions</h3>
            <ul>
              <li><strong>Check</strong> — Pass without betting (only if no one has bet yet)</li>
              <li><strong>Call</strong> — Match the current bet</li>
              <li><strong>Raise</strong> — Increase the bet</li>
              <li><strong>Fold</strong> — Give up your hand and forfeit bets placed</li>
            </ul>
          </div>
          <div class="htp-section">
            <h3>📋 Notes</h3>
            <ul>
              <li>2–6 players per table. No rake (play-money, fair game).</li>
              <li>Create or join a table from the poker lobby.</li>
            </ul>
          </div>
        `
      },
      cs2betting: {
        icon: '🎮', title: 'CS2 Match Betting',
        body: `
          <div class="htp-section">
            <h3>🎯 Objective</h3>
            <ul>
              <li>Bet credits on real Counter-Strike 2 esports matches.</li>
              <li>Pick the winning team and multiply your credits based on the odds.</li>
            </ul>
          </div>
          <div class="htp-section">
            <h3>🎮 How to Bet</h3>
            <ul>
              <li>Browse upcoming matches (updated every 2 hours from bo3.gg)</li>
              <li>Click a match to see the teams and odds</li>
              <li>Select a team, enter your bet amount, and confirm</li>
              <li>Bets settle automatically once the match result is in</li>
            </ul>
          </div>
          <div class="htp-section">
            <h3>💰 How Odds Work</h3>
            <ul>
              <li>Odds represent how much you win per credit bet.</li>
              <li>Favourite: lower odds (e.g. 1.4×) — safer but smaller payout</li>
              <li>Underdog: higher odds (e.g. 3.5×) — riskier but bigger payout</li>
              <li>Win: <span class="htp-tag green">bet × odds</span></li>
              <li>Lose: <span class="htp-tag red">bet lost</span></li>
            </ul>
          </div>
          <div class="htp-section">
            <h3>📋 Notes</h3>
            <ul>
              <li>Match data sourced from bo3.gg — covers ESL Pro League and major tournaments.</li>
              <li>Odds reflect real bookmaker lines with a typical bookmaker margin.</li>
              <li>Cancelled matches are refunded.</li>
            </ul>
          </div>
        `
      },
      pachinko: {
        icon: '🔮', title: 'Pachinko',
        body: `
          <div class="htp-section">
            <h3>🎯 Objective</h3>
            <ul>
              <li>Drop a ball from the top of the board.</li>
              <li>It bounces off pegs and lands in a slot at the bottom — each slot has a multiplier.</li>
              <li>Win: <strong>bet × slot multiplier</strong></li>
            </ul>
          </div>
          <div class="htp-section">
            <h3>🎮 Risk Modes</h3>
            <table class="htp-table">
              <tr><th>Mode</th><th>Style</th><th>RTP</th></tr>
              <tr><td><span class="htp-tag green">Low</span></td><td>Frequent small wins</td><td>~99%</td></tr>
              <tr><td><span class="htp-tag yellow">Medium</span></td><td>Balanced payouts</td><td>~97%</td></tr>
              <tr><td><span class="htp-tag red">High</span></td><td>Jackpot-style — rare big wins</td><td>~99%</td></tr>
            </table>
          </div>
          <div class="htp-section">
            <h3>🎮 How to Play</h3>
            <ul>
              <li>Choose a risk mode and enter your bet amount</li>
              <li>Click <strong>Drop Ball</strong> to launch</li>
              <li>Watch it bounce — the center slots pay the most</li>
            </ul>
          </div>
          <div class="htp-section">
            <h3>📋 Notes</h3>
            <ul>
              <li>Ball physics are simulated — every drop is unpredictable.</li>
              <li>Higher risk modes have bigger jackpot multipliers but wider spread.</li>
              <li>Low and High modes both have ~99% long-run RTP.</li>
            </ul>
          </div>
        `
      }
    };

    return guides[game] || null;
  }

  async showLeaderboard() {
    // Remove any existing leaderboard modal
    document.getElementById('leaderboardModal')?.remove();

    const modal = document.createElement('div');
    modal.id = 'leaderboardModal';
    modal.className = 'leaderboard-modal';

    modal.innerHTML = `
      <div class="leaderboard-content">
        <div class="leaderboard-header">
          <h2>🏆 Leaderboard</h2>
          <button class="leaderboard-close" id="lbCloseBtn">✕</button>
        </div>
        <div class="leaderboard-tabs">
          <button class="leaderboard-tab active" data-type="allTime">All Time</button>
          <button class="leaderboard-tab" data-type="thisWeek">This Week</button>
          <button class="leaderboard-tab" data-type="byGame">By Game</button>
        </div>
        <div class="leaderboard-list" id="leaderboardList" role="region" aria-label="Leaderboard standings" tabindex="0">
          <div class="loading">Loading...</div>
        </div>
      </div>
    `;

    document.body.appendChild(modal);
    
    // Add tab switching logic
    const tabs = modal.querySelectorAll('.leaderboard-tab');
    tabs.forEach(tab => {
      tab.addEventListener('click', () => {
        tabs.forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        
        const type = tab.dataset.type;
        if (type === 'byGame') {
          this.showGameLeaderboard();
        } else {
          this.loadLeaderboard(type);
        }
      });
    });

    // Close functionality
    document.getElementById('lbCloseBtn').addEventListener('click', () => modal.remove());
    modal.addEventListener('click', (e) => { if (e.target === modal) modal.remove(); });

    // Load initial leaderboard
    this.loadLeaderboard('allTime');
  }

  async loadLeaderboard(type) {
    const list = document.getElementById('leaderboardList');
    if (!list) return;

    list.innerHTML = '<div class="loading">Loading...</div>';

    const showError = () => {
      list.innerHTML = '<div class="lb-empty" role="status">Leaderboard unavailable.<br><button type="button" class="btn btn-secondary lb-retry">Retry</button></div>';
      list.querySelector('.lb-retry')?.addEventListener('click', () => this.loadLeaderboard(type));
    };
    if (!this.socket?.connected) { showError(); return; }

    let settled = false;
    const timeout = setTimeout(() => { if (!settled) { settled = true; showError(); } }, 5000);
    this.socket.emit('getLeaderboard', { type }, (leaderboard) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (!Array.isArray(leaderboard)) { showError(); return; }
      let html = '';
      
      if (leaderboard.length === 0) {
        html = '<div class="lb-empty">No players found</div>';
      } else {
        leaderboard.forEach((player, index) => {
          const rank = index + 1;
          const isCurrentUser = player.username === this.username;
          const netPLClass = player.netPL >= 0 ? 'profit' : 'loss';
          
          html += `
            <div class="lb-row ${isCurrentUser ? 'current-user' : ''}">
              <div class="lb-rank" ${rank <= 3 ? `data-rank="${rank}"` : ''}>#${rank}</div>
              <div class="lb-player">
                <div class="lb-username">${this.escapeHTML(player.username)}</div>
                <div class="lb-stats">
                  <span class="lb-games">${player.gamesPlayed} games</span>
                  <span class="lb-winrate">${player.winRate}% win rate</span>
                </div>
              </div>
              <div class="lb-profits">
                <div class="lb-netpl ${netPLClass}">${player.netPL >= 0 ? '+' : ''}${this.formatCredits(player.netPL)}</div>
                <div class="lb-biggest">Best: ${this.formatCredits(player.biggestWin)}</div>
              </div>
            </div>
          `;
        });
      }
      
      list.innerHTML = html;
    });
  }

  async showGameLeaderboard() {
    const list = document.getElementById('leaderboardList');
    if (!list) return;

    list.innerHTML = `
      <div class="game-selection">
        <div class="games-tabs">
          <button class="game-tab" data-game="blackjack">♠️ Blackjack</button>
          <button class="game-tab" data-game="crash">🚀 Crash</button>
          <button class="game-tab" data-game="poker">🃏 Poker</button>
          <button class="game-tab" data-game="roulette">🎲 Roulette</button>
          <button class="game-tab" data-game="coinflip">🪙 Coinflip</button>
          <button class="game-tab" data-game="pachinko">🔮 Pachinko</button>
          <button class="game-tab" data-game="cs2betting">🎮 CS2</button>
        </div>
        <div class="game-leaderboard" id="gameLeaderboard">
          <div class="lb-empty">Select a game to view leaderboard</div>
        </div>
      </div>
    `;

    // Add game tab listeners
    const gameTabs = list.querySelectorAll('.game-tab');
    gameTabs.forEach(tab => {
      tab.addEventListener('click', () => {
        gameTabs.forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        
        this.loadGameLeaderboard(tab.dataset.game);
      });
    });
  }

  async loadGameLeaderboard(game) {
    const gameBoard = document.getElementById('gameLeaderboard');
    if (!gameBoard) return;

    gameBoard.innerHTML = '<div class="loading">Loading...</div>';

    const showError = () => {
      gameBoard.innerHTML = '<div class="lb-empty" role="status">Game leaderboard unavailable.<br><button type="button" class="btn btn-secondary lb-retry">Retry</button></div>';
      gameBoard.querySelector('.lb-retry')?.addEventListener('click', () => this.loadGameLeaderboard(game));
    };
    if (!this.socket?.connected) { showError(); return; }
    let settled = false;
    const timeout = setTimeout(() => { if (!settled) { settled = true; showError(); } }, 5000);
    this.socket.emit('getGameLeaderboard', { game }, (leaderboard) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (!Array.isArray(leaderboard)) { showError(); return; }
      let html = '';
      
      if (leaderboard.length === 0) {
        html = '<div class="lb-empty">No players found for this game</div>';
      } else {
        leaderboard.forEach((player, index) => {
          const rank = index + 1;
          const isCurrentUser = player.username === this.username;
          
          html += `
            <div class="lb-row ${isCurrentUser ? 'current-user' : ''}">
              <div class="lb-rank" ${rank <= 3 ? `data-rank="${rank}"` : ''}>#${rank}</div>
              <div class="lb-player">
                <div class="lb-username">${this.escapeHTML(player.username)}</div>
                <div class="lb-stats">
                  <span class="lb-games">${player.played} played</span>
                  <span class="lb-winrate">${player.winRate}% win rate</span>
                </div>
              </div>
              <div class="lb-score">
                <div class="lb-value">${this.formatCredits(player.score)}</div>
                <div class="lb-metric">${this.escapeHTML(player.metric)}</div>
              </div>
            </div>
          `;
        });
      }
      
      gameBoard.innerHTML = html;
    });
  }

  async showAchievements() {
    // Remove any existing achievements modal
    document.getElementById('achievementsModal')?.remove();

    const modal = document.createElement('div');
    modal.id = 'achievementsModal';
    modal.className = 'achievements-modal';

    modal.innerHTML = `
      <div class="achievements-content">
        <div class="achievements-header">
          <h2>🏅 Achievements</h2>
          <button class="achievements-close" id="achCloseBtn">✕</button>
        </div>
        <div class="achievements-list" id="achievementsList">
          <div class="loading">Loading...</div>
        </div>
      </div>
    `;

    document.body.appendChild(modal);
    document.getElementById('achCloseBtn').addEventListener('click', () => modal.remove());
    modal.addEventListener('click', (e) => { if (e.target === modal) modal.remove(); });

    // Load achievements
    if (this.socket) {
      this.socket.emit('getAchievements', (data) => {
        this.renderAchievements(data);
      });
    }
  }

  renderAchievements(data) {
    const list = document.getElementById('achievementsList');
    if (!list) return;

    const earnedCount = data.available.filter(a => a.earned).length;
    const totalCount = data.available.length;

    let html = `
      <div class="achievements-summary">
        <div class="ach-progress">
          <div class="ach-progress-bar">
            <div class="ach-progress-fill" style="width: ${(earnedCount / totalCount) * 100}%"></div>
          </div>
          <div class="ach-progress-text">${earnedCount}/${totalCount} Achievements</div>
        </div>
      </div>
      <div class="achievements-grid" tabindex="0" aria-label="Achievements list">
    `;

    data.available.forEach(achievement => {
      const earnedClass = achievement.earned ? 'earned' : 'locked';
      html += `
        <div class="achievement-card ${earnedClass}">
          <div class="ach-icon">${achievement.icon}</div>
          <div class="ach-info">
            <div class="ach-name">${achievement.name}</div>
            <div class="ach-description">${achievement.description}</div>
            ${achievement.earned ? '<div class="ach-earned">✓ Unlocked</div>' : ''}
          </div>
        </div>
      `;
    });

    html += '</div>';
    list.innerHTML = html;

    // Opening the badges view marks every currently earned achievement as seen.
    this.markAchievementsSeen(earnedCount);
  }

  async showStats() {
    // Remove any existing stats modal
    document.getElementById('statsModal')?.remove();

    const modal = document.createElement('div');
    modal.id = 'statsModal';
    modal.className = 'stats-modal';

    modal.innerHTML = `
      <div class="stats-content">
        <div class="stats-header">
          <h2>📊 My Stats</h2>
          <button class="stats-close" id="statsCloseBtn">✕</button>
        </div>
        <div class="stats-body" id="statsBody" role="region" aria-label="Player statistics" tabindex="0">
          <div class="loading">Loading...</div>
        </div>
      </div>
    `;

    document.body.appendChild(modal);
    document.getElementById('statsCloseBtn').addEventListener('click', () => modal.remove());
    modal.addEventListener('click', (e) => { if (e.target === modal) modal.remove(); });

    // Load stats
    if (this.socket) {
      this.socket.emit('getUserStats', (stats) => {
        this.renderStats(stats);
      });
    }
  }

  renderStats(stats) {
    const body = document.getElementById('statsBody');
    if (!body || !stats) return;

    const netPLClass = stats.netPL >= 0 ? 'profit' : 'loss';

    let html = `
      <div class="stats-overview">
        <div class="stat-card">
          <div class="stat-value">${stats.totalGames}</div>
          <div class="stat-label">Total Games</div>
        </div>
        <div class="stat-card">
          <div class="stat-value">${stats.winRate}%</div>
          <div class="stat-label">Win Rate</div>
        </div>
        <div class="stat-card ${netPLClass}">
          <div class="stat-value">${stats.netPL >= 0 ? '+' : ''}${this.formatCredits(stats.netPL)}</div>
          <div class="stat-label">Net P/L</div>
        </div>
        <div class="stat-card">
          <div class="stat-value">#${stats.rank}</div>
          <div class="stat-label">Global Rank</div>
        </div>
      </div>
      
      <div class="stats-details">
        <div class="stats-section">
          <h3>🎮 General Stats</h3>
          <div class="stats-grid">
            <div class="stat-row">
              <span class="stat-name">Biggest Win</span>
              <span class="stat-val">${this.formatCredits(stats.biggestWin)}</span>
            </div>
            <div class="stat-row">
              <span class="stat-name">Current Streak</span>
              <span class="stat-val">${stats.currentStreak}</span>
            </div>
            <div class="stat-row">
              <span class="stat-name">Best Streak</span>
              <span class="stat-val">${stats.bestStreak}</span>
            </div>
            <div class="stat-row">
              <span class="stat-name">Favorite Game</span>
              <span class="stat-val">${stats.favoriteGame}</span>
            </div>
          </div>
        </div>
        
        <div class="stats-section">
          <h3>📈 This Week</h3>
          <div class="stats-grid">
            <div class="stat-row">
              <span class="stat-name">Games Played</span>
              <span class="stat-val">${stats.weeklyStats.gamesPlayed}</span>
            </div>
            <div class="stat-row">
              <span class="stat-name">Total Wagered</span>
              <span class="stat-val">${this.formatCredits(stats.weeklyStats.totalWagered)}</span>
            </div>
            <div class="stat-row">
              <span class="stat-name">Net P/L</span>
              <span class="stat-val ${(stats.weeklyStats.totalWon - stats.weeklyStats.totalWagered) >= 0 ? 'profit' : 'loss'}">
                ${(stats.weeklyStats.totalWon - stats.weeklyStats.totalWagered) >= 0 ? '+' : ''}${this.formatCredits(stats.weeklyStats.totalWon - stats.weeklyStats.totalWagered)}
              </span>
            </div>
          </div>
        </div>
        
        <div class="stats-section">
          <h3>🎯 Game Breakdown</h3>
          <div class="game-stats">
    `;

    // Add game-specific stats
    for (const [game, gameStats] of Object.entries(stats.gameBreakdown)) {
      if (gameStats.played > 0) {
        const winRate = gameStats.played > 0 ? ((gameStats.won / gameStats.played) * 100).toFixed(1) : 0;
        const gameIcon = {
          blackjack: '♠️',
          roulette: '🎲', 
          coinflip: '🪙',
          crash: '🚀',
          poker: '🃏',
          cs2betting: '🎮',
          pachinko: '🔮'
        }[game] || '🎲';

        html += `
          <div class="game-stat">
            <div class="game-stat-header">
              <span class="game-icon">${gameIcon}</span>
              <span class="game-name">${game.charAt(0).toUpperCase() + game.slice(1)}</span>
            </div>
            <div class="game-stat-details">
              <span class="game-played">${gameStats.played} played</span>
              <span class="game-winrate">${winRate}% win rate</span>
            </div>
          </div>
        `;
      }
    }

    html += `
          </div>
        </div>
      </div>
    `;

    body.innerHTML = html;
  }

  showAchievementToast(achievement) {
    // Remove any existing toast
    document.getElementById('achievementToast')?.remove();

    const toast = document.createElement('div');
    toast.id = 'achievementToast';
    toast.className = 'achievement-toast';

    toast.innerHTML = `
      <div class="toast-content">
        <div class="toast-icon">${this.escapeHTML(achievement.icon)}</div>
        <div class="toast-text">
          <div class="toast-title">Achievement Unlocked!</div>
          <div class="toast-name">${this.escapeHTML(achievement.name)}</div>
          <div class="toast-desc">${this.escapeHTML(achievement.description)}</div>
        </div>
      </div>
    `;

    document.body.appendChild(toast);

    // Auto-remove after 5 seconds
    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateX(100%)';
      setTimeout(() => toast.remove(), 300);
    }, 5000);

    // Click to close
    toast.addEventListener('click', () => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateX(100%)';
      setTimeout(() => toast.remove(), 300);
    });
  }

  achievementSeenStorageKey() {
    return `neon777:achievements-seen:${this.username || 'guest'}`;
  }

  getAchievementsSeenCount() {
    try {
      const value = Number(localStorage.getItem(this.achievementSeenStorageKey()));
      return Number.isSafeInteger(value) && value >= 0 ? value : 0;
    } catch (_) {
      return 0;
    }
  }

  markAchievementsSeen(earnedCount) {
    const safeCount = Number.isSafeInteger(earnedCount) ? Math.max(0, earnedCount) : 0;
    try { localStorage.setItem(this.achievementSeenStorageKey(), String(safeCount)); } catch (_) {}
    this.renderAchievementBadge(0);
  }

  renderAchievementBadge(unreadCount) {
    const badge = document.getElementById('achievementBadge');
    const badgeMobile = document.getElementById('achievementBadgeMobile');
    if (!badge) return;
    badge.textContent = String(unreadCount);
    if (badgeMobile) badgeMobile.textContent = String(unreadCount);
    badge.classList.toggle('hidden', unreadCount === 0);
    if (badgeMobile) badgeMobile.classList.toggle('hidden', unreadCount === 0);
  }

  updateAchievementBadge(count = null) {
    const applyEarnedCount = earnedCount => {
      const seenCount = this.getAchievementsSeenCount();
      this.renderAchievementBadge(Math.max(0, earnedCount - seenCount));
    };

    if (count !== null) {
      applyEarnedCount(count);
    } else if (this.socket) {
      this.socket.emit('getAchievements', (data) => {
        const earnedCount = data.available.filter(a => a.earned).length;
        applyEarnedCount(earnedCount);
      });
    }
  }

  // Mobile menu functionality
  toggleMobileMenu() {
    const dropdown = document.getElementById('mobileActionsDropdown');
    if (!dropdown) return;
    
    const isOpen = dropdown.classList.contains('show');
    if (isOpen) {
      this.hideMobileMenu();
    } else {
      this.showMobileMenu();
    }
  }

  showMobileMenu() {
    const dropdown = document.getElementById('mobileActionsDropdown');
    if (!dropdown) return;
    
    dropdown.classList.add('show');
    
    // Close menu when tapping outside — use delayed listener to avoid immediate close
    setTimeout(() => {
      this._outsideClickHandler = (e) => {
        const toggle = document.getElementById('mobileMenuToggle');
        if (!dropdown.contains(e.target) && (!toggle || !toggle.contains(e.target))) {
          this.hideMobileMenu();
        }
      };
      document.addEventListener('click', this._outsideClickHandler, true);
      document.addEventListener('touchstart', this._outsideClickHandler, true);
    }, 50);
  }

  hideMobileMenu() {
    const dropdown = document.getElementById('mobileActionsDropdown');
    if (!dropdown) return;
    
    dropdown.classList.remove('show');
    
    // Remove outside click listener
    if (this._outsideClickHandler) {
      document.removeEventListener('click', this._outsideClickHandler, true);
      document.removeEventListener('touchstart', this._outsideClickHandler, true);
      this._outsideClickHandler = null;
    }
    
    // Remove any legacy backdrop
    const backdrop = document.querySelector('.mobile-dropdown-backdrop');
    if (backdrop) backdrop.remove();
  }
}

// Initialize casino when DOM is ready
let casinoManager;
function initializeCasinoManager() {
  casinoManager = new CasinoManager();
  window.casinoManager = casinoManager;
}
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initializeCasinoManager, { once: true });
} else {
  initializeCasinoManager();
}

// Export class for game modules
window.CasinoManager = CasinoManager;

