const express = require('express');
const crypto = require('crypto');
const { queryAll, queryOne, runSql } = require('./database');

// ── Category canonicalization ─────────────────────────────────────────────
// Strips leading emoji/whitespace for comparison, then resolves to whichever
// canonical name already exists in the household's categories table.
// If no match, returns the cleaned-up input so a new canonical entry is created.
function stripEmojiPrefix(str) {
    return str.replace(/^[\p{Emoji_Presentation}\p{Extended_Pictographic}\s]+/gu, '').trim();
}

// Normalize known variant names to a single canonical plain-text form for matching.
// This prevents duplicates when e.g. AI returns "Food/Dining" but DB has "Food & Dining" (or vice versa).
const CATEGORY_ALIASES_SERVER = {
    'food & dining': 'food/dining',
    'food and dining': 'food/dining',
    'food': 'food/dining',
    'dining': 'food/dining',
    'dining out': 'food/dining',
    'meals': 'food/dining',
    'restaurant': 'food/dining',
    'fast food': 'food/dining',
    'takeout': 'food/dining',
    'take-out': 'food/dining',
    'delivery': 'food/dining',
    'coffee': 'food/dining',
    'coffee shop': 'food/dining',
    'cafe': 'food/dining',
    'café': 'food/dining',
    'transport': 'transportation',
    'transit': 'transportation',
    'uber': 'transportation',
    'lyft': 'transportation',
    'taxi': 'transportation',
    'gas': 'transportation',
    'fuel': 'transportation',
    'parking': 'transportation',
    'investment': 'investments',
    'invest': 'investments',
    'savings': 'investments',
    'grocery': 'groceries',
    'grocery store': 'groceries',
    'supermarket': 'groceries',
    'gro': 'groceries',
    'rent/housing': 'rent/mortgage',
    'rent/home': 'rent/mortgage',
    'housing': 'rent/mortgage',
    'rent': 'rent/mortgage',
    'subscription': 'subscriptions',
    'streaming': 'subscriptions',
    'utility': 'utilities',
    'electricity': 'utilities',
    'hydro': 'utilities',
    'bar': 'alcohol/bars',
    'pub': 'alcohol/bars',
    'alcohol': 'alcohol/bars',
    'entertainment': 'entertainment',
    'movie': 'entertainment',
    'cinema': 'entertainment',
    'shopping': 'shopping',
    'clothing': 'shopping',
    'travel': 'travel',
    'hotel': 'travel',
    'flight': 'travel',
    'pet': 'pet',
    'pets': 'pet',
};

function normalizeForMatch(plain) {
    return CATEGORY_ALIASES_SERVER[plain] || plain;
}

function resolveCategory(name, householdId) {
    if (!name || !name.trim()) return name;
    const plain = stripEmojiPrefix(name).toLowerCase().trim();
    const existing = queryAll('SELECT name FROM categories WHERE household_id = ?', [householdId]);

    // Pass 1: exact alias/plain match
    const normalized = normalizeForMatch(plain);
    const match = existing.find(r => normalizeForMatch(stripEmojiPrefix(r.name).toLowerCase()) === normalized);
    if (match) return match.name;

    // Pass 2: keyword scan — split incoming name into words and try each as an alias
    const words = plain.split(/[\s\/\-&,]+/).filter(Boolean);
    for (const word of words) {
        const wordNorm = normalizeForMatch(word);
        const wordMatch = existing.find(r => normalizeForMatch(stripEmojiPrefix(r.name).toLowerCase()) === wordNorm);
        if (wordMatch) return wordMatch.name;
    }

    // Pass 3: partial contains match against existing category names
    const containsMatch = existing.find(r => {
        const ep = stripEmojiPrefix(r.name).toLowerCase();
        return plain.includes(ep) || ep.includes(plain);
    });
    if (containsMatch) return containsMatch.name;

    // Not found — return as-is and let the category creation handle it
    return name.trim();
}

// Activity log helper function
function logActivity(householdId, userId, action, entityType, entityId, details) {
    try {
        const detailsJson = typeof details === 'string' ? details : JSON.stringify(details);
        runSql("INSERT INTO activity_log (household_id, user_id, action, entity_type, entity_id, details, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
            [householdId, userId, action, entityType, entityId, detailsJson, new Date().toISOString()]);
    } catch (err) {
        console.error('Activity log failed:', err);
    }
}


const { authenticate } = require('./auth');

const router = express.Router();

function generateInviteCode() {
  return crypto.randomBytes(3).toString('hex').toUpperCase();
}

