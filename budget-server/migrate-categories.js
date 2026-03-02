const { initialize, queryAll, runSql } = require('./database');

const CATEGORY_MAP = {
    'Food/Dining': '🍕 Food & Dining',
    'Groceries': '🛒 Groceries',
    'Health': '💊 Healthcare',
    'Transport': '🚗 Transportation',
    'Transportation': '🚗 Transportation',
    'Entertainment': '🎬 Entertainment',
    'Other': '📦 Other',
    'Subscriptions': '📱 Subscriptions',
    'Rent': '🏠 Rent/Mortgage',
    'Rent/Housing': '🏠 Rent/Mortgage',
    'Shopping': '🛍️ Shopping',
    'Pet': '🐾 Pet',
    'Pets': '🐾 Pet',
    'Travel': '✈️ Travel',
    'Utilities': '💡 Utilities',
};

async function migrate() {
    await initialize();
    console.log('Starting category migration...');

    for (const [old, neo] of Object.entries(CATEGORY_MAP)) {
        // Update expenses with old category name
        const expResult = runSql("UPDATE expenses SET category = ? WHERE category = ?", [neo, old]);
        if (expResult.changes > 0) {
            console.log(`Updated ${expResult.changes} expenses: "${old}" -> "${neo}"`);
        }

        // Remove old category if emoji version already exists
        runSql("DELETE FROM categories WHERE name = ? AND EXISTS (SELECT 1 FROM categories c2 WHERE c2.name = ? AND c2.household_id = categories.household_id)", [old, neo]);

        // Update remaining categories that don't have the emoji version yet
        const catResult = runSql("UPDATE categories SET name = ? WHERE name = ?", [neo, old]);
        if (catResult.changes > 0) {
            console.log(`Updated ${catResult.changes} categories: "${old}" -> "${neo}"`);
        }
    }

    console.log('Migration complete!');
}

migrate().then(() => process.exit(0)).catch(err => {
    console.error('Migration failed:', err);
    process.exit(1);
});
