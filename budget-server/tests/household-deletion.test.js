const test = require('node:test');
const assert = require('node:assert/strict');

const { assertCanDeleteBudgetSpace } = require('../lib/memberManagement');

const soloOwner = [{ user_id: 1, role: 'owner', name: 'Gary' }];
const sharedMembers = [
  { user_id: 1, role: 'owner', name: 'Gary' },
  { user_id: 2, role: 'member', name: 'Emily' },
];

test('owner can delete an empty solo budget space', () => {
  assert.doesNotThrow(() => assertCanDeleteBudgetSpace({
    requesterId: 1,
    members: soloOwner,
    totalFinancialReferenceCount: 0,
    unsettledSettlementCount: 0,
  }));
});

test('non-owner cannot delete a budget space', () => {
  assert.throws(() => assertCanDeleteBudgetSpace({
    requesterId: 2,
    members: sharedMembers,
    totalFinancialReferenceCount: 0,
    unsettledSettlementCount: 0,
  }), /Only the space owner can delete/i);
});

test('budget space deletion is blocked when shared balances are unsettled', () => {
  assert.throws(() => assertCanDeleteBudgetSpace({
    requesterId: 1,
    members: sharedMembers,
    totalFinancialReferenceCount: 0,
    unsettledSettlementCount: 1,
  }), /settle outstanding balances/i);
});

test('budget space deletion is blocked when financial history exists', () => {
  assert.throws(() => assertCanDeleteBudgetSpace({
    requesterId: 1,
    members: soloOwner,
    totalFinancialReferenceCount: 2,
    unsettledSettlementCount: 0,
  }), /financial history/i);
});
