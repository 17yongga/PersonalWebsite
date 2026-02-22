# API Specification: Fantasy Trading Platform

**Version:** 1.0  
**Author:** Dr. Molt (Architecture Copilot)  
**Date:** 2025-07-10  
**Base URL:** `https://api.gary-yong.com/api/v1`  

---

## General Conventions

### Authentication
All endpoints except Auth require a valid JWT in the `Authorization` header:
```
Authorization: Bearer <access_token>
```

### Response Format
All responses follow this envelope:
```json
{
  "success": true,
  "data": { ... },
  "meta": {
    "timestamp": "2025-07-10T14:30:00Z",
    "requestId": "req_abc123"
  }
}
```

### Error Response
```json
{
  "success": false,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Invalid email format",
    "details": [
      { "field": "email", "message": "Must be a valid email address" }
    ]
  },
  "meta": {
    "timestamp": "2025-07-10T14:30:00Z",
    "requestId": "req_abc123"
  }
}
```

### Error Codes

| HTTP Status | Code | Description |
|-------------|------|-------------|
| 400 | `VALIDATION_ERROR` | Request body/params failed validation |
| 401 | `UNAUTHORIZED` | Missing or invalid access token |
| 403 | `FORBIDDEN` | User lacks permission for this action |
| 404 | `NOT_FOUND` | Resource does not exist |
| 409 | `CONFLICT` | Resource already exists (duplicate) |
| 422 | `UNPROCESSABLE` | Request is valid but cannot be processed (e.g., insufficient funds) |
| 429 | `RATE_LIMITED` | Too many requests |
| 500 | `INTERNAL_ERROR` | Unexpected server error |

### Pagination
List endpoints support cursor-based pagination:
```
GET /portfolios?limit=20&cursor=eyJpZCI6ImFiYzEyMyJ9
```

Response includes:
```json
{
  "data": [...],
  "pagination": {
    "hasMore": true,
    "nextCursor": "eyJpZCI6ImRlZjQ1NiJ9",
    "total": 42
  }
}
```

### Rate Limits

| Endpoint Group | Rate Limit |
|---------------|-----------|
| Auth (login/register) | 5 per IP per 15 min |
| Market Data | 60 per user per min |
| Trading (orders) | 30 per user per min |
| Backtesting | 5 per user per hour |
| General API | 120 per user per min |

Rate limit headers included in every response:
```
X-RateLimit-Limit: 120
X-RateLimit-Remaining: 118
X-RateLimit-Reset: 1720627260
```

---

## 1. Authentication

### 1.1 Register

**`POST /auth/register`**

Create a new user account.

**Request:**
```json
{
  "email": "trader@example.com",
  "password": "SecurePass123!",
  "displayName": "TraderJoe"
}
```

**Validation Rules:**
- `email`: Valid email format, max 254 chars, converted to lowercase.
- `password`: Min 8 chars, max 128 chars, at least 1 uppercase, 1 lowercase, 1 digit.
- `displayName`: 3–30 chars, alphanumeric + underscores only.

**Response (201 Created):**
```json
{
  "success": true,
  "data": {
    "user": {
      "id": "550e8400-e29b-41d4-a716-446655440000",
      "email": "trader@example.com",
      "displayName": "TraderJoe",
      "createdAt": "2025-07-10T14:30:00Z"
    },
    "accessToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
    "refreshToken": "dGhpcyBpcyBhIHJlZnJlc2ggdG9rZW4...",
    "expiresIn": 900
  }
}
```

**Errors:**
- `409 CONFLICT` — Email already registered.
- `400 VALIDATION_ERROR` — Invalid email, weak password, or invalid display name.

---

### 1.2 Login

**`POST /auth/login`**

Authenticate with email and password.

**Request:**
```json
{
  "email": "trader@example.com",
  "password": "SecurePass123!"
}
```

**Response (200 OK):**
```json
{
  "success": true,
  "data": {
    "user": {
      "id": "550e8400-e29b-41d4-a716-446655440000",
      "email": "trader@example.com",
      "displayName": "TraderJoe",
      "createdAt": "2025-07-10T14:30:00Z",
      "lastLoginAt": "2025-07-10T14:30:00Z"
    },
    "accessToken": "eyJhbGciOiJIUzI1NiIs...",
    "refreshToken": "dGhpcyBpcyBhIHJlZnJl...",
    "expiresIn": 900
  }
}
```

