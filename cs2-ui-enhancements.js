// CS2 Betting UI/UX Enhancements - Enhanced Functionality
// Created: January 30, 2026 - Overnight Proactive Work

// Enhanced loading states and animations
class CS2UIEnhancements {
  constructor() {
    this.isLoading = false;
    this.loadingStates = new Map();
    this.init();
  }

  init() {
    this.setupEnhancedLoadingStates();
    this.setupBetFlowOptimizations();
    this.setupMobileOptimizations();
    this.setupAccessibilityEnhancements();
  }

  // ENHANCEMENT 1: Advanced Loading States with Skeleton Animation
  setupEnhancedLoadingStates() {
    const originalLoadEvents = CS2BettingGame.prototype.loadEvents;
    CS2BettingGame.prototype.loadEvents = async function() {
      const eventsList = document.getElementById('cs2EventsList');
      
      // Show skeleton loading
      this.showSkeletonLoader(eventsList);
      
      try {
        await originalLoadEvents.call(this);
        this.hideSkeletonLoader(eventsList);
      } catch (error) {
        this.showErrorState(eventsList, error);
      }
    };

    // Create skeleton loader
    this.createSkeletonLoader = function(container) {
      container.innerHTML = `
        <div class="loading-message" style="text-align: center; margin-bottom: 1rem; color: var(--color-primary);">
          <i class="fas fa-spinner fa-spin"></i> Loading exciting matches...
        </div>
        ${Array(5).fill().map(() => `
          <div class="loading-skeleton match-skeleton"></div>
        `).join('')}
      `;
    };
  }

  showSkeletonLoader(container) {
    this.createSkeletonLoader(container);
    this.isLoading = true;
  }

  hideSkeletonLoader(container) {
    this.isLoading = false;
    // Add fade-in animation for real content
    const matches = container.querySelectorAll('.cs2-event-card');
    matches.forEach((match, index) => {
      match.style.opacity = '0';
      match.style.transform = 'translateY(20px)';
      setTimeout(() => {
        match.style.transition = 'all 0.3s ease';
        match.style.opacity = '1';
        match.style.transform = 'translateY(0)';
      }, index * 100);
    });
  }

  showErrorState(container, error) {
    container.innerHTML = `
      <div class="error-feedback">
        <div style="text-align: center; margin-bottom: 1rem;">
          <i class="fas fa-exclamation-triangle" style="font-size: 2rem; margin-bottom: 0.5rem;"></i>
          <h3 style="margin: 0 0 0.5rem 0;">Oops! Something went wrong</h3>
          <p style="margin: 0; opacity: 0.8;">${error.message || 'Failed to load matches'}</p>
        </div>
        <button onclick="window.cs2Game.loadEvents()" class="btn btn-primary" style="width: 100%;">
          <i class="fas fa-redo"></i> Try Again
        </button>
      </div>
    `;
  }

  // ENHANCEMENT 2: Optimized Betting Flow with Better UX
  setupBetFlowOptimizations() {
    // Enhanced bet slip with real-time calculations
    const originalShowBetSlip = CS2BettingGame.prototype.showBetSlip;
    CS2BettingGame.prototype.showBetSlip = function(eventData, outcome) {
      originalShowBetSlip.call(this, eventData, outcome);
      
      // Add real-time bet calculation
      const betAmountInput = document.getElementById('cs2BetAmount');
      const potentialWinDisplay = document.getElementById('potentialWinAmount');
      
      if (betAmountInput) {
        betAmountInput.addEventListener('input', () => {
          const betAmount = parseFloat(betAmountInput.value) || 0;
          const odds = outcome === 'team1' ? eventData.odds?.team1 : eventData.odds?.team2;
          const potentialWin = Math.round(betAmount * odds);
          
          if (potentialWinDisplay) {
            potentialWinDisplay.textContent = potentialWin.toLocaleString();
            // Add visual feedback for bet amount
            this.updateBetAmountFeedback(betAmount, potentialWin);
          }
        });
        
        // Trigger initial calculation
        betAmountInput.dispatchEvent(new Event('input'));
      }
    };
  }

  updateBetAmountFeedback(betAmount, potentialWin) {
    const feedback = document.getElementById('betAmountFeedback');
    if (!feedback) return;

    const userBalance = this.currentBalance || 10000;
    
    if (betAmount > userBalance) {
      feedback.innerHTML = `
        <div class="error-feedback" style="margin-top: 0.5rem; padding: 0.5rem;">
          <i class="fas fa-exclamation-triangle"></i> Insufficient balance
        </div>
      `;
    } else if (betAmount > 0) {
      const profit = potentialWin - betAmount;
      feedback.innerHTML = `
        <div class="success-feedback" style="margin-top: 0.5rem; padding: 0.5rem;">
          <i class="fas fa-check-circle"></i> 
          Potential profit: <strong>${profit.toLocaleString()}</strong> credits
        </div>
      `;
    } else {
      feedback.innerHTML = '';
    }
  }

  // ENHANCEMENT 3: Mobile-Optimized Touch Interactions
  setupMobileOptimizations() {
    // Better touch targets for mobile
    document.addEventListener('DOMContentLoaded', () => {
      const isMobile = window.innerWidth <= 768;
      
      if (isMobile) {
        // Increase touch targets
        const style = document.createElement('style');
        style.textContent = `
          .cs2-event-card { 
            padding: 1.5rem;
            margin-bottom: 1.25rem;
          }
          .odds-button { 
            padding: 1rem 1.25rem;
            min-height: 60px;
          }
          .quick-bet-btn {
            padding: 0.75rem 1.25rem;
            min-height: 50px;
          }
        `;
        document.head.appendChild(style);

        // Add haptic feedback for supported devices
        this.addHapticFeedback();
      }
    });
  }

