# Budget App — STATUS.md
> Updated: 2026-04-01 (01:02 EDT)

## Infrastructure
- **receipt-server** (PM2 id:5, port 3002) — receipt/screenshot scan backend, Groq vision API, proxied at `api.gary-yong.com/receipt`. Part of Flowt — needed, do not remove.

## What's Live
- **URL:** https://gary-yong.com/budget.html (frontend via S3/CloudFront)
- **App name:** Flowt (tentatively confirmed 2026-03-14) — formerly "FinSync" (name unavailable)
- Full login/register system, shared vs. individual expense tracking, Chart.js visualizations
- Backend: PM2 `budget-server` on EC2, port 3002, online
- Receipt scanner: PM2 `receipt-server` on EC2, port 3002 (proxied via nginx)

## Current State (2026-04-01)

### Web App (budget.html) — Session Tonight
- ✅ **Number verification audit** — confirmed Emily owes Gary $259.67 (all-time balance correct)
- ✅ **split_type data hygiene** — 8 personal expenses had split_type=50/50 (leftover from old seed script); DB corrected, backend default logic fixed
- ✅ **AddExpenseModal splitType fix** — was sending "equal"/"none" instead of "50/50"/"single"; corrected in RN app
- ✅ **Analytics "My Expenses" true cost** — fixed for web + RN: partner views now show 50% of shared + full personal (not cash-out)
- ✅ **Category modal true cost** — drill-down totals + per-item display shows effective cost with "½ of $X · paid by" label for shared expenses
- ✅ **Monthly chart filter** — category dropdown added; duplicate month label bug fixed (Date mutation); tooltip $ formatting
- ✅ **Double-submission fix** — submit lock moved before `await` in both expense form handlers
- ✅ **Duplicate doordash sushi** — 2 duplicate entries (IDs 240, 241) deleted; $50.16 removed from shared pool
- ✅ **Receipt scanner HEIC fix** — Emily's iOS HEIC images now re-encoded to JPEG via canvas before sending to Groq API
- ✅ **Receipt server logging** — raw AI response now logged on parse failure for easier debugging

### Mobile App (Flowt)
**Build #8 (15885f9a) — STATUS UNKNOWN (was IN PROGRESS as of Mar 26)**
- Need to verify build status at expo.dev

### Pending (Next Actions)
- [ ] Verify Build #8 completed + install on device
- [ ] Queue Build #9 — contains: splitType fix (5775593) + charts true cost fix (1414c15)
- [ ] Assign RC packages: flowt_monthly → $rc_monthly, flowt_yearly → $rc_annual
- [ ] Create Lifetime $99.99 non-consumable IAP in App Store Connect
- [ ] Take App Store screenshots once device build installs
- [ ] PostgreSQL migration (SQLite → AWS RDS)

---

## Previous State (2026-03-26)
**Build #8 (15885f9a) IN PROGRESS — EAS device build queued ~10:10 AM ET.**
- EAS URL: https://expo.dev/accounts/17yongga/projects/flowt/builds/15885f9a-42c6-4ca7-a8da-14f83cf06af1
- Status: NEW (waiting for EAS worker)
- Contains 9 commits since Build #7

### Build #8 Changes (committed to main, queued for device)

**1. Quick Action buttons redesigned (19cba1e):**
- Stacked icon-over-label card tiles (blue for Add Expense, white+border for Scan Receipt)

**2. Settlement expense color-coding (ac0953c):**
- Blue left-border + tint = current user paid; Amber = partner paid

**3. Branded splash screen (6f7c7b7):**
- Flowt wave logo + wordmark + tagline on `#0F172A` navy (replaced Expo blueprint)

**4. Budget remaining per column in dashboard (ee22494):**
- Mini progress bar + "$X left" / "$X over" under Together and Personal columns

**5. Scan receipt crash fix (5c37ea7):**
- Handle server `{ success: false }` response gracefully instead of crashing on undefined.date

**6. Scan receipt feature parity with web (c0dffe9):**
- Shared/Personal toggle per item (blue=Shared, amber=Personal, default Shared)
- "Add X items" button now sticky footer (was hidden behind home indicator)
- Category emoji shown per item in review list

