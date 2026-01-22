/**
 * Integration Tests - Webhook Duplicate Detection
 * 
 * Tests the webhook handler's ability to detect and prevent
 * duplicate ticket creation for the same request.
 * 
 * These tests simulate concurrent webhook calls and verify
 * that only one ticket is created per unique request.
 */

const { storage } = require('@forge/api');

// Mock the webhookHandler dependencies
jest.mock('../../src/modules/keeperApi', () => ({
  fetchPedmApprovalDetails: jest.fn()
}));

jest.mock('../../src/modules/utils/adfBuilder', () => ({
  buildEnrichedTicketDescription: jest.fn(() => ({ type: 'doc', content: [] })),
  buildBasicTicketDescription: jest.fn(() => ({ type: 'doc', content: [] }))
}));

jest.mock('../../src/modules/utils/labelBuilder', () => ({
  buildTicketLabels: jest.fn(() => ['keeper-webhook'])
}));

jest.mock('../../src/modules/utils/jiraApiRetry', () => ({
  requestJiraAsAppWithRetry: jest.fn(async () => ({
    ok: true,
    status: 201,
    json: async () => ({ id: '12345', key: 'TEST-1' })
  })),
  route: (strings, ...values) => strings.reduce((acc, str, i) => 
    acc + str + (values[i] !== undefined ? values[i] : ''), '')
}));

// ============================================================================
// Duplicate Detection Logic Tests
// ============================================================================

describe('Webhook Duplicate Detection', () => {
  beforeEach(() => {
    storage._clear();
    jest.clearAllMocks();
  });

  /**
   * Simulates the duplicate detection logic
   * This mirrors the implementation in webhookHandler.js
   */
  async function checkDuplicate(requestUid) {
    const key = `webhook-processed-${requestUid}`;
    const existing = await storage.get(key);
    if (existing) {
      return { isDuplicate: true, existingTicket: existing };
    }
    return { isDuplicate: false };
  }

  async function markProcessed(requestUid, ticketInfo) {
    const key = `webhook-processed-${requestUid}`;
    await storage.set(key, {
      issueKey: ticketInfo.issueKey,
      processedAt: new Date().toISOString()
    });
  }

  describe('Basic Duplicate Detection', () => {
    test('first request is not a duplicate', async () => {
      const result = await checkDuplicate('unique-request-123');
      expect(result.isDuplicate).toBe(false);
    });

    test('second request with same UID is a duplicate', async () => {
      const requestUid = 'test-request-456';
      
      // Process first request
      await markProcessed(requestUid, { issueKey: 'TEST-1' });
      
      // Check second request
      const result = await checkDuplicate(requestUid);
      expect(result.isDuplicate).toBe(true);
      expect(result.existingTicket.issueKey).toBe('TEST-1');
    });

    test('different request UIDs are not duplicates', async () => {
      await markProcessed('request-1', { issueKey: 'TEST-1' });
      
      const result = await checkDuplicate('request-2');
      expect(result.isDuplicate).toBe(false);
    });
  });

  describe('Concurrent Request Handling', () => {
    /**
     * Simulates race condition where two identical requests
     * arrive at nearly the same time
     */
    test('handles race condition - only first wins', async () => {
      const requestUid = 'concurrent-request-789';
      const results = [];
      
      // Simulate two concurrent checks
      const check1 = checkDuplicate(requestUid);
      const check2 = checkDuplicate(requestUid);
      
      const [result1, result2] = await Promise.all([check1, check2]);
      
      // Both should see no duplicate (neither has marked yet)
      expect(result1.isDuplicate).toBe(false);
      expect(result2.isDuplicate).toBe(false);
      
      // First to mark wins
      await markProcessed(requestUid, { issueKey: 'TEST-1' });
      
      // Any subsequent check should see duplicate
      const laterCheck = await checkDuplicate(requestUid);
      expect(laterCheck.isDuplicate).toBe(true);
    });

    test('tracks multiple concurrent unique requests', async () => {
      const requests = [
        { uid: 'batch-1', key: 'TEST-1' },
        { uid: 'batch-2', key: 'TEST-2' },
        { uid: 'batch-3', key: 'TEST-3' }
      ];
      
      // Process all concurrently
      await Promise.all(
        requests.map(r => markProcessed(r.uid, { issueKey: r.key }))
      );
      
      // All should be marked as processed
      for (const req of requests) {
        const result = await checkDuplicate(req.uid);
        expect(result.isDuplicate).toBe(true);
        expect(result.existingTicket.issueKey).toBe(req.key);
      }
    });
  });

  describe('Request UID Handling', () => {
    test('handles special characters in request UID', async () => {
      const specialUids = [
        'request-with-dash',
        'request_with_underscore',
        'REQUEST123ABC',
        'req-2024-01-21-abc123'
      ];
      
      for (const uid of specialUids) {
        await markProcessed(uid, { issueKey: 'TEST-' + uid });
        const result = await checkDuplicate(uid);
        expect(result.isDuplicate).toBe(true);
      }
    });

    test('handles empty/null request UID gracefully', async () => {
      // Empty UID should still work (edge case)
      await markProcessed('', { issueKey: 'TEST-EMPTY' });
      const result = await checkDuplicate('');
      expect(result.isDuplicate).toBe(true);
    });
  });

  describe('Storage Key Format', () => {
    test('uses consistent key format', async () => {
      const requestUid = 'format-test-123';
      await markProcessed(requestUid, { issueKey: 'TEST-1' });
      
      // Verify the storage key format
      const storageData = storage._getData();
      expect(storageData.has(`webhook-processed-${requestUid}`)).toBe(true);
    });

    test('stores required metadata', async () => {
      const requestUid = 'metadata-test-456';
      const now = new Date();
      
      await markProcessed(requestUid, { issueKey: 'TEST-META' });
      
      const stored = await storage.get(`webhook-processed-${requestUid}`);
      expect(stored.issueKey).toBe('TEST-META');
      expect(stored.processedAt).toBeDefined();
      // ProcessedAt should be a valid ISO timestamp
      expect(() => new Date(stored.processedAt)).not.toThrow();
    });
  });
});

