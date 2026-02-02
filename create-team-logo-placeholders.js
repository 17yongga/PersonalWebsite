#!/usr/bin/env node

/**
 * Create Team Logo Placeholders
 * Generates simple SVG placeholders for CS2 teams that can be replaced with actual logos later
 */

const fs = require('fs').promises;
const path = require('path');

class TeamLogoPlaceholderGenerator {
  constructor() {
    this.logoDir = './img/teams/';
    
    // Top CS2 teams for logo generation
    this.teams = [
      'G2-Esports', 'Team-Spirit', 'NAVI', 'FaZe-Clan', 'Astralis',
      'Vitality', 'MOUZ', 'Team-Liquid', 'HEROIC', 'NiP',
      'Cloud9', 'BIG', 'ENCE', 'OG', 'Complexity',
      'Evil-Geniuses', 'FURIA', 'fnatic', 'Gambit', 'BLAST',
      'TSM', 'Dignitas', 'North', 'Renegades', 'Endpoint',
      'Sinners', 'ECSTATIC', 'GamerLegion', 'Into-the-Breach', 'Preasy',
      'Akimbo', 'EYEBALLERS', 'Nexus', 'Sashi', 'Aurora',
      'Monte', 'Eternal-Fire', 'SAW', 'Passion-UA', '3DMAX',
      'Falcons', 'Rebels', 'B8', 'BetBoom', 'Permitta',
      'Sangal', 'Rare-Atom', 'FORZE', 'Wildcard', 'Nouns'
    ];
    
    // Color schemes for different teams
    this.colorSchemes = [
      { bg: '#1e3a8a', text: '#ffffff' }, // Blue
      { bg: '#7c2d12', text: '#ffffff' }, // Orange
      { bg: '#166534', text: '#ffffff' }, // Green  
      { bg: '#7c1d6f', text: '#ffffff' }, // Purple
      { bg: '#dc2626', text: '#ffffff' }, // Red
      { bg: '#000000', text: '#ffffff' }, // Black
      { bg: '#374151', text: '#ffffff' }, // Gray
      { bg: '#0891b2', text: '#ffffff' }, // Cyan
      { bg: '#ca8a04', text: '#ffffff' }, // Yellow
      { bg: '#be185d', text: '#ffffff' }  // Pink
    ];
  }

  async generatePlaceholderLogos() {
    console.log('🎨 Generating CS2 team logo placeholders...\n');
    
    // Ensure logo directory exists
    await fs.mkdir(this.logoDir, { recursive: true });
    
    let generated = 0;
    
    for (let i = 0; i < this.teams.length; i++) {
      const team = this.teams[i];
      const colorScheme = this.colorSchemes[i % this.colorSchemes.length];
      
      try {
        await this.generateTeamLogo(team, colorScheme);
        generated++;
        console.log(`✅ Generated: ${team}.svg`);
      } catch (error) {
        console.error(`❌ Failed to generate ${team}: ${error.message}`);
      }
    }
    
    console.log(`\n🎯 Generated ${generated}/${this.teams.length} team logo placeholders`);
    console.log(`📁 Location: ${this.logoDir}`);
    
    // Create manifest file
    await this.createLogoManifest();
    
    return { generated, total: this.teams.length };
  }

