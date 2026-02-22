// Casino Main Logic and Credit System

class CasinoManager {
  constructor() {
    this.username = '';
    this.credits = 10000; // Starting credits
    this.currentGame = null;
    this.socket = null;
    // Server URL - default to same origin, but can be overridden
    // If server is on different port (e.g., 3001), set window.CASINO_SERVER_URL = 'http://localhost:3001'
    this.serverUrl = window.CASINO_SERVER_URL || window.location.origin;
    this._betPlacementInProgress = false; // Navigation guard flag
    this._lastBalanceFetchAt = null; // When we last fetched balance from API (avoids stale socket overwrite)
    this.init();
  }

  init() {
    // Check if player is already signed in (from session)
    const savedUsername = sessionStorage.getItem('casinoUsername');
    if (savedUsername) {
      this.username = savedUsername;
      this.restoreSessionAndConnect();
    } else {
      this.showSignInScreen();
    }

    // Auth tab switching
    document.getElementById('loginTab')?.addEventListener('click', () => this.showLoginForm());
    document.getElementById('registerTab')?.addEventListener('click', () => this.showRegisterForm());

    // Login form
    document.getElementById('loginBtn')?.addEventListener('click', () => this.login());
    document.getElementById('loginUsername')?.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') this.login();
    });
    document.getElementById('loginPassword')?.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') this.login();
    });

    // Register form
    document.getElementById('registerBtn')?.addEventListener('click', () => this.register());
    document.getElementById('registerUsername')?.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') this.register();
    });
    document.getElementById('registerPassword')?.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') this.register();
    });
    document.getElementById('registerPasswordConfirm')?.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') this.register();
    });

    // Header actions
    document.getElementById('logoutBtn')?.addEventListener('click', () => this.logout());
    document.getElementById('betHistoryBtn')?.addEventListener('click', () => this.showBetHistory());
    document.getElementById('leaderboardBtn')?.addEventListener('click', () => this.showLeaderboard());
    document.getElementById('achievementsBtn')?.addEventListener('click', () => this.showAchievements());
    document.getElementById('statsBtn')?.addEventListener('click', () => this.showStats());
    document.getElementById('backToLobbyBtn')?.addEventListener('click', () => this.backToLobby());

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
      { id: 'betHistoryBtnMobile', action: () => this.showBetHistory() }
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
    
    console.log(`[Casino] Attached ${document.querySelectorAll('.play-btn').length} play button listeners`);
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

  clearErrors() {
    document.getElementById('loginError')?.classList.add('hidden');
    document.getElementById('registerError')?.classList.add('hidden');
    document.getElementById('registerSuccess')?.classList.add('hidden');
  }

  async login() {
    const username = document.getElementById('loginUsername')?.value.trim();
    const password = document.getElementById('loginPassword')?.value;

    if (!username || !password) {
      this.showError('loginError', 'Please enter both username and password');
      return;
    }

    try {
      const response = await fetch(`${this.serverUrl}/api/login`, {
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
      sessionStorage.setItem('casinoUsername', this.username);
      this.clearErrors();
      this.connectToServer();
    } catch (error) {
      console.error('Login error:', error);
      this.showError('loginError', 'Connection error. Please try again.');
    }
  }

  async register() {
    const username = document.getElementById('registerUsername')?.value.trim();
    const password = document.getElementById('registerPassword')?.value;
    const passwordConfirm = document.getElementById('registerPasswordConfirm')?.value;

    if (!username || !password || !passwordConfirm) {
      this.showError('registerError', 'Please fill in all fields');
      return;
    }

    if (username.length < 3 || username.length > 20) {
      this.showError('registerError', 'Username must be between 3 and 20 characters');
      return;
    }

    if (password.length < 6) {
      this.showError('registerError', 'Password must be at least 6 characters');
      return;
    }

    if (password !== passwordConfirm) {
      this.showError('registerError', 'Passwords do not match');
      return;
    }

    try {
      const response = await fetch(`${this.serverUrl}/api/register`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ username, password })
      });

      const data = await response.json();

      if (!response.ok) {
        this.showError('registerError', data.error || 'Registration failed');
        return;
      }

      // Success - show success message and switch to login
      this.showSuccess('registerSuccess', 'Account created successfully! Please login.');
      setTimeout(() => {
        this.showLoginForm();
        document.getElementById('loginUsername').value = username;
        document.getElementById('registerUsername').value = '';
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
    // Fetch balance from API first to avoid stale socket overwrite (race: joinCasino can run before CS2 bet persists)
    try {
      const res = await fetch(`${this.serverUrl}/api/cs2/balance?userId=${encodeURIComponent(this.username)}`);
      const data = await res.json();
      if (data.success && typeof data.balance === 'number') {
        this.credits = data.balance;
        this._lastBalanceFetchAt = Date.now();
        this.updateCreditsDisplay();
        if (window.casinoDebugLogger) {
          window.casinoDebugLogger.logBalanceUpdate(10000, this.credits, 'api', {
            context: 'session restore',
            source: 'GET /api/cs2/balance'
          });
        }
      }
    } catch (e) {
      console.warn('[Casino] Balance fetch on session restore failed, using socket only:', e);
    }
    this.connectToServer();
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
      this.socket = io(this.serverUrl);

      this.socket.on('connect', () => {
        console.log('[Casino] Connected to server');
        if (window.casinoDebugLogger) {
          window.casinoDebugLogger.logSocketEvent('socket connected', {
            currentGame: this.currentGame
          });
        }
        // Join casino with username
        this.socket.emit('joinCasino', { username: this.username });
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
          this.socket.emit('joinCasino', { username: this.username });
        }
      });

      this.socket.on('playerData', (data) => {
        const socketCredits = data.credits;
        const now = Date.now();
        const oldBalance = this.credits;
        
        console.log(`[Casino] playerData received: socket=${socketCredits}, current=${oldBalance}, game=${this.currentGame}`);
        
        if (window.casinoDebugLogger) {
          window.casinoDebugLogger.logBalanceUpdate(oldBalance, socketCredits, 'socket', {
            currentGame: this.currentGame
          });
        }
        
        // Protect against stale playerData overwriting fresh client-side balances.
        // This happens when: (a) CS2 REST bet just placed, (b) client-side game
        // (blackjack/pachinko) just synced via syncBalance, or (c) socket reconnect
        // sends stale joinCasino response.
        const hasRecentManualUpdate = this._lastManualCreditUpdate && (now - this._lastManualCreditUpdate) < 3000;
        const hasRecentCreditSync = this._lastCreditSync && (now - this._lastCreditSync) < 5000;
        
        if (hasRecentManualUpdate && socketCredits > this.credits) {
          console.log('[Casino] Ignoring stale playerData after recent CS2 bet');
          return;
        }
        
        if (hasRecentCreditSync && socketCredits !== this.credits) {
          // Client just synced balance — trust the local value over potentially stale server push
          console.log('[Casino] Ignoring playerData — recent syncBalance in flight', {
            local: this.credits, server: socketCredits
          });
          return;
        }
        
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
      // Already connected, just join
      this.socket.emit('joinCasino', { username: this.username });
    }

    // CRITICAL FIX: Only show main screen if not already in a game
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

  logout() {
    if (confirm('Are you sure you want to logout? Your balance will be saved.')) {
      if (this.socket) {
        this.socket.disconnect();
        this.socket = null;
      }
      this.username = '';
      this.credits = 10000;
      sessionStorage.removeItem('casinoUsername');
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
      creditsEl.textContent = this.formatCredits(this.credits);
    }
  }

  formatCredits(amount) {
    return amount.toLocaleString();
  }

  updateCredits(amount) {
    // For CLIENT-SIDE games only (blackjack, pachinko) — updates locally AND syncs to server
    this.credits += amount;
    if (this.credits < 0) this.credits = 0;
    this.updateCreditsDisplay();
    this._lastCreditSync = Date.now();
    if (this.socket && this.socket.connected) {
      this.socket.emit('syncBalance', { credits: this.credits });
    }
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

  startGame(gameName) {
    console.log(`[Casino] startGame called with: ${gameName}`);
    
    if (window.casinoDebugLogger) {
      window.casinoDebugLogger.logNavigation('startGame', {
        gameName,
        previousGame: this.currentGame,
        stackTrace: new Error().stack
      });
    }
    
    // Clear manual update flag when switching games to allow socket updates
    if (this.currentGame !== gameName) {
      this._lastManualCreditUpdate = null;
    }
    
    this.currentGame = gameName;
    
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

    // Show selected game (handle camelCase for cs2betting)
    const gameViewId = gameName === 'cs2betting' ? 'cs2BettingGame' : `${gameName}Game`;
    console.log(`[Casino] Looking for game view with ID: ${gameViewId}`);
    const gameView = document.getElementById(gameViewId);
    if (gameView) {
      console.log(`[Casino] Game view found, showing: ${gameViewId}`);
      console.log(`[Casino] Game view classes before: ${gameView.className}`);
      gameView.classList.remove('hidden');
      console.log(`[Casino] Game view classes after: ${gameView.className}`);
      console.log(`[Casino] Game view is now hidden: ${gameView.classList.contains('hidden')}`);
    } else {
      console.error(`[Casino] Game view not found: ${gameViewId}`);
      console.error(`[Casino] Available game views:`, Array.from(document.querySelectorAll('.game-view')).map(el => el.id));
    }

    // Initialize game
    setTimeout(() => {
      try {
        switch(gameName) {
          case 'blackjack':
            if (window.BlackjackGame) {
              window.currentGameInstance = new window.BlackjackGame(this);
            } else {
              console.error(`[Casino] BlackjackGame class not found`);
            }
            break;
          case 'coinflip':
            if (window.CoinflipGame) {
              window.currentGameInstance = new window.CoinflipGame(this);
            } else {
              console.error(`[Casino] CoinflipGame class not found`);
            }
            break;
          case 'roulette':
            if (window.RouletteGame) {
              window.currentGameInstance = new window.RouletteGame(this);
            } else {
              console.error(`[Casino] RouletteGame class not found`);
            }
            break;
          case 'cs2betting':
            // Try modern version first, fallback to legacy
            if (window.CS2ModernBettingGame) {
              console.log('[Casino] Initializing CS2ModernBettingGame...');
              window.currentGameInstance = new window.CS2ModernBettingGame(this);
              console.log('[Casino] CS2ModernBettingGame initialized successfully');
            } else if (window.CS2BettingGame) {
              console.log('[Casino] Initializing CS2BettingGame (legacy)...');
              window.currentGameInstance = new window.CS2BettingGame(this);
              console.log('[Casino] CS2BettingGame (legacy) initialized successfully');
            } else {
              console.error('[Casino] No CS2BettingGame class found! Make sure cs2-betting-modern.js or cs2-betting-casino.js is loaded.');
            }
            break;
          case 'poker':
            if (window.PokerGame) {
              window.currentGameInstance = new window.PokerGame(this);
            } else {
              console.error('[Casino] PokerGame class not found');
            }
            break;
          case 'crash':
            if (window.CrashGame) {
              window.currentGameInstance = new window.CrashGame(this);
            } else {
              console.error('[Casino] CrashGame class not found');
            }
            break;
          case 'pachinko':
            if (window.PachinkoGame) {
              window.currentGameInstance = new window.PachinkoGame(this);
            } else {
              console.error('[Casino] PachinkoGame class not found');
            }
            break;
          default:
            console.error(`[Casino] Unknown game: ${gameName}`);
        }
      } catch (error) {
        console.error(`[Casino] Error initializing game ${gameName}:`, error);
        alert(`Failed to load game: ${error.message}`);
      }
    }, 100);
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

    if (window.currentGameInstance) {
      window.currentGameInstance.destroy?.();
      window.currentGameInstance = null;
    }
  }

  // ========== BET HISTORY ==========

  recordBet(game, bet, result, payout, multiplier, details) {
    if (this.socket && this.socket.connected) {
      this.socket.emit('recordBet', { game, bet, result, payout, multiplier: multiplier || null, details: details || null });
    }
  }

  getBetHistory(limit = 50) {
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

  async showBetHistory() {
    const history = await this.getBetHistory(50);
    document.getElementById('betHistoryModal')?.remove();

    const modal = document.createElement('div');
    modal.id = 'betHistoryModal';
    modal.className = 'bet-history-modal';

    let totalWagered = 0, totalPayout = 0;
    history.forEach(h => { totalWagered += h.bet || 0; totalPayout += h.payout || 0; });
    const netProfit = totalPayout - totalWagered;

    modal.innerHTML = `
      <div class="bet-history-content">
        <div class="bet-history-header">
          <h2>📊 Bet History</h2>
          <button class="bet-history-close" id="bhCloseBtn">✕</button>
        </div>
        <div class="bet-history-summary">
          <div class="bh-stat"><span class="bh-label">Total Wagered</span><span class="bh-value">${totalWagered.toLocaleString()}</span></div>
          <div class="bh-stat"><span class="bh-label">Total Returned</span><span class="bh-value">${totalPayout.toLocaleString()}</span></div>
          <div class="bh-stat"><span class="bh-label">Net P/L</span><span class="bh-value ${netProfit >= 0 ? 'profit' : 'loss'}">${netProfit >= 0 ? '+' : ''}${netProfit.toLocaleString()}</span></div>
        </div>
        <div class="bet-history-list">
          ${history.length === 0 ? '<div class="bh-empty">No bets yet. Start playing!</div>' : ''}
          ${history.map(h => {
            const net = (h.payout || 0) - (h.bet || 0);
            const isWin = net > 0;
            const time = new Date(h.timestamp).toLocaleString();
            const icons = { blackjack: '🃏', pachinko: '🔮', roulette: '🎰', crash: '📈', coinflip: '🪙', poker: '♠️', cs2betting: '🎮' };
            const icon = icons[h.game] || '🎲';
            return `<div class="bh-row ${isWin ? 'win' : 'loss'}">
              <div class="bh-row-top">
                <div class="bh-game">${icon} ${h.game || 'Unknown'}</div>
                <div class="bh-payout ${isWin ? 'profit' : 'loss'}">${isWin ? '+' : ''}${net.toLocaleString()}</div>
              </div>
              <div class="bh-details">
                <span class="bh-bet">Bet: ${(h.bet||0).toLocaleString()}</span>
                ${h.multiplier ? `<span class="bh-mult">${h.multiplier}x</span>` : ''}
                <span class="bh-result">${h.result || ''}</span>
              </div>
              <div class="bh-time">${time}</div>
            </div>`;
          }).join('')}
        </div>
      </div>
    `;

    document.body.appendChild(modal);
    document.getElementById('bhCloseBtn').addEventListener('click', () => modal.remove());
    modal.addEventListener('click', (e) => { if (e.target === modal) modal.remove(); });
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
        <div class="leaderboard-list" id="leaderboardList">
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

    if (!this.socket) return;

    this.socket.emit('getLeaderboard', { type }, (leaderboard) => {
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
                <div class="lb-username">${player.username}</div>
                <div class="lb-stats">
                  <span class="lb-games">${player.gamesPlayed} games</span>
                  <span class="lb-winrate">${player.winRate}% win rate</span>
                </div>
              </div>
              <div class="lb-profits">
                <div class="lb-netpl ${netPLClass}">${player.netPL >= 0 ? '+' : ''}${player.netPL.toLocaleString()}</div>
                <div class="lb-biggest">Best: ${player.biggestWin.toLocaleString()}</div>
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
    if (!gameBoard || !this.socket) return;

    gameBoard.innerHTML = '<div class="loading">Loading...</div>';

    this.socket.emit('getGameLeaderboard', { game }, (leaderboard) => {
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
                <div class="lb-username">${player.username}</div>
                <div class="lb-stats">
                  <span class="lb-games">${player.played} played</span>
                  <span class="lb-winrate">${player.winRate}% win rate</span>
                </div>
              </div>
              <div class="lb-score">
                <div class="lb-value">${player.score.toLocaleString()}</div>
                <div class="lb-metric">${player.metric}</div>
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
      <div class="achievements-grid">
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

    // Update badge
    this.updateAchievementBadge(earnedCount);
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
        <div class="stats-body" id="statsBody">
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
          <div class="stat-value">${stats.netPL >= 0 ? '+' : ''}${stats.netPL.toLocaleString()}</div>
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
              <span class="stat-val">${stats.biggestWin.toLocaleString()}</span>
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
              <span class="stat-val">${stats.weeklyStats.totalWagered.toLocaleString()}</span>
            </div>
            <div class="stat-row">
              <span class="stat-name">Net P/L</span>
              <span class="stat-val ${(stats.weeklyStats.totalWon - stats.weeklyStats.totalWagered) >= 0 ? 'profit' : 'loss'}">
                ${(stats.weeklyStats.totalWon - stats.weeklyStats.totalWagered) >= 0 ? '+' : ''}${(stats.weeklyStats.totalWon - stats.weeklyStats.totalWagered).toLocaleString()}
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
        <div class="toast-icon">${achievement.icon}</div>
        <div class="toast-text">
          <div class="toast-title">Achievement Unlocked!</div>
          <div class="toast-name">${achievement.name}</div>
          <div class="toast-desc">${achievement.description}</div>
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

  updateAchievementBadge(count = null) {
    const badge = document.getElementById('achievementBadge');
    const badgeMobile = document.getElementById('achievementBadgeMobile');
    
    if (!badge) return;

    if (count !== null) {
      badge.textContent = count;
      if (badgeMobile) badgeMobile.textContent = count;
      
      badge.classList.toggle('hidden', count === 0);
      if (badgeMobile) badgeMobile.classList.toggle('hidden', count === 0);
    } else if (this.socket) {
      // Fetch current count
      this.socket.emit('getAchievements', (data) => {
        const earnedCount = data.available.filter(a => a.earned).length;
        badge.textContent = earnedCount;
        if (badgeMobile) badgeMobile.textContent = earnedCount;
        
        badge.classList.toggle('hidden', earnedCount === 0);
        if (badgeMobile) badgeMobile.classList.toggle('hidden', earnedCount === 0);
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
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    casinoManager = new CasinoManager();
  });
} else {
  casinoManager = new CasinoManager();
}

// Export for game modules
window.CasinoManager = CasinoManager;
window.casinoManager = casinoManager;

