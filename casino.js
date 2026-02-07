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

    // Logout
    document.getElementById('logoutBtn')?.addEventListener('click', () => this.logout());
    document.getElementById('backToLobbyBtn')?.addEventListener('click', () => this.backToLobby());

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
        
        // Simple approach: always trust the server's balance.
        // The server is the single source of truth — it reads from the persisted users file.
        // Only skip if we JUST did a CS2 bet via REST (within 3 seconds) and the socket
        // is sending back a stale pre-bet balance.
        const hasRecentManualUpdate = this._lastManualCreditUpdate && (now - this._lastManualCreditUpdate) < 3000;
        
        if (hasRecentManualUpdate && socketCredits > this.credits) {
          // Socket is sending a balance higher than what we set after a bet deduction.
          // This is the stale joinCasino response — ignore it.
          console.log('[Casino] Ignoring stale socket playerData after recent CS2 bet', {
            currentBalance: this.credits,
            socketBalance: socketCredits
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
    this.credits += amount;
    if (this.credits < 0) this.credits = 0;
    this.updateCreditsDisplay();
    // Don't set manual update flag for updateCredits - this is used by all games
    // Only setCredits (used by CS2 betting) sets the flag
    // Balance is saved on server automatically
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

