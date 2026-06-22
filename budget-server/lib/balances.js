function roundMoney(value) {
  return Math.round((Number(value || 0) + Number.EPSILON) * 100) / 100;
}

function toDateOnly(value) {
  return String(value || '').split('T')[0];
}

function getMemberId(member) {
  return Number(member.user_id ?? member.id);
}

function createBalanceMap(members) {
  const balances = new Map();
  for (const member of members || []) {
    const id = getMemberId(member);
    if (Number.isFinite(id)) balances.set(id, 0);
  }
  return balances;
}

function ensureBalanceSlot(balances, userId) {
  const id = Number(userId);
  if (!Number.isFinite(id)) return;
  if (!balances.has(id)) balances.set(id, 0);
}

function normalizePercent(value) {
  const pct = Number(value);
  if (!Number.isFinite(pct) || pct < 0 || pct > 100) {
    throw new Error(`Invalid custom split percentage: ${value}`);
  }
  return pct / 100;
}

function calculateExpenseBalances({ members, expenses }) {
  const memberIds = (members || []).map(getMemberId).filter(Number.isFinite);
  const balances = createBalanceMap(members);

  if (memberIds.length <= 1) return balances;

  for (const expense of expenses || []) {
    if (Number(expense.is_shared) !== 1) continue;

    const amount = Number(expense.amount);
    if (!Number.isFinite(amount) || amount <= 0) continue;

    const payerId = Number(expense.paid_by);
    ensureBalanceSlot(balances, payerId);

    const explicitSplits = expense.split_scope === 'all_participants'
      ? []
      : Array.isArray(expense.split_details)
        ? expense.split_details.filter((split) => Number.isFinite(Number(split.user_id)) && Number(split.share_amount) > 0)
        : [];

    if (explicitSplits.length > 0) {
      balances.set(payerId, (balances.get(payerId) || 0) + amount);
      for (const split of explicitSplits) {
        const participantId = Number(split.user_id);
        const shareAmount = Number(split.share_amount);
        ensureBalanceSlot(balances, participantId);
        balances.set(participantId, (balances.get(participantId) || 0) - shareAmount);
      }
      continue;
    }

    const participatingMemberIds = memberIds.includes(payerId)
      ? memberIds
      : Array.from(new Set([...memberIds, payerId]));

    const memberCount = participatingMemberIds.length;
    if (memberCount <= 1) continue;

    let payerShare;
    let otherShare;

    if (expense.split_type === 'custom' && expense.custom_split != null) {
      const payerPct = normalizePercent(expense.custom_split);
      payerShare = amount * payerPct;
      otherShare = (amount - payerShare) / (memberCount - 1);
    } else {
      payerShare = amount / memberCount;
      otherShare = amount / memberCount;
    }

    balances.set(payerId, (balances.get(payerId) || 0) + amount - payerShare);

    for (const memberId of participatingMemberIds) {
      if (memberId === payerId) continue;
      ensureBalanceSlot(balances, memberId);
      balances.set(memberId, (balances.get(memberId) || 0) - otherShare);
    }
  }

  return balances;
}

function isDirectionalSettlement(settlement) {
  return settlement.from_user_id != null && settlement.to_user_id != null;
}

function applySettlementBalances({ balances, settlements }) {
  for (const settlement of settlements || []) {
    if (!isDirectionalSettlement(settlement)) continue;

    const amount = Number(settlement.amount);
    if (!Number.isFinite(amount) || amount <= 0) continue;

    const fromId = Number(settlement.from_user_id);
    const toId = Number(settlement.to_user_id);
    if (!Number.isFinite(fromId) || !Number.isFinite(toId) || fromId === toId) continue;

    ensureBalanceSlot(balances, fromId);
    ensureBalanceSlot(balances, toId);

    // from_user_id is the debtor paying the creditor, so the debtor's negative
    // balance moves upward and the creditor's positive balance moves downward.
    balances.set(fromId, (balances.get(fromId) || 0) + amount);
    balances.set(toId, (balances.get(toId) || 0) - amount);
  }
  return balances;
}

function getLegacyCutoffDate(settlements) {
  const legacyDates = (settlements || [])
    .filter((settlement) => !isDirectionalSettlement(settlement))
    .map((settlement) => toDateOnly(settlement.date || settlement.created_at))
    .filter(Boolean)
    .sort();
  return legacyDates.length ? legacyDates[legacyDates.length - 1] : null;
}

