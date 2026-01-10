# CS2 Betting Feature - Test Checklist

## Prerequisites
- [x] Node.js v24.12.0+ installed via nvm
- [x] npm dependencies installed (`axios`, `node-cron`)
- [x] Existing casino games (Roulette, Blackjack, Coinflip) still work

## Backend Testing

### 1. Server Startup Test
```bash
# In terminal 1: Start the casino server
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"
nvm use node
cd /Users/garyyong/PersonalWebsite
PORT=3001 node casino-server.js
```

**Expected:**
- [ ] Server starts without errors
- [ ] Console shows: "Casino Server running on http://localhost:3001"
- [ ] Console shows: "- CS2 Betting available (REST API: /api/cs2/*)"
- [ ] `cs2-betting-data.json` file is created in project root

### 2. API Endpoints Test

#### Test GET /api/cs2/events
```bash
curl http://localhost:3001/api/cs2/events
```
**Expected:**
- [ ] Returns JSON with `{ success: true, events: [], count: 0, lastSync: null }` (empty initially)
- [ ] No errors in server console

#### Test GET /api/cs2/balance
```bash
curl "http://localhost:3001/api/cs2/balance?userId=testuser"
```
**Expected:**
- [ ] Returns `{ success: true, balance: 10000 }` (initial credits)

