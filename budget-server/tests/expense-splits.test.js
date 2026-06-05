const test = require('node:test');
const assert = require('node:assert/strict');
const {
  normalizeParticipantIds,
  buildEqualSplitRows,
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
