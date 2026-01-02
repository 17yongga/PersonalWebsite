/**
 * Test Runner for Casino Games
 * Can be run in browser console or Node.js environment
 */

class CasinoGameTestRunner {
  constructor() {
    this.allTests = [];
    this.results = [];
  }

  // Register a test
  registerTest(name, testFunction, category = 'general') {
    this.allTests.push({ name, testFunction, category });
  }

  // Run a single test
  async runTest(test) {
    try {
      const result = await test.testFunction();
      const passed = result === true || (result && result.passed !== false);
      
      this.results.push({
        name: test.name,
        category: test.category,
        passed,
        message: result?.message || (passed ? 'PASS' : 'FAIL'),
        error: result?.error
      });
      
      return { name: test.name, passed, message: result?.message };
    } catch (error) {
      this.results.push({
        name: test.name,
        category: test.category,
        passed: false,
        message: error.message,
        error: error.stack
      });
      
      return { name: test.name, passed: false, message: error.message };
    }
  }

  // Run all tests
  async runAllTests(category = null) {
    console.log('🧪 Starting Casino Games Test Suite...\n');
    
    const testsToRun = category 
      ? this.allTests.filter(t => t.category === category)
      : this.allTests;
    
    for (const test of testsToRun) {
      const result = await this.runTest(test);
      const icon = result.passed ? '✓' : '✗';
      const color = result.passed ? '\x1b[32m' : '\x1b[31m';
      const reset = '\x1b[0m';
      console.log(`${color}${icon}${reset} ${test.name}: ${result.message}`);
    }
    
    this.printSummary();
    return this.results;
  }

  // Print test summary
  printSummary() {
    const total = this.results.length;
    const passed = this.results.filter(r => r.passed).length;
    const failed = this.results.filter(r => !r.passed).length;
    const passRate = total > 0 ? ((passed / total) * 100).toFixed(1) : 0;
    
    console.log('\n' + '='.repeat(60));
    console.log('📊 Test Summary');
    console.log('='.repeat(60));
    console.log(`Total Tests: ${total}`);
    console.log(`\x1b[32mPassed: ${passed}\x1b[0m`);
    console.log(`\x1b[31mFailed: ${failed}\x1b[0m`);
    console.log(`Pass Rate: ${passRate}%`);
    console.log('='.repeat(60) + '\n');
    
    if (failed > 0) {
      console.log('❌ Failed Tests:');
      this.results.filter(r => !r.passed).forEach(r => {
        console.log(`  - ${r.name}: ${r.message}`);
        if (r.error) {
          console.log(`    ${r.error.split('\n')[0]}`);
        }
      });
      console.log('');
    }
  }

  // Get test results as object
  getResults() {
    const total = this.results.length;
    const passed = this.results.filter(r => r.passed).length;
    const failed = this.results.filter(r => !r.passed).length;
    
    return {
      total,
      passed,
      failed,
      passRate: total > 0 ? ((passed / total) * 100).toFixed(1) : 0,
      results: this.results
    };
  }

  // Clear results
  clear() {
    this.results = [];
  }
}

// Export for Node.js
if (typeof module !== 'undefined' && module.exports) {
  module.exports = CasinoGameTestRunner;
}

// Make available globally in browser
if (typeof window !== 'undefined') {
  window.CasinoGameTestRunner = CasinoGameTestRunner;
}


