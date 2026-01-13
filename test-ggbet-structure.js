/**
 * Test script to examine GG.bet HTML structure
 */

const axios = require('axios');
const https = require('https');
const cheerio = require('cheerio');
const fs = require('fs');

async function examineStructure() {
  console.log('='.repeat(80));
  console.log('GG.bet HTML Structure Analysis');
  console.log('='.repeat(80));
  console.log('');

  const ggbetUrl = 'https://gg.bet/en-ca?sportId=esports_counter_strike';

  try {
    const response = await axios.get(ggbetUrl, {
      timeout: 15000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
      },
      httpsAgent: new https.Agent({ rejectUnauthorized: true })
    });

    const $ = cheerio.load(response.data);

    // Find sport-event-list
    const sportEventList = $('[data-test="sport-event-list"]');
    console.log(`Found ${sportEventList.length} sport-event-list elements`);
    console.log('');

    if (sportEventList.length > 0) {
      const firstEvent = sportEventList.first();
      const html = firstEvent.html() || '';
      
      console.log(`First sport-event-list HTML length: ${html.length} characters`);
      console.log('');
      
      // Look for all child elements
      const children = firstEvent.children();
      console.log(`Has ${children.length} direct children`);
      console.log('');

      // Look for links (matches)
      const links = firstEvent.find('a[href*="/esports/match/"]');
      console.log(`Found ${links.length} match links`);
      
      if (links.length > 0) {
        console.log('');
        console.log('Sample match links:');
        links.slice(0, 3).each((i, elem) => {
          const href = $(elem).attr('href');
          const text = $(elem).text().trim().substring(0, 100);
          console.log(`  [${i + 1}] ${href}`);
          console.log(`      Text: ${text || '(empty)'}`);
        });
        console.log('');
      }

      // Look for elements that might contain odds
      // Try various selectors
      const selectors = [
        '[data-test*="odd"]',
        '[data-test*="button"]',
        '[title*="odd"]',
        '[class*="odd"]',
        '[class*="button"]',
        'button',
        '.swiper-slide',
        '[data-category*="Line"]'
      ];

      console.log('Searching for odds-related elements...');
      for (const selector of selectors) {
        const elements = firstEvent.find(selector);
        if (elements.length > 0) {
          console.log(`  Found ${elements.length} elements with selector: ${selector}`);
          
          // Show sample element
          if (elements.length > 0) {
            const sample = elements.first();
            const text = sample.text().trim().substring(0, 100);
            const title = sample.attr('title');
            const dataTest = sample.attr('data-test');
            const dataLabel = sample.attr('data-label');
            const dataCategory = sample.attr('data-category');
            
            console.log(`    Sample element:`);
            console.log(`      Text: ${text || '(empty)'}`);
            if (title) console.log(`      Title: ${title}`);
            if (dataTest) console.log(`      data-test: ${dataTest}`);
            if (dataLabel) console.log(`      data-label: ${dataLabel.substring(0, 50)}...`);
            if (dataCategory) console.log(`      data-category: ${dataCategory}`);
          }
          console.log('');
        }
      }

      // Look for decimal numbers near "vs" or team names
      console.log('Looking for odds values near match information...');
      const allText = firstEvent.text();
      const vsMatches = allText.match(/(\w+)\s+vs\s+(\w+)/g);
      if (vsMatches && vsMatches.length > 0) {
        console.log(`  Found ${vsMatches.length} "vs" matches: ${vsMatches.slice(0, 5).join(', ')}`);
        
        // For each vs match, look for nearby decimal numbers
        const decimalPattern = /(\d+\.\d{2,3})/g;
        const allOdds = allText.match(decimalPattern);
        if (allOdds) {
          const uniqueOdds = [...new Set(allOdds)]
            .map(m => parseFloat(m))
            .filter(o => o >= 1.01 && o <= 10.0)
            .sort((a, b) => a - b);
          console.log(`  Found ${uniqueOdds.length} potential odds values: ${uniqueOdds.slice(0, 20).join(', ')}`);
        }
      }
      
      // Save HTML to file for manual inspection (optional)
      // fs.writeFileSync('ggbet-sample.html', html);
    }

    // Also check for elements with title attributes (might be team names)
    const titleElements = $('[title]');
    console.log('');
    console.log(`Found ${titleElements.length} elements with title attributes`);
    
    const titleTexts = new Set();
    titleElements.each((i, elem) => {
      const title = $(elem).attr('title');
      if (title && title.length > 2 && title.length < 50) {
        // Filter out likely team names
        if (!title.includes(' ') || title.split(' ').length <= 3) {
          titleTexts.add(title);
        }
      }
    });
    
    if (titleTexts.size > 0) {
      console.log(`Found ${titleTexts.size} unique title values (potential team names)`);
      const sampleTitles = Array.from(titleTexts).slice(0, 10);
      console.log(`  Sample: ${sampleTitles.join(', ')}`);
    }

  } catch (error) {
    console.error('Error:', error.message);
    console.error(error.stack);
  }

  console.log('');
  console.log('='.repeat(80));
  console.log('Analysis Complete');
  console.log('='.repeat(80));
}

examineStructure().catch(console.error);
