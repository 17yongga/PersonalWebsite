const test = require('node:test');
const assert = require('node:assert/strict');
const { validateExpenseInput } = require('../lib/expenseValidation');

const members = [
  { user_id: 1, name: 'Gary' },
  { user_id: 2, name: 'Emily' },
];

function validExpense(overrides = {}) {
  return {
    amount: 42.5,
    paidBy: 1,
    splitType: '50/50',
    customSplit: null,
    date: '2026-06-05',
    isShared: true,
    ...overrides,
  };
}

test('accepts a normal shared expense paid by a budget-space member', () => {
  const normalized = validateExpenseInput(validExpense(), { members, currentUserId: 1, relationshipType: 'partner' });
  assert.equal(normalized.amount, 42.5);
  assert.equal(normalized.paidBy, 1);
  assert.equal(normalized.splitType, '50/50');
  assert.equal(normalized.isShared, true);
});

test('rejects expenses paid by someone outside the budget space', () => {
  assert.throws(
    () => validateExpenseInput(validExpense({ paidBy: 99 }), { members, currentUserId: 1, relationshipType: 'partner' }),
    /paidBy must be a member of this budget space/,
  );
});

test('rejects zero, negative, missing, and non-numeric amounts', () => {
  for (const amount of [0, -1, '', null, undefined, 'not-money']) {
    assert.throws(
      () => validateExpenseInput(validExpense({ amount }), { members, currentUserId: 1, relationshipType: 'partner' }),
      /amount must be greater than 0/,
    );
  }
});

test('rejects invalid dates and impossible calendar dates', () => {
  for (const date of ['', '2026/06/05', '2026-02-31', 'tomorrow']) {
    assert.throws(
      () => validateExpenseInput(validExpense({ date }), { members, currentUserId: 1, relationshipType: 'partner' }),
      /date must be a valid YYYY-MM-DD date/,
    );
  }
});

test('rejects unknown split types', () => {
  assert.throws(
    () => validateExpenseInput(validExpense({ splitType: 'magic' }), { members, currentUserId: 1, relationshipType: 'partner' }),
    /splitType must be 50\/50, custom, or single/,
  );
});

test('requires custom split percentage to be within 1 and 99 percent', () => {
  for (const customSplit of [0, 100, -5, 101, 'abc', null]) {
    assert.throws(
      () => validateExpenseInput(validExpense({ splitType: 'custom', customSplit }), { members, currentUserId: 1, relationshipType: 'partner' }),
      /customSplit must be between 1 and 99/,
    );
  }

  const normalized = validateExpenseInput(validExpense({ splitType: 'custom', customSplit: '70' }), {
    members,
    currentUserId: 1,
    relationshipType: 'partner',
  });
  assert.equal(normalized.customSplit, 70);
});

test('solo spaces only accept personal expenses paid by the current user', () => {
  const soloMembers = [{ user_id: 1, name: 'Gary' }];
  assert.throws(
    () => validateExpenseInput(validExpense({ isShared: true }), { members: soloMembers, currentUserId: 1, relationshipType: 'solo' }),
    /solo budget spaces only support personal expenses/,
  );
  assert.throws(
    () => validateExpenseInput(validExpense({ isShared: false, splitType: 'single', paidBy: 2 }), { members: soloMembers, currentUserId: 1, relationshipType: 'solo' }),
    /solo budget spaces only support expenses paid by you/,
  );

  const normalized = validateExpenseInput(validExpense({ isShared: false, splitType: 'single', paidBy: 1 }), {
    members: soloMembers,
    currentUserId: 1,
    relationshipType: 'solo',
  });
  assert.equal(normalized.isShared, false);
  assert.equal(normalized.splitType, 'single');
});
