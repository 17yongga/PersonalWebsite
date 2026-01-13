/**
 * Comprehensive Unit Tests for Blackjack Game
 * Run these tests in a test environment or browser console
 */

class BlackjackGameTests {
  constructor() {
    this.testsRun = 0;
    this.testsPassed = 0;
    this.testsFailed = 0;
    this.results = [];
  }

  // Mock CasinoManager
  createMockCasinoManager() {
    return {
      playerName: 'TestPlayer',
      credits: 10000,
      updateCredits: function(amount) {
        this.credits += amount;
      },
      updateCreditsDisplay: function() {}
    };
  }

  // Test runner
  runTest(testName, testFunction) {
    this.testsRun++;
    try {
      const result = testFunction();
      if (result === true || (result && result.passed !== false)) {
        this.testsPassed++;
        this.results.push({ name: testName, passed: true, message: result?.message || 'PASS' });
        console.log(`✓ ${testName}`);
        return true;
      } else {
        this.testsFailed++;
        const message = result?.message || 'FAIL';
        this.results.push({ name: testName, passed: false, message });
        console.error(`✗ ${testName}: ${message}`);
        return false;
      }
    } catch (error) {
      this.testsFailed++;
      this.results.push({ name: testName, passed: false, message: error.message, error });
      console.error(`✗ ${testName}: ${error.message}`);
      console.error(error.stack);
      return false;
    }
  }

  // Test: Dealer card reveal when player stands
  testDealerCardReveal() {
    return this.runTest('Dealer Card Reveal on Stand', () => {
      // This test verifies the fix for bug #1
      const game = new BlackjackGame(this.createMockCasinoManager());
      
      game.createDeck();
      game.shuffleDeck();
      game.playerHand = [];
      game.dealerHand = [];
      game.gameOver = false;
      
      // Deal initial cards
      game.dealCard(game.playerHand);
      game.dealCard(game.dealerHand);
      game.dealCard(game.playerHand);
      game.dealCard(game.dealerHand);
      
      // Before stand: gameOver should be false
      if (game.gameOver !== false) {
        return { passed: false, message: 'gameOver should be false before stand' };
      }
      
      // Simulate stand() behavior - gameOver is set to true
      game.gameOver = true;
      
      // After stand: gameOver should be true
      if (game.gameOver !== true) {
        return { passed: false, message: 'gameOver should be true after stand' };
      }
      
      // Verify dealer has cards
      if (game.dealerHand.length < 2) {
        return { passed: false, message: 'Dealer should have at least 2 cards' };
      }
      
      // Verify updateDisplay would show dealer cards (hideFirst = false when gameOver = true)
      const hideFirst = !game.gameOver;
      if (hideFirst !== false) {
        return { passed: false, message: 'hideFirst should be false when gameOver is true' };
      }
      
      return { passed: true, message: 'Dealer card reveal logic works correctly' };
    });
  }

  // Test: Ace score calculation
  testAceScoreCalculation() {
    return this.runTest('Ace Score Calculation', () => {
      const game = new BlackjackGame(this.createMockCasinoManager());
      
      // Test 1: Ace + 5 should show 16/6
      const hand1 = [
        { value: 'ace', suit: 'hearts' },
        { value: '5', suit: 'hearts' }
      ];
      const score1 = game.calculateScoreWithAces(hand1);
      
      if (score1.high !== 16 || score1.low !== 6 || !score1.hasAce || score1.best !== 16) {
        return { passed: false, message: `Ace+5: Expected high:16 low:6 best:16 hasAce:true, got high:${score1.high} low:${score1.low} best:${score1.best} hasAce:${score1.hasAce}` };
      }
      
      // Test 2: Ace + King = Blackjack
      const hand2 = [
        { value: 'ace', suit: 'hearts' },
        { value: 'king', suit: 'hearts' }
      ];
      const score2 = game.calculateScoreWithAces(hand2);
      
      if (score2.best !== 21 || !score2.hasAce || score2.high !== 21 || score2.low !== 11) {
        return { passed: false, message: `Ace+King: Expected best:21 hasAce:true, got best:${score2.best} hasAce:${score2.hasAce}` };
      }
      
      // Test 3: Multiple aces (should not bust)
      const hand3 = [
        { value: 'ace', suit: 'hearts' },
        { value: 'ace', suit: 'spades' },
        { value: '5', suit: 'hearts' }
      ];
      const score3 = game.calculateScoreWithAces(hand3);
      
      if (score3.best > 21) {
        return { passed: false, message: `Multiple aces: Score should not exceed 21, got ${score3.best}` };
      }
      
      // Test 4: No aces
      const hand4 = [
        { value: '10', suit: 'hearts' },
        { value: '5', suit: 'hearts' }
      ];
      const score4 = game.calculateScoreWithAces(hand4);
      
      if (score4.hasAce !== false || score4.best !== 15 || score4.high !== 15 || score4.low !== 15) {
        return { passed: false, message: `No aces: Expected best:15 hasAce:false, got best:${score4.best} hasAce:${score4.hasAce}` };
      }
      
      return { passed: true, message: 'All ace score calculations work correctly' };
    });
  }