// Create household
router.post('/', authenticate, (req, res) => {
  try {
    const { name, partnerName } = req.body;
    if (!name) return res.status(400).json({ error: 'Household name is required' });

    const inviteCode = generateInviteCode();
    const result = runSql('INSERT INTO households (name, invite_code, created_by) VALUES (?, ?, ?)', [name, inviteCode, req.user.id]);

    runSql('INSERT INTO household_members (household_id, user_id, role, partner_name) VALUES (?, ?, ?, ?)',
      [result.lastInsertRowid, req.user.id, 'owner', partnerName || req.user.name]);

    const defaultCategories = ['🍕 Food/Dining', '🛒 Groceries', '🏠 Rent/Mortgage', '🚗 Transportation', '🎬 Entertainment', '💡 Utilities', '🛍️ Shopping', '💊 Healthcare', '📱 Subscriptions', '✈️ Travel', '🐾 Pet', '💰 Investments', '📦 Other'];
    defaultCategories.forEach(cat => {
      try { runSql('INSERT INTO categories (household_id, name) VALUES (?, ?)', [result.lastInsertRowid, cat]); } catch(e) {}
    });

    res.json({ household: { id: result.lastInsertRowid, name, invite_code: inviteCode, created_by: req.user.id } });
  } catch (err) {
    console.error('Create household error:', err);
    res.status(500).json({ error: 'Failed to create household' });
  }
});

// Join household
router.post('/join', authenticate, (req, res) => {
  try {
    const { inviteCode, partnerName } = req.body;
    if (!inviteCode) return res.status(400).json({ error: 'Invite code is required' });

    const household = queryOne('SELECT * FROM households WHERE invite_code = ?', [inviteCode.toUpperCase()]);
    if (!household) return res.status(404).json({ error: 'Invalid invite code' });

    const existing = queryOne('SELECT * FROM household_members WHERE household_id = ? AND user_id = ?', [household.id, req.user.id]);
    if (existing) return res.status(409).json({ error: 'Already a member' });

    runSql('INSERT INTO household_members (household_id, user_id, role, partner_name) VALUES (?, ?, ?, ?)',
      [household.id, req.user.id, 'member', partnerName || req.user.name]);

    res.json({ household: { id: household.id, name: household.name, invite_code: household.invite_code } });
  } catch (err) {
    console.error('Join household error:', err);
    res.status(500).json({ error: 'Failed to join household' });
  }
});

// List user's households
router.get('/', authenticate, (req, res) => {
  try {
    const households = queryAll(`
      SELECT h.*, hm.role, hm.partner_name
      FROM households h JOIN household_members hm ON h.id = hm.household_id
      WHERE hm.user_id = ?`, [req.user.id]);

    const result = households.map(h => ({
      ...h,
      members: queryAll(`
        SELECT hm.user_id, hm.role, hm.partner_name, u.email, u.name
        FROM household_members hm JOIN users u ON hm.user_id = u.id
        WHERE hm.household_id = ?`, [h.id])
    }));

    res.json({ households: result });
  } catch (err) {
    console.error('List households error:', err);
    res.status(500).json({ error: 'Failed to list households' });
  }
});

// Get household details
router.get('/:id', authenticate, (req, res) => {
  try {
    const { id } = req.params;
    const member = queryOne('SELECT * FROM household_members WHERE household_id = ? AND user_id = ?', [id, req.user.id]);
    if (!member) return res.status(403).json({ error: 'Not a member' });

    const household = queryOne('SELECT * FROM households WHERE id = ?', [id]);
    if (!household) return res.status(404).json({ error: 'Not found' });

    const members = queryAll(`SELECT hm.user_id, hm.role, hm.partner_name, u.email, u.name FROM household_members hm JOIN users u ON hm.user_id = u.id WHERE hm.household_id = ?`, [id]);
    const categories = queryAll('SELECT name FROM categories WHERE household_id = ?', [id]).map(c => c.name);

    res.json({ household: { ...household, members, categories } });
  } catch (err) {
    console.error('Get household error:', err);
    res.status(500).json({ error: 'Failed to get household' });
  }
});

// --- EXPENSES ---

router.get('/:id/expenses', authenticate, (req, res) => {
  try {
    const { id } = req.params;
    const { month } = req.query;

    const member = queryOne('SELECT * FROM household_members WHERE household_id = ? AND user_id = ?', [id, req.user.id]);
    if (!member) return res.status(403).json({ error: 'Not a member' });

    let sql = `SELECT e.*, u.name as paid_by_name, u.email as paid_by_email FROM expenses e JOIN users u ON e.paid_by = u.id WHERE e.household_id = ?`;
    const params = [id];

    if (month) {
      sql += ` AND e.date LIKE ?`;
      params.push(month + '%');
    }

    sql += ' ORDER BY e.date DESC, e.created_at DESC';
    res.json({ expenses: queryAll(sql, params) });
  } catch (err) {
    console.error('List expenses error:', err);
    res.status(500).json({ error: 'Failed to list expenses' });
  }
});

