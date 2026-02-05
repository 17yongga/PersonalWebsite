/**
 * CS2 Enhanced UI JavaScript
 * Implements all interactive improvements from UI/UX audit
 */

class CS2EnhancedUI {
  constructor() {
    this.init();
    this.bindEvents();
    this.loadingStates = new Map();
    this.toastContainer = null;
  }

  init() {
    console.log('🎮 CS2 Enhanced UI initializing...');
    this.createToastContainer();
    this.enhanceMobileNavigation();
    this.enhanceMatchCards();
    this.enhanceForms();
    this.initAccessibility();
    console.log('✅ CS2 Enhanced UI initialized');
  }

  // ===== MOBILE NAVIGATION ===== 
  enhanceMobileNavigation() {
    const nav = document.querySelector('.cs2-navigation');
    if (!nav) return;

    // Add mobile toggle button if not exists
    let toggle = nav.querySelector('.cs2-nav-toggle');
    if (!toggle) {
      toggle = document.createElement('button');
      toggle.className = 'cs2-nav-toggle';
      toggle.innerHTML = '☰';
      toggle.setAttribute('aria-label', 'Toggle navigation menu');
      toggle.setAttribute('aria-expanded', 'false');
      
      const navContent = nav.querySelector('.cs2-nav-content');
      navContent.insertBefore(toggle, navContent.firstChild);
    }

    // Handle mobile menu toggle
    toggle.addEventListener('click', () => {
      const navLinks = nav.querySelector('.cs2-nav-links');
      const isActive = navLinks.classList.contains('active');
      
      navLinks.classList.toggle('active');
      toggle.setAttribute('aria-expanded', !isActive);
      toggle.innerHTML = isActive ? '☰' : '✕';
      
      // Trap focus in mobile menu
      if (!isActive) {
        this.trapFocus(navLinks);
      }
    });

    // Close mobile menu on escape key
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        const navLinks = nav.querySelector('.cs2-nav-links');
        if (navLinks.classList.contains('active')) {
          navLinks.classList.remove('active');
          toggle.setAttribute('aria-expanded', 'false');
          toggle.innerHTML = '☰';
          toggle.focus();
        }
      }
    });

    // Close mobile menu on outside click
    document.addEventListener('click', (e) => {
      if (!nav.contains(e.target)) {
        const navLinks = nav.querySelector('.cs2-nav-links');
        if (navLinks.classList.contains('active')) {
          navLinks.classList.remove('active');
          toggle.setAttribute('aria-expanded', 'false');
          toggle.innerHTML = '☰';
        }
      }
    });
  }

  // ===== ENHANCED MATCH CARDS =====
  enhanceMatchCards() {
    const matchCards = document.querySelectorAll('.cs2-match-card');
    
    matchCards.forEach(card => {
      // Add swipe support for mobile
      this.addSwipeSupport(card);
      
      // Enhance odds buttons
      const oddsButtons = card.querySelectorAll('.cs2-odds-button');
      oddsButtons.forEach(button => {
        button.addEventListener('click', (e) => {
          this.handleOddsSelection(e.target, card);
        });
        
        // Add keyboard support
        button.addEventListener('keydown', (e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            this.handleOddsSelection(e.target, card);
          }
        });
      });

      // Add favorite functionality
      this.addFavoriteButton(card);
    });
  }

  addSwipeSupport(element) {
    let startX = 0;
    let startY = 0;
    let distX = 0;
    let distY = 0;
    let startTime = 0;

    element.addEventListener('touchstart', (e) => {
      const touch = e.touches[0];
      startX = touch.clientX;
      startY = touch.clientY;
      startTime = Date.now();
    }, { passive: true });

    element.addEventListener('touchend', (e) => {
      const touch = e.changedTouches[0];
      distX = touch.clientX - startX;
      distY = touch.clientY - startY;
      const elapsedTime = Date.now() - startTime;

      // Check if it's a swipe (not a tap)
      if (elapsedTime < 300 && Math.abs(distX) > 100 && Math.abs(distY) < 100) {
        if (distX > 0) {
          this.handleSwipe(element, 'right');
        } else {
          this.handleSwipe(element, 'left');
        }
      }
    }, { passive: true });
  }

  handleSwipe(card, direction) {
    const action = direction === 'right' ? 'favorite' : 'quick-bet';
    this.showToast(`Swiped ${direction} - ${action} action`, 'info');
  }

  addFavoriteButton(card) {
    const header = card.querySelector('.cs2-match-header');
    if (!header || header.querySelector('.cs2-favorite-btn')) return;

    const favoriteBtn = document.createElement('button');
    favoriteBtn.className = 'cs2-favorite-btn';
    favoriteBtn.innerHTML = '🤍';
    favoriteBtn.setAttribute('aria-label', 'Add to favorites');
    favoriteBtn.style.cssText = `
      background: none;
      border: none;
      font-size: 1.2rem;
      cursor: pointer;
      padding: 8px;
      border-radius: 4px;
      transition: all 0.2s ease;
    `;

    favoriteBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const isFavorite = favoriteBtn.innerHTML === '❤️';
      favoriteBtn.innerHTML = isFavorite ? '🤍' : '❤️';
      favoriteBtn.setAttribute('aria-label', isFavorite ? 'Add to favorites' : 'Remove from favorites');
      this.showToast(isFavorite ? 'Removed from favorites' : 'Added to favorites', 'success');
    });

    header.appendChild(favoriteBtn);
  }

  handleOddsSelection(button, card) {
    // Visual feedback
    button.style.transform = 'scale(0.95)';
    setTimeout(() => {
      button.style.transform = '';
    }, 150);

    const team = button.closest('.cs2-team')?.querySelector('.cs2-team-name')?.textContent || 'Selection';
    const odds = button.querySelector('.cs2-odds-value')?.textContent || 'N/A';
    
    this.showToast(`Selected: ${team} at ${odds}`, 'success');
    
    // Add to bet slip (placeholder functionality)
    this.addToBetSlip({
      team,
      odds,
      matchCard: card
    });
  }

  // ===== ENHANCED FORMS =====
  enhanceForms() {
    const forms = document.querySelectorAll('form');
    
    forms.forEach(form => {
      // Add real-time validation
      const inputs = form.querySelectorAll('.cs2-input, .cs2-select, .cs2-textarea');
      inputs.forEach(input => {
        input.addEventListener('blur', () => this.validateInput(input));
        input.addEventListener('input', () => this.clearValidationErrors(input));
      });

      // Enhanced form submission
      form.addEventListener('submit', (e) => {
        e.preventDefault();
        this.handleFormSubmission(form);
      });
    });
  }

  validateInput(input) {
    const value = input.value.trim();
    const type = input.type || input.tagName.toLowerCase();
    let isValid = true;
    let errorMessage = '';

    // Basic validation rules
    if (input.hasAttribute('required') && !value) {
      isValid = false;
      errorMessage = 'This field is required';
    } else if (type === 'email' && value && !this.isValidEmail(value)) {
      isValid = false;
      errorMessage = 'Please enter a valid email address';
    } else if (type === 'number' && value && isNaN(value)) {
      isValid = false;
      errorMessage = 'Please enter a valid number';
    } else if (input.hasAttribute('minlength') && value.length < input.getAttribute('minlength')) {
      isValid = false;
      errorMessage = `Minimum length is ${input.getAttribute('minlength')} characters`;
    }

    this.showValidationResult(input, isValid, errorMessage);
    return isValid;
  }

  showValidationResult(input, isValid, errorMessage = '') {
    input.classList.remove('error');
    
    // Remove existing error message
    const existingError = input.parentNode.querySelector('.cs2-error-message');
    if (existingError) {
      existingError.remove();
    }

    if (!isValid && errorMessage) {
      input.classList.add('error');
      const errorDiv = document.createElement('div');
      errorDiv.className = 'cs2-error-message';
      errorDiv.textContent = errorMessage;
      input.parentNode.appendChild(errorDiv);
    }
  }

  clearValidationErrors(input) {
    input.classList.remove('error');
    const errorMessage = input.parentNode.querySelector('.cs2-error-message');
    if (errorMessage) {
      errorMessage.remove();
    }
  }

  handleFormSubmission(form) {
    const inputs = form.querySelectorAll('.cs2-input, .cs2-select, .cs2-textarea');
    let isFormValid = true;

    // Validate all inputs
    inputs.forEach(input => {
      if (!this.validateInput(input)) {
        isFormValid = false;
      }
    });

    if (isFormValid) {
      // Show loading state
      const submitButton = form.querySelector('[type=\"submit\"]');
      this.setLoadingState(submitButton, true);
      
      // Simulate form submission
      setTimeout(() => {
        this.setLoadingState(submitButton, false);
        this.showToast('Form submitted successfully!', 'success');
      }, 1500);
    } else {
      this.showToast('Please fix the errors and try again', 'error');
    }
  }

  // ===== LOADING STATES =====
  setLoadingState(element, isLoading) {
    if (!element) return;

    const elementId = element.id || Math.random().toString(36).substr(2, 9);
    if (!element.id) element.id = elementId;

    if (isLoading) {
      const originalText = element.textContent;
      this.loadingStates.set(elementId, originalText);
      
      element.classList.add('cs2-button-loading');
      element.disabled = true;
      element.textContent = 'Loading...';
    } else {
      const originalText = this.loadingStates.get(elementId);
      if (originalText) {
        element.textContent = originalText;
        this.loadingStates.delete(elementId);
      }
      
      element.classList.remove('cs2-button-loading');
      element.disabled = false;
    }
  }

  // ===== TOAST NOTIFICATIONS =====
  createToastContainer() {
    this.toastContainer = document.createElement('div');
    this.toastContainer.id = 'cs2-toast-container';
    this.toastContainer.style.cssText = `
      position: fixed;
      top: 20px;
      right: 20px;
      z-index: 2000;
      pointer-events: none;
    `;
    document.body.appendChild(this.toastContainer);
  }

  showToast(message, type = 'info', duration = 4000) {
    const toast = document.createElement('div');
    toast.className = `cs2-toast ${type}`;
    toast.textContent = message;
    toast.style.pointerEvents = 'auto';

    this.toastContainer.appendChild(toast);

    // Show toast
    requestAnimationFrame(() => {
      toast.classList.add('show');
    });

    // Auto-hide toast
    setTimeout(() => {
      toast.classList.remove('show');
      setTimeout(() => {
        if (toast.parentNode) {
          toast.parentNode.removeChild(toast);
        }
      }, 300);
    }, duration);

    // Allow manual close
    toast.addEventListener('click', () => {
      toast.classList.remove('show');
      setTimeout(() => {
        if (toast.parentNode) {
          toast.parentNode.removeChild(toast);
        }
      }, 300);
    });
  }

  // ===== ACCESSIBILITY =====
  initAccessibility() {
    // Add skip links
    this.addSkipLinks();
    
    // Enhance keyboard navigation
    this.enhanceKeyboardNavigation();
    
    // Add ARIA live regions
    this.addLiveRegions();
  }

  addSkipLinks() {
    if (document.querySelector('.cs2-skip-links')) return;

    const skipLinks = document.createElement('div');
    skipLinks.className = 'cs2-skip-links';
    skipLinks.innerHTML = `
      <a href=\"#main-content\" class=\"cs2-skip-link\">Skip to main content</a>
      <a href=\"#navigation\" class=\"cs2-skip-link\">Skip to navigation</a>
    `;
    document.body.insertBefore(skipLinks, document.body.firstChild);
  }

  enhanceKeyboardNavigation() {
    // Focus visible for keyboard users
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Tab') {
        document.body.classList.add('keyboard-navigation');
      }
    });

    document.addEventListener('mousedown', () => {
      document.body.classList.remove('keyboard-navigation');
    });
  }

  addLiveRegions() {
    if (document.querySelector('#cs2-live-region')) return;

    const liveRegion = document.createElement('div');
    liveRegion.id = 'cs2-live-region';
    liveRegion.setAttribute('aria-live', 'polite');
    liveRegion.setAttribute('aria-atomic', 'true');
    liveRegion.style.cssText = `
      position: absolute;
      left: -10000px;
      width: 1px;
      height: 1px;
      overflow: hidden;
    `;
    document.body.appendChild(liveRegion);
  }

  // ===== UTILITY FUNCTIONS =====
  trapFocus(element) {
    const focusableElements = element.querySelectorAll(
      'a[href], button, textarea, input[type=\"text\"], input[type=\"radio\"], input[type=\"checkbox\"], select'
    );
    
    if (focusableElements.length === 0) return;

    const firstFocusable = focusableElements[0];
    const lastFocusable = focusableElements[focusableElements.length - 1];

    const handleTabKey = (e) => {
      if (e.key !== 'Tab') return;

      if (e.shiftKey) {
        if (document.activeElement === firstFocusable) {
          lastFocusable.focus();
          e.preventDefault();
        }
      } else {
        if (document.activeElement === lastFocusable) {
          firstFocusable.focus();
          e.preventDefault();
        }
      }
    };

    element.addEventListener('keydown', handleTabKey);
    firstFocusable.focus();

    return () => {
      element.removeEventListener('keydown', handleTabKey);
    };
  }

  isValidEmail(email) {
    return /^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/.test(email);
  }

  addToBetSlip(selection) {
    // Placeholder bet slip functionality
    console.log('Added to bet slip:', selection);
    
    // Update live region for screen readers
    const liveRegion = document.getElementById('cs2-live-region');
    if (liveRegion) {
      liveRegion.textContent = `${selection.team} at ${selection.odds} added to bet slip`;
    }
  }

  bindEvents() {
    // Theme toggle
    const themeToggle = document.querySelector('.cs2-theme-toggle');
    if (themeToggle) {
      themeToggle.addEventListener('click', () => {
        const currentTheme = document.documentElement.getAttribute('data-theme');
        const newTheme = currentTheme === 'dark' ? 'light' : 'dark';
        document.documentElement.setAttribute('data-theme', newTheme);
        localStorage.setItem('cs2-theme', newTheme);
        
        themeToggle.textContent = newTheme === 'dark' ? '🌙' : '☀️';
        this.showToast(`Switched to ${newTheme} theme`, 'info');
      });
    }

    // Load saved theme
    const savedTheme = localStorage.getItem('cs2-theme');
    if (savedTheme) {
      document.documentElement.setAttribute('data-theme', savedTheme);
      const themeToggle = document.querySelector('.cs2-theme-toggle');
      if (themeToggle) {
        themeToggle.textContent = savedTheme === 'dark' ? '🌙' : '☀️';
      }
    }
  }
}

// Initialize when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    window.cs2UI = new CS2EnhancedUI();
  });
} else {
  window.cs2UI = new CS2EnhancedUI();
}

// Export for module systems
if (typeof module !== 'undefined' && module.exports) {
  module.exports = CS2EnhancedUI;
}