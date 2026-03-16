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
    return labels[game] || game || 'Unknown';
  }

  _bhRenderList(history, filterGame) {
    const ICONS = { blackjack: '🃏', pachinko: '🔮', roulette: '🎰', crash: '📈', coinflip: '🪙', poker: '♠️', cs2betting: '🎮' };
    const filtered = filterGame === 'all' ? history : history.filter(h => h.game === filterGame);
    if (filtered.length === 0) {
      return '<div class="bh-empty">No bets yet for this game. Start playing!</div>';
    }
    return filtered.map(h => {
      const net = (h.payout || 0) - (h.bet || 0);
      const isWin = net > 0;
      const icon = ICONS[h.game] || '🎲';
      const label = this._bhGameLabel(h.game);
      const time = this._bhRelativeTime(h.timestamp);
      const fullTime = new Date(h.timestamp).toLocaleString();
      const mult = h.multiplier ? `<span class="bh-mult">${parseFloat(h.multiplier).toFixed(2)}x</span>` : '';
      const result = h.result ? `<span class="bh-result-tag ${isWin ? 'win' : 'loss'}">${h.result}</span>` : '';
      const details = h.details ? `<span class="bh-details-note">${h.details}</span>` : '';
      return `<div class="bh-row ${isWin ? 'win' : 'loss'}">
        <div class="bh-row-top">
          <div class="bh-game">${icon} <span class="bh-game-name">${label}</span></div>
          <div class="bh-payout ${isWin ? 'profit' : 'loss'}">${isWin ? '+' : ''}${net.toLocaleString()}</div>
        </div>
        <div class="bh-meta">
          <span class="bh-bet-chip">Bet ${(h.bet||0).toLocaleString()}</span>
          ${mult}${result}${details}
        </div>
        <div class="bh-time" title="${fullTime}">${time}</div>
      </div>`;
    }).join('');
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

    // Build game filter options from actual data
    const gamesInHistory = [...new Set(history.map(h => h.game).filter(Boolean))];
    const GAME_ICONS = { blackjack: '🃏', pachinko: '🔮', roulette: '🎰', crash: '📈', coinflip: '🪙', poker: '♠️', cs2betting: '🎮' };
    const filterBtns = [
      `<button class="bh-filter active" data-game="all">All (${history.length})</button>`,
      ...gamesInHistory.map(g => {
        const cnt = history.filter(h => h.game === g).length;
        return `<button class="bh-filter" data-game="${g}">${GAME_ICONS[g] || '🎲'} ${this._bhGameLabel(g)} (${cnt})</button>`;
      })
    ].join('');

    modal.innerHTML = `
      <div class="bet-history-content">
        <div class="bet-history-header">
          <h2>📊 Bet History</h2>
          <button class="bet-history-close" id="bhCloseBtn">✕</button>
        </div>
        <div class="bet-history-summary">
          <div class="bh-stat">
            <span class="bh-label">Wagered</span>
            <span class="bh-value">${totalWagered.toLocaleString()}</span>
          </div>
          <div class="bh-stat">
            <span class="bh-label">Returned</span>
            <span class="bh-value">${totalPayout.toLocaleString()}</span>
          </div>
          <div class="bh-stat">
            <span class="bh-label">Net P/L</span>
            <span class="bh-value ${netProfit >= 0 ? 'profit' : 'loss'}">${netProfit >= 0 ? '+' : ''}${netProfit.toLocaleString()}</span>
          </div>
          <div class="bh-stat">
            <span class="bh-label">Win Rate</span>
            <span class="bh-value ${winRate >= 50 ? 'profit' : ''}">${winRate}%</span>
          </div>
        </div>
        <div class="bh-filters">${filterBtns}</div>
        <div class="bet-history-list" id="bhList">
          ${this._bhRenderList(history, 'all')}
        </div>
      </div>
    `;

    document.body.appendChild(modal);

    // Filter click handlers
    modal.querySelectorAll('.bh-filter').forEach(btn => {
      btn.addEventListener('click', () => {
        modal.querySelectorAll('.bh-filter').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        document.getElementById('bhList').innerHTML = this._bhRenderList(history, btn.dataset.game);
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
        <div class="how-to-play-body">
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

