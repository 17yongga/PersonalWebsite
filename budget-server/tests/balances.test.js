const test = require('node:test');
const assert = require('node:assert/strict');
const {
  calculateHouseholdBalance,
  suggestSettlements,
  serializeBalances,
  roundMoney,
} = require('../lib/balances');

const members = [
  { user_id: 1, name: 'Gary', email: 'gary@example.com' },
  { user_id: 2, name: 'Emily', email: 'emily@example.com' },
];
const threeMembers = [
  ...members,
  { user_id: 3, name: 'Kevin', email: 'kevin@example.com' },
];

function expense(overrides) {
  return {
    id: 1,
    amount: 100,
    paid_by: 1,
    split_type: '50/50',
    custom_split: null,
    is_shared: 1,
    date: '2026-06-01',
    ...overrides,
  };
}

function balanceArray({ members: ms = members, expenses = [], settlements = [] }) {
  const result = calculateHouseholdBalance({ members: ms, expenses, settlements });
  return serializeBalances({ balances: result.balances, members: ms });
}

function netFor(userId, rows) {
  return rows.find((row) => row.user_id === userId)?.net ?? 0;
}

test('two-person 50/50: payer is owed half', () => {
  const rows = balanceArray({ expenses: [expense({ amount: 100, paid_by: 1 })] });
  assert.equal(netFor(1, rows), 50);
  assert.equal(netFor(2, rows), -50);
});

test('two-person 50/50: partner payer flips direction', () => {
  const rows = balanceArray({ expenses: [expense({ amount: 100, paid_by: 2 })] });
  assert.equal(netFor(1, rows), -50);
  assert.equal(netFor(2, rows), 50);
});

test('custom split stores payer share percentage', () => {
  const rows = balanceArray({
    expenses: [expense({ amount: 100, paid_by: 1, split_type: 'custom', custom_split: 70 })],
  });
  assert.equal(netFor(1, rows), 30);
  assert.equal(netFor(2, rows), -30);
});

test('custom split can make non-payer owe most of the expense', () => {
  const rows = balanceArray({
    expenses: [expense({ amount: 14.68, paid_by: 2, split_type: 'custom', custom_split: 5 })],
  });
  assert.equal(netFor(1, rows), -13.95);
  assert.equal(netFor(2, rows), 13.95);
});

test('personal expenses are ignored for settlement balances', () => {
  const rows = balanceArray({ expenses: [expense({ amount: 1000, paid_by: 1, is_shared: 0 })] });
  assert.equal(netFor(1, rows), 0);
  assert.equal(netFor(2, rows), 0);
});

test('opposite expenses net correctly', () => {
  const rows = balanceArray({
    expenses: [
      expense({ amount: 100, paid_by: 1 }),
      expense({ id: 2, amount: 40, paid_by: 2 }),
    ],
  });
  assert.equal(netFor(1, rows), 30);
  assert.equal(netFor(2, rows), -30);
});

test('directional full settlement zeroes the balance', () => {
  const rows = balanceArray({
    expenses: [expense({ amount: 100, paid_by: 1 })],
    settlements: [{ amount: 50, from_user_id: 2, to_user_id: 1, date: '2026-06-02' }],
  });
  assert.equal(netFor(1, rows), 0);
  assert.equal(netFor(2, rows), 0);
});

test('directional partial settlement leaves remainder', () => {
  const rows = balanceArray({
    expenses: [expense({ amount: 200, paid_by: 1 })],
    settlements: [{ amount: 40, from_user_id: 2, to_user_id: 1, date: '2026-06-02' }],
  });
  assert.equal(netFor(1, rows), 60);
  assert.equal(netFor(2, rows), -60);
});

test('wrong settlement direction is visible in balance', () => {
  const rows = balanceArray({
    expenses: [expense({ amount: 100, paid_by: 1 })],
    settlements: [{ amount: 50, from_user_id: 1, to_user_id: 2, date: '2026-06-02' }],
  });
  assert.equal(netFor(1, rows), 100);
  assert.equal(netFor(2, rows), -100);
});

test('overpayment produces opposite outstanding balance', () => {
  const rows = balanceArray({
    expenses: [expense({ amount: 100, paid_by: 1 })],
    settlements: [{ amount: 70, from_user_id: 2, to_user_id: 1, date: '2026-06-02' }],
  });
  assert.equal(netFor(1, rows), -20);
  assert.equal(netFor(2, rows), 20);
});