function calculateHouseholdBalance({ members, expenses, settlements, legacyMode = 'cutoff' }) {
  const legacyCutoffDate = legacyMode === 'cutoff' ? getLegacyCutoffDate(settlements) : null;

  const scopedExpenses = legacyCutoffDate
    ? (expenses || []).filter((expense) => toDateOnly(expense.date) >= legacyCutoffDate)
    : (expenses || []);

  const scopedSettlements = legacyCutoffDate
    ? (settlements || []).filter((settlement) => {
        if (!isDirectionalSettlement(settlement)) return false;
        return toDateOnly(settlement.date || settlement.created_at) >= legacyCutoffDate;
      })
    : (settlements || []);

  const balances = calculateExpenseBalances({ members, expenses: scopedExpenses });
  applySettlementBalances({ balances, settlements: scopedSettlements });

  const rounded = new Map();
  for (const [userId, value] of balances.entries()) {
    rounded.set(userId, roundMoney(value));
  }

  return {
    balances: rounded,
    legacyCutoffDate,
    legacySettlementCount: (settlements || []).filter((settlement) => !isDirectionalSettlement(settlement)).length,
  };
}

function addDirectPairDebt(pairNetCents, debtorId, creditorId, cents) {
  const fromId = Number(debtorId);
  const toId = Number(creditorId);
  const amountCents = Number(cents);
  if (!Number.isFinite(fromId) || !Number.isFinite(toId) || fromId === toId) return;
  if (!Number.isFinite(amountCents) || amountCents === 0) return;

  const lowId = Math.min(fromId, toId);
  const highId = Math.max(fromId, toId);
  const key = `${lowId}:${highId}`;
  const signedCents = amountCents * (fromId === lowId ? 1 : -1);
  pairNetCents.set(key, (pairNetCents.get(key) || 0) + signedCents);
}

function buildAllParticipantSplitRows(expense, memberIds) {
  const payerId = Number(expense.paid_by);
  const participantIds = Array.from(new Set(Number.isInteger(payerId) ? [...memberIds, payerId] : memberIds));
  if (participantIds.length < 2) return [];

  const totalCents = Math.round(Number(expense.amount || 0) * 100);
  if (!Number.isFinite(totalCents) || totalCents <= 0) return [];

  const baseCents = Math.floor(totalCents / participantIds.length);
  let remainder = totalCents - baseCents * participantIds.length;
  return participantIds.map((userId) => {
    const extra = remainder > 0 ? 1 : 0;
    if (remainder > 0) remainder -= 1;
    return { user_id: userId, share_amount: roundMoney((baseCents + extra) / 100) };
  });
}

function getExpenseSplitRowsForDirectSettlement(expense, memberIds) {
  if (expense.split_scope === 'all_participants') return buildAllParticipantSplitRows(expense, memberIds);
  return Array.isArray(expense.split_details) ? expense.split_details : [];
}

function suggestDirectSettlements({ members = [], expenses = [], settlements = [] }) {
  const memberIds = (members || []).map(getMemberId).filter(Number.isInteger);
  const memberById = new Map((members || []).map((member) => [getMemberId(member), member]));
  const legacyCutoffDate = getLegacyCutoffDate(settlements);
  const pairNetCents = new Map();

  for (const expense of expenses || []) {
    if (Number(expense.is_shared) !== 1) continue;
    if (legacyCutoffDate && toDateOnly(expense.date) < legacyCutoffDate) continue;

    const payerId = Number(expense.paid_by);
    if (!Number.isFinite(payerId)) continue;

    const splitRows = getExpenseSplitRowsForDirectSettlement(expense, memberIds);
    for (const split of splitRows) {
      const debtorId = Number(split.user_id);
      const shareAmount = Number(split.share_amount);
      if (!Number.isFinite(debtorId) || !Number.isFinite(shareAmount)) continue;
      if (debtorId === payerId || shareAmount <= 0) continue;
      addDirectPairDebt(pairNetCents, debtorId, payerId, Math.round(shareAmount * 100));
    }
  }

  for (const settlement of settlements || []) {
    if (!isDirectionalSettlement(settlement)) continue;
    if (legacyCutoffDate && toDateOnly(settlement.date || settlement.created_at) < legacyCutoffDate) continue;

    const fromId = Number(settlement.from_user_id);
    const toId = Number(settlement.to_user_id);
    const amount = Number(settlement.amount);
    if (!Number.isFinite(fromId) || !Number.isFinite(toId) || !Number.isFinite(amount) || amount <= 0) continue;

    addDirectPairDebt(pairNetCents, fromId, toId, -Math.round(amount * 100));
  }

  const rows = [];
  for (const [key, netCents] of pairNetCents.entries()) {
    const amount = roundMoney(Math.abs(netCents) / 100);
    if (amount <= 0.01) continue;

    const [lowId, highId] = key.split(':').map(Number);
    const fromUserId = netCents > 0 ? lowId : highId;
    const toUserId = netCents > 0 ? highId : lowId;
    const fromMember = memberById.get(fromUserId) || {};
    const toMember = memberById.get(toUserId) || {};
    rows.push({
      from_user_id: fromUserId,
      from_name: fromMember.name || fromMember.partner_name || `User ${fromUserId}`,
      from_etransfer_email: fromMember.etransfer_email || null,
      to_user_id: toUserId,
      to_name: toMember.name || toMember.partner_name || `User ${toUserId}`,
      to_etransfer_email: toMember.etransfer_email || null,
      amount,
    });
  }

  return rows.sort((a, b) => b.amount - a.amount || a.from_user_id - b.from_user_id || a.to_user_id - b.to_user_id);
}