**Errors:**
- `401 UNAUTHORIZED` — Invalid email or password.
- `403 FORBIDDEN` — Account is banned.
- `429 RATE_LIMITED` — Too many login attempts.

---

### 1.3 Refresh Token

**`POST /auth/refresh`**

Exchange a refresh token for a new access/refresh token pair.

**Request:**
```json
{
  "refreshToken": "dGhpcyBpcyBhIHJlZnJlc2ggdG9rZW4..."
}
```

**Response (200 OK):**
```json
{
  "success": true,
  "data": {
    "accessToken": "eyJhbGciOiJIUzI1NiIs...",
    "refreshToken": "bmV3IHJlZnJlc2ggdG9rZW4...",
    "expiresIn": 900
  }
}
```

**Errors:**
- `401 UNAUTHORIZED` — Invalid, expired, or revoked refresh token.

---

### 1.4 Logout

**`POST /auth/logout`** *(requires auth)*

Revoke the current refresh token.

**Request:**
```json
{
  "refreshToken": "dGhpcyBpcyBhIHJlZnJlc2ggdG9rZW4..."
}
```

**Response (200 OK):**
```json
{
  "success": true,
  "data": {
    "message": "Logged out successfully"
  }
}
```

---

### 1.5 Get Current User

**`GET /auth/me`** *(requires auth)*

Get the authenticated user's profile.

**Response (200 OK):**
```json
{
  "success": true,
  "data": {
    "id": "550e8400-e29b-41d4-a716-446655440000",
    "email": "trader@example.com",
    "displayName": "TraderJoe",
    "isPublic": true,
    "createdAt": "2025-07-10T14:30:00Z",
    "stats": {
      "portfolioCount": 3,
      "totalTrades": 47,
      "strategyCount": 2,
      "contestsJoined": 5,
      "bestReturn": 0.234,
      "achievements": ["first_trade", "ten_trades", "first_strategy"]
    }
  }
}
```

---

### 1.6 Update Profile

**`PATCH /auth/me`** *(requires auth)*

Update display name or visibility.

**Request:**
```json
{
  "displayName": "TraderJoe2",
  "isPublic": false
}
```

**Response (200 OK):**
```json
{
  "success": true,
  "data": {
    "id": "550e8400-e29b-41d4-a716-446655440000",
    "displayName": "TraderJoe2",
    "isPublic": false,
    "updatedAt": "2025-07-10T15:00:00Z"
  }
}
```

---

### 1.7 Change Password

**`POST /auth/change-password`** *(requires auth)*

**Request:**
```json
{
  "currentPassword": "SecurePass123!",
  "newPassword": "EvenMoreSecure456!"
}
```

**Response (200 OK):**
```json
{
  "success": true,
  "data": {
    "message": "Password changed successfully. All sessions revoked."
  }
}
```

---

### 1.8 Delete Account

**`DELETE /auth/me`** *(requires auth)*

Permanently delete the user account and all associated data.

**Request:**
```json
{
  "password": "SecurePass123!",
  "confirmDelete": true
}
```

**Response (200 OK):**
```json
{
  "success": true,
  "data": {
    "message": "Account deleted successfully"
  }
}
```

---

## 2. Portfolios

### 2.1 List Portfolios

**`GET /portfolios`** *(requires auth)*

List all portfolios for the authenticated user.

**Query Parameters:**
- `includeContest` (boolean, default: false) — Include contest portfolios.
- `limit` (int, default: 20, max: 50)
- `cursor` (string)

