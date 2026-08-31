'use strict';

const crypto = require('node:crypto');

function finite(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function timestamp(value) {
  const parsed = typeof value === 'number' ? value : Date.parse(value || '');
  return Number.isFinite(parsed) ? parsed : 0;
}

function newestFirst(a, b) {
  return timestamp(b.settledAt || b.updatedAt || b.placedAt || b.createdAt)
    - timestamp(a.settledAt || a.updatedAt || a.placedAt || a.createdAt);
}

function isoTimestamp(value) {
  const parsed = timestamp(value);
  return parsed ? new Date(parsed).toISOString() : null;
}

function settlementStatus(escrow, wager) {
  if (escrow.status === 'active') return 'pending';
  if (escrow.status === 'refunded') return 'void';
  if (escrow.status === 'settled') return finite(escrow.payout) > 0 ? 'won' : 'lost';
  return ['won', 'lost', 'void'].includes(wager?.status) ? wager.status : 'unavailable';
}

function enrichWager(wager, escrow, events) {
  const event = wager?.eventId ? events[wager.eventId] : null;
  const canonicalStatus = settlementStatus(escrow, wager);
  const homeTeam = wager?.homeTeam || event?.homeTeam || event?.participant1Name || 'Unknown';
  const awayTeam = wager?.awayTeam || event?.awayTeam || event?.participant2Name || 'Unknown';
  const selectionName = wager?.selectionName || (wager?.selection === 'team1' ? homeTeam : wager?.selection === 'team2' ? awayTeam : wager?.selection === 'draw' ? 'Draw' : 'Unavailable');
  const amount = finite(escrow.stake, finite(wager?.amount));
  const odds = finite(wager?.odds, 1);
  return {
    ...(wager || {}),
    id: wager?.id || escrow.referenceId,
    type: wager?.type || escrow.metadata?.wagerType || 'single',
    homeTeam,
    awayTeam,
    selectionName,
    amount,
    odds,
    potentialPayout: finite(wager?.potentialPayout, amount * odds),
    status: canonicalStatus,
    escrowId: escrow.escrowId,
    escrowStatus: escrow.status,
    placedAt: wager?.placedAt || isoTimestamp(escrow.createdAt),
    settledAt: canonicalStatus === 'pending' ? null : (wager?.settledAt || isoTimestamp(escrow.updatedAt || escrow.createdAt))
  };
}

function enrichLegacyWager(wager, events) {
  const event = wager?.eventId ? events[wager.eventId] : null;
  const homeTeam = wager?.homeTeam || event?.homeTeam || event?.participant1Name || 'Unknown';
  const awayTeam = wager?.awayTeam || event?.awayTeam || event?.participant2Name || 'Unknown';
  const selectionName = wager?.selectionName || (wager?.selection === 'team1' ? homeTeam : wager?.selection === 'team2' ? awayTeam : wager?.selection === 'draw' ? 'Draw' : 'Unavailable');
  const amount = finite(wager?.amount);
  const odds = finite(wager?.odds, 1);
  return {
    ...wager,
    homeTeam,
    awayTeam,
    selectionName,
    amount,
    odds,
    potentialPayout: finite(wager?.potentialPayout, amount * odds),
    integrityStatus: 'legacy'
  };
}

function buildCS2Portfolio({ userId, bets = [], escrows = [], events = {}, now = Date.now(), lastSettlementCheck = null }) {
  const wagers = bets.filter(bet => bet?.userId === userId);
  const monetary = escrows.filter(escrow => escrow?.userId === userId && escrow?.game === 'cs2betting');
  const wagersById = new Map(wagers.map(wager => [wager.id, wager]));
  const escrowsByReference = new Map(monetary.map(escrow => [escrow.referenceId, escrow]));
  const issues = [];
  const openBets = [];
  const history = [];

  for (const wager of wagers) {
    const escrow = escrowsByReference.get(wager.id);
    if (!escrow) {
      if (['won', 'lost', 'void'].includes(wager.status)) {
        history.push(enrichLegacyWager(wager, events));
        continue;
      }
      issues.push({ code: 'wager_missing_escrow', wagerId: wager.id, message: 'Wager record has no canonical monetary escrow' });
      continue;
    }
    const item = enrichWager(wager, escrow, events);
    if (Math.abs(finite(wager.amount) - finite(escrow.stake)) > 0.0005) {
      item.integrityStatus = 'unavailable';
      issues.push({ code: 'stake_mismatch', wagerId: wager.id, escrowId: escrow.escrowId, message: 'Wager stake differs from canonical escrow stake' });
    }
    if (wager.escrowId && wager.escrowId !== escrow.escrowId) {
      item.integrityStatus = 'unavailable';
      issues.push({ code: 'escrow_id_mismatch', wagerId: wager.id, escrowId: escrow.escrowId, message: 'Wager points at a different escrow identifier' });
    }
    (escrow.status === 'active' ? openBets : history).push(item);
  }

  for (const escrow of monetary) {
    if (wagersById.has(escrow.referenceId)) continue;
    issues.push({ code: 'escrow_missing_wager', escrowId: escrow.escrowId, referenceId: escrow.referenceId, message: 'Canonical monetary escrow has no wager record' });
    const synthetic = enrichWager(null, escrow, events);
    synthetic.integrityStatus = 'unavailable';
    synthetic.selectionName = 'Wager details unavailable';
    (escrow.status === 'active' ? openBets : history).push(synthetic);
  }

  openBets.sort(newestFirst);
  history.sort(newestFirst);
  const today = new Date(now).toISOString().slice(0, 10);
  const todayHistory = history.filter(item => String(item.settledAt || '').slice(0, 10) === today);
  const summary = {
    openCount: openBets.length,
    historyCount: history.length,
    openStake: openBets.reduce((sum, item) => sum + finite(item.amount), 0),
    potentialReturn: openBets.reduce((sum, item) => sum + finite(item.potentialPayout), 0),
    todayWins: todayHistory.filter(item => item.status === 'won').length,
    todayLosses: todayHistory.filter(item => item.status === 'lost').length
  };
  const integrity = { ok: issues.length === 0, state: issues.length ? 'error' : 'ok', issueCount: issues.length, issues };
  const revisionInput = { openBets, history, summary, integrity };
  const revision = crypto.createHash('sha256').update(JSON.stringify(revisionInput)).digest('hex').slice(0, 16);

  return {
    openBets,
    history,
    bets: [...openBets, ...history],
    summary,
    integrity,
    freshness: {
      generatedAt: new Date(now).toISOString(),
      lastSettlementCheck: lastSettlementCheck || null
    },
    revision
  };
}

module.exports = { buildCS2Portfolio };
