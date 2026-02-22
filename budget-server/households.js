const express = require('express');
const crypto = require('crypto');
const { queryAll, queryOne, runSql } = require('./database');
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

    const defaultCategories = ['🍕 Food & Dining', '🛒 Groceries', '🏠 Rent/Mortgage', '🚗 Transportation', '🎬 Entertainment', '💡 Utilities', '🛍️ Shopping', '💊 Healthcare', '📱 Subscriptions', '✈️ Travel', '📦 Other'];
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
    const { amount, category, paidBy, splitType, customSplit, date, notes, isRecurring, isShared } = req.body;

    const member = queryOne('SELECT * FROM household_members WHERE household_id = ? AND user_id = ?', [id, req.user.id]);
    if (!member) return res.status(403).json({ error: 'Not a member' });

    const result = runSql(
      `INSERT INTO expenses (household_id, amount, category, paid_by, split_type, custom_split, date, notes, is_recurring, is_shared, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, amount, category, paidBy || req.user.id, splitType || '50/50', customSplit || null, date, notes || '', isRecurring ? 1 : 0, isShared !== false ? 1 : 0, req.user.id]
    );

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
    const { amount, category, paidBy, splitType, customSplit, date, notes, isRecurring, isShared } = req.body;

    const member = queryOne('SELECT * FROM household_members WHERE household_id = ? AND user_id = ?', [id, req.user.id]);
    if (!member) return res.status(403).json({ error: 'Not a member' });

    runSql(
      `UPDATE expenses SET amount=?, category=?, paid_by=?, split_type=?, custom_split=?, date=?, notes=?, is_recurring=?, is_shared=?, updated_at=datetime('now') WHERE id=? AND household_id=?`,
      [amount, category, paidBy || req.user.id, splitType || '50/50', customSplit || null, date, notes || '', isRecurring ? 1 : 0, isShared !== false ? 1 : 0, expenseId, id]
    );

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

    runSql('DELETE FROM expenses WHERE id = ? AND household_id = ?', [expenseId, id]);
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
    const { name } = req.body;
    const member = queryOne('SELECT * FROM household_members WHERE household_id = ? AND user_id = ?', [id, req.user.id]);
    if (!member) return res.status(403).json({ error: 'Not a member' });

    try { runSql('INSERT INTO categories (household_id, name) VALUES (?, ?)', [id, name]); } catch(e) {}
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

module.exports = router;
