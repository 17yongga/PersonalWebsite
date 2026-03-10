# Wealth Dashboard — STATUS.md
> Updated: 2026-03-06

## What's Live
- **URL:** https://gary-yong.com/wealth.html (password-gated, unlisted)
- **Deployed:** 2026-03-06 (commit 6dcb6d3)
- **CloudFront:** EUVZ94LCG1QV2 (gary-yong.com)

## What It Is
Private wealth management dashboard for Gary. Dark mode, mobile-responsive, Chart.js visualizations.

### Sections
- Portfolio Health — 4 traffic-light tiles
- Net Worth Donut chart
- Age-30 Forecast Line Chart (current vs optimized vs $190K target)
- Goal Progress Bar with milestones
- TFSA Holdings Bar Chart + Detail Table
- Monthly Cash Flow Breakdown
- Prioritized Action Items (6 items)
- AI Market Watchlist

## Data Source
- All data sourced from `/Users/moltbot/clawd/memory/wealth-gary.md`
- To update: edit `wealth-gary.md` with new numbers → redeploy `wealth.html`

## Current State (2026-03-06)
- Live and deployed
- Data is a snapshot from 2026-06-13 (future-dated — verify with Gary)
- Password gate is JS-only (security by obscurity, not true auth)

## What's Local Only
- Nothing pending

## Next Actions
- [ ] Update balances whenever Gary shares new portfolio data → redeploy
- [ ] Gary: confirm current balance data is accurate (D-pending)

## Backlog
- [ ] True server-side auth (replace JS-only password gate)
- [ ] Automated data syncing (connect to Wealthsimple/brokerage APIs)
- [ ] Monthly/quarterly performance tracking over time
- [ ] Savings rate calculator

## Decisions
- 2026-03-06: Password-gated JS gate (unlisted URL approach)
- Data lives in `memory/wealth-gary.md` to keep it separate from code

## Deploy
```bash
# After updating wealth.html:
aws s3 cp PersonalWebsite/wealth.html s3://gary-yong.com/wealth.html --profile clawdbot-deploy
aws cloudfront create-invalidation --distribution-id EUVZ94LCG1QV2 --paths "/wealth.html" --profile clawdbot-deploy
```

## Related Files
- `memory/wealth-gary.md` — Gary's full financial profile + data
- `wealth.html` — the dashboard page
