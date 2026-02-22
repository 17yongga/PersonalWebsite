# Security & Compliance: Fantasy Trading Platform

**Version:** 1.0  
**Author:** Dr. Molt (Architecture Copilot)  
**Date:** 2026-02-18  

---

## 1. Authentication & Session Security

### Password Handling
- **Hashing:** bcrypt with cost factor 12 (≈250ms per hash on EC2)
- **Minimum requirements:** 8 characters, at least 1 uppercase, 1 lowercase, 1 digit
- **No password storage in plaintext** — only `password_hash` column exists
- **No password in logs** — request body sanitized before logging

### JWT Token Architecture
```
Access Token:
  - Algorithm: HS256
  - Expiry: 15 minutes
  - Payload: { sub: userId, iat, exp, jti }
  - Stored: in-memory (JavaScript variable), NOT localStorage
  - Sent: Authorization: Bearer <token>

Refresh Token:
  - Algorithm: HS256
  - Expiry: 7 days
  - Stored: httpOnly, Secure, SameSite=Strict cookie
  - Server stores SHA-256 hash in refresh_tokens table
  - Rotation: on each refresh, old token revoked, new token issued
  - Family tracking: if revoked token is reused → revoke entire family (breach detection)
```

### Login Rate Limiting
- **5 failed attempts per IP per 15 minutes** → 429 response + 15-minute lockout
- **10 failed attempts per account per hour** → account soft-locked, requires email verification
- Failed attempts tracked in `login_attempts` in-memory map (cleared hourly)

### Session Management
- Access tokens are stateless (JWT validation only)
- Refresh tokens are stateful (checked against DB on each refresh)
- Logout: revoke refresh token in DB, clear httpOnly cookie
- Multiple devices: each device gets its own refresh token family
- Max 5 active refresh token families per user (oldest evicted)

---

## 2. Input Validation & Sanitization

### Request Validation (zod)
Every API endpoint validates request body, query params, and path params using zod schemas:

```javascript
// Example: Create Portfolio
const createPortfolioSchema = z.object({
  name: z.string().min(1).max(50).regex(/^[a-zA-Z0-9 _-]+$/),
  starting_balance: z.number().min(1000).max(10000000).default(100000),
});

// Example: Place Order
const placeOrderSchema = z.object({
  portfolio_id: z.string().uuid(),
  symbol: z.string().min(1).max(10).regex(/^[A-Z.]+$/),
  side: z.enum(['buy', 'sell']),
  type: z.enum(['market', 'limit', 'stop', 'stop_limit']),
  quantity: z.number().int().min(1).max(100000),
  limit_price: z.number().positive().optional(),
  stop_price: z.number().positive().optional(),
  duration: z.enum(['day', 'gtc']).default('day'),
});
```

### SQL Injection Prevention
- **All queries use parameterized statements** via `better-sqlite3` prepared statements
- No string concatenation in queries — ever
- Database layer reviewed for injection in M5 QA

### XSS Prevention
- All user-generated content (display names, portfolio names, strategy names) is **HTML-escaped** before rendering
- CSP header prevents inline script execution
- DOM manipulation uses `textContent`, never `innerHTML` for user data
- Strategy code is never rendered as HTML — displayed in CodeMirror editor (safe by design)

### Path Traversal
- File paths are never constructed from user input
- Strategy code is stored in DB, not filesystem

---

## 3. Strategy Code Sandboxing

### Architecture
User-written JavaScript strategies execute in `isolated-vm` — a V8 isolate that runs in a separate memory space with no access to the host process.

### Sandbox Constraints
```
┌─────────────────────────────────────┐
│         isolated-vm Sandbox         │
│                                     │
│  ✅ Available:                      │
│  - Math, JSON, String, Array, Date  │
│  - Custom API: getData(), buy(),    │
│    sell(), getPosition(),           │
│    getPortfolio()                   │
│  - Console (captured, not output)   │
│                                     │
│  ❌ Blocked:                        │
│  - require() / import              │
│  - process, __dirname, __filename  │
│  - fs, net, http, child_process    │
│  - eval(), Function(), setTimeout  │
│  - globalThis modification         │
│  - Infinite loops (CPU limit)      │
│  - Large allocations (memory limit)│
└─────────────────────────────────────┘
```

### Resource Limits
| Resource | Limit | Behavior on Exceed |
|----------|-------|--------------------|
| CPU time | 1 second (backtesting: 5s per day iteration) | Isolate terminated, error returned |
| Memory | 64MB | Isolate terminated, error returned |
| Execution wall time | 30 seconds total per backtest | Backtest aborted, partial results returned |
| Output size | 1MB (signals/logs) | Truncated |

