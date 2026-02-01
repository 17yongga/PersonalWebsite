// CS2 Betting Game Module - Follows existing casino game pattern

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
    this.init();
  }

  init() {
    try {
      console.log('[CS2 Betting] Initializing game...');
      const gameView = document.getElementById('cs2BettingGame');
      if (!gameView) {
        console.error('[CS2 Betting] Game view element not found! Looking for #cs2BettingGame');
        // Try to find it after a short delay
        setTimeout(() => this.init(), 100);
        return;
      }
      
      console.log('[CS2 Betting] Game view element found, setting up UI...');
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
                    <button class="quick-bet-btn" data-amount="50">50</button>
                    <button class="quick-bet-btn" data-amount="100">100</button>
                    <button class="quick-bet-btn" data-amount="250">250</button>
                    <button class="quick-bet-btn" data-amount="500">500</button>
                  </div>
                </div>
                <div id="cs2PotentialPayout" class="potential-payout"></div>
                <div class="betslip-actions">
                  <button id="placeBetBtn" class="btn btn-primary btn-large">Place Bet</button>
                  <button id="cancelBetBtn" class="btn btn-secondary">Cancel</button>
                </div>
              </div>
            </div>
          </div>
        </div>
      `;

      console.log('[CS2 Betting] UI setup complete, attaching event listeners...');
      this.attachEventListeners();
      this.connectToServer();
      this.loadInitialData();
      console.log('[CS2 Betting] Initialization complete!');
    } catch (error) {
      console.error('[CS2 Betting] Error during initialization:', error);
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
      btn.addEventListener('click', () => {
        const amount = parseInt(btn.dataset.amount);
        document.getElementById('cs2BetAmount').value = amount;
        this.betAmount = amount;
        this.updatePotentialPayout();
      });
    });

    // Bet amount input
    document.getElementById('cs2BetAmount')?.addEventListener('input', (e) => {
      this.betAmount = parseInt(e.target.value) || 0;
      this.updatePotentialPayout();
    });

    // Place bet button
    document.getElementById('placeBetBtn')?.addEventListener('click', () => {
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
    await Promise.all([
      this.loadBalance(),
      this.loadEvents(),
      this.loadBets()
    ]);
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
        // Update casino balance display if needed
        if (this.casino.updateCredits) {
          this.casino.updateCredits(this.currentBalance);
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
      if (!serverUrl) {
        // Check if we're on a local IP or localhost
        const hostname = window.location.hostname;
        
        if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname.startsWith('192.168.') || hostname.startsWith('10.') || hostname.startsWith('172.')) {
          // Local development - always use port 3001 for casino server
          serverUrl = `${window.location.protocol}//${hostname}:3001`;
        } else {
          // Production - use current origin
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
    const eventsList = document.getElementById('cs2EventsList');
    
    if (this.events.length === 0) {
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

        // Get team logos
        const getTeamLogo = (teamName) => {
          const encodedName = encodeURIComponent(teamName);
          return `https://ui-avatars.com/api/?name=${encodedName}&size=64&background=random&color=fff&bold=true`;
        };

        const homeTeamLogo = getTeamLogo(event.homeTeam || 'Team 1');
        const awayTeamLogo = getTeamLogo(event.awayTeam || 'Team 2');
        
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
                    <img src="${homeTeamLogo}" alt="${safeHomeTeam}" class="team-logo" 
                         onerror="this.onerror=null; this.src='data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' width=\'64\' height=\'64\'%3E%3Crect fill=\'%23333\' width=\'64\' height=\'64\'/%3E%3Ctext fill=\'%23fff\' x=\'50%25\' y=\'50%25\' text-anchor=\'middle\' dy=\'.3em\' font-size=\'24\'%3E${safeHomeTeam.charAt(0).toUpperCase()}%3C/text%3E%3C/svg%3E'">
                  </div>
                  <span class="team-name">${safeHomeTeam}</span>
                </div>
                <div class="event-team-row">
                  <div class="team-logo-container">
                    <img src="${awayTeamLogo}" alt="${safeAwayTeam}" class="team-logo" 
                         onerror="this.onerror=null; this.src='data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' width=\'64\' height=\'64\'%3E%3Crect fill=\'%23333\' width=\'64\' height=\'64\'/%3E%3Ctext fill=\'%23fff\' x=\'50%25\' y=\'50%25\' text-anchor=\'middle\' dy=\'.3em\' font-size=\'24\'%3E${safeAwayTeam.charAt(0).toUpperCase()}%3C/text%3E%3C/svg%3E'">
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
    if (!this.selectedEvent || !this.selectedOutcome) {
      alert('Please select a match and outcome first');
      return;
    }

    if (this.betAmount < 1) {
      alert('Bet amount must be at least 1 credit');
      return;
    }

    if (this.betAmount > this.currentBalance) {
      alert(`Insufficient credits. You have ${this.currentBalance} credits.`);
      return;
    }

    try {
      const userId = this.casino.username || sessionStorage.getItem('casinoUsername');
      if (!userId) {
        alert('Please login first');
        return;
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

      if (data.success) {
        // Update balance
        this.currentBalance = data.newBalance;
        if (this.casino.updateCredits) {
          this.casino.updateCredits(this.currentBalance);
        }

        // Reload bets
        await this.loadBets();

        // Close bet slip modal
        this.closeBetSlipModal();

        alert(`Bet placed successfully! New balance: ${this.currentBalance} credits`);
      } else {
        alert(`Failed to place bet: ${data.error || 'Unknown error'}`);
      }
    } catch (error) {
      console.error('Error placing bet:', error);
      alert('Error placing bet. Please try again.');
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
}

// Export for casino.js
window.CS2BettingGame = CS2BettingGame;
console.log('[CS2 Betting] CS2BettingGame class exported to window.CS2BettingGame');
