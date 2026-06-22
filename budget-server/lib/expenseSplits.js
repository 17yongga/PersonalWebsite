function roundMoney(value) {
  return Math.round((Number(value || 0) + Number.EPSILON) * 100) / 100;
}

function getMemberIds(members) {
  return new Set((members || []).map((member) => Number(member.user_id ?? member.id)).filter(Number.isFinite));
}

function normalizeParticipantIds(participantIds, members, { minCount = 2 } = {}) {
  const memberIds = getMemberIds(members);
  const normalized = [];
  const seen = new Set();

  for (const rawId of participantIds || []) {
    const userId = Number(rawId);
    if (!Number.isInteger(userId) || userId <= 0 || !memberIds.has(userId)) {
      throw new Error('split participants must belong to this budget space');
    }
    if (!seen.has(userId)) {
      seen.add(userId);
      normalized.push(userId);
    }
  }

  if (normalized.length < minCount) {
    throw new Error('shared expenses require at least two participants');
  }

  return normalized;
}

function validateExpenseParticipants({ isShared, relationshipType, participantIds, members }) {
  if (!isShared) return [];

  const allMemberIds = (members || [])
    .map((member) => Number(member.user_id ?? member.id))
    .filter(Number.isInteger);

  if (!participantIds || participantIds.length === 0) {
    if (relationshipType === 'solo') return [];
    return normalizeParticipantIds(allMemberIds, members);
  }

  return normalizeParticipantIds(participantIds, members);
}

function buildEqualSplitRows({ expenseId, amount, participantIds }) {
  const ids = (participantIds || []).map(Number).filter(Number.isInteger);
  if (ids.length < 2) {
    throw new Error('shared expenses require at least two participants');
  }

  const totalCents = Math.round(Number(amount) * 100);
  if (!Number.isFinite(totalCents) || totalCents <= 0) {
    throw new Error('amount must be greater than 0');
  }

  const baseCents = Math.floor(totalCents / ids.length);
  let remainder = totalCents - baseCents * ids.length;

  return ids.map((userId) => {
    const extra = remainder > 0 ? 1 : 0;
    if (remainder > 0) remainder -= 1;
    const shareCents = baseCents + extra;
    const shareAmount = roundMoney(shareCents / 100);
    const sharePercent = roundMoney((shareAmount / Number(amount)) * 100);
    return {
      expense_id: Number(expenseId),
      user_id: userId,
      share_amount: shareAmount,
      share_percent: sharePercent,
    };
  });
}

function buildCustomSplitRows({ expenseId, amount, payerId, participantIds, payerPercent }) {
  const ids = (participantIds || []).map(Number).filter(Number.isInteger);
  const payer = Number(payerId);
  if (ids.length < 2) {
    throw new Error('shared expenses require at least two participants');
  }
  if (!ids.includes(payer)) {
    throw new Error('paidBy must be included in custom split participants');
  }

  const totalCents = Math.round(Number(amount) * 100);
  if (!Number.isFinite(totalCents) || totalCents <= 0) {
    throw new Error('amount must be greater than 0');
  }
  const payerPct = Number(payerPercent);
  if (!Number.isFinite(payerPct) || payerPct <= 0 || payerPct >= 100) {
    throw new Error('customSplit must be between 1 and 99');
  }

  const payerShareCents = Math.round(totalCents * (payerPct / 100));
  const nonPayerIds = ids.filter((userId) => userId !== payer);
  const baseCents = Math.floor((totalCents - payerShareCents) / nonPayerIds.length);
  let remainder = totalCents - payerShareCents - baseCents * nonPayerIds.length;

  return ids.map((userId) => {
    let shareCents;
    if (userId === payer) {
      shareCents = payerShareCents;
    } else {
      const extra = remainder > 0 ? 1 : 0;
      if (remainder > 0) remainder -= 1;
      shareCents = baseCents + extra;
    }
    const shareAmount = roundMoney(shareCents / 100);
    return {
      expense_id: Number(expenseId),
      user_id: userId,
      share_amount: shareAmount,
      share_percent: roundMoney((shareAmount / Number(amount)) * 100),
    };
  });
}

function buildSplitRows({ expenseId, amount, paidBy, participantIds, splitType, customSplit }) {
  if (splitType === 'custom') {
    return buildCustomSplitRows({ expenseId, amount, payerId: paidBy, participantIds, payerPercent: customSplit });
  }
  return buildEqualSplitRows({ expenseId, amount, participantIds });
}

function validateSplitRowsTotal(rows, amount) {
  const total = roundMoney((rows || []).reduce((sum, row) => sum + Number(row.share_amount || 0), 0));
  if (total !== roundMoney(amount)) {
    throw new Error('split participant shares must add up to the expense amount');
  }
  return rows;
}

module.exports = {
  roundMoney,
  normalizeParticipantIds,
  validateExpenseParticipants,
  buildEqualSplitRows,
  buildCustomSplitRows,
  buildSplitRows,
  validateSplitRowsTotal,
};
