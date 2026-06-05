# Budget App — STATUS.md
> Updated: 2026-05-31 (13:24 EDT)

## Business Registration (CRA)
- **Business Number (BN9):** 78908 2971
- **GST/HST Account:** 78908 2971 RT0001
- **Registered:** 2026-04-11
- **GST/HST filing:** Annual (voluntary registration, under $30K threshold)

## Infrastructure
- **receipt-server** (PM2 id:5, port 3002) — receipt/screenshot scan backend, Groq vision API, proxied at `api.gary-yong.com/receipt`. Part of Flowt — needed, do not remove.

## What's Live
- **URL:** https://gary-yong.com/budget.html (frontend via S3/CloudFront)
- **Flowt landing:** https://useflowt.app/ (S3 bucket `useflowt-app-site-628063714079`, CloudFront `E2OGDPVMTBXKHP`)
- **App name:** Flowt (confirmed 2026-03-14)
- Full login/register system, shared vs. individual expense tracking, Chart.js visualizations
- Backend: PM2 `budget-server` on EC2, port 3002, online
- Receipt scanner: PM2 `receipt-server` on EC2, port 3002 (proxied via nginx)

## Current State (2026-06-04)
- **Android Play Store prep is partially complete locally:** Android package remains `com.garyyong.flowt`; `eas.json` now has Android submit profile targeting Play internal testing; `RECORD_AUDIO` is blocked from the Android manifest (`tools:node="remove"`) because Flowt scans receipts but does not record audio; RevenueCat Android SDK key is externalized to `EXPO_PUBLIC_REVENUECAT_ANDROID_API_KEY`; Google Play listing draft, Data Safety notes, and 1024×500 feature graphic are prepared under `flowt-app/store/google/`; billing checklist is saved at `flowt-app/docs/android-billing-revenuecat-checklist.md`. **Blocked on Gary/console access:** Google Play Developer account/app creation, Google Play products, RevenueCat Android app/key, service account, and first manual AAB upload.
- **Verification:** Android prep checks passed: `npm run test:ui-logic` passed 27/27; Expo introspection confirmed `com.garyyong.flowt` and `RECORD_AUDIO` manifest entry has `tools:node="remove"`; `store/google/feature-graphic.png` verifies at 1024×500; JSON config parse passed. `npx tsc --noEmit` still fails only on pre-existing `marketing/remotion-demo` missing `remotion` types. `npx expo-doctor` still reports pre-existing SDK/Xcode and Expo patch-version warnings.
- **Flowt v1.0.3 bug-fix work is local only — no EAS credits used.** App version bumped to `1.0.3` in `flowt-app/app.json`; no production build submitted.
- **Charts freeze guard prepared:** global API requests now abort after 15s instead of hanging forever; Charts `loadData` now always clears spinner/refresh state in `finally`, ignores stale overlapping requests, clears partial chart state on failure, and shows a retryable error card instead of leaving users stuck on an infinite spinner.
- **Shared expense share display prepared:** Transactions rows now use a tighter compact layout: the full transaction amount stays on the right and the current user's `Your share $X.XX` appears directly underneath it, with custom split percentage shown below when not 50/50.
- **Charts overlay edit flow prepared:** Category breakdown overlay transactions are now tappable edit targets with smoother state transitions. Tapping a listed transaction keeps the breakdown context visible and opens an opaque edit overlay on top; after save, Charts reloads only when editable fields actually changed, shows a subtle `Updating charts…` / `Charts updated` notice, and keeps the user in the originally opened breakdown. If a transaction is moved to another category, it disappears from the current category list instead of jumping the user to the new category.
- **Charts usefulness/polish pass prepared:** Category Breakdown now has a `Biggest driver` summary; the old raw `Partner Split (Shared)` diagram is replaced with a more useful `Shared Balance` card showing who paid vs. actual responsibility after equal/custom split rules; Monthly Trend now scales bars to spending instead of flattening them against an out-of-range household budget line.
- **Budget Settings fixed/tested:** removed the confusing editable `Shared Budget` field, now saves/copies only the current user's personal budget, prefers exact user-specific budget rows over legacy `user_id: null` rows, shows household total as the sum of member personal budgets, and validates empty/negative/non-numeric values before save.
- **Flowt Assistant MVP backend is live with OpenAI enabled:** `POST /api/ai/chat` is deployed to production behind JWT auth and household scoping. Gary configured the OpenAI key directly on the server; it is not stored in workspace memory/docs. Authenticated smoke returned `providerStatus: ok`, model `gpt-4.1-mini`, 557 input tokens, 268 output tokens, estimated cost **$0.0007**, 3 cards, and `mode: read_only`.
- **Flowt Assistant mobile UI remains local until next app build:** Dashboard has a top-right sparkle entry and `FlowtAssistantModal`; no EAS build has been started, so no build credits used.
- **Legal links cleaned up for next mobile/App Store pass:** app Settings now uses `https://useflowt.app/terms.html` and `https://useflowt.app/flowt-privacy.html` instead of Gary's personal website, and App Store metadata/support copy now points to the Flowt domain. Live Flowt legal/support pages all return 200.
- **Budget Space Phase 0 QA/hardening complete locally:** household UX now moves from couple-first language to generic Budget Space modes. Onboarding lets Gary choose `Just me`, `Partner`, or `Friends / roommates` and explicitly says a group can be two friends. Settings now shows/updates the budget-space type, keeps two-person friend spaces as `group` instead of forcing “couple,” hides `Just me` for already-shared spaces, and now prevents 3+ spaces from offering `partner`. Backend prep adds `households.relationship_type`, owner-only `PUT /api/households/:id`, validation for `solo` / `partner` / `group`, and expense hardening for member-only payers, positive amount, valid date, valid split type, custom split bounds, and solo personal-only expenses. Backend changes remain local and are not deployed yet.
- **Verification:** production backend was backed up to `/home/ubuntu/budget-server/backups/deploy-20260604-180556/`, syntax checks passed, remote `npm test` passed, PM2 `budget-server` was restarted only, live health returned 200, unauthenticated `/api/ai/chat` returned 401, authenticated smoke returned a real OpenAI response, and assistant smoke metadata rows were deleted afterward so Gary's free teaser quota was not consumed by testing. Follow-up smoke on 2026-06-04 20:55 EDT confirmed health 200, unauth `/api/ai/chat` 401, real OpenAI response `providerStatus: ok` with model `gpt-4.1-mini`, 3 cards, estimated cost **$0.0007**, and post-cleanup Gary June assistant usage rows = 0. Latest local QA checks: mobile `npm run test:ui-logic` passes **29/29**, backend `npm test` passes **37/37**, backend syntax checks pass, and all capture harnesses passed (`capture:fixes`, `capture:budget-settings`, `capture:assistant`, `capture:journeys`, `capture:budget-space`). Budget Space artifacts now include onboarding, two-person group, 3+ group, and solo Settings screenshots.
- **Known local environment checks:** `npx tsc --noEmit` still only fails on pre-existing `marketing/remotion-demo` missing `remotion` types; no changed app files report TS errors. `npx expo-doctor` reports pre-existing SDK/Xcode/package patch-version warnings; not addressed to avoid changing build inputs during this bug-fix pass.

