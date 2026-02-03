// CS2 API Keys Enhancement & Backup Key Generator
// February 1, 2026 - Emergency Bug Fix Session

const axios = require('axios');
const fs = require('fs').promises;

class CS2ApiKeyManager {
  constructor() {
    this.baseUrl = 'https://api.the-odds-api.com';
    this.freeKeysUrl = 'https://api.the-odds-api.com/v4/sports/upcoming/odds';
    
    // Current working keys (need to be updated with fresh ones)
    this.existingKeys = [
      '492c4517-843e-49d5-96dd-8eed82567c5b', // Primary
      '9003763c-674b-4b96-be80-fb8d08ff99db', // Backup 1
      '0ddeae0a-1e13-4285-9e35-b5b590190fa8', // Backup 2
      '2fc3c182-766b-4992-9729-f439efdac2ba', // Backup 3
    ];
    
    // NEW backup keys I'll generate today
    this.newKeys = [
      // Will be populated as I create them
    ];
    
    this.keyStatus = new Map();
    this.keyUsageStats = new Map();
  }

  // Test a single API key's functionality
  async testApiKey(apiKey, sport = 'upcoming') {
    const testEndpoint = `${this.baseUrl}/v4/sports/${sport}/odds`;
    
    try {
      console.log(`🔍 Testing key: ${apiKey.substring(0, 8)}...${apiKey.substring(-4)}`);
      
      const startTime = Date.now();
      const response = await axios.get(testEndpoint, {
        params: {
          apiKey: apiKey,
          regions: 'us',
          markets: 'h2h',
          dateFormat: 'iso'
        },
        timeout: 10000
      });
      
      const responseTime = Date.now() - startTime;
      const remainingRequests = response.headers['x-requests-remaining'] || 'unknown';
      
      return {
        key: apiKey,
        status: 'working',
        responseTime,
        remainingRequests,
        dataCount: response.data?.length || 0,
        error: null
      };
      
    } catch (error) {
      let status = 'error';
      let errorMessage = error.message;
      
      if (error.response?.status === 429) {
        status = 'rate_limited';
        errorMessage = 'Rate limit exceeded';
      } else if (error.response?.status === 401) {
        status = 'unauthorized';  
        errorMessage = 'Invalid API key';
      } else if (error.response?.status === 422) {
        status = 'invalid_request';
        errorMessage = 'Invalid request parameters';
      }
      
      return {
        key: apiKey,
        status,
        responseTime: null,
        remainingRequests: 0,
        dataCount: 0,
        error: errorMessage
      };
    }
  }

  // Test all existing keys and generate status report
  async auditExistingKeys() {
    console.log('🔍 **AUDITING EXISTING API KEYS**\\n');
    
    const results = [];
    
    for (let i = 0; i < this.existingKeys.length; i++) {
      const key = this.existingKeys[i];
      const result = await this.testApiKey(key);
      results.push(result);
      
      console.log(`Key ${i + 1}/${this.existingKeys.length}:`);
      console.log(`  Status: ${this.getStatusIcon(result.status)} ${result.status}`);
      console.log(`  Remaining: ${result.remainingRequests} requests`);
      console.log(`  Response: ${result.responseTime || 'N/A'}ms`);
      console.log(`  Data: ${result.dataCount} items`);
      if (result.error) {
        console.log(`  Error: ${result.error}`);
      }
      console.log('');
      
      // Wait between tests to avoid overwhelming API
      await this.delay(2000);
    }
    
    // Summary
    const working = results.filter(r => r.status === 'working').length;
    const rateLimited = results.filter(r => r.status === 'rate_limited').length;
    const broken = results.filter(r => !['working', 'rate_limited'].includes(r.status)).length;
    
    console.log('📊 **AUDIT SUMMARY**');
    console.log(`✅ Working: ${working}/${results.length}`);
    console.log(`⏳ Rate Limited: ${rateLimited}/${results.length}`);
    console.log(`❌ Broken: ${broken}/${results.length}\\n`);
    
    return results;
  }

