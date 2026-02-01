/**
 * Update missing IEM Krakow matches with realistic odds from multi-source provider
 */

const fs = require('fs').promises;
const path = require('path');
const multiSourceOdds = require('./cs2-multi-source-odds');

async function updateMissingMatches() {
  try {
    console.log('Loading CS2 betting data...');
    
    // Load current betting data
    const bettingDataPath = path.join(__dirname, 'cs2-betting-data.json');
    const data = await fs.readFile(bettingDataPath, 'utf8');
    const bettingData = JSON.parse(data);
    
    console.log(`Found ${Object.keys(bettingData.events).length} existing events`);
    
    // Find IEM Krakow matches that are missing odds
    const iemMatches = Object.entries(bettingData.events)
      .filter(([id, event]) => {
        return event.tournamentName === 'Intel Extreme Masters Krakow' &&
               event.status === 'scheduled' &&
               (!event.odds?.team1 || !event.odds?.team2);
      });
    
    console.log(`Found ${iemMatches.length} IEM Krakow matches missing odds:`);
    
    let updatedCount = 0;
    
    for (const [eventId, event] of iemMatches) {
      const team1 = event.homeTeam || event.participant1Name;
      const team2 = event.awayTeam || event.participant2Name;
      
      console.log(`\nUpdating: ${team1} vs ${team2} (${eventId})`);
      
      try {
        // Get realistic odds using the multi-source provider
        const oddsResult = await multiSourceOdds.fetchMultiSourceOdds({
          team1: team1,
          team2: team2,
          homeTeam: team1,
          awayTeam: team2,
          participant1Name: team1,
          participant2Name: team2,
          tournamentName: event.tournamentName,
          fixtureId: eventId,
          startTime: event.startTime
        });
        
        if (oddsResult && (oddsResult.team1 || oddsResult.team2)) {
          // Update the event with new odds
          bettingData.events[eventId].odds = {
            team1: oddsResult.team1,
            team2: oddsResult.team2,
            draw: oddsResult.draw || null
          };
          
          bettingData.events[eventId].hasOdds = true;
          bettingData.events[eventId].lastOddsUpdate = new Date().toISOString();
          
          // Add metadata about odds source
          bettingData.events[eventId].oddsMetadata = {
            sources: oddsResult.sources,
            confidence: oddsResult.confidence,
            sourceCount: oddsResult.sourceCount || 0,
            fallback: oddsResult.fallback || false,
            rankData: oddsResult.rankData
          };
          
          console.log(`  ✅ Updated odds: ${oddsResult.team1} / ${oddsResult.team2}`);
          console.log(`     Sources: ${oddsResult.sources.join(', ')}`);
          console.log(`     Confidence: ${oddsResult.confidence}`);
          
          if (oddsResult.rankData) {
            console.log(`     Team ranks: ${oddsResult.rankData.team1Rank} vs ${oddsResult.rankData.team2Rank}`);
          }
          
          updatedCount++;
        } else {
          console.log(`  ❌ Failed to get odds`);
        }
      } catch (error) {
        console.log(`  ❌ Error: ${error.message}`);
      }
      
      // Wait a bit between requests
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    
    // Update last sync timestamp
    bettingData.lastApiSync = new Date().toISOString();
    bettingData.lastApiQuery = new Date().toISOString();
    
    // Save updated data
    await fs.writeFile(bettingDataPath, JSON.stringify(bettingData, null, 2), 'utf8');
    
    console.log(`\n✅ Successfully updated ${updatedCount} matches with odds`);
    console.log(`📁 Updated betting data saved to: ${bettingDataPath}`);
    
    // Show final summary
    console.log('\nFinal summary of IEM Krakow matches:');
    console.log('='.repeat(60));
    
    const finalIemMatches = Object.entries(bettingData.events)
      .filter(([id, event]) => {
        return event.tournamentName === 'Intel Extreme Masters Krakow' &&
               event.status === 'scheduled';
      })
      .sort((a, b) => new Date(a[1].startTime) - new Date(b[1].startTime));
    
    finalIemMatches.forEach(([id, event]) => {
      const team1 = event.homeTeam || event.participant1Name;
      const team2 = event.awayTeam || event.participant2Name;
      const startTime = new Date(event.startTime).toLocaleString();
      const hasOdds = !!(event.odds?.team1 && event.odds?.team2);
      
      console.log(`${hasOdds ? '✅' : '❌'} ${team1} vs ${team2}`);
      console.log(`   Time: ${startTime}`);
      
      if (hasOdds) {
        console.log(`   Odds: ${event.odds.team1} / ${event.odds.team2}`);
        if (event.oddsMetadata?.rankData) {
          console.log(`   Ranks: ${event.oddsMetadata.rankData.team1Rank} vs ${event.oddsMetadata.rankData.team2Rank}`);
        }
      }
      console.log('');
    });
    
  } catch (error) {
    console.error('Error updating missing matches:', error.message);
    console.error(error.stack);
  }
}

// Run the update
updateMissingMatches();