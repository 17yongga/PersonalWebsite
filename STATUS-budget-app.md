# Budget App — STATUS.md
> Updated: 2026-04-03 (23:33 EDT)

## Infrastructure
- **receipt-server** (PM2 id:5, port 3002) — receipt/screenshot scan backend, Groq vision API, proxied at `api.gary-yong.com/receipt`. Part of Flowt — needed, do not remove.

## What's Live
- **URL:** https://gary-yong.com/budget.html (frontend via S3/CloudFront)
- **App name:** Flowt (confirmed 2026-03-14)
- Full login/register system, shared vs. individual expense tracking, Chart.js visualizations
- Backend: PM2 `budget-server` on EC2, port 3002, online
- Receipt scanner: PM2 `receipt-server` on EC2, port 3002 (proxied via nginx)

## Current State (2026-04-03)

### Build #16 (2f2829e) — IN PROGRESS ~23:33 ET
- EAS URL: https://expo.dev/accounts/17yongga/projects/flowt/builds/c000ac5c-c152-4e4b-b7b5-b024f7fad9e1
- Profile: preview-device (installs on iPhone)
- **This is the build to install**

**Build #16 Changes (6 commits):**
1. Scan Receipt: custom split ratio per item when marked Shared (presets 50/50, 60/40, 70/30 + custom input)
2. Transactions: 4-lane colour coding — Shared·Mine (blue), Shared·Partner (amber), Solo·Mine (green), Solo·Partner (purple)
3. Paywall: RC native paywall shown directly — placeholder error screen removed
4. Budget: "Shared Budget" concept removed → Household Budget = sum of all members' personal budgets
5. Charts: combined view uses household budget total (Gary + Emily = $10,500)
6. Dashboard: budget bar uses household total instead of "shared" type

**RC Error 23 on test builds:** Expected — Apple sandbox doesn't recognise IAPs until App Review. Not fixable until v1.0 submission. Will work automatically in production.

### Build #15 (cfbd5f8) — SUPERSEDED
- EAS URL: https://expo.dev/accounts/17yongga/projects/flowt/builds/071cbba1-ecb7-4c54-9b1f-1aaa7f2a1f4c
- Profile: preview-device (installs on iPhone)
- **This is the build to install**

**Build #15 Changes:**
1. Paywall: removed hardcoded placeholder screen — RC native paywall always shown directly
2. Transactions: colour-coded rows (blue=Mine, amber=Partner, green=Solo) with tinted backgrounds + badges — matches category drill-down style

### Build #14 (9a9e9e8) — FINISHED (superseded)
- Root cause fix: all `({ pressed }) =>` dynamic Pressable styles replaced with static styles
- This fixed buttons rendering transparent on device

### Build #13 (9e601f6) — FINISHED (superseded)
- Add Expense background hardcoded to #3B6FD4

### Build #12 (9b40b7d) — FINISHED (superseded)
- UI fixes: buttons, scan receipt overhaul, settlement card, budget settings link

### Build #11 (b9dafa2) — FINISHED (superseded by above)

### Tonight's Session (2026-04-03) — Full Changelog

**UI Fixes (all builds 12–15):**
1. ✅ Add/Scan buttons — static background colours (no more transparent rendering on device)
2. ✅ Scan Receipt — dark navy header, X button accessible, Take Photo solid blue CTA, tips card
3. ✅ Settlement balance card — compact row layout, thin accent strip, no more 48px fullbleed band
4. ✅ Settings — Budget Settings row added under new "Budget" section (screen existed but was unlinked)
5. ✅ Transactions — colour-coded rows matching category drill-down (Mine/Partner/Solo badges + tints)
6. ✅ Paywall — removed placeholder, RC native paywall shown directly

**RevenueCat (done via browser):**
- ✅ `flowt_lifetime` IAP created in App Store Connect (non-consumable, $99.99, 175 countries, localized)
- ✅ RC product `flowt_lifetime` created + attached to "Flowt Pro" entitlement
- ✅ All 3 packages mapped: Monthly→flowt_monthly, Yearly→flowt_yearly, Lifetime→flowt_lifetime
- ⚠️ Paywall may still fail until products go through App Review at least once (Apple sandbox limitation)

**Root cause discovered:** `style={({ pressed }) => ({...})}` on Pressable fails silently on device — backgrounds render transparent. Fixed across all screens by switching to static `style={{...}}` objects.

### Next Actions
- [ ] Install Build #16 on iPhone + full QA pass
- [ ] Test: 4-lane transaction colours, scan receipt custom split, budget amounts
- [ ] App Store screenshots (5 screens: Dashboard, Transactions, Charts, Settlement, Scan Receipt)
- [ ] App Store submission (blocked on screenshots)
- [ ] Budget Settings: rename "Shared Budget" label → "Household Budget" in the UI
- [ ] PostgreSQL migration (SQLite → AWS RDS)
- [ ] Google Play Developer account ($25)

## App Store Connect Status
- ✅ Flowt Pro Monthly — $9.99 USD, 175 countries
- ✅ Flowt Pro Yearly — $79.99 USD, 175 countries
- ✅ Flowt Pro Lifetime — $99.99 USD, 175 countries (non-consumable, added tonight)
- All show "Missing Metadata" — normal until first App Review submission

## RevenueCat Status
- ✅ Default offering configured with 3 packages
- ✅ Monthly ($rc_monthly) → flowt_monthly (App Store)
- ✅ Yearly ($rc_annual) → flowt_yearly (App Store)
- ✅ Lifetime ($rc_lifetime) → flowt_lifetime (App Store)
- ✅ "Flowt Pro" entitlement attached to all 3 products

## Decisions
- 2026-03-14: App name confirmed as **Flowt**
- 2026-03-16: Logo finalised
- 2026-03-24: Pricing locked — Monthly $9.99 / Yearly $79.99 / Lifetime $99.99
- 2026-03-25: Settlement page fully redesigned
- 2026-03-25: Xcode 16.3 / Swift 6.1 compatibility achieved via source patches
- 2026-04-03: Root cause found — Pressable dynamic styles fail on device → use static styles
- 2026-04-03: "Shared budget" concept to be removed → replaced with "Household budget" (total combined)

## Deploy Commands
```bash
# Frontend
aws s3 cp ~/clawd/PersonalWebsite/budget.html s3://gary-yong.com/budget.html --profile clawdbot-deploy
aws cloudfront create-invalidation --distribution-id EUVZ94LCG1QV2 --paths "/budget.html" --profile clawdbot-deploy

# Backend (households.js)
scp -i ~/.ssh/id_ed25519 ~/clawd/PersonalWebsite/budget-server/households.js ubuntu@52.86.178.139:/home/ubuntu/budget-server/
ssh ubuntu@52.86.178.139 -i ~/.ssh/id_ed25519 "pm2 restart budget-server"
```

## Key Files
- `budget.html` — frontend (S3)
- `/home/ubuntu/budget-server/households.js` — API routes
- `/home/ubuntu/receipt-server.js` — AI vision scanner (Llama 4 Scout via Groq)
- `/home/ubuntu/budget-server/finsync.db` — SQLite DB
- `~/clawd/flowt-app/app/(app)/(tabs)/index.tsx` — dashboard
- `~/clawd/flowt-app/app/(app)/(tabs)/settlement.tsx` — settlement
- `~/clawd/flowt-app/app/(app)/(tabs)/transactions.tsx` — transactions
- `~/clawd/flowt-app/app/(onboarding)/paywall.tsx` — paywall
