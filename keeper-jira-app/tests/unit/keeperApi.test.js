/**
 * Unit tests for rate-limit bucket classification.
 *
 * Covers getRateLimitBucketForCommand and READ_ONLY_COMMAND_VERBS exposed
 * via the CJS helper at src/modules/utils/rateLimitBucket.js (the canonical
 * source used by keeperApi.js at runtime).
 */

const {
  getRateLimitBucketForCommand,
  READ_ONLY_COMMAND_VERBS
} = require('../../src/modules/utils/rateLimitBucket');

describe('READ_ONLY_COMMAND_VERBS', () => {
  test('contains expected read-only verbs', () => {
    const expected = [
      'list', 'ls', 'get', 'search', 'tree', 'cd',
      'nsf-list', 'nsf-get',
      'record-type-info', 'rti',
      'service-status',
      'enterprise-info', 'ei', 'enterprise-role', 'enterprise-user',
    ];
    expected.forEach(verb => {
      expect(READ_ONLY_COMMAND_VERBS.has(verb)).toBe(true);
    });
  });

  test('does not contain write verbs', () => {
    const writeVerbs = ['record-add', 'share-record', 'device-approve', 'record-update'];
    writeVerbs.forEach(verb => {
      expect(READ_ONLY_COMMAND_VERBS.has(verb)).toBe(false);
    });
  });
});

describe('getRateLimitBucketForCommand', () => {
  test('classifies read-only verbs as "read"', () => {
    expect(getRateLimitBucketForCommand('list')).toBe('read');
    expect(getRateLimitBucketForCommand('get')).toBe('read');
    expect(getRateLimitBucketForCommand('search')).toBe('read');
    expect(getRateLimitBucketForCommand('nsf-list')).toBe('read');
    expect(getRateLimitBucketForCommand('service-status')).toBe('read');
    expect(getRateLimitBucketForCommand('rti')).toBe('read');
  });

  test('classifies write verbs as "write"', () => {
    expect(getRateLimitBucketForCommand('record-add')).toBe('write');
    expect(getRateLimitBucketForCommand('share-record')).toBe('write');
    expect(getRateLimitBucketForCommand('device-approve')).toBe('write');
  });

  test('returns "write" for empty input', () => {
    expect(getRateLimitBucketForCommand('')).toBe('write');
    expect(getRateLimitBucketForCommand('   ')).toBe('write');
  });

  test('returns "write" for null/undefined input', () => {
    expect(getRateLimitBucketForCommand(null)).toBe('write');
    expect(getRateLimitBucketForCommand(undefined)).toBe('write');
  });

  test('is case-insensitive', () => {
    expect(getRateLimitBucketForCommand('LIST')).toBe('read');
    expect(getRateLimitBucketForCommand('Get')).toBe('read');
    expect(getRateLimitBucketForCommand('SEARCH')).toBe('read');
    expect(getRateLimitBucketForCommand('NSF-LIST')).toBe('read');
  });

  test('extracts verb from full command strings', () => {
    expect(getRateLimitBucketForCommand('nsf-list --records --format=json')).toBe('read');
    expect(getRateLimitBucketForCommand('list -sf')).toBe('read');
    expect(getRateLimitBucketForCommand('record-add --title "My Record"')).toBe('write');
    expect(getRateLimitBucketForCommand('share-record -e alice@example.com')).toBe('write');
  });

  test('handles leading/trailing whitespace in command', () => {
    expect(getRateLimitBucketForCommand('  list  ')).toBe('read');
    expect(getRateLimitBucketForCommand('\tget\t')).toBe('read');
  });

  test('returns "write" for non-string input', () => {
    expect(getRateLimitBucketForCommand(42)).toBe('write');
    expect(getRateLimitBucketForCommand({})).toBe('write');
    expect(getRateLimitBucketForCommand([])).toBe('write');
  });
});
