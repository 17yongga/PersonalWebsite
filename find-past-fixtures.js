/**
 * Helper script to find past CS2 fixtures for settlement testing
 */

const cs2ApiClient = require('./cs2-api-client');

async function findPastFixtures() {
  console.log('\n' + '='.repeat(80));
  console.log('Finding Past CS2 Fixtures for Settlement Testing');
  console.log('='.repeat(80) + '\n');
  
  try {
    // Fetch recent fixtures (may include past ones)
    console.log('📡 Fetching recent CS2 fixtures...');
    const matches = await cs2ApiClient.fetchUpcomingMatches({ limit: 50 });
    
    if (!matches || matches.length === 0) {
      console.log('⚠️  No fixtures found');
      return [];
    }
    
    console.log(`✅ Found ${matches.length} fixture(s)\n`);
    
    // Check which ones are finished
    const finishedFixtures = [];
    
    for (const match of matches) {
      const fixtureId = match.fixtureId || match.id;
      if (!fixtureId) continue;
      
      console.log(`\n🔍 Checking fixture: ${fixtureId}`);
      console.log(`   Teams: ${match.homeTeam || match.participant1Name} vs ${match.awayTeam || match.participant2Name}`);
      console.log(`   Start Time: ${match.startTime || match.commenceTime || 'N/A'}`);
      
      // Check if match is finished by trying to get settlement
      try {
        const result = await cs2ApiClient.fetchMatchResults(fixtureId);
        
        if (result && result.completed) {
          console.log(`   ✅ FINISHED - Winner: ${result.winner}, Score: ${result.participant1Score || 'N/A'}-${result.participant2Score || 'N/A'}`);
          finishedFixtures.push({
            fixtureId: fixtureId,
            match: match,
            result: result
          });
        } else {
          console.log(`   ⏳ Not finished yet`);
        }
        
        // Rate limiting
        await new Promise(resolve => setTimeout(resolve, 600));
        
      } catch (error) {
        console.log(`   ⚠️  Error checking: ${error.message}`);
      }
    }
    
    console.log(`\n${'='.repeat(80)}`);
    console.log(`Summary: Found ${finishedFixtures.length} finished fixture(s)`);
    console.log('='.repeat(80) + '\n');
    
    if (finishedFixtures.length > 0) {
      console.log('✅ Finished fixtures that can be used for settlement testing:\n');
      finishedFixtures.forEach((fixture, index) => {
        console.log(`${index + 1}. ${fixture.fixtureId}`);
        console.log(`   Teams: ${fixture.match.homeTeam || fixture.match.participant1Name} vs ${fixture.match.awayTeam || fixture.match.participant2Name}`);
        console.log(`   Winner: ${fixture.result.winner}`);
        console.log(`   Score: ${fixture.result.participant1Score || 'N/A'}-${fixture.result.participant2Score || 'N/A'}\n`);
      });
      
      console.log('\nTo test settlement with these fixtures, run:');
      console.log(`node test-settlement-api.js ${finishedFixtures.map(f => f.fixtureId).join(' ')}\n`);
    }
    
    return finishedFixtures;
    
  } catch (error) {
    console.error('❌ Error finding past fixtures:', error);
    console.error(error.stack);
    return [];
  }
}

if (require.main === module) {
  findPastFixtures().catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
}

module.exports = { findPastFixtures };
