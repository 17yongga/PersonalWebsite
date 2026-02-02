// CS2 Team Logo Helper Functions with Performance Optimization
// Generated: 2026-02-02T22:03:54.731Z

class CS2TeamLogos {
  constructor() {
    this.logoMap = {
    "passion ua": "/img/teams/passionua.svg",
    "sashi esport": "/img/teams/sashiesport.svg",
    "apeks": "/img/teams/apeks.svg",
    "sangal esports": "/img/teams/sangalesports.svg",
    "rebels gaming": "/img/teams/rebelsgaming.svg",
    "into the breach": "/img/teams/intothebreach.svg",
    "aurora gaming": "/img/teams/auroragaming.svg",
    "nemiga gaming": "/img/teams/nemigagaming.svg",
    "permitta esports": "/img/teams/permittaesports.svg",
    "ex-sprout": "/img/teams/exsprout.svg",
    "amkal": "/img/teams/amkal.svg",
    "9 pandas": "/img/teams/9pandas.svg",
    "enterprise": "/img/teams/enterprise.svg",
    "parivision": "/img/teams/parivision.svg",
    "koi": "/img/teams/koi.svg",
    "boss": "/img/teams/boss.svg",
    "m80": "/img/teams/m80.svg",
    "wildcard gaming": "/img/teams/wildcardgaming.svg",
    "nouns esports": "/img/teams/nounsesports.svg",
    "timbermen": "/img/teams/timbermen.svg"
};
    this.loadedLogos = new Set();
    this.loadingPromises = new Map();
    this.performanceStats = {
      logoLoads: 0,
      cacheHits: 0,
      loadTime: 0
    };
  }

  // Get logo URL for a team name with caching
  getTeamLogo(teamName) {
    const normalized = teamName.toLowerCase();
    return this.logoMap[normalized] || null;
  }

  // Preload critical logos for performance
  async preloadCriticalLogos(teamNames) {
    const preloadPromises = teamNames.map(async (teamName) => {
      const logoUrl = this.getTeamLogo(teamName);
      if (logoUrl && !this.loadedLogos.has(logoUrl)) {
        return this.preloadImage(logoUrl);
      }
    });
    
    await Promise.allSettled(preloadPromises);
    console.log(`⚡ Preloaded ${teamNames.length} critical team logos`);
  }

  // Preload image with promise caching
  async preloadImage(src) {
    if (this.loadingPromises.has(src)) {
      return this.loadingPromises.get(src);
    }

    const startTime = Date.now();
    const promise = new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        this.loadedLogos.add(src);
        this.performanceStats.logoLoads++;
        this.performanceStats.loadTime += Date.now() - startTime;
        resolve(img);
      };
      img.onerror = reject;
      img.src = src;
    });

    this.loadingPromises.set(src, promise);
    return promise;
  }

  // Create optimized logo HTML element
  createLogoElement(teamName, size = 'default', lazy = true) {
    const logoUrl = this.getTeamLogo(teamName);
    const teamSlug = this.createTeamSlug(teamName);
    const teamInitials = teamName.split(' ').map(w => w[0]).join('').substring(0, 3).toUpperCase();
    
    if (logoUrl) {
      const loadingAttr = lazy ? 'loading="lazy"' : '';
      const preloadedClass = this.loadedLogos.has(logoUrl) ? 'preloaded' : '';
      
      return `<img class="cs2-team-logo ${size} ${teamSlug} ${preloadedClass}" 
                   src="${logoUrl}" 
                   alt="${teamName} logo" 
                   title="${teamName}" 
                   ${loadingAttr}
                   onerror="this.style.display='none'; this.nextElementSibling?.style.display='flex';">`;
    } else {
      return `<div class="cs2-team-logo ${size} placeholder" data-team="${teamInitials}" title="${teamName}"></div>`;
    }
  }

  // Add logo to existing team name element
  addLogoToElement(element, teamName) {
    if (!element) return;
    
    const logoHtml = this.createLogoElement(teamName);
    element.innerHTML = logoHtml + element.innerHTML;
  }

  // Batch update all team elements with performance optimization
  updateAllTeamElements() {
    const startTime = Date.now();
    let updatedElements = 0;
    
    // Batch collect team names for preloading
    const teamNamesSet = new Set();
    
    // Update CS2 betting match cards
    const matchTeamElements = document.querySelectorAll('.cs2-match-team');
    matchTeamElements.forEach(teamElement => {
      const teamName = teamElement.textContent || teamElement.innerText;
      if (teamName && !teamElement.querySelector('.cs2-team-logo')) {
        const cleanTeamName = teamName.trim();
        teamNamesSet.add(cleanTeamName);
        this.addLogoToElement(teamElement, cleanTeamName);
        updatedElements++;
      }
    });

    // Update betting slips
    const betTeamElements = document.querySelectorAll('.bet-team-name');
    betTeamElements.forEach(teamElement => {
      const teamName = teamElement.textContent || teamElement.innerText;
      if (teamName && !teamElement.querySelector('.cs2-team-logo')) {
        const cleanTeamName = teamName.trim();
        teamNamesSet.add(cleanTeamName);
        this.addLogoToElement(teamElement, cleanTeamName);
        updatedElements++;
      }
    });

    // Update tournament brackets
    const bracketTeams = document.querySelectorAll('.tournament-team, .bracket-team');
    bracketTeams.forEach(teamElement => {
      const teamName = teamElement.textContent || teamElement.innerText;
      if (teamName && !teamElement.querySelector('.cs2-team-logo')) {
        const cleanTeamName = teamName.trim();
        teamNamesSet.add(cleanTeamName);
        this.addLogoToElement(teamElement, cleanTeamName);
        updatedElements++;
      }
    });

    const duration = Date.now() - startTime;
    
    if (updatedElements > 0) {
      console.log(`⚡ Updated ${updatedElements} team elements in ${duration}ms`);
      
      // Preload logos for visible teams
      const visibleTeams = Array.from(teamNamesSet).slice(0, 10); // Limit to first 10 for performance
      if (visibleTeams.length > 0) {
        this.preloadCriticalLogos(visibleTeams);
      }
    }
  }

  // Get performance statistics
  getPerformanceStats() {
    const avgLoadTime = this.performanceStats.logoLoads > 0 
      ? this.performanceStats.loadTime / this.performanceStats.logoLoads 
      : 0;

    return {
      ...this.performanceStats,
      avgLoadTime: avgLoadTime.toFixed(2) + 'ms',
      preloadedLogos: this.loadedLogos.size,
      cacheHitRate: this.performanceStats.logoLoads > 0 
        ? ((this.performanceStats.cacheHits / this.performanceStats.logoLoads) * 100).toFixed(1) + '%'
        : '0%'
    };
  }

  createTeamSlug(teamName) {
    return teamName
      .toLowerCase()
      .replace(/[^a-z0-9\\s]/g, '')
      .replace(/\\s+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '');
  }
}

