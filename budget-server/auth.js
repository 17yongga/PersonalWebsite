const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { queryOne, queryAll, runSql } = require('./database');

const router = express.Router();
const JWT_SECRET = process.env.JWT_SECRET || 'finsync-secret-key-change-in-production';
const TOKEN_EXPIRY = '30d';

function authenticate(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'No token provided' });
  }
  try {
    const token = authHeader.split(' ')[1];
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid token' });
  }
}

router.post('/register', async (req, res) => {
  try {
    const { email, password, name } = req.body;
    if (!email || !password || !name) {
      return res.status(400).json({ error: 'Email, password, and name are required' });
    }

    const existing = queryOne('SELECT id FROM users WHERE email = ?', [email]);
    if (existing) {
      return res.status(409).json({ error: 'Email already registered' });
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const result = runSql('INSERT INTO users (email, password_hash, name) VALUES (?, ?, ?)', [email, passwordHash, name]);

    const token = jwt.sign({ id: result.lastInsertRowid, email, name }, JWT_SECRET, { expiresIn: TOKEN_EXPIRY });
    res.json({ token, user: { id: result.lastInsertRowid, email, name } });
  } catch (err) {
    console.error('Register error:', err);
    res.status(500).json({ error: 'Registration failed' });
  }
});

router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    const user = queryOne('SELECT * FROM users WHERE email = ?', [email]);
    if (!user) return res.status(401).json({ error: 'User not found' });

    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) return res.status(401).json({ error: 'Invalid password' });

    const token = jwt.sign({ id: user.id, email: user.email, name: user.name }, JWT_SECRET, { expiresIn: TOKEN_EXPIRY });
    res.json({ token, user: { id: user.id, email: user.email, name: user.name } });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Login failed' });
  }
});

router.post('/reset-password', async (req, res) => {
  try {
    const { email, newPassword } = req.body;
    const user = queryOne('SELECT id FROM users WHERE email = ?', [email]);
    if (!user) return res.status(404).json({ error: 'User not found' });

    const passwordHash = await bcrypt.hash(newPassword, 10);
    runSql('UPDATE users SET password_hash = ? WHERE id = ?', [passwordHash, user.id]);
    res.json({ message: 'Password reset successful' });
  } catch (err) {
    console.error('Reset error:', err);
    res.status(500).json({ error: 'Password reset failed' });
  }
});

router.get('/me', authenticate, (req, res) => {
  const user = queryOne('SELECT id, email, name, created_at FROM users WHERE id = ?', [req.user.id]);
  if (!user) return res.status(404).json({ error: 'User not found' });
  res.json({ user });
});

module.exports = { router, authenticate };