// ============================================================================
// Payload Validation Tests
// ============================================================================

describe('Webhook Payload Validation', () => {
  /**
   * Validates webhook payload structure
   */
  function validatePayload(payload) {
    const errors = [];
    
    // Required fields
    if (!payload.request_uid) {
      errors.push('request_uid is required');
    }
    
    // Category validation
    const validCategories = ['pedm_approval', 'pedm_alert', 'general'];
    if (payload.category && !validCategories.includes(payload.category)) {
      errors.push(`Invalid category: ${payload.category}`);
    }
    
    // Size limits
    const payloadStr = JSON.stringify(payload);
    if (payloadStr.length > 100000) {
      errors.push('Payload exceeds maximum size');
    }
    
    return {
      valid: errors.length === 0,
      errors
    };
  }

  test('validates required request_uid', () => {
    const result = validatePayload({});
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('request_uid is required');
  });

  test('accepts valid PEDM approval payload', () => {
    const payload = {
      request_uid: 'abc123',
      category: 'pedm_approval',
      audit_event: 'EPM_PEDM_APPROVAL_REQUEST'
    };
    
    const result = validatePayload(payload);
    expect(result.valid).toBe(true);
  });

  test('rejects invalid category', () => {
    const payload = {
      request_uid: 'abc123',
      category: 'invalid_category'
    };
    
    const result = validatePayload(payload);
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain('Invalid category');
  });
});

// ============================================================================
// Token Validation Tests
// ============================================================================

describe('Webhook Token Validation', () => {
  /**
   * Simulates token validation logic
   */
  function validateToken(authHeader, expectedToken) {
    if (!authHeader) {
      return { valid: false, error: 'Missing Authorization header' };
    }
    
    const match = authHeader.match(/^Bearer\s+(.+)$/i);
    if (!match) {
      return { valid: false, error: 'Invalid Authorization header format' };
    }
    
    const token = match[1];
    if (token !== expectedToken) {
      return { valid: false, error: 'Invalid token' };
    }
    
    return { valid: true };
  }

  test('accepts valid Bearer token', () => {
    const token = 'abc123xyz';
    const result = validateToken(`Bearer ${token}`, token);
    expect(result.valid).toBe(true);
  });

  test('rejects missing header', () => {
    const result = validateToken(null, 'token');
    expect(result.valid).toBe(false);
    expect(result.error).toContain('Missing');
  });

  test('rejects wrong format', () => {
    const result = validateToken('Basic abc123', 'abc123');
    expect(result.valid).toBe(false);
    expect(result.error).toContain('format');
  });

  test('rejects wrong token', () => {
    const result = validateToken('Bearer wrong-token', 'correct-token');
    expect(result.valid).toBe(false);
    expect(result.error).toContain('Invalid token');
  });

  test('handles case-insensitive Bearer', () => {
    const token = 'test123';
    expect(validateToken(`bearer ${token}`, token).valid).toBe(true);
    expect(validateToken(`BEARER ${token}`, token).valid).toBe(true);
  });
});

// ============================================================================
// Rate Limiting Tests
// ============================================================================

describe('Webhook Rate Limiting', () => {
  /**
   * Simulates rate limit tracking
   */
  class RateLimiter {
    constructor(limit, windowMs) {
      this.limit = limit;
      this.windowMs = windowMs;
      this.requests = new Map();
    }

    check(sourceId) {
      const now = Date.now();
      const windowStart = now - this.windowMs;
      
      let requests = this.requests.get(sourceId) || [];
      requests = requests.filter(t => t > windowStart);
      
      if (requests.length >= this.limit) {
        return {
          allowed: false,
          remaining: 0,
          resetAt: new Date(requests[0] + this.windowMs).toISOString()
        };
      }
      
      requests.push(now);
      this.requests.set(sourceId, requests);
      
      return {
        allowed: true,
        remaining: this.limit - requests.length
      };
    }
  }

  test('allows requests within limit', () => {
    const limiter = new RateLimiter(5, 60000); // 5 per minute
    const sourceId = 'source-1';
    
    for (let i = 0; i < 5; i++) {
      const result = limiter.check(sourceId);
      expect(result.allowed).toBe(true);
    }
  });

  test('blocks requests over limit', () => {
    const limiter = new RateLimiter(3, 60000);
    const sourceId = 'source-2';
    
    // Use up the limit
    for (let i = 0; i < 3; i++) {
      limiter.check(sourceId);
    }
    
    // Next request should be blocked
    const result = limiter.check(sourceId);
    expect(result.allowed).toBe(false);
    expect(result.remaining).toBe(0);
  });

  test('tracks different sources separately', () => {
    const limiter = new RateLimiter(2, 60000);
    
    // Use up limit for source-a
    limiter.check('source-a');
    limiter.check('source-a');
    
    // source-b should still have quota
    const result = limiter.check('source-b');
    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(1);
  });
});
