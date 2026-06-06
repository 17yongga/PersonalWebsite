# Budget App — STATUS.md
> Updated: 2026-06-06 (12:31 EDT)

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

## Current State (2026-06-06)
- **Gary-reported Pro quota + Budget Space polish fixes are local and verified; not deployed/built yet:** Root cause found for the screenshot showing `Usage 7/10`: Gary’s production backend user row has no persisted subscription fields (`subscription_status`, `current_entitlement`, `subscription_expires_at` are null), so backend-only Flowt Assistant quota treats him as free even when RevenueCat marks him Pro on-device. Added a local mobile/backend sync path: mobile now posts active RevenueCat `Flowt Pro` entitlement to `/api/auth/subscription/sync`, backend validates/normalizes it into persisted `flowt_pro` fields, and subsequent `/api/ai/chat` requests get the Pro **100/month** quota. Also changed Settings so join-code regeneration is an inline refresh button beside the join code, and changed the top `Budget Space` pill to prioritize the full Budget Space name by removing the right-side metadata and allowing a two-line name. Verification: new app subscription-sync tests and source checks pass; full app `npm run test:ui-logic` **124/124 passed**; filtered TypeScript **0 non-Remotion errors**; backend targeted tests **28/28 passed**; Playwright visual QA passed with screenshots `flowt-1.0.3-budget-space-settings-group.png` and `flowt-1.0.3-budget-space-management.png`. No backend deploy or new EAS/TestFlight build has been started for this local pass.
- **Production backend assistant quota/json-limit patch is live:** Gary correctly flagged the higher Flowt Assistant limit was not live: production `ai.js` still had free quota fallback **3**. Confirmed with a disposable live API smoke before deploy: `/api/ai/chat` returned `quota.limit: 3`. Deployed the local backend changes needed for the already-built mobile release: `ai.js` (free quota **10**, Pro quota **100**, persisted backend-Pro entitlement detection) and `server.js` (`express.json({ limit: '5mb' })` for camera-roll avatar payloads). Backed up remote files to `/home/ubuntu/budget-server/backups/deploy-20260606-115658/`, transferred only intended files, verified remote hashes/syntax, restarted only PM2 `budget-server` (new pid `61390`), and synced the updated assistant route safety test. Live post-deploy smoke passed: health **200**, disposable assistant request returned `quota.limit: 10`, `providerStatus: ok`, large profile/avatar payload returned **200**, and cleanup verified `qaUsers: 0`, `qaHouseholds: 0`. No frontend/EAS rebuild was needed for this server-only patch.
- **Flowt iOS TestFlight 1.0.4 build 22 finished; auto-submit scheduled:** After Gary confirmed local fixing was done, release gates were rerun against commit `7a39cd3` (`fix(flowt): clarify shared balance settlement state`). Verification passed: production backend health **200**, app `npm run test:ui-logic` **119/119**, filtered TypeScript **0 non-Remotion errors** (only known `marketing/remotion-demo` missing `remotion`), EAS metadata lint valid, Expo config shows version `1.0.4` and bundle ID `com.garyyong.flowt`, and focused Playwright visual QA passed for settled + owed Shared Balance states. Build 21 is superseded by this newer build. EAS incremented iOS build number **21 → 22**, production build **d5b40c7e-8d63-45ee-b95a-194654f6798e** is now **FINISHED**, and auto-submit was scheduled via submission **5b382514-7e3a-4870-9a61-f2449d09ebb1**. The build watcher was run manually after finish and removed. This schedules TestFlight/App Store Connect processing only — no final App Review submission was performed.
- **Latest Gary-reported Shared Balance confusion fix is tested/committed and included in build 22:** Charts `Shared Balance` now uses the official `/balance` suggested-settlement state for the headline/CTA instead of treating the selected month's pre-settlement payer/responsibility delta as money currently owed. When Gary and Emily are already settled, the card now says `You and Emily are settled up`, keeps the paid/responsibility bars as period context, labels the $25 as `This period ... before settlements`, and hides the `Settle` CTA. When `/balance` reports an outstanding suggestion, the card still shows `You owe Emily $25.00` and keeps the CTA. Verification: new RED/GREEN chart insight tests added; `npm run test:ui-logic` **119/119 passed**; filtered TypeScript **0 non-Remotion errors**; focused Playwright visual QA passed for settled + owed states with screenshots `flowt-shared-balance-settled.png` and `flowt-shared-balance-owed.png`. Committed app fix as `7a39cd3` (`fix(flowt): clarify shared balance settlement state`). No backend deploy was needed for this app-only fix.
- **Latest Gary-reported UI bug pass is locally fixed/tested; included in build 22:** Fixed profile editing so Settings collapses to a single `Edit Profile` row and opens an overlay; profile picture selection now uses the camera roll via `expo-image-picker` instead of a URL field; Edit Expense opened from Charts/Category Breakdown now uses a fixed-height overlay that is not clipped; Monthly Trend average now excludes the current in-progress month and labels it `Completed-month avg`; Spending Pace replaces unclear/clipped `20% time` with a readable `Month progress 20%` marker. Added regression coverage in `tests/chartTrends.test.ts` and source checks. Verification: app `npm run test:ui-logic` **117/117 passed**, filtered TypeScript **0 non-Remotion errors**, backend `npm test` **76/76 passed**, and Playwright visual QA artifacts were captured under `flowt-app/artifacts/flowt-ui-bugs-*`. Committed app fixes as `cf97135` (`fix(flowt): address profile and charts ui bugs`). Backend server JSON limit support has since been covered by the live profile/e-transfer backend deployment; the mobile UI changes are included in build 22.
- **Backend profile/e-transfer deployment is live:** Gary approved testing/deploying the backend changes needed by Build 21. Local full backend suite passed **76/76** and remote targeted suite passed **34/34** after transfer. Backed up production files + active DB to `/home/ubuntu/budget-server/backups/deploy-20260606-104535/`, deployed only intended `budget-server` files, restarted only PM2 `budget-server` (pid `60292`, online), and verified production health **200**. Live smoke with disposable QA users verified: register captures `eTransferEmail`, `/auth/me` returns `etransfer_email`/`eTransferEmail`, `PUT /api/auth/profile` updates display name/avatar/e-transfer while preserving immutable login email, invalid e-transfer email returns **400**, suggested settlement payload includes `from_etransfer_email` and `to_etransfer_email`, and cleanup returned `qaUsers: 0`, `qaHouseholds: 0`, `userProfileColumns: 2`.
- **Flowt iOS TestFlight 1.0.4 build 21 queued with auto-submit:** Gary approved a new TestFlight build after local verification. Committed the mobile tree as `12570c8` (`fix(flowt): polish budget space and settlement ux`), confirmed EAS account `17yongga`, project `@17yongga/flowt`, bundle ID `com.garyyong.flowt`, remote iOS build number 20, then queued production iOS build **21** with auto-submit. Build ID: `6a60c799-9c04-4b31-bcb4-ca8a7fc59d8a`; build URL: https://expo.dev/accounts/17yongga/projects/flowt/builds/6a60c799-9c04-4b31-bcb4-ca8a7fc59d8a; submission URL: https://expo.dev/accounts/17yongga/projects/flowt/submissions/79e2f1f1-148d-468a-9c1a-cd8ecabba3b9. Watcher cron `f43cc4d9b826` checks every 15 minutes and will report when the build finishes/fails. This schedules TestFlight/App Store Connect processing only — no final App Review submission was performed. Backend profile/e-transfer changes are now live as of the backend deployment above.
- **Market positioning strategy memo created:** compiled competitor research and Flowt differentiation into `flowt-app/docs/strategy/flowt-market-positioning-2026-06-06.md`. Recommendation: position Flowt as **the shared-money app for couples, roommates, and households**, centered on `Scan → Split → Budget → Settle → Understand`, rather than competing as a generic Mint/Monarch/Copilot replacement.
- **Holistic Budget Space/profile/settlement UX pass completed:** added a persistent `Budget Space` pill across main tabs so users always know the active space; Settings now previews the current user's per-space balance (`You owe`, `Owed`, or `Settled`) in the Budget Space switcher; Profile Details now supports editable display name, profile photo URL, and separate `E-transfer email` while keeping signup/sign-in email read-only; onboarding captures e-transfer email for settlement payments; Settlement rows now show recipient e-transfer email plus a `Copy email` affordance before recording payment. Backend support is live for profile fields (`avatar_url`, `etransfer_email`), immutable login email handling, and e-transfer emails in suggested settlement payloads. Verification passed locally: full app `npm run test:ui-logic` **113/113**, backend targeted profile/balance/member/deletion tests **34/34**, filtered TypeScript produced **0 non-Remotion errors** (full `tsc` still only has known `marketing/remotion-demo` missing `remotion` module/type errors), and visual QA captures confirm Settings/profile, onboarding e-transfer capture, Budget Space balance previews, and Settlement e-transfer copy UI with no clipping/overlap.
- **Prior Budget Space UI micro-polish remains included locally:** `Create New Budget Space` is a compact top-right plus, `Join Budget Space` is a standalone CTA that opens join-code mode, delete/leave rows grey out when `/balance` reports unsettled balances, and blocked leave/delete shows `There are remaining budget not settled.`

