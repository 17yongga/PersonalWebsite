// CS2 Modern Betting Game - Production Ready
// Enhanced with modern UI patterns, animations, and touch optimization

class CS2ModernBettingGame {
  constructor(casinoManager) {
    this.casino = casinoManager;
    this.socket = null;
    this.events = [];
    this.bets = [];
    this.currentBalance = 0;
    this.selectedEvent = null;
    this.selectedOutcome = null;
    this.betAmount = 100;
    this.refreshInterval = null;
    
    // Modern UI state management
    this.isLoading = false;
    this.loadingStates = new Map();
    this.animationQueue = [];
    this.toast = null;
    
    // Touch and interaction handling
    this.touchStartY = 0;
    this.touchThreshold = 50;
    this.longPressTimer = null;
    this.hapticEnabled = 'vibrate' in navigator;
    
    this.init();
  }

  init() {
    try {
      console.log('[CS2 Modern] Initializing modern betting interface...');
      const gameView = document.getElementById('cs2BettingGame');
      if (!gameView) {
        console.error('[CS2 Modern] Game view element not found!');
        setTimeout(() => this.init(), 100);
        return;
      }
      
      this.renderModernUI();
      this.attachEventListeners();
      this.setupTouchOptimization();
      this.connectToServer();
      this.loadInitialData();
      console.log('[CS2 Modern] Modern UI initialized successfully!');
    } catch (error) {
      console.error('[CS2 Modern] Error during initialization:', error);
      this.renderErrorState(error);
    }
  }

  renderModernUI() {
    const gameView = document.getElementById('cs2BettingGame');
    gameView.innerHTML = `
      <div class="cs2-betting-container" data-theme="dark">
        <!-- Header -->
        <div class="cs2-header">
          <div class="cs2-container">
            <div class="cs2-header-content">
              <h1 class="cs2-title">
                <span class="cs2-title-icon">🎮</span>
                CS2 Fantasy Betting
              </h1>
              <div class="header-actions">
                <button id="themeToggle" class="btn btn-secondary btn-icon" title="Toggle Theme">
                  <span class="theme-icon">🌙</span>
                </button>
              </div>
            </div>
          </div>
        </div>

        <!-- Main Container -->
        <div class="cs2-container">
          <!-- Disclaimer -->
          <div class="cs2-disclaimer">
            <p>🎯 Fantasy betting with virtual credits only. No real money involved.</p>
          </div>

          <!-- Main Layout -->
          <div class="cs2-betting-layout">
            <!-- Events Panel -->
            <div class="cs2-events-panel">
              <div class="events-panel-header">
                <h3>🏆 Upcoming Matches</h3>
                <button id="refreshEventsBtn" class="cs2-refresh-btn">
                  <span class="refresh-icon">🔄</span>
                  Refresh
                </button>
              </div>
              <div id="cs2EventsList" class="cs2-events-list">
                <div class="loading-state">
                  <div class="loading-spinner"></div>
                  <div class="loading-text">Loading matches...</div>
                  <div class="loading-subtext">Fetching the latest tournaments</div>
                </div>
              </div>
            </div>

            <!-- Sidebar Panel -->
            <div class="cs2-sidebar-panel">
              <!-- My Bets Section -->
              <div class="cs2-my-bets-panel">
                <div class="my-bets-header">
                  <h3>📋 My Bets</h3>
                </div>
                <div class="bets-tabs">
                  <button class="bet-tab active" data-tab="open">Open</button>
                  <button class="bet-tab" data-tab="settled">History</button>
                </div>
                <div id="cs2MyBets" class="cs2-my-bets">
                  <div class="empty-state">
                    <div class="empty-state-icon">🎯</div>
                    <div class="empty-state-text">No bets placed yet</div>
                    <div class="empty-state-subtext">Select a match to get started</div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- Enhanced Bet Slip Modal -->
        <div id="cs2BetSlipModal" class="cs2-betslip-modal hidden">
          <div class="cs2-betslip-modal-overlay"></div>
          <div class="cs2-betslip-modal-content">
            <div class="betslip-modal-header">
              <h3>🎯 Bet Slip</h3>
              <button id="closeBetSlipBtn" class="close-btn" title="Close">&times;</button>
            </div>
            
            <!-- Selection Display -->
            <div id="cs2BetSlip" class="betslip-selection">
              <div class="empty-state">
                <div class="empty-state-icon">🎲</div>
                <div class="empty-state-text">Select a match outcome</div>
                <div class="empty-state-subtext">Choose your prediction to continue</div>
              </div>
            </div>

            <!-- Bet Controls -->
            <div id="cs2BetControls" class="cs2-bet-controls hidden">
              <div class="bet-input-group">
                <label for="cs2BetAmount">💰 Bet Amount (Credits)</label>
                <input type="number" id="cs2BetAmount" class="bet-amount-input" 
                       min="1" value="100" step="10" placeholder="Enter amount">
                <div class="quick-bets">
                  <button class="quick-bet-btn" data-amount="50">50</button>
                  <button class="quick-bet-btn" data-amount="100">100</button>
                  <button class="quick-bet-btn" data-amount="250">250</button>
                  <button class="quick-bet-btn" data-amount="500">500</button>
                </div>
              </div>
              
              <div id="cs2PotentialPayout" class="potential-payout hidden">
                <div class="payout-info">
                  <div class="loading-spinner" style="width: 20px; height: 20px;"></div>
                  <div class="loading-text">Calculating payout...</div>
                </div>
              </div>
              
              <div class="betslip-actions">
                <button id="placeBetBtn" class="btn btn-primary btn-large">
                  <span class="bet-btn-icon">🎯</span>
                  Place Bet
                </button>
                <button id="cancelBetBtn" class="btn btn-secondary">Cancel</button>
              </div>
            </div>
          </div>
        </div>

        <!-- Toast Container -->
        <div id="toastContainer" class="toast-container"></div>
      </div>
    `;
  }

