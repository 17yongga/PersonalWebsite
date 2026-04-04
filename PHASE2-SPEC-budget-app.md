# FinSync — Phase 2 Technical Specification
> Authored: 2026-03-11 | Status: Planning Complete — Ready for Execution

## Overview

Phase 2 transforms FinSync from a web app into a cross-platform mobile application (iOS + Android) with a membership-only subscription model. The web app remains live and maintained. Mobile is a net-new product built on top of the existing backend.

**Key Decisions (locked)**
- Platform: iOS + Android (React Native + Expo)
- Model: Membership-only, cancel anytime. No free tier. 14-day free trial.
- Offline: Hard block — no internet = no app access. No local caching. Eliminates sync complexity.
- Pricing: TBD (pinned — to be decided after planning is complete)

---

## Tech Stack

### Mobile (Frontend)
| Layer | Choice | Reason |
|-------|--------|--------|
| Framework | React Native + Expo SDK 52 | Cross-platform, reuses JS business logic from web |
| Navigation | Expo Router (file-based) | Same mental model as Next.js |
| Styling | NativeWind (Tailwind for RN) | Consistent with web app styling system |
| Server State | TanStack Query | Caching, refetching, loading states |
| Client State | Zustand | Auth session, UI state — lightweight |
| IAP / Subscriptions | react-native-purchases (RevenueCat SDK) | Handles both App Store + Play Store billing |
| Biometrics | expo-local-authentication | Face ID / Touch ID / Fingerprint |
| Push Notifications | expo-notifications | Registration + handling |
| Camera | expo-camera | Native receipt scanning |
| Secure Storage | expo-secure-store | Keychain (iOS) / Keystore (Android) for tokens |
| Network Detection | @react-native-community/netinfo | Offline wall |
| Animations | react-native-reanimated + Gesture Handler | Swipe-to-delete, smooth transitions |

### Backend (extend existing Node.js/Express)
| Layer | Choice | Reason |
|-------|--------|--------|
| Database | PostgreSQL via AWS RDS | Replaces SQLite — handles concurrent mobile connections |
| Cache / Token Store | Redis (ElastiCache) | Refresh token storage + blacklisting |
| Auth | JWT (access + refresh tokens) | Replaces session cookies — works on mobile |
| Push Delivery | Expo Server SDK | Proxies APNs + FCM — no Firebase setup needed |
| Subscription Events | RevenueCat Webhooks | Subscription lifecycle management |
| Reverse Proxy | nginx (existing) | No changes needed |
| Process Manager | PM2 (existing) | No changes needed |

### Build & Deploy
| Tool | Purpose |
|------|---------|
| Expo EAS Build | Cloud builds for iOS + Android — no Xcode/Android Studio needed locally |
| Expo EAS Submit | Automated App Store + Play Store submission |
| GitHub Actions | Trigger EAS builds on merge to main |

---

## Phase 2a — Foundation (Est. 6–8 weeks)

### Task 2a-1: Expo Project Setup + Navigation
**Goal:** Scaffold the React Native project with full navigation structure

Deliverables:
- Expo SDK 52 project, TypeScript, NativeWind configured
- Expo Router file-based navigation
- Screen structure:
  ```
  app/
    (auth)/login.tsx
    (auth)/register.tsx
    (auth)/forgot-password.tsx
    (onboarding)/welcome.tsx
    (onboarding)/paywall.tsx
    (app)/(tabs)/index.tsx          ← Dashboard
    (app)/(tabs)/transactions.tsx
    (app)/(tabs)/categories.tsx
    (app)/(tabs)/charts.tsx
    (app)/(tabs)/settings.tsx
    (app)/scan-receipt.tsx          ← modal
    offline.tsx
  ```
- Bottom tab bar with same icons/structure as web app
- Navigation guards: unauthenticated → auth screens, no subscription → paywall
- EAS project config (eas.json, app.json)

