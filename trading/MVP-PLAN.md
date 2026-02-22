# PaperTrade MVP Plan

## Core User Journey (Must Work End-to-End)
1. **Sign Up** → Create account with email/password
2. **Create Portfolio** → Set name + starting cash (e.g., $100K)
3. **Search & Research** → Find stocks, see quotes/prices
4. **Place Trade** → Buy/sell stocks from portfolio cash
5. **View Portfolio** → See positions, P&L, cash balance, order history
6. **Manage Watchlist** → Track symbols of interest
7. **View Profile** → Account settings

## MVP Pages (7 total)
| Page | Status | Notes |
|------|--------|-------|
| Login/Register | ✅ Working | Auth flow complete |
| Dashboard | 🔧 Needs polish | Portfolio cards, watchlist, welcome name |
| Portfolio Detail | ❌ Stub | CRITICAL - need positions, P&L, orders, cash |
| Trading | 🔧 Needs testing | Order form, symbol search, order book |
| Profile | ✅ Built | Display name, password change |
| 404 | ✅ Built | Good design |
| Settings | ❌ Missing | Nav links to #/settings but no route |

## Pages to REMOVE from Nav (Post-MVP)
- Strategies (backend exists but no frontend)
- Contests (not built)
- Leaderboard (not built)

## Key Fixes Needed
1. Portfolio detail page - full build
2. Remove post-MVP nav items
3. Fix Settings 404 (merge into Profile or add route)
4. Trading page - verify end-to-end flow
5. Dashboard - portfolio cards with real data
6. Mobile responsiveness throughout
7. Onboarding - empty state guidance
