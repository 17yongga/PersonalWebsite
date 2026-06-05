const test = require('node:test');
const assert = require('node:assert/strict');
const {
  normalizeRelationshipType,
  assertValidRelationshipType,
  assertRelationshipTypeAllowedForMemberCount,
} = require('../lib/householdMode');

test('normalizes two-person friends/roommates into group relationship type', () => {
  assert.equal(normalizeRelationshipType('friends'), 'group');
  assert.equal(normalizeRelationshipType('roommates'), 'group');
  assert.equal(normalizeRelationshipType('group'), 'group');
});

test('keeps partner and solo as explicit relationship types', () => {
  assert.equal(normalizeRelationshipType('partner'), 'partner');
  assert.equal(normalizeRelationshipType('solo'), 'solo');
});

test('rejects unknown relationship type values before database writes', () => {
  assert.throws(() => assertValidRelationshipType('couple'), /relationshipType must be solo, partner, or group/);
  assert.doesNotThrow(() => assertValidRelationshipType('group'));
});

test('rejects solo relationship type when a space already has multiple members', () => {
  assert.throws(() => assertRelationshipTypeAllowedForMemberCount('solo', 2), /Solo budget spaces can only have one member/);
  assert.equal(assertRelationshipTypeAllowedForMemberCount('solo', 1), 'solo');
  assert.equal(assertRelationshipTypeAllowedForMemberCount('group', 2), 'group');
});
