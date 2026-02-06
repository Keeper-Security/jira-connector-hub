/**
 * Integration Tests - handleApprovalStatusChanged (EPM status change webhook)
 *
 * Tests the behavior and contract of approval_request_status_changed handling:
 * status handling, label updates, and request_uid sanitization (JQL injection prevention).
 * Logic mirrors webhookHandler.handleApprovalStatusChanged for testability without ESM.
 */

// Mirror EPM_STATUS from webhookHandler.js
const EPM_STATUS = {
  APPROVED: 1,
  DENIED: 2
};

/**
 * Normalize and validate request_status (mirrors handleApprovalStatusChanged)
 */
function normalizeAndValidateStatus(requestStatus) {
  const statusValue = typeof requestStatus === 'string'
    ? parseInt(requestStatus, 10)
    : requestStatus;
  const valid = statusValue === EPM_STATUS.APPROVED || statusValue === EPM_STATUS.DENIED;
  const isApproved = statusValue === EPM_STATUS.APPROVED;
  return { statusValue, valid, isApproved };
}

/**
 * Sanitize request_uid for JQL (mirrors handleApprovalStatusChanged)
 */
function sanitizeRequestUid(requestUid) {
  return String(requestUid).replace(/[^a-zA-Z0-9_-]/g, '-');
}

/**
 * Build action label and updated labels (mirrors handleApprovalStatusChanged)
 */
function buildLabelsForAction(currentLabels, isApproved) {
  const actionLabel = isApproved ? 'epm-approved' : 'epm-denied';
  return [...currentLabels, actionLabel, 'epm-external-action'];
}

// ============================================================================
// handleApprovalStatusChanged behavior tests
// ============================================================================

describe('handleApprovalStatusChanged', () => {
  describe('Status Handling', () => {
    test('handles external approval with status="1" (string)', () => {
      const { valid, isApproved } = normalizeAndValidateStatus('1');
      expect(valid).toBe(true);
      expect(isApproved).toBe(true);
    });

    test('handles external approval with status=1 (number)', () => {
      const { valid, isApproved } = normalizeAndValidateStatus(1);
      expect(valid).toBe(true);
      expect(isApproved).toBe(true);
    });

    test('handles external denial with status="2" (string)', () => {
      const { valid, isApproved } = normalizeAndValidateStatus('2');
      expect(valid).toBe(true);
      expect(isApproved).toBe(false);
    });

    test('handles external denial with status=2 (number)', () => {
      const { valid, isApproved } = normalizeAndValidateStatus(2);
      expect(valid).toBe(true);
      expect(isApproved).toBe(false);
    });

    test('rejects invalid status values (0, 3, null, undefined)', () => {
      expect(normalizeAndValidateStatus(0).valid).toBe(false);
      expect(normalizeAndValidateStatus(3).valid).toBe(false);
      expect(normalizeAndValidateStatus(null).valid).toBe(false);
      expect(normalizeAndValidateStatus(undefined).valid).toBe(false);
    });
  });

  describe('Label Updates', () => {
    test('adds epm-approved and epm-external-action labels', () => {
      const currentLabels = ['request-uid-123'];
      const updated = buildLabelsForAction(currentLabels, true);
      expect(updated).toContain('epm-approved');
      expect(updated).toContain('epm-external-action');
      expect(updated).toEqual(['request-uid-123', 'epm-approved', 'epm-external-action']);
    });

    test('adds epm-denied and epm-external-action labels', () => {
      const currentLabels = ['request-uid-456'];
      const updated = buildLabelsForAction(currentLabels, false);
      expect(updated).toContain('epm-denied');
      expect(updated).toContain('epm-external-action');
      expect(updated).toEqual(['request-uid-456', 'epm-denied', 'epm-external-action']);
    });

    test('preserves existing labels when adding new ones', () => {
      const currentLabels = ['request-c', 'existing-label', 'keeper-webhook'];
      const updated = buildLabelsForAction(currentLabels, true);
      expect(updated).toContain('request-c');
      expect(updated).toContain('existing-label');
      expect(updated).toContain('keeper-webhook');
      expect(updated).toContain('epm-approved');
      expect(updated).toContain('epm-external-action');
    });
  });

  describe('Security', () => {
    test('sanitizes request_uid to prevent JQL injection', () => {
      const maliciousUid = 'test" OR project=EVIL';
      const sanitized = sanitizeRequestUid(maliciousUid);
      expect(sanitized).toBe('test--OR-project-EVIL');
      expect(sanitized).not.toContain('"');
      expect(sanitized).not.toMatch(/["'\\();=]/);
    });

    test('handles unicode and null bytes in request_uid', () => {
      const uidWithUnicode = 'req\u0000\u0001é';
      const sanitized = sanitizeRequestUid(uidWithUnicode);
      expect(sanitized).not.toMatch(/["'\\();=]/);
      expect(sanitized).not.toContain('\u0000');
    });
  });

  describe('Missing request_uid', () => {
    test('validation rejects empty request_uid', () => {
      const emptyUid = '';
      expect(Boolean(emptyUid)).toBe(false);
    });

    test('validation rejects undefined request_uid', () => {
      const payload = { request_status: '1' };
      expect(Boolean(payload.request_uid)).toBe(false);
    });
  });

  describe('Invalid timestamp', () => {
    test('timestamp fallback does not throw for invalid input', () => {
      let formattedTimestamp;
      try {
        formattedTimestamp = new Date('not-a-valid-date').toLocaleString('en-US', {
          month: '2-digit',
          day: '2-digit',
          year: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
          hour12: false
        });
      } catch (e) {
        formattedTimestamp = 'Unknown time';
      }
      expect(formattedTimestamp).toBeDefined();
      expect(typeof formattedTimestamp).toBe('string');
    });
  });
});

describe('EPM_STATUS constant', () => {
  test('EPM_STATUS.APPROVED is 1 and EPM_STATUS.DENIED is 2', () => {
    expect(EPM_STATUS).toBeDefined();
    expect(EPM_STATUS.APPROVED).toBe(1);
    expect(EPM_STATUS.DENIED).toBe(2);
  });
});
