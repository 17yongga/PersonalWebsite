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
    this.init();
  }

  init() {
    // Check if player is already signed in (from session)
    const savedUsername = sessionStorage.getItem('casinoUsername');
    if (savedUsername) {
      this.username = savedUsername;
      this.connectToServer();
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

  connectToServer() {
    // Initialize socket connection
    if (!this.socket) {
      this.socket = io(this.serverUrl);

      this.socket.on('connect', () => {
        console.log('Connected to server');
        // Join casino with username
        this.socket.emit('joinCasino', { username: this.username });
      });

      this.socket.on('playerData', (data) => {
        this.credits = data.credits;
        this.updateCreditsDisplay();
      });

      this.socket.on('error', (error) => {
        console.error('Server error:', error);
        alert(error);
      });
    } else {
      // Already connected, just join
      this.socket.emit('joinCasino', { username: this.username });
    }

    this.showMainScreen();
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
    document.getElementById('signInScreen').classList.add('hidden');
    document.getElementById('mainCasinoScreen').classList.remove('hidden');
    document.getElementById('gameSelection').classList.remove('hidden');
    document.getElementById('gameContainer').classList.add('hidden');
    
    // Update display
    document.getElementById('playerNameDisplay').textContent = this.username;
    this.updateCreditsDisplay();
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
    // Balance is saved on server automatically
  }

  getSocket() {
    return this.socket;
  }

  startGame(gameName) {
    console.log(`[Casino] startGame called with: ${gameName}`);
    this.currentGame = gameName;
    
    const gameSelectionEl = document.getElementById('gameSelection');
    const gameContainerEl = document.getElementById('gameContainer');
    
    if (!gameSelectionEl || !gameContainerEl) {
      console.error('[Casino] Game selection or container element not found!');
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
      gameView.classList.remove('hidden');
    } else {
      console.error(`[Casino] Game view not found: ${gameViewId}`);
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
    document.getElementById('gameContainer').classList.add('hidden');
    document.getElementById('gameSelection').classList.remove('hidden');
    this.currentGame = null;
    
    // Clean up game instances
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