### Pre-execution Validation
Before code enters the sandbox, a static analysis pass rejects:
```javascript
const BLOCKED_PATTERNS = [
  /require\s*\(/,
  /import\s+/,
  /process\./,
  /global\./,
  /globalThis/,
  /__dirname/,
  /__filename/,
  /eval\s*\(/,
  /Function\s*\(/,
  /setTimeout/,
  /setInterval/,
  /setImmediate/,
  /Proxy\s*\(/,
  /Reflect\./,
  /WebAssembly/,
  /SharedArrayBuffer/,
];
```

### Testing Requirements
- Adversarial test suite in M3: prototype pollution, ReDoS, memory bombs, infinite recursion
- Quarterly review of `isolated-vm` CVEs
- Fallback: if isolated-vm has a critical CVE, disable code-based strategies and revert to rules-only

---

## 4. Anti-Cheat & Fair Play

### Backtesting Integrity
- **No lookahead bias:** Strategies receive data only up to the "current" simulated day
- Historical data iterator strictly feeds one day at a time
- `getData()` API within backtests returns only past data (enforced by the engine, not the sandbox)
- Backtest results include `integrity_hash` (SHA-256 of strategy code + date range + parameters) for reproducibility

### Trading Limits
| Limit | Value | Rationale |
|-------|-------|-----------|
| Max position size | $1,000,000 per trade | Prevent unrealistic concentration |
| Max order rate | 60 orders per minute per user | Prevent spam/abuse |
| Max portfolio value | $100,000,000 | Prevent meaningless numbers |
| Max open orders | 100 per portfolio | Resource constraint |
| Max concurrent backtests | 2 per user | Compute fairness |
| Min order size | 1 share / $1 | Prevent dust trades |
| Max portfolios | 5 per user | Resource constraint |
| Max strategies | 10 per user | Resource constraint |
| Max symbols per strategy | 50 | Backtest performance |

### Anomaly Detection (v1: logging only)
- Flag returns > 500% annually (log for review)
- Flag portfolios with > 95% win rate over 50+ trades
- Flag strategies that trigger > 1000 trades in a backtest
- v2: automated review queue with manual approval for contest results

### Contest Fairness
- Contest portfolios are **isolated** — separate from personal portfolios
- All participants start with identical capital
- Order execution uses the same slippage model for all participants
- Contest trading data is immutable after contest ends (audit trail)
- Contest results include verification: strategy code hash, trade log, equity curve

---

## 5. Data Privacy

### Data Collected
| Data | Purpose | Retention |
|------|---------|-----------|
| Email | Account identification, password reset | Until account deletion |
| Display name | Public profile | Until account deletion |
| Password hash | Authentication | Until account deletion |
| IP address | Rate limiting, security logs | 30 days |
| User agent | Security logs | 30 days |
| Trading activity | Platform functionality | Until account deletion |
| Strategy code | Platform functionality | Until account deletion |

### Data NOT Collected
- ❌ Real name (display name can be anything)
- ❌ Social Security Number
- ❌ Credit card or bank information
- ❌ Phone number
- ❌ Physical address
- ❌ Real brokerage credentials
- ❌ Biometric data
- ❌ Location data

### Data Deletion
- `DELETE /auth/account` — permanently deletes all user data within 24 hours
- Cascade: user → portfolios → positions → orders → transactions → strategies → backtests → contest entries
- Confirmation required (must provide password)
- Leaderboard entries anonymized (display name → "Deleted User")

### No Third-Party Data Sharing
- User data is never sold or shared with third parties
- Market data APIs are called server-side — user identity never sent to data providers
- No analytics trackers (Google Analytics, etc.) in v1 — consider privacy-friendly option (Plausible) in v2

---

## 6. HTTP Security Headers

Applied via nginx configuration:

```nginx
# Security headers for api.gary-yong.com/api/v1/
add_header X-Content-Type-Options "nosniff" always;
add_header X-Frame-Options "DENY" always;
add_header X-XSS-Protection "1; mode=block" always;
add_header Referrer-Policy "strict-origin-when-cross-origin" always;
add_header Permissions-Policy "camera=(), microphone=(), geolocation=()" always;

# HSTS (already on via CloudFront, reinforce at origin)
add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
```

Applied via HTML meta / CloudFront response headers for frontend:

