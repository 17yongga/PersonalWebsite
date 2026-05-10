# Wealth Dashboard — STATUS.md
> Updated: 2026-05-10

## What's Live
- **EN URL:** https://gary-yong.com/wealth.html (password-gated)
- **ZH URL:** https://gary-yong.com/wealth-zh.html (password-gated, Chinese)
- **CloudFront:** EUVZ94LCG1QV2 (gary-yong.com)
- **Language toggle:** EN ↔ 中文 button in header on both pages
- **Session auth:** `sessionStorage` — enter password once, toggle freely without re-auth

## What It Is
Private wealth management dashboard for Gary. Dark mode, mobile-responsive, Chart.js visualizations.
Full Chinese translation available at wealth-zh.html.

### Sections (both EN + ZH)
- Portfolio Health — 4 traffic-light tiles
- Net Worth Donut chart
- Age-30 Forecast Line Chart (current vs optimized vs $190K target)
- Portfolio Value Trend (time-series, 1W/1M/YTD/1Y/ALL range toggle)
- Goal Progress Bar with milestones
- TFSA Holdings Bar Chart + Detail Table
- Monthly Cash Flow Breakdown
- Savings Rate Gauge + FI Runway Calculator (interactive slider)
- Prioritized Action Items
- AI Market Watchlist
- Action Log — exact portfolio maintenance steps
- Monthly Maintenance Checklist

## Data Source
- All data sourced from `/Users/moltbot/clawd/memory/wealth-gary.md`
- To update: edit `wealth-gary.md` with new numbers → run price refresh script → redeploy both wealth.html + wealth-zh.html

## Current State (2026-05-10 / RRSP data as of Apr 29)
- Both EN + ZH dashboards updated with Gary's Apr 29 RRSP screenshot ✅
- Latest synced numbers:
  - TFSA: $20,988.51 (+2.25% today; still Apr 24 snapshot)
  - RRSP: $21,406.74 (growth $4,831.11; contributions $16,575.63)
  - Crypto: $1,651.39 (still Apr 24 snapshot)
  - Chequing: $2,830.68 (still Apr 24 snapshot)
  - Total personal NW dashboard estimate: ~$46,279 CAD (+$1,659 since Apr 22; +$1,179 from RRSP refresh)
- Key changes since Apr 22:
  - AMD: TRIMMED 5.961 → 3.961 shares (sold 2, locked +181% profit)
  - SPY: 8.2685 → 9.2685 shares (bought 1 with AMD proceeds)
  - SPY now 45% of TFSA (was 41%) — core strengthened
  - BKSY: deteriorated from +4% to -9.1%
  - SPY auto-buy confirmed already at $500 bi-weekly ($1,000/mo = Option A target)

## What's Local Only
- None — Apr 29 RRSP refresh deployed to EN + ZH dashboards

## Next Actions (Gary)
- [ ] Sell BIRD ($11) and PLTR ($39) — dead weight, redeploy to SPY
- [ ] BKSY: monitor closely, now -9.1%
- [ ] Move emergency fund to EQ Bank (~3.5% HISA)

## Next Actions (Dr.Molt)
- [ ] Full May portfolio refresh when Gary sends TFSA/crypto/cash screenshots
- [ ] Keep historical trend line + annotations updated with each screenshot sync

## Backlog
- [ ] Monthly/quarterly performance tracking (historical chart auto-populated over time)
- [x] RRSP NAV refresh from Apr 29 Wealthsimple screenshot — **DONE May 10**
- [x] ~~Automated data syncing via unofficial API~~ — **REJECTED** (security concern, 2026-03-15)
- [x] Savings rate calculator — **DONE** (interactive FI slider added Mar 23)
- [x] Portfolio trend chart — **DONE** (time-series with range toggle added Mar 23)

## Completed This Session (2026-05-10)
- ✅ RRSP refreshed from screenshot: $21,406.74 balance, $4,831.11 growth, $16,575.63 total contributions
- ✅ EN + ZH dashboards updated: header, RRSP tile, goal progress, change log, trend point/annotation
- ✅ wealth-gary.md updated with RRSP contribution breakdown
- ✅ Dashboard net worth estimate updated to ~$46,279 using Apr 24 NW + RRSP delta

## Completed Previous Session (2026-04-24)
- ✅ AMD trim + SPY buy reflected in both EN + ZH dashboards
- ✅ Holdings table reordered (SPY #1 at 45%)
- ✅ Action items updated: AMD trim + SPY buy marked done
- ✅ Changes section updated to show Apr 22 → Apr 24 delta
- ✅ Trend chart + annotations updated with new data point
- ✅ Goal progress: 23.5% → 23.7%
- ✅ wealth-gary.md updated with current portfolio + confirmed auto-buy amounts
- ✅ BKSY status changed from "Spec/NEW" to "Watch" (deteriorating)

## Decisions
- 2026-03-06: Password-gated JS gate (unlisted URL approach)
- 2026-03-15: Automated API sync REJECTED (unofficial API = security risk). Monthly manual update cadence agreed.
- 2026-04-01: Chinese version as separate URL (/wealth-zh.html) with language toggle — cleaner than in-page swap for this volume of text

## Deploy
```bash
# After updating both wealth.html + wealth-zh.html:
aws s3 cp PersonalWebsite/wealth.html s3://gary-yong.com/wealth.html --profile clawdbot-deploy
aws s3 cp PersonalWebsite/wealth-zh.html s3://gary-yong.com/wealth-zh.html --profile clawdbot-deploy
aws cloudfront create-invalidation --distribution-id EUVZ94LCG1QV2 --paths "/wealth.html" "/wealth-zh.html" --profile clawdbot-deploy
```

## Related Files
- `memory/wealth-gary.md` — Gary's full financial profile + current data
- `PersonalWebsite/wealth.html` — English dashboard
- `PersonalWebsite/wealth-zh.html` — Chinese dashboard