Acceptance: App launches, navigates between screens, guards work

---

### Task 2a-2: Auth Overhaul (JWT + Biometrics)
**Goal:** Replace session cookies with mobile-native auth

Backend changes:
- `POST /auth/login` → returns `access_token` (15 min TTL) + `refresh_token` (30 day TTL)
- `POST /auth/refresh` → validates refresh token → new access token
- `POST /auth/logout` → marks refresh token revoked in Redis
- `POST /auth/forgot-password` → sends email magic link
- New DB table: `refresh_tokens (id, user_id, token_hash, expires_at, revoked, created_at)`

Mobile implementation:
- `access_token` stored in Zustand (memory only)
- `refresh_token` stored in expo-secure-store (Keychain/Keystore)
- Auto-refresh: TanStack Query interceptor detects 401 → hits `/auth/refresh` → retries original request
- Biometric login: authenticate device → read stored refresh token → silently refresh → enter app
- Biometric toggle in Settings (enable/disable)

Acceptance: Login, register, logout, biometric unlock all working on device

---

### Task 2a-3: Screen Port — All Core Screens
**Goal:** All existing web app functionality ported to React Native

Screens to port:
- **Dashboard:** household balance, quick-add transaction, recent expenses summary
- **Transactions:** full list, swipe-to-delete, swipe-to-edit, smart search
- **Categories:** category list with spend totals, emoji support
- **Charts:** monthly spend bar chart, category pie chart (Victory Native or react-native-chart-kit)
- **Settings:** profile, household members, invite partner, sign out, manage subscription

Key mobile-specific behaviours:
- Pull-to-refresh on all list screens
- Haptic feedback on destructive actions (delete)
- Keyboard avoiding view on all forms
- Safe area insets (notch, home indicator)
- Dynamic Type support (system font size)

Acceptance: All 5 tab screens functional, data loads from API, parity with web app features

---

### Task 2a-4: Offline Wall
**Goal:** Hard block all app interaction when no internet connection

Implementation:
- NetInfo listener on app root — fires on every connectivity change and app focus
- If offline → redirect to `offline.tsx` (no back gesture, blocks all navigation)
- `offline.tsx`: branded "No Connection" screen + Retry button
- Retry → re-check connectivity → if online → navigate back to last route
- No data cached to disk — every read requires live API

Acceptance: Pull airplane mode → offline screen appears immediately. Restore connection → app resumes.

---

### Task 2a-5: RevenueCat + Paywall Screen
**Goal:** Full subscription purchase flow on both platforms

Setup steps:
- Create Apple Developer account + App Store Connect app record
- Create Google Play Developer account + Play Console app record
- Create subscription products in both stores (monthly + annual)
- Configure RevenueCat dashboard, link both stores
- Add RevenueCat webhook endpoint to backend

Backend:
- `POST /webhooks/revenuecat` (validate signature → parse event → update subscriptions table)
- New DB table:
  ```sql
  subscriptions (
    user_id, status, platform, product_id,
    expires_at, grace_period_end,
    revenuecat_customer_id, updated_at
  )
  ```
- Status values: `trialing` | `active` | `grace_period` | `expired` | `cancelled`
- Grace period: 7 days post billing failure before lockout
- Subscription middleware: check status on every protected route → 403 if expired

Webhook events handled:
- `INITIAL_PURCHASE` → status = trialing/active
- `RENEWAL` → extend expires_at
- `CANCELLATION` → cancelled_at set, active until period end
- `BILLING_ISSUE` → status = grace_period, send push notification
- `EXPIRATION` → status = expired

Paywall screen:
- Shows: feature list, monthly price, annual price, savings callout
- Primary CTA: "Start 14-Day Free Trial"
- Secondary: "Restore Purchase" (RevenueCat handles this)
- Shown on: first launch (no sub), subscription expiry, settings → upgrade