**7. Transactions list layout fix (0fc6c2c):**
- Notes/description as title (bold), category as subtitle — matches web version
- Delete alert uses notes as identifier

**8. Scan receipt robust date handling (9ea0f24):**
- Port web's `normalizeReceiptDate`: handles YYYY-MM-DD, MM/DD/YYYY, "March 5 2026", ISO timestamps
- Date is never mandatory — always falls back to local timezone today
- Crash-safe: `result.data` defaults to `{}`

**9. Revert dev auto-login (22201bd):**
- `test.flowt.2026@gmail.com` auto-login block removed from login.tsx before device build

**Local iOS build (Xcode 16.3 / Swift 6.1) — WORKING:**
- Swift source patches applied (expo-modules-core, expo-image-picker, expo-router, expo-image)
- `npx expo run:ios` builds successfully + installs on iPhone 16 Pro simulator
- Metro bundler running on port 8081
- Test account: `test.flowt.2026@gmail.com` / `TestPass123!` (household 8, 6 sample expenses seeded)

**Build status:**
- Build #3 (3cf220b6): simulator-only (.tar.gz), archived
- Build #4 (d4ba91a6): FINISHED but had RC test-key crash on device
- Build #5 (94c09dd9) ✅ FINISHED — production RC key, device-installable
- Build #6 (d2b316b0) ✅ FINISHED — simulator build (wrong profile used)
- Build #6b (de876a3b) ✅ FINISHED — device build, pre-fix code
- Build #7 (a8c2e617) ✅ FINISHED — 6 UX/bug fixes (commit dc771ac)
  - EAS URL: https://expo.dev/accounts/17yongga/projects/flowt/builds/a8c2e617-b5b3-4d12-8a31-ad046dad7c46
- Build #8 (15885f9a) 🔄 IN PROGRESS — 9 commits, queued 2026-03-26 ~10:10 AM ET

**App Store Connect subscriptions configured (2026-03-24):**
- ✅ Flowt Pro Monthly — $9.99 USD, all 175 countries, English (Canada) localized
- ✅ Flowt Pro Yearly — $79.99 USD, all 175 countries, English (Canada) localized
- ⬜ Lifetime $99.99 — needs to be created as non-consumable IAP (separate from subscriptions)
- Status shows "Missing Metadata" — normal, clears when submitted to App Review

**RevenueCat:**
- RevenueCat paywall PUBLISHED ✅ — 3 packages (Monthly $9.99, Yearly $79.99, Lifetime $99.99)
- RC entitlement: "Flowt Pro" — all products attached
- RC SDK: react-native-purchases v9.14.0
- P8 key linked in RC ✅ (Gary confirmed)
- ⚠️ TODO: Assign App Store products to RC offering packages — `flowt_monthly` → `$rc_monthly`, `flowt_yearly` → `$rc_annual`

**Logo finalised ✅ (2026-03-16)**
- Two-wave mark: `#2563EB` (deep blue) + `#60A5FA` (sky blue) on `#0F172A` navy
- Files: `~/clawd/flowt-app/assets/flowt-logo-FINAL.svg`
- Full asset set: icon 1024/512/192/180/120px + splash 2048px
- Expo `icon.png` + Android `android-icon-foreground.png` replaced

**Apple Developer Program ✅ (2026-03-16)**
- $99/year paid · Application submitted · Processing (~48h)

## What's Local Only (Pending Build #8 install)
- All 9 commits in Build #8 are committed to `main` and in the EAS queue
- Nothing remaining as local-only that isn't captured in Build #8

## Next Actions

### Immediate (Build #8 — in progress)
- [x] Revert dev auto-login ✅
- [x] Commit all changes (9 commits) ✅
- [x] Queue Build #8 via EAS (`preview-device` profile) ✅ — 2026-03-26 ~10:10 AM ET
- [ ] Wait for Build #8 to complete + install on iPhone
- [ ] Test all 9 changes on device
- [ ] Assign RC packages: `flowt_monthly` → `$rc_monthly`, `flowt_yearly` → `$rc_annual` in RevenueCat dashboard
- [ ] Create Lifetime $99.99 non-consumable IAP in App Store Connect
- [ ] Take App Store screenshots once Build #8 installs

