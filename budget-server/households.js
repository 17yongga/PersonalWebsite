const express = require('express');
const crypto = require('crypto');
const { queryAll, queryOne, runSql } = require('./database');
const { buildBalanceSnapshot, roundMoney } = require('./lib/balances');
const { assertValidRelationshipType, assertRelationshipTypeAllowedForMemberCount } = require('./lib/householdMode');
const { validateExpenseInput } = require('./lib/expenseValidation');

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

const CATEGORY_EMOJI_SERVER = {
    'food/dining': '🍕', 'groceries': '🛒', 'rent/mortgage': '🏠', 'transportation': '🚗',
    'entertainment': '🎬', 'utilities': '💡', 'shopping': '🛍️', 'healthcare': '💊',
    'subscriptions': '📱', 'travel': '✈️', 'pet': '🐾', 'investments': '💰', 'other': '📦',
    'insurance': '🛡️', 'education': '📚', 'personal care': '💄', 'home maintenance': '🔧',
    'alcohol/bars': '🍺', 'coffee/cafe': '☕', 'fitness/gym': '💪', 'clothing': '👗',
    'electronics': '💻', 'charity/donations': '❤️', 'parking': '🅿️', 'phone/internet': '📱',
    'gifts': '🎁', 'health': '💊',
};

function emojiForCategoryServer(name) {
    const plain = stripEmojiPrefix(name).toLowerCase().trim();
    if (/^[\p{Emoji_Presentation}\p{Extended_Pictographic}]/u.test(name)) return name;
    const normalized = CATEGORY_ALIASES_SERVER[plain] || plain;
    const emoji = CATEGORY_EMOJI_SERVER[normalized];
    if (emoji) return emoji + ' ' + name.trim();
    for (const [key, em] of Object.entries(CATEGORY_EMOJI_SERVER)) {
        if (normalized.includes(key) || key.includes(normalized)) return em + ' ' + name.trim();
    }
    return name.trim();
}

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

    // Not found — add emoji prefix so new categories are consistent
    return emojiForCategoryServer(name);
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


function getHouseholdMembers(householdId) {
  return queryAll(`
    SELECT hm.user_id, hm.role, hm.partner_name, u.email, u.name
    FROM household_members hm JOIN users u ON hm.user_id = u.id
    WHERE hm.household_id = ?`,
    [householdId]
  );
}

function getHouseholdExpenses(householdId) {
  return queryAll(`
    SELECT e.*, u.name as paid_by_name, u.email as paid_by_email
    FROM expenses e JOIN users u ON e.paid_by = u.id
    WHERE e.household_id = ?
    ORDER BY e.date DESC, e.created_at DESC`,
    [householdId]
  );
}

function getHouseholdSettlements(householdId) {
  return queryAll(`
    SELECT s.*, u.name as settled_by_name
    FROM settlements s JOIN users u ON s.settled_by = u.id
    WHERE s.household_id = ?
    ORDER BY s.date DESC, s.created_at DESC`,
    [householdId]
  );
}

function getBalanceSnapshot(householdId) {
  const members = getHouseholdMembers(householdId);
  const expenses = getHouseholdExpenses(householdId);
  const settlements = getHouseholdSettlements(householdId);
  return buildBalanceSnapshot({ members, expenses, settlements });
}

function assertHouseholdMember(householdId, userId, res) {
  const member = queryOne('SELECT * FROM household_members WHERE household_id = ? AND user_id = ?', [householdId, userId]);
  if (!member) {
    res.status(403).json({ error: 'Not a member' });
    return null;
  }
  return member;
}


const { authenticate } = require('./auth');

const router = express.Router();

function generateInviteCode() {
  return crypto.randomBytes(3).toString('hex').toUpperCase();
}