function suggestSettlements({ balances, members = [] }) {
  const memberById = new Map((members || []).map((member) => [getMemberId(member), member]));
  const creditors = [];
  const debtors = [];

  for (const [userId, rawBalance] of balances.entries()) {
    const balance = roundMoney(rawBalance);
    if (balance > 0.01) creditors.push({ userId, amount: balance });
    if (balance < -0.01) debtors.push({ userId, amount: -balance });
  }

  creditors.sort((a, b) => b.amount - a.amount);
  debtors.sort((a, b) => b.amount - a.amount);

  const settlements = [];
  let debtorIndex = 0;
  let creditorIndex = 0;

  while (debtorIndex < debtors.length && creditorIndex < creditors.length) {
    const debtor = debtors[debtorIndex];
    const creditor = creditors[creditorIndex];
    const amount = roundMoney(Math.min(debtor.amount, creditor.amount));

    if (amount > 0.01) {
      const fromMember = memberById.get(debtor.userId) || {};
      const toMember = memberById.get(creditor.userId) || {};
      settlements.push({
        from_user_id: debtor.userId,
        from_name: fromMember.name || fromMember.partner_name || `User ${debtor.userId}`,
        from_etransfer_email: fromMember.etransfer_email || null,
        to_user_id: creditor.userId,
        to_name: toMember.name || toMember.partner_name || `User ${creditor.userId}`,
        to_etransfer_email: toMember.etransfer_email || null,
        amount,
      });
    }

    debtor.amount = roundMoney(debtor.amount - amount);
    creditor.amount = roundMoney(creditor.amount - amount);

    if (debtor.amount <= 0.01) debtorIndex += 1;
    if (creditor.amount <= 0.01) creditorIndex += 1;
  }

  return settlements;
}

function serializeBalances({ balances, members = [] }) {
  const memberById = new Map((members || []).map((member) => [getMemberId(member), member]));
  return Array.from(balances.entries())
    .map(([userId, net]) => {
      const member = memberById.get(userId) || {};
      return {
        user_id: userId,
        name: member.name || member.partner_name || `User ${userId}`,
        email: member.email || null,
        net: roundMoney(net),
      };
    })
    .sort((a, b) => a.user_id - b.user_id);
}

function buildBalanceSnapshot({ members, expenses, settlements }) {
  const result = calculateHouseholdBalance({ members, expenses, settlements });
  return {
    balances: serializeBalances({ balances: result.balances, members }),
    suggested_settlements: suggestSettlements({ balances: result.balances, members }),
    direct_settlements: suggestDirectSettlements({ members, expenses, settlements }),
    legacy_cutoff_date: result.legacyCutoffDate,
    legacy_settlement_count: result.legacySettlementCount,
  };
}

module.exports = {
  roundMoney,
  calculateExpenseBalances,
  applySettlementBalances,
  calculateHouseholdBalance,
  suggestSettlements,
  suggestDirectSettlements,
  serializeBalances,
  buildBalanceSnapshot,
};
