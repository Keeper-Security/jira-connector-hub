/**
 * Mock for @forge/api module
 * Used in Jest tests to simulate Forge API behavior
 */

// Mock storage with in-memory store
const storageData = new Map();

const storage = {
  get: jest.fn(async (key) => {
    return storageData.get(key);
  }),
  set: jest.fn(async (key, value) => {
    storageData.set(key, value);
    return true;
  }),
  delete: jest.fn(async (key) => {
    storageData.delete(key);
    return true;
  }),
  // Helper for tests to clear storage
  _clear: () => storageData.clear(),
  _getData: () => storageData
};

// Mock webTrigger
const webTrigger = {
  getUrl: jest.fn(async (triggerId) => {
    return `https://mock-forge-trigger.atlassian.net/x/${triggerId}`;
  })
};

// Mock fetch for external API calls
const fetch = jest.fn(async (url, options) => {
  return {
    ok: true,
    status: 200,
    json: async () => ({ success: true, message: 'Mock response' }),
    text: async () => 'Mock response'
  };
});

// Mock asApp for Jira API calls
const asApp = jest.fn(() => ({
  requestJira: jest.fn(async (route, options) => ({
    ok: true,
    status: 200,
    json: async () => ({ success: true }),
    text: async () => 'Success'
  }))
}));

// Mock asUser for Jira API calls
const asUser = jest.fn(() => ({
  requestJira: jest.fn(async (route, options) => ({
    ok: true,
    status: 200,
    json: async () => ({ success: true }),
    text: async () => 'Success'
  }))
}));

// Mock route template tag
const route = (strings, ...values) => {
  let result = strings[0];
  for (let i = 0; i < values.length; i++) {
    result += encodeURIComponent(values[i]) + strings[i + 1];
  }
  return result;
};

module.exports = {
  storage,
  webTrigger,
  fetch,
  asApp,
  asUser,
  route
};