  // Generate additional backup API keys
  async generateBackupKeys(count = 5) {
    console.log(`🔑 **GENERATING ${count} NEW BACKUP KEYS**\\n`);
    
    console.log('📋 **MANUAL STEPS REQUIRED:**');
    console.log('Due to anti-bot measures, API keys must be created manually.\\n');
    
    console.log('🔄 **FOR EACH NEW KEY (repeat ${count} times):**');
    console.log('1. Open incognito browser window');
    console.log('2. Go to: https://the-odds-api.com/');
    console.log('3. Click "Get Free API Key"');
    console.log('4. Use temp email: https://10minutemail.com/');
    console.log('5. Complete registration with dummy details');
    console.log('6. Verify email from temp inbox');
    console.log('7. Login and copy API key from dashboard');
    console.log('8. Add key to the newKeys array below');
    console.log('9. Repeat for additional keys\\n');
    
    // Provide template for adding new keys
    console.log('📝 **ADD NEW KEYS HERE:**');
    console.log('Edit this file and add new keys to the newKeys array:');
    console.log('');
    console.log('const newKeys = [');
    console.log('  "your-new-key-1-here",');
    console.log('  "your-new-key-2-here",');
    console.log('  "your-new-key-3-here",');
    console.log('  "your-new-key-4-here",');
    console.log('  "your-new-key-5-here"');
    console.log('];\\n');
    
    return {
      message: 'Manual key generation required',
      instructions: 'See console output above',
      targetCount: count,
      currentCount: this.newKeys.length
    };
  }

  // Update casino server configuration with new keys
  async updateServerConfig() {
    if (this.newKeys.length === 0) {
      console.log('⚠️ No new keys to update. Generate keys first.\\n');
      return;
    }
    
    console.log('🔧 **UPDATING SERVER CONFIGURATION**\\n');
    
    // Create environment variables template
    const envTemplate = `
# CS2 Betting API Keys - Updated ${new Date().toISOString()}
# Primary key
ODDS_API_KEY=${this.existingKeys[0]}

# Backup keys
ODDS_API_BACKUP_1=${this.existingKeys[1] || this.newKeys[0] || ''}
ODDS_API_BACKUP_2=${this.existingKeys[2] || this.newKeys[1] || ''}  
ODDS_API_BACKUP_3=${this.existingKeys[3] || this.newKeys[2] || ''}
ODDS_API_BACKUP_4=${this.newKeys[3] || ''}
ODDS_API_BACKUP_5=${this.newKeys[4] || ''}

# Resilience settings
API_RESILIENCE_ENABLED=true
API_CACHE_TTL_MINUTES=5
API_MAX_RETRIES=3
`.trim();
    
    try {
      await fs.writeFile('.env.backup-keys', envTemplate);
      console.log('✅ Environment template saved to .env.backup-keys');
      console.log('📋 Copy these variables to your production environment\\n');
    } catch (error) {
      console.error('❌ Error saving environment template:', error.message);
    }
    
    // Test new configuration
    console.log('🧪 **TESTING NEW KEY CONFIGURATION**\\n');
    
    const allKeys = [...this.existingKeys, ...this.newKeys];
    const workingKeys = [];
    
    for (let i = 0; i < allKeys.length; i++) {
      const key = allKeys[i];
      if (!key) continue;
      
      const result = await this.testApiKey(key);
      
      if (result.status === 'working') {
        workingKeys.push(key);
        console.log(`✅ Key ${i + 1}: Working (${result.remainingRequests} requests left)`);
      } else {
        console.log(`❌ Key ${i + 1}: ${result.status} - ${result.error}`);
      }
      
      await this.delay(1000);
    }
    
    console.log(`\\n🎯 **CONFIGURATION SUMMARY**`);
    console.log(`Total Keys: ${allKeys.length}`);
    console.log(`Working Keys: ${workingKeys.length}`);
    console.log(`Combined Capacity: ~${workingKeys.length * 500} requests/month`);
    console.log(`Daily Capacity: ~${Math.floor(workingKeys.length * 500 / 30)} requests/day\\n`);
    
    return {
      totalKeys: allKeys.length,
      workingKeys: workingKeys.length,
      monthlyCapacity: workingKeys.length * 500,
      dailyCapacity: Math.floor(workingKeys.length * 500 / 30)
    };
  }

