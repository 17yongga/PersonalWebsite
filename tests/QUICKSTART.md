# Quick Start Guide for Testing

## Running Tests

### Option 1: Browser-Based Interactive Tests (Recommended)

1. **Open the test file in your browser:**
   ```
   Open: tests/casino-tests.html
   ```
   - You can open it directly from the file system
   - Or serve it through a local web server

2. **Run the tests:**
   - Click "Run All Tests" button
   - Or click individual test suite buttons
   - Review results displayed on the page

3. **Note:** Make sure the game files are accessible from the test HTML file.

### Option 2: Browser Console Tests

1. **Open the casino page in your browser:**
   - Navigate to `casino.html`
   - Open Developer Tools (F12)

2. **Load the test file:**
   ```javascript
   const script = document.createElement('script');
   script.src = 'tests/blackjack-unit-tests.js';
   document.head.appendChild(script);
   ```

3. **Run the tests:**
   ```javascript
   const tests = new BlackjackGameTests();
   tests.runAllTests();
   ```

### Option 3: Manual Testing

1. **Use the manual test checklist:**
   - Open `tests/manual-test-checklist.md`
   - Follow each test case
   - Check off items as you complete them

## What Gets Tested

### Blackjack Tests
- ✅ Dealer card reveal on stand
- ✅ Ace score calculation (high/low values)
- ✅ Score display format ("16/6" when ace present)
- ✅ Card animation logic (only new cards animate)
- ✅ Game flow (deal, hit, stand)
- ✅ Edge cases (bust, blackjack, multiple aces)

### Connection Tests
- ✅ Socket.IO availability checks
- ✅ Connection error handling
- ✅ UI loading without server

## Expected Results

When all bugs are fixed, you should see:
- **All tests passing** ✓
- **100% pass rate** for automated tests
- **All manual test cases** checked off

## Troubleshooting

### Tests not loading?
- Make sure you're accessing from a web server (not file://)
- Check browser console for errors
- Verify file paths are correct

### Tests failing?
- Check browser console for detailed error messages
- Verify the game code has all the fixes applied
- Review the test code to understand what's being tested

### Can't run automated tests?
- Use the manual test checklist instead
- It covers all the same functionality
- Follow the step-by-step instructions

## Test Files Overview

- `casino-tests.html` - Interactive browser test suite
- `blackjack-unit-tests.js` - Unit tests for Blackjack logic
- `test-runner.js` - Test runner utility
- `manual-test-checklist.md` - Step-by-step manual tests
- `README.md` - Detailed test documentation



