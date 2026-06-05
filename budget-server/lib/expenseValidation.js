const VALID_SPLIT_TYPES = new Set(['50/50', 'custom', 'single']);

function isValidIsoDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return (
    parsed.getUTCFullYear() === year &&
    parsed.getUTCMonth() === month - 1 &&
    parsed.getUTCDate() === day
  );
}

function validateExpenseInput(input, { members, currentUserId, relationshipType }) {
  const amount = Number(input.amount);
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error('amount must be greater than 0');
  }

  if (!isValidIsoDate(input.date)) {
    throw new Error('date must be a valid YYYY-MM-DD date');
  }

  const memberIds = new Set((members || []).map((member) => Number(member.user_id)));
  const paidBy = Number(input.paidBy || currentUserId);
  const isShared = input.isShared !== false;

  if (relationshipType === 'solo' && paidBy !== Number(currentUserId)) {
    throw new Error('solo budget spaces only support expenses paid by you');
  }

  if (!memberIds.has(paidBy)) {
    throw new Error('paidBy must be a member of this budget space');
  }
  const splitType = input.splitType || (isShared ? '50/50' : 'single');
  if (!VALID_SPLIT_TYPES.has(splitType)) {
    throw new Error('splitType must be 50/50, custom, or single');
  }

  let customSplit = null;
  if (splitType === 'custom') {
    customSplit = Number(input.customSplit);
    if (!Number.isFinite(customSplit) || customSplit <= 0 || customSplit >= 100) {
      throw new Error('customSplit must be between 1 and 99');
    }
  }

  if (relationshipType === 'solo') {
    if (isShared) {
      throw new Error('solo budget spaces only support personal expenses');
    }
    if (paidBy !== Number(currentUserId)) {
      throw new Error('solo budget spaces only support expenses paid by you');
    }
  }

  return {
    amount,
    paidBy,
    splitType,
    customSplit,
    date: input.date,
    isShared,
  };
}

module.exports = {
  validateExpenseInput,
  isValidIsoDate,
};
