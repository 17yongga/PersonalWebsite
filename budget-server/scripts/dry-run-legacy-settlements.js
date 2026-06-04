#!/usr/bin/env node
const { initialize, queryAll } = require('../database');

function inferDirection(settlement, members) {
  const note = String(settlement.notes || '').toLowerCase();
  const memberByName = members.map((member) => ({
    id: Number(member.user_id),
    name: String(member.name || member.partner_name || '').toLowerCase(),
  })).filter((member) => member.name);

  for (const debtor of memberByName) {
    for (const creditor of memberByName) {
      if (debtor.id === creditor.id) continue;
      if (note.includes(`${debtor.name} owes ${creditor.name}`)) {
        return { confidence: 'high', from_user_id: debtor.id, to_user_id: creditor.id, reason: 'notes contain "debtor owes creditor"' };
      }
    }
  }

  if (note.includes('you settled up with')) {
    return { confidence: 'needs-review', from_user_id: Number(settlement.settled_by), to_user_id: null, reason: 'user-perspective note; receiver must be confirmed manually' };
  }

  return { confidence: 'unknown', from_user_id: null, to_user_id: null, reason: 'no structured direction available' };
}

async function main() {
  const householdId = Number(process.argv[2] || 1);
  await initialize();

  const members = queryAll(`
    SELECT hm.user_id, hm.partner_name, u.name, u.email
    FROM household_members hm JOIN users u ON hm.user_id = u.id
    WHERE hm.household_id = ?
    ORDER BY hm.user_id`, [householdId]);

  const legacySettlements = queryAll(`
    SELECT * FROM settlements
    WHERE household_id = ? AND (from_user_id IS NULL OR to_user_id IS NULL)
    ORDER BY date, created_at`, [householdId]);

  const report = legacySettlements.map((settlement) => ({
    id: settlement.id,
    date: settlement.date,
    amount: Number(settlement.amount),
    settled_by: settlement.settled_by,
    notes: settlement.notes || '',
    inference: inferDirection(settlement, members),
  }));

  console.log(JSON.stringify({
    mode: 'dry-run',
    household_id: householdId,
    members,
    legacy_settlement_count: legacySettlements.length,
    proposed_direction_backfill: report,
    warning: 'No database changes were made. Review needs-review/unknown rows before migration.',
  }, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