**Response (200 OK):**
```json
{
  "success": true,
  "data": [
    {
      "id": "port_001",
      "name": "Growth Portfolio",
      "startingCapital": 100000.00,
      "cashBalance": 45230.50,
      "totalValue": 112450.75,
      "dayChange": 1250.30,
      "dayChangePercent": 1.12,
      "totalReturn": 0.1245,
      "positionsCount": 8,
      "isContest": false,
      "createdAt": "2025-07-01T10:00:00Z",
      "updatedAt": "2025-07-10T16:00:00Z"
    },
    {
      "id": "port_002",
      "name": "Tech Only",
      "startingCapital": 100000.00,
      "cashBalance": 72100.00,
      "totalValue": 98750.20,
      "dayChange": -340.10,
      "dayChangePercent": -0.34,
      "totalReturn": -0.0125,
      "positionsCount": 3,
      "isContest": false,
      "createdAt": "2025-07-05T09:00:00Z",
      "updatedAt": "2025-07-10T16:00:00Z"
    }
  ],
  "pagination": {
    "hasMore": false,
    "total": 2
  }
}
```

---

### 2.2 Get Portfolio Detail

**`GET /portfolios/:id`** *(requires auth)*

Get a single portfolio with positions.

**Response (200 OK):**
```json
{
  "success": true,
  "data": {
    "id": "port_001",
    "name": "Growth Portfolio",
    "startingCapital": 100000.00,
    "cashBalance": 45230.50,
    "totalValue": 112450.75,
    "holdingsValue": 67220.25,
    "dayChange": 1250.30,
    "dayChangePercent": 1.12,
    "totalReturn": 0.1245,
    "totalReturnDollar": 12450.75,
    "positions": [
      {
        "id": "pos_001",
        "symbol": "AAPL",
        "companyName": "Apple Inc.",
        "quantity": 50,
        "averageCost": 185.20,
        "currentPrice": 195.42,
        "marketValue": 9771.00,
        "unrealizedPnl": 511.00,
        "unrealizedPnlPercent": 5.52,
        "dayChange": 1.23,
        "dayChangePercent": 0.63,
        "weight": 8.69,
        "openedAt": "2025-07-02T14:30:00Z"
      },
      {
        "id": "pos_002",
        "symbol": "GOOGL",
        "companyName": "Alphabet Inc.",
        "quantity": 30,
        "averageCost": 172.80,
        "currentPrice": 178.55,
        "marketValue": 5356.50,
        "unrealizedPnl": 172.50,
        "unrealizedPnlPercent": 3.33,
        "dayChange": 0.85,
        "dayChangePercent": 0.48,
        "weight": 4.76,
        "openedAt": "2025-07-03T10:15:00Z"
      }
    ],
    "sectorAllocation": [
      { "sector": "Technology", "weight": 45.2 },
      { "sector": "Healthcare", "weight": 20.1 },
      { "sector": "Finance", "weight": 15.8 },
      { "sector": "Consumer", "weight": 10.5 },
      { "sector": "Cash", "weight": 8.4 }
    ],
    "attachedStrategy": {
      "id": "strat_001",
      "name": "Golden Cross",
      "type": "rules",
      "isActive": true
    },
    "createdAt": "2025-07-01T10:00:00Z",
    "resetCount": 0
  }
}
```

---

### 2.3 Create Portfolio

**`POST /portfolios`** *(requires auth)*

**Request:**
```json
{
  "name": "Dividend Income",
  "startingCapital": 50000.00
}
```

**Validation:**
- `name`: 1–50 chars, required.
- `startingCapital`: 1,000 – 1,000,000. Default: 100,000.
- User must have fewer than 5 active non-contest portfolios.

**Response (201 Created):**
```json
{
  "success": true,
  "data": {
    "id": "port_003",
    "name": "Dividend Income",
    "startingCapital": 50000.00,
    "cashBalance": 50000.00,
    "totalValue": 50000.00,
    "positionsCount": 0,
    "createdAt": "2025-07-10T15:00:00Z"
  }
}
```

**Errors:**
- `422 UNPROCESSABLE` — Maximum portfolio limit reached (5).

---

### 2.4 Update Portfolio

**`PATCH /portfolios/:id`** *(requires auth)*

Update portfolio name.

**Request:**
```json
{
  "name": "High Dividend Income"
}
```

**Response (200 OK):** Updated portfolio object.

---

### 2.5 Reset Portfolio

**`POST /portfolios/:id/reset`** *(requires auth)*

