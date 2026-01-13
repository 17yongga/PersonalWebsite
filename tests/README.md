# Casino Games Test Suite

Comprehensive test suite for the casino games (Blackjack, Coinflip, Roulette).

## Test Files

1. **casino-tests.html** - Interactive browser-based test suite with UI
2. **blackjack-unit-tests.js** - Unit tests for Blackjack game logic

## Running Tests

### Browser-Based Tests (casino-tests.html)

1. Open `tests/casino-tests.html` in a web browser
2. Make sure the games are accessible from the test file
3. Click "Run All Tests" or run individual test suites
4. Review the test results displayed on the page

### Unit Tests (blackjack-unit-tests.js)

#### In Browser Console:
1. Open the casino page in browser
2. Open browser console (F12)
3. Load the test file:
   ```javascript
   const script = document.createElement('script');
   script.src = 'tests/blackjack-unit-tests.js';
   document.head.appendChild(script);
   ```
4. Run tests:
   ```javascript
   const tests = new BlackjackGameTests();
   tests.runAllTests();
   ```

#### In Node.js (if configured):
```javascript
const BlackjackGameTests = require('./tests/blackjack-unit-tests.js');
const tests = new BlackjackGameTests();
tests.runAllTests();
```

## Test Coverage

### Blackjack Tests

1. **Dealer Card Reveal** - Verifies dealer's first card is revealed when player stands
2. **Ace Score Calculation** - Tests ace scoring logic (high/low values)
3. **Score Display Format** - Verifies "xx/xx" format when aces are present
4. **Card Animation Logic** - Ensures only new cards are animated
5. **Game Flow** - Tests complete game flow (deal, hit, stand)
6. **Edge Cases** - Tests bust prevention, blackjack, empty hands
7. **Dealer Visible Score** - Tests dealer score calculation with hidden card

### Connection Tests

1. **Socket.IO Availability** - Checks if socket.io library is available
2. **Connection Error Handling** - Verifies proper error handling for failed connections

## Expected Test Results

All tests should pass when the code is working correctly:

- ✓ Dealer Card Reveal on Stand
- ✓ Ace Score Calculation
- ✓ Score Display Format with Aces
- ✓ Card Animation Logic
- ✓ Game Flow Integrity
- ✓ Score Edge Cases
- ✓ Dealer Visible Score Calculation
- ✓ Socket.IO Availability
- ✓ Connection Error Handling

## Test Scenarios

### Bug Fix Verification

The test suite specifically verifies the following bug fixes:

1. **Bug #1: Dealer card not revealed**
   - Test: `testDealerCardReveal()`
   - Verifies: `gameOver = true` is set before `updateDisplay()` in `stand()`

2. **Bug #2: Card animation replay**
   - Test: `testCardAnimationLogic()`
   - Verifies: Only new cards are animated, existing cards remain static

3. **Bug #3: Ace score display**
   - Test: `testScoreDisplayFormat()`
   - Verifies: Score shows "16/6" format when ace is present

4. **Bug #4: Connection issues**
   - Test: `testConnectionErrorHandling()`
   - Verifies: Code checks for socket.io availability before connecting

## Manual Test Checklist

For manual testing, verify the following:

### Blackjack
- [ ] Dealer's first card is hidden initially
- [ ] Dealer's first card is revealed when player stands
- [ ] Score shows "xx/xx" format when player has ace (e.g., Ace + 5 = "16/6")
- [ ] Score shows "xx/xx" format when dealer has ace (after reveal)
- [ ] Only new cards animate when added (existing cards don't re-animate)
- [ ] Card reveal animation works smoothly
- [ ] Game correctly identifies blackjack (Ace + 10/face card = 21)
- [ ] Bust is correctly detected (score > 21)
- [ ] Game correctly determines winner

### Coinflip
- [ ] UI loads even if server is not running
- [ ] Connection status is displayed
- [ ] Game connects when server is available
- [ ] Error messages are shown if connection fails

### Roulette
- [ ] UI loads even if server is not running
- [ ] Connection status is displayed
- [ ] Game connects when server is available
- [ ] Error messages are shown if connection fails

## Notes

- Tests assume the game code is loaded (BlackjackGame class is available)
- Some tests require DOM manipulation (for card display tests)
- Socket.IO tests check code structure, not actual connections
- For full integration testing, servers should be running



