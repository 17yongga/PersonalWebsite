'use strict';

const crypto = require('crypto');

const DEFAULT_SESSION_TTL_MS = 8 * 60 * 60 * 1000;
const DEFAULT_ALLOWED_ORIGINS = [
  'https://gary-yong.com',
  'https://www.gary-yong.com',
  'http://localhost:3000',
  'http://localhost:3001',
  'http://127.0.0.1:3000',
  'http://127.0.0.1:3001'
];

function parseAllowedOrigins(value = process.env.CASINO_ALLOWED_ORIGINS) {
  if (!value) return new Set(DEFAULT_ALLOWED_ORIGINS);
  return new Set(value.split(',').map(origin => origin.trim()).filter(Boolean));
}

function constantTimeEqual(left, right) {
  if (typeof left !== 'string' || typeof right !== 'string') return false;
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function parseCookies(cookieHeader = '') {
  return cookieHeader.split(';').reduce((cookies, entry) => {
    const separator = entry.indexOf('=');
    if (separator < 1) return cookies;
    const key = entry.slice(0, separator).trim();
    const value = entry.slice(separator + 1).trim();
    if (!key) return cookies;
    try {
      cookies[key] = decodeURIComponent(value);
    } catch {
      cookies[key] = value;
    }
    return cookies;
  }, {});
}

function serializeSessionCookie(sessionId, options = {}) {
  const secure = options.secure !== false;
  const maxAgeSeconds = Math.max(1, Math.floor((options.ttlMs || DEFAULT_SESSION_TTL_MS) / 1000));
  return [
    `casino_sid=${encodeURIComponent(sessionId)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    secure ? 'Secure' : '',
    `Max-Age=${maxAgeSeconds}`
  ].filter(Boolean).join('; ');
}

function serializeExpiredSessionCookie(options = {}) {
  const secure = options.secure !== false;
  return [
    'casino_sid=',
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    secure ? 'Secure' : '',
    'Max-Age=0'
  ].filter(Boolean).join('; ');
}

class SessionStore {
  constructor({ ttlMs = DEFAULT_SESSION_TTL_MS, maxSessions = 5000, now = () => Date.now() } = {}) {
    this.ttlMs = ttlMs;
    this.maxSessions = maxSessions;
    this.now = now;
    this.sessions = new Map();
  }

  create(username) {
    if (typeof username !== 'string' || !username) throw new TypeError('username is required');
    this.prune();
    if (this.sessions.size >= this.maxSessions) {
      const oldest = [...this.sessions.entries()].sort((a, b) => a[1].createdAt - b[1].createdAt)[0];
      if (oldest) this.sessions.delete(oldest[0]);
    }
    const sessionId = crypto.randomBytes(32).toString('base64url');
    const csrfToken = crypto.randomBytes(24).toString('base64url');
    const createdAt = this.now();
    const session = { username, csrfToken, createdAt, expiresAt: createdAt + this.ttlMs };
    this.sessions.set(sessionId, session);
    return { sessionId, ...session };
  }

  get(sessionId) {
    if (!sessionId) return null;
    const session = this.sessions.get(sessionId);
    if (!session) return null;
    if (session.expiresAt <= this.now()) {
      this.sessions.delete(sessionId);
      return null;
    }
    return session;
  }

  revoke(sessionId) {
    if (!sessionId) return false;
    return this.sessions.delete(sessionId);
  }

  revokeUser(username) {
    let count = 0;
    for (const [sessionId, session] of this.sessions.entries()) {
      if (session.username === username) {
        this.sessions.delete(sessionId);
        count += 1;
      }
    }
    return count;
  }

  verifyCsrf(session, token) {
    return Boolean(session && constantTimeEqual(session.csrfToken, token));
  }

  prune() {
    const now = this.now();
    for (const [sessionId, session] of this.sessions.entries()) {
      if (session.expiresAt <= now) this.sessions.delete(sessionId);
    }
  }
}

function validateUsername(value) {
  if (typeof value !== 'string') return { valid: false, normalized: '', error: 'Username is required' };
  const normalized = value.trim();
  const reserved = new Set(['__proto__', 'prototype', 'constructor']);
  if (!/^[A-Za-z0-9_-]{3,20}$/.test(normalized) || reserved.has(normalized.toLowerCase())) {
    return {
      valid: false,
      normalized,
      error: 'Username must be 3–20 characters using letters, numbers, underscores, or hyphens'
    };
  }
  return { valid: true, normalized, error: null };
}

function sanitizeText(value, maxLength = 200) {
  if (value === null || value === undefined) return '';
  return String(value)
    .replace(/[\u0000-\u001F\u007F]/g, '')
    .trim()
    .slice(0, maxLength);
}

function secureRandomInt(maxExclusive) {
  if (!Number.isSafeInteger(maxExclusive) || maxExclusive < 1) {
    throw new RangeError('maxExclusive must be a positive safe integer');
  }
  return crypto.randomInt(maxExclusive);
}

function createRateLimiter({ windowMs, max, key = req => req.ip || req.socket?.remoteAddress || 'unknown' }) {
  if (!Number.isSafeInteger(windowMs) || windowMs < 1 || !Number.isSafeInteger(max) || max < 1) {
    throw new TypeError('windowMs and max must be positive integers');
  }
  const buckets = new Map();
  return function rateLimiter(req, res, next) {
    const now = Date.now();
    const bucketKey = key(req);
    const current = buckets.get(bucketKey);
    if (!current || current.resetAt <= now) {
      buckets.set(bucketKey, { count: 1, resetAt: now + windowMs });
      res.setHeader('RateLimit-Limit', String(max));
      res.setHeader('RateLimit-Remaining', String(max - 1));
      return next();
    }
    current.count += 1;
    res.setHeader('RateLimit-Limit', String(max));
    res.setHeader('RateLimit-Remaining', String(Math.max(0, max - current.count)));
    res.setHeader('RateLimit-Reset', String(Math.ceil(current.resetAt / 1000)));
    if (current.count > max) {
      res.setHeader('Retry-After', String(Math.ceil((current.resetAt - now) / 1000)));
      return res.status(429).json({ error: 'Too many requests. Please try again later.' });
    }
    next();
  };
}

function setSecurityHeaders(req, res, next) {
  res.removeHeader('X-Powered-By');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=()');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-site');
  if (req.secure || req.headers['x-forwarded-proto'] === 'https') {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }
  res.setHeader('Content-Security-Policy', [
    "default-src 'none'",
    "base-uri 'none'",
    "frame-ancestors 'none'",
    "form-action 'none'"
  ].join('; '));
  next();
}

function createCorsMiddleware(allowedOrigins = parseAllowedOrigins()) {
  return function corsMiddleware(req, res, next) {
    const origin = req.headers.origin;
    if (origin && !allowedOrigins.has(origin)) {
      return res.status(403).json({ error: 'Origin not allowed' });
    }
    if (origin) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
      res.setHeader('Access-Control-Allow-Credentials', 'true');
    }
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-CSRF-Token, X-Admin-Token');
    if (req.method === 'OPTIONS') return res.sendStatus(204);
    next();
  };
}

function getRequestSession(req, sessionStore) {
  const sessionId = parseCookies(req.headers.cookie).casino_sid;
  const session = sessionStore.get(sessionId);
  return session ? { sessionId, session } : null;
}

function createRequireAuth(sessionStore, { csrfForMutations = true } = {}) {
  return function requireAuth(req, res, next) {
    const auth = getRequestSession(req, sessionStore);
    if (!auth) return res.status(401).json({ error: 'Authentication required' });
    const isMutation = !['GET', 'HEAD', 'OPTIONS'].includes(req.method);
    if (csrfForMutations && isMutation && !sessionStore.verifyCsrf(auth.session, req.headers['x-csrf-token'])) {
      return res.status(403).json({ error: 'Invalid CSRF token' });
    }
    req.auth = { sessionId: auth.sessionId, username: auth.session.username, session: auth.session };
    next();
  };
}

function createRequireAdmin(adminToken = process.env.CASINO_ADMIN_TOKEN) {
  return function requireAdmin(req, res, next) {
    if (!adminToken) return res.status(503).json({ error: 'Administrative actions are disabled' });
    if (!constantTimeEqual(adminToken, req.headers['x-admin-token'])) {
      return res.status(403).json({ error: 'Administrator authorization required' });
    }
    next();
  };
}

module.exports = {
  DEFAULT_SESSION_TTL_MS,
  SessionStore,
  constantTimeEqual,
  createCorsMiddleware,
  createRateLimiter,
  createRequireAdmin,
  createRequireAuth,
  getRequestSession,
  parseAllowedOrigins,
  parseCookies,
  sanitizeText,
  secureRandomInt,
  serializeExpiredSessionCookie,
  serializeSessionCookie,
  setSecurityHeaders,
  validateUsername
};