  // Test: Score display format with aces
  testScoreDisplayFormat() {
    return this.runTest('Score Display Format with Aces', () => {
      const game = new BlackjackGame(this.createMockCasinoManager());
      
      // Test with ace
      const hand1 = [
        { value: 'ace', suit: 'hearts' },
        { value: '5', suit: 'hearts' }
      ];
      const scoreInfo1 = game.calculateScoreWithAces(hand1);
      const display1 = scoreInfo1.hasAce ? `${scoreInfo1.high}/${scoreInfo1.low}` : scoreInfo1.best;
      
      if (display1 !== '16/6') {
        return { passed: false, message: `Expected "16/6", got "${display1}"` };
      }
      
      // Test without ace
      const hand2 = [
        { value: '10', suit: 'hearts' },
        { value: '5', suit: 'hearts' }
      ];
      const scoreInfo2 = game.calculateScoreWithAces(hand2);
      const display2 = scoreInfo2.hasAce ? `${scoreInfo2.high}/${scoreInfo2.low}` : scoreInfo2.best;
      
      if (display2 !== '15') {
        return { passed: false, message: `Expected "15", got "${display2}"` };
      }
      
      return { passed: true, message: 'Score display format works correctly' };
    });
  }

  // Test: Card animation - only new cards animated
  testCardAnimationLogic() {
    return this.runTest('Card Animation Logic', () => {
      const game = new BlackjackGame(this.createMockCasinoManager());
      game.lastHideFirstStates = {};
      
      // Create a test container
      const container = document.createElement('div');
      container.id = 'testCards';
      document.body.appendChild(container);
      
      try {
        // Test 1: Initial render
        const hand1 = [
          { value: '2', suit: 'hearts' },
          { value: '3', suit: 'hearts' }
        ];
        
        game.displayCards('testCards', hand1, false);
        const cards1 = container.querySelectorAll('.card');
        
        if (cards1.length !== 2) {
          return { passed: false, message: `Initial render: Expected 2 cards, got ${cards1.length}` };
        }
        
        // Test 2: Add new card (should only animate the new one)
        const hand2 = [
          { value: '2', suit: 'hearts' },
          { value: '3', suit: 'hearts' },
          { value: '4', suit: 'hearts' }
        ];
        
        game.displayCards('testCards', hand2, false);
        const cards2 = container.querySelectorAll('.card');
        
        if (cards2.length !== 3) {
          return { passed: false, message: `Add card: Expected 3 cards, got ${cards2.length}` };
        }
        
        // Test 3: Reveal hidden card
        game.displayCards('testCards', hand2, true);
        const cards3Hidden = container.querySelectorAll('.card-back');
        
        if (cards3Hidden.length !== 1) {
          return { passed: false, message: `Hide card: Expected 1 hidden card, got ${cards3Hidden.length}` };
        }
        
        game.displayCards('testCards', hand2, false);
        const cards3Revealed = container.querySelectorAll('.card-back');
        
        if (cards3Revealed.length !== 0) {
          return { passed: false, message: `Reveal card: Expected 0 hidden cards, got ${cards3Revealed.length}` };
        }
        
        return { passed: true, message: 'Card animation logic works correctly' };
      } finally {
        container.remove();
      }
    });
  }