  async generateTeamLogo(teamName, colorScheme) {
    const cleanName = teamName.replace(/-/g, ' ');
    const initials = this.generateInitials(cleanName);
    
    const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg width="64" height="64" viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <style>
      .team-bg { fill: ${colorScheme.bg}; }
      .team-text { 
        fill: ${colorScheme.text}; 
        font-family: 'Arial', sans-serif; 
        font-weight: bold; 
        font-size: ${initials.length <= 2 ? '20' : '14'}px;
        text-anchor: middle;
        dominant-baseline: central;
      }
      .team-name { 
        fill: ${colorScheme.text}; 
        font-family: 'Arial', sans-serif; 
        font-size: 8px;
        text-anchor: middle;
        dominant-baseline: central;
      }
    </style>
  </defs>
  
  <!-- Background circle -->
  <circle cx="32" cy="32" r="30" class="team-bg" stroke="${colorScheme.text}" stroke-width="2"/>
  
  <!-- Team initials -->
  <text x="32" y="28" class="team-text">${initials}</text>
  
  <!-- Team name (abbreviated if too long) -->
  <text x="32" y="50" class="team-name">${cleanName.length > 12 ? cleanName.substring(0, 10) + '...' : cleanName}</text>
  
  <!-- Decorative elements -->
  <circle cx="32" cy="32" r="26" fill="none" stroke="${colorScheme.text}" stroke-width="1" opacity="0.3"/>
</svg>`;

    const filename = `${teamName.toLowerCase().replace(/\s+/g, '-')}.svg`;
    const filepath = path.join(this.logoDir, filename);
    
    await fs.writeFile(filepath, svg);
  }

  generateInitials(teamName) {
    // Extract initials from team name
    const words = teamName.split(/[\s-]+/).filter(word => word.length > 0);
    
    if (words.length === 1) {
      return words[0].substring(0, 3).toUpperCase();
    } else if (words.length === 2) {
      return (words[0][0] + words[1][0]).toUpperCase();
    } else {
      return (words[0][0] + words[1][0] + words[2][0]).toUpperCase();
    }
  }

  async createLogoManifest() {
    const manifest = {
      generated: new Date().toISOString(),
      totalLogos: this.teams.length,
      format: 'SVG',
      size: '64x64',
      type: 'placeholder',
      teams: this.teams.map(team => ({
        name: team,
        filename: `${team.toLowerCase().replace(/\s+/g, '-')}.svg`,
        displayName: team.replace(/-/g, ' ')
      })),
      note: 'These are placeholder logos. Replace with actual team logos for production use.'
    };

    await fs.writeFile(
      path.join(this.logoDir, 'manifest.json'), 
      JSON.stringify(manifest, null, 2)
    );
    
    console.log('📋 Created logo manifest.json');
  }

  // Generate sample HTML to test logos
  async generateLogoTestPage() {
    const testHtml = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>CS2 Team Logos Test</title>
    <style>
        body { font-family: Arial, sans-serif; padding: 20px; background: #f5f5f5; }
        .logo-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(120px, 1fr)); gap: 15px; margin-top: 20px; }
        .logo-item { text-align: center; background: white; padding: 15px; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
        .logo-item img { width: 64px; height: 64px; margin-bottom: 10px; }
        .logo-item .name { font-size: 12px; color: #666; }
    </style>
</head>
<body>
    <h1>🎮 CS2 Team Logos Test</h1>
    <p>Generated: ${new Date().toLocaleString()}</p>
    <p>Total Logos: ${this.teams.length}</p>
    
    <div class="logo-grid">
        ${this.teams.map(team => `
            <div class="logo-item">
                <img src="./teams/${team.toLowerCase().replace(/\s+/g, '-')}.svg" alt="${team}" onerror="this.style.display='none'">
                <div class="name">${team.replace(/-/g, ' ')}</div>
            </div>
        `).join('')}
    </div>
</body>
</html>`;

    await fs.writeFile('./PersonalWebsite/test-team-logos.html', testHtml);
    console.log('🧪 Created test-team-logos.html');
  }
}

// Run generator if called directly
if (require.main === module) {
  async function main() {
    const generator = new TeamLogoPlaceholderGenerator();
    
    try {
      const result = await generator.generatePlaceholderLogos();
      await generator.generateLogoTestPage();
      
      console.log(`\n✅ Logo generation complete!`);
      console.log(`🎯 Generated: ${result.generated} logos`);
      console.log(`🧪 Test page: test-team-logos.html`);
      console.log(`📁 Logos directory: img/teams/`);
      
    } catch (error) {
      console.error('❌ Logo generation failed:', error);
    }
  }
  
  main();
}

module.exports = { TeamLogoPlaceholderGenerator };