#### Test POST /api/cs2/admin/sync (Manual Sync)
```bash
curl -X POST http://localhost:3001/api/cs2/admin/sync
```
**Expected:**
- [ ] Returns sync result (may show 0 matches if OddsAPI doesn't have CS2)
- [ ] Console logs sync activity
- [ ] If CS2 not available, gracefully handles error

**Note:** If OddsAPI doesn't support CS2, this is expected. We can test with mock data.

### 3. Mock Data Test (If OddsAPI doesn't have CS2)

If the API doesn't return CS2 matches, we can test with manually added mock data. You can add mock events directly to `cs2-betting-data.json`:

```json
{
  "events": {
    "match_001": {
      "id": "match_001",
      "homeTeam": "Team A",
      "awayTeam": "Team B",
      "commenceTime": "2026-01-11T20:00:00Z",
      "odds": {
        "team1": 1.85,
        "team2": 1.95,
        "draw": 3.20
      },
      "status": "scheduled",
      "lastUpdate": "2026-01-10T10:00:00Z"
    }
  },
  "bets": {},
  "lastApiSync": null
}
```

#### Test POST /api/cs2/bets (Place Bet)
```bash
curl -X POST http://localhost:3001/api/cs2/bets \
  -H "Content-Type: application/json" \
  -d '{
    "userId": "testuser",
    "eventId": "match_001",
    "selection": "team1",
    "amount": 100
  }'
```
**Expected:**
- [ ] Returns `{ success: true, bet: {...}, newBalance: 9900 }`
- [ ] Bet is stored in `cs2-betting-data.json`
- [ ] User balance is deducted (check `casino-users.json`)

#### Test GET /api/cs2/bets (Get User Bets)
```bash
curl "http://localhost:3001/api/cs2/bets?userId=testuser"
```
**Expected:**
- [ ] Returns list of bets for the user
- [ ] Includes the bet just placed with status "pending"

### 4. Settlement Test

#### Test POST /api/cs2/admin/settle (Manual Settlement)
```bash
# First, update match_001 in cs2-betting-data.json to have a result:
# "status": "finished",
# "result": { "winner": "team1", "homeScore": 16, "awayScore": 12 }

curl -X POST http://localhost:3001/api/cs2/admin/settle
```
**Expected:**
- [ ] Returns `{ success: true, message: "Settled X bets", settled: 1, won: 1, lost: 0 }`
- [ ] Bet status updated to "won"
- [ ] User credits increased (payout = stake × odds)
- [ ] Updated in `casino-users.json`

## Frontend Testing

### 5. Casino Page Load Test
1. Open `casino.html` in browser (or via local server)
2. **Expected:**
   - [ ] Page loads without errors
   - [ ] CS2 Betting card appears in game lobby
   - [ ] Other games (Blackjack, Coinflip, Roulette) still appear and work

### 6. CS2 Betting Game Flow Test
1. Login/Register in casino (use existing casino user system)
2. Click "CS2 Betting" game card
3. **Expected:**
   - [ ] CS2 betting game view loads
   - [ ] Three panels visible: Events, Bet Slip, My Bets
   - [ ] Disclaimer banner visible: "This is a fantasy betting experience using fake credits only..."

### 7. Events Display Test
1. In CS2 Betting view
2. **Expected:**
   - [ ] Events list shows "Loading matches..." initially
   - [ ] If no matches: shows "No upcoming matches available. Check back later!"
   - [ ] Refresh button works

### 8. Bet Placement Test (With Mock Data)
1. If you added mock match data (match_001)
2. Click on Team A or Team B odds button
3. **Expected:**
   - [ ] Bet slip updates with selected match/outcome
   - [ ] Potential payout displays correctly
   - [ ] Bet amount input works
   - [ ] Quick bet buttons (50, 100, 250, 500) work
4. Enter bet amount (e.g., 100) and click "Place Bet"
5. **Expected:**
   - [ ] Bet placed successfully
   - [ ] Alert/confirmation shows
   - [ ] Balance updates (decreases by bet amount)
   - [ ] Bet appears in "My Bets" → "Open" tab

### 9. My Bets View Test
1. After placing a bet, check "My Bets" panel
2. **Expected:**
   - [ ] Open tab shows pending bet
   - [ ] Bet shows: match name, selection, stake, odds, potential payout
   - [ ] Status shows "⏳ Pending"
   - [ ] Settled tab is empty (or shows past bets if any)

### 10. Settlement Display Test
1. After running manual settlement (backend test #4)
2. Refresh frontend or reload bets
3. **Expected:**
   - [ ] Bet moves to "Settled" tab
   - [ ] Status shows "✓ Won" or "✗ Lost"
   - [ ] Balance updated if bet won

## Integration Testing

### 11. Existing Games Still Work
1. Test Roulette game
2. Test Blackjack game  
3. Test Coinflip game
4. **Expected:**
   - [ ] All existing games still work normally
   - [ ] No errors in console
   - [ ] Credit balance shared correctly between games

### 12. Shared User System Test
1. Place bet in CS2 betting
2. Check credit balance
3. Play a round of Roulette
4. Check credit balance again
5. **Expected:**
   - [ ] Credits are shared between CS2 betting and casino games
   - [ ] Balance updates correctly for both

## Error Handling Tests

### 13. Invalid Bet Test
```bash
# Try placing bet with invalid data
curl -X POST http://localhost:3001/api/cs2/bets \
  -H "Content-Type: application/json" \
  -d '{"userId": "testuser", "eventId": "invalid", "selection": "team1", "amount": 100}'
```
**Expected:**
- [ ] Returns error: `{ success: false, error: "Event not found" }`

### 14. Insufficient Credits Test
```bash
# Place bet with amount > balance
curl -X POST http://localhost:3001/api/cs2/bets \
  -H "Content-Type: application/json" \
  -d '{"userId": "testuser", "eventId": "match_001", "selection": "team1", "amount": 999999}'
```
**Expected:**
- [ ] Returns error: `{ success: false, error: "Insufficient credits", balance: X }`

### 15. Finished Match Test
```bash
# Try placing bet on finished match (after settlement)
curl -X POST http://localhost:3001/api/cs2/bets \
  -H "Content-Type: application/json" \
  -d '{"userId": "testuser", "eventId": "match_001", "selection": "team1", "amount": 100}'
```
**Expected:**
- [ ] Returns error: `{ success: false, error: "Cannot place bet on event with status: finished" }`

## Scheduled Tasks Test

### 16. Scheduled Sync Test
1. Start server and wait 30+ minutes OR
2. Manually trigger sync (already tested above)
3. **Expected:**
   - [ ] Scheduled sync runs (check server logs)
   - [ ] No errors if API doesn't support CS2

### 17. Scheduled Settlement Test
1. Place some bets
2. Mark matches as finished in data file
3. Wait 5+ minutes OR trigger manually
4. **Expected:**
   - [ ] Scheduled settlement runs
   - [ ] Bets are settled automatically

## Notes

- **OddsAPI CS2 Coverage**: The implementation is ready, but OddsAPI may not support CS2. If it doesn't, use mock data for testing or integrate an alternative API.
- **Data Persistence**: All data is stored in JSON files (`cs2-betting-data.json` and `casino-users.json`). Data is lost on server restart, which is expected for MVP.
- **API Rate Limits**: OddsAPI free plan has 500 requests/month. The system includes caching to minimize API calls.

## Next Steps After Testing

If all tests pass:
1. Deploy to production environment
2. Monitor API usage and rate limits
3. Consider alternative APIs if OddsAPI doesn't support CS2
4. Add more comprehensive error handling if needed
5. Consider adding persistence (database) if user count grows
