/**
 * Unit tests for the server-side password complexity policy (KJ-26-04).
 */

const {
  PASSWORD_POLICY,
  validatePasswordComplexity,
  formatPasswordPolicyError,
} = require('../../src/modules/utils/passwordPolicy');

describe('PASSWORD_POLICY', () => {
  test('is frozen and matches the documented minimums', () => {
    expect(Object.isFrozen(PASSWORD_POLICY)).toBe(true);
    expect(PASSWORD_POLICY).toMatchObject({
      minLength: 8,
      requireUppercase: true,
      requireLowercase: true,
      requireDigit: true,
      requireSpecial: true,
    });
  });
});

describe('validatePasswordComplexity', () => {
  test('accepts undefined / null / empty (callers control required-ness)', () => {
    expect(validatePasswordComplexity(undefined)).toEqual({ valid: true, errors: [] });
    expect(validatePasswordComplexity(null)).toEqual({ valid: true, errors: [] });
    expect(validatePasswordComplexity('')).toEqual({ valid: true, errors: [] });
  });

  test('bypasses complexity for generation sentinels', () => {
    expect(validatePasswordComplexity('$GEN')).toEqual({ valid: true, errors: [] });
    expect(validatePasswordComplexity('generate')).toEqual({ valid: true, errors: [] });
  });

  test('rejects non-string types', () => {
    const result = validatePasswordComplexity(12345678);
    expect(result.valid).toBe(false);
    expect(result.errors).toEqual(['Password must be a string']);
  });

  test('accepts a password that meets every requirement', () => {
    const result = validatePasswordComplexity('Aa1@aaaa');
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  test('flags missing length', () => {
    const result = validatePasswordComplexity('Aa1@a'); // 5 chars
    expect(result.valid).toBe(false);
    expect(result.errors).toEqual(expect.arrayContaining(['at least 8 characters']));
  });

  test('flags missing uppercase', () => {
    const result = validatePasswordComplexity('aaa1@aaa');
    expect(result.valid).toBe(false);
    expect(result.errors).toEqual(expect.arrayContaining(['at least one uppercase letter']));
  });

  test('flags missing lowercase', () => {
    const result = validatePasswordComplexity('AAA1@AAA');
    expect(result.valid).toBe(false);
    expect(result.errors).toEqual(expect.arrayContaining(['at least one lowercase letter']));
  });

  test('flags missing digit', () => {
    const result = validatePasswordComplexity('AAaa@aaa');
    expect(result.valid).toBe(false);
    expect(result.errors).toEqual(expect.arrayContaining(['at least one digit']));
  });

  test('flags missing special character', () => {
    const result = validatePasswordComplexity('AAaa1aaa');
    expect(result.valid).toBe(false);
    expect(result.errors).toEqual(expect.arrayContaining(['at least one special character']));
  });

  test('accumulates every failure (does not short-circuit)', () => {
    const result = validatePasswordComplexity('abc');
    expect(result.valid).toBe(false);
    expect(result.errors).toEqual(expect.arrayContaining([
      'at least 8 characters',
      'at least one uppercase letter',
      'at least one digit',
      'at least one special character',
    ]));
  });

  test('honours overridden policy when provided', () => {
    const lax = { minLength: 4, requireUppercase: false, requireLowercase: false, requireDigit: false, requireSpecial: false };
    expect(validatePasswordComplexity('aaaa', lax)).toEqual({ valid: true, errors: [] });
  });
});

describe('formatPasswordPolicyError', () => {
  test('renders a human-friendly message from the error list', () => {
    const msg = formatPasswordPolicyError([
      'at least 8 characters',
      'at least one digit',
    ]);
    expect(msg).toBe(
      'Password does not meet complexity requirements: requires at least 8 characters, at least one digit',
    );
  });

  test('handles an empty error list gracefully', () => {
    expect(formatPasswordPolicyError([])).toBe(
      'Password does not meet complexity requirements: requires ',
    );
  });
});
