/**
 * GG.bet Odds Scraper
 * Scrapes CS2 match odds from GG.bet using data-test attributes
 * 
 * Note: This is for fantasy betting only, not real gambling
 * Respects rate limits and robots.txt
 */

const axios = require('axios');
const https = require('https');
const config = require('./cs2-odds-config');

// Optional cheerio for HTML parsing
let cheerio = null;
try {
  cheerio = require('cheerio');
} catch (error) {
  // Cheerio not installed - will use regex parsing
  console.log('[Gambling Scraper] Cheerio not available, using regex parsing');
}

// Optional puppeteer for JavaScript-rendered sites
let puppeteer = null;
try {
  puppeteer = require('puppeteer');
} catch (error) {
  // Puppeteer not installed - that's OK, we can still scrape static sites
  console.log('[Gambling Scraper] Puppeteer not available (optional dependency)');
}

/**
 * Scrape odds from a generic betting site (GG.bet only)
 * @param {string} siteName - Site name (should be 'ggbet')
 * @param {string} team1Name - First team name
 * @param {string} team2Name - Second team name
 * @returns {Promise<Object|null>} Odds object or null
 */
async function scrapeGenericSiteOdds(siteName, team1Name, team2Name) {
  switch (siteName.toLowerCase()) {
    case 'ggbet':
      return await scrapeGGbetOdds(team1Name, team2Name);
    default:
      console.warn(`[Gambling Scraper] Unknown or unsupported site: ${siteName}`);
      return null;
  }
}

/**
 * Get odds from all enabled gambling sites
 * @param {Object} matchInfo - Match information
 * @param {string} matchInfo.team1 - First team name
 * @param {string} matchInfo.team2 - Second team name
 * @param {string} matchInfo.homeTeam - Home team name (alternative)
 * @param {string} matchInfo.awayTeam - Away team name (alternative)
 * @returns {Promise<Array>} Array of odds objects from different sites
 */
async function getAllGamblingOdds(matchInfo) {
  const { team1, team2, homeTeam, awayTeam } = matchInfo;
  const team1Name = team1 || homeTeam;
  const team2Name = team2 || awayTeam;
  
  if (!team1Name || !team2Name) {
    return [];
  }
  
  const gamblingConfig = config.sources.gambling;
  if (!gamblingConfig.enabled) {
    return [];
  }
  
  const results = [];
  const sites = Object.keys(gamblingConfig.sites);
  
  // Fetch from all enabled sites sequentially (with delays to respect rate limits)
  for (let i = 0; i < sites.length; i++) {
    const siteName = sites[i];
    const siteConfig = gamblingConfig.sites[siteName];
    
    if (!siteConfig || !siteConfig.enabled) {
      continue;
    }
    
    // Respect rate limit
    if (i > 0) {
      await new Promise(resolve => setTimeout(resolve, siteConfig.rateLimit || 2000));
    }
    
    try {
      const odds = await scrapeGenericSiteOdds(siteName, team1Name, team2Name);
      if (odds) {
        results.push(odds);
        // If we got odds from one source, we can continue to try others for aggregation
        // but we have at least one source now
      }
    } catch (error) {
      if (error.response) {
        const status = error.response.status;
        if (status === 403) {
          console.warn(`[Gambling Scraper] ${siteName} returned 403 Forbidden - may be blocking requests`);
        } else if (status === 429) {
          console.warn(`[Gambling Scraper] ${siteName} returned 429 Too Many Requests - rate limited`);
        } else {
          console.error(`[Gambling Scraper] ${siteName} HTTP ${status} error:`, error.message);
        }
      } else {
        console.error(`[Gambling Scraper] Error fetching from ${siteName}:`, error.message);
      }
      // Continue with other sites
    }
  }
  
  return results;
}

/**
 * Get best odds from gambling sites (highest priority or first available)
 * @param {Object} matchInfo - Match information
 * @returns {Promise<Object|null>} Best odds object or null
 */
async function getGamblingOdds(matchInfo) {
  const allOdds = await getAllGamblingOdds(matchInfo);
  
  if (allOdds.length === 0) {
    return null;
  }
  
  // Return first available odds (can be enhanced to pick best)
  // For aggregation, we'll return all, but for single source, return first
  return allOdds[0];
}

/**
 * Scrape odds from GG.bet
 * Uses Puppeteer for JavaScript rendering if available, falls back to static HTML parsing
 * @param {string} team1Name - First team name
 * @param {string} team2Name - Second team name
 * @returns {Promise<Object|null>} Odds object or null
 */
