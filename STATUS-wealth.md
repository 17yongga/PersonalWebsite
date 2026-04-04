# Wealth Dashboard — STATUS.md
> Updated: 2026-04-01

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

## Current State (2026-04-01)
- Both EN + ZH live and deployed ✅
- Portfolio data refreshed from Apr 1, 2026 live market prices
  - FX: USD/CAD 1.3909
  - TFSA: $17,705 CAD (+10.78% all-time, approx)
  - Crypto: $1,258 CAD (BTC @ ~$68,100 USD)
  - Total NW: ~$43,666 CAD
  - RRSP: $19,275 (not refreshed since Mar 13 — Gary to confirm on Wealthsimple)
- Key movers Apr 1: GLD +7.0% (macro hedge thesis working), PLTR -19.6% (cut recommended)
- Action items cleaned up — PLTR cut elevated to #1 urgent

## What's Local Only
- Nothing pending — both files deployed

## Next Actions (Gary)
- [ ] Cut PLTR on Wealthsimple (0.1944 shares, -19.6%, $40 left) → redeploy to SPY or NVDA
- [ ] Decide on MKT position (-36%, $320 remaining) — cut or keep as lottery ticket
- [ ] Move emergency fund from CIBC (0%) → EQ Bank (~3.5%) — 10 min online setup
- [ ] Verify RRSP current NAV on Wealthsimple → send Dr.Molt screenshot to update

## Next Actions (Dr.Molt)
- [ ] Monthly portfolio refresh — next scheduled May 1
- [ ] Update wealth-gary.md when Gary sends RRSP + portfolio update

## Backlog
- [ ] Monthly/quarterly performance tracking (historical chart auto-populated over time)
- [ ] RRSP NAV refresh once Gary confirms
- [x] ~~Automated data syncing via unofficial API~~ — **REJECTED** (security concern, 2026-03-15)
- [x] Savings rate calculator — **DONE** (interactive FI slider added Mar 23)
- [x] Portfolio trend chart — **DONE** (time-series with range toggle added Mar 23)

## Completed This Session (2026-04-01)
- ✅ Chinese version (wealth-zh.html) — full translation of all UI, actions, watchlist, tables
- ✅ EN ↔ 中文 toggle button added to both pages (header, top-right)
- ✅ sessionStorage auto-unlock — enter password once, switch languages freely
- ✅ All positions refreshed at live Apr 1 prices (Yahoo Finance)
- ✅ PLTR elevated to #1 urgent action (-19.6%, worsening)
- ✅ Stale to-dos removed (NVDA week 2-3 dry powder item, old TSLA/DASH items)
- ✅ PM Dashboard kanban updated

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