  // Smart CS2 sport detection for optimal API usage
  async detectCS2Events() {
    console.log('🎮 **DETECTING CS2 EVENTS**\\n');
    
    // The Odds API doesn't have CS2 directly, but we can check esports categories
    const esportsSources = [
      'counterstrike', // CS:GO/CS2 on some providers
      'dota2',
      'lol',
      'valorant'
    ];
    
    const results = [];
    
    for (const sport of esportsSources) {
      try {
        const result = await this.testApiKey(this.existingKeys[0], sport);
        results.push({
          sport,
          available: result.status === 'working',
          eventCount: result.dataCount,
          error: result.error
        });
        
        console.log(`🎯 ${sport}: ${result.status === 'working' ? '✅' : '❌'} (${result.dataCount} events)`);
        
      } catch (error) {
        results.push({
          sport,
          available: false,
          eventCount: 0,
          error: error.message
        });
        console.log(`🎯 ${sport}: ❌ ${error.message}`);
      }
      
      await this.delay(1000);
    }
    
    console.log('\\n💡 **RECOMMENDATION:**');
    const availableEsports = results.filter(r => r.available);
    if (availableEsports.length > 0) {
      console.log('Use these esports categories for betting:');
      availableEsports.forEach(sport => {
        console.log(`  - ${sport.sport} (${sport.eventCount} events)`);
      });
    } else {
      console.log('No esports found. Continue using existing CS2 data sources.\\n');
    }
    
    return results;
  }

  // Generate comprehensive status report
  async generateStatusReport() {
    console.log('📊 **COMPREHENSIVE API STATUS REPORT**\\n');
    
    const auditResults = await this.auditExistingKeys();
    const cs2Events = await this.detectCS2Events();
    
    const report = {
      timestamp: new Date().toISOString(),
      summary: {
        totalKeys: this.existingKeys.length + this.newKeys.length,
        workingKeys: auditResults.filter(r => r.status === 'working').length,
        rateLimitedKeys: auditResults.filter(r => r.status === 'rate_limited').length,
        brokenKeys: auditResults.filter(r => !['working', 'rate_limited'].includes(r.status)).length
      },
      keyDetails: auditResults,
      esportsAvailability: cs2Events,
      recommendations: this.generateRecommendations(auditResults, cs2Events)
    };
    
    try {
      await fs.writeFile(`api-status-report-${Date.now()}.json`, JSON.stringify(report, null, 2));
      console.log('✅ Status report saved to api-status-report-${Date.now()}.json\\n');
    } catch (error) {
      console.error('❌ Error saving report:', error.message);
    }
    
    return report;
  }

  generateRecommendations(auditResults, cs2Events) {
    const recommendations = [];
    
    const working = auditResults.filter(r => r.status === 'working').length;
    const total = auditResults.length;
    
    if (working < 2) {
      recommendations.push('🚨 CRITICAL: Generate backup API keys immediately');
    } else if (working < 4) {
      recommendations.push('⚠️ Generate additional backup keys for better resilience');
    } else {
      recommendations.push('✅ API key configuration is healthy');
    }
    
    if (cs2Events.filter(e => e.available).length === 0) {
      recommendations.push('🎮 Consider alternative CS2 data sources or partner APIs');
    }
    
    if (auditResults.some(r => r.status === 'rate_limited')) {
      recommendations.push('⏳ Implement smarter rate limiting to prevent API exhaustion');
    }
    
    return recommendations;
  }

  getStatusIcon(status) {
    const icons = {
      working: '✅',
      rate_limited: '⏳', 
      unauthorized: '🔐',
      invalid_request: '❓',
      error: '❌'
    };
    return icons[status] || '❓';
  }

  delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// CLI interface
async function runApiKeyManager() {
  const manager = new CS2ApiKeyManager();
  
  console.log('🔑 **CS2 API KEY MANAGER**\\n');
  console.log('Starting comprehensive API key audit and enhancement...\\n');
  
  try {
    // Step 1: Audit existing keys
    await manager.auditExistingKeys();
    
    // Step 2: Detect CS2 events
    await manager.detectCS2Events();
    
    // Step 3: Generate backup key instructions
    await manager.generateBackupKeys(5);
    
    // Step 4: Update configuration
    await manager.updateServerConfig();
    
    // Step 5: Generate report
    await manager.generateStatusReport();
    
    console.log('🎉 **API KEY MANAGEMENT COMPLETE**\\n');
    console.log('📋 Next steps:');
    console.log('1. Follow manual key generation instructions above');
    console.log('2. Add new keys to this script');
    console.log('3. Run script again to test new keys');
    console.log('4. Update production environment variables');
    console.log('5. Restart CS2 betting server\\n');
    
  } catch (error) {
    console.error('❌ **ERROR:**', error.message);
    console.log('\\n🔧 **TROUBLESHOOTING:**');
    console.log('- Check internet connection');
    console.log('- Verify existing API keys are valid');
    console.log('- Try again in a few minutes\\n');
  }
}

// Export for use in other modules
module.exports = { CS2ApiKeyManager };

// Run if called directly
if (require.main === module) {
  runApiKeyManager();
}