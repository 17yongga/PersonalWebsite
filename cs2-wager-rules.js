'use strict';

const CS2_PARLAY_MIN_LEGS = 2;
const CS2_PARLAY_MAX_LEGS = 8;
const CS2_PARLAY_MAX_ODDS = 100;
const CS2_MAX_PAYOUT = 1_000_000;

function roundOdds(value) {
  return Math.round((Number(value) + Number.EPSILON) * 1000) / 1000;
}

function combinedOdds(legs) {
  if (!Array.isArray(legs) || legs.length === 0) throw new TypeError('At least one leg is required');
  const product = legs.reduce((total, leg) => {
    const odds = Number(leg?.odds);
    if (!Number.isFinite(odds) || odds <= 1 || odds > 100) throw new RangeError('Every leg requires valid odds');
    return total * odds;
  }, 1);
  return roundOdds(product);
}

function validateParlayLegs(legs) {
  if (!Array.isArray(legs) || legs.length < CS2_PARLAY_MIN_LEGS || legs.length > CS2_PARLAY_MAX_LEGS) {
    throw new RangeError(`Parlays require ${CS2_PARLAY_MIN_LEGS}-${CS2_PARLAY_MAX_LEGS} legs`);
  }
  const eventIds = new Set();
  for (const leg of legs) {
    if (!leg?.eventId || !['team1', 'team2', 'draw'].includes(leg.selection)) throw new TypeError('Every parlay leg requires an event and valid selection');
    if (eventIds.has(leg.eventId)) throw new RangeError('A parlay can contain only one selection per match');
    eventIds.add(leg.eventId);
  }
  const odds = combinedOdds(legs);
  if (odds > CS2_PARLAY_MAX_ODDS) throw new RangeError(`Combined parlay odds cannot exceed ${CS2_PARLAY_MAX_ODDS}`);
  return odds;
}

function potentialPayout(amount, odds) {
  if (!Number.isSafeInteger(amount) || amount < 1) throw new RangeError('Stake must be a positive whole number');
  const payout = Math.round(amount * odds);
  if (payout > CS2_MAX_PAYOUT) throw new RangeError(`Potential payout cannot exceed ${CS2_MAX_PAYOUT} credits`);
  return payout;
}

function legResult(leg, outcome) {
  if (!outcome || (outcome.status !== 'cancelled' && !outcome.winner)) return { ...leg, status: 'pending', result: null };
  if (outcome.status === 'cancelled') return { ...leg, status: 'void', result: 'void' };
  const won = leg.selection === outcome.winner;
  return { ...leg, status: won ? 'won' : 'lost', result: won ? 'win' : 'loss' };
}

function evaluateWager(wager, outcomes = {}) {
  const storedLegs = Array.isArray(wager?.legs) && wager.legs.length
    ? wager.legs
    : [{
        eventId: wager.eventId,
        selection: wager.selection,
        selectionName: wager.selectionName,
        homeTeam: wager.homeTeam,
        awayTeam: wager.awayTeam,
        odds: wager.odds
      }];
  const legs = storedLegs.map(leg => legResult(leg, outcomes[leg.eventId]));
  if (legs.some(leg => leg.status === 'lost')) return { status: 'lost', result: 'loss', payout: 0, effectiveOdds: 0, legs };
  if (legs.some(leg => leg.status === 'pending')) return { status: 'pending', result: null, payout: null, effectiveOdds: null, legs };
  const wonLegs = legs.filter(leg => leg.status === 'won');
  if (wonLegs.length === 0) return { status: 'void', result: 'void', payout: wager.amount, effectiveOdds: 1, legs };
  const effectiveOdds = combinedOdds(wonLegs);
  return {
    status: 'won',
    result: 'win',
    payout: potentialPayout(wager.amount, effectiveOdds),
    effectiveOdds,
    legs
  };
}

module.exports = {
  CS2_PARLAY_MIN_LEGS,
  CS2_PARLAY_MAX_LEGS,
  CS2_PARLAY_MAX_ODDS,
  CS2_MAX_PAYOUT,
  roundOdds,
  combinedOdds,
  validateParlayLegs,
  potentialPayout,
  evaluateWager
};