### Phase 2 (Mobile) — Active Development
- [x] PRE: Apple Developer Program enrollment ($99/year) ✅ 2026-03-16
- [ ] PRE: Google Play Developer account ($25 one-time)
- [x] PRE: RevenueCat account + store product configuration ✅ 2026-03-24 — RC paywall published
- [x] PRE: App name confirmed — **Flowt** ✅ 2026-03-14
- [x] 2a-1: Expo project setup + navigation structure ✅ 2026-03-15
- [x] 2a-2: Auth overhaul (JWT + biometrics + Keychain) ✅ 2026-03-22
- [x] 2a-3: Port all core screens to React Native ✅ 2026-03-22
- [x] 2a-4: Offline wall ✅ 2026-03-24
- [x] 2a-5: RevenueCat ✅ 2026-03-24
- [x] 2a-6: Receipt camera ✅ 2026-03-24
- [x] 2a-7: EAS preview build ✅ 2026-03-23
- [x] Dashboard UI redesign ✅ 2026-03-25 (local — Build #8 pending)
- [x] Settlement page redesign ✅ 2026-03-25 (local — Build #8 pending)
- [ ] Build #8 — queue with tonight's fixes
- [ ] 2b-1: PostgreSQL migration (SQLite → AWS RDS)
- [ ] 2b-2: Subscription middleware + RevenueCat webhooks
- [ ] 2b-3: Push notifications
- [x] 2b-4: Password reset flow ✅ 2026-03-24
- [ ] 2c-1: Home screen widget (iOS + Android)
- [x] 2c-2: App Store assets ✅ 2026-03-24
- [ ] 2c-2b: Screenshots — need Build #8 on iPhone
- [ ] 2c-3: App Store submission — blocked on screenshots + build
- [ ] 2c-4: Play Store submission (post iOS approval)

## Decisions
- 2026-03-09: Confirmed all batches deployed — D-002 closed
- 2026-03-10: Canonical category system implemented
- 2026-03-11: Balance clamping removed
- 2026-03-11: Phase 2 planning complete
- 2026-03-14: App name confirmed as **Flowt**
- 2026-03-16: Logo finalised
- 2026-03-24: Pricing locked — Monthly $9.99 / Yearly $79.99 / Lifetime $99.99
- 2026-03-25: Dashboard stats renamed (Together/Personal/You're Owed) for clarity
- 2026-03-25: Settlement page fully redesigned — outstanding/settled separation, hero Settle Up button
- 2026-03-25: Xcode 16.3 / Swift 6.1 compatibility achieved via source patches (no upstream fix needed)

## Deploy Commands
```bash
# Frontend
aws s3 cp ~/clawd/PersonalWebsite/budget.html s3://gary-yong.com/budget.html --profile clawdbot-deploy
aws cloudfront create-invalidation --distribution-id EUVZ94LCG1QV2 --paths "/budget.html" --profile clawdbot-deploy

# Backend (households.js)
scp -i ~/.ssh/id_ed25519 ~/clawd/PersonalWebsite/budget-server/households.js ubuntu@52.86.178.139:/home/ubuntu/budget-server/
ssh ubuntu@52.86.178.139 -i ~/.ssh/id_ed25519 "pm2 restart budget-server"

# SQLite edits — ALWAYS stop server first!
ssh ubuntu@52.86.178.139 -i ~/.ssh/id_ed25519 "pm2 stop budget-server"
# ... run sqlite3 commands as SEPARATE invocations (not multi-statement blocks) ...
ssh ubuntu@52.86.178.139 -i ~/.ssh/id_ed25519 "pm2 start budget-server"
```

## Key Files
- `budget.html` — frontend (369 KB, S3)
- `/home/ubuntu/budget-server/households.js` — API routes incl. category normalization
- `/home/ubuntu/receipt-server.js` — AI vision scanner (Llama 4 Scout via Groq)
- `/home/ubuntu/budget-server/finsync.db` — SQLite DB
- `~/clawd/flowt-app/app/(app)/(tabs)/index.tsx` — dashboard (tonight's changes)
- `~/clawd/flowt-app/app/(app)/(tabs)/settlement.tsx` — settlement (tonight's full rewrite)
