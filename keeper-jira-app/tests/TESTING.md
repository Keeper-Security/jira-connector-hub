# Test Strategy Documentation

This document outlines the testing strategy for the Keeper Jira Integration Forge app.

## Table of Contents

1. [Overview](#overview)
2. [Test Structure](#test-structure)
3. [Running Tests](#running-tests)
4. [Unit Tests](#unit-tests)
5. [Integration Tests](#integration-tests)
6. [Security Tests](#security-tests)
7. [E2E Testing Approach](#e2e-testing-approach)
8. [Coverage Requirements](#coverage-requirements)
9. [CI/CD Integration](#cicd-integration)

---

## Overview

The test suite is built with Jest and covers:

- **Unit Tests**: Individual function testing for command builder, validation, escaping, and error handling
- **Integration Tests**: Webhook duplicate detection, storage operations, API mocking
- **Security Tests**: Command injection prevention, rate limiting, authentication
- **E2E Tests**: Manual and automated testing against real Forge/Jira environments

## Test Structure

```
keeper-jira-app/
├── tests/
│   ├── __mocks__/           # Jest mocks for Forge APIs
│   │   └── @forge/
│   │       ├── api.js       # Mock storage, fetch, asApp, asUser
│   │       └── resolver.js  # Mock Resolver class
│   ├── unit/                # Unit tests
│   │   ├── commandBuilder.test.js
│   │   └── errorResponse.test.js
│   ├── integration/         # Integration tests
│   │   └── webhookDuplicateDetection.test.js
│   ├── security/            # Security tests
│   │   └── injectionPayloads.test.js
│   ├── setup.js             # Jest setup file
│   └── TESTING.md           # This file
├── src/
│   └── modules/
│       └── utils/
│           └── commandBuilder.js  # Extracted for testability
└── package.json             # Jest configuration
```

## Running Tests

### Prerequisites

```bash
cd keeper-jira-app
npm install
```

### Commands

```bash
# Run all tests
npm test

# Run tests in watch mode (development)
npm run test:watch

# Run tests with coverage report
npm run test:coverage

# Run only unit tests
npm run test:unit

# Run only security tests
npm run test:security

# Run only integration tests
npm run test:integration
```

### Expected Output

```
PASS  tests/unit/commandBuilder.test.js
PASS  tests/unit/errorResponse.test.js
PASS  tests/security/injectionPayloads.test.js
PASS  tests/integration/webhookDuplicateDetection.test.js

Test Suites: 4 passed, 4 total
Tests:       165 passed, 165 total
```

---

## Unit Tests

### Command Builder Tests (`unit/commandBuilder.test.js`)

Tests the CLI command building functions:

| Category | Tests |
|----------|-------|
| `escapeForSingleQuotes` | Null handling, quote escaping, preservation of other characters |
| `escapeForDoubleQuotes` | Escapes `" $ \` \ !`, handles Unicode |
| `sanitizeJsonObject` | Control character removal, type preservation |
| `validateField` | Required fields, length limits, patterns |
| `validateCommandParameters` | Action-specific validation rules |
| `buildKeeperCommand` | record-add, record-update, share-record, share-folder |

### Error Response Tests (`unit/errorResponse.test.js`)

Tests the structured error response system:

| Category | Tests |
|----------|-------|
| `successResponse` | Basic structure, data inclusion, messages |
| `errorResponse` | Error codes, troubleshooting steps, options |
| `validationError` | Field-specific errors |
| `rateLimitError` | Minute/hour limits, retry info |
| `connectionError` | Auto-detection of error types |
| `keeperError` | Keeper-specific error classification |
| `epmError` | EPM state errors (approved/denied/expired) |

---

## Integration Tests

### Webhook Duplicate Detection (`integration/webhookDuplicateDetection.test.js`)

Tests the webhook handler's duplicate prevention:

| Scenario | Description |
|----------|-------------|
| Basic duplicate detection | Same request UID creates only one ticket |
| Concurrent requests | Race condition handling |
| Different request UIDs | Independent processing |
| Special characters | UID handling edge cases |
| Token validation | Bearer token authentication |
| Rate limiting | Per-source request limits |

---

## Security Tests

### Injection Payload Tests (`security/injectionPayloads.test.js`)

Tests protection against command injection attacks:

| Attack Type | Payloads Tested |
|-------------|-----------------|
| Shell metacharacters | `; & && | \` $ () \n \r \x00 > < <<` |
| Quote escapes | `" ' \" \' "' '"` |
| Environment variables | `$HOME $PATH ${HOME} ${$(cmd)}` |
| Real-world attacks | Reverse shell, data exfil, chained commands |
| Input length | Buffer overflow prevention |
| Format strings | `%s %n %x` patterns |
| Path traversal | `../../../etc/passwd` |

### Test Philosophy

1. **Defense in Depth**: Multiple layers of protection tested
2. **Known Payloads**: Uses OWASP-documented attack patterns
3. **Edge Cases**: Unicode, control characters, nested escapes
4. **Fail-Safe**: Invalid input should either be escaped OR rejected

---

## E2E Testing Approach

E2E testing for Forge apps requires a real Jira Cloud environment.

### Prerequisites

1. Atlassian developer account
2. Test Jira Cloud instance (free tier available)
3. Keeper Commander CLI installed and configured
4. ngrok or Cloudflare tunnel for webhook testing

### Manual E2E Test Scenarios

#### 1. Configuration Flow

```
[ ] Fresh install - app shows "Configure" prompt
[ ] Enter valid API URL and Key → Connection test passes
[ ] Enter invalid API Key → Connection test fails with helpful error
[ ] Save configuration → Settings persist after page refresh
[ ] Update configuration → New settings take effect
```

#### 2. Issue Panel Flow

```
[ ] Panel shows on issue with "keeper-webhook" label
[ ] Panel hidden on issues without label
[ ] Admin sees "Approve/Reject" buttons
[ ] Non-admin sees appropriate message
[ ] Action selector shows all record types
[ ] Form validation prevents empty required fields
```

#### 3. Record Operations

```
[ ] Create login record → Success, comment added to issue
[ ] Create record with special chars in title → Properly escaped
[ ] Share record → User receives share notification
[ ] Update record → Changes reflected in Keeper
[ ] Share with owner → Error message (not allowed)
```

#### 4. EPM Approval Flow

```
[ ] Webhook creates ticket with correct labels
[ ] Approve request → Keeper processes, label changes to "epm-approved"
[ ] Deny request → Comment added, label changes to "epm-denied"
[ ] Expired request → Cannot approve/deny, shows expired message
[ ] Duplicate webhook → Only one ticket created
```

#### 5. Webhook Security

```
[ ] Request without token → Rejected (401)
[ ] Request with wrong token → Rejected (401)
[ ] Request with valid token → Processed (201)
[ ] Too many requests → Rate limited (429)
[ ] Invalid payload → Rejected with error
```

### Automated E2E Testing

For automated E2E tests, consider using:

1. **Forge CLI tunnel**: `forge tunnel` for local development
2. **Playwright/Puppeteer**: Browser automation for UI testing
3. **API testing**: Direct `forge invoke` calls

Example Forge invoke test:

```bash
# Test a resolver directly
forge invoke testConnection --payload '{"apiUrl":"https://test.ngrok-free.app","apiKey":"test-key"}'

# Test webhook trigger
curl -X POST "$(forge webtrigger --url keeper-alert-trigger)" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"request_uid":"test-123","category":"epm_approval"}'
```

### E2E Test Data Setup

```javascript
// Example test data for E2E scenarios
const testData = {
  validConfig: {
    apiUrl: process.env.KEEPER_API_URL,
    apiKey: process.env.KEEPER_API_KEY
  },
  testRecord: {
    title: `E2E Test Record ${Date.now()}`,
    recordType: 'login',
    url: 'https://test-e2e.example.com'
  },
  webhookPayload: {
    request_uid: `e2e-${Date.now()}`,
    category: 'epm_approval',
    audit_event: 'EPM_APPROVAL_REQUEST'
  }
};
```

---

## Coverage Requirements

### Minimum Coverage Thresholds

```json
{
  "coverageThreshold": {
    "global": {
      "branches": 60,
      "functions": 60,
      "lines": 60,
      "statements": 60
    }
  }
}
```

### Coverage Focus Areas

| Priority | Area | Target |
|----------|------|--------|
| High | Shell escaping functions | 100% |
| High | Input validation | 90%+ |
| High | Error response builders | 80%+ |
| Medium | Webhook duplicate detection | 80%+ |
| Medium | Rate limiting logic | 70%+ |
| Lower | UI components | Best effort |

### Generating Coverage Report

```bash
npm run test:coverage

# View HTML report
open coverage/lcov-report/index.html
```

---

## CI/CD Integration

### GitHub Actions Workflow

Add to `.github/workflows/test.yml`:

```yaml
name: Tests

on:
  push:
    branches: [main, dev]
  pull_request:
    branches: [main]

jobs:
  test:
    runs-on: ubuntu-latest
    
    steps:
      - uses: actions/checkout@v4
      
      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '18'
          cache: 'npm'
          cache-dependency-path: keeper-jira-app/package-lock.json
      
      - name: Install dependencies
        working-directory: keeper-jira-app
        run: npm ci
      
      - name: Run tests
        working-directory: keeper-jira-app
        run: npm test
      
      - name: Run security tests
        working-directory: keeper-jira-app
        run: npm run test:security
      
      - name: Upload coverage
        uses: codecov/codecov-action@v3
        with:
          directory: keeper-jira-app/coverage
```

### Pre-commit Hook

Add to `.git/hooks/pre-commit`:

```bash
#!/bin/sh
cd keeper-jira-app
npm run test:unit
```

---

## Adding New Tests

### Test File Naming

- Unit tests: `*.test.js` in `tests/unit/`
- Integration tests: `*.test.js` in `tests/integration/`
- Security tests: `*.test.js` in `tests/security/`

### Test Template

```javascript
/**
 * Tests for [Module Name]
 */

describe('[Module/Function Name]', () => {
  beforeEach(() => {
    // Reset mocks
    jest.clearAllMocks();
  });

  describe('[Feature/Scenario]', () => {
    test('should [expected behavior]', () => {
      // Arrange
      const input = ...;
      
      // Act
      const result = functionToTest(input);
      
      // Assert
      expect(result).toBe(expected);
    });
  });
});
```

---

## Troubleshooting

### Common Issues

**Tests fail with "Cannot find module '@forge/api'"**
- Ensure mocks are in `tests/__mocks__/@forge/` directory
- Check `moduleNameMapper` in `package.json`

**Storage mock not resetting between tests**
- Call `storage._clear()` in `beforeEach`

**Tests timeout**
- Increase timeout in `jest.setTimeout()` in `setup.js`
- Check for unresolved promises

---

## References

- [Atlassian Forge Testing Guide](https://developer.atlassian.com/platform/forge/testing-forge-apps/)
- [Jest Documentation](https://jestjs.io/docs/getting-started)
- [OWASP Command Injection](https://owasp.org/www-community/attacks/Command_Injection)
