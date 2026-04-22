# Budget App — STATUS.md
> Updated: 2026-04-07 (17:21 EDT)

## Business Registration (CRA)
- **Business Number (BN9):** 78908 2971
- **GST/HST Account:** 78908 2971 RT0001
- **Registered:** 2026-04-11
- **GST/HST filing:** Annual (voluntary registration, under $30K threshold)

## Infrastructure
- **receipt-server** (PM2 id:5, port 3002) — receipt/screenshot scan backend, Groq vision API, proxied at `api.gary-yong.com/receipt`. Part of Flowt — needed, do not remove.

## What's Live
- **URL:** https://gary-yong.com/budget.html (frontend via S3/CloudFront)
- **App name:** Flowt (confirmed 2026-03-14)
- Full login/register system, shared vs. individual expense tracking, Chart.js visualizations
- Backend: PM2 `budget-server` on EC2, port 3002, online
- Receipt scanner: PM2 `receipt-server` on EC2, port 3002 (proxied via nginx)

## Current State (2026-04-15)

### 📱 v1.0.1 Bug Fix Sprint (Apr 15 session)
- **Scan receipt — skip edit screen:** "Add X Transactions" now POSTs directly to API, no more per-item Add Expense modal
- **Category auto-correct:** AI-returned categories auto-matched to existing emoji categories via alias map (rent→🏠 Rent/Mortgage, etc.)
- **Category picker on review screen:** Tappable category on each scanned item with searchable dropdown
- **Date post-processing:** `normalizeReceiptDate` clamps wrong years (>1yr off → current year), future dates → today
- **Tappable date on review screen:** Inline date editor with "Use today" quick button
- **Overlay animations fixed:** Smooth opacity+translateY transitions, no more background jumping; body scroll locked on open
- **Keyboard dismiss:** Tapping outside form inputs now dismisses keyboard
- **Dashboard/Charts stat cards:** Numbers auto-shrink to fit (no more 2-line wrapping)
- **"My Transactions" filter:** New filter pill showing all transactions user paid for + all shared
- **Add/Edit expense form compacted:** Amount+Category and Date+Notes side-by-side; Quick Summary card removed
- **Receipt server model swap:** Groq Llama 4 Maverick → Llama 4 Scout (vision-capable, free)
- **Version bumped:** v1.0.1 build 16, committed and pushed to GitHub
- **EAS build:** Upload hanging from CLI — Gary running manually

### 🔄 App Store Review — Round 2 IN PROGRESS (Apr 13)
- Gary submitted another round of App Store review after Apple rejection (Guideline 2.1(b))
- **Rejection reason:** Apple asked 4 questions about the monetization model
- **Response sent:** Clarified Flowt Pro IAP features, no external purchase paths
- **Now waiting for Apple review response**

### 📱 Code Changes (Apr 13 session)
- Dashboard: Together/Personal sections → navigate to Transactions pre-filtered
- Dashboard: Balance section tappable → Settle page
- Settings: N-member household support
- Settlement: N-member balance calc
- All changes committed to GitHub (commit 8df47a5)

### 🎉 App Store Submission — SUBMITTED FOR REVIEW ✅ (Apr 7)
- Gary submitted Flowt v1.0 to App Store Connect for review
- Production build (0d0d0093) used for submission
- EAS URL: https://expo.dev/accounts/17yongga/projects/flowt/builds/0d0d0093-6517-4249-b0c5-bdc0e1681eae
- Signed: dist cert 74AEB572 (valid until Mar 2027), provisioning profile 59D99DX3P8

### Build #16 (2f2829e) — FINISHED ✅ (superseded by production build)
- EAS URL: https://expo.dev/accounts/17yongga/projects/flowt/builds/c000ac5c-c152-4e4b-b7b5-b024f7fad9e1
- Profile: preview-device (installs on iPhone)

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

### Tonight's Session (2026-04-04)
**App Store Submission Prep:**
1. ✅ App Store metadata prepared (Opus quality) — Name, Subtitle, Keywords, Description, What's New
2. ✅ Demo accounts documented — gary@flowt.app + emily@flowt.app / Flowt2026!
3. ✅ App Review notes written — Error 23 explained, shared expense flow walkthrough, permissions listed
4. ✅ Screenshots received from Gary (6 files)
5. ✅ Production build queued and FINISHED — IPA ready

### Next Actions
- [x] ~~Submit for App Store Review~~ ✅ (Apr 7)
- [x] ~~Respond to Apple Guideline 2.1(b) rejection~~ ✅ (Apr 13)
- [x] ~~Submit Round 2 for App Store Review~~ ✅ (Apr 13)
- [x] ~~v1.0.1 bug fixes~~ ✅ (Apr 15) — 10+ fixes committed
- [ ] Wait for Apple review response — Round 2 in progress
- [ ] Complete EAS production build for v1.0.1 (upload hanging — Gary to run manually)
- [ ] Submit v1.0.1 to App Store Connect
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
- `/home/ubuntu/receipt-server.js` — AI vision scanner (Llama 4 Scout via Groq, fallback from Maverick)
- `/home/ubuntu/budget-server/finsync.db` — SQLite DB
- `~/clawd/flowt-app/app/(app)/(tabs)/index.tsx` — dashboard
- `~/clawd/flowt-app/app/(app)/(tabs)/settlement.tsx` — settlement
- `~/clawd/flowt-app/app/(app)/(tabs)/transactions.tsx` — transactions
- `~/clawd/flowt-app/app/(onboarding)/paywall.tsx` — paywall
