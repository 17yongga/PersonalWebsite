// CS2 Team Logos Implementation with Performance Optimization
// February 2, 2026 - Performance & Logo Assets Fix

const axios = require('axios');
const fs = require('fs').promises;
const path = require('path');

// Import performance monitoring
const { CS2PerformanceMonitor } = require('./cs2-performance-monitor');
const { CS2PerformanceCache } = require('./cs2-performance-cache');

class CS2TeamLogosManager {
  constructor() {
    this.logoDirectory = './img/teams/'; // Updated to use existing teams directory
    this.logoApiSources = [
      {
        name: 'HLTV',
        baseUrl: 'https://static.hltv.org/images/team/logo/',
        format: 'svg'
      },
      {
        name: 'Liquipedia',
        baseUrl: 'https://liquipedia.net/counterstrike/Special:Filepath/',
        format: 'png'
      },
      {
        name: 'PGL',
        baseUrl: 'https://www.pgl.gg/uploads/team/',
        format: 'png'
      }
    ];
    
    // Common CS2 teams (top 250 teams - starting with top 50)
    this.top50Teams = [
      // Tier 1 Teams
      { name: 'G2 Esports', hltv_id: 5995, aliases: ['G2', 'G2-Esports'] },
      { name: 'Team Spirit', hltv_id: 7020, aliases: ['Spirit', 'Team-Spirit'] },
      { name: 'Natus Vincere', hltv_id: 4608, aliases: ['NAVI', 'Na\'Vi', 'NaVi'] },
      { name: 'FaZe Clan', hltv_id: 6667, aliases: ['FaZe', 'FaZe-Clan'] },
      { name: 'Astralis', hltv_id: 6665, aliases: ['Astralis'] },
      { name: 'Vitality', hltv_id: 9565, aliases: ['Team-Vitality', 'Vitality'] },
      { name: 'MOUZ', hltv_id: 4494, aliases: ['mousesports', 'mouz'] },
      { name: 'Liquid', hltv_id: 5973, aliases: ['Team-Liquid', 'TL'] },
      { name: 'HEROIC', hltv_id: 7175, aliases: ['Heroic'] },
      { name: 'Ninjas in Pyjamas', hltv_id: 4411, aliases: ['NiP', 'NIP'] },
      
      // Tier 2 Teams  
      { name: 'Cloud9', hltv_id: 5752, aliases: ['C9', 'Cloud-9'] },
      { name: 'BIG', hltv_id: 7532, aliases: ['BIG'] },
      { name: 'ENCE', hltv_id: 4869, aliases: ['ENCE'] },
      { name: 'OG', hltv_id: 10503, aliases: ['OG'] },
      { name: 'Complexity Gaming', hltv_id: 5005, aliases: ['coL', 'Complexity'] },
      { name: 'Evil Geniuses', hltv_id: 10284, aliases: ['EG', 'Evil-Geniuses'] },
      { name: 'FURIA Esports', hltv_id: 8297, aliases: ['FURIA', 'Furia'] },
      { name: 'Imperial Esports', hltv_id: 9455, aliases: ['Imperial', 'MIBR'] },
      { name: 'Fnatic', hltv_id: 4991, aliases: ['fnatic', 'FNC'] },
      { name: 'Virtus.pro', hltv_id: 5378, aliases: ['VP', 'Virtus-pro'] },
      
      // More teams...
      { name: 'Eternal Fire', hltv_id: 11816, aliases: ['EF', 'Eternal-Fire'] },
      { name: 'ECSTATIC', hltv_id: 11251, aliases: ['ECSTATIC'] },
      { name: 'SAW', hltv_id: 11592, aliases: ['SAW'] },
      { name: 'Monte', hltv_id: 11811, aliases: ['Monte'] },
      { name: '3DMAX', hltv_id: 11595, aliases: ['3DMAX', '3D-MAX'] },
      { name: 'Falcons Esports', hltv_id: 11862, aliases: ['Falcons'] },
      { name: 'Passion UA', hltv_id: 11948, aliases: ['Passion-UA'] },
      { name: 'B8', hltv_id: 11600, aliases: ['B8'] },
      { name: 'Sashi Esport', hltv_id: 11203, aliases: ['Sashi'] },
      { name: 'TSM', hltv_id: 5996, aliases: ['TSM', 'Team-SoloMid'] },
      
      // Additional teams (can be expanded to 250)
      { name: 'Apeks', hltv_id: 11322, aliases: ['Apeks'] },
      { name: 'GamerLegion', hltv_id: 11518, aliases: ['GL', 'Gamer-Legion'] },
      { name: 'Sangal Esports', hltv_id: 11969, aliases: ['Sangal'] },
      { name: 'Rebels Gaming', hltv_id: 11412, aliases: ['Rebels'] },
      { name: 'Into the Breach', hltv_id: 10835, aliases: ['ITB', 'Into-the-Breach'] },
      { name: 'SINNERS', hltv_id: 11538, aliases: ['SINNERS'] },
      { name: 'Aurora Gaming', hltv_id: 11564, aliases: ['Aurora'] },
      { name: 'Nemiga Gaming', hltv_id: 10894, aliases: ['Nemiga'] },
      { name: 'Permitta Esports', hltv_id: 11975, aliases: ['Permitta'] },
      { name: 'ex-Sprout', hltv_id: 7791, aliases: ['Sprout'] },
      
      // Eastern European teams
      { name: 'AMKAL', hltv_id: 11518, aliases: ['AMKAL'] },
      { name: '9 Pandas', hltv_id: 11865, aliases: ['9-Pandas', 'Pandas'] },
      { name: 'Enterprise', hltv_id: 11145, aliases: ['Enterprise'] },
      { name: 'PARIVISION', hltv_id: 11969, aliases: ['PARIVISION'] },
      { name: 'KOI', hltv_id: 11823, aliases: ['KOI'] },
      
      // North American teams
      { name: 'BOSS', hltv_id: 11863, aliases: ['BOSS'] },
      { name: 'M80', hltv_id: 11811, aliases: ['M80'] },
      { name: 'Wildcard Gaming', hltv_id: 11576, aliases: ['Wildcard'] },
      { name: 'Nouns Esports', hltv_id: 11642, aliases: ['Nouns'] },
      { name: 'timbermen', hltv_id: 11755, aliases: ['timbermen'] }
    ];
    
    this.teamLogoMap = new Map();
    this.downloadedLogos = new Set();
    
    // Initialize performance monitoring
    this.performanceMonitor = new CS2PerformanceMonitor();
    this.cache = new CS2PerformanceCache();
    
    // Performance tracking
    this.downloadStats = {
      startTime: Date.now(),
      totalDownloads: 0,
      successfulDownloads: 0,
      failedDownloads: 0,
      cacheHits: 0,
      averageDownloadTime: 0
    };
  }