## Current State (2026-06-03)
- **Backend settlement/JWT fix is live on production:** SSH access was restored, `/home/ubuntu/budget-server` and `finsync.db` were backed up under `backups/deploy-20260603-231308/`, backend files were deployed, a new production `JWT_SECRET` was generated into `ecosystem.config.js`, and only PM2 process `budget-server` was restarted.
- **Production verification:** `https://api.gary-yong.com/budget/api/health` returns 200; old default-secret JWT returns 401 `Invalid token`; unauthenticated `/api/households/1/balance` returns 401; authenticated production `/api/households/1/balance` returns Gary net **-$454.73**, Emily net **+$454.73**, suggested settlement **Gary → Emily Bi $454.73**, legacy cutoff `2026-05-11`, shared total `$7,609.70`, personal total `$37,264.78`.
- **Correct current Archie Home settlement:** under the latest-settlement-resets-balance model, Gary owes Emily **$454.73**. Regression test added for this exact scenario.
- **Backend changes live:** JWT secret fallback removed, production hard-fails if `JWT_SECRET` is missing/default/too short; backend balance engine + `/api/households/:id/balance` endpoint added; directional settlement fields added with backwards-compatible schema migration; settlement creation now requires explicit `fromUserId`/`toUserId`.
- **App Store update submitted for review:** build 17 was uploaded but used already-live version `1.0.1`, so a proper update was prepared as `1.0.2`. App Store Connect metadata for `1.0.2` was synced, EAS iOS production build `5e83d0e1-b1b5-4ffe-b7ad-38592ada3d7d` finished as build `18`, the binary was uploaded to App Store Connect, Gary manually reviewed the details, and `1.0.2` was submitted for Apple Review. ASC version `de771246-06ca-4e07-8482-d8a152d101cf`, ASC build `6afef594-e570-4bcc-a954-b0f8102925a6`, review submission `c93c5153-0b7b-43f0-9e70-ae5e156e3dbe`; current state verified as `WAITING_FOR_REVIEW`.
- **Verification:** backend remote `npm test` passes 18/18; local `scripts/run-settlement-local-tests.js` passes 10/10 endpoint/integration checks covering auth, non-member rejection, Archie regression analytics, settlement direction validation, over-settlement rejection, valid full settlement, zeroed balance after settlement, snapshot persistence, and activity-log metadata. Frontend `tsc --noEmit` still only fails on pre-existing `marketing/remotion-demo` missing `remotion` types, with no errors in changed settlement/dashboard/type files.

## Current State (2026-05-31)
- **Flowt landing page deployed:** removed the demo highlight pills (`52 sec`, `Real app UI`, `Loads on play`) from production `useflowt.app`.
- AWS IAM access for `arn:aws:iam::628063714079:user/Dr.Molt` now permits S3 list/read/write on `useflowt-app-site-628063714079` and CloudFront invalidation for `E2OGDPVMTBXKHP`.
- Verification: CloudFront invalidation `I6X5UD5JLQJOP1Q4JZHN45IXQK` completed; live `https://useflowt.app/` no longer contains `52 sec`, `Real app UI`, `Loads on play`, or `demo-points`.

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

## Flowt Landing Deploy Commands
```bash
aws s3 cp ~/clawd/flowt-app/marketing/flowt-site/index.html s3://useflowt-app-site-628063714079/index.html --content-type text/html --profile clawdbot-deploy
aws s3 cp ~/clawd/flowt-app/marketing/flowt-site/styles.css s3://useflowt-app-site-628063714079/styles.css --content-type text/css --profile clawdbot-deploy
aws cloudfront create-invalidation --distribution-id E2OGDPVMTBXKHP --paths "/" "/index.html" "/styles.css" --profile clawdbot-deploy
```

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
