const test = require('node:test');
const assert = require('node:assert/strict');
const {
  normalizeParticipantIds,
  buildEqualSplitRows,
  buildCustomSplitRows,
  buildSplitRows,
  validateExpenseParticipants,
} = require('../lib/expenseSplits');

const members = [
  { user_id: 1, name: 'Gary' },
  { user_id: 2, name: 'Emily' },
  { user_id: 3, name: 'Kevin' },
];

test('normalizes participant ids by deduping numeric current household members only', () => {
  assert.deepEqual(normalizeParticipantIds([1, '2', 2, 3], members), [1, 2, 3]);
  assert.throws(() => normalizeParticipantIds([1, 99], members), /must belong to this budget space/);
  assert.throws(() => normalizeParticipantIds([], members), /at least two participants/);
});

test('shared group expenses require at least two selected participants', () => {
  assert.deepEqual(
    validateExpenseParticipants({ isShared: true, relationshipType: 'group', participantIds: [1, 3], members }),
    [1, 3],
  );
  assert.throws(
    () => validateExpenseParticipants({ isShared: true, relationshipType: 'group', participantIds: [1], members }),
    /at least two participants/,
  );
});

test('legacy shared expenses without participants default to all current members', () => {
  assert.deepEqual(
    validateExpenseParticipants({ isShared: true, relationshipType: 'group', participantIds: undefined, members }),
    [1, 2, 3],
  );
});

test('personal expenses never persist split participants', () => {
  assert.deepEqual(
    validateExpenseParticipants({ isShared: false, relationshipType: 'group', participantIds: [1, 2], members }),
    [],
  );
});

test('equal split rows round to cents and keep totals exact', () => {
  assert.deepEqual(buildEqualSplitRows({ expenseId: 42, amount: 100, participantIds: [1, 2, 3] }), [
    { expense_id: 42, user_id: 1, share_amount: 33.34, share_percent: 33.34 },
    { expense_id: 42, user_id: 2, share_amount: 33.33, share_percent: 33.33 },
    { expense_id: 42, user_id: 3, share_amount: 33.33, share_percent: 33.33 },
  ]);
});

test('custom split rows preserve payer percentage and keep cent totals exact', () => {
  assert.deepEqual(buildCustomSplitRows({ expenseId: 43, amount: 100, payerId: 1, participantIds: [1, 2, 3], payerPercent: 70 }), [
    { expense_id: 43, user_id: 1, share_amount: 70, share_percent: 70 },
    { expense_id: 43, user_id: 2, share_amount: 15, share_percent: 15 },
    { expense_id: 43, user_id: 3, share_amount: 15, share_percent: 15 },
  ]);
});

test('split row builder dispatches custom split instead of accidentally equal-splitting', () => {
  const rows = buildSplitRows({ expenseId: 44, amount: 14.68, paidBy: 2, participantIds: [1, 2], splitType: 'custom', customSplit: 5 });
  assert.deepEqual(rows.map(({ user_id, share_amount }) => ({ user_id, share_amount })), [
    { user_id: 1, share_amount: 13.95 },
    { user_id: 2, share_amount: 0.73 },
  ]);
});