router.post('/:id/expenses', authenticate, (req, res) => {
  try {
    const { id } = req.params;
    const { amount, paidBy, splitType, customSplit, date, notes, isRecurring, isShared } = req.body;
    // Resolve category to canonical form (prevents emoji-prefix duplicates)
    const category = resolveCategory(req.body.category, id);

    const member = queryOne('SELECT * FROM household_members WHERE household_id = ? AND user_id = ?', [id, req.user.id]);
    if (!member) return res.status(403).json({ error: 'Not a member' });

    // Ensure canonical category exists in categories table
    runSql('INSERT OR IGNORE INTO categories (household_id, name) VALUES (?, ?)', [id, category]);

    const resolvedIsShared = isShared !== false;
    const resolvedSplitType = splitType || (resolvedIsShared ? '50/50' : 'single');
    const result = runSql(
      `INSERT INTO expenses (household_id, amount, category, paid_by, split_type, custom_split, date, notes, is_recurring, is_shared, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, amount, category, paidBy || req.user.id, resolvedSplitType, customSplit || null, date, notes || '', isRecurring ? 1 : 0, resolvedIsShared ? 1 : 0, req.user.id]
    );

    // Log activity
    logActivity(id, req.user.id, 'added', 'expense', result.lastInsertRowid, {
      amount: amount,
      category: category,
      notes: notes || '',
      whoPaid: paidBy || req.user.id,
      isShared: isShared !== false
    });

    const expense = queryOne('SELECT e.*, u.name as paid_by_name FROM expenses e JOIN users u ON e.paid_by = u.id WHERE e.id = ?', [result.lastInsertRowid]);
    res.json({ expense });
  } catch (err) {
    console.error('Add expense error:', err);
    res.status(500).json({ error: 'Failed to add expense' });
  }
});

router.put('/:id/expenses/:expenseId', authenticate, (req, res) => {
  try {
    const { id, expenseId } = req.params;
    const { amount, paidBy, splitType, customSplit, date, notes, isRecurring, isShared } = req.body;
    // Resolve category to canonical form
    const category = resolveCategory(req.body.category, id);

    const member = queryOne('SELECT * FROM household_members WHERE household_id = ? AND user_id = ?', [id, req.user.id]);
    if (!member) return res.status(403).json({ error: 'Not a member' });

    // Ensure canonical category exists
    runSql('INSERT OR IGNORE INTO categories (household_id, name) VALUES (?, ?)', [id, category]);

    const resolvedIsSharedUpd = isShared !== false;
    const resolvedSplitTypeUpd = splitType || (resolvedIsSharedUpd ? '50/50' : 'single');
    runSql(
      `UPDATE expenses SET amount=?, category=?, paid_by=?, split_type=?, custom_split=?, date=?, notes=?, is_recurring=?, is_shared=?, updated_at=datetime('now') WHERE id=? AND household_id=?`,
      [amount, category, paidBy || req.user.id, resolvedSplitTypeUpd, customSplit || null, date, notes || '', isRecurring ? 1 : 0, resolvedIsSharedUpd ? 1 : 0, expenseId, id]
    );

    // Log activity
    logActivity(id, req.user.id, 'edited', 'expense', expenseId, {
      amount: amount,
      category: category,
      notes: notes || '',
      isShared: isShared !== false
    });

    const expense = queryOne('SELECT e.*, u.name as paid_by_name FROM expenses e JOIN users u ON e.paid_by = u.id WHERE e.id = ?', [expenseId]);
    res.json({ expense });
  } catch (err) {
    console.error('Update expense error:', err);
    res.status(500).json({ error: 'Failed to update expense' });
  }
});

router.delete('/:id/expenses/:expenseId', authenticate, (req, res) => {
  try {
    const { id, expenseId } = req.params;
    const member = queryOne('SELECT * FROM household_members WHERE household_id = ? AND user_id = ?', [id, req.user.id]);
    if (!member) return res.status(403).json({ error: 'Not a member' });

    // Get expense data before deleting for activity log
    const existing = queryOne('SELECT * FROM expenses WHERE id = ? AND household_id = ?', [expenseId, id]);
    
    runSql('DELETE FROM expenses WHERE id = ? AND household_id = ?', [expenseId, id]);
    
    // Log activity
    if (existing) {
      logActivity(id, req.user.id, 'deleted', 'expense', expenseId, {
        amount: existing.amount,
        category: existing.category,
        notes: existing.notes || '',
        isShared: existing.is_shared !== 0
      });
    }
    
    res.json({ message: 'Expense deleted' });
  } catch (err) {
    console.error('Delete expense error:', err);
    res.status(500).json({ error: 'Failed to delete expense' });
  }
});

// --- BUDGETS ---

router.get('/:id/budgets', authenticate, (req, res) => {
  try {
    const { id } = req.params;
    const { month } = req.query;
    const member = queryOne('SELECT * FROM household_members WHERE household_id = ? AND user_id = ?', [id, req.user.id]);
    if (!member) return res.status(403).json({ error: 'Not a member' });

    const params = [id];
    let sql = 'SELECT * FROM budgets WHERE household_id = ?';
    if (month) { sql += ' AND month = ?'; params.push(month); }

    res.json({ budgets: queryAll(sql, params) });
  } catch (err) {
    console.error('Get budgets error:', err);
    res.status(500).json({ error: 'Failed to get budgets' });
  }
});

router.put('/:id/budgets', authenticate, (req, res) => {
  try {
    const { id } = req.params;
    const { category, amount, budgetType, userId, month } = req.body;
    const member = queryOne('SELECT * FROM household_members WHERE household_id = ? AND user_id = ?', [id, req.user.id]);
    if (!member) return res.status(403).json({ error: 'Not a member' });

    // Upsert: try update first, then insert
    const existing = queryOne(
      `SELECT id FROM budgets WHERE household_id=? AND COALESCE(category,'')=? AND budget_type=? AND COALESCE(user_id,0)=? AND month=?`,
      [id, category || '', budgetType || 'shared', userId || 0, month]
    );

    if (existing) {
      runSql('UPDATE budgets SET amount=? WHERE id=?', [amount, existing.id]);
    } else {
      runSql('INSERT INTO budgets (household_id, category, amount, budget_type, user_id, month) VALUES (?,?,?,?,?,?)',
        [id, category || null, amount, budgetType || 'shared', userId || null, month]);
    }

    res.json({ message: 'Budget saved' });
  } catch (err) {
    console.error('Set budget error:', err);
    res.status(500).json({ error: 'Failed to set budget' });
  }
});

// --- CATEGORIES ---

router.post('/:id/categories', authenticate, (req, res) => {
  try {
    const { id } = req.params;
    const member = queryOne('SELECT * FROM household_members WHERE household_id = ? AND user_id = ?', [id, req.user.id]);
    if (!member) return res.status(403).json({ error: 'Not a member' });

    // Resolve to canonical form — if a match exists, silently return that instead of creating a duplicate
    const canonical = resolveCategory(req.body.name, id);
    runSql('INSERT OR IGNORE INTO categories (household_id, name) VALUES (?, ?)', [id, canonical]);
    res.json({ categories: queryAll('SELECT name FROM categories WHERE household_id = ?', [id]).map(c => c.name) });
  } catch (err) {
    console.error('Add category error:', err);
    res.status(500).json({ error: 'Failed to add category' });
  }
});

router.delete('/:id/categories/:name', authenticate, (req, res) => {
  try {
    const { id, name } = req.params;
    const member = queryOne('SELECT * FROM household_members WHERE household_id = ? AND user_id = ?', [id, req.user.id]);
    if (!member) return res.status(403).json({ error: 'Not a member' });

    runSql('DELETE FROM categories WHERE household_id = ? AND name = ?', [id, decodeURIComponent(name)]);
    res.json({ categories: queryAll('SELECT name FROM categories WHERE household_id = ?', [id]).map(c => c.name) });
  } catch (err) {
    console.error('Delete category error:', err);
    res.status(500).json({ error: 'Failed to delete category' });
  }
});

// --- SETTLEMENTS ---

router.post('/:id/settlements', authenticate, (req, res) => {
  try {
    const { id } = req.params;
    const { amount, date, notes } = req.body;
    const member = queryOne('SELECT * FROM household_members WHERE household_id = ? AND user_id = ?', [id, req.user.id]);
    if (!member) return res.status(403).json({ error: 'Not a member' });

    const result = runSql('INSERT INTO settlements (household_id, settled_by, amount, date, notes) VALUES (?,?,?,?,?)',
      [id, req.user.id, amount, date, notes || '']);
    
    // Log activity
    logActivity(id, req.user.id, 'settled', 'settlement', result.lastInsertRowid, {
      amount: amount,
      note: notes || ''
    });
    
    res.json({ settlement: { id: result.lastInsertRowid, amount, date, notes } });
  } catch (err) {
    console.error('Settlement error:', err);
    res.status(500).json({ error: 'Failed to create settlement' });
  }
});

router.get('/:id/settlements', authenticate, (req, res) => {
  try {
    const { id } = req.params;
    const member = queryOne('SELECT * FROM household_members WHERE household_id = ? AND user_id = ?', [id, req.user.id]);
    if (!member) return res.status(403).json({ error: 'Not a member' });

    res.json({ settlements: queryAll(`SELECT s.*, u.name as settled_by_name FROM settlements s JOIN users u ON s.settled_by = u.id WHERE s.household_id = ? ORDER BY s.date DESC`, [id]) });
  } catch (err) {
    console.error('Get settlements error:', err);
    res.status(500).json({ error: 'Failed to get settlements' });
  }
});




// Kick member from household (owner only)
router.delete('/:id/members/:userId', authenticate, (req, res) => {
  try {
    const { id, userId } = req.params;
    const household = queryOne('SELECT * FROM households WHERE id = ?', [id]);
    if (!household) return res.status(404).json({ error: 'Space not found' });
    if (household.created_by !== req.user.id) return res.status(403).json({ error: 'Only the space owner can remove members' });
    if (parseInt(userId) === req.user.id) return res.status(400).json({ error: 'You cannot remove yourself — delete the space instead' });

    const member = queryOne('SELECT * FROM household_members WHERE household_id = ? AND user_id = ?', [id, parseInt(userId)]);
    if (!member) return res.status(404).json({ error: 'Member not found in this space' });

    runSql('DELETE FROM household_members WHERE household_id = ? AND user_id = ?', [id, parseInt(userId)]);

    res.json({ message: 'Member removed' });
  } catch (err) {
    console.error('Kick member error:', err);
    res.status(500).json({ error: 'Failed to remove member' });
  }
});

// Regenerate invite code (owner only)
router.post('/:id/regenerate-code', authenticate, (req, res) => {
  try {
    const { id } = req.params;
    const household = queryOne('SELECT * FROM households WHERE id = ?', [id]);
    if (!household) return res.status(404).json({ error: 'Space not found' });

    const member = queryOne('SELECT * FROM household_members WHERE household_id = ? AND user_id = ?', [id, req.user.id]);
    if (!member || member.role !== 'owner') return res.status(403).json({ error: 'Only the space owner can regenerate the invite code' });

    const newCode = crypto.randomBytes(3).toString('hex').toUpperCase();
    runSql('UPDATE households SET invite_code = ? WHERE id = ?', [newCode, id]);

    res.json({ invite_code: newCode });
  } catch (err) {
    console.error('Regenerate code error:', err);
    res.status(500).json({ error: 'Failed to regenerate invite code' });
  }
});

// Delete household (owner only)
router.delete('/:id', authenticate, (req, res) => {
  try {
    const { id } = req.params;
    const household = queryOne('SELECT * FROM households WHERE id = ?', [id]);
    if (!household) return res.status(404).json({ error: 'Space not found' });
    if (household.created_by !== req.user.id) return res.status(403).json({ error: 'Only the space owner can delete it' });

    // Delete all related data
    runSql('DELETE FROM expenses WHERE household_id = ?', [id]);
    runSql('DELETE FROM budgets WHERE household_id = ?', [id]);
    runSql('DELETE FROM categories WHERE household_id = ?', [id]);
    runSql('DELETE FROM settlements WHERE household_id = ?', [id]);
    runSql('DELETE FROM household_members WHERE household_id = ?', [id]);
    runSql('DELETE FROM households WHERE id = ?', [id]);

    res.json({ message: 'Space deleted successfully' });
  } catch (err) {
    console.error('Delete household error:', err);
    res.status(500).json({ error: 'Failed to delete space' });
  }
});


// Get activity log
router.get('/:id/activity', authenticate, (req, res) => {
    const { id } = req.params;
    const limit = parseInt(req.query.limit) || 100;
    
    try {
        const activities = queryAll(
            `SELECT al.*, u.name as user_name, u.email as user_email 
             FROM activity_log al 
             JOIN users u ON al.user_id = u.id 
             WHERE al.household_id = ? 
             ORDER BY al.created_at DESC 
             LIMIT ?`,
            [id, limit]
        );
        res.json({ activities });
    } catch (err) {
        console.error('Get activities error:', err);
        res.status(500).json({ error: 'Failed to get activities' });
    }
});

module.exports = router;