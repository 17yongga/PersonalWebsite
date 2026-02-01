// CS2 Team Logo Helper Functions
// Generated: 2026-02-01T16:23:06.945Z

class CS2TeamLogos {
  constructor() {
    this.logoMap = {
    "g2 esports": "/img/cs2-team-logos/png/g2esports.png",
    "team spirit": "/img/cs2-team-logos/png/teamspirit.png",
    "natus vincere": "/img/cs2-team-logos/png/natusvincere.png",
    "faze clan": "/img/cs2-team-logos/png/fazeclan.png",
    "astralis": "/img/cs2-team-logos/png/astralis.png",
    "vitality": "/img/cs2-team-logos/png/vitality.png",
    "mouz": "/img/cs2-team-logos/png/mouz.png",
    "liquid": "/img/cs2-team-logos/png/liquid.png",
    "heroic": "/img/cs2-team-logos/png/heroic.png",
    "ninjas in pyjamas": "/img/cs2-team-logos/png/ninjasinpyjamas.png",
    "cloud9": "/img/cs2-team-logos/png/cloud9.png",
    "big": "/img/cs2-team-logos/png/big.png",
    "ence": "/img/cs2-team-logos/png/ence.png",
    "og": "/img/cs2-team-logos/png/og.png",
    "complexity gaming": "/img/cs2-team-logos/png/complexitygaming.png",
    "evil geniuses": "/img/cs2-team-logos/png/evilgeniuses.png",
    "furia esports": "/img/cs2-team-logos/png/furiaesports.png",
    "imperial esports": "/img/cs2-team-logos/png/imperialesports.png",
    "fnatic": "/img/cs2-team-logos/png/fnatic.png",
    "virtus.pro": "/img/cs2-team-logos/png/virtuspro.png",
    "eternal fire": "/img/cs2-team-logos/png/eternalfire.png",
    "ecstatic": "/img/cs2-team-logos/png/ecstatic.png",
    "saw": "/img/cs2-team-logos/png/saw.png",
    "monte": "/img/cs2-team-logos/png/monte.png",
    "3dmax": "/img/cs2-team-logos/png/3dmax.png",
    "falcons esports": "/img/cs2-team-logos/png/falconsesports.png",
    "passion ua": "/img/cs2-team-logos/png/passionua.png",
    "b8": "/img/cs2-team-logos/png/b8.png",
    "sashi esport": "/img/cs2-team-logos/png/sashiesport.png",
    "tsm": "/img/cs2-team-logos/png/tsm.png",
    "apeks": "/img/cs2-team-logos/png/apeks.png",
    "gamerlegion": "/img/cs2-team-logos/png/gamerlegion.png",
    "sangal esports": "/img/cs2-team-logos/png/sangalesports.png",
    "rebels gaming": "/img/cs2-team-logos/png/rebelsgaming.png",
    "into the breach": "/img/cs2-team-logos/png/intothebreach.png",
    "sinners": "/img/cs2-team-logos/png/sinners.png",
    "aurora gaming": "/img/cs2-team-logos/png/auroragaming.png",
    "nemiga gaming": "/img/cs2-team-logos/png/nemigagaming.png",
    "permitta esports": "/img/cs2-team-logos/png/permittaesports.png",
    "ex-sprout": "/img/cs2-team-logos/png/exsprout.png",
    "amkal": "/img/cs2-team-logos/png/amkal.png",
    "9 pandas": "/img/cs2-team-logos/png/9pandas.png",
    "enterprise": "/img/cs2-team-logos/png/enterprise.png",
    "parivision": "/img/cs2-team-logos/png/parivision.png",
    "koi": "/img/cs2-team-logos/png/koi.png",
    "boss": "/img/cs2-team-logos/png/boss.png",
    "m80": "/img/cs2-team-logos/png/m80.png",
    "wildcard gaming": "/img/cs2-team-logos/png/wildcardgaming.png",
    "nouns esports": "/img/cs2-team-logos/png/nounsesports.png",
    "timbermen": "/img/cs2-team-logos/png/timbermen.png"
};
  }

  // Get logo URL for a team name
  getTeamLogo(teamName) {
    const normalized = teamName.toLowerCase();
    return this.logoMap[normalized] || null;
  }

  // Create logo HTML element
  createLogoElement(teamName, size = 'default') {
    const logoUrl = this.getTeamLogo(teamName);
    const teamSlug = this.createTeamSlug(teamName);
    const teamInitials = teamName.split(' ').map(w => w[0]).join('').substring(0, 3).toUpperCase();
    
    if (logoUrl) {
      return `<img class="cs2-team-logo ${size} ${teamSlug}" src="${logoUrl}" alt="${teamName} logo" title="${teamName}" loading="lazy">`;
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

  // Batch update all team elements on page
  updateAllTeamElements() {
    // Update CS2 betting match cards
    document.querySelectorAll('.cs2-match-team').forEach(teamElement => {
      const teamName = teamElement.textContent || teamElement.innerText;
      if (teamName && !teamElement.querySelector('.cs2-team-logo')) {
        this.addLogoToElement(teamElement, teamName.trim());
      }
    });

    // Update betting slips
    document.querySelectorAll('.bet-team-name').forEach(teamElement => {
      const teamName = teamElement.textContent || teamElement.innerText;
      if (teamName && !teamElement.querySelector('.cs2-team-logo')) {
        this.addLogoToElement(teamElement, teamName.trim());
      }
    });
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

// Global instance
window.cs2TeamLogos = new CS2TeamLogos();

// Auto-update logos when page loads or content changes
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    setTimeout(() => window.cs2TeamLogos.updateAllTeamElements(), 1000);
  });
} else {
  setTimeout(() => window.cs2TeamLogos.updateAllTeamElements(), 1000);
}

// Watch for dynamic content updates
const observer = new MutationObserver((mutations) => {
  mutations.forEach((mutation) => {
    if (mutation.type === 'childList' && mutation.addedNodes.length > 0) {
      setTimeout(() => window.cs2TeamLogos.updateAllTeamElements(), 500);
    }
  });
});

observer.observe(document.body, { childList: true, subtree: true });