Reset portfolio to starting state. Closes all positions, cancels all orders, restores cash to starting capital.

**Request:**
```json
{
  "confirm": true
}
```

**Response (200 OK):**
```json
{
  "success": true,
  "data": {
    "id": "port_001",
    "name": "Growth Portfolio",
    "cashBalance": 100000.00,
    "totalValue": 100000.00,
    "positionsCount": 0,
    "resetCount": 1,
    "message": "Portfolio reset to $100,000.00. All positions closed and orders cancelled."
  }
}
```

---

### 2.6 Clone Portfolio

**`POST /portfolios/:id/clone`** *(requires auth)*

Create a new portfolio with the same positions and allocations.

**Request:**
```json
{
  "name": "Growth Portfolio (Copy)"
}
```

**Response (201 Created):** New portfolio object with cloned positions.

---

### 2.7 Delete Portfolio

**`DELETE /portfolios/:id`** *(requires auth)*

Soft delete a portfolio (sets `is_active = 0`).

**Response (200 OK):**
```json
{
  "success": true,
  "data": {
    "message": "Portfolio deleted successfully"
  }
}
```

---

## 3. Trading

### 3.1 Place Order

**`POST /trading/orders`** *(requires auth)*

**Request (Market Order):**
```json
{
  "portfolioId": "port_001",
  "symbol": "AAPL",
  "side": "buy",
  "orderType": "market",
  "quantity": 10
}
```

**Request (Limit Order):**
```json
{
  "portfolioId": "port_001",
  "symbol": "AAPL",
  "side": "buy",
  "orderType": "limit",
  "quantity": 10,
  "limitPrice": 190.00,
  "timeInForce": "gtc"
}
```

**Request (Stop Order):**
```json
{
  "portfolioId": "port_001",
  "symbol": "AAPL",
  "side": "sell",
  "orderType": "stop",
  "quantity": 10,
  "stopPrice": 180.00,
  "timeInForce": "day"
}
```

**Request (Stop-Limit Order):**
```json
{
  "portfolioId": "port_001",
  "symbol": "AAPL",
  "side": "sell",
  "orderType": "stop_limit",
  "quantity": 10,
  "stopPrice": 180.00,
  "limitPrice": 179.50,
  "timeInForce": "gtc"
}
```

**Validation Rules:**
- `symbol`: Valid US equity/ETF ticker.
- `quantity`: > 0, integer only (no fractional shares in v1).
- `side`: "buy" or "sell".
- `orderType`: "market", "limit", "stop", "stop_limit".
- Buy orders: `quantity * currentPrice <= cashBalance`.
- Sell orders: `quantity <= position.quantity` for the symbol.
- `limitPrice` required for "limit" and "stop_limit".
- `stopPrice` required for "stop" and "stop_limit".
- Market must be open for market orders (or queued for next open).

**Response (201 Created) — Market Order (immediate fill):**
```json
{
  "success": true,
  "data": {
    "order": {
      "id": "ord_001",
      "portfolioId": "port_001",
      "symbol": "AAPL",
      "side": "buy",
      "orderType": "market",
      "quantity": 10,
      "status": "filled",
      "filledQuantity": 10,
      "filledPrice": 195.44,
      "filledAt": "2025-07-10T14:30:05Z",
      "createdAt": "2025-07-10T14:30:05Z"
    },
    "transaction": {
      "id": "txn_001",
      "symbol": "AAPL",
      "side": "buy",
      "quantity": 10,
      "price": 195.44,
      "totalAmount": 1954.40,
      "slippage": 0.02,
      "executedAt": "2025-07-10T14:30:05Z"
    },
    "portfolio": {
      "cashBalance": 43276.10,
      "totalValue": 112452.75
    }
  }
}
```

**Response (201 Created) — Limit Order (pending):**
```json
{
  "success": true,
  "data": {
    "order": {
      "id": "ord_002",
      "portfolioId": "port_001",
      "symbol": "AAPL",
      "side": "buy",
      "orderType": "limit",
      "quantity": 10,
      "limitPrice": 190.00,
      "timeInForce": "gtc",
      "status": "open",
      "filledQuantity": 0,
      "expiresAt": "2025-08-09T20:00:00Z",
      "createdAt": "2025-07-10T14:35:00Z"
    }
  }
}
```