Acceptance: Purchase flow works on TestFlight (iOS) and internal testing (Android). Webhook updates DB correctly. Expired user gets 403 from API.

---

### Task 2a-6: Receipt Camera (Native)
**Goal:** Replace web file upload with native camera capture

Mobile flow:
- User taps "Scan Receipt" → bottom action sheet appears
- Option A: "Take Photo" → expo-camera launches native camera
- Option B: "Choose from Library" → expo-image-picker
- Image → base64 → `POST /receipt/scan` (existing endpoint, no backend changes needed)
- Results pre-fill the Add Transaction form (same flow as web)

Acceptance: Camera captures receipt, Groq scanner returns line items, form pre-fills correctly

---

### Task 2a-7: EAS Build Pipeline
**Goal:** Automated builds for both platforms via Expo cloud

Deliverables:
- `eas.json` configured with: development, preview (TestFlight/internal), production profiles
- GitHub Actions workflow: push to `main` → triggers EAS production build → notifies on completion
- iOS: provisioning profile + distribution certificate configured in EAS
- Android: keystore configured in EAS
- First successful TestFlight build
- First successful Play Store internal track build

Acceptance: `eas build --platform all` produces installable builds for both platforms

---

## Phase 2b — Backend Hardening (Est. 3–4 weeks)

### Task 2b-1: PostgreSQL Migration
**Goal:** Replace SQLite with managed PostgreSQL on AWS RDS

Steps:
1. Provision RDS db.t3.micro (~$15/month) in same VPC as EC2
2. Export all SQLite tables to CSV
3. Create Postgres schema (adjust types: INTEGER PRIMARY KEY → SERIAL, DATETIME → TIMESTAMPTZ, JSON text → JSONB)
4. Import data, validate row counts
5. Update all db queries in households.js, receipt-server.js:
   - `?` placeholders → `$1, $2` (pg driver syntax)
   - `DATETIME('now')` → `NOW()`
   - Add `RETURNING *` where missing
6. Run both SQLite + Postgres in parallel for 48h write-to-both validation
7. Cutover — point app at Postgres only

Tables to migrate: users, households, household_members, expenses, categories, settlements, activity_log
New tables: refresh_tokens, subscriptions

Acceptance: All 32 existing API tests pass against Postgres. Zero data loss verified.

---

### Task 2b-2: Subscription Middleware + Webhooks
**Goal:** Gate all API access behind active subscription check