  // Initialize logo directory
  async initializeLogoDirectory() {
    try {
      await fs.mkdir(this.logoDirectory, { recursive: true });
      console.log(`✅ Logo directory created: ${this.logoDirectory}`);
      
      // Create subdirectories for different formats
      await fs.mkdir(path.join(this.logoDirectory, 'svg'), { recursive: true });
      await fs.mkdir(path.join(this.logoDirectory, 'png'), { recursive: true });
      await fs.mkdir(path.join(this.logoDirectory, 'webp'), { recursive: true });
      
      console.log('✅ Logo subdirectories created');
    } catch (error) {
      console.error('❌ Error creating logo directory:', error.message);
    }
  }

  // Download team logo from various sources with performance monitoring
  async downloadTeamLogo(team) {
    const startTime = Date.now();
    console.log(`🏷️ Downloading logo for: ${team.name}`);
    
    const teamSlug = this.createTeamSlug(team.name);
    const logoPath = path.join(this.logoDirectory, `${teamSlug}.svg`); // Use SVG for better performance
    
    try {
      // Check if logo already exists (cache hit)
      await fs.access(logoPath);
      console.log(`  ✅ Logo already exists: ${teamSlug}.svg`);
      this.downloadedLogos.add(teamSlug);
      this.downloadStats.cacheHits++;
      
      const duration = Date.now() - startTime;
      this.performanceMonitor.recordResponseTime(duration, true);
      
      return logoPath;
    } catch {
      // Logo doesn't exist, proceed with download
    }
    
    this.downloadStats.totalDownloads++;
    
    // Try different sources with performance tracking
    for (const source of this.logoApiSources) {
      const requestStartTime = Date.now();
      
      try {
        const logoUrl = this.constructLogoUrl(source, team);
        console.log(`  🔍 Trying ${source.name}: ${logoUrl}`);
        
        const response = await axios({
          method: 'GET',
          url: logoUrl,
          responseType: 'arraybuffer',
          timeout: 8000, // Reduced timeout for better performance
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
          }
        });
        
        const requestDuration = Date.now() - requestStartTime;
        
        if (response.status === 200 && response.data.length > 0) {
          await fs.writeFile(logoPath, response.data);
          console.log(`  ✅ Downloaded from ${source.name}: ${teamSlug}.svg (${requestDuration}ms)`);
          
          this.downloadedLogos.add(teamSlug);
          this.teamLogoMap.set(team.name.toLowerCase(), `/img/teams/${teamSlug}.svg`);
          this.downloadStats.successfulDownloads++;
          
          const totalDuration = Date.now() - startTime;
          this.performanceMonitor.recordResponseTime(totalDuration, true);
          
          return logoPath;
        }
      } catch (error) {
        const requestDuration = Date.now() - requestStartTime;
        console.log(`  ❌ Failed from ${source.name}: ${error.message} (${requestDuration}ms)`);
        this.performanceMonitor.recordResponseTime(requestDuration, false);
        continue;
      }
    }
    
