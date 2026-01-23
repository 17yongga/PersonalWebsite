// CS2 Betting Game Module - Follows existing casino game pattern

// Team logo mapping - loaded from cs2-team-logos.json
let teamLogos = null;

// Load team logos mapping
async function loadTeamLogos() {
  if (teamLogos !== null) return teamLogos; // Already loaded
  
  try {
    const response = await fetch('cs2-team-logos.json');
    if (response.ok) {
      const data = await response.json();
      teamLogos = data;
      console.log('[CS2 Betting] Loaded team logos mapping');
      return teamLogos;
    }
  } catch (error) {
    console.warn('[CS2 Betting] Could not load team logos file, using fallback:', error);
  }
  
  // Return empty object if file doesn't exist
  teamLogos = { teams: {}, logoBasePath: '', fallbackLogoService: 'https://ui-avatars.com/api/' };
  return teamLogos;
}

class CS2BettingGame {
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
    this.teamLogos = null;
    this.init();
  }

  init() {
    try {
      console.log('[CS2 Betting] Initializing game...');
      console.log('[CS2 Betting] Casino manager:', this.casino);
      console.log('[CS2 Betting] Server URL:', window.CASINO_SERVER_URL);
      
      const gameView = document.getElementById('cs2BettingGame');
      if (!gameView) {
        console.error('[CS2 Betting] Game view element not found! Looking for #cs2BettingGame');
        console.error('[CS2 Betting] Available game views:', document.querySelectorAll('.game-view'));
        // Try to find it after a short delay
        setTimeout(() => this.init(), 100);
        return;
      }
      
      console.log('[CS2 Betting] Game view element found:', gameView);
      console.log('[CS2 Betting] Game view classes:', gameView.className);
      console.log('[CS2 Betting] Game view hidden:', gameView.classList.contains('hidden'));
      
      // Make sure the game view is visible
      if (gameView.classList.contains('hidden')) {
        console.log('[CS2 Betting] Game view is hidden, removing hidden class...');
        gameView.classList.remove('hidden');
      }
      
      console.log('[CS2 Betting] Setting up UI...');
      gameView.innerHTML = `
        <div class="cs2-betting-container">
          <h2 class="game-title">🎮 CS2 Fantasy Betting</h2>
          
          <!-- Disclaimer Banner -->
          <div class="cs2-disclaimer">
            <p>This is a fantasy betting experience using fake credits only. No real money is used or won.</p>
          </div>

          <div class="cs2-betting-layout">
            <!-- Main Panel: Events/Matches List -->
            <div class="cs2-events-panel">
              <div class="events-panel-header">
                <h3>Upcoming Matches</h3>
                <button id="refreshEventsBtn" class="btn btn-secondary btn-small">🔄 Refresh</button>
              </div>
              <div id="cs2EventsList" class="cs2-events-list">
                <p class="loading-text">Loading matches...</p>
              </div>
            </div>

            <!-- Right Panel: My Bets -->
            <div class="cs2-my-bets-panel">
              <h3>My Bets</h3>
              <div class="bets-tabs">
                <button class="bet-tab active" data-tab="open">Open</button>
                <button class="bet-tab" data-tab="settled">Settled</button>
              </div>
              <div id="cs2MyBets" class="cs2-my-bets">
                <p class="no-bets">No bets placed yet</p>
              </div>
            </div>
          </div>

          <!-- Bet Slip Modal (Popup) -->
          <div id="cs2BetSlipModal" class="cs2-betslip-modal hidden">
            <div class="cs2-betslip-modal-overlay"></div>
            <div class="cs2-betslip-modal-content">
              <div class="betslip-modal-header">
                <h3>Bet Slip</h3>
                <button id="closeBetSlipBtn" class="close-btn">&times;</button>
              </div>
              <div id="cs2BetSlip" class="cs2-betslip">
                <p class="no-selection">Select a match and outcome to place a bet</p>
              </div>
              <div id="cs2BetControls" class="cs2-bet-controls hidden">
                <div class="bet-input-group">
                  <label>Bet Amount (Credits):</label>
                  <input type="number" id="cs2BetAmount" min="1" value="100" step="10">
                  <div class="quick-bets">
                    <button type="button" class="quick-bet-btn" data-amount="50">50</button>
                    <button type="button" class="quick-bet-btn" data-amount="100">100</button>
                    <button type="button" class="quick-bet-btn" data-amount="250">250</button>
                    <button type="button" class="quick-bet-btn" data-amount="500">500</button>
                  </div>
                </div>
                <div id="cs2PotentialPayout" class="potential-payout"></div>
                <div class="betslip-actions">
                  <button id="placeBetBtn" type="button" class="btn btn-primary btn-large">Place Bet</button>
                  <button id="cancelBetBtn" type="button" class="btn btn-secondary">Cancel</button>
                </div>
              </div>
            </div>
          </div>
        </div>
      `;

      console.log('[CS2 Betting] UI setup complete, attaching event listeners...');
      this.attachEventListeners();
      console.log('[CS2 Betting] Event listeners attached');
      
      this.connectToServer();
      console.log('[CS2 Betting] Server connection initiated');
      
      console.log('[CS2 Betting] Starting to load initial data...');
      this.loadInitialData().then(() => {
        console.log('[CS2 Betting] Initial data loading complete!');
      }).catch((error) => {
        console.error('[CS2 Betting] Error loading initial data:', error);
      });
      
      this._initialized = true;
      console.log('[CS2 Betting] Initialization complete!');
    } catch (error) {
      console.error('[CS2 Betting] Error during initialization:', error);
      this._initialized = false; // Allow retry on error
      const gameView = document.getElementById('cs2BettingGame');
      if (gameView) {
        gameView.innerHTML = `
          <div class="cs2-betting-container">
            <h2 class="game-title">🎮 CS2 Fantasy Betting</h2>
            <div class="error-text">
              <p>Error loading game: ${error.message}</p>
              <p>Please refresh the page or contact support.</p>
            </div>
          </div>
        `;
      }
    }
  }

  connectToServer() {
    // Wait for socket.io to be available
    if (typeof io === 'undefined') {
      setTimeout(() => this.connectToServer(), 100);
      return;
    }

    // Use shared socket from casino manager if available
    this.socket = this.casino.getSocket();
    
    if (!this.socket) {
      // Fallback: create new socket connection
      const serverUrl = window.CASINO_SERVER_URL || window.location.origin;
      this.socket = io(serverUrl);
    }

    // Socket.IO handlers for CS2 betting (if we add them later)
    // For now, we'll use REST API calls to match the SRD pattern
    // but follow the existing UI structure

    // Set up periodic refresh
    this.refreshInterval = setInterval(() => {
      this.loadEvents();
      this.loadBets();
    }, 60000); // Refresh every minute
  }

  attachEventListeners() {
    // Refresh events button - calls API to sync and update odds
    document.getElementById('refreshEventsBtn')?.addEventListener('click', async () => {
      try {
        const serverUrl = window.CASINO_SERVER_URL || (window.location.hostname === 'localhost' ? 'http://localhost:3001' : window.location.origin);
        const refreshBtn = document.getElementById('refreshEventsBtn');
        if (refreshBtn) {
          refreshBtn.disabled = true;
          refreshBtn.textContent = '🔄 Refreshing...';
        }
        
        console.log('[CS2 Frontend] Refresh button clicked - calling API sync...');
        const response = await fetch(`${serverUrl}/api/cs2/sync`, { method: 'GET' });
        const data = await response.json();
        
        if (data.success) {
          console.log('[CS2 Frontend] Refresh successful:', data);
          // Reload events after sync
          await this.loadEvents();
        } else {
          console.error('[CS2 Frontend] Refresh failed:', data);
          alert('Failed to refresh matches. Please try again later.');
        }
        
        if (refreshBtn) {
          refreshBtn.disabled = false;
          refreshBtn.textContent = '🔄 Refresh';
        }
      } catch (error) {
        console.error('[CS2 Frontend] Error refreshing:', error);
        alert('Error refreshing matches. Please try again later.');
        const refreshBtn = document.getElementById('refreshEventsBtn');
        if (refreshBtn) {
          refreshBtn.disabled = false;
          refreshBtn.textContent = '🔄 Refresh';
        }
      }
    });

    // Bet amount quick buttons
    document.querySelectorAll('.quick-bet-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const amount = parseInt(btn.dataset.amount);
        document.getElementById('cs2BetAmount').value = amount;
        this.betAmount = amount;
        this.updatePotentialPayout();
      });
    });

    // Bet amount input
    const betAmountInput = document.getElementById('cs2BetAmount');
    if (betAmountInput) {
      betAmountInput.addEventListener('input', (e) => {
        this.betAmount = parseInt(e.target.value) || 0;
        this.updatePotentialPayout();
      });
      
      // Prevent Enter key from submitting/form navigation
      betAmountInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          e.stopPropagation();
          // Optionally trigger bet placement on Enter
          document.getElementById('placeBetBtn')?.click();
        }
      });
    }

    // Place bet button
    document.getElementById('placeBetBtn')?.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.placeBet();
    });

    // Bet tabs
    document.querySelectorAll('.bet-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        document.querySelectorAll('.bet-tab').forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        const tabType = tab.dataset.tab;
        this.showBets(tabType);
      });
    });

    // Bet slip modal close handlers
    const closeBetSlipBtn = document.getElementById('closeBetSlipBtn');
    const betSlipModal = document.getElementById('cs2BetSlipModal');
    const betSlipOverlay = betSlipModal?.querySelector('.cs2-betslip-modal-overlay');
    const cancelBetBtn = document.getElementById('cancelBetBtn');

    if (closeBetSlipBtn) {
      closeBetSlipBtn.addEventListener('click', () => {
        this.closeBetSlipModal();
      });
    }

    if (betSlipOverlay) {
      betSlipOverlay.addEventListener('click', () => {
        this.closeBetSlipModal();
      });
    }

    if (cancelBetBtn) {
      cancelBetBtn.addEventListener('click', () => {
        this.closeBetSlipModal();
      });
    }
  }

  closeBetSlipModal() {
    const betSlipModal = document.getElementById('cs2BetSlipModal');
    if (betSlipModal) {
      betSlipModal.classList.add('hidden');
      // Reset selection
      this.selectedEvent = null;
      this.selectedOutcome = null;
      const betSlip = document.getElementById('cs2BetSlip');
      const betControls = document.getElementById('cs2BetControls');
      if (betSlip) {
        betSlip.innerHTML = '<p class="no-selection">Select a match and outcome to place a bet</p>';
      }
      if (betControls) {
        betControls.classList.add('hidden');
      }
    }
  }

  async loadInitialData() {
    console.log('[CS2 Betting] loadInitialData called');
    try {
      // Load team rankings and logos first (needed for rendering)
      await this.loadTeamRankings();
      await this.loadTeamLogos();
      
      await Promise.all([
        this.loadBalance().catch(err => console.error('[CS2 Betting] Error loading balance:', err)),
        this.loadEvents().catch(err => console.error('[CS2 Betting] Error loading events:', err)),
        this.loadBets().catch(err => console.error('[CS2 Betting] Error loading bets:', err))
      ]);
      console.log('[CS2 Betting] All initial data loaded');
    } catch (error) {
      console.error('[CS2 Betting] Error in loadInitialData:', error);
    }
  }

  async loadTeamLogos() {
    try {
      const logos = await loadTeamLogos();
      this.teamLogos = logos;
      console.log('[CS2 Betting] Team logos loaded:', Object.keys(logos.teams || {}).length, 'teams');
      console.log('[CS2 Betting] Logo base path:', logos.logoBasePath);
    } catch (err) {
      console.warn('[CS2 Betting] Error loading team logos:', err);
      this.teamLogos = { teams: {}, logoBasePath: '', fallbackLogoService: 'https://ui-avatars.com/api/' };
    }
  }

  async loadTeamRankings() {
    try {
      const response = await fetch('cs2-team-rankings.json');
      if (response.ok) {
        const data = await response.json();
        window.cs2TeamRankings = data;
        console.log('[CS2 Betting] Loaded team rankings:', data.teams?.length || 0, 'teams');
      }
    } catch (error) {
      console.warn('[CS2 Betting] Could not load team rankings:', error);
    }
  }

  async loadBalance() {
    try {
      const userId = this.casino.username || sessionStorage.getItem('casinoUsername');
      if (!userId) return;

      const serverUrl = window.CASINO_SERVER_URL || window.location.origin;
      const response = await fetch(`${serverUrl}/api/cs2/balance?userId=${userId}`);
      const data = await response.json();

      if (data.success) {
        this.currentBalance = data.balance;
        // Update casino balance display if needed - use setCredits to set absolute value
        if (this.casino.setCredits) {
          this.casino.setCredits(this.currentBalance);
        } else if (this.casino.updateCredits) {
          // Fallback: calculate difference if setCredits doesn't exist
          const difference = this.currentBalance - (this.casino.credits || 0);
          this.casino.updateCredits(difference);
        }
      }
    } catch (error) {
      console.error('Error loading balance:', error);
    }
  }

  async loadEvents() {
    try {
      // Auto-detect server URL for local vs production
      let serverUrl = window.CASINO_SERVER_URL;
      if (!serverUrl || serverUrl === window.location.origin) {
        // Fallback: if on localhost, use port 3001 (casino server)
        if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
          serverUrl = 'http://localhost:3001';
        } else {
          serverUrl = window.location.origin;
        }
      }
      
      console.log(`[CS2 Frontend] Fetching events from: ${serverUrl}/api/cs2/events`);
      
      const response = await fetch(`${serverUrl}/api/cs2/events`);
      
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      
      const data = await response.json();

      console.log(`[CS2 Frontend] Events response:`, data);

      if (data.success) {
        this.events = data.events || [];
        console.log(`[CS2 Frontend] Loaded ${this.events.length} events`);
        
        // Debug: Log first event structure
        if (this.events.length > 0) {
          console.log('[CS2 Frontend] First event sample:', this.events[0]);
          console.log('[CS2 Frontend] Event structure check:', {
            hasId: !!this.events[0].id,
            hasFixtureId: !!this.events[0].fixtureId,
            id: this.events[0].id,
            homeTeam: this.events[0].homeTeam,
            awayTeam: this.events[0].awayTeam,
            commenceTime: this.events[0].commenceTime,
            status: this.events[0].status,
            hasOdds: !!this.events[0].odds,
            odds: this.events[0].odds,
            oddsTeam1: this.events[0].odds?.team1,
            oddsTeam2: this.events[0].odds?.team2
          });
        } else {
          console.warn('[CS2 Frontend] Events array is empty! Response:', data);
        }
        
        // NOTE: Do NOT automatically fetch odds from API
        // API calls are restricted to: server start, refresh button, and daily updates
        // Odds will be available if they were fetched during those times
        
        this.renderEvents();
      } else {
        console.error('[CS2 Frontend] API returned success=false:', data);
        document.getElementById('cs2EventsList').innerHTML = 
          '<p class="error-text">Failed to load events. Please try again later.</p>';
      }
    } catch (error) {
      console.error('[CS2 Frontend] Error loading events:', error);
      const eventsList = document.getElementById('cs2EventsList');
      if (eventsList) {
        eventsList.innerHTML = 
          '<p class="error-text">Error loading events. Check server connection.<br>' +
          `Error: ${error.message}</p>`;
      }
    }
  }

  async loadBets() {
    try {
      const userId = this.casino.username || sessionStorage.getItem('casinoUsername');
      if (!userId) return;

      const serverUrl = window.CASINO_SERVER_URL || window.location.origin;
      const response = await fetch(`${serverUrl}/api/cs2/bets?userId=${userId}`);
      const data = await response.json();

      if (data.success) {
        this.bets = data.bets || [];
        this.showBets('open'); // Default to open bets
      }
    } catch (error) {
      console.error('Error loading bets:', error);
    }
  }

  renderEvents() {
    console.log('[CS2 Betting] renderEvents called, events count:', this.events.length);
    const eventsList = document.getElementById('cs2EventsList');
    
    if (!eventsList) {
      console.error('[CS2 Betting] Events list element not found! Looking for #cs2EventsList');
      return;
    }
    
    if (this.events.length === 0) {
      console.log('[CS2 Betting] No events to render, showing empty message');
      eventsList.innerHTML = '<p class="no-events">No upcoming matches available. Check back later!</p>';
      return;
    }

    // Filter out past matches, finished matches, and matches without real odds
    const now = new Date().getTime();
    const upcomingEvents = this.events.filter(event => {
      const eventTime = new Date(event.commenceTime || event.startTime || 0).getTime();
      const isPast = eventTime < now;
      const isFinished = event.status === 'finished';
      
      // Filter out matches without real odds
      // A match has real odds if:
      // 1. hasOdds is explicitly true, OR
      // 2. odds object exists and has valid odds for BOTH teams (not null/undefined, not placeholder 2.0)
      const hasRealOdds = event.hasOdds === true || 
        (event.odds && 
         event.odds.team1 !== null && event.odds.team1 !== undefined && event.odds.team1 !== 2.0 &&
         event.odds.team2 !== null && event.odds.team2 !== undefined && event.odds.team2 !== 2.0);
      
      return !isPast && !isFinished && hasRealOdds;
    });

    if (upcomingEvents.length === 0) {
      eventsList.innerHTML = '<p class="no-events">No upcoming matches available. Check back later!</p>';
      return;
    }

    // Helper function to get display odds (default to 2.0 if unavailable)
    const getDisplayOdds = (odds) => {
      return odds !== null && odds !== undefined ? odds : 2.0;
    };

    // Group events by tournament name
    const groupedEvents = {};
    upcomingEvents.forEach(event => {
      const tournament = event.tournamentName || 'Other Events';
      if (!groupedEvents[tournament]) {
        groupedEvents[tournament] = [];
      }
      groupedEvents[tournament].push(event);
    });

    // Sort tournaments alphabetically, then sort matches within each tournament by time
    const sortedTournaments = Object.keys(groupedEvents).sort();
    sortedTournaments.forEach(tournament => {
      groupedEvents[tournament].sort((a, b) => {
        const timeA = new Date(a.commenceTime || a.startTime || 0).getTime();
        const timeB = new Date(b.commenceTime || b.startTime || 0).getTime();
        return timeA - timeB; // Ascending: earliest first
      });
    });

    // Build HTML with tournament headers and grouped matches
    let htmlContent = '';
    
    sortedTournaments.forEach(tournament => {
      const tournamentEvents = groupedEvents[tournament];
      
      // Render tournament header
      const safeTournamentName = tournament.replace(/[&<>"']/g, m => {
        const map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' };
        return map[m];
      });
      
      htmlContent += `
        <div class="tournament-header">
          <span class="tournament-icon">🎮</span>
          <span class="tournament-name">${safeTournamentName}</span>
        </div>
      `;
      
      // Render matches in this tournament
      tournamentEvents.forEach(event => {
        const startTime = new Date(event.commenceTime || event.startTime);
        const isLive = event.status === 'live';
        const isFinished = event.status === 'finished';
        const canBet = event.status === 'scheduled' || event.status === 'live';
        
        // Format time - full date and time format (e.g., 'Jan 13, 04:00 AM')
        const timeStr = startTime.toLocaleString('en-US', {
          month: 'short',
          day: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
          hour12: true
        });

        // Escape HTML in team names for safety
        const escapeHtml = (text) => {
          if (!text) return '';
          const map = {
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            '"': '&quot;',
            "'": '&#039;'
          };
          return String(text).replace(/[&<>"']/g, m => map[m]);
        };
        
        // Get team names from various possible fields
        const homeTeamName = event.homeTeam || event.participant1Name || event.team1 || event.teamHome || 'Team 1';
        const awayTeamName = event.awayTeam || event.participant2Name || event.team2 || event.teamAway || 'Team 2';
        const safeHomeTeam = escapeHtml(homeTeamName);
        const safeAwayTeam = escapeHtml(awayTeamName);
        
        // Get team logos - try to find actual logo, return null if not found (will use acronym)
        const getTeamLogo = (teamName) => {
          if (!teamName) return null;
          
          // Try to find team in rankings to get canonical name
          const teamRanking = this.findTeamInRankings(teamName);
          const canonicalName = teamRanking ? teamRanking.name : teamName;
          
          // Check if we have a logo for this team
          if (this.teamLogos && this.teamLogos.teams && this.teamLogos.teams[canonicalName]) {
            const logoPath = this.teamLogos.teams[canonicalName];
            const basePath = this.teamLogos.logoBasePath || '';
            // If basePath ends with /, use it as-is, otherwise add /
            const fullPath = basePath && !basePath.endsWith('/') ? `${basePath}/${logoPath}` : `${basePath}${logoPath}`;
            console.log(`[CS2 Betting] Found logo for ${teamName} (${canonicalName}): ${fullPath}`);
            return fullPath;
          }
          
          // No logo found - will use acronym
          console.log(`[CS2 Betting] No logo found for ${teamName} (${canonicalName}), will use acronym`);
          return null;
        };
        
        const homeTeamLogo = getTeamLogo.call(this, homeTeamName);
        const awayTeamLogo = getTeamLogo.call(this, awayTeamName);
        const homeTeamAcronym = this.getTeamAcronym(homeTeamName);
        const awayTeamAcronym = this.getTeamAcronym(awayTeamName);
        
        // Get display odds (default to 2.0 if unavailable)
        const team1Odds = getDisplayOdds(event.odds?.team1);
        const team2Odds = getDisplayOdds(event.odds?.team2);
        
        // Store default odds in event for selectOutcome to use
        if (!event.odds) event.odds = {};
        if (event.odds.team1 === null || event.odds.team1 === undefined) event.odds.team1 = 2.0;
        if (event.odds.team2 === null || event.odds.team2 === undefined) event.odds.team2 = 2.0;

        htmlContent += `
          <div class="cs2-event-card ${isFinished ? 'finished' : ''} ${isLive ? 'live' : ''}" data-event-id="${event.id}">
            <div class="event-match-header">
              <div class="match-time-status">
                <span class="match-time">${timeStr}</span>
                ${isLive ? '<span class="match-live-badge">🔴 LIVE</span>' : ''}
              </div>
            </div>
            <div class="event-match-content">
              <div class="event-teams-list">
                <div class="teams-header">Teams</div>
                <div class="event-team-row">
                  <div class="team-logo-container">
                    ${homeTeamLogo ? `<img src="${homeTeamLogo}" alt="${safeHomeTeam}" class="team-logo" 
                         onerror="this.onerror=null; this.style.display='none'; this.nextElementSibling.style.display='flex';">
                    <div class="team-acronym" style="display: none;">${homeTeamAcronym}</div>` : `<div class="team-acronym">${homeTeamAcronym}</div>`}
                  </div>
                  <span class="team-name">${safeHomeTeam}</span>
                </div>
                <div class="event-team-row">
                  <div class="team-logo-container">
                    ${awayTeamLogo ? `<img src="${awayTeamLogo}" alt="${safeAwayTeam}" class="team-logo" 
                         onerror="this.onerror=null; this.style.display='none'; this.nextElementSibling.style.display='flex';">
                    <div class="team-acronym" style="display: none;">${awayTeamAcronym}</div>` : `<div class="team-acronym">${awayTeamAcronym}</div>`}
                  </div>
                  <span class="team-name">${safeAwayTeam}</span>
                </div>
              </div>
              <div class="event-odds-section">
                <div class="odds-header">Winner</div>
                <button class="odds-card ${canBet ? '' : 'disabled'}" 
                        data-event-id="${event.id}" 
                        data-selection="team1"
                        ${!canBet ? 'disabled' : ''}
                        aria-label="Bet on ${safeHomeTeam}"
                        type="button">
                  <div class="odds-team-name">${safeHomeTeam}</div>
                  <div class="odds-value">${team1Odds.toFixed(2)}</div>
                </button>
                <button class="odds-card ${canBet ? '' : 'disabled'}" 
                        data-event-id="${event.id}" 
                        data-selection="team2"
                        ${!canBet ? 'disabled' : ''}
                        aria-label="Bet on ${safeAwayTeam}"
                        type="button">
                  <div class="odds-team-name">${safeAwayTeam}</div>
                  <div class="odds-value">${team2Odds.toFixed(2)}</div>
                </button>
              </div>
            </div>
          </div>
        `;
      });
    });
    
    eventsList.innerHTML = htmlContent;

    // Attach event listeners to odds cards (entire card is clickable)
    eventsList.querySelectorAll('.odds-card:not(.disabled)').forEach(card => {
      card.addEventListener('click', async (e) => {
        e.preventDefault();
        e.stopPropagation();
        const eventId = card.dataset.eventId;
        const selection = card.dataset.selection;
        
        // Fetch odds if not available (will use default 2x if unavailable)
        await this.fetchEventOddsIfNeeded(eventId);
        this.selectOutcome(eventId, selection);
      });
    });
  }

  async fetchEventOddsIfNeeded(eventId, force = false) {
    // NOTE: This function no longer calls the API
    // API calls are restricted to: server start, refresh button, and daily updates
    // This function just returns cached odds from the server
    
    const event = this.events.find(e => e.id === eventId);
    if (!event) {
      console.warn(`[CS2 Frontend] Event ${eventId} not found`);
      return;
    }
    
    if (event.odds?.team1 && event.odds?.team2) {
      // Odds already available in local cache
      console.log(`[CS2 Frontend] Odds already available for event ${eventId}`);
      return true;
    }

    // Try to get cached odds from server (no API call)
    try {
      console.log(`[CS2 Frontend] Checking cached odds for event ${eventId}...`);
      const serverUrl = window.CASINO_SERVER_URL || (window.location.hostname === 'localhost' ? 'http://localhost:3001' : window.location.origin);
      const response = await fetch(`${serverUrl}/api/cs2/events/${eventId}/odds`);
      
      if (response.ok) {
        const data = await response.json();
        if (data.success && data.event && data.event.odds && (data.event.odds.team1 || data.event.odds.team2)) {
          // Update event odds in our local array
          const eventIndex = this.events.findIndex(e => e.id === eventId);
          if (eventIndex !== -1) {
            this.events[eventIndex].odds = data.event.odds;
            this.events[eventIndex].hasOdds = true;
            console.log(`[CS2 Frontend] Updated odds for event ${eventId} from cache:`, data.event.odds);
            // Re-render to show updated odds
            this.renderEvents();
            return true; // Success
          }
        } else {
          console.log(`[CS2 Frontend] No cached odds available for event ${eventId}. Use refresh button to update.`);
        }
      }
    } catch (error) {
      console.error(`[CS2 Frontend] Error checking cached odds for event ${eventId}:`, error);
    }
    return false; // No odds available
  }

  selectOutcome(eventId, selection) {
    const event = this.events.find(e => e.id === eventId);
    if (!event) {
      console.error(`[CS2 Frontend] Event ${eventId} not found`);
      return;
    }

    // Ensure odds exist (use default 2.0 if not available)
    if (!event.odds) {
      event.odds = {};
    }
    if (event.odds[selection] === null || event.odds[selection] === undefined) {
      event.odds[selection] = 2.0; // Default 2x odds
    }

    this.selectedEvent = event;
    this.selectedOutcome = selection;

    // Show bet slip modal
    const betSlipModal = document.getElementById('cs2BetSlipModal');
    betSlipModal.classList.remove('hidden');

    // Update bet slip
    const betSlip = document.getElementById('cs2BetSlip');
    const betControls = document.getElementById('cs2BetControls');
    
    const selectionName = selection === 'team1' ? event.homeTeam : 
                         selection === 'team2' ? event.awayTeam : 'Draw';
    const odds = event.odds?.[selection] || 0;

    betSlip.innerHTML = `
      <div class="betslip-selection">
        <div class="selection-match">
          <span class="match-tournament">🏆 ${event.tournamentName || 'Tournament'}</span>
          <div class="match-teams">
            <span>${event.homeTeam || 'Team 1'}</span>
            <span class="vs-text">vs</span>
            <span>${event.awayTeam || 'Team 2'}</span>
          </div>
        </div>
        <div class="selection-outcome">
          <span class="outcome-label">Your Bet:</span>
          <span class="outcome-value">${selectionName} @ ${odds.toFixed(2)}</span>
        </div>
      </div>
    `;

    betControls.classList.remove('hidden');
    this.updatePotentialPayout();
  }

  updatePotentialPayout() {
    if (!this.selectedEvent || !this.selectedOutcome) return;

    const odds = this.selectedEvent.odds?.[this.selectedOutcome] || 0;
    const payout = this.betAmount * odds;
    const profit = payout - this.betAmount;

    const payoutDiv = document.getElementById('cs2PotentialPayout');
    payoutDiv.innerHTML = `
      <div class="payout-info">
        <div>Bet Amount: <strong>${this.betAmount} credits</strong></div>
        <div>Potential Payout: <strong>${payout.toFixed(2)} credits</strong></div>
        <div>Potential Profit: <strong>+${profit.toFixed(2)} credits</strong></div>
      </div>
    `;
  }

  async placeBet() {
    // Set navigation guard
    if (this.casino && typeof this.casino.setBetPlacementInProgress === 'function') {
      this.casino.setBetPlacementInProgress(true);
    }

    if (window.casinoDebugLogger) {
      window.casinoDebugLogger.logBetPlacement('cs2betting', this.betAmount, 'started', {
        eventId: this.selectedEvent?.id,
        selection: this.selectedOutcome,
        currentBalance: this.currentBalance
      });
    }

    if (!this.selectedEvent || !this.selectedOutcome) {
      // Clear navigation guard on validation failure
      if (this.casino && typeof this.casino.setBetPlacementInProgress === 'function') {
        this.casino.setBetPlacementInProgress(false);
      }
      const msg = 'Please select a match and outcome first';
      if (window.casinoDebugLogger) {
        window.casinoDebugLogger.logBetPlacement('cs2betting', 0, 'failed', { reason: msg });
      }
      alert(msg);
      return;
    }

    if (this.betAmount < 1) {
      // Clear navigation guard on validation failure
      if (this.casino && typeof this.casino.setBetPlacementInProgress === 'function') {
        this.casino.setBetPlacementInProgress(false);
      }
      const msg = 'Bet amount must be at least 1 credit';
      if (window.casinoDebugLogger) {
        window.casinoDebugLogger.logBetPlacement('cs2betting', this.betAmount, 'failed', { reason: msg });
      }
      alert(msg);
      return;
    }

    if (this.betAmount > this.currentBalance) {
      // Clear navigation guard on validation failure
      if (this.casino && typeof this.casino.setBetPlacementInProgress === 'function') {
        this.casino.setBetPlacementInProgress(false);
      }
      const msg = `Insufficient credits. You have ${this.currentBalance} credits.`;
      if (window.casinoDebugLogger) {
        window.casinoDebugLogger.logBetPlacement('cs2betting', this.betAmount, 'failed', { reason: msg });
      }
      alert(msg);
      return;
    }

    try {
      const userId = this.casino.username || sessionStorage.getItem('casinoUsername');
      if (!userId) {
        // Clear navigation guard on validation failure
        if (this.casino && typeof this.casino.setBetPlacementInProgress === 'function') {
          this.casino.setBetPlacementInProgress(false);
        }
        const msg = 'Please login first';
        if (window.casinoDebugLogger) {
          window.casinoDebugLogger.logBetPlacement('cs2betting', this.betAmount, 'failed', { reason: msg });
        }
        alert(msg);
        return;
      }

      if (window.casinoDebugLogger) {
        window.casinoDebugLogger.logBetPlacement('cs2betting', this.betAmount, 'api_request', {
          eventId: this.selectedEvent.id,
          selection: this.selectedOutcome,
          userId
        });
      }

      const serverUrl = window.CASINO_SERVER_URL || window.location.origin;
      const response = await fetch(`${serverUrl}/api/cs2/bets`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          userId: userId,
          eventId: this.selectedEvent.id,
          selection: this.selectedOutcome,
          amount: this.betAmount
        })
      });

      const data = await response.json();

      if (window.casinoDebugLogger) {
        window.casinoDebugLogger.logBetPlacement('cs2betting', this.betAmount, 'api_response', {
          success: data.success,
          newBalance: data.newBalance,
          error: data.error
        });
      }

      if (data.success) {
        // Capture before we clear selection (closeBetSlipModal nulls selectedEvent)
        const placedEventId = this.selectedEvent?.id;
        const placedBetAmount = this.betAmount;

        // Update balance - use setCredits to set absolute value, not add
        const serverBalance = data.newBalance || data.balance;
        if (serverBalance !== undefined && serverBalance !== null) {
          this.currentBalance = serverBalance;
        } else {
          // Fallback: manually deduct if server didn't return balance
          this.currentBalance = Math.max(0, this.currentBalance - this.betAmount);
        }
        
        console.log('[CS2 Betting] Bet placed successfully.');
        console.log('[CS2 Betting] Server returned balance:', serverBalance);
        console.log('[CS2 Betting] Updated currentBalance to:', this.currentBalance);
        console.log('[CS2 Betting] Casino manager exists:', !!this.casino);
        console.log('[CS2 Betting] Casino manager type:', typeof this.casino);
        
        // Update casino balance display - CRITICAL: must update the main casino balance
        // Wrap in try-catch to prevent any errors from causing navigation
        try {
          const oldBalance = this.casino?.credits;
          
          if (this.casino) {
            console.log('[CS2 Betting] Casino credits before update:', this.casino.credits);
            
            if (typeof this.casino.setCredits === 'function') {
              console.log('[CS2 Betting] Using setCredits method with balance:', this.currentBalance);
              this.casino.setCredits(this.currentBalance);
              console.log('[CS2 Betting] Casino credits after setCredits:', this.casino.credits);
              
              if (window.casinoDebugLogger) {
                window.casinoDebugLogger.logBalanceUpdate(oldBalance, this.casino.credits, 'manual', {
                  game: 'cs2betting',
                  method: 'setCredits',
                  expectedBalance: this.currentBalance
                });
              }
              
              // Verify the update worked
              if (Math.abs(this.casino.credits - this.currentBalance) > 0.01) {
                console.warn('[CS2 Betting] Balance mismatch! Expected:', this.currentBalance, 'Got:', this.casino.credits);
                // Force update again
                this.casino.setCredits(this.currentBalance);
              }
            } else if (typeof this.casino.updateCredits === 'function') {
              // Fallback: calculate difference if setCredits doesn't exist
              const oldBalance = this.casino.credits || this.currentBalance + this.betAmount;
              const difference = this.currentBalance - oldBalance;
              console.log('[CS2 Betting] Using updateCredits fallback. Old:', oldBalance, 'New:', this.currentBalance, 'Diff:', difference);
              this.casino.updateCredits(difference);
              console.log('[CS2 Betting] Casino credits after updateCredits:', this.casino.credits);
              
              if (window.casinoDebugLogger) {
                window.casinoDebugLogger.logBalanceUpdate(oldBalance, this.casino.credits, 'manual', {
                  game: 'cs2betting',
                  method: 'updateCredits',
                  difference
                });
              }
            } else {
              console.error('[CS2 Betting] ERROR: No valid credit update method found on casino manager!');
              console.error('[CS2 Betting] Casino manager methods:', Object.getOwnPropertyNames(this.casino));
              if (window.casinoDebugLogger) {
                window.casinoDebugLogger.logError(new Error('No valid credit update method'), {
                  context: 'cs2betting balance update',
                  casinoMethods: Object.getOwnPropertyNames(this.casino)
                });
              }
            }
          } else {
            console.error('[CS2 Betting] ERROR: Casino manager is null or undefined!');
            if (window.casinoDebugLogger) {
              window.casinoDebugLogger.logError(new Error('Casino manager is null'), {
                context: 'cs2betting balance update'
              });
            }
          }
        } catch (balanceError) {
          console.error('[CS2 Betting] Error updating balance (non-fatal):', balanceError);
          if (window.casinoDebugLogger) {
            window.casinoDebugLogger.logError(balanceError, {
              context: 'cs2betting balance update',
              nonFatal: true
            });
          }
          // Don't throw - we still want to show success and reload bets
        }

        // Reload bets (wrap in try-catch to prevent errors from causing navigation)
        try {
          await this.loadBets();
        } catch (err) {
          console.error('[CS2 Betting] Error reloading bets (non-fatal):', err);
        }

        // Close bet slip modal (but stay on the match list page)
        try {
          this.closeBetSlipModal();
        } catch (err) {
          console.error('[CS2 Betting] Error closing bet slip (non-fatal):', err);
        }
        
        // Clear selection so user can place another bet
        this.selectedEvent = null;
        this.selectedOutcome = null;

        // Show success message (non-blocking, doesn't cause navigation)
        console.log(`[CS2 Betting] Bet placed successfully! New balance: ${this.currentBalance} credits`);
        
        if (window.casinoDebugLogger) {
          window.casinoDebugLogger.logBetPlacement('cs2betting', placedBetAmount, 'completed', {
            newBalance: this.currentBalance,
            eventId: placedEventId
          });
        }
        
        // Show a brief success indicator without blocking (wrap in try-catch)
        try {
          this.showTemporaryMessage(`Bet placed! New balance: ${this.currentBalance} credits`, 'success');
        } catch (err) {
          console.error('[CS2 Betting] Error showing notification (non-fatal):', err);
          if (window.casinoDebugLogger) {
            window.casinoDebugLogger.logError(err, {
              context: 'cs2betting show notification',
              nonFatal: true
            });
          }
          // Fallback to console log if notification fails
          console.log(`[CS2 Betting] SUCCESS: Bet placed! New balance: ${this.currentBalance} credits`);
        }

        // Clear navigation guard after bet is complete
        // Delay clearing to prevent race condition with Live Server file detection
        setTimeout(() => {
          if (this.casino && typeof this.casino.setBetPlacementInProgress === 'function') {
            this.casino.setBetPlacementInProgress(false);
          }
        }, 1000); // 1 second delay to allow Live Server to process file change
      } else {
        // Clear navigation guard on failure
        if (this.casino && typeof this.casino.setBetPlacementInProgress === 'function') {
          this.casino.setBetPlacementInProgress(false);
        }

        const errorMsg = data.error || 'Unknown error';
        console.error(`[CS2 Betting] Failed to place bet: ${errorMsg}`);
        if (window.casinoDebugLogger) {
          window.casinoDebugLogger.logBetPlacement('cs2betting', this.betAmount, 'failed', {
            error: errorMsg,
            eventId: this.selectedEvent?.id
          });
        }
        alert(`Failed to place bet: ${errorMsg}`);
      }
    } catch (error) {
      // Clear navigation guard on error
      if (this.casino && typeof this.casino.setBetPlacementInProgress === 'function') {
        this.casino.setBetPlacementInProgress(false);
      }
      console.error('[CS2 Betting] Error placing bet:', error);
      console.error('[CS2 Betting] Error stack:', error.stack);
      
      if (window.casinoDebugLogger) {
        const eventId = this.selectedEvent?.id;
        const betAmount = this.betAmount;
        window.casinoDebugLogger.logError(error, {
          context: 'cs2betting placeBet',
          eventId,
          betAmount
        });
      }
      
      // Use non-blocking notification instead of alert to prevent navigation
      try {
        this.showTemporaryMessage(`Error placing bet: ${error.message || 'Unknown error'}`, 'error');
      } catch (notifError) {
        console.error('[CS2 Betting] Error showing error notification:', notifError);
        if (window.casinoDebugLogger) {
          window.casinoDebugLogger.logError(notifError, {
            context: 'cs2betting show error notification',
            originalError: error.message
          });
        }
        // Last resort: console only, no alert
        console.error('[CS2 Betting] Bet placement failed:', error.message || 'Unknown error');
      }
    }
  }

  showBets(tabType) {
    const betsContainer = document.getElementById('cs2MyBets');
    
    const filteredBets = tabType === 'open' 
      ? this.bets.filter(b => b.status === 'pending')
      : this.bets.filter(b => b.status !== 'pending');

    if (filteredBets.length === 0) {
      betsContainer.innerHTML = `<p class="no-bets">No ${tabType} bets yet</p>`;
      return;
    }

    betsContainer.innerHTML = filteredBets.map(bet => {
      const event = this.events.find(e => e.id === bet.eventId);
      const eventName = event 
        ? `${event.homeTeam} vs ${event.awayTeam}` 
        : `Event ${bet.eventId}`;
      
      const selectionName = bet.selection === 'team1' ? event?.homeTeam :
                           bet.selection === 'team2' ? event?.awayTeam : 'Draw';
      
      const statusClass = bet.status === 'won' ? 'won' :
                         bet.status === 'lost' ? 'lost' :
                         bet.status === 'void' ? 'void' : 'pending';
      
      const statusText = bet.status === 'won' ? '✓ Won' :
                        bet.status === 'lost' ? '✗ Lost' :
                        bet.status === 'void' ? '⊘ Void' : '⏳ Pending';

      const potentialPayout = bet.potentialPayout || (bet.amount * bet.odds);

      return `
        <div class="cs2-bet-card ${statusClass}">
          <div class="bet-header">
            <span class="bet-id">#${bet.id.substring(bet.id.length - 8)}</span>
            <span class="bet-status ${statusClass}">${statusText}</span>
          </div>
          <div class="bet-match">${eventName}</div>
          <div class="bet-selection">Selection: <strong>${selectionName}</strong></div>
          <div class="bet-details">
            <div>Stake: <strong>${bet.amount}</strong> credits</div>
            <div>Odds: <strong>${bet.odds.toFixed(2)}</strong></div>
            <div>Potential Payout: <strong>${potentialPayout.toFixed(2)}</strong> credits</div>
          </div>
          ${bet.settledAt ? `<div class="bet-settled">Settled: ${new Date(bet.settledAt).toLocaleString()}</div>` : ''}
        </div>
      `;
    }).join('');
  }

  cleanup() {
    if (this.refreshInterval) {
      clearInterval(this.refreshInterval);
      this.refreshInterval = null;
    }
  }

  destroy() {
    this.cleanup();
  }

  // Helper method to find team in rankings by matching team name
  findTeamInRankings(teamName) {
    if (!teamName || !window.cs2TeamRankings) return null;
    
    const normalized = this.normalizeTeamName(teamName);
    
    // Try to find team in rankings
    for (const team of (window.cs2TeamRankings.teams || [])) {
      // Check main name
      if (this.normalizeTeamName(team.name) === normalized) {
        return team;
      }
      
      // Check aliases
      if (team.aliases && Array.isArray(team.aliases)) {
        for (const alias of team.aliases) {
          if (this.normalizeTeamName(alias) === normalized) {
            return team;
          }
        }
      }
    }
    
    return null;
  }

  // Normalize team name for matching (same logic as backend)
  normalizeTeamName(teamName) {
    if (!teamName) return '';
    return teamName
      .toLowerCase()
      .trim()
      .replace(/^team\s+/i, '') // Remove "Team" prefix
      .replace(/[^\w\s]/g, '') // Remove special characters
      .replace(/\s+/g, ' '); // Normalize whitespace
  }

  // Helper method to get 2-letter acronym from team name
  getTeamAcronym(teamName) {
    if (!teamName) return '??';
    
    // Remove common prefixes
    const cleaned = teamName
      .replace(/^team\s+/i, '')
      .replace(/^the\s+/i, '')
      .trim();
    
    // Split by spaces and get first letters
    const words = cleaned.split(/\s+/);
    
    if (words.length >= 2) {
      // Two or more words: use first letter of first two words
      return (words[0].charAt(0) + words[1].charAt(0)).toUpperCase();
    } else if (words.length === 1 && words[0].length >= 2) {
      // Single word with 2+ characters: use first 2 letters
      return words[0].substring(0, 2).toUpperCase();
    } else if (words.length === 1) {
      // Single character: duplicate it
      return (words[0].charAt(0) + words[0].charAt(0)).toUpperCase();
    }
    
    return '??';
  }

  // Helper method to get fallback logo (2-letter acronym SVG)
  getFallbackLogo(teamName) {
    const acronym = this.getTeamAcronym(teamName);
    // Generate an inline SVG with the acronym
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64">
      <rect width="64" height="64" fill="#1e293b"/>
      <text x="50%" y="50%" text-anchor="middle" dominant-baseline="central" 
            font-size="20" font-weight="700" fill="#e2e8f0" font-family="system-ui, -apple-system, sans-serif">${acronym}</text>
    </svg>`;
    return `data:image/svg+xml,${encodeURIComponent(svg)}`;
  }

  // Show temporary message without blocking (non-intrusive notification)
  showTemporaryMessage(message, type = 'info') {
    // Remove any existing message
    const existingMsg = document.getElementById('cs2TempMessage');
    if (existingMsg) {
      existingMsg.remove();
    }

    // Create message element
    const msgEl = document.createElement('div');
    msgEl.id = 'cs2TempMessage';
    msgEl.className = `cs2-temp-message cs2-temp-message-${type}`;
    msgEl.textContent = message;
    
    // Add to game container
    const gameView = document.getElementById('cs2BettingGame');
    if (gameView) {
      gameView.appendChild(msgEl);
      
      // Auto-remove after 3 seconds
      setTimeout(() => {
        msgEl.style.opacity = '0';
        msgEl.style.transition = 'opacity 0.3s';
        setTimeout(() => msgEl.remove(), 300);
      }, 3000);
    }
  }
}

// Export for casino.js
window.CS2BettingGame = CS2BettingGame;
console.log('[CS2 Betting] CS2BettingGame class exported to window.CS2BettingGame');