- `checkSubscription` middleware applied to all routes except: /auth/*, /webhooks/revenuecat, /health
- Returns `{ error: "subscription_required", code: 403 }` if not active/trialing/grace
- App shows paywall on receiving this code
- RevenueCat webhook endpoint fully operational (idempotent — duplicate events handled)
- Billing issue → push notification sent to user device

Acceptance: Expired user cannot reach any data endpoint. Active user passes through. Grace period user passes through.

---

### Task 2b-3: Push Notifications
**Goal:** Real-time alerts for partner activity and budget events

Setup:
- Add `push_token`, `push_platform` columns to users table
- `POST /users/push-token` endpoint — called on app launch after permission granted
- Expo Server SDK on backend for notification delivery

Notification triggers:
- Partner adds a shared expense → notify the other partner ("Emily added $85.00 · Groceries")
- Monthly budget threshold hit (>80%) → notify user
- Billing issue (from RevenueCat webhook) → notify user ("Payment failed — update your payment method")
- Weekly spending summary → Sunday 9am cron

Acceptance: Push notification received within 5 seconds of partner adding expense. Budget threshold alert fires correctly.

---

### Task 2b-4: Password Reset Flow
**Goal:** Email-based password reset for mobile users

- `POST /auth/forgot-password` → generates short-lived token (15 min) → sends email via nodemailer
- Email contains deep link: `finsync://reset-password?token=xxx`
- Deep link opens app → `(auth)/reset-password.tsx` screen
- `POST /auth/reset-password` → validates token → updates password hash → invalidates all refresh tokens
- Expo deep link config in app.json

Acceptance: Forgot password email arrives, link opens app, password resets, old sessions invalidated.

---

## Phase 2c — Polish + Launch (Est. 3–4 weeks)

### Task 2c-1: Home Screen Widget
**Goal:** Quick balance glance without opening app

- iOS: WidgetKit via expo-widgets (or react-native-widgetkit)
- Android: Glance API widget
- Shows: current month spend, remaining budget, last transaction
- Tapping widget deep-links to Dashboard tab
- Widget refreshes every 30 min (background fetch)

Acceptance: Widget appears in iOS widget gallery, shows accurate data, tapping opens app.

---

### Task 2c-2: App Store + Play Store Assets
**Goal:** All metadata and visual assets ready for submission

Deliverables:
- App icon (1024×1024 PNG, no alpha — iOS requirement)
- Splash screen (branded loading screen)
- App Store screenshots: 6.7" iPhone (required), 12.9" iPad (optional)
- Play Store screenshots: phone + 7" tablet
- App Store description (short + full)
- Play Store description
- Privacy policy URL (required by both)
- Age rating questionnaire completed
- Keywords / search optimization

---

### Task 2c-3: TestFlight Beta + Internal Testing
**Goal:** Real-device validation before public release

iOS (TestFlight):
- Upload build via EAS Submit
- Internal testers: Gary + partner (Emily)
- Test all subscription flows (purchase, cancel, restore, grace period)
- Test all push notification triggers
- Test offline wall on airplane mode
- 1-week minimum test window

Android (Internal Testing):
- Upload AAB via EAS Submit → Play Console internal testing track
- Same test checklist as iOS
- Test on both old (Android 10) and new (Android 14) devices if possible

Acceptance: Zero P0 bugs. All subscription states tested. Offline wall confirmed. Push notifications working.

---

### Task 2c-4: App Store + Play Store Submission
**Goal:** Public release on both platforms

iOS submission checklist:
- All screenshots uploaded
- Privacy nutrition label completed (financial data = high scrutiny)
- App Review notes written (explain subscription, trial, no free tier)
- Submit for review → expect 1–5 business days
- Prepare for potential rejection: have answers ready for common financial app rejections

Android submission:
- Submit to production track (Play Store review ~3 days)
- Target API level 34+ (Android 14 requirement)

Post-launch:
- Monitor crash reports (Expo Crashlytics or Sentry)
- Monitor subscription metrics in RevenueCat dashboard
- Respond to App Store / Play Store reviews

---

## Pre-Phase 2 Prerequisites

Before any code is written, these must be in place:

- [ ] Apple Developer Program enrollment — $99/year — https://developer.apple.com/programs/
- [ ] Google Play Developer account — $25 one-time — https://play.google.com/console/
- [ ] RevenueCat account — free tier — https://app.revenuecat.com/
- [ ] App Store Connect: create app record, configure subscription products
- [ ] Google Play Console: create app, configure subscription products
- [ ] App name availability check on both stores — confirm "FinSync" is available or choose alternative
- [ ] AWS RDS: provision Postgres instance before Task 2b-1

---

## Effort Summary

| Phase | Tasks | Est. Duration |
|-------|-------|---------------|
| 2a Foundation | 7 tasks | 6–8 weeks |
| 2b Backend Hardening | 4 tasks | 3–4 weeks |
| 2c Polish + Launch | 4 tasks | 3–4 weeks |
| **Total** | **15 tasks** | **~15–18 weeks** |

Running as side project alongside Capco: estimate ~4 months to App Store launch.

---

## Open Decisions (Pinned)

- **Pricing:** Monthly + annual price points — TBD
- **App name:** FinSync available on stores? TBD — check before committing
- **Read-only offline viewing:** Hard block confirmed. Revisit post-launch if users request it.
- **Household invite on mobile:** Email link or in-app code? TBD during 2a-3