// Global instance with performance monitoring
window.cs2TeamLogos = new CS2TeamLogos();

// Optimized initialization with performance tracking
function initializeCS2Logos() {
  const startTime = Date.now();
  
  // Initial logo update
  window.cs2TeamLogos.updateAllTeamElements();
  
  // Preload top team logos for better performance
  const topTeams = ['G2 Esports', 'Team Spirit', 'Natus Vincere', 'FaZe Clan', 'Astralis'];
  window.cs2TeamLogos.preloadCriticalLogos(topTeams);
  
  const initTime = Date.now() - startTime;
  console.log(`🏷️ CS2 Team Logos initialized in ${initTime}ms`);
}

// Auto-update logos with optimized timing
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    // Use requestAnimationFrame for better performance
    requestAnimationFrame(() => {
      setTimeout(initializeCS2Logos, 100);
    });
  });
} else {
  requestAnimationFrame(() => {
    setTimeout(initializeCS2Logos, 100);
  });
}

// Debounced mutation observer for better performance
let updateTimeout;
const observer = new MutationObserver((mutations) => {
  let shouldUpdate = false;
  
  mutations.forEach((mutation) => {
    if (mutation.type === 'childList' && mutation.addedNodes.length > 0) {
      // Check if any added nodes contain team-related classes
      for (const node of mutation.addedNodes) {
        if (node.nodeType === Node.ELEMENT_NODE) {
          const hasTeamContent = node.classList?.contains('cs2-match-team') ||
                                node.classList?.contains('bet-team-name') ||
                                node.classList?.contains('tournament-team') ||
                                node.querySelector?.('.cs2-match-team, .bet-team-name, .tournament-team');
          
          if (hasTeamContent) {
            shouldUpdate = true;
            break;
          }
        }
      }
    }
  });
  
  if (shouldUpdate) {
    clearTimeout(updateTimeout);
    updateTimeout = setTimeout(() => {
      requestAnimationFrame(() => window.cs2TeamLogos.updateAllTeamElements());
    }, 250); // Debounce to 250ms for better performance
  }
});

observer.observe(document.body, { 
  childList: true, 
  subtree: true,
  // Optimize observer performance
  attributes: false,
  attributeOldValue: false,
  characterData: false
});

// Performance monitoring - log stats every 30 seconds
if (console && console.log) {
  setInterval(() => {
    const stats = window.cs2TeamLogos.getPerformanceStats();
    if (stats.logoLoads > 0) {
      console.log('🏷️ Logo Performance:', stats);
    }
  }, 30000);
}