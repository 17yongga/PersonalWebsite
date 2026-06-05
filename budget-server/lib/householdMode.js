const VALID_RELATIONSHIP_TYPES = new Set(['solo', 'partner', 'group']);
const GROUP_ALIASES = new Set(['friend', 'friends', 'roommate', 'roommates']);

function normalizeRelationshipType(value) {
  if (value == null || value === '') return null;
  const normalized = String(value).trim().toLowerCase();
  if (GROUP_ALIASES.has(normalized)) return 'group';
  if (VALID_RELATIONSHIP_TYPES.has(normalized)) return normalized;
  return null;
}

function assertValidRelationshipType(value) {
  const normalized = normalizeRelationshipType(value);
  if (!normalized) {
    throw new Error('relationshipType must be solo, partner, or group');
  }
  return normalized;
}

function assertRelationshipTypeAllowedForMemberCount(value, memberCount) {
  const normalized = assertValidRelationshipType(value);
  if (normalized === 'solo' && Number(memberCount) > 1) {
    throw new Error('Solo budget spaces can only have one member');
  }
  return normalized;
}

function defaultRelationshipTypeForMemberCount(memberCount) {
  if (Number(memberCount) <= 1) return 'solo';
  if (Number(memberCount) === 2) return 'partner';
  return 'group';
}

module.exports = {
  normalizeRelationshipType,
  assertValidRelationshipType,
  assertRelationshipTypeAllowedForMemberCount,
  defaultRelationshipTypeForMemberCount,
};