  addHapticFeedback() {
    const buttons = ['.odds-button', '.quick-bet-btn', '.btn'];
    
    buttons.forEach(selector => {
      document.addEventListener('click', (e) => {
        if (e.target.matches(selector)) {
          // Haptic feedback for supported devices
          if (navigator.vibrate) {
            navigator.vibrate(10);
          }
        }
      });
    });
  }

  // ENHANCEMENT 4: Accessibility Improvements
  setupAccessibilityEnhancements() {
    // Add ARIA labels and keyboard navigation
    document.addEventListener('DOMContentLoaded', () => {
      // Add proper ARIA labels
      const eventCards = document.querySelectorAll('.cs2-event-card');
      eventCards.forEach(card => {
        const teams = card.querySelector('.match-teams');
        const odds = card.querySelector('.match-odds');
        
        if (teams && odds) {
          const teamNames = teams.textContent.trim();
          card.setAttribute('aria-label', `Match: ${teamNames}`);
          card.setAttribute('role', 'button');
          card.setAttribute('tabindex', '0');
          
          // Keyboard navigation
          card.addEventListener('keypress', (e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              card.click();
            }
          });
        }
      });

      // Add live region for announcements
      const liveRegion = document.createElement('div');
      liveRegion.setAttribute('aria-live', 'polite');
      liveRegion.setAttribute('aria-atomic', 'true');
      liveRegion.style.position = 'absolute';
      liveRegion.style.left = '-10000px';
      liveRegion.id = 'cs2-announcements';
      document.body.appendChild(liveRegion);
    });
  }

  // ENHANCEMENT 5: Animated Notifications
  showNotification(message, type = 'success') {
    const notification = document.createElement('div');
    notification.className = `notification notification-${type}`;
    notification.style.cssText = `
      position: fixed;
      top: 20px;
      right: 20px;
      z-index: 10000;
      padding: 1rem 1.5rem;
      border-radius: 12px;
      color: white;
      font-weight: 600;
      transform: translateX(100%);
      transition: transform 0.3s ease;
      max-width: 300px;
      box-shadow: 0 8px 32px rgba(0, 0, 0, 0.2);
    `;

    if (type === 'success') {
      notification.style.background = 'linear-gradient(135deg, #22c55e, #16a34a)';
    } else if (type === 'error') {
      notification.style.background = 'linear-gradient(135deg, #ef4444, #dc2626)';
    } else {
      notification.style.background = 'linear-gradient(135deg, #3b82f6, #2563eb)';
    }

    notification.innerHTML = `
      <div style="display: flex; align-items: center; gap: 0.5rem;">
        <i class="fas fa-${type === 'success' ? 'check' : type === 'error' ? 'times' : 'info'}-circle"></i>
        <span>${message}</span>
      </div>
    `;

    document.body.appendChild(notification);

    // Animate in
    setTimeout(() => {
      notification.style.transform = 'translateX(0)';
    }, 100);

    // Auto remove
    setTimeout(() => {
      notification.style.transform = 'translateX(100%)';
      setTimeout(() => {
        if (notification.parentNode) {
          notification.parentNode.removeChild(notification);
        }
      }, 300);
    }, 3000);
  }

  // ENHANCEMENT 6: Enhanced Match Card Animations
  addMatchCardAnimations() {
    const observer = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          entry.target.style.animation = 'slideInUp 0.5s ease forwards';
        }
      });
    }, { threshold: 0.1 });

    document.querySelectorAll('.cs2-event-card').forEach(card => {
      observer.observe(card);
    });

    // Add CSS animation
    const style = document.createElement('style');
    style.textContent = `
      @keyframes slideInUp {
        from {
          opacity: 0;
          transform: translateY(30px);
        }
        to {
          opacity: 1;
          transform: translateY(0);
        }
      }
    `;
    document.head.appendChild(style);
  }

  // ENHANCEMENT 7: Real-time Balance Updates
  setupBalanceUpdates() {
    const originalPlaceBet = CS2BettingGame.prototype.placeBet;
    CS2BettingGame.prototype.placeBet = async function(eventData, outcome, amount) {
      try {
        const result = await originalPlaceBet.call(this, eventData, outcome, amount);
        
        if (result.success) {
          // Show success notification
          window.cs2Enhancements.showNotification(
            `Bet placed successfully! ${amount} credits on ${eventData.team1} vs ${eventData.team2}`,
            'success'
          );
          
          // Update balance with animation
          this.animateBalanceUpdate(result.newBalance);
        }
        
        return result;
      } catch (error) {
        window.cs2Enhancements.showNotification(
          error.message || 'Failed to place bet',
          'error'
        );
        throw error;
      }
    };
  }

  animateBalanceUpdate(newBalance) {
    const balanceElement = document.querySelector('.balance-amount');
    if (balanceElement) {
      balanceElement.style.transform = 'scale(1.1)';
      balanceElement.style.color = '#22c55e';
      
      setTimeout(() => {
        balanceElement.textContent = newBalance.toLocaleString();
        balanceElement.style.transform = 'scale(1)';
        balanceElement.style.color = '';
      }, 200);
    }
  }
}

// Initialize enhancements when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
  window.cs2Enhancements = new CS2UIEnhancements();
  
  // Add enhanced CSS
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = 'cs2-ui-improvements.css';
  document.head.appendChild(link);
});

// Export for global access
window.CS2UIEnhancements = CS2UIEnhancements;