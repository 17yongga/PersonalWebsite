const test = require('node:test');
const assert = require('node:assert/strict');
const {
  assertCanRemoveMember,
  assertCanLeaveSpace,
  assertCanTransferOwnership,
  relationshipTypeAfterMemberRemoval,
} = require('../lib/memberManagement');

const members = [
  { user_id: 1, role: 'owner', name: 'Gary' },
  { user_id: 2, role: 'member', name: 'Kevin' },
  { user_id: 3, role: 'member', name: 'Maya' },
];

test('owner can remove an inactive non-owner member but not themselves', () => {
  assert.doesNotThrow(() => assertCanRemoveMember({ requesterId: 1, targetUserId: 2, members, targetFinancialReferenceCount: 0 }));
  assert.throws(
    () => assertCanRemoveMember({ requesterId: 1, targetUserId: 1, members, targetFinancialReferenceCount: 0 }),
    /Use leave space or transfer ownership/i,
  );
});

test('non-owner cannot remove members and missing targets are rejected', () => {
  assert.throws(
    () => assertCanRemoveMember({ requesterId: 2, targetUserId: 3, members, targetFinancialReferenceCount: 0 }),
    /Only the space owner can remove members/,
  );
  assert.throws(
    () => assertCanRemoveMember({ requesterId: 1, targetUserId: 99, members, targetFinancialReferenceCount: 0 }),
    /Member not found/,
  );
});

test('members with financial history cannot be removed silently', () => {
  assert.throws(
    () => assertCanRemoveMember({ requesterId: 1, targetUserId: 2, members, targetFinancialReferenceCount: 3 }),
    /financial history/,
  );
});

test('non-owner can leave, but owner must transfer ownership before leaving shared spaces', () => {
  assert.doesNotThrow(() => assertCanLeaveSpace({ requesterId: 2, members, requesterFinancialReferenceCount: 0 }));
  assert.throws(
    () => assertCanLeaveSpace({ requesterId: 1, members, requesterFinancialReferenceCount: 0 }),
    /Transfer ownership before leaving/,
  );
});

test('members with financial history cannot leave silently', () => {
  assert.throws(
    () => assertCanLeaveSpace({ requesterId: 2, members, requesterFinancialReferenceCount: 1 }),
    /financial history/,
  );
});

test('owner can transfer ownership to another current member only', () => {
  assert.doesNotThrow(() => assertCanTransferOwnership({ requesterId: 1, newOwnerId: 2, members }));
  assert.throws(
    () => assertCanTransferOwnership({ requesterId: 2, newOwnerId: 3, members }),
    /Only the current owner can transfer ownership/,
  );
  assert.throws(
    () => assertCanTransferOwnership({ requesterId: 1, newOwnerId: 99, members }),
    /New owner must be a current member/,
  );
});

test('relationship type moves to solo only when the last shared member leaves', () => {
  assert.equal(relationshipTypeAfterMemberRemoval('partner', 1), 'solo');
  assert.equal(relationshipTypeAfterMemberRemoval('group', 2), 'group');
  assert.equal(relationshipTypeAfterMemberRemoval('partner', 2), 'partner');
});