async function scrapeGGbetOdds(team1Name, team2Name) {
  try {
    const siteConfig = config.sources.gambling.sites.ggbet;
    if (!siteConfig || !siteConfig.enabled) {
      return null;
    }

    console.log(`[Gambling Scraper] Attempting to fetch GG.bet odds for ${team1Name} vs ${team2Name}`);
    
    // GG.bet CS2 esports page
    const esportsUrl = `${siteConfig.baseUrl}/en-ca?sportId=esports_counter_strike`;
    
    let html = null;
    
    // Try Puppeteer first if available (for JavaScript-rendered content)
    if (puppeteer) {
      try {
        console.log(`[Gambling Scraper] Using Puppeteer to render JavaScript content...`);
        const browser = await puppeteer.launch({ 
          headless: "new",
          args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
        });
        const page = await browser.newPage();
        
        // Set user agent and viewport
        await page.setUserAgent(config.userAgent);
        await page.setViewport({ width: 1920, height: 1080 });
        
        // Navigate to page with longer timeout
        const navigationTimeout = Math.min(config.sources.gambling.timeout, 20000); // Max 20 seconds
        await page.goto(esportsUrl, { 
          waitUntil: 'domcontentloaded', // Faster than networkidle2
          timeout: navigationTimeout 
        });
        
        // Wait a bit for JavaScript to execute
        await page.waitForTimeout(2000);
        
        // Wait for sport-event-list to appear (indicates page loaded)
        try {
          await page.waitForSelector('[data-test="sport-event-list"]', { timeout: 5000 });
          console.log(`[Gambling Scraper] ✓ Page content loaded`);
        } catch (waitError) {
          console.warn(`[Gambling Scraper] sport-event-list not found, continuing anyway...`);
        }
        
        // Wait for odd-button elements to appear (they're rendered by JavaScript)
        try {
          await page.waitForSelector('[data-test="odd-button"]', { timeout: 8000 });
          console.log(`[Gambling Scraper] ✓ Found odd-button elements after JavaScript rendering`);
        } catch (waitError) {
          console.warn(`[Gambling Scraper] odd-button elements not found after waiting, but page may still have content...`);
          // Wait a bit more for lazy loading
          await page.waitForTimeout(2000);
        }
        
        // Get the rendered HTML
        html = await page.content();
        await browser.close();
        
        console.log(`[Gambling Scraper] ✓ Successfully rendered page with Puppeteer (${html.length} characters)`);
      } catch (puppeteerError) {
        console.warn(`[Gambling Scraper] Puppeteer failed: ${puppeteerError.message}, falling back to static HTML`);
        // Fall through to static HTML parsing
      }
    }
    
    // Fallback to static HTML if Puppeteer not available or failed
    if (!html) {
      try {
        console.log(`[Gambling Scraper] Fetching static HTML (JavaScript-rendered content may not be available)...`);
        const response = await axios.get(esportsUrl, {
          timeout: config.sources.gambling.timeout,
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

        if (response.status !== 200) {
          return null;
        }

        html = response.data;
      } catch (error) {
        if (error.response) {
          const status = error.response.status;
          if (status === 403) {
            console.warn(`[Gambling Scraper] GG.bet returned 403 Forbidden`);
          } else {
            console.error(`[Gambling Scraper] GG.bet HTTP ${status} error:`, error.message);
          }
        } else {
          console.error(`[Gambling Scraper] GG.bet error:`, error.message);
        }
        return null;
      }
    }
    
    // Parse the HTML (whether from Puppeteer or static)
    const odds = parseGGbetOdds(html, team1Name, team2Name);
    
    if (odds && (odds.team1 || odds.team2)) {
      console.log(`[Gambling Scraper] ✓ Found GG.bet odds: team1=${odds.team1}, team2=${odds.team2}`);
      return {
        team1: odds.team1,
        team2: odds.team2,
        draw: odds.draw || null,
        source: 'ggbet',
        timestamp: new Date().toISOString()
      };
    }
    
    return null;
  } catch (error) {
    console.error(`[Gambling Scraper] Error scraping GG.bet:`, error.message);
    return null;
  }
}

/**
 * Parse GG.bet HTML to extract odds using data-test attributes
 * Based on GG.bet HTML structure: data-test="odd-button", data-test="odd-button_title", data-test="odd-button_result"
 * @param {string} html - HTML content
 * @param {string} team1Name - First team name
 * @param {string} team2Name - Second team name
 * @returns {Object|null} Parsed odds or null
 */
function parseGGbetOdds(html, team1Name, team2Name) {
  try {
    if (!cheerio) {
      console.warn(`[Gambling Scraper] Cheerio not available, cannot parse GG.bet HTML reliably`);
      return null;
    }
    
    const $ = cheerio.load(html);
    
    // Normalize team names for matching
    const normalizeName = (name) => {
      return name.toLowerCase()
        .replace(/[^a-z0-9\s]/g, '') // Keep spaces, remove special chars
        .replace(/\s+/g, ' ') // Normalize whitespace
        .trim();
    };
    
    const normalizedTeam1 = normalizeName(team1Name);
    const normalizedTeam2 = normalizeName(team2Name);
    
    // Find all odd-button elements using data-test attribute
    const oddButtons = $('[data-test="odd-button"]');
    
    if (oddButtons.length === 0) {
      console.warn(`[Gambling Scraper] No odd-button elements found in GG.bet HTML`);
      return null;
    }
    
    console.log(`[Gambling Scraper] Found ${oddButtons.length} odd-button elements`);
    
    let team1Odds = null;
    let team2Odds = null;
    let team1Found = false;
    let team2Found = false;
    
    // Extract team names and odds from each button
    oddButtons.each((index, element) => {
      const $button = $(element);
      
      // Try to get team name from title attribute first, then from odd-button_title
      let scrapedTeamName = $button.attr('title') || '';
      if (!scrapedTeamName || scrapedTeamName.trim() === '') {
        const titleElement = $button.find('[data-test="odd-button_title"]');
        if (titleElement.length > 0) {
          scrapedTeamName = titleElement.text().trim();
        }
      }
      
      if (!scrapedTeamName) {
        return; // Skip if no team name found
      }
      
      // Get odds value from odd-button_result
      const resultElement = $button.find('[data-test="odd-button_result"]');
      if (resultElement.length === 0) {
        return; // Skip if no odds found
      }
      
      const oddsText = resultElement.text().trim();
      const odds = parseFloat(oddsText);
      
      if (isNaN(odds) || odds < 1.01 || odds > 10.0) {
        console.warn(`[Gambling Scraper] Invalid odds value: ${oddsText} for team: ${scrapedTeamName}`);
        return; // Skip invalid odds
      }
      
      // Normalize scraped team name for comparison
      const normalizedScraped = normalizeName(scrapedTeamName);
      
      // Try to match with input team names (fuzzy matching)
      // Check for exact normalized match first
      if (normalizedScraped === normalizedTeam1 || 
          normalizedScraped.includes(normalizedTeam1) || 
          normalizedTeam1.includes(normalizedScraped)) {
        if (!team1Found) {
          team1Odds = odds;
          team1Found = true;
          console.log(`[Gambling Scraper] ✓ Matched team1: "${scrapedTeamName}" (normalized: "${normalizedScraped}") with odds ${odds}`);
        }
      } else if (normalizedScraped === normalizedTeam2 || 
                 normalizedScraped.includes(normalizedTeam2) || 
                 normalizedTeam2.includes(normalizedScraped)) {
        if (!team2Found) {
          team2Odds = odds;
          team2Found = true;
          console.log(`[Gambling Scraper] ✓ Matched team2: "${scrapedTeamName}" (normalized: "${normalizedScraped}") with odds ${odds}`);
        }
      }
    });
    
    // If we found both teams, return the odds
    if (team1Found && team2Found) {
      return {
        team1: team1Odds,
        team2: team2Odds,
        draw: null
      };
    }
    
    // If only one team found, log warning
    if (team1Found || team2Found) {
      console.warn(`[Gambling Scraper] Only found odds for one team: team1=${team1Odds}, team2=${team2Odds}`);
      console.warn(`[Gambling Scraper] Searched for: "${team1Name}" (normalized: "${normalizedTeam1}") and "${team2Name}" (normalized: "${normalizedTeam2}")`);
    } else {
      console.warn(`[Gambling Scraper] Could not match team names. Searched for: "${team1Name}" and "${team2Name}"`);
    }
    
    return null;
  } catch (error) {
    console.error(`[Gambling Scraper] Error parsing GG.bet HTML:`, error.message);
    return null;
  }
}

/**
 * Scrape odds from a generic betting site (GG.bet only)
 * @param {string} siteName - Site name (should be 'ggbet')
 * @param {string} team1Name - First team name
 * @param {string} team2Name - Second team name
 * @returns {Promise<Object|null>} Odds object or null
 */
async function scrapeGenericSiteOdds(siteName, team1Name, team2Name) {
  switch (siteName.toLowerCase()) {
    case 'ggbet':
      return await scrapeGGbetOdds(team1Name, team2Name);
    default:
      console.warn(`[Gambling Scraper] Unknown or unsupported site: ${siteName}`);
      return null;
  }
}

module.exports = {
  getGamblingOdds,
  getAllGamblingOdds,
  scrapeGGbetOdds
};
