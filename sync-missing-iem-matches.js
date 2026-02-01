/**
 * Sync missing IEM Krakow matches from API cache to betting data with realistic odds
 */

const fs = require('fs').promises;
const path = require('path');
const multiSourceOdds = require('./cs2-multi-source-odds');

async function syncMissingIEMMatches() {
  try {
    console.log('Loading API cache and betting data...');
    
    // Load API cache
    const cacheDataPath = path.join(__dirname, 'cs2-api-cache.json');
    const cacheData = JSON.parse(await fs.readFile(cacheDataPath, 'utf8'));
    
    // Load current betting data
    const bettingDataPath = path.join(__dirname, 'cs2-betting-data.json');
    const bettingData = JSON.parse(await fs.readFile(bettingDataPath, 'utf8'));
    
    console.log(`API Cache has ${cacheData.matches.data.length} matches`);
    console.log(`Betting data has ${Object.keys(bettingData.events).length} events`);
    
    // Find IEM Krakow matches in cache that are missing from betting data
    const iemMatches = cacheData.matches.data.filter(match => {
      return match.tournamentName === 'Intel Extreme Masters Krakow' &&
             match.status === 'scheduled' &&
             new Date(match.startTime) > new Date(); // Only future matches
    });
    
    console.log(`\nFound ${iemMatches.length} IEM Krakow matches in cache:`);
    
    let addedCount = 0;
    let updatedCount = 0;
    
    for (const match of iemMatches) {
      const eventId = match.fixtureId || match.id;
      const team1 = match.homeTeam || match.participant1Name;
      const team2 = match.awayTeam || match.participant2Name;
      const startTime = new Date(match.startTime).toLocaleString();
      
      console.log(`\n${team1} vs ${team2} (${startTime})`);
      console.log(`  Event ID: ${eventId}`);
      
      // Check if event exists in betting data
      const existingEvent = bettingData.events[eventId];
      
      if (existingEvent) {
        console.log(`  📋 Event exists in betting data`);
        
        // Check if it needs odds update
        if (!existingEvent.odds?.team1 || !existingEvent.odds?.team2) {
          console.log(`  🎯 Updating odds...`);
          
          try {
            const oddsResult = await multiSourceOdds.fetchMultiSourceOdds({
              team1: team1,
              team2: team2,
              homeTeam: team1,
              awayTeam: team2,
              participant1Name: team1,
              participant2Name: team2,
              tournamentName: match.tournamentName,
              fixtureId: eventId,
              startTime: match.startTime
            });
            
            if (oddsResult && (oddsResult.team1 || oddsResult.team2)) {
              existingEvent.odds = {
                team1: oddsResult.team1,
                team2: oddsResult.team2,
                draw: oddsResult.draw || null
              };
              
              existingEvent.hasOdds = true;
              existingEvent.lastOddsUpdate = new Date().toISOString();
              
              existingEvent.oddsMetadata = {
                sources: oddsResult.sources,
                confidence: oddsResult.confidence,
                sourceCount: oddsResult.sourceCount || 0,
                fallback: oddsResult.fallback || false,
                rankData: oddsResult.rankData
              };
              
              console.log(`     ✅ Updated: ${oddsResult.team1} / ${oddsResult.team2}`);
              console.log(`     Sources: ${oddsResult.sources.join(', ')}`);
              if (oddsResult.rankData) {
                console.log(`     Ranks: ${oddsResult.rankData.team1Rank} vs ${oddsResult.rankData.team2Rank}`);
              }
              
              updatedCount++;
            } else {
              console.log(`     ❌ Failed to get odds`);
            }
          } catch (error) {
            console.log(`     ❌ Error: ${error.message}`);
          }
        } else {
          console.log(`  ✅ Already has odds: ${existingEvent.odds.team1} / ${existingEvent.odds.team2}`);
        }
      } else {
        console.log(`  ➕ Adding new event to betting data...`);
        
        try {
          // Get odds for the new event
          const oddsResult = await multiSourceOdds.fetchMultiSourceOdds({
            team1: team1,
            team2: team2,
            homeTeam: team1,
            awayTeam: team2,
            participant1Name: team1,
            participant2Name: team2,
            tournamentName: match.tournamentName,
            fixtureId: eventId,
            startTime: match.startTime
          });
          
          // Create new event with odds
          const newEvent = {
            id: eventId,
            fixtureId: eventId,
            sportId: match.sportId || 17,
            sportName: match.sportName || 'ESport Counter-Strike',
            sportKey: match.sportKey || 'ESport Counter-Strike',
            sportTitle: match.sportTitle || 'ESport Counter-Strike',
            tournamentId: match.tournamentId || 50238,
            tournamentName: match.tournamentName,
            commenceTime: match.commenceTime || match.startTime,
            startTime: match.startTime,
            homeTeam: team1,
            awayTeam: team2,
            participant1Name: team1,
            participant2Name: team2,
            odds: {
              team1: oddsResult?.team1 || null,
              team2: oddsResult?.team2 || null,
              draw: oddsResult?.draw || null
            },
            status: match.status || 'scheduled',
            statusId: match.statusId || 0,
            completed: match.completed || false,
            hasOdds: !!(oddsResult?.team1 && oddsResult?.team2),
            lastUpdate: new Date().toISOString(),
            lastOddsUpdate: oddsResult ? new Date().toISOString() : null
          };
          
          if (oddsResult) {
            newEvent.oddsMetadata = {
              sources: oddsResult.sources,
              confidence: oddsResult.confidence,
              sourceCount: oddsResult.sourceCount || 0,
              fallback: oddsResult.fallback || false,
              rankData: oddsResult.rankData
            };
          }
          
          // Add to betting data
          bettingData.events[eventId] = newEvent;
          
          console.log(`     ✅ Added with odds: ${newEvent.odds.team1} / ${newEvent.odds.team2}`);
          if (oddsResult?.sources) {
            console.log(`     Sources: ${oddsResult.sources.join(', ')}`);
          }
          if (oddsResult?.rankData) {
            console.log(`     Ranks: ${oddsResult.rankData.team1Rank} vs ${oddsResult.rankData.team2Rank}`);
          }
          
          addedCount++;
        } catch (error) {
          console.log(`     ❌ Error: ${error.message}`);
        }
      }
      
      // Wait between requests
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    
    // Update sync timestamps
    bettingData.lastApiSync = new Date().toISOString();
    bettingData.lastApiQuery = new Date().toISOString();
    
    // Save updated betting data
    await fs.writeFile(bettingDataPath, JSON.stringify(bettingData, null, 2), 'utf8');
    
    console.log(`\n${'='.repeat(60)}`);
    console.log(`✅ Sync complete!`);
    console.log(`   Added: ${addedCount} new events`);
    console.log(`   Updated: ${updatedCount} existing events`);
    console.log(`   Total IEM Krakow events: ${Object.values(bettingData.events).filter(e => e.tournamentName === 'Intel Extreme Masters Krakow' && e.status === 'scheduled').length}`);
    
    // Show final summary of all upcoming IEM matches
    console.log(`\nUpcoming IEM Krakow matches with odds:`);
    console.log('='.repeat(60));
    
    const upcomingMatches = Object.values(bettingData.events)
      .filter(event => {
        return event.tournamentName === 'Intel Extreme Masters Krakow' &&
               event.status === 'scheduled' &&
               new Date(event.startTime) > new Date();
      })
      .sort((a, b) => new Date(a.startTime) - new Date(b.startTime));
    
    upcomingMatches.forEach(event => {
      const team1 = event.homeTeam || event.participant1Name;
      const team2 = event.awayTeam || event.participant2Name;
      const startTime = new Date(event.startTime).toLocaleString();
      const hasOdds = !!(event.odds?.team1 && event.odds?.team2);
      
      console.log(`${hasOdds ? '✅' : '❌'} ${team1} vs ${team2}`);
      console.log(`   🕒 ${startTime}`);
      
      if (hasOdds) {
        console.log(`   💰 ${event.odds.team1} / ${event.odds.team2}`);
        if (event.oddsMetadata?.rankData) {
          console.log(`   🏆 Ranks: ${event.oddsMetadata.rankData.team1Rank} vs ${event.oddsMetadata.rankData.team2Rank}`);
        }
      } else {
        console.log(`   ⚠️  No odds available`);
      }
      console.log('');
    });
    
    console.log(`🎯 All ${upcomingMatches.length} upcoming IEM Krakow matches are now available for betting!`);
    
  } catch (error) {
    console.error('Error syncing missing IEM matches:', error.message);
    console.error(error.stack);
  }
}

// Run the sync
syncMissingIEMMatches();