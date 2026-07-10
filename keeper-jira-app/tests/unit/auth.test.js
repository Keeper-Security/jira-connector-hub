/**
 * Unit tests for the pure auth helpers (KJ-26-03, KJ-26-07).
 *
 * These cover the testable surface of `src/modules/utils/auth.js`. The IO
 * wrappers (`getCurrentUserWithGroups`, `verifyProjectAdmin`,
 * `requireProjectAdmin`) live in `adminGate.js` and are exercised end-to-end
 * via Forge integration; the pure helpers below are the building blocks they
 * compose, so locking these down catches any future regressions.
 */

const {
  JIRA_ADMIN_GROUPS,
  API_KEY_KEEP_EXISTING_SENTINEL,
  isAdminGroup,
  extractProjectKey,
  maskApiKey,
  isMaskedApiKey,
  buildAdminVerdict,
} = require('../../src/modules/utils/auth');

describe('JIRA_ADMIN_GROUPS', () => {
  test('is a frozen Set with the canonical admin group names', () => {
    expect(JIRA_ADMIN_GROUPS instanceof Set).toBe(true);
    for (const name of [
      'org-admins',
      'site-admins',
      'jira-administrators',
      'system-administrators',
      'administrators',
    ]) {
      expect(JIRA_ADMIN_GROUPS.has(name)).toBe(true);
    }
  });

  test('cannot be mutated at runtime', () => {
    expect(Object.isFrozen(JIRA_ADMIN_GROUPS)).toBe(true);
  });
});

describe('isAdminGroup', () => {
  test('returns true for every canonical admin group name', () => {
    for (const name of JIRA_ADMIN_GROUPS) {
      expect(isAdminGroup(name)).toBe(true);
    }
  });

  test('trims whitespace before comparison', () => {
    expect(isAdminGroup('  site-admins ')).toBe(true);
  });

  test('returns false for unknown groups', () => {
    expect(isAdminGroup('developers')).toBe(false);
    expect(isAdminGroup('jira-users')).toBe(false);
    expect(isAdminGroup('')).toBe(false);
  });

  test('is case-sensitive (mirrors Jira API behaviour)', () => {
    expect(isAdminGroup('Site-Admins')).toBe(false);
    expect(isAdminGroup('SITE-ADMINS')).toBe(false);
  });

  test('returns false for non-string inputs', () => {
    expect(isAdminGroup(null)).toBe(false);
    expect(isAdminGroup(undefined)).toBe(false);
    expect(isAdminGroup(123)).toBe(false);
    expect(isAdminGroup({})).toBe(false);
  });
});

describe('extractProjectKey', () => {
  test('returns the prefix before the first dash', () => {
    expect(extractProjectKey('SEC-123')).toBe('SEC');
    expect(extractProjectKey('AB-1')).toBe('AB');
    expect(extractProjectKey('LONGPROJECTKEY-9999')).toBe('LONGPROJECTKEY');
  });

  test('handles multi-dash keys (only first dash splits)', () => {
    // Jira project keys never contain dashes, but defensively split on first.
    expect(extractProjectKey('FOO-BAR-1')).toBe('FOO');
  });

  test('returns empty string for malformed inputs', () => {
    expect(extractProjectKey('')).toBe('');
    expect(extractProjectKey(null)).toBe('');
    expect(extractProjectKey(undefined)).toBe('');
    expect(extractProjectKey(123)).toBe('');
    expect(extractProjectKey('-LEADING')).toBe('');
    expect(extractProjectKey('NO_DASH')).toBe('');
  });
});

describe('maskApiKey', () => {
  test('returns asterisks plus the last 4 chars for typical keys', () => {
    expect(maskApiKey('abcdefghij1234')).toBe('**********1234');
    expect(maskApiKey('SECRETKEY9999')).toBe('*********9999');
  });

  test('preserves length so the UI placeholder still looks like a key', () => {
    const key = 'a'.repeat(40);
    const masked = maskApiKey(key);
    expect(masked.length).toBe(key.length);
    expect(masked.endsWith('aaaa')).toBe(true);
    expect(masked.startsWith('*')).toBe(true);
  });

  test('fully masks short keys (<= 4 chars)', () => {
    expect(maskApiKey('a')).toBe('*');
    expect(maskApiKey('ab')).toBe('**');
    expect(maskApiKey('abcd')).toBe('****');
  });

  test('returns the input for falsy/non-string values', () => {
    expect(maskApiKey(undefined)).toBeUndefined();
    expect(maskApiKey(null)).toBeNull();
    expect(maskApiKey('')).toBe('');
    expect(maskApiKey(0)).toBe(0);
  });

  test('trims before masking', () => {
    expect(maskApiKey('   abcdefgh   ')).toBe('****efgh');
  });
});

