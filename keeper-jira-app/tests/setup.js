/**
 * Jest Test Setup
 * Runs before each test file
 */

// Clear all mocks before each test
beforeEach(() => {
  jest.clearAllMocks();
  
  // Clear mock storage
  const { storage } = require('@forge/api');
  if (storage._clear) {
    storage._clear();
  }
});

// Global test timeout
jest.setTimeout(10000);

// Suppress console output during tests (optional - comment out for debugging)
// global.console = {
//   ...console,
//   log: jest.fn(),
//   warn: jest.fn(),
//   error: jest.fn(),
// };
