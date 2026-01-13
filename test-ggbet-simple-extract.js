/**
 * Simple test to extract odds from GG.bet using visible HTML text
 */

const axios = require('axios');
const https = require('https');
const cheerio = require('cheerio');

async function simpleExtract() {
  const ggbetUrl = 'https://gg.bet/en-ca?sportId=esports_counter_strike';

  try {
    const response = await axios.get(ggbetUrl, {
      timeout: 15000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      },
      httpsAgent: new https.Agent({ rejectUnauthorized: true })
    });

    const $ = cheerio.load(response.data);
    
    // Find all match containers
    const eventList = $('[data-test="sport-event-list"]');
    
    if (eventList.length === 0) {
      console.log('No sport-event-list found');
      return;
    }

    const matches = [];
    
    // Find all match links
    eventList.find('a[href*="/esports/match/"]').each((i, elem) => {
      const $link = $(elem);
      const href = $link.attr('href');
      const text = $link.text();
      
      // Extract team names from href or text
      const matchId = href.match(/match\/([^\/]+)/);
      if (matchId) {
        const parts = matchId[1].split('-vs-');
        if (parts.length === 2) {
          const team1 = parts[0].replace(/-/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
          const team2 = parts[1].split('-')[0].replace(/-/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
          
          // Look for odds near this link
          const context = $link.closest('[data-test*="event"]') || $link.parent().parent();
          const contextText = context.text() || '';
          
          // Find decimal numbers near team names
          const decimalPattern = /(\d+\.\d{2,3})/g;
          const oddsMatches = contextText.match(decimalPattern);
          
          if (oddsMatches) {
            const odds = oddsMatches
              .map(m => parseFloat(m))
              .filter(o => o >= 1.01 && o <= 10.0)
              .slice(0, 2);
            
            if (odds.length === 2) {
              matches.push({
                team1,
                team2,
                href,
                odds: {
                  team1: odds[0],
                  team2: odds[1]
                }
              });
            }
          }
        }
      }
    });

    console.log(`Found ${matches.length} matches with odds:`);
    console.log('');
    
    matches.slice(0, 5).forEach((match, i) => {
      console.log(`[${i + 1}] ${match.team1} vs ${match.team2}`);
      console.log(`    Odds: ${match.odds.team1} / ${match.odds.team2}`);
      console.log(`    Link: ${match.href}`);
      console.log('');
    });

    // Test with a specific match
    if (matches.length > 0) {
      const testMatch = matches[0];
      console.log('Testing with scraper...');
      
      const gamblingScraper = require('./cs2-gambling-scraper');
      const result = await gamblingScraper.scrapeGGbetOdds(testMatch.team1, testMatch.team2);
      
      if (result && result.team1 && result.team2) {
        console.log('✓ Successfully retrieved odds:');
        console.log(`  ${testMatch.team1}: ${result.team1}`);
        console.log(`  ${testMatch.team2}: ${result.team2}`);
      } else {
        console.log('✗ Scraper returned null');
      }
    }

  } catch (error) {
    console.error('Error:', error.message);
  }
}

simpleExtract().catch(console.error);