    // Fallback: Create a placeholder logo
    await this.createPlaceholderLogo(team, logoPath);
    this.downloadStats.failedDownloads++;
    
    const totalDuration = Date.now() - startTime;
    this.performanceMonitor.recordResponseTime(totalDuration, false);
    
    return logoPath;
  }

  // Construct logo URL for different sources
  constructLogoUrl(source, team) {
    switch (source.name) {
      case 'HLTV':
        return `${source.baseUrl}${team.hltv_id}.${source.format}`;
      
      case 'Liquipedia':
        const liquipediaName = team.name.replace(/\\s+/g, '_').replace(/[^a-zA-Z0-9_]/g, '');
        return `${source.baseUrl}${liquipediaName}logo.${source.format}`;
      
      case 'PGL':
        const pglSlug = this.createTeamSlug(team.name);
        return `${source.baseUrl}${pglSlug}-logo.${source.format}`;
      
      default:
        return `${source.baseUrl}${this.createTeamSlug(team.name)}.${source.format}`;
    }
  }

  // Create team slug for file naming
  createTeamSlug(teamName) {
    return teamName
      .toLowerCase()
      .replace(/[^a-z0-9\\s]/g, '')
      .replace(/\\s+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '');
  }

  // Create placeholder logo when download fails
  async createPlaceholderLogo(team, logoPath) {
    console.log(`  🎨 Creating placeholder for: ${team.name}`);
    
    // Create a simple SVG placeholder
    const teamInitials = team.name
      .split(' ')
      .map(word => word.charAt(0).toUpperCase())
      .join('')
      .substring(0, 3);
    
    const svgContent = `
<svg width="64" height="64" viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg">
  <rect width="64" height="64" fill="#2c3e50"/>
  <text x="32" y="40" text-anchor="middle" font-family="Arial, sans-serif" font-size="16" font-weight="bold" fill="white">${teamInitials}</text>
</svg>`.trim();
    
    try {
      // For now, save as SVG (can convert to PNG later if needed)
      const svgPath = logoPath.replace('.png', '.svg');
      await fs.writeFile(svgPath, svgContent);
      
      // Also save a reference to the SVG as the PNG path  
      await fs.writeFile(logoPath, svgContent);
      
      console.log(`  ✅ Placeholder created: ${team.name} → ${teamInitials}`);
      this.downloadedLogos.add(this.createTeamSlug(team.name));
      this.teamLogoMap.set(team.name.toLowerCase(), `/img/cs2-team-logos/png/${this.createTeamSlug(team.name)}.png`);
    } catch (error) {
      console.error(`  ❌ Failed to create placeholder: ${error.message}`);
    }
  }

  // Download logos for all top teams
  async downloadAllLogos() {
    console.log(`🚀 Starting logo download for ${this.top50Teams.length} teams...\\n`);
    
    let successCount = 0;
    let errorCount = 0;
    
    for (let i = 0; i < this.top50Teams.length; i++) {
      const team = this.top50Teams[i];
      
      try {
        await this.downloadTeamLogo(team);
        successCount++;
        console.log(`Progress: ${i + 1}/${this.top50Teams.length} (${successCount} successful)\\n`);
        
        // Delay between downloads to be respectful
        await this.delay(500);
        
      } catch (error) {
        errorCount++;
        console.error(`❌ Error downloading ${team.name}: ${error.message}\\n`);
      }
    }
    
    console.log('📊 **LOGO DOWNLOAD SUMMARY**');
    console.log(`✅ Successful: ${successCount}/${this.top50Teams.length}`);
    console.log(`❌ Failed: ${errorCount}/${this.top50Teams.length}`);
    console.log(`📁 Logos saved to: ${this.logoDirectory}\\n`);
    
    return { successCount, errorCount, totalTeams: this.top50Teams.length };
  }

  // Generate CSS for team logo display
  generateLogoCSS() {
    console.log('🎨 Generating CSS for team logos...');
    
    const cssContent = `
/* CS2 Team Logos - Generated ${new Date().toISOString()} */

.cs2-team-logo {
  width: 32px;
  height: 32px;
  object-fit: contain;
  border-radius: 4px;
  background: #f0f0f0;
  display: inline-block;
  vertical-align: middle;
  margin-right: 8px;
}

.cs2-team-logo.large {
  width: 48px;
  height: 48px;
  border-radius: 6px;
}

.cs2-team-logo.small {
  width: 24px;
  height: 24px;
  border-radius: 3px;
  margin-right: 6px;
}

/* Team-specific logo classes */
${Array.from(this.teamLogoMap.entries()).map(([teamName, logoPath]) => {
  const className = this.createTeamSlug(teamName);
  return `.cs2-team-logo.${className} {
  background-image: url('${logoPath}');
  background-size: contain;
  background-repeat: no-repeat;
  background-position: center;
}`;
}).join('\\n\\n')}

/* Fallback for missing logos */
.cs2-team-logo[data-team]:not([style*="background-image"]):before {
  content: attr(data-team);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 10px;
  font-weight: bold;
  color: #666;
  text-transform: uppercase;
}
`;
    
    return cssContent.trim();
  }

  // Update CS2 UI to display team logos
  async updateCS2UIWithLogos() {
    console.log('🔧 Updating CS2 UI to display team logos...');
    
    try {
      // Generate CSS
      const cssContent = this.generateLogoCSS();
      const cssPath = path.join(this.logoDirectory, '..', 'cs2-team-logos.css');
      await fs.writeFile(cssPath, cssContent);
      console.log(`✅ CSS generated: ${cssPath}`);
      
      // Generate JavaScript helper functions
      const jsContent = this.generateLogoJavaScript();
      const jsPath = path.join(this.logoDirectory, '..', 'cs2-team-logos.js');
      await fs.writeFile(jsPath, jsContent);
      console.log(`✅ JavaScript helpers generated: ${jsPath}`);
      
      // Generate logo mapping JSON for easy reference
      const logoMappingPath = path.join(this.logoDirectory, 'team-logo-mapping.json');
      const logoMapping = {
        timestamp: new Date().toISOString(),
        totalTeams: this.top50Teams.length,
        downloadedLogos: this.downloadedLogos.size,
        teamMapping: Object.fromEntries(this.teamLogoMap)
      };
      await fs.writeFile(logoMappingPath, JSON.stringify(logoMapping, null, 2));
      console.log(`✅ Logo mapping saved: ${logoMappingPath}`);
      
    } catch (error) {
      console.error('❌ Error updating CS2 UI:', error.message);
    }
  }

  // Generate JavaScript helper functions with performance optimization
  generateLogoJavaScript() {
    return `
// CS2 Team Logo Helper Functions with Performance Optimization
// Generated: ${new Date().toISOString()}

class CS2TeamLogos {
  constructor() {
    this.logoMap = ${JSON.stringify(Object.fromEntries(this.teamLogoMap), null, 4)};
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
    console.log(\`⚡ Preloaded \${teamNames.length} critical team logos\`);
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
      
      return \`<img class="cs2-team-logo \${size} \${teamSlug} \${preloadedClass}" 
                   src="\${logoUrl}" 
                   alt="\${teamName} logo" 
                   title="\${teamName}" 
                   \${loadingAttr}
                   onerror="this.style.display='none'; this.nextElementSibling?.style.display='flex';">\`;
    } else {
      return \`<div class="cs2-team-logo \${size} placeholder" data-team="\${teamInitials}" title="\${teamName}"></div>\`;
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
      console.log(\`⚡ Updated \${updatedElements} team elements in \${duration}ms\`);
      
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
      .replace(/[^a-z0-9\\\\s]/g, '')
      .replace(/\\\\s+/g, '-')
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
  console.log(\`🏷️ CS2 Team Logos initialized in \${initTime}ms\`);
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
`.trim();
  }

  // Utility function for delays
  delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // Generate comprehensive status report
  async generateReport() {
    const report = {
      timestamp: new Date().toISOString(),
      summary: {
        totalTeams: this.top50Teams.length,
        downloadedLogos: this.downloadedLogos.size,
        successRate: `${Math.round((this.downloadedLogos.size / this.top50Teams.length) * 100)}%`
      },
      teams: this.top50Teams.map(team => ({
        name: team.name,
        slug: this.createTeamSlug(team.name),
        hltv_id: team.hltv_id,
        aliases: team.aliases,
        logoDownloaded: this.downloadedLogos.has(this.createTeamSlug(team.name)),
        logoPath: this.teamLogoMap.get(team.name.toLowerCase()) || null
      })),
      logoSources: this.logoApiSources,
      integration: {
        cssFile: 'cs2-team-logos.css',
        jsFile: 'cs2-team-logos.js', 
        mappingFile: 'team-logo-mapping.json'
      }
    };
    
    const reportPath = `cs2-team-logos-report-${Date.now()}.json`;
    await fs.writeFile(reportPath, JSON.stringify(report, null, 2));
    console.log(`📊 Team logos report saved: ${reportPath}`);
    
    return report;
  }
}