```
Content-Security-Policy:
  default-src 'self';
  script-src 'self' https://cdnjs.cloudflare.com;
  style-src 'self' 'unsafe-inline' https://cdnjs.cloudflare.com;
  img-src 'self' data:;
  connect-src 'self' https://api.gary-yong.com wss://api.gary-yong.com;
  font-src 'self' https://cdnjs.cloudflare.com;
  frame-ancestors 'none';
```

### CORS Configuration
```javascript
const corsOptions = {
  origin: ['https://gary-yong.com', 'https://www.gary-yong.com'],
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true,  // for refresh token cookies
  maxAge: 86400,      // preflight cache: 24 hours
};
```

---

## 7. Rate Limiting

### Tiered Rate Limits
```
Unauthenticated:
  - 20 requests per minute per IP
  - Applies to: login, register, public leaderboard

Authenticated:
  - 100 requests per minute per user
  - Applies to: all protected endpoints

Trading:
  - 60 orders per minute per user
  - 10 backtests per hour per user

Market Data:
  - 30 quote requests per minute per user
  - 10 search requests per minute per user

WebSocket:
  - Max 50 symbol subscriptions per connection
  - Max 3 connections per user
```

### Implementation
- `express-rate-limit` with in-memory store (v1)
- Key: IP for unauthenticated, userId for authenticated
- Response: `429 Too Many Requests` with `Retry-After` header
- v2: Redis store for multi-process consistency

---

## 8. Educational Disclaimer

### Legal Notice (displayed on every page)
```
⚠️ EDUCATIONAL SIMULATION ONLY

This platform is for educational and entertainment purposes only.
All trading is simulated using virtual currency.
No real money is used, risked, or earned.

This is NOT financial advice. Past simulated performance does not
indicate future results in real markets. Do not make real investment
decisions based on results from this platform.

By using this platform, you acknowledge that:
• All portfolios and trades are fictional
• Market data may be delayed up to 15 minutes
• Simulated results may not reflect real market conditions
• This platform has no affiliation with any brokerage or financial institution
```

### Placement
- **Persistent footer banner** on every page (dismissable per session, returns on navigation)
- **Terms acceptance modal** on first login (must check "I understand" before proceeding)
- **Disclaimer text** in page footer (non-dismissable)
- **Registration page** includes disclaimer checkbox
- **Strategy/backtest results** include "Simulated results — not real returns" watermark

---

## 9. Incident Response

### Severity Levels
| Level | Description | Response Time | Example |
|-------|-------------|---------------|---------|
| P0 | Security breach, data leak | Immediate | Sandbox escape, unauthorized data access |
| P1 | Service down | 1 hour | Server crash, DB corruption |
| P2 | Feature broken | 24 hours | Trading engine bug, incorrect P&L |
| P3 | Minor issue | 72 hours | UI glitch, slow query |

### P0 Response Procedure
1. Take platform offline immediately (`pm2 stop trading-server`)
2. Preserve logs and DB state (snapshot)
3. Investigate root cause
4. Patch vulnerability
5. Notify affected users (if data accessed)
6. Post-mortem within 48 hours

### Logging
- All API requests logged (method, path, userId, status, responseTime) via Pino
- Auth events logged separately (login, logout, failed attempts, token refresh)
- Strategy sandbox errors logged (code hash, error message, resource usage)
- No sensitive data in logs (passwords, tokens, full strategy code)
- Log retention: 30 days on disk, rotated daily

---

## 10. Dependency Security

### npm Audit
- Run `npm audit` on every deployment
- Zero critical or high vulnerabilities allowed in production
- Dependabot or manual review monthly for dependency updates

### Key Dependencies & Versions
| Package | Purpose | Security Note |
|---------|---------|---------------|
| `bcrypt` | Password hashing | Keep updated for hash algorithm fixes |
| `jsonwebtoken` | JWT creation/verification | Pin version, review CVEs |
| `isolated-vm` | Strategy sandboxing | **Critical** — review every update, test adversarial payloads |
| `better-sqlite3` | Database | Native module, keep updated |
| `express` | HTTP server | Mainstream, well-audited |
| `zod` | Input validation | Type-safe, minimal attack surface |
| `ws` | WebSocket | Review for DoS vulnerabilities |
| `helmet` | Security headers | Use default config + customizations above |

### Supply Chain
- `package-lock.json` committed to git (reproducible installs)
- `npm ci` used in deployment (not `npm install`)
- Consider `socket.dev` or similar for supply chain monitoring in v2
