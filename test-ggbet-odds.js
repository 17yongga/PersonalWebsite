/**
 * Test script for GG.bet odds scraper
 * Tests actual HTML fetching and parsing from GG.bet
 */

const axios = require('axios');
const https = require('https');
const cheerio = require('cheerio');

async function testGGbetOdds() {
  console.log('='.repeat(80));
  console.log('GG.bet Odds Scraper Test');
  console.log('='.repeat(80));
  console.log('');

  const ggbetUrl = 'https://gg.bet/en-ca?sportId=esports_counter_strike';
  
  console.log(`Fetching HTML from: ${ggbetUrl}`);
  console.log('');

  try {
    // Fetch HTML from GG.bet
    const response = await axios.get(ggbetUrl, {
      timeout: 15000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        'Accept-Encoding': 'gzip, deflate, br',
        'Connection': 'keep-alive',
        'Upgrade-Insecure-Requests': '1',
        'Sec-Fetch-Dest': 'document',
        'Sec-Fetch-Mode': 'navigate',
        'Sec-Fetch-Site': 'none',
        'Referer': 'https://www.google.com/'
      },
      httpsAgent: new https.Agent({ 
        rejectUnauthorized: true,
        keepAlive: true
      }),
      maxRedirects: 5,
      validateStatus: function (status) {
        return status >= 200 && status < 400;
      }
    });

    console.log(`✓ HTTP ${response.status} - Successfully fetched HTML`);
    console.log(`  HTML length: ${response.data.length} characters`);
    console.log('');

    // Parse HTML with Cheerio
    const $ = cheerio.load(response.data);

    // Look for odd-button elements
    const oddButtons = $('[data-test="odd-button"]');
    console.log(`Found ${oddButtons.length} elements with data-test="odd-button"`);
    console.log('');

    if (oddButtons.length === 0) {
      console.log('⚠ No odd-button elements found!');
      console.log('');
      console.log('Trying alternative selectors...');
      
      // Try other possible selectors
      const altSelectors = [
        '[data-test*="odd"]',
        '[data-test*="button"]',
        '.odd-button',
        '[class*="odd"]',
        '[class*="button"]'
      ];
      
      for (const selector of altSelectors) {
        const elements = $(selector);
        if (elements.length > 0) {
          console.log(`  Found ${elements.length} elements with selector: ${selector}`);
        }
      }
      console.log('');
      
      console.log('Checking if page has any match-related content...');
      const hasMatches = response.data.toLowerCase().includes('match') || 
                         response.data.toLowerCase().includes('team') ||
                         response.data.toLowerCase().includes('vs');
      console.log(`  Contains match/team/vs keywords: ${hasMatches}`);
      console.log('');
      
      // Look for any data-test attributes
      const allDataTest = $('[data-test]');
      console.log(`Found ${allDataTest.length} total elements with data-test attributes`);
      console.log('');
      
      // Collect unique data-test values
      const dataTestValues = new Set();
      allDataTest.each((i, elem) => {
        const testAttr = $(elem).attr('data-test');
        if (testAttr) {
          dataTestValues.add(testAttr);
        }
      });
      
      console.log(`Found ${dataTestValues.size} unique data-test attribute values:`);
      const sortedValues = Array.from(dataTestValues).sort();
      
      // Look for odds-related values
      const oddsRelated = sortedValues.filter(v => 
        v.toLowerCase().includes('odd') || 
        v.toLowerCase().includes('button') ||
        v.toLowerCase().includes('bet') ||
        v.toLowerCase().includes('price') ||
        v.toLowerCase().includes('coefficient')
      );
      
      if (oddsRelated.length > 0) {
        console.log('');
        console.log('Odds-related data-test attributes:');
        oddsRelated.forEach(attr => {
          const count = allDataTest.filter(`[data-test="${attr}"]`).length;
          console.log(`  - data-test="${attr}" (${count} elements)`);
        });
      }
      
      // Look for match/sport/event related attributes
      const matchRelated = sortedValues.filter(v => 
        v.toLowerCase().includes('match') || 
        v.toLowerCase().includes('sport') ||
        v.toLowerCase().includes('event') ||
        v.toLowerCase().includes('team') ||
        v.toLowerCase().includes('outcome') ||
        v.toLowerCase().includes('market')
      );
      
      if (matchRelated.length > 0) {
        console.log('');
        console.log('Match/Sport/Event-related data-test attributes:');
        matchRelated.forEach(attr => {
          const count = allDataTest.filter(`[data-test="${attr}"]`).length;
          console.log(`  - data-test="${attr}" (${count} elements)`);
        });
      }
      
      // Show first 30 unique values
      console.log('');
      console.log('All unique data-test values (first 30):');
      sortedValues.slice(0, 30).forEach(attr => {
        const count = allDataTest.filter(`[data-test="${attr}"]`).length;
        console.log(`  - data-test="${attr}" (${count} elements)`);
      });
      
      // Try to find elements that might contain odds
      console.log('');
      console.log('Searching for decimal odds patterns in HTML...');
      const decimalPattern = /(\d+\.\d{2,3})/g;
      const oddsMatches = response.data.match(decimalPattern);
      if (oddsMatches) {
        const uniqueOdds = [...new Set(oddsMatches)]
          .map(m => parseFloat(m))
          .filter(o => o >= 1.01 && o <= 10.0)
          .sort((a, b) => a - b)
          .slice(0, 20);
        console.log(`  Found ${uniqueOdds.length} potential odds values: ${uniqueOdds.join(', ')}`);
      }
      
      // Check if content is loaded via JavaScript (look for script tags with odds data)
      console.log('');
      console.log('Checking for JavaScript-rendered content...');
      const scriptTags = $('script').length;
      console.log(`  Found ${scriptTags} script tags`);
      
      // Look for JSON data in script tags
      const scripts = $('script').toArray();
      let foundJSON = false;
      for (let i = 0; i < Math.min(scripts.length, 20); i++) {
        const scriptContent = $(scripts[i]).html() || '';
        if (scriptContent.includes('odds') || scriptContent.includes('coefficient') || 
            scriptContent.includes('price') || scriptContent.includes('match')) {
          console.log(`  Script tag ${i + 1} contains odds/match-related content`);
          foundJSON = true;
          
          // Try to find JSON structure
          const jsonMatch = scriptContent.match(/\{[^{}]*"odds"[^{}]*\}/);
          if (jsonMatch) {
            console.log(`    Sample JSON: ${jsonMatch[0].substring(0, 200)}...`);
          }
        }
      }
      
      if (!foundJSON) {
        console.log('  No obvious JSON data found in script tags');
      }
      
      console.log('');
      
      return;
    }

    // Extract sample data from first few odd buttons
    console.log('Extracting sample data from odd-button elements:');
    console.log('');

    const sampleOdds = [];
    oddButtons.slice(0, 10).each((index, element) => {
      const $button = $(element);
      
      // Get team name
      const title = $button.attr('title') || '';
      const titleElement = $button.find('[data-test="odd-button_title"]');
      const teamName = title || titleElement.text().trim();
      
      // Get odds
      const resultElement = $button.find('[data-test="odd-button_result"]');
      const oddsText = resultElement.text().trim();
      const odds = parseFloat(oddsText);
      
      // Get other attributes for debugging
      const dataLabel = $button.attr('data-label') || '';
      const buttonText = $button.text().substring(0, 50).trim();
      
      if (teamName && !isNaN(odds) && odds >= 1.01 && odds <= 10.0) {
        sampleOdds.push({
          teamName,
          odds,
          dataLabel: dataLabel.substring(0, 30)
        });
        
        console.log(`  [${index + 1}] Team: "${teamName}" | Odds: ${odds}`);
        if (title) {
          console.log(`      Title attribute: "${title}"`);
        }
        if (dataLabel) {
          console.log(`      Data-label: "${dataLabel.substring(0, 50)}..."`);
        }
      } else {
        console.log(`  [${index + 1}] Invalid or incomplete data:`);
        console.log(`      Team name: "${teamName}"`);
        console.log(`      Odds text: "${oddsText}"`);
        console.log(`      Parsed odds: ${isNaN(odds) ? 'NaN' : odds}`);
      }
    });

    console.log('');
    console.log(`✓ Successfully extracted ${sampleOdds.length} valid odds entries`);
    console.log('');

    // Try to match a sample team
    if (sampleOdds.length > 0) {
      console.log('Testing team name matching...');
      const testTeam1 = sampleOdds[0].teamName;
      const testTeam2 = sampleOdds.length > 1 ? sampleOdds[1].teamName : 'Unknown';
      
      console.log(`  Sample match: ${testTeam1} vs ${testTeam2}`);
      console.log('');
      
      // Test our parsing function
      const gamblingScraper = require('./cs2-gambling-scraper');
      const result = await gamblingScraper.scrapeGGbetOdds(testTeam1, testTeam2);
      
      if (result && result.team1 && result.team2) {
        console.log('✓ Successfully retrieved odds using scraper:');
        console.log(`  ${testTeam1}: ${result.team1}`);
        console.log(`  ${testTeam2}: ${result.team2}`);
      } else {
        console.log('⚠ Scraper returned null or incomplete data');
      }
    }

  } catch (error) {
    console.error('❌ Error:', error.message);
    if (error.response) {
      console.error(`  HTTP Status: ${error.response.status}`);
      console.error(`  Status Text: ${error.response.statusText}`);
      if (error.response.status === 403) {
        console.error('  GG.bet returned 403 Forbidden - may be blocking requests');
      }
    }
    console.error('');
    console.error('Stack trace:');
    console.error(error.stack);
  }

  console.log('');
  console.log('='.repeat(80));
  console.log('Test Complete');
  console.log('='.repeat(80));
}

// Run the test
testGGbetOdds().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
