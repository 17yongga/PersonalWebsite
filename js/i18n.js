/**
 * i18n - Internationalization for Gary Yong's Portfolio
 * Supports: English (en), Chinese (zh)
 */

const i18n = {
  currentLang: 'en',
  translations: {},
  supportedLangs: ['en', 'zh'],
  
  async init() {
    // Check saved preference or browser language
    const saved = localStorage.getItem('lang');
    if (saved && this.supportedLangs.includes(saved)) {
      this.currentLang = saved;
    } else {
      // Check browser language
      const browserLang = navigator.language.slice(0, 2);
      if (browserLang === 'zh') {
        this.currentLang = 'zh';
      }
    }
    
    // Load translations
    await this.loadTranslations(this.currentLang);
    
    // Apply translations
    this.applyTranslations();
    
    // Update toggle button
    this.updateToggle();
    
    // Set up toggle listener
    this.setupToggle();
  },
  
  async loadTranslations(lang) {
    try {
      const response = await fetch(`/lang/${lang}.json`);
      this.translations = await response.json();
    } catch (error) {
      console.error('Failed to load translations:', error);
      // Fallback to English
      if (lang !== 'en') {
        await this.loadTranslations('en');
      }
    }
  },
  
  async switchLang(lang) {
    if (!this.supportedLangs.includes(lang)) return;
    
    this.currentLang = lang;
    localStorage.setItem('lang', lang);
    
    await this.loadTranslations(lang);
    this.applyTranslations();
    this.updateToggle();
    
    // Update HTML lang attribute
    document.documentElement.lang = lang === 'zh' ? 'zh-CN' : 'en';
  },
  
  toggle() {
    const newLang = this.currentLang === 'en' ? 'zh' : 'en';
    this.switchLang(newLang);
  },
  
  t(key) {
    // Get nested translation by dot notation (e.g., "nav.home")
    const keys = key.split('.');
    let value = this.translations;
    
    for (const k of keys) {
      if (value && typeof value === 'object' && k in value) {
        value = value[k];
      } else {
        return key; // Return key if translation not found
      }
    }
    
    return value;
  },
  
  applyTranslations() {
    // Update page title if data-i18n-title is set on html element
    const titleKey = document.documentElement.getAttribute('data-i18n-title');
    if (titleKey) {
      const titleTranslation = this.t(titleKey);
      if (titleTranslation && titleTranslation !== titleKey) {
        document.title = titleTranslation;
      }
    }

    // Find all elements with data-i18n attribute
    const elements = document.querySelectorAll('[data-i18n]');
    
    elements.forEach(el => {
      const key = el.getAttribute('data-i18n');
      const translation = this.t(key);
      
      if (translation && translation !== key) {
        // Check if it's an input placeholder
        if (el.hasAttribute('placeholder')) {
          el.placeholder = translation;
        } else {
          el.textContent = translation;
        }
      }
    });
    
    // Handle data-i18n-html for HTML content
    const htmlElements = document.querySelectorAll('[data-i18n-html]');
    htmlElements.forEach(el => {
      const key = el.getAttribute('data-i18n-html');
      const translation = this.t(key);
      if (translation && translation !== key) {
        el.innerHTML = translation;
      }
    });
  },
  
  setupToggle() {
    const toggle = document.getElementById('lang-toggle');
    if (toggle) {
      toggle.addEventListener('click', () => this.toggle());
    }
  },
  
  updateToggle() {
    const toggle = document.getElementById('lang-toggle');
    if (toggle) {
      toggle.textContent = this.currentLang === 'en' ? '中文' : 'EN';
      toggle.setAttribute('aria-label', 
        this.currentLang === 'en' ? 'Switch to Chinese' : 'Switch to English'
      );
    }
  }
};

// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
  i18n.init();
});

// Export for use in other scripts
window.i18n = i18n;