  attachEventListeners() {
    this.attachBasicListeners();
    this.attachModernInteractions();
    this.attachKeyboardListeners();
  }

  attachBasicListeners() {
    // Refresh events with enhanced feedback
    const refreshBtn = document.getElementById('refreshEventsBtn');
    if (refreshBtn) {
      refreshBtn.addEventListener('click', this.handleRefreshEvents.bind(this));
    }

    // Theme toggle
    const themeToggle = document.getElementById('themeToggle');
    if (themeToggle) {
      themeToggle.addEventListener('click', this.toggleTheme.bind(this));
    }

    // Bet amount controls with real-time validation
    const betAmountInput = document.getElementById('cs2BetAmount');
    if (betAmountInput) {
      betAmountInput.addEventListener('input', this.handleBetAmountChange.bind(this));
      betAmountInput.addEventListener('blur', this.validateBetAmount.bind(this));
    }

    // Quick bet buttons with haptic feedback
    document.querySelectorAll('.quick-bet-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        this.triggerHapticFeedback('light');
        const amount = parseInt(btn.dataset.amount);
        this.setBetAmount(amount);
        this.animateQuickBetSelection(btn);
      });
    });

    // Enhanced bet placement
    const placeBetBtn = document.getElementById('placeBetBtn');
    if (placeBetBtn) {
      placeBetBtn.addEventListener('click', this.handlePlaceBet.bind(this));
    }

    // Bet tabs with smooth transitions
    document.querySelectorAll('.bet-tab').forEach(tab => {
      tab.addEventListener('click', (e) => {
        this.handleTabSwitch(tab);
      });
    });

    // Modal controls
    this.attachModalListeners();
  }

  attachModernInteractions() {
    // Enhanced odds card interactions
    document.addEventListener('click', (e) => {
      if (e.target.closest('.odds-card:not(.disabled)')) {
        e.preventDefault();
        this.handleOddsSelection(e.target.closest('.odds-card'));
      }
    });

    // Pull-to-refresh gesture (mobile)
    let pullStartY = 0;
    let pullDistance = 0;
    const pullThreshold = 80;

    document.addEventListener('touchstart', (e) => {
      if (window.scrollY === 0) {
        pullStartY = e.touches[0].clientY;
      }
    });

    document.addEventListener('touchmove', (e) => {
      if (pullStartY > 0) {
        pullDistance = e.touches[0].clientY - pullStartY;
        if (pullDistance > 0) {
          e.preventDefault();
          this.updatePullToRefreshIndicator(pullDistance, pullThreshold);
        }
      }
    });

    document.addEventListener('touchend', () => {
      if (pullDistance > pullThreshold) {
        this.handleRefreshEvents();
      }
      this.resetPullToRefresh();
      pullStartY = 0;
      pullDistance = 0;
    });
  }

  attachKeyboardListeners() {
    // Keyboard shortcuts
    document.addEventListener('keydown', (e) => {
      // ESC to close modal
      if (e.key === 'Escape') {
        this.closeBetSlipModal();
      }
      
      // Enter to place bet (if modal is open)
      if (e.key === 'Enter' && !document.getElementById('cs2BetSlipModal').classList.contains('hidden')) {
        e.preventDefault();
        this.handlePlaceBet();
      }

      // R to refresh (with Ctrl/Cmd)
      if ((e.ctrlKey || e.metaKey) && e.key === 'r') {
        e.preventDefault();
        this.handleRefreshEvents();
      }
    });
  }

  setupTouchOptimization() {
    // Enable smooth scrolling
    document.documentElement.style.scrollBehavior = 'smooth';
    
    // Add touch-action optimization
    const scrollContainers = document.querySelectorAll('.cs2-events-list, .cs2-my-bets');
    scrollContainers.forEach(container => {
      container.style.touchAction = 'pan-y';
      container.style.webkitOverflowScrolling = 'touch';
    });

    // Prevent zoom on double-tap for betting buttons
    const bettingElements = document.querySelectorAll('.odds-card, .quick-bet-btn, .btn');
    bettingElements.forEach(element => {
      element.style.touchAction = 'manipulation';
    });
  }

  attachModalListeners() {
    const modal = document.getElementById('cs2BetSlipModal');
    const closeBtn = document.getElementById('closeBetSlipBtn');
    const overlay = modal?.querySelector('.cs2-betslip-modal-overlay');
    const cancelBtn = document.getElementById('cancelBetBtn');

    [closeBtn, overlay, cancelBtn].forEach(element => {
      if (element) {
        element.addEventListener('click', () => {
          this.closeBetSlipModal();
        });
      }
    });
  }

  async handleRefreshEvents() {
    try {
      const refreshBtn = document.getElementById('refreshEventsBtn');
      this.setLoadingState('refresh', true);
      
      if (refreshBtn) {
        refreshBtn.disabled = true;
        refreshBtn.innerHTML = `
          <span class="refresh-icon">🔄</span>
          Refreshing...
        `;
      }

      this.showToast('Syncing latest odds...', 'info');
      
      const serverUrl = window.CASINO_SERVER_URL || this.getServerUrl();
      const response = await fetch(`${serverUrl}/api/cs2/sync`, { method: 'GET' });
      const data = await response.json();

      if (data.success) {
        await this.loadEvents();
        this.showToast('✅ Odds updated successfully!', 'success');
        this.triggerHapticFeedback('success');
      } else {
        throw new Error(data.error || 'Failed to refresh');
      }
    } catch (error) {
      console.error('[CS2 Modern] Refresh error:', error);
      this.showToast('❌ Failed to refresh odds', 'error');
      this.triggerHapticFeedback('error');
    } finally {
      this.setLoadingState('refresh', false);
      const refreshBtn = document.getElementById('refreshEventsBtn');
      if (refreshBtn) {
        refreshBtn.disabled = false;
        refreshBtn.innerHTML = `
          <span class="refresh-icon">🔄</span>
          Refresh
        `;
      }
    }
  }

  toggleTheme() {
    const container = document.querySelector('.cs2-betting-container');
    const themeToggle = document.getElementById('themeToggle');
    
    if (container.dataset.theme === 'dark') {
      container.dataset.theme = 'light';
      themeToggle.innerHTML = '<span class="theme-icon">☀️</span>';
      this.showToast('☀️ Switched to light theme', 'info');
    } else {
      container.dataset.theme = 'dark';
      themeToggle.innerHTML = '<span class="theme-icon">🌙</span>';
      this.showToast('🌙 Switched to dark theme', 'info');
    }
    
    // Save preference
    localStorage.setItem('cs2-theme', container.dataset.theme);
    this.triggerHapticFeedback('light');
  }

  handleBetAmountChange(e) {
    const amount = parseInt(e.target.value) || 0;
    this.betAmount = Math.max(1, amount);
    
    // Real-time validation feedback
    this.validateBetAmount();
    this.updatePotentialPayout();
    
    // Debounced input validation
    clearTimeout(this.validationTimer);
    this.validationTimer = setTimeout(() => {
      this.highlightValidationStatus();
    }, 300);
  }

  validateBetAmount() {
    const input = document.getElementById('cs2BetAmount');
    const currentBalance = this.currentBalance || this.casino?.credits || 0;
    
    if (this.betAmount > currentBalance) {
      input.style.borderColor = 'var(--cs2-danger)';
      this.showToast(`❌ Insufficient credits (${currentBalance} available)`, 'error');
      return false;
    } else if (this.betAmount < 1) {
      input.style.borderColor = 'var(--cs2-warning)';
      this.showToast('⚠️ Minimum bet is 1 credit', 'warning');
      return false;
    } else {
      input.style.borderColor = 'var(--cs2-success)';
      return true;
    }
  }

  setBetAmount(amount) {
    this.betAmount = amount;
    const input = document.getElementById('cs2BetAmount');
    if (input) {
      input.value = amount;
      this.validateBetAmount();
      this.updatePotentialPayout();
    }
  }

  animateQuickBetSelection(selectedBtn) {
    // Remove previous selections
    document.querySelectorAll('.quick-bet-btn').forEach(btn => {
      btn.classList.remove('selected');
    });
    
    // Add selection animation
    selectedBtn.classList.add('selected');
    setTimeout(() => selectedBtn.classList.remove('selected'), 200);
  }

  handleTabSwitch(activeTab) {
    const tabType = activeTab.dataset.tab;
    
    // Update tab states with animation
    document.querySelectorAll('.bet-tab').forEach(tab => {
      tab.classList.remove('active');
    });
    activeTab.classList.add('active');
    
    // Animate content change
    const betsContainer = document.getElementById('cs2MyBets');
    betsContainer.style.opacity = '0.5';
    
    setTimeout(() => {
      this.showBets(tabType);
      betsContainer.style.opacity = '1';
    }, 150);
    
    this.triggerHapticFeedback('light');
  }

  handleOddsSelection(oddsCard) {
    const eventId = oddsCard.dataset.eventId;
    const selection = oddsCard.dataset.selection;
    
    // Visual feedback
    this.animateOddsSelection(oddsCard);
    this.triggerHapticFeedback('medium');
    
    // Fetch odds and show bet slip
    this.selectOutcome(eventId, selection);
  }

  animateOddsSelection(oddsCard) {
    // Remove previous selections
    document.querySelectorAll('.odds-card').forEach(card => {
      card.classList.remove('selected');
    });
    
    // Add selection with animation
    oddsCard.classList.add('selected');
    
    // Pulse animation
    oddsCard.style.transform = 'scale(0.95)';
    setTimeout(() => {
      oddsCard.style.transform = 'scale(1)';
    }, 100);
  }

  async handlePlaceBet() {
    if (!this.selectedEvent || !this.selectedOutcome) {
      this.showToast('❌ Please select a match and outcome', 'error');
      return;
    }

    if (!this.validateBetAmount()) {
      return;
    }

    const placeBetBtn = document.getElementById('placeBetBtn');
    const originalContent = placeBetBtn.innerHTML;
    
    try {
      this.setLoadingState('placeBet', true);
      placeBetBtn.disabled = true;
      placeBetBtn.innerHTML = `
        <div class="loading-spinner" style="width: 16px; height: 16px; margin-right: 8px;"></div>
        Placing Bet...
      `;

      const userId = this.casino.username || sessionStorage.getItem('casinoUsername');
      if (!userId) {
        throw new Error('Please login first');
      }

      const serverUrl = this.getServerUrl();
      const response = await fetch(`${serverUrl}/api/cs2/bets`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId,
          eventId: this.selectedEvent.id,
          selection: this.selectedOutcome,
          amount: this.betAmount
        })
      });

      const data = await response.json();

      if (data.success) {
        // Success feedback with enhanced animations
        this.triggerHapticFeedback('success');
        this.currentBalance = data.newBalance;
        this.casino.credits = this.currentBalance;
        this.casino.updateCreditsDisplay();
        
        // Show success animation
        this.animateBetSuccess();
        this.showToast(`🎉 Bet placed! New balance: ${this.currentBalance} credits`, 'success');
        
        // Reload bets and close modal
        await this.loadBets();
        setTimeout(() => this.closeBetSlipModal(), 1000);
        
      } else {
        throw new Error(data.error || 'Unknown error');
      }
    } catch (error) {
      console.error('Error placing bet:', error);
      this.showToast(`❌ ${error.message}`, 'error');
      this.triggerHapticFeedback('error');
    } finally {
      this.setLoadingState('placeBet', false);
      placeBetBtn.disabled = false;
      placeBetBtn.innerHTML = originalContent;
    }
  }

  animateBetSuccess() {
    const modal = document.querySelector('.cs2-betslip-modal-content');
    modal.style.transform = 'scale(1.05)';
    modal.style.borderColor = 'var(--cs2-success)';
    
    setTimeout(() => {
      modal.style.transform = 'scale(1)';
      modal.style.borderColor = 'var(--cs2-border)';
    }, 300);
  }

  connectToServer() {
    if (typeof io === 'undefined') {
      setTimeout(() => this.connectToServer(), 100);
      return;
    }

    this.socket = this.casino.getSocket();
    
    if (!this.socket) {
      const serverUrl = this.getServerUrl();
      this.socket = io(serverUrl);
    }

    // Set up periodic refresh with intelligent timing
    this.refreshInterval = setInterval(() => {
      if (!this.isLoading) {
        this.loadEvents();
        this.loadBets();
      }
    }, 60000);
  }

  async loadInitialData() {
    this.setLoadingState('initial', true);
    
    try {
      await Promise.all([
        this.loadBalance(),
        this.loadEvents(),
        this.loadBets()
      ]);
      
      // Apply saved theme
      const savedTheme = localStorage.getItem('cs2-theme') || 'dark';
      document.querySelector('.cs2-betting-container').dataset.theme = savedTheme;
      const themeIcon = savedTheme === 'dark' ? '🌙' : '☀️';
      document.querySelector('.theme-icon').textContent = themeIcon;
      
    } catch (error) {
      console.error('Error loading initial data:', error);
      this.renderErrorState(error);
    } finally {
      this.setLoadingState('initial', false);
    }
  }

  async loadBalance() {
    try {
      const userId = this.casino.username || sessionStorage.getItem('casinoUsername');
      if (!userId) return;

      const serverUrl = this.getServerUrl();
      const response = await fetch(`${serverUrl}/api/cs2/balance?userId=${userId}`);
      const data = await response.json();

      if (data.success) {
        this.currentBalance = data.balance;
        if (this.casino.credits !== this.currentBalance) {
          this.casino.credits = this.currentBalance;
          this.casino.updateCreditsDisplay();
        }
      }
    } catch (error) {
      console.error('Error loading balance:', error);
    }
  }

  async loadEvents() {
    try {
      const serverUrl = this.getServerUrl();
      const response = await fetch(`${serverUrl}/api/cs2/events`);
      
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      
      const data = await response.json();

      if (data.success) {
        this.events = data.events || [];
        this.renderEvents();
      } else {
        throw new Error('Failed to load events');
      }
    } catch (error) {
      console.error('[CS2 Modern] Error loading events:', error);
      this.renderEventsError(error);
    }
  }

  renderEvents() {
    const eventsList = document.getElementById('cs2EventsList');
    
    if (this.events.length === 0) {
      eventsList.innerHTML = `
        <div class="empty-state">
          <div class="empty-state-icon">🏆</div>
          <div class="empty-state-text">No upcoming matches</div>
          <div class="empty-state-subtext">Check back later for new tournaments</div>
        </div>
      `;
      return;
    }

    // Filter and group events
    const now = new Date().getTime();
    const upcomingEvents = this.events.filter(event => {
      const eventTime = new Date(event.commenceTime || event.startTime || 0).getTime();
      const isPast = eventTime < now;
      const isFinished = event.status === 'finished';
      const hasRealOdds = this.hasValidOdds(event);
      
      return !isPast && !isFinished && hasRealOdds;
    });

    if (upcomingEvents.length === 0) {
      eventsList.innerHTML = `
        <div class="empty-state">
          <div class="empty-state-icon">⏰</div>
          <div class="empty-state-text">No live odds available</div>
          <div class="empty-state-subtext">Use refresh button to check for updates</div>
        </div>
      `;
      return;
    }

    // Group by tournament
    const groupedEvents = this.groupEventsByTournament(upcomingEvents);
    let htmlContent = '';

    Object.entries(groupedEvents).forEach(([tournament, tournamentEvents]) => {
      htmlContent += this.renderTournamentSection(tournament, tournamentEvents);
    });

    eventsList.innerHTML = htmlContent;
    
    // Add fade-in animation
    eventsList.classList.add('fade-in');
    
    // Attach enhanced event listeners
    this.attachEventCardListeners();
  }

  groupEventsByTournament(events) {
    const grouped = {};
    events.forEach(event => {
      const tournament = event.tournamentName || 'Other Events';
      if (!grouped[tournament]) {
        grouped[tournament] = [];
      }
      grouped[tournament].push(event);
    });

    // Sort tournaments and events
    Object.keys(grouped).sort().forEach(tournament => {
      grouped[tournament].sort((a, b) => {
        const timeA = new Date(a.commenceTime || a.startTime || 0).getTime();
        const timeB = new Date(b.commenceTime || b.startTime || 0).getTime();
        return timeA - timeB;
      });
    });

    return grouped;
  }

  renderTournamentSection(tournament, events) {
    const safeTournamentName = this.escapeHtml(tournament);
    
    return `
      <div class="cs2-tournament-header">
        <div class="cs2-tournament-icon">🏆</div>
        <div class="cs2-tournament-name">${safeTournamentName}</div>
        <div class="cs2-tournament-count">${events.length}</div>
      </div>
      ${events.map(event => this.renderEventCard(event)).join('')}
    `;
  }

  renderEventCard(event) {
    const startTime = new Date(event.commenceTime || event.startTime);
    const isLive = event.status === 'live';
    const canBet = event.status === 'scheduled' || event.status === 'live';
    
    const timeStr = startTime.toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: true
    });

    const homeTeamName = event.homeTeam || event.participant1Name || 'Team 1';
    const awayTeamName = event.awayTeam || event.participant2Name || 'Team 2';
    const safeHomeTeam = this.escapeHtml(homeTeamName);
    const safeAwayTeam = this.escapeHtml(awayTeamName);
    
    const team1Odds = this.getDisplayOdds(event.odds?.team1);
    const team2Odds = this.getDisplayOdds(event.odds?.team2);
    
    const homeTeamLogo = this.getTeamLogo(homeTeamName);
    const awayTeamLogo = this.getTeamLogo(awayTeamName);

    return `
      <div class="cs2-event-card ${isLive ? 'live' : ''}" data-event-id="${event.id}">
        <div class="event-match-header">
          <div class="match-time-status">
            <div class="match-time">${timeStr}</div>
            ${isLive ? '<div class="match-live-badge">🔴 LIVE</div>' : ''}
          </div>
          <div class="match-status-badge ${event.status}">${this.getStatusText(event.status)}</div>
        </div>
        
        <div class="event-match-content">
          <div class="event-teams-list">
            <div class="teams-header">Teams</div>
            <div class="event-team-row">
              <div class="team-logo-container">
                <img src="${homeTeamLogo}" alt="${safeHomeTeam}" class="team-logo" 
                     onerror="this.src='${this.getFallbackLogo(homeTeamName)}'">
              </div>
              <div class="team-name">${safeHomeTeam}</div>
            </div>
            <div class="event-team-row">
              <div class="team-logo-container">
                <img src="${awayTeamLogo}" alt="${safeAwayTeam}" class="team-logo" 
                     onerror="this.src='${this.getFallbackLogo(awayTeamName)}'">
              </div>
              <div class="team-name">${safeAwayTeam}</div>
            </div>
          </div>
          
          <div class="event-odds-section">
            <div class="odds-header">Winner</div>
            <div class="odds-grid">
              <button class="odds-card ${canBet ? '' : 'disabled'}" 
                      data-event-id="${event.id}" 
                      data-selection="team1"
                      ${!canBet ? 'disabled' : ''}
                      title="Bet on ${safeHomeTeam}">
                <div class="odds-team-name">${safeHomeTeam}</div>
                <div class="odds-value ${team1Odds < team2Odds ? 'favorite' : ''}">${team1Odds.toFixed(2)}</div>
              </button>
              <button class="odds-card ${canBet ? '' : 'disabled'}" 
                      data-event-id="${event.id}" 
                      data-selection="team2"
                      ${!canBet ? 'disabled' : ''}
                      title="Bet on ${safeAwayTeam}">
                <div class="odds-team-name">${safeAwayTeam}</div>
                <div class="odds-value ${team2Odds < team1Odds ? 'favorite' : ''}">${team2Odds.toFixed(2)}</div>
              </button>
            </div>
          </div>
        </div>
      </div>
    `;
  }

  attachEventCardListeners() {
    // Enhanced odds card interactions
    document.querySelectorAll('.odds-card:not(.disabled)').forEach(card => {
      card.addEventListener('click', async (e) => {
        e.preventDefault();
        e.stopPropagation();
        
        const eventId = card.dataset.eventId;
        const selection = card.dataset.selection;
        
        await this.fetchEventOddsIfNeeded(eventId);
        this.selectOutcome(eventId, selection);
      });

      // Long press for quick bet (mobile)
      card.addEventListener('touchstart', (e) => {
        this.longPressTimer = setTimeout(() => {
          this.triggerHapticFeedback('medium');
          this.showToast('💡 Tap to select, hold for quick bet', 'info');
        }, 800);
      });

      card.addEventListener('touchend', () => {
        clearTimeout(this.longPressTimer);
      });
    });
  }

  async selectOutcome(eventId, selection) {
    const event = this.events.find(e => e.id === eventId);
    if (!event) {
      console.error(`Event ${eventId} not found`);
      return;
    }

    // Ensure odds exist
    if (!event.odds) {
      event.odds = {};
    }
    if (!event.odds[selection]) {
      event.odds[selection] = 2.0; // Default odds
    }

    this.selectedEvent = event;
    this.selectedOutcome = selection;

    // Show bet slip with animation
    this.showBetSlipModal();
    this.renderBetSelection();
    this.updatePotentialPayout();
  }

  showBetSlipModal() {
    const modal = document.getElementById('cs2BetSlipModal');
    modal.classList.remove('hidden');
    
    // Prevent background scroll
    document.body.style.overflow = 'hidden';
    
    // Focus management for accessibility
    setTimeout(() => {
      const closeBtn = document.getElementById('closeBetSlipBtn');
      if (closeBtn) closeBtn.focus();
    }, 100);
  }

  closeBetSlipModal() {
    const modal = document.getElementById('cs2BetSlipModal');
    modal.classList.add('hidden');
    
    // Restore background scroll
    document.body.style.overflow = '';
    
    // Reset selection
    this.selectedEvent = null;
    this.selectedOutcome = null;
    
    // Reset UI
    const betSlip = document.getElementById('cs2BetSlip');
    const betControls = document.getElementById('cs2BetControls');
    
    if (betSlip) {
      betSlip.innerHTML = `
        <div class="empty-state">
          <div class="empty-state-icon">🎲</div>
          <div class="empty-state-text">Select a match outcome</div>
          <div class="empty-state-subtext">Choose your prediction to continue</div>
        </div>
      `;
    }
    
    if (betControls) {
      betControls.classList.add('hidden');
    }
    
    // Remove odds selections
    document.querySelectorAll('.odds-card.selected').forEach(card => {
      card.classList.remove('selected');
    });
  }

  renderBetSelection() {
    if (!this.selectedEvent || !this.selectedOutcome) return;

    const betSlip = document.getElementById('cs2BetSlip');
    const betControls = document.getElementById('cs2BetControls');
    
    const selectionName = this.selectedOutcome === 'team1' ? 
      this.selectedEvent.homeTeam : this.selectedEvent.awayTeam;
    const odds = this.selectedEvent.odds?.[this.selectedOutcome] || 2.0;

    betSlip.innerHTML = `
      <div class="selection-match">
        <div class="match-tournament">
          🏆 ${this.selectedEvent.tournamentName || 'Tournament'}
        </div>
        <div class="match-teams">
          <span>${this.selectedEvent.homeTeam || 'Team 1'}</span>
          <span class="vs-text">vs</span>
          <span>${this.selectedEvent.awayTeam || 'Team 2'}</span>
        </div>
      </div>
      <div class="selection-outcome">
        <div class="outcome-label">Your Selection:</div>
        <div class="outcome-value">${selectionName} @ ${odds.toFixed(2)}</div>
      </div>
    `;

    betControls.classList.remove('hidden');
  }

  updatePotentialPayout() {
    if (!this.selectedEvent || !this.selectedOutcome) return;

    const odds = this.selectedEvent.odds?.[this.selectedOutcome] || 2.0;
    const payout = this.betAmount * odds;
    const profit = payout - this.betAmount;

    const payoutDiv = document.getElementById('cs2PotentialPayout');
    payoutDiv.classList.remove('hidden');
    payoutDiv.innerHTML = `
      <div class="payout-info">
        <div>
          <span>Bet Amount:</span>
          <span class="payout-value">${this.betAmount} credits</span>
        </div>
        <div>
          <span>Potential Payout:</span>
          <span class="payout-value">${payout.toFixed(2)} credits</span>
        </div>
        <div class="total-payout">
          <span>Potential Profit:</span>
          <span class="payout-value profit">+${profit.toFixed(2)} credits</span>
        </div>
      </div>
    `;
  }

  async loadBets() {
    try {
      const userId = this.casino.username || sessionStorage.getItem('casinoUsername');
      if (!userId) return;

      const serverUrl = this.getServerUrl();
      const response = await fetch(`${serverUrl}/api/cs2/bets?userId=${userId}`);
      const data = await response.json();

      if (data.success) {
        this.bets = data.bets || [];
        this.showBets('open'); // Show current tab
      }
    } catch (error) {
      console.error('Error loading bets:', error);
    }
  }

  showBets(tabType) {
    const betsContainer = document.getElementById('cs2MyBets');
    
    const filteredBets = tabType === 'open' 
      ? this.bets.filter(b => b.status === 'pending')
      : this.bets.filter(b => b.status !== 'pending');

    if (filteredBets.length === 0) {
      const emptyMessage = tabType === 'open' 
        ? 'No open bets' 
        : 'No betting history';
      const emptySubtext = tabType === 'open'
        ? 'Place a bet to get started'
        : 'Your completed bets will appear here';
      
      betsContainer.innerHTML = `
        <div class="empty-state">
          <div class="empty-state-icon">${tabType === 'open' ? '🎯' : '📊'}</div>
          <div class="empty-state-text">${emptyMessage}</div>
          <div class="empty-state-subtext">${emptySubtext}</div>
        </div>
      `;
      return;
    }

    betsContainer.innerHTML = filteredBets.map(bet => this.renderBetCard(bet)).join('');
  }

  renderBetCard(bet) {
    const event = this.events.find(e => e.id === bet.eventId);
    const eventName = event 
      ? `${event.homeTeam} vs ${event.awayTeam}` 
      : `Event ${bet.eventId}`;
    
    const selectionName = bet.selection === 'team1' ? event?.homeTeam :
                         bet.selection === 'team2' ? event?.awayTeam : 'Draw';
    
    const statusClass = bet.status === 'won' ? 'won' :
                       bet.status === 'lost' ? 'lost' :
                       bet.status === 'void' ? 'void' : 'pending';
    
    const statusText = this.getStatusBadge(bet.status);
    const potentialPayout = bet.potentialPayout || (bet.amount * bet.odds);

    return `
      <div class="cs2-bet-card ${statusClass}">
        <div class="bet-header">
          <div class="bet-id">#${bet.id.substring(bet.id.length - 8).toUpperCase()}</div>
          <div class="bet-status ${statusClass}">${statusText}</div>
        </div>
        <div class="bet-match">${eventName}</div>
        <div class="bet-selection">Selection: <strong>${selectionName}</strong></div>
        <div class="bet-details">
          <div class="bet-detail-item">
            <div class="bet-detail-label">Stake:</div>
            <div class="bet-detail-value">${bet.amount}</div>
          </div>
          <div class="bet-detail-item">
            <div class="bet-detail-label">Odds:</div>
            <div class="bet-detail-value">${bet.odds.toFixed(2)}</div>
          </div>
          <div class="bet-detail-item">
            <div class="bet-detail-label">Payout:</div>
            <div class="bet-detail-value ${bet.status === 'won' ? 'profit' : bet.status === 'lost' ? 'loss' : ''}">${potentialPayout.toFixed(2)}</div>
          </div>
        </div>
        ${bet.settledAt ? `<div class="bet-settled">Settled: ${new Date(bet.settledAt).toLocaleString()}</div>` : ''}
      </div>
    `;
  }

  // Utility Functions
  getServerUrl() {
    const hostname = window.location.hostname;
    
    if (hostname === 'localhost' || hostname === '127.0.0.1' || 
        hostname.startsWith('192.168.') || hostname.startsWith('10.') || 
        hostname.startsWith('172.')) {
      return `${window.location.protocol}//${hostname}:3001`;
    }
    
    return window.location.origin;
  }

  hasValidOdds(event) {
    return event.hasOdds === true || 
      (event.odds && 
       event.odds.team1 !== null && event.odds.team1 !== undefined && event.odds.team1 !== 2.0 &&
       event.odds.team2 !== null && event.odds.team2 !== undefined && event.odds.team2 !== 2.0);
  }

  getDisplayOdds(odds) {
    return odds !== null && odds !== undefined ? odds : 2.0;
  }

  getTeamLogo(teamName) {
    const encodedName = encodeURIComponent(teamName);
    return `https://ui-avatars.com/api/?name=${encodedName}&size=64&background=random&color=fff&bold=true`;
  }

  getFallbackLogo(teamName) {
    const initial = teamName.charAt(0).toUpperCase();
    return `data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='64' height='64'%3E%3Crect fill='%23333' width='64' height='64'/%3E%3Ctext fill='%23fff' x='50%25' y='50%25' text-anchor='middle' dy='.3em' font-size='24'%3E${initial}%3C/text%3E%3C/svg%3E`;
  }

  getStatusText(status) {
    const statusMap = {
      'scheduled': '📅 Scheduled',
      'live': '🔴 Live',
      'finished': '✅ Finished'
    };
    return statusMap[status] || status;
  }

  getStatusBadge(status) {
    const statusMap = {
      'won': '✓ Won',
      'lost': '✗ Lost',
      'void': '⊘ Void',
      'pending': '⏳ Pending'
    };
    return statusMap[status] || status;
  }

  escapeHtml(text) {
    if (!text) return '';
    const map = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#039;'
    };
    return String(text).replace(/[&<>"']/g, m => map[m]);
  }

  // Modern UI Helpers
  setLoadingState(key, isLoading) {
    this.loadingStates.set(key, isLoading);
    this.isLoading = Array.from(this.loadingStates.values()).some(state => state);
  }

  triggerHapticFeedback(type = 'light') {
    if (!this.hapticEnabled) return;
    
    const patterns = {
      light: 10,
      medium: 50,
      heavy: 100,
      success: [10, 50, 10],
      error: [100, 50, 100]
    };
    
    try {
      navigator.vibrate(patterns[type] || 10);
    } catch (error) {
      // Haptic feedback not supported
    }
  }

  showToast(message, type = 'info', duration = 3000) {
    // Remove existing toasts
    const existingToasts = document.querySelectorAll('.cs2-toast');
    existingToasts.forEach(toast => toast.remove());
    
    const toast = document.createElement('div');
    toast.className = `cs2-toast ${type}`;
    toast.textContent = message;
    
    document.body.appendChild(toast);
    
    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateX(100%)';
      setTimeout(() => toast.remove(), 300);
    }, duration);
    
    this.toast = toast;
  }

  updatePullToRefreshIndicator(distance, threshold) {
    const progress = Math.min(distance / threshold, 1);
    const header = document.querySelector('.cs2-header');
    
    if (header) {
      header.style.transform = `translateY(${Math.min(distance * 0.5, 40)}px)`;
      header.style.opacity = 0.7 + (progress * 0.3);
    }
  }

  resetPullToRefresh() {
    const header = document.querySelector('.cs2-header');
    if (header) {
      header.style.transform = '';
      header.style.opacity = '';
    }
  }

  renderErrorState(error) {
    const gameView = document.getElementById('cs2BettingGame');
    gameView.innerHTML = `
      <div class="cs2-betting-container">
        <div class="cs2-container">
          <div class="error-state">
            <div class="error-state-icon">⚠️</div>
            <div class="error-text">Failed to load CS2 betting</div>
            <div class="error-subtext">${error.message}</div>
            <button class="btn btn-primary" onclick="location.reload()">
              🔄 Retry
            </button>
          </div>
        </div>
      </div>
    `;
  }

  renderEventsError(error) {
    const eventsList = document.getElementById('cs2EventsList');
    eventsList.innerHTML = `
      <div class="error-state">
        <div class="error-state-icon">🔌</div>
        <div class="error-text">Failed to load matches</div>
        <div class="error-subtext">${error.message}</div>
      </div>
    `;
  }

  async fetchEventOddsIfNeeded(eventId) {
    const event = this.events.find(e => e.id === eventId);
    if (!event || (event.odds?.team1 && event.odds?.team2)) {
      return true;
    }

    try {
      const serverUrl = this.getServerUrl();
      const response = await fetch(`${serverUrl}/api/cs2/events/${eventId}/odds`);
      
      if (response.ok) {
        const data = await response.json();
        if (data.success && data.event?.odds) {
          const eventIndex = this.events.findIndex(e => e.id === eventId);
          if (eventIndex !== -1) {
            this.events[eventIndex].odds = data.event.odds;
            this.events[eventIndex].hasOdds = true;
            this.renderEvents(); // Re-render with updated odds
            return true;
          }
        }
      }
    } catch (error) {
      console.error(`Error fetching odds for event ${eventId}:`, error);
    }
    
    return false;
  }

  cleanup() {
    if (this.refreshInterval) {
      clearInterval(this.refreshInterval);
      this.refreshInterval = null;
    }
    
    if (this.validationTimer) {
      clearTimeout(this.validationTimer);
    }
    
    if (this.longPressTimer) {
      clearTimeout(this.longPressTimer);
    }
    
    // Remove any active toasts
    if (this.toast) {
      this.toast.remove();
    }
    
    // Restore body scroll
    document.body.style.overflow = '';
  }

  destroy() {
    this.cleanup();
  }
}

// Export for casino.js integration
window.CS2ModernBettingGame = CS2ModernBettingGame;
console.log('[CS2 Modern] CS2ModernBettingGame class exported to window');