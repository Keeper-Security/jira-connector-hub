/**
 * Unit Tests for Error Response Utility
 * 
 * Tests the structured error response system that provides
 * better UX control for frontend error handling.
 */

const {
  ERROR_CODES,
  successResponse,
  errorResponse,
  validationError,
  rateLimitError,
  connectionError,
  keeperError,
  pedmError,
  errorFromException
} = require('../../src/modules/utils/errorResponse');

// ============================================================================
// Success Response Tests
// ============================================================================

describe('successResponse', () => {
  test('creates basic success response', () => {
    const result = successResponse();
    expect(result.success).toBe(true);
  });

  test('includes provided data', () => {
    const result = successResponse({ records: [], count: 0 });
    expect(result.success).toBe(true);
    expect(result.records).toEqual([]);
    expect(result.count).toBe(0);
  });

  test('includes optional message', () => {
    const result = successResponse({}, 'Operation completed');
    expect(result.success).toBe(true);
    expect(result.message).toBe('Operation completed');
  });
});

// ============================================================================
// Error Response Tests
// ============================================================================

describe('errorResponse', () => {
  test('creates basic error response', () => {
    const result = errorResponse(ERROR_CODES.INTERNAL_ERROR, 'Something went wrong');
    expect(result.success).toBe(false);
    expect(result.error).toBe('INTERNAL_ERROR');
    expect(result.message).toBe('Something went wrong');
  });

  test('includes troubleshooting steps from defaults', () => {
    const result = errorResponse(ERROR_CODES.AUTH_NOT_CONFIGURED, 'Not configured');
    expect(result.success).toBe(false);
    expect(result.troubleshooting).toBeDefined();
    expect(Array.isArray(result.troubleshooting)).toBe(true);
  });

  test('accepts custom troubleshooting steps', () => {
    const customSteps = ['Step 1', 'Step 2'];
    const result = errorResponse(ERROR_CODES.INTERNAL_ERROR, 'Error', {
      troubleshooting: customSteps
    });
    expect(result.troubleshooting).toEqual(customSteps);
  });

  test('includes field for validation errors', () => {
    const result = errorResponse(ERROR_CODES.VALIDATION_REQUIRED_FIELD, 'Title required', {
      field: 'title'
    });
    expect(result.field).toBe('title');
  });

  test('includes retryAfter for rate limits', () => {
    const result = errorResponse(ERROR_CODES.RATE_LIMIT_EXCEEDED, 'Too many requests', {
      retryAfter: 60
    });
    expect(result.retryAfter).toBe(60);
  });
});

// ============================================================================
// Specific Error Type Tests
// ============================================================================

describe('validationError', () => {
  test('creates validation error with field', () => {
    const result = validationError('email', 'Invalid email format');
    expect(result.success).toBe(false);
    expect(result.error).toBe(ERROR_CODES.VALIDATION_REQUIRED_FIELD);
    expect(result.message).toBe('Invalid email format');
    expect(result.field).toBe('email');
  });

  test('accepts custom error code', () => {
    const result = validationError('url', 'Invalid URL', ERROR_CODES.VALIDATION_INVALID_URL);
    expect(result.error).toBe(ERROR_CODES.VALIDATION_INVALID_URL);
  });
});

describe('rateLimitError', () => {
  test('creates minute rate limit error', () => {
    const result = rateLimitError('minute', 60, 0);
    expect(result.success).toBe(false);
    expect(result.error).toBe(ERROR_CODES.RATE_LIMIT_MINUTE);
    expect(result.retryAfter).toBe(60);
    expect(result.details.limitType).toBe('minute');
  });

  test('creates hour rate limit error', () => {
    const result = rateLimitError('hour', 3600, 5);
    expect(result.success).toBe(false);
    expect(result.error).toBe(ERROR_CODES.RATE_LIMIT_HOUR);
    expect(result.details.remaining).toBe(5);
  });
});

describe('connectionError', () => {
  test('creates basic connection error', () => {
    const result = connectionError('Failed to connect');
    expect(result.success).toBe(false);
    expect(result.error).toBe(ERROR_CODES.CONNECTION_FAILED);
  });

  test('detects tunnel offline error', () => {
    const result = connectionError('ngrok tunnel is offline');
    expect(result.error).toBe(ERROR_CODES.CONNECTION_TUNNEL_OFFLINE);
  });

  test('detects timeout error', () => {
    const result = connectionError('Request timeout after 30s');
    expect(result.error).toBe(ERROR_CODES.CONNECTION_TIMEOUT);
  });

  test('detects service unavailable', () => {
    const result = connectionError('503 Service Unavailable');
    expect(result.error).toBe(ERROR_CODES.CONNECTION_SERVICE_UNAVAILABLE);
  });
});