## Current State (2026-06-05)
- **Flowt iOS TestFlight 1.0.4 build state:** Build 19 (`10fcfc16-5086-4fc1-aef6-3c3e3e28246d`) was superseded. Build 20 (`e09b635e-01d3-458d-9a31-db6237a9dd29`) had already finished before Gary's hold request could stop it, so it may appear in TestFlight but is superseded by the latest local-only fixes. The watcher cron `8b0b59cbf74a` was removed. **No new EAS/TestFlight build should be started until Gary explicitly says build.** Prior blocker commit `5496a93` fixed Charts category-breakdown close/tap behavior, Assistant suggested follow-up buttons/keyboard/logging, Settings create space, and safe delete; the new local-only pass below fixes the latest six Gary-reported bugs.
- **Local-only Flowt blocker fix/verification pass completed; no new build started per Gary's hold:** Fixed the six Gary-reported issues after Build 20 was already finished/superseded: Budget Settings input vertical alignment/sample text overflow, one-tap save/copy while keyboard is open, Charts/category sheet invisible touch blocker, category-breakdown transaction edit usability, Assistant top response cards now tappable like follow-up options, and Assistant monthly quota now defaults to **10 free / 100 Pro** with persisted Flowt Pro detection. Verification passed locally: app targeted release-blocker source tests **102/102**, full app `npm run test:ui-logic` **102/102**, backend targeted assistant safety tests **3/3**, full backend `npm test` **73/73**, TypeScript check has only the known Remotion demo missing-module errors and **0 non-Remotion errors**. Mocked visual QA captures passed for Budget Settings, Assistant, and Charts edit flow; screenshots: `flowt-app/artifacts/flowt-1.0.3-budget-settings-polished.png`, `flowt-app/artifacts/flowt-1.0.3-assistant-answer.png`, `flowt-app/artifacts/flowt-1.0.3-assistant-cards.png`, `flowt-app/artifacts/flowt-1.0.3-chart-edit-overlay-modal.png`, `flowt-app/artifacts/flowt-1.0.3-chart-overlay-edit.png`. Build watcher cron `8b0b59cbf74a` was removed; **do not start another EAS/TestFlight build until Gary explicitly says build**.
- **Prod-connected UI Add Expense submit smoke passed:** Closed the remaining Expo-web production UI gap from wider QA. Using disposable QA users/spaces only, logged into local Expo web pointed at production API, opened Add Expense, filled amount `$42.75`, category `🍕 Food/Dining`, notes, kept shared `50/50`, submitted through the UI, verified production POST **200** with expense ID, confirmed the row appeared in Transactions with `Your share $21.38` and `50.01% split`, verified via production API, then cleaned up. Cleanup check returned `qaUsers: 0`, `qaHouseholds: 0`; final health **200**. Report: `flowt-app/docs/qa/2026-06-05-prod-ui-add-expense-submit-smoke.md`.
- **Flowt Pro 50-code launch batch is seeded live and delivered privately to Gary:** Generated-code raw values stayed local/private; only a hash-only payload was transferred to production. Backed up live explicit production DB to `/home/ubuntu/budget-server/backups/promo-seed-20260605-210318`, stopped only PM2 `budget-server`, seeded 50 one-month launch-batch hashes into `/home/ubuntu/budget-server/finsync-promo-20260605-152030.db`, restarted PM2, and verified after restart: health **200**, promo auth guard **401**, launch-batch unredeemed count **50**, total promo codes **51** including the prior smoke code. Remote temp hash/seed files were removed. Himalaya email remains unconfigured in this Mac profile, so the raw code `.txt` was delivered as a private Telegram home attachment to Gary instead of posting codes in the project group.
- **Native iOS Simulator production pass attempted but blocked by local Mac toolchain/simulator issues:** `EXPO_PUBLIC_API_BASE_URL=https://api.gary-yong.com/budget npx expo run:ios --device 'iPhone 16 Pro'` failed inside `expo-modules-core` Swift files with `unknown attribute 'MainActor'` under selected Xcode 16.3/Swift 6.1. Expo Go path updated simulator Expo Go to 55.0.34 and Metro served, but `simctl openurl`, `simctl launch`, `simctl io screenshot`, and Maestro hierarchy hung; CoreSimulator logs show runtime/device discovery issues. Generated ignored `ios/` prebuild dir (~1GB) was moved to Trash. No native prod journey completed; report: `flowt-app/docs/qa/2026-06-05-native-simulator-prod-pass-attempt.md`.
- **Wider production QA completed for recent Flowt journeys:** Ran disposable prod API smoke and prod-connected Expo web smoke against `https://api.gary-yong.com/budget/api`. API smoke passed auth, solo recurring expense, partner invite/budget/shared expense/settlement, 4-person group subset split/multi-suggestion balance/permission guards/activity/category validation, and Flowt Assistant read-only route. UI smoke passed live login plus Dashboard, Transactions, Charts, Settle, Settings, access-code UI, and Add Expense modal screenshots for a disposable group Budget Space. Cleanup verified `qaUsers: 0`, `qaHouseholds: 0`. Report: `flowt-app/docs/qa/2026-06-05-wider-production-qa.md`.
- **Production backend deploy for Flowt Pro access codes is now live after persistence fix:** First retry exposed production-only DB path/persistence behavior; fix was validated safely in local temp DB tests and an isolated EC2 staging copy/PM2 process. Added regression tests `tests/database-persistence-safety.test.js`, `tests/promo-restart-persistence.test.js`, and `tests/server-start-schema.test.js`; local backend suite passed **65/65** and staging suite passed **65/65**. Production now runs `budget-server` with explicit DB path `BUDGET_DB_PATH=/home/ubuntu/budget-server/finsync-promo-20260605-152030.db`; backup before retry: `/home/ubuntu/budget-server/backups/deploy-20260605-152030`. Final production smoke passed: health **200**, unauthenticated `/api/promo-codes/redeem` returns **401**, promo schema present, one smoke code redeem **200**, duplicate redeem **409**, PM2 restart, login **200**, `/auth/me` still shows `flowt_pro`. The 50 shareable Gary launch codes were subsequently seeded live as hashes and verified separately after PM2 restart.
- **Group settlement UI refined for separate friend payments:** Mobile Settlement no longer collapses group suggested settlements into one generic `Settle Up` CTA. Added `lib/settlementActions.ts` and tests so a user who owes three friends sees three separate actions (e.g., Emily, Ava, Maya) with independent confirmation/counterparty payloads. Removed the busy sticky settle bar, replaced the old nudge card with a compact `Settlement plan`, shortened row buttons to `Pay` / `Record`, and added focused visual capture `scripts/capture-flowt-group-settlement.js`. Verification: settlement action tests pass, mobile `npm run test:ui-logic` passes **95/95**, filtered TypeScript check is clean outside the known Remotion demo exclusion, comprehensive mocked E2E remains **5/5**, and visual QA confirmed no clipping/truncation in the refined group settlement screen.
- **Demo videos created for the three target Flowt user journeys:** Added `flowt-app/scripts/record-flowt-demo-videos.js` and rendered three local MP4 product demos under `flowt-app/artifacts/demo-videos-2026-06-05/`: Kevin solo budgeter, Gary + Emily couple budgeter, and Montreal Trip group-of-4. Videos are 390×844 H.264 screen recordings using deterministic mocked API fixtures; `ffprobe` verified all three files, and contact sheets were visually reviewed. Still local-only: no backend deploy, EAS build, or store submission.
- **Comprehensive local QA pass completed across the platform:** Added and ran `flowt-app/scripts/qa-comprehensive-e2e.js` plus focused Playwright harnesses for chart edits, group splits, budget settings, and promo redemption. Backend `npm test` passes **62/62**; mobile `npm run test:ui-logic` passes **91/91**; comprehensive mocked E2E passes **5/5** journeys; focused browser QA harnesses passed; filtered TypeScript check has no non-Remotion app errors. QA report: `flowt-app/docs/qa/2026-06-05-comprehensive-platform-qa.md`. Evidence screenshots: `flowt-app/artifacts/comprehensive-qa-2026-06-05/`. Still local-only: no backend deploy, EAS build, or store submission.
- **Flowt Pro coupon/access-code feature is built and locally tested:** Backend now has hashed one-time promo codes, redemption records, a `POST /api/promo-codes/redeem` endpoint, backend Pro subscription fields with expiry-aware serialization, and a seed/generation script for shareable codes. Mobile Settings now includes an access-code redemption card under Subscription and syncs redeemed backend Pro access into the subscription store. Generated 50 one-month codes locally and saved them under `~/clawd/generated/`; email delivery was attempted but blocked by missing/expired local Gmail/Himalaya credentials.
- **Verification for promo-code feature:** backend `npm test` passes **62/62**, including promo helper tests and a local HTTP smoke test for register → seed code → redeem → `/me` Pro state → duplicate rejection; mobile `npm run test:ui-logic` passes **91/91**; filtered TypeScript check has no new app errors after excluding the known pre-existing `marketing/remotion-demo` missing `remotion` module/type errors; mocked Playwright capture confirms the Settings access-code UI and redeemed state are readable.
- **New user journey support pass is locally complete for the 10 approved supporting features:** Feature 1 journey-specific empty states, Feature 2 pending invite MVP, Feature 3 first-week setup checklist, Feature 4 default split preferences, Feature 5 monthly recurring expense toggle, Feature 6 member activity/contribution summary, Feature 7 `$10+` settlement nudges, Feature 8 role-specific permissions polish, Feature 9 active Budget Space switching MVP, and Feature 10 group split audit trail are implemented and tested locally. No backend deploy, no EAS build, no App/Play Store submission has been run.
- **Verification for new-user journey pass:** mobile `npm run test:ui-logic` passes **84/84**; `npx tsc --noEmit` has no new app errors after filtering the pre-existing `marketing/remotion-demo` missing `remotion` module/type errors; mocked Playwright captures pass for Solo / Partner waiting / Group empty states, partner invite Settings waiting/copied states, default split all-member/subset states, recurring monthly preview, `$10+` settlement nudge, member activity + group audit trail, active Budget Space switching, and role/permission copy. Visual QA confirmed cards/selectors/previews are readable with no overlap/clipping; one visual QA label issue (`Shared · Partner` in group spaces) was fixed to `Shared · Group`.
- **Android Play Store prep is partially complete locally + RevenueCat Android is configured:** Android package remains `com.garyyong.flowt`; `eas.json` now has Android submit profile targeting Play internal testing; `RECORD_AUDIO` is blocked from the Android manifest (`tools:node="remove"`) because Flowt scans receipts but does not record audio; RevenueCat Android SDK key is externalized and set in EAS production env as `EXPO_PUBLIC_REVENUECAT_ANDROID_API_KEY`; RevenueCat Android app/products are created and attached to entitlement `Flowt Pro`; default offering includes Android products `flowt_monthly:monthly`, `flowt_yearly:yearly`, and `flowt_lifetime`; Google Play listing draft, Data Safety notes, and 1024×500 feature graphic are prepared under `flowt-app/store/google/`; billing checklist is saved at `flowt-app/docs/android-billing-revenuecat-checklist.md`. **Blocked on Gary/console verification:** Google Play Developer account verification, Play Console app creation, matching Google Play products/base plans, Play service account credentials/notifications for RevenueCat, and first manual AAB upload.
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
- **Budget Space backend is live; mobile management UI remains local until next build:** backend now has `households.relationship_type`, owner-only `PUT /api/households/:id`, validation for `solo` / `partner` / `group`, expense hardening for member-only payers, positive amount, valid date, valid split type, custom split bounds, solo personal-only expenses, owner-only `POST /api/households/:id/invite-code/regenerate`, owner-only `DELETE /api/households/:id/members/:userId`, `POST /api/households/:id/owner-transfer`, member `POST /api/households/:id/leave`, and `expense_splits` for selected-member group expense participants. Production deploys backed up `/home/ubuntu/budget-server` to `backups/deploy-20260605-003749/`, `backups/deploy-20260605-005745/`, `backups/deploy-20260605-011716/`, and `backups/deploy-20260605-014144/`, restarted only PM2 `budget-server`, and smoke verified health/auth/type update/rejection/expense validation/balance shape, invite-code regeneration auth, financial-history removal rejection, owner-leave rejection, missing-owner-transfer rejection, split-details API shape, invalid participant rejection, and balance endpoint health. Mobile Budget Space UI remains local: onboarding offers `Just me`, `Partner`, and `Friends / roommates`; Settings keeps two-person friend spaces as `group`, hides `Just me` for shared spaces, prevents 3+ spaces from offering `partner`, lets owners rename the space inline, regenerate the join code, remove inactive non-owner members, and transfer ownership; members can leave when ownership/history guardrails allow; Add Expense now lets 3+ member groups choose exactly who participates in an equal split, and existing selected-participant splits now hydrate correctly when edited and display compact participant copy on Transactions rows. No EAS build yet.
- **Verification:** latest Budget Space selected-split edit/view pass (2026-06-05) passed: mobile `npm run test:ui-logic` **40/40**, `npm run capture:group-splits` passed with row/edit/add screenshots, and visual review confirmed the Transactions row shows `Split with you + Kevin`, `$90.00`, and `Your share $45.00`; Edit Expense hydrates `2/3 selected` with Gary/Kevin selected and Emily unselected; Add Expense still captures the selected participant flow. Production health smoke returned 200; no backend deploy was needed for this UI/helper-only pass. Previous group-split foundation pass (2026-06-05) passed: mobile `npm run test:ui-logic` **36/36**, backend local `npm test` **54/54**, backend local syntax checks passed, `npm run capture:group-splits` passed, visual review confirmed the Add Expense group selector shows `2/3 selected`, Gary/Kevin selected, Emily unselected, and `$45.00` shares; `npx tsc --noEmit` still only reports the known Remotion missing-module errors. Production deploy backup `backups/deploy-20260605-014144/`; remote syntax checks and `npm test` passed **115/115**; restarted only PM2 `budget-server`; live smoke verified health 200, expenses 200 with `split_details` arrays, balance 200 with two rows, and invalid participant POST rejected 400 without persistence. Previous Budget Space member-management pass (2026-06-05) passed: mobile `npm run test:ui-logic` **31/31**, backend local `npm test` **47/47**, backend syntax checks passed, `npm run capture:budget-space` passed, and visual review confirmed the Settings member card shows `Make owner` + `Remove` controls for Kevin, regenerated `NEW789` code, and no obvious clipping/overlap. Production deploy backup `backups/deploy-20260605-011716/`; remote syntax checks and `npm test` passed **90/90**; restarted only PM2 `budget-server`; live smoke verified health 200, authenticated household members include `financial_reference_count`, removing a member with history returns 409, owner leave returns 403 until ownership transfer, and transferring to a missing member returns 404. Previous Budget Space management pass (2026-06-05) passed: mobile `npm run test:ui-logic` **30/30**, backend local `npm test` **40/40**, backend syntax checks passed, `npm run capture:budget-space` passed and added `flowt-app/artifacts/flowt-1.0.3-budget-space-management.png`; visual review confirmed renamed `Roommate House`, regenerated `NEW789` join code, Regenerate Join Code action, and member list with no obvious clipping/overlap. Backend invite-code regeneration endpoint was deployed to production with backup `backups/deploy-20260605-005745/`; remote syntax checks and `npm test` passed **83/83**; restarted only PM2 `budget-server`; live health returned 200; unauthenticated regenerate route returned 401. Earlier production Budget Space backend deploy (2026-06-05) passed: local backend `npm test` 37/37 plus syntax checks; remote backup `backups/deploy-20260605-003749/`; remote syntax checks and `npm test` passed 80/80 on EC2; PM2 `budget-server` restarted only; live `https://api.gary-yong.com/budget/api/health` returned 200; authenticated smoke verified `relationship_type` present, invalid type 400, `partner ↔ group` update works, `solo` rejected for multi-member Archie Home, invalid paid-by expense rejected 400, and balance endpoint returned 200 with 2 users. Earlier assistant deploy verification: production backend was backed up to `/home/ubuntu/budget-server/backups/deploy-20260604-180556/`, syntax checks passed, remote `npm test` passed, PM2 `budget-server` was restarted only, live health returned 200, unauthenticated `/api/ai/chat` returned 401, authenticated smoke returned a real OpenAI response, and assistant smoke metadata rows were deleted afterward so Gary's free teaser quota was not consumed by testing. Full local QA checks still pass for capture harnesses (`capture:fixes`, `capture:budget-settings`, `capture:assistant`, `capture:journeys`, `capture:budget-space`). Budget Space artifacts now include onboarding, two-person group, management, 3+ group, solo Settings, group-split row, group-split edit, and group-split participant screenshots.
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
