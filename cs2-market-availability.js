'use strict';

const CS2_LIVE_ODDS_MAX_AGE_MS = 20 * 60 * 1000;
const CS2_PREMATCH_ODDS_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const CLOCK_SKEW_TOLERANCE_MS = 5 * 60 * 1000;

function observedRecently(event, now, maxAge) {
  const observedAt = Date.parse(event?.oddsUpdatedAt || '');
  const age = now - observedAt;
  return Number.isFinite(observedAt) && age >= -CLOCK_SKEW_TOLERANCE_MS && age <= maxAge;
}

function pausedMarketReason(event, now) {
  const observedAt = Date.parse(event?.oddsUpdatedAt || '');
  if (!Number.isFinite(observedAt)) return 'Market paused · bookmaker has not published odds';
  const ageMinutes = Math.max(0, Math.floor((now - observedAt) / 60_000));
  return `Market paused · odds last updated ${ageMinutes} min ago`;
}

function getCS2BettingAvailability(event, now = Date.now()) {
  const odds = event?.odds || {};
  const validOdds = Number.isFinite(Number(odds.team1)) && Number(odds.team1) > 1 &&
    Number.isFinite(Number(odds.team2)) && Number(odds.team2) > 1;
  if (!validOdds) return { bettingStatus: 'suspended', oddsFresh: false, reason: 'Market paused · provider has no current odds' };

  if (event.status === 'scheduled') {
    const fresh = event.oddsSource === 'bo3gg-prematch' && observedRecently(event, now, CS2_PREMATCH_ODDS_MAX_AGE_MS);
    return fresh
      ? { bettingStatus: 'open', oddsFresh: true, reason: null }
      : { bettingStatus: 'suspended', oddsFresh: false, reason: pausedMarketReason(event, now) };
  }

  if (event.status !== 'live') return { bettingStatus: 'closed', oddsFresh: false, reason: 'Match is not open' };
  const fresh = event.oddsSource === 'bo3gg-live' && observedRecently(event, now, CS2_LIVE_ODDS_MAX_AGE_MS);
  return fresh
    ? { bettingStatus: 'open', oddsFresh: true, reason: null }
    : { bettingStatus: 'suspended', oddsFresh: false, reason: pausedMarketReason(event, now) };
}

module.exports = { CS2_LIVE_ODDS_MAX_AGE_MS, CS2_PREMATCH_ODDS_MAX_AGE_MS, getCS2BettingAvailability };
