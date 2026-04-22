# Wealth Dashboard — STATUS.md
> Updated: 2026-04-07

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

## Current State (2026-04-07)
- Both EN + ZH dashboards updated locally with Gary's Apr 7 screenshots ✅
- Latest synced numbers:
  - Wealthsimple total: $23,601.04
  - TFSA: $18,735.93 (+13.72% all-time)
  - RRSP: $19,445.03
  - Crypto: $1,432.00
  - Chequing: $2,630.68
  - Total personal NW: ~$42,244 CAD
- Position changes captured:
  - NVDA now ~11.4% of TFSA after significant increase
  - MSFT now appears as a new 1-share position
  - Cash buffer down to ~$2,125, meaning more capital got deployed
  - MKT deteriorated further to -54% ($230 left)
- Primary action item now: decide whether to cut MKT or treat it as a true lottery-ticket hold

## What's Local Only
- EN + ZH files updated locally from Apr 7 screenshots
- Still needs deploy to S3 + CloudFront invalidation

## Next Actions (Gary)
- [ ] Decide on MKT position (-54%, $230 remaining) — cut or keep as true lottery ticket
- [ ] Move emergency fund from CIBC / idle cash setup into a real high-interest bucket (EQ or Wealthsimple Save)
- [ ] Clean up PLTR on Wealthsimple (0.1944 shares, ~-$43 left) when convenient → redeploy to SPY/NVDA/QQQ
- [ ] Clarify the purpose of the USD savings account once it goes live

## Next Actions (Dr.Molt)
- [ ] Deploy updated wealth.html + wealth-zh.html
- [ ] Monthly portfolio refresh — next scheduled May 1 unless Gary sends sooner
- [ ] Keep historical trend line updated with each screenshot sync

## Backlog
- [ ] Monthly/quarterly performance tracking (historical chart auto-populated over time)
- [ ] RRSP NAV refresh once Gary confirms
- [x] ~~Automated data syncing via unofficial API~~ — **REJECTED** (security concern, 2026-03-15)
- [x] Savings rate calculator — **DONE** (interactive FI slider added Mar 23)
- [x] Portfolio trend chart — **DONE** (time-series with range toggle added Mar 23)

## Completed This Session (2026-04-07)
- ✅ Synced wealth profile from Gary's latest screenshots
- ✅ Refreshed RRSP / TFSA / crypto / chequing balances in memory/wealth-gary.md
- ✅ Updated English dashboard with Apr 7 numbers and revised action priorities
- ✅ Updated Chinese dashboard to match the latest portfolio state
- ✅ Added Apr 7 point to the portfolio trend history
- ✅ Status doc refreshed with latest state and next actions

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