// Create household
router.post('/', authenticate, (req, res) => {
  try {
    const { name, partnerName, relationshipType } = req.body;
    if (!name) return res.status(400).json({ error: 'Household name is required' });

    let normalizedRelationshipType;
    try {
      normalizedRelationshipType = assertValidRelationshipType(relationshipType || 'partner');
    } catch (err) {
      return res.status(400).json({ error: err.message });
    }

    const inviteCode = generateInviteCode();
    const result = runSql('INSERT INTO households (name, invite_code, created_by, relationship_type) VALUES (?, ?, ?, ?)', [name, inviteCode, req.user.id, normalizedRelationshipType]);

    runSql('INSERT INTO household_members (household_id, user_id, role, partner_name) VALUES (?, ?, ?, ?)',
      [result.lastInsertRowid, req.user.id, 'owner', partnerName || req.user.name]);

    const defaultCategories = ['🍕 Food/Dining', '🛒 Groceries', '🏠 Rent/Mortgage', '🚗 Transportation', '🎬 Entertainment', '💡 Utilities', '🛍️ Shopping', '💊 Healthcare', '📱 Subscriptions', '✈️ Travel', '🐾 Pet', '💰 Investments', '📦 Other'];
    defaultCategories.forEach(cat => {
      try { runSql('INSERT INTO categories (household_id, name) VALUES (?, ?)', [result.lastInsertRowid, cat]); } catch(e) {}
    });

    res.json({ household: { id: result.lastInsertRowid, name, invite_code: inviteCode, created_by: req.user.id, relationship_type: normalizedRelationshipType } });
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

// Update household budget-space settings (owner only)
router.put('/:id', authenticate, (req, res) => {
  try {
    const { id } = req.params;
    const { name, relationshipType } = req.body;
    const household = queryOne('SELECT * FROM households WHERE id = ?', [id]);
    if (!household) return res.status(404).json({ error: 'Space not found' });

    const member = queryOne('SELECT * FROM household_members WHERE household_id = ? AND user_id = ?', [id, req.user.id]);
    if (!member || member.role !== 'owner') return res.status(403).json({ error: 'Only the space owner can update settings' });

    const updates = [];
    const params = [];
    if (typeof name === 'string' && name.trim()) {
      updates.push('name = ?');
      params.push(name.trim());
    }
    if (relationshipType !== undefined) {
      let normalizedRelationshipType;
      try {
        const memberCount = queryOne('SELECT COUNT(*) as count FROM household_members WHERE household_id = ?', [id])?.count ?? 1;
        normalizedRelationshipType = assertRelationshipTypeAllowedForMemberCount(relationshipType, memberCount);
      } catch (err) {
        return res.status(400).json({ error: err.message });
      }
      updates.push('relationship_type = ?');
      params.push(normalizedRelationshipType);
    }

    if (updates.length > 0) {
      params.push(id);
      runSql(`UPDATE households SET ${updates.join(', ')} WHERE id = ?`, params);
    }

    const updated = queryOne('SELECT * FROM households WHERE id = ?', [id]);
    const members = queryAll(`SELECT hm.user_id, hm.role, hm.partner_name, u.email, u.name FROM household_members hm JOIN users u ON hm.user_id = u.id WHERE hm.household_id = ?`, [id]);
    const categories = queryAll('SELECT name FROM categories WHERE household_id = ?', [id]).map(c => c.name);
    res.json({ household: { ...updated, members, categories } });
  } catch (err) {
    console.error('Update household error:', err);
    res.status(500).json({ error: 'Failed to update space settings' });
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

    const household = queryOne('SELECT * FROM households WHERE id = ?', [id]);
    const members = queryAll('SELECT user_id FROM household_members WHERE household_id = ?', [id]);
    let validated;
    try {
      validated = validateExpenseInput(req.body, {
        members,
        currentUserId: req.user.id,
        relationshipType: household?.relationship_type || 'partner',
      });
    } catch (err) {
      return res.status(400).json({ error: err.message });
    }

    // Ensure canonical category exists in categories table
    runSql('INSERT OR IGNORE INTO categories (household_id, name) VALUES (?, ?)', [id, category]);

    const result = runSql(
      `INSERT INTO expenses (household_id, amount, category, paid_by, split_type, custom_split, date, notes, is_recurring, is_shared, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, validated.amount, category, validated.paidBy, validated.splitType, validated.customSplit, validated.date, notes || '', isRecurring ? 1 : 0, validated.isShared ? 1 : 0, req.user.id]
    );

    // Log activity
    logActivity(id, req.user.id, 'added', 'expense', result.lastInsertRowid, {
      amount: validated.amount,
      category: category,
      notes: notes || '',
      whoPaid: validated.paidBy,
      isShared: validated.isShared
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

    const household = queryOne('SELECT * FROM households WHERE id = ?', [id]);
    const members = queryAll('SELECT user_id FROM household_members WHERE household_id = ?', [id]);
    let validated;
    try {
      validated = validateExpenseInput(req.body, {
        members,
        currentUserId: req.user.id,
        relationshipType: household?.relationship_type || 'partner',
      });
    } catch (err) {
      return res.status(400).json({ error: err.message });
    }

    // Ensure canonical category exists
    runSql('INSERT OR IGNORE INTO categories (household_id, name) VALUES (?, ?)', [id, category]);

    runSql(
      `UPDATE expenses SET amount=?, category=?, paid_by=?, split_type=?, custom_split=?, date=?, notes=?, is_recurring=?, is_shared=?, updated_at=datetime('now') WHERE id=? AND household_id=?`,
      [validated.amount, category, validated.paidBy, validated.splitType, validated.customSplit, validated.date, notes || '', isRecurring ? 1 : 0, validated.isShared ? 1 : 0, expenseId, id]
    );

    // Log activity
    logActivity(id, req.user.id, 'edited', 'expense', expenseId, {
      amount: validated.amount,
      category: category,
      notes: notes || '',
      isShared: validated.isShared
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

// --- BALANCE / SETTLEMENT ANALYTICS ---

router.get('/:id/balance', authenticate, (req, res) => {
  try {
    const { id } = req.params;
    if (!assertHouseholdMember(id, req.user.id, res)) return;

    const members = getHouseholdMembers(id);
    const expenses = getHouseholdExpenses(id);
    const settlements = getHouseholdSettlements(id);
    const sharedExpenses = expenses.filter(e => Number(e.is_shared) === 1);
    const personalExpenses = expenses.filter(e => Number(e.is_shared) !== 1);
    const snapshot = buildBalanceSnapshot({ members, expenses, settlements });

    const categoryTotals = new Map();
    const payerTotals = new Map();
    const monthTotals = new Map();
    for (const expense of sharedExpenses) {
      const amount = Number(expense.amount) || 0;
      categoryTotals.set(expense.category, (categoryTotals.get(expense.category) || 0) + amount);
      payerTotals.set(expense.paid_by_name || String(expense.paid_by), (payerTotals.get(expense.paid_by_name || String(expense.paid_by)) || 0) + amount);
      const month = String(expense.date || '').slice(0, 7);
      if (month) monthTotals.set(month, (monthTotals.get(month) || 0) + amount);
    }

    res.json({
      household_id: Number(id),
      currency: 'CAD',
      generated_at: new Date().toISOString(),
      balances: snapshot.balances,
      suggested_settlements: snapshot.suggested_settlements,
      legacy_cutoff_date: snapshot.legacy_cutoff_date,
      legacy_settlement_count: snapshot.legacy_settlement_count,
      analytics: {
        shared_count: sharedExpenses.length,
        personal_count: personalExpenses.length,
        shared_total: roundMoney(sharedExpenses.reduce((sum, expense) => sum + Number(expense.amount || 0), 0)),
        personal_total: roundMoney(personalExpenses.reduce((sum, expense) => sum + Number(expense.amount || 0), 0)),
        settlements_count: settlements.length,
        shared_by_payer: Array.from(payerTotals.entries()).map(([name, total]) => ({ name, total: roundMoney(total) })).sort((a, b) => b.total - a.total),
        shared_by_month: Array.from(monthTotals.entries()).map(([month, total]) => ({ month, total: roundMoney(total) })).sort((a, b) => a.month.localeCompare(b.month)),
        top_shared_categories: Array.from(categoryTotals.entries()).map(([category, total]) => ({ category, total: roundMoney(total) })).sort((a, b) => b.total - a.total).slice(0, 10),
        latest_shared_expenses: sharedExpenses.slice(0, 15).map(expense => ({
          id: expense.id,
          date: expense.date,
          amount: roundMoney(Number(expense.amount || 0)),
          paid_by: expense.paid_by,
          paid_by_name: expense.paid_by_name,
          category: expense.category,
          notes: expense.notes || '',
          split_type: expense.split_type,
          custom_split: expense.custom_split,
        })),
      },
    });
  } catch (err) {
    console.error('Get balance error:', err);
    res.status(500).json({ error: 'Failed to calculate balance' });
  }
});

// --- SETTLEMENTS ---

router.post('/:id/settlements', authenticate, (req, res) => {
  try {
    const { id } = req.params;
    const { amount, date, notes, fromUserId, toUserId, settlementType } = req.body;
    if (!assertHouseholdMember(id, req.user.id, res)) return;

    const settlementAmount = roundMoney(Number(amount));
    if (!Number.isFinite(settlementAmount) || settlementAmount <= 0) {
      return res.status(400).json({ error: 'Settlement amount must be positive' });
    }

    const fromId = Number(fromUserId);
    const toId = Number(toUserId);
    if (!Number.isFinite(fromId) || !Number.isFinite(toId) || fromId === toId) {
      return res.status(400).json({ error: 'Settlement requires distinct fromUserId and toUserId' });
    }

    const fromMember = queryOne('SELECT * FROM household_members WHERE household_id = ? AND user_id = ?', [id, fromId]);
    const toMember = queryOne('SELECT * FROM household_members WHERE household_id = ? AND user_id = ?', [id, toId]);
    if (!fromMember || !toMember) {
      return res.status(400).json({ error: 'Settlement users must both be household members' });
    }

    const snapshot = getBalanceSnapshot(id);
    const suggestion = snapshot.suggested_settlements.find(s => Number(s.from_user_id) === fromId && Number(s.to_user_id) === toId);
    const isManualAdjustment = settlementType === 'manual_adjustment';
    if (!isManualAdjustment && (!suggestion || settlementAmount > roundMoney(suggestion.amount + 0.01))) {
      return res.status(400).json({ error: 'Settlement amount does not match current outstanding balance' });
    }

    const settlementDate = date || new Date().toISOString().split('T')[0];
    const result = runSql(
      `INSERT INTO settlements (household_id, settled_by, from_user_id, to_user_id, amount, date, notes, settlement_type, balance_snapshot_json)
       VALUES (?,?,?,?,?,?,?,?,?)`,
      [id, req.user.id, fromId, toId, settlementAmount, settlementDate, notes || '', settlementType || 'full', JSON.stringify(snapshot)]
    );
    
    logActivity(id, req.user.id, 'settled', 'settlement', result.lastInsertRowid, {
      amount: settlementAmount,
      fromUserId: fromId,
      toUserId: toId,
      note: notes || '',
      settlementType: settlementType || 'full',
    });
    
    res.json({
      settlement: {
        id: result.lastInsertRowid,
        amount: settlementAmount,
        date: settlementDate,
        notes: notes || '',
        from_user_id: fromId,
        to_user_id: toId,
        settlement_type: settlementType || 'full',
      }
    });
  } catch (err) {
    console.error('Settlement error:', err);
    res.status(500).json({ error: 'Failed to create settlement' });
  }
});

router.get('/:id/settlements', authenticate, (req, res) => {
  try {
    const { id } = req.params;
    if (!assertHouseholdMember(id, req.user.id, res)) return;

    res.json({ settlements: getHouseholdSettlements(id) });
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