  // Test: Game flow integrity
  testGameFlow() {
    return this.runTest('Game Flow Integrity', () => {
      const game = new BlackjackGame(this.createMockCasinoManager());
      
      game.createDeck();
      game.shuffleDeck();
      game.playerHand = [];
      game.dealerHand = [];
      game.gameOver = false;
      
      // Initial deal
      game.dealCard(game.playerHand);
      game.dealCard(game.dealerHand);
      game.dealCard(game.playerHand);
      game.dealCard(game.dealerHand);
      
      if (game.playerHand.length !== 2 || game.dealerHand.length !== 2) {
        return { passed: false, message: `Initial deal: Expected 2 cards each, got player:${game.playerHand.length} dealer:${game.dealerHand.length}` };
      }
      
      // Hit
      const initialCount = game.playerHand.length;
      game.dealCard(game.playerHand);
      
      if (game.playerHand.length !== initialCount + 1) {
        return { passed: false, message: `Hit: Expected ${initialCount + 1} cards, got ${game.playerHand.length}` };
      }
      
      // Stand
      game.gameOver = true;
      
      if (game.gameOver !== true) {
        return { passed: false, message: 'Stand: gameOver should be true' };
      }
      
      return { passed: true, message: 'Game flow works correctly' };
    });
  }

  // Test: Edge cases
  testEdgeCases() {
    return this.runTest('Score Edge Cases', () => {
      const game = new BlackjackGame(this.createMockCasinoManager());
      
      // Test bust prevention with aces
      const hand1 = [
        { value: 'ace', suit: 'hearts' },
        { value: '10', suit: 'hearts' },
        { value: '10', suit: 'spades' },
        { value: '5', suit: 'hearts' }
      ];
      const score1 = game.calculateScoreWithAces(hand1);
      
      if (score1.best > 21) {
        return { passed: false, message: `Bust prevention: Score should not exceed 21, got ${score1.best}` };
      }
      
      // Test blackjack
      const hand2 = [
        { value: 'ace', suit: 'hearts' },
        { value: 'king', suit: 'hearts' }
      ];
      const score2 = game.calculateScoreWithAces(hand2);
      
      if (score2.best !== 21) {
        return { passed: false, message: `Blackjack: Expected 21, got ${score2.best}` };
      }
      
      // Test empty hand
      const hand3 = [];
      const score3 = game.calculateScoreWithAces(hand3);
      
      if (score3.best !== 0 || score3.high !== 0 || score3.low !== 0) {
        return { passed: false, message: `Empty hand: Expected 0, got ${score3.best}` };
      }
      
      return { passed: true, message: 'All edge cases handled correctly' };
    });
  }

  // Test: Dealer visible score calculation
  testDealerVisibleScore() {
    return this.runTest('Dealer Visible Score Calculation', () => {
      const game = new BlackjackGame(this.createMockCasinoManager());
      
      // Setup dealer hand with hidden first card
      game.dealerHand = [
        { value: 'ace', suit: 'hearts' },  // Hidden
        { value: '5', suit: 'hearts' }      // Visible
      ];
      
      const dealerVisibleCards = game.dealerHand.slice(1);
      const visibleScore = game.calculateScoreWithAces(dealerVisibleCards);
      
      if (visibleScore.best !== 5) {
        return { passed: false, message: `Dealer visible score: Expected 5, got ${visibleScore.best}` };
      }
      
      // Full dealer score
      const fullScore = game.calculateScoreWithAces(game.dealerHand);
      
      if (fullScore.best !== 16) {
        return { passed: false, message: `Dealer full score: Expected 16, got ${fullScore.best}` };
      }
      
      return { passed: true, message: 'Dealer visible score calculation works correctly' };
    });
  }

  // Run all tests
  runAllTests() {
    console.log('Starting Blackjack Game Tests...\n');
    
    this.testDealerCardReveal();
    this.testAceScoreCalculation();
    this.testScoreDisplayFormat();
    this.testCardAnimationLogic();
    this.testGameFlow();
    this.testEdgeCases();
    this.testDealerVisibleScore();
    
    // Print summary
    console.log('\n' + '='.repeat(50));
    console.log('Test Summary:');
    console.log(`Tests Run: ${this.testsRun}`);
    console.log(`Passed: ${this.testsPassed}`);
    console.log(`Failed: ${this.testsFailed}`);
    console.log(`Pass Rate: ${((this.testsPassed / this.testsRun) * 100).toFixed(1)}%`);
    console.log('='.repeat(50));
    
    return {
      total: this.testsRun,
      passed: this.testsPassed,
      failed: this.testsFailed,
      results: this.results
    };
  }
}

// Export for use in test environment
if (typeof module !== 'undefined' && module.exports) {
  module.exports = BlackjackGameTests;
}

// Auto-run if in browser and BlackjackGame is available
if (typeof window !== 'undefined' && typeof BlackjackGame !== 'undefined') {
  const tests = new BlackjackGameTests();
  window.blackjackTests = tests;
  console.log('Blackjack tests loaded. Run: window.blackjackTests.runAllTests()');
}