test('three-member even split charges each non-payer one share', () => {
  const rows = balanceArray({ ms: threeMembers, members: threeMembers, expenses: [expense({ amount: 90, paid_by: 1 })] });
  assert.equal(netFor(1, rows), 60);
  assert.equal(netFor(2, rows), -30);
  assert.equal(netFor(3, rows), -30);
});

test('three-member custom split shares remaining amount among non-payers', () => {
  const rows = balanceArray({ members: threeMembers, expenses: [expense({ amount: 120, paid_by: 1, split_type: 'custom', custom_split: 50 })] });
  assert.equal(netFor(1, rows), 60);
  assert.equal(netFor(2, rows), -30);
  assert.equal(netFor(3, rows), -30);
});

test('selected participant split excludes non-participants from balances', () => {
  const rows = balanceArray({
    members: threeMembers,
    expenses: [expense({
      amount: 90,
      paid_by: 1,
      split_type: 'equal',
      split_details: [
        { user_id: 1, share_amount: 45 },
        { user_id: 3, share_amount: 45 },
      ],
    })],
  });
  assert.equal(netFor(1, rows), 45);
  assert.equal(netFor(2, rows), 0);
  assert.equal(netFor(3, rows), -45);
});

test('selected participant split can reimburse payer for a bill paid only for others', () => {
  const rows = balanceArray({
    members: threeMembers,
    expenses: [expense({
      amount: 60,
      paid_by: 1,
      split_type: 'equal',
      split_details: [
        { user_id: 2, share_amount: 30 },
        { user_id: 3, share_amount: 30 },
      ],
    })],
  });
  assert.equal(netFor(1, rows), 60);
  assert.equal(netFor(2, rows), -30);
  assert.equal(netFor(3, rows), -30);
});

test('one-member household produces no settlement balance', () => {
  const rows = balanceArray({ members: [members[0]], expenses: [expense({ amount: 100, paid_by: 1 })] });
  assert.equal(netFor(1, rows), 0);
});

test('legacy settlements create a cutoff until migrated', () => {
  const result = calculateHouseholdBalance({
    members,
    expenses: [
      expense({ id: 1, amount: 100, paid_by: 1, date: '2026-05-01' }),
      expense({ id: 2, amount: 80, paid_by: 2, date: '2026-05-12' }),
    ],
    settlements: [{ amount: 50, settled_by: 1, date: '2026-05-11' }],
  });
  const rows = serializeBalances({ balances: result.balances, members });
  assert.equal(result.legacyCutoffDate, '2026-05-11');
  assert.equal(result.legacySettlementCount, 1);
  assert.equal(netFor(1, rows), -40);
  assert.equal(netFor(2, rows), 40);
});

test('directional settlements after a legacy cutoff are applied', () => {
  const rows = balanceArray({
    expenses: [expense({ id: 1, amount: 80, paid_by: 2, date: '2026-05-12' })],
    settlements: [
      { amount: 50, settled_by: 1, date: '2026-05-11' },
      { amount: 20, from_user_id: 1, to_user_id: 2, date: '2026-05-13' },
    ],
  });
  assert.equal(netFor(1, rows), -20);
  assert.equal(netFor(2, rows), 20);
});

test('suggested settlements convert balances into debtor-to-creditor payments', () => {
  const result = calculateHouseholdBalance({ members: threeMembers, expenses: [expense({ amount: 90, paid_by: 1 })] });
  const suggestions = suggestSettlements({ balances: result.balances, members: threeMembers });
  assert.deepEqual(suggestions, [
    { from_user_id: 2, from_name: 'Emily', to_user_id: 1, to_name: 'Gary', amount: 30 },
    { from_user_id: 3, from_name: 'Kevin', to_user_id: 1, to_name: 'Gary', amount: 30 },
  ]);
});

test('production Archie Home current period calculates Gary owes Emily $454.73', () => {
  const rows = balanceArray({
    expenses: [
      expense({ id: 1, amount: 1727.05, paid_by: 2, date: '2026-05-27' }),
      expense({ id: 2, amount: 845.49, paid_by: 1, date: '2026-05-28' }),
      expense({ id: 3, amount: 14.68, paid_by: 2, date: '2026-05-13', split_type: 'custom', custom_split: 5 }),
    ],
    settlements: [{ amount: 209.71, settled_by: 2, date: '2026-05-11' }],
  });
  assert.equal(netFor(1, rows), -454.73);
  assert.equal(netFor(2, rows), 454.73);
});

test('rounding keeps money to cents', () => {
  assert.equal(roundMoney(10 / 3), 3.33);
});