**Errors:**
- `422 UNPROCESSABLE` — Insufficient funds, insufficient shares, or market closed.
- `400 VALIDATION_ERROR` — Invalid symbol, quantity, or order parameters.

---

### 3.2 Cancel Order

**`DELETE /trading/orders/:id`** *(requires auth)*

Cancel a pending or open order.

**Response (200 OK):**
```json
{
  "success": true,
  "data": {
    "id": "ord_002",
    "status": "cancelled",
    "cancelledAt": "2025-07-10T14:40:00Z",
    "message": "Limit buy order for 10 AAPL @ $190.00 cancelled"
  }
}
```

**Errors:**
- `422 UNPROCESSABLE` — Order is already filled, cancelled, or expired.

---

### 3.3 List Orders

**`GET /trading/orders`** *(requires auth)*

**Query Parameters:**
- `portfolioId` (required) — Filter by portfolio.
- `status` (optional) — Filter: "pending", "open", "filled", "cancelled", "expired", "rejected".
- `symbol` (optional) — Filter by ticker.
- `side` (optional) — Filter: "buy" or "sell".
- `limit` (int, default: 50, max: 100)
- `cursor` (string)

**Response (200 OK):**
```json
{
  "success": true,
  "data": [
    {
      "id": "ord_001",
      "portfolioId": "port_001",
      "symbol": "AAPL",
      "side": "buy",
      "orderType": "market",
      "quantity": 10,
      "status": "filled",
      "filledQuantity": 10,
      "filledPrice": 195.44,
      "filledAt": "2025-07-10T14:30:05Z",
      "createdAt": "2025-07-10T14:30:05Z"
    },
    {
      "id": "ord_002",
      "portfolioId": "port_001",
      "symbol": "AAPL",
      "side": "buy",
      "orderType": "limit",
      "quantity": 10,
      "limitPrice": 190.00,
      "timeInForce": "gtc",
      "status": "cancelled",
      "filledQuantity": 0,
      "cancelledAt": "2025-07-10T14:40:00Z",
      "createdAt": "2025-07-10T14:35:00Z"
    }
  ],
  "pagination": {
    "hasMore": false,
    "total": 2
  }
}
```

---

### 3.4 Get Order Detail

**`GET /trading/orders/:id`** *(requires auth)*

**Response (200 OK):** Full order object (same schema as list item).

---

### 3.5 List Transactions

**`GET /trading/transactions`** *(requires auth)*

**Query Parameters:**
- `portfolioId` (required)
- `symbol` (optional)
- `side` (optional)
- `startDate` (optional, ISO 8601)
- `endDate` (optional, ISO 8601)
- `limit` (int, default: 50, max: 200)
- `cursor` (string)
- `format` (optional) — "json" (default) or "csv"

**Response (200 OK):**
```json
{
  "success": true,
  "data": [
    {
      "id": "txn_001",
      "orderId": "ord_001",
      "symbol": "AAPL",
      "companyName": "Apple Inc.",
      "side": "buy",
      "quantity": 10,
      "price": 195.44,
      "totalAmount": 1954.40,
      "commission": 0,
      "slippage": 0.02,
      "realizedPnl": null,
      "executedAt": "2025-07-10T14:30:05Z"
    }
  ],
  "pagination": {
    "hasMore": false,
    "total": 1
  }
}
```

**CSV Response** (when `format=csv`):
```
Content-Type: text/csv
Content-Disposition: attachment; filename="transactions_port_001.csv"

Date,Symbol,Side,Quantity,Price,Total,Commission,P&L
2025-07-10 14:30:05,AAPL,buy,10,195.44,1954.40,0.00,
```

---

## 4. Market Data

### 4.1 Get Quote

**`GET /market/quote/:symbol`** *(requires auth)*

Get current price quote for a symbol.

