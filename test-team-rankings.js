const multiSource = require('./cs2-multi-source-odds');

const testTeams = [
  'Pain Gaming',
  'Aurora Gaming', 
  'BC.Game eSports',
  'Ninjas In Pyjamas',
  'Team Liquid',
  'Fut eSports'
];

console.log('Testing team ranking lookup:');
console.log('='.repeat(50));

testTeams.forEach(team => {
  const rank = multiSource.getTeamRank(team);
  console.log(`${team.padEnd(20)} → Rank ${rank || 'NOT FOUND'}`);
});

console.log('\nTesting ranking-based odds calculation:');
console.log('='.repeat(50));

const testMatches = [
  { team1: 'Pain Gaming', team2: 'Aurora Gaming' },
  { team1: 'BC.Game eSports', team2: 'Ninjas In Pyjamas' },
  { team1: 'Fut eSports', team2: 'Team Liquid' }
];

testMatches.forEach(match => {
  const odds = multiSource.calculateRankingBasedOdds(match.team1, match.team2);
  console.log(`\n${match.team1} vs ${match.team2}:`);
  console.log(`  Odds: ${odds.team1} / ${odds.team2}`);
  console.log(`  Ranks: ${odds.team1Rank} vs ${odds.team2Rank}`);
  console.log(`  Rank difference: ${odds.rankDiff}`);
  console.log(`  Confidence: ${odds.confidence}`);
});