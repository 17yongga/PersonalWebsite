function toNumberId(value) {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
}

function findMember(members, userId) {
  const id = toNumberId(userId);
  if (!id) return null;
  return (members || []).find((member) => Number(member.user_id) === id) || null;
}

function findOwner(members) {
  return (members || []).find((member) => member.role === 'owner') || null;
}

function hasFinancialHistory(count) {
  return Number(count || 0) > 0;
}

function assertCanRemoveMember({ requesterId, targetUserId, members, targetFinancialReferenceCount = 0 }) {
  const requester = findMember(members, requesterId);
  const target = findMember(members, targetUserId);
  if (!requester || requester.role !== 'owner') {
    throw new Error('Only the space owner can remove members');
  }
  if (!target) {
    throw new Error('Member not found in this space');
  }
  if (Number(requester.user_id) === Number(target.user_id)) {
    throw new Error('Use leave space or transfer ownership before removing yourself');
  }
  if (target.role === 'owner') {
    throw new Error('Transfer ownership before removing the owner');
  }
  if (hasFinancialHistory(targetFinancialReferenceCount)) {
    throw new Error('This member has financial history. Keep them for now so balances, expenses, and settlements stay accurate.');
  }
  return true;
}

function assertCanLeaveSpace({ requesterId, members, requesterFinancialReferenceCount = 0 }) {
  const requester = findMember(members, requesterId);
  if (!requester) {
    throw new Error('Not a member');
  }
  if ((members || []).length <= 1) {
    throw new Error('Delete this solo budget space instead of leaving it');
  }
  if (requester.role === 'owner') {
    throw new Error('Transfer ownership before leaving this budget space');
  }
  if (hasFinancialHistory(requesterFinancialReferenceCount)) {
    throw new Error('You have financial history in this budget space. Keep your membership for now so balances, expenses, and settlements stay accurate.');
  }
  return true;
}

function assertCanTransferOwnership({ requesterId, newOwnerId, members }) {
  const requester = findMember(members, requesterId);
  const nextOwner = findMember(members, newOwnerId);
  if (!requester || requester.role !== 'owner') {
    throw new Error('Only the current owner can transfer ownership');
  }
  if (!nextOwner) {
    throw new Error('New owner must be a current member');
  }
  if (Number(requester.user_id) === Number(nextOwner.user_id)) {
    throw new Error('Choose a different member as the new owner');
  }
  return true;
}

function relationshipTypeAfterMemberRemoval(currentRelationshipType, remainingMemberCount) {
  if (Number(remainingMemberCount) <= 1) return 'solo';
  if (currentRelationshipType === 'partner' && Number(remainingMemberCount) > 2) return 'group';
  if (currentRelationshipType === 'solo' && Number(remainingMemberCount) > 1) return Number(remainingMemberCount) === 2 ? 'partner' : 'group';
  return currentRelationshipType || (Number(remainingMemberCount) === 2 ? 'partner' : 'group');
}

module.exports = {
  assertCanRemoveMember,
  assertCanLeaveSpace,
  assertCanTransferOwnership,
  relationshipTypeAfterMemberRemoval,
  findMember,
  findOwner,
};