**Response (200 OK):**
```json
{
  "success": true,
  "data": {
    "symbol": "AAPL",
    "companyName": "Apple Inc.",
    "price": 195.42,
    "change": 1.23,
    "changePercent": 0.63,
    "open": 194.50,
    "high": 196.10,
    "low": 193.80,
    "previousClose": 194.19,
    "volume": 54321000,
    "avgVolume": 62000000,
    "marketCap": 3010000000000,
    "peRatio": 32.5,
    "week52High": 199.62,
    "week52Low": 164.08,
    "exchange": "NASDAQ",
    "sector": "Technology",
    "industry": "Consumer Electronics",
    "isMarketOpen": true,
    "lastUpdated": "2025-07-10T14:30:00Z",
    "delayed": true,
    "delayMinutes": 15
  }
}
```

---

### 4.2 Get Batch Quotes

**`GET /market/quotes`** *(requires auth)*

Get quotes for multiple symbols at once.

**Query Parameters:**
- `symbols` (required) — Comma-separated list, max 20.

```
GET /market/quotes?symbols=AAPL,GOOGL,MSFT,SPY
```

**Response (200 OK):**
```json
{
  "success": true,
  "data": {
    "AAPL": { "price": 195.42, "change": 1.23, "changePercent": 0.63 },
    "GOOGL": { "price": 178.55, "change": 0.85, "changePercent": 0.48 },
    "MSFT": { "price": 445.20, "change": -2.10, "changePercent": -0.47 },
    "SPY": { "price": 555.80, "change": 3.20, "changePercent": 0.58 }
  }
}
```

---

### 4.3 Get Historical Data

**`GET /market/historical/:symbol`** *(requires auth)*

Get historical OHLCV data.

**Query Parameters:**
- `period` (optional) — "1m", "3m", "6m", "1y", "2y", "5y". Default: "1y".
- `interval` (optional) — "1d", "1wk", "1mo". Default: "1d".

**Response (200 OK):**
```json
{
  "success": true,
  "data": {
    "symbol": "AAPL",
    "period": "1y",
    "interval": "1d",
    "dataPoints": 252,
    "prices": [
      {
        "date": "2024-07-10",
        "open": 228.50,
        "high": 231.20,
        "low": 227.80,
        "close": 230.10,
        "volume": 48500000,
        "adjustedClose": 228.95
      },
      {
        "date": "2024-07-11",
        "open": 230.50,
        "high": 232.00,
        "low": 229.10,
        "close": 231.45,
        "volume": 52100000,
        "adjustedClose": 230.29
      }
    ]
  }
}
```

---

### 4.4 Search Symbols

**`GET /market/search`** *(requires auth)*

Search for symbols by ticker or company name.

**Query Parameters:**
- `q` (required) — Search query, min 1 char.
- `limit` (optional, default: 10, max: 20)

```
GET /market/search?q=app&limit=5
```

**Response (200 OK):**
```json
{
  "success": true,
  "data": [
    {
      "symbol": "AAPL",
      "name": "Apple Inc.",
      "exchange": "NASDAQ",
      "type": "equity",
      "sector": "Technology"
    },
    {
      "symbol": "APLE",
      "name": "Apple Hospitality REIT Inc.",
      "exchange": "NYSE",
      "type": "equity",
      "sector": "Real Estate"
    },
    {
      "symbol": "APPN",
      "name": "Appian Corporation",
      "exchange": "NASDAQ",
      "type": "equity",
      "sector": "Technology"
    }
  ]
}
```

---

### 4.5 Get Company Info

**`GET /market/company/:symbol`** *(requires auth)*

**Response (200 OK):**
```json
{
  "success": true,
  "data": {
    "symbol": "AAPL",
    "name": "Apple Inc.",
    "description": "Apple Inc. designs, manufactures, and markets smartphones...",
    "sector": "Technology",
    "industry": "Consumer Electronics",
    "exchange": "NASDAQ",
    "marketCap": 3010000000000,
    "employees": 164000,
    "website": "https://www.apple.com",
    "ceo": "Tim Cook",
    "dividendYield": 0.0055,
    "peRatio": 32.5,
    "eps": 6.01,
    "beta": 1.28
  }
}
```

---

## 5. Strategies

### 5.1 List Strategies