describe('isMaskedApiKey', () => {
  test('recognises the keep-existing sentinel', () => {
    expect(isMaskedApiKey(API_KEY_KEEP_EXISTING_SENTINEL)).toBe(true);
    expect(isMaskedApiKey('__KEEP_EXISTING__')).toBe(true);
  });

  test('rejects round-tripped masked values (sentinel-only mode)', () => {
    expect(isMaskedApiKey('****abcd')).toBe(false);
    expect(isMaskedApiKey('*'.repeat(36) + '1234')).toBe(false);
    expect(isMaskedApiKey(maskApiKey('really-long-secret-here'))).toBe(false);
  });

  test('rejects values that look like real keys', () => {
    expect(isMaskedApiKey('plain-text-secret')).toBe(false);
    expect(isMaskedApiKey('a'.repeat(40))).toBe(false);
    expect(isMaskedApiKey('Bearer abcd')).toBe(false);
  });

  test('rejects empty / non-string inputs', () => {
    expect(isMaskedApiKey('')).toBe(false);
    expect(isMaskedApiKey(null)).toBe(false);
    expect(isMaskedApiKey(undefined)).toBe(false);
    expect(isMaskedApiKey(123)).toBe(false);
  });

  test('rejects values starting with asterisks (no regex false-positive)', () => {
    expect(isMaskedApiKey('****')).toBe(false);
    expect(isMaskedApiKey('*real-api-key')).toBe(false);
    expect(isMaskedApiKey('***secret')).toBe(false);
  });

  test('does not false-positive on keys starting with *', () => {
    expect(isMaskedApiKey('*realApiKeyValue')).toBe(false);
    expect(isMaskedApiKey('**key1234')).toBe(false);
  });
});

describe('buildAdminVerdict', () => {
  const baseUser = {
    accountId: 'acc-1',
    displayName: 'Alice Admin',
    emailAddress: 'alice@example.com',
  };

  test('marks admin when user is in a canonical admin group', () => {
    const verdict = buildAdminVerdict({
      userData: baseUser,
      userGroups: ['developers', 'jira-administrators'],
      hasPermAdmin: false,
      projectKey: 'SEC',
    });
    expect(verdict.isAdmin).toBe(true);
    expect(verdict.adminCheckMethod).toBe('group_membership');
    expect(verdict.userKey).toBe('acc-1');
    expect(verdict.displayName).toBe('Alice Admin');
    expect(verdict.projectKey).toBe('SEC');
    expect(verdict.error).toBeUndefined();
  });

  test('falls back to ADMINISTER_PROJECTS when no admin group is present', () => {
    const verdict = buildAdminVerdict({
      userData: baseUser,
      userGroups: ['developers'],
      hasPermAdmin: true,
      projectKey: 'SEC',
    });
    expect(verdict.isAdmin).toBe(true);
    expect(verdict.adminCheckMethod).toBe('project_permissions');
  });

  test('denies and records "none" when both signals are false', () => {
    const verdict = buildAdminVerdict({
      userData: baseUser,
      userGroups: ['developers'],
      hasPermAdmin: false,
      projectKey: 'SEC',
    });
    expect(verdict.isAdmin).toBe(false);
    expect(verdict.adminCheckMethod).toBe('none');
  });

  test('preserves the group_membership method even if hasPermAdmin is also true', () => {
    const verdict = buildAdminVerdict({
      userData: baseUser,
      userGroups: ['site-admins'],
      hasPermAdmin: true,
      projectKey: 'SEC',
    });
    expect(verdict.isAdmin).toBe(true);
    expect(verdict.adminCheckMethod).toBe('group_membership');
  });

  test('surfaces error only when not admin', () => {
    const adminVerdict = buildAdminVerdict({
      userData: baseUser,
      userGroups: ['site-admins'],
      hasPermAdmin: false,
      projectKey: 'SEC',
      error: 'transient lookup failure',
    });
    expect(adminVerdict.error).toBeUndefined();

    const denied = buildAdminVerdict({
      userData: null,
      userGroups: [],
      hasPermAdmin: false,
      projectKey: 'SEC',
      error: 'transient lookup failure',
    });
    expect(denied.error).toBe('transient lookup failure');
    expect(denied.isAdmin).toBe(false);
  });

  test('falls back to "User" displayName when no fields are available', () => {
    const verdict = buildAdminVerdict({
      userData: null,
      userGroups: [],
      hasPermAdmin: false,
      projectKey: '',
    });
    expect(verdict.displayName).toBe('User');
    expect(verdict.userKey).toBeNull();
    expect(verdict.projectKey).toBe('');
  });

  test('prefers accountId, then key, then null', () => {
    expect(
      buildAdminVerdict({
        userData: { key: 'legacy-key' },
        userGroups: [],
        hasPermAdmin: true,
        projectKey: 'SEC',
      }).userKey,
    ).toBe('legacy-key');

    expect(
      buildAdminVerdict({
        userData: { accountId: 'a', key: 'b' },
        userGroups: [],
        hasPermAdmin: true,
        projectKey: 'SEC',
      }).userKey,
    ).toBe('a');
  });

  test('treats hasPermAdmin = "true" string as NOT admin (strict boolean)', () => {
    const verdict = buildAdminVerdict({
      userData: baseUser,
      userGroups: ['developers'],
      hasPermAdmin: 'true',
      projectKey: 'SEC',
    });
    expect(verdict.isAdmin).toBe(false);
    expect(verdict.adminCheckMethod).toBe('none');
  });
});
