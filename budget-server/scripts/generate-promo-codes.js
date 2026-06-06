const fs = require('node:fs');
const path = require('node:path');

function parseArgs(argv) {
  const args = { count: 50, label: 'Flowt Pro promo month', outputDir: path.resolve(__dirname, '..', 'generated') };
  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--count') args.count = Number(argv[++i]);
    else if (arg === '--label') args.label = argv[++i];
    else if (arg === '--output-dir') args.outputDir = path.resolve(argv[++i]);
    else if (arg === '--db') process.env.BUDGET_DB_PATH = path.resolve(argv[++i]);
  }
  if (!Number.isInteger(args.count) || args.count <= 0 || args.count > 500) {
    throw new Error('--count must be an integer between 1 and 500');
  }
  return args;
}


async function main() {
  const args = parseArgs(process.argv);
  const { initialize, queryOne, runSql } = require('../database');
  const { generatePromoCode, hashPromoCode, buildPromoCodeEmailList } = require('../lib/promoCodes');
  await initialize();

  const codes = [];
  while (codes.length < args.count) {
    const code = generatePromoCode();
    const hash = hashPromoCode(code);
    if (codes.includes(code)) continue;
    if (queryOne('SELECT id FROM promo_codes WHERE code_hash = ?', [hash])) continue;
    runSql(
      'INSERT INTO promo_codes (code_hash, label, duration_days, max_redemptions) VALUES (?, ?, ?, ?)',
      [hash, args.label, 31, 1],
    );
    codes.push(code);
  }

  fs.mkdirSync(args.outputDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const txtPath = path.join(args.outputDir, `flowt-pro-promo-codes-${stamp}.txt`);
  const jsonPath = path.join(args.outputDir, `flowt-pro-promo-codes-${stamp}.json`);
  fs.writeFileSync(txtPath, buildPromoCodeEmailList(codes));
  fs.writeFileSync(jsonPath, JSON.stringify({ label: args.label, durationDays: 31, maxRedemptions: 1, codes }, null, 2));

  console.log(JSON.stringify({ count: codes.length, txtPath, jsonPath }, null, 2));
}

main().then(() => process.exit(0)).catch((err) => {
  console.error(err);
  process.exit(1);
});