**`GET /strategies`** *(requires auth)*

**Response (200 OK):**
```json
{
  "success": true,
  "data": [
    {
      "id": "strat_001",
      "name": "Golden Cross",
      "description": "Buy when 50-day SMA crosses above 200-day SMA",
      "type": "rules",
      "symbols": ["AAPL", "GOOGL", "MSFT"],
      "version": 3,
      "validationStatus": "valid",
      "attachedPortfolioId": "port_001",
      "backtestCount": 5,
      "bestBacktestReturn": 0.234,
      "createdAt": "2025-07-05T10:00:00Z",
      "updatedAt": "2025-07-10T12:00:00Z"
    }
  ],
  "pagination": {
    "hasMore": false,
    "total": 1
  }
}
```

---

### 5.2 Create Strategy (Rules-Based)

**`POST /strategies`** *(requires auth)*

**Request:**
```json
{
  "name": "Golden Cross",
  "description": "Buy when 50-day SMA crosses above 200-day SMA, sell on death cross",
  "type": "rules",
  "symbols": ["AAPL"],
  "config": {
    "rules": [
      {
        "id": "rule_1",
        "name": "Golden Cross Buy",
        "conditions": {
          "operator": "AND",
          "items": [
            {
              "indicator": "SMA",
              "params": { "period": 50, "symbol": "AAPL" },
              "comparison": "crosses_above",
              "target": {
                "indicator": "SMA",
                "params": { "period": 200, "symbol": "AAPL" }
              }
            }
          ]
        },
        "action": {
          "type": "buy",
          "symbol": "AAPL",
          "quantity_type": "percent_of_portfolio",
          "quantity": 20
        }
      }
    ],
    "universe": ["AAPL"],
    "rebalance_frequency": "daily"
  }
}
```

**Response (201 Created):** Full strategy object.

---

### 5.3 Create Strategy (Code-Based)

**`POST /strategies`** *(requires auth)*

**Request:**
```json
{
  "name": "Mean Reversion",
  "description": "Buy when RSI < 30, sell when RSI > 70",
  "type": "code",
  "symbols": ["AAPL", "GOOGL"],
  "code": "// Strategy: Mean Reversion\n// This runs once per trading day\n\nconst symbols = ['AAPL', 'GOOGL'];\n\nfor (const symbol of symbols) {\n  const data = getData(symbol, '1m');\n  const rsi = calculateRSI(data, 14);\n  const position = getPosition(symbol);\n  \n  if (rsi < 30 && !position) {\n    // Oversold - buy\n    buy(symbol, 10);\n  } else if (rsi > 70 && position) {\n    // Overbought - sell all\n    sell(symbol, position.quantity);\n  }\n}\n\nfunction calculateRSI(data, period) {\n  // RSI calculation\n  const closes = data.map(d => d.close);\n  let gains = 0, losses = 0;\n  for (let i = closes.length - period; i < closes.length; i++) {\n    const change = closes[i] - closes[i-1];\n    if (change > 0) gains += change;\n    else losses -= change;\n  }\n  const avgGain = gains / period;\n  const avgLoss = losses / period;\n  const rs = avgGain / avgLoss;\n  return 100 - (100 / (1 + rs));\n}"
}
```

**Response (201 Created):** Full strategy object.

---

### 5.4 Update Strategy

**`PUT /strategies/:id`** *(requires auth)*

Updates the strategy and increments the version number.

**Request:** Same as create (name, description, config/code, symbols).

**Response (200 OK):** Updated strategy object with incremented version.

---

### 5.5 Validate Strategy

**`POST /strategies/:id/validate`** *(requires auth)*

Run syntax check and dry run on a strategy.

**Response (200 OK) — Valid:**
```json
{
  "success": true,
  "data": {
    "valid": true,
    "warnings": [
      "Strategy only trades 1 symbol. Consider diversifying."
    ],
    "estimatedSignals": 12,
    "symbolsUsed": ["AAPL"],
    "validatedAt": "2025-07-10T15:00:00Z"
  }
}
```

**Response (200 OK) — Invalid:**
```json
{
  "success": true,
  "data": {