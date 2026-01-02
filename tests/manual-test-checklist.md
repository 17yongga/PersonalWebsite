# Manual Test Checklist for Casino Games

Use this checklist to manually verify all bug fixes and functionality.

## Blackjack Game Tests

### Bug Fix #1: Dealer Card Reveal
- [ ] **Test Case 1.1**: Start a new blackjack game
  - [ ] Dealer's first card should be face-down (showing card back)
  - [ ] Dealer's second card should be visible
  - [ ] Dealer score should show only visible card's score
  
- [ ] **Test Case 1.2**: Player stands
  - [ ] Click "Stand" button
  - [ ] Dealer's first card should be revealed (no longer face-down)
  - [ ] Dealer score should update to show full score
  - [ ] Game result should be displayed correctly

### Bug Fix #2: Card Animation
- [ ] **Test Case 2.1**: Initial card deal
  - [ ] Start a new game
  - [ ] Cards should animate in sequentially
  - [ ] Each card should slide in smoothly
  
- [ ] **Test Case 2.2**: Player hits
  - [ ] Click "Hit" button
  - [ ] Only the new card should animate
  - [ ] Existing cards should NOT re-animate
  - [ ] Animation should be smooth (fade + slide)
  
- [ ] **Test Case 2.3**: Dealer plays
  - [ ] After player stands, dealer draws cards
  - [ ] Only new dealer cards should animate
  - [ ] Previously visible dealer card should NOT re-animate

### Bug Fix #3: Ace Score Display
- [ ] **Test Case 3.1**: Player has Ace + number
  - [ ] Get dealt Ace + 5
  - [ ] Score should display as "16/6" (not just "16" or "6")
  - [ ] Format should be "high/low"
  
- [ ] **Test Case 3.2**: Player has Ace + face card (Blackjack)
  - [ ] Get dealt Ace + King/Queen/Jack
  - [ ] Score should display as "21/11" or just "21" (if using best score)
  - [ ] Game should recognize blackjack
  
- [ ] **Test Case 3.3**: Player has multiple cards with Ace
  - [ ] Get dealt Ace + 5 + 10
  - [ ] Score should show correct format (may be just best score if bust with high value)
  - [ ] Score calculation should be correct
  
- [ ] **Test Case 3.4**: Dealer has Ace
  - [ ] After dealer reveals cards, if dealer has Ace
  - [ ] Dealer score should show "xx/xx" format
  - [ ] Format should match player score format

### Game Logic Tests
- [ ] **Test Case 4.1**: Blackjack detection
  - [ ] Get dealt Ace + 10/face card
  - [ ] Game should immediately recognize blackjack
  - [ ] Win should be calculated correctly
  
- [ ] **Test Case 4.2**: Bust detection
  - [ ] Hit until score exceeds 21
  - [ ] Game should detect bust
  - [ ] Dealer should win
  - [ ] Credits should be deducted correctly
  
- [ ] **Test Case 4.3**: Dealer bust
  - [ ] Player stands with valid score
  - [ ] Dealer draws cards and busts
  - [ ] Player should win
  - [ ] Credits should be added correctly
  
- [ ] **Test Case 4.4**: Score comparison
  - [ ] Player stands with higher score than dealer
  - [ ] Player should win
  - [ ] Dealer stands with higher score than player
  - [ ] Dealer should win
  - [ ] Tie game should result in push (bet returned)

## Coinflip Game Tests

### Bug Fix #4: Connection Handling
- [ ] **Test Case 5.1**: Server not running
  - [ ] Open coinflip game
  - [ ] UI should load and display
  - [ ] Connection status should show "Connection failed" or similar
  - [ ] No JavaScript errors should occur
  
- [ ] **Test Case 5.2**: Server running
  - [ ] Start coinflip server (npm start in coinflip directory)
  - [ ] Open coinflip game
  - [ ] Connection status should show "Connected"
  - [ ] Game functionality should work
  
- [ ] **Test Case 5.3**: Create room
  - [ ] Enter bet amount
  - [ ] Choose Heads or Tails
  - [ ] Click "Create Room"
  - [ ] Room should be created
  - [ ] Credits should be deducted
  
- [ ] **Test Case 5.4**: Join room
  - [ ] Join an existing room
  - [ ] Confirmation should appear
  - [ ] Game should proceed correctly

## Roulette Game Tests

### Bug Fix #4: Connection Handling
- [ ] **Test Case 6.1**: Server not running
  - [ ] Open roulette game
  - [ ] UI should load and display
  - [ ] Error message should be shown
  - [ ] No JavaScript errors should occur
  
- [ ] **Test Case 6.2**: Server running
  - [ ] Start casino server (node casino-server.js)
  - [ ] Open roulette game
  - [ ] Connection should be established
  - [ ] Wheel should be visible
  - [ ] Betting controls should work
  
- [ ] **Test Case 6.3**: Place bet
  - [ ] Enter bet amount
  - [ ] Choose color (Red/Black/Green)
  - [ ] Bet should be placed
  - [ ] Credits should be deducted
  - [ ] Bet should appear in "All Players' Bets" list
  
- [ ] **Test Case 6.4**: Wheel spin
  - [ ] Wait for auto-spin or trigger spin
  - [ ] Wheel should animate
  - [ ] Result should be displayed
  - [ ] Winnings should be calculated correctly

## Cross-Game Tests

- [ ] **Test Case 7.1**: Credit persistence
  - [ ] Start with 10,000 credits
  - [ ] Play blackjack and lose some credits
  - [ ] Go back to lobby
  - [ ] Credits should be preserved
  - [ ] Play another game
  - [ ] Credits should continue to persist
  
- [ ] **Test Case 7.2**: Navigation
  - [ ] Play a game
  - [ ] Click "Back to Lobby"
  - [ ] Should return to game selection
  - [ ] Click "Logout"
  - [ ] Should return to sign-in screen
  
- [ ] **Test Case 7.3**: Menu position
  - [ ] Casino header should be at top of screen
  - [ ] Game selection should be below header
  - [ ] Layout should be vertical (top to bottom)

## Performance Tests

- [ ] **Test Case 8.1**: Card animation performance
  - [ ] Multiple rapid hits
  - [ ] Animations should not lag
  - [ ] No flickering or stuttering
  
- [ ] **Test Case 8.2**: Score update performance
  - [ ] Score should update smoothly
  - [ ] No delay or lag in score display

## Edge Cases

- [ ] **Test Case 9.1**: Empty hand
  - [ ] Score calculation for empty hand should be 0
  
- [ ] **Test Case 9.2**: Multiple aces
  - [ ] Hand with 2+ aces
  - [ ] Score should be calculated correctly
  - [ ] Should not bust unnecessarily
  
- [ ] **Test Case 9.3**: All face cards
  - [ ] Hand with only face cards
  - [ ] Score should be calculated correctly
  
- [ ] **Test Case 9.4**: Insufficient credits
  - [ ] Try to bet more than available credits
  - [ ] Should show error message
  - [ ] Bet should not be placed

## Browser Compatibility

- [ ] **Test Case 10.1**: Chrome
  - [ ] All functionality works
  - [ ] Animations are smooth
  
- [ ] **Test Case 10.2**: Firefox
  - [ ] All functionality works
  - [ ] Animations are smooth
  
- [ ] **Test Case 10.3**: Edge
  - [ ] All functionality works
  - [ ] Animations are smooth

## Notes

- Mark each test case as [x] when completed
- Note any issues or unexpected behavior
- Test with servers both running and not running
- Test with different credit amounts
- Test with different screen sizes


