/**
 * Test script to extract odds from GG.bet JSON data in script tags
 */

const axios = require('axios');
const https = require('https');
const cheerio = require('cheerio');

async function extractGGbetJSON() {
  console.log('='.repeat(80));
  console.log('GG.bet JSON Data Extraction Test');
  console.log('='.repeat(80));
  console.log('');

  const ggbetUrl = 'https://gg.bet/en-ca?sportId=esports_counter_strike';

  try {
    const response = await axios.get(ggbetUrl, {
      timeout: 15000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9'
      },
      httpsAgent: new https.Agent({ rejectUnauthorized: true })
    });

    const $ = cheerio.load(response.data);
    const scripts = $('script').toArray();

    console.log(`Found ${scripts.length} script tags`);
    console.log('');

    // Look for __NEXT_DATA__ or window.__INITIAL_STATE__ or similar
    let foundData = false;

    for (let i = 0; i < scripts.length; i++) {
      const scriptContent = $(scripts[i]).html() || '';
      
      // Check for common Next.js/React data patterns
      if (scriptContent.includes('__NEXT_DATA__') || 
          scriptContent.includes('__INITIAL_STATE__') ||
          scriptContent.includes('window.__') ||
          scriptContent.includes('"events"') ||
          scriptContent.includes('"matches"')) {
        
        console.log(`Script tag ${i + 1} contains potential match data`);
        console.log(`  Length: ${scriptContent.length} characters`);
        console.log('');

        // Try to extract JSON
        try {
          // Look for JSON object patterns
          let jsonData = null;
          
          // Try to find __NEXT_DATA__ pattern
          const nextDataMatch = scriptContent.match(/__NEXT_DATA__\s*=\s*({.+?});/s);
          if (nextDataMatch) {
            jsonData = JSON.parse(nextDataMatch[1]);
            console.log('  Found __NEXT_DATA__');
          } else {
            // Try to find standalone JSON
            const jsonMatch = scriptContent.match(/\{[\s\S]{100,}/);
            if (jsonMatch) {
              try {
                jsonData = JSON.parse(jsonMatch[0]);
                console.log('  Found standalone JSON');
              } catch (e) {
                // Not valid JSON, continue
              }
            }
          }

          if (jsonData) {
            // Try to find matches/odds in the JSON
            const jsonString = JSON.stringify(jsonData);
            
            // Look for odds-related keys
            if (jsonString.includes('odds') || jsonString.includes('coefficient') || 
                jsonString.includes('price') || jsonString.includes('match')) {
              console.log('  JSON contains odds/match data!');
              
              // Try to extract sample data
              const sampleOdds = jsonString.match(/"odds?":\s*(\d+\.\d+)/g);
              if (sampleOdds) {
                console.log(`  Found ${sampleOdds.length} odds references`);
                console.log(`  Sample: ${sampleOdds.slice(0, 5).join(', ')}`);
              }
              
              // Look for team names
              const teamMatches = jsonString.match(/"team[12]?[_\s]?name":\s*"([^"]+)"/gi);
              if (teamMatches) {
                console.log(`  Found team name references: ${teamMatches.length}`);
                console.log(`  Sample: ${teamMatches.slice(0, 3).join(', ')}`);
              }
              
              foundData = true;
            }
          }
        } catch (error) {
          console.log(`  Error parsing JSON: ${error.message}`);
        }
        
        console.log('');
      }
    }

    if (!foundData) {
      console.log('Could not find JSON data structure with odds');
      console.log('');
      console.log('Note: GG.bet likely uses client-side JavaScript to render odds.');
      console.log('The odd-button elements may only exist after JavaScript execution.');
      console.log('Consider using Puppeteer to render the page.');
    }

    // Check for sport-event-list and see what's inside
    console.log('Checking sport-event-list element...');
    const sportEventList = $('[data-test="sport-event-list"]');
    if (sportEventList.length > 0) {
      console.log(`  Found sport-event-list with ${sportEventList.children().length} children`);
      const html = sportEventList.html() || '';
      console.log(`  HTML length: ${html.length} characters`);
      
      if (html.length > 0) {
        // Look for odds in the HTML
        const oddsInHTML = html.match(/(\d+\.\d{2,3})/g);
        if (oddsInHTML) {
          const uniqueOdds = [...new Set(oddsInHTML)]
            .map(m => parseFloat(m))
            .filter(o => o >= 1.01 && o <= 10.0)
            .slice(0, 10);
          console.log(`  Found ${uniqueOdds.length} potential odds values in HTML: ${uniqueOdds.join(', ')}`);
        }
      }
    }

  } catch (error) {
    console.error('Error:', error.message);
  }

  console.log('');
  console.log('='.repeat(80));
}

extractGGbetJSON().catch(console.error);
