// Casino Debug Logger - Centralized logging system for diagnosing navigation and bet placement issues

class CasinoDebugLogger {
  constructor() {
    this.logs = [];
    this.maxLogs = 100;
    this.enabled = true;
  }

  log(category, event, details = {}) {
    if (!this.enabled) return;

    const logEntry = {
      timestamp: new Date().toISOString(),
      category, // 'bet', 'socket', 'navigation', 'balance', 'error'
      event,
      details,
      stackTrace: this._getStackTrace()
    };

    this.logs.push(logEntry);

    // Keep only last maxLogs entries
    if (this.logs.length > this.maxLogs) {
      this.logs.shift();
    }

    // Also log to console with prefix
    const prefix = `[CasinoDebug:${category}]`;
    console.log(prefix, event, details);
  }

  logBetPlacement(game, amount, status, details = {}) {
    this.log('bet', `Bet Placement: ${status}`, {
      game,
      amount,
      status, // 'started', 'completed', 'failed'
      ...details
    });
  }

  logSocketEvent(event, details = {}) {
    this.log('socket', `Socket Event: ${event}`, details);
  }

  logNavigation(action, details = {}) {
    this.log('navigation', `Navigation: ${action}`, details);
  }

  logBalanceUpdate(oldBalance, newBalance, source, details = {}) {
    this.log('balance', 'Balance Update', {
      oldBalance,
      newBalance,
      difference: newBalance - oldBalance,
      source, // 'socket', 'manual', 'api'
      ...details
    });
  }

  logError(error, context = {}) {
    this.log('error', 'Error Occurred', {
      message: error?.message || String(error),
      stack: error?.stack,
      ...context
    });
  }

  _getStackTrace() {
    try {
      throw new Error();
    } catch (e) {
      const stack = e.stack?.split('\n') || [];
      // Skip first 3 lines (Error, this function, log function)
      return stack.slice(3, 8).map(line => line.trim()).filter(Boolean);
    }
  }

  getLogs(category = null) {
    if (category) {
      return this.logs.filter(log => log.category === category);
    }
    return [...this.logs];
  }

  exportLogs() {
    return JSON.stringify(this.logs, null, 2);
  }

  clearLogs() {
    this.logs = [];
  }

  enable() {
    this.enabled = true;
  }

  disable() {
    this.enabled = false;
  }
}

// Create global instance
window.casinoDebugLogger = new CasinoDebugLogger();

// Export for use in other files
if (typeof module !== 'undefined' && module.exports) {
  module.exports = CasinoDebugLogger;
}
