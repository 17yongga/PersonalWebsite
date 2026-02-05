
// CS2 Modern UI JavaScript
// Generated: 2026-02-03T04:18:13.632Z

(function() {
  'use strict';
  
  // Modern UI Manager
  class CS2ModernUI {
    constructor() {
      this.theme = localStorage.getItem('cs2-theme') || 'dark';
      this.components = new Map();
      this.init();
    }
    
    init() {
      this.setupTheme();
      this.setupResponsive();
      this.setupAnimations();
      this.setupAccessibility();
      console.log('🎨 CS2 Modern UI initialized');
    }
    
    setupTheme() {
      document.documentElement.setAttribute('data-theme', this.theme);
      
      // Theme toggle functionality
      const toggles = document.querySelectorAll('.cs2-theme-toggle');
      toggles.forEach(toggle => {
        toggle.addEventListener('click', () => {
          this.toggleTheme();
        });
      });
    }
    
    toggleTheme() {
      this.theme = this.theme === 'dark' ? 'light' : 'dark';
      document.documentElement.setAttribute('data-theme', this.theme);
      localStorage.setItem('cs2-theme', this.theme);
      
      // Dispatch theme change event
      window.dispatchEvent(new CustomEvent('cs2:themeChanged', {
        detail: { theme: this.theme }
      }));
    }
    
    setupResponsive() {
      // Responsive utilities
      window.addEventListener('resize', this.debounce(() => {
        this.updateResponsiveClasses();
      }, 250));
      
      this.updateResponsiveClasses();
    }
    
    updateResponsiveClasses() {
      const width = window.innerWidth;
      const body = document.body;
      
      body.classList.remove('cs2-mobile', 'cs2-tablet', 'cs2-desktop');
      
      if (width < 768) {
        body.classList.add('cs2-mobile');
      } else if (width < 1024) {
        body.classList.add('cs2-tablet');
      } else {
        body.classList.add('cs2-desktop');
      }
    }
    
    setupAnimations() {
      // Intersection Observer for fade-in animations
      const observerOptions = {
        threshold: 0.1,
        rootMargin: '0px 0px -100px 0px'
      };
      
      const observer = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
          if (entry.isIntersecting) {
            entry.target.classList.add('cs2-fade-in');
          }
        });
      }, observerOptions);
      
      // Observe all cards
      const cards = document.querySelectorAll('.cs2-card, .cs2-match-card');
      cards.forEach(card => observer.observe(card));
    }
    
    setupAccessibility() {
      // Keyboard navigation
      document.addEventListener('keydown', (e) => {
        if (e.key === 'Tab') {
          document.body.classList.add('cs2-keyboard-nav');
        }
      });
      
      document.addEventListener('mousedown', () => {
        document.body.classList.remove('cs2-keyboard-nav');
      });
      
      // Skip to content link
      this.createSkipLink();
    }
    
    createSkipLink() {
      const skipLink = document.createElement('a');
      skipLink.href = '#main-content';
      skipLink.textContent = 'Skip to main content';
      skipLink.className = 'cs2-sr-only';
      skipLink.style.position = 'absolute';
      skipLink.style.top = '10px';
      skipLink.style.left = '10px';
      skipLink.style.zIndex = '9999';
      
      skipLink.addEventListener('focus', () => {
        skipLink.classList.remove('cs2-sr-only');
      });
      
      skipLink.addEventListener('blur', () => {
        skipLink.classList.add('cs2-sr-only');
      });
      
      document.body.prepend(skipLink);
    }
    
    // Utility functions
    debounce(func, wait) {
      let timeout;
      return function executedFunction(...args) {
        const later = () => {
          clearTimeout(timeout);
          func(...args);
        };
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
      };
    }
    
    // Component registration
    registerComponent(name, component) {
      this.components.set(name, component);
    }
    
    getComponent(name) {
      return this.components.get(name);
    }
  }
  
  // Initialize when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      window.CS2ModernUI = new CS2ModernUI();
    });
  } else {
    window.CS2ModernUI = new CS2ModernUI();
  }
  
})();