describe('keeperError', () => {
  test('creates basic Keeper error', () => {
    const result = keeperError('Command failed');
    expect(result.success).toBe(false);
    expect(result.error).toBe(ERROR_CODES.KEEPER_COMMAND_FAILED);
  });

  test('detects not configured error', () => {
    const result = keeperError('Keeper API URL is required but not configured');
    expect(result.error).toBe(ERROR_CODES.KEEPER_NOT_CONFIGURED);
  });

  test('detects record not found', () => {
    const result = keeperError('Record does not exist');
    expect(result.error).toBe(ERROR_CODES.KEEPER_RECORD_NOT_FOUND);
  });

  test('detects permission denied', () => {
    const result = keeperError('Access denied: no permission');
    expect(result.error).toBe(ERROR_CODES.KEEPER_PERMISSION_DENIED);
  });

  test('detects queue full', () => {
    const result = keeperError('Queue capacity exceeded');
    expect(result.error).toBe(ERROR_CODES.KEEPER_QUEUE_FULL);
  });
});

describe('pedmError', () => {
  test('creates approved error', () => {
    const result = pedmError('approved');
    expect(result.success).toBe(false);
    expect(result.error).toBe(ERROR_CODES.PEDM_ALREADY_APPROVED);
    expect(result.message).toContain('already been approved');
  });

  test('creates denied error', () => {
    const result = pedmError('denied');
    expect(result.error).toBe(ERROR_CODES.PEDM_ALREADY_DENIED);
  });

  test('creates expired error', () => {
    const result = pedmError('expired');
    expect(result.error).toBe(ERROR_CODES.PEDM_EXPIRED);
  });

  test('accepts custom message', () => {
    const result = pedmError('approved', 'Custom message');
    expect(result.message).toBe('Custom message');
  });
});

// ============================================================================
// Error Conversion Tests
// ============================================================================

describe('errorFromException', () => {
  test('converts approval approved error', () => {
    const error = new Error('This approval request has already been approved');
    const result = errorFromException(error);
    expect(result.error).toBe(ERROR_CODES.PEDM_ALREADY_APPROVED);
  });

  test('converts rate limit error', () => {
    const error = new Error('Rate limit exceeded');
    const result = errorFromException(error);
    expect(result.error).toBe(ERROR_CODES.RATE_LIMIT_EXCEEDED);
  });

  test('converts validation error', () => {
    const error = new Error('Field is required');
    const result = errorFromException(error);
    expect(result.error).toBe(ERROR_CODES.VALIDATION_REQUIRED_FIELD);
  });

  test('defaults to internal error', () => {
    const error = new Error('Some random error');
    const result = errorFromException(error);
    expect(result.error).toBe(ERROR_CODES.INTERNAL_ERROR);
  });

  test('preserves original message', () => {
    const error = new Error('Specific error details');
    const result = errorFromException(error);
    expect(result.message).toBe('Specific error details');
  });
});

// ============================================================================
// Error Code Coverage Tests
// ============================================================================

describe('ERROR_CODES', () => {
  test('has all required validation codes', () => {
    expect(ERROR_CODES.VALIDATION_REQUIRED_FIELD).toBeDefined();
    expect(ERROR_CODES.VALIDATION_INVALID_FORMAT).toBeDefined();
    expect(ERROR_CODES.VALIDATION_INVALID_URL).toBeDefined();
  });

  test('has all required auth codes', () => {
    expect(ERROR_CODES.AUTH_NOT_CONFIGURED).toBeDefined();
    expect(ERROR_CODES.AUTH_PERMISSION_DENIED).toBeDefined();
  });

  test('has all required rate limit codes', () => {
    expect(ERROR_CODES.RATE_LIMIT_EXCEEDED).toBeDefined();
    expect(ERROR_CODES.RATE_LIMIT_MINUTE).toBeDefined();
    expect(ERROR_CODES.RATE_LIMIT_HOUR).toBeDefined();
  });

  test('has all required Keeper codes', () => {
    expect(ERROR_CODES.KEEPER_NOT_CONFIGURED).toBeDefined();
    expect(ERROR_CODES.KEEPER_COMMAND_FAILED).toBeDefined();
    expect(ERROR_CODES.KEEPER_RECORD_NOT_FOUND).toBeDefined();
  });

  test('has all required PEDM codes', () => {
    expect(ERROR_CODES.PEDM_ALREADY_APPROVED).toBeDefined();
    expect(ERROR_CODES.PEDM_ALREADY_DENIED).toBeDefined();
    expect(ERROR_CODES.PEDM_EXPIRED).toBeDefined();
  });
});
