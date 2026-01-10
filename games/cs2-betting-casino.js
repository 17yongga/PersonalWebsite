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
    // Refresh events button
    document.getElementById('refreshEventsBtn')?.addEventListener('click', () => {
      this.loadEvents();
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
        
        // Fetch odds for events that don't have them (limit to first 10 to avoid rate limits)
        const eventsNeedingOdds = this.events
          .filter(e => (!e.odds || !e.odds.team1 || !e.odds.team2) && 
                       (e.status === 'scheduled' || e.status === 'live') &&
                       e.hasOdds !== false)
          .slice(0, 10); // Limit to first 10 to respect rate limits
        
        if (eventsNeedingOdds.length > 0) {
          console.log(`[CS2 Frontend] Fetching odds for ${eventsNeedingOdds.length} events...`);
          // Fetch odds in parallel with delays to respect rate limits
          for (let i = 0; i < eventsNeedingOdds.length; i++) {
            const event = eventsNeedingOdds[i];
            setTimeout(async () => {
              await this.fetchEventOddsIfNeeded(event.id, true); // Force fetch
            }, i * 600); // 600ms delay between requests (respecting 500ms cooldown + buffer)
          }
        }
        
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

    // Sort events chronologically (next upcoming match first - earliest scheduled time)
    const sortedEvents = [...this.events].sort((a, b) => {
      const timeA = new Date(a.commenceTime || a.startTime || 0).getTime();
      const timeB = new Date(b.commenceTime || b.startTime || 0).getTime();
      return timeA - timeB; // Ascending: earliest first (next match to happen at the top)
    });

    eventsList.innerHTML = sortedEvents.map(event => {
      const startTime = new Date(event.commenceTime || event.startTime);
      const isLive = event.status === 'live';
      const isFinished = event.status === 'finished';
      const canBet = event.status === 'scheduled' || event.status === 'live';
      const tournamentName = event.tournamentName || 'Tournament';
      
      // Format time - more readable format
      const timeStr = startTime.toLocaleString('en-US', {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        hour12: true
      });
      
      // Format date separately for better mobile display
      const dateStr = startTime.toLocaleString('en-US', {
        month: 'short',
        day: 'numeric'
      });
      const timeOnly = startTime.toLocaleString('en-US', {
        hour: '2-digit',
        minute: '2-digit',
        hour12: true
      });

      // Get team logos (using placeholder for now - can be replaced with actual logos)
      const getTeamLogo = (teamName) => {
        // Placeholder logo URL - in production, you'd fetch from an API or use team logos
        const encodedName = encodeURIComponent(teamName);
        return `https://ui-avatars.com/api/?name=${encodedName}&size=64&background=random&color=fff&bold=true`;
      };

      const homeTeamLogo = getTeamLogo(event.homeTeam || 'Team 1');
      const awayTeamLogo = getTeamLogo(event.awayTeam || 'Team 2');
      
      // Escape HTML in team names and tournament name for safety
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
      
      const safeTournamentName = escapeHtml(tournamentName);
      // Get team names from various possible fields (try all possible field names)
      const homeTeamName = event.homeTeam || event.participant1Name || event.team1 || event.teamHome || 'Team 1';
      const awayTeamName = event.awayTeam || event.participant2Name || event.team2 || event.teamAway || 'Team 2';
      const safeHomeTeam = escapeHtml(homeTeamName);
      const safeAwayTeam = escapeHtml(awayTeamName);
      
      // Debug: Log team names to console for first event
      if (sortedEvents.indexOf(event) === 0) {
        console.log('[CS2 Frontend] First event full data:', event);
        console.log('[CS2 Frontend] First event team data:', {
          homeTeam: event.homeTeam,
          awayTeam: event.awayTeam,
          participant1Name: event.participant1Name,
          participant2Name: event.participant2Name,
          team1: event.team1,
          team2: event.team2,
          finalHomeTeam: safeHomeTeam,
          finalAwayTeam: safeAwayTeam,
          hasOdds: !!event.odds,
          odds: event.odds
        });
      }

      return `
        <div class="cs2-event-card ${isFinished ? 'finished' : ''} ${isLive ? 'live' : ''}" data-event-id="${event.id}">
          <div class="event-header-section">
            <div class="event-tournament">
              <span class="tournament-badge">🏆 ${safeTournamentName}</span>
            </div>
            <div class="event-status-section">
              <span class="event-date-mobile">${dateStr}</span>
              <span class="event-status-badge ${event.status}">
                ${isLive ? '🔴 LIVE' : isFinished ? '✓ Finished' : `<span class="event-time-desktop">📅 ${timeStr}</span><span class="event-time-mobile">📅 ${timeOnly}</span>`}
              </span>
            </div>
          </div>
          <div class="event-teams-container" style="display: grid; visibility: visible; opacity: 1; min-height: 180px;">
            <div class="event-team" style="display: flex; visibility: visible; opacity: 1;">
              <div class="team-logo-container" style="display: flex; visibility: visible; opacity: 1;">
                <img src="${homeTeamLogo}" alt="${safeHomeTeam}" class="team-logo" 
                     style="display: block; visibility: visible; opacity: 1;"
                     onerror="this.onerror=null; this.style.display='block'; this.src='data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' width=\'64\' height=\'64\'%3E%3Crect fill=\'%23333\' width=\'64\' height=\'64\'/%3E%3Ctext fill=\'%23fff\' x=\'50%25\' y=\'50%25\' text-anchor=\'middle\' dy=\'.3em\' font-size=\'24\'%3E${safeHomeTeam.charAt(0).toUpperCase()}%3C/text%3E%3C/svg%3E'">
              </div>
              <span class="team-name" title="${safeHomeTeam}" style="display: block; visibility: visible; opacity: 1;">${safeHomeTeam}</span>
              <button class="odds-btn ${canBet && event.odds?.team1 ? '' : 'disabled'}" 
                      data-event-id="${event.id}" 
                      data-selection="team1"
                      ${!canBet || !event.odds?.team1 ? 'disabled' : ''}
                      style="display: inline-flex; visibility: visible; opacity: 1;"
                      aria-label="${event.odds?.team1 ? `Bet on ${safeHomeTeam}` : 'Odds not available'}">
                <span class="odds-value">${event.odds?.team1 ? event.odds.team1.toFixed(2) : 'N/A'}</span>
              </button>
            </div>
            <div class="vs-divider" style="display: inline-flex; visibility: visible; opacity: 1;">
              <span>VS</span>
            </div>
            <div class="event-team" style="display: flex; visibility: visible; opacity: 1;">
              <div class="team-logo-container" style="display: flex; visibility: visible; opacity: 1;">
                <img src="${awayTeamLogo}" alt="${safeAwayTeam}" class="team-logo" 
                     style="display: block; visibility: visible; opacity: 1;"
                     onerror="this.onerror=null; this.style.display='block'; this.src='data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' width=\'64\' height=\'64\'%3E%3Crect fill=\'%23333\' width=\'64\' height=\'64\'/%3E%3Ctext fill=\'%23fff\' x=\'50%25\' y=\'50%25\' text-anchor=\'middle\' dy=\'.3em\' font-size=\'24\'%3E${safeAwayTeam.charAt(0).toUpperCase()}%3C/text%3E%3C/svg%3E'">
              </div>
              <span class="team-name" title="${safeAwayTeam}" style="display: block; visibility: visible; opacity: 1;">${safeAwayTeam}</span>
              <button class="odds-btn ${canBet && event.odds?.team2 ? '' : 'disabled'}" 
                      data-event-id="${event.id}" 
                      data-selection="team2"
                      ${!canBet || !event.odds?.team2 ? 'disabled' : ''}
                      style="display: inline-flex; visibility: visible; opacity: 1;"
                      aria-label="${event.odds?.team2 ? `Bet on ${safeAwayTeam}` : 'Odds not available'}">
                <span class="odds-value">${event.odds?.team2 ? event.odds.team2.toFixed(2) : 'N/A'}</span>
              </button>
            </div>
          </div>
        </div>
      `;
    }).join('');

    // Debug: Log rendered HTML structure
    console.log('[CS2 Frontend] Rendered events HTML length:', eventsList.innerHTML.length);
    console.log('[CS2 Frontend] Event cards found:', eventsList.querySelectorAll('.cs2-event-card').length);
    console.log('[CS2 Frontend] Team containers found:', eventsList.querySelectorAll('.event-teams-container').length);
    console.log('[CS2 Frontend] Team elements found:', eventsList.querySelectorAll('.event-team').length);
    console.log('[CS2 Frontend] Team names found:', eventsList.querySelectorAll('.team-name').length);
    console.log('[CS2 Frontend] Odds buttons found:', eventsList.querySelectorAll('.odds-btn').length);
    
    // Attach event listeners to odds buttons
    eventsList.querySelectorAll('.odds-btn:not(.disabled)').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.preventDefault();
        e.stopPropagation();
        const eventId = btn.dataset.eventId;
        const selection = btn.dataset.selection;
        
        // Fetch odds if not available
        await this.fetchEventOddsIfNeeded(eventId);
        this.selectOutcome(eventId, selection);
      });
    });
    
    // Debug: Check if teams are actually in the DOM
    const firstCard = eventsList.querySelector('.cs2-event-card');
    if (firstCard) {
      const teamsContainer = firstCard.querySelector('.event-teams-container');
      const teamElements = firstCard.querySelectorAll('.event-team');
      console.log('[CS2 Frontend] First card check:', {
        hasCard: !!firstCard,
        hasTeamsContainer: !!teamsContainer,
        teamsContainerDisplay: teamsContainer ? window.getComputedStyle(teamsContainer).display : 'N/A',
        teamsContainerVisibility: teamsContainer ? window.getComputedStyle(teamsContainer).visibility : 'N/A',
        teamsContainerHeight: teamsContainer ? window.getComputedStyle(teamsContainer).height : 'N/A',
        teamElementsCount: teamElements.length,
        teamNames: Array.from(firstCard.querySelectorAll('.team-name')).map(el => el.textContent)
      });
    }
  }

  async fetchEventOddsIfNeeded(eventId, force = false) {
    const event = this.events.find(e => e.id === eventId);
    if (!event) {
      console.warn(`[CS2 Frontend] Event ${eventId} not found`);
      return;
    }
    
    if (!force && event.odds?.team1 && event.odds?.team2) {
      // Odds already available
      console.log(`[CS2 Frontend] Odds already available for event ${eventId}`);
      return;
    }

    try {
      console.log(`[CS2 Frontend] Fetching odds for event ${eventId}...`);
      const serverUrl = window.CASINO_SERVER_URL || (window.location.hostname === 'localhost' ? 'http://localhost:3001' : window.location.origin);
      const response = await fetch(`${serverUrl}/api/cs2/events/${eventId}/odds`);
      
      if (response.ok) {
        const data = await response.json();
        if (data.success && data.event && data.event.odds) {
          // Update event odds in our local array
          const eventIndex = this.events.findIndex(e => e.id === eventId);
          if (eventIndex !== -1) {
            this.events[eventIndex].odds = data.event.odds;
            this.events[eventIndex].hasOdds = true;
            console.log(`[CS2 Frontend] Updated odds for event ${eventId}:`, data.event.odds);
            // Re-render to show updated odds
            this.renderEvents();
            return true; // Success
          }
        } else {
          console.warn(`[CS2 Frontend] No odds data in response for event ${eventId}:`, data);
        }
      } else {
        console.error(`[CS2 Frontend] Failed to fetch odds for event ${eventId}: HTTP ${response.status}`);
        const errorData = await response.json().catch(() => ({}));
        console.error(`[CS2 Frontend] Error response:`, errorData);
      }
    } catch (error) {
      console.error(`[CS2 Frontend] Error fetching odds for event ${eventId}:`, error);
    }
    return false; // Failed
  }

  selectOutcome(eventId, selection) {
    const event = this.events.find(e => e.id === eventId);
    if (!event) {
      console.error(`[CS2 Frontend] Event ${eventId} not found`);
      return;
    }

    // Check if odds are available
    if (!event.odds || !event.odds[selection]) {
      alert('Odds are not available for this selection. Please try another match or refresh the page.');
      return;
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