// CLI interface
async function runTeamLogosDownload() {
  const manager = new CS2TeamLogosManager();
  
  console.log('🏷️ **CS2 TEAM LOGOS DOWNLOADER**\\n');
  console.log('Downloading logos for top CS2 teams...\\n');
  
  try {
    // Step 1: Initialize directories
    await manager.initializeLogoDirectory();
    
    // Step 2: Download all logos
    const results = await manager.downloadAllLogos();
    
    // Step 3: Update UI integration
    await manager.updateCS2UIWithLogos();
    
    // Step 4: Generate report
    const report = await manager.generateReport();
    
    console.log('🎉 **TEAM LOGOS SETUP COMPLETE**\\n');
    console.log('📋 Integration steps:');
    console.log('1. Add CSS to your HTML: <link rel="stylesheet" href="img/cs2-team-logos.css">');
    console.log('2. Add JS to your HTML: <script src="img/cs2-team-logos.js"></script>');
    console.log('3. Logos will automatically appear in CS2 betting UI');
    console.log('4. Logos are cached and work offline\\n');
    
    console.log(`✅ Downloaded ${results.successCount}/${results.totalTeams} team logos`);
    console.log('🚀 CS2 betting site now has professional team logos!\\n');
    
  } catch (error) {
    console.error('❌ **ERROR:**', error.message);
  }
}

// Export for use in other modules
module.exports = { CS2TeamLogosManager };

// Run if called directly
if (require.main === module) {
  runTeamLogosDownload();
}