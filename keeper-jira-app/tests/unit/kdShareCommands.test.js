/**
 * Unit tests for Keeper Drive share-command builders.
 *
 * Covers:
 *   - KD positives: kd-share-folder, kd-share-record, kd-record-permission
 *   - Sanity around emails / role / expiration / recursive flags
 *   - Lookup map shared between command-name resolution and the allowlist
 *
 * Classic command-string regressions are guarded indirectly: this module is
 * additive (only invoked when `mode === 'kd'`), so Classic emitted strings
 * are unaffected by anything tested here.
 */

const {
  KD_COMMAND_NAME_MAP,
  KD_ROLES,
  appendEmails,
  appendAction,
  appendRole,
  appendRecursive,
  appendKdExpiration,
  toKdExpireAt,
  buildKdShareFolderArgs,
  buildKdShareRecordArgs,
  buildKdRecordPermissionArgs
} = require('../../src/modules/utils/kdShareCommands');

describe('KD_COMMAND_NAME_MAP', () => {
  test('maps share/permission UI actions to kd-* commands', () => {
    expect(KD_COMMAND_NAME_MAP['share-folder']).toBe('kd-share-folder');
    expect(KD_COMMAND_NAME_MAP['share-record']).toBe('kd-share-record');
    expect(KD_COMMAND_NAME_MAP['record-permission']).toBe('kd-record-permission');
  });

  test('still includes record-add / record-update mappings', () => {
    expect(KD_COMMAND_NAME_MAP['record-add']).toBe('kd-record-add');
    expect(KD_COMMAND_NAME_MAP['record-update']).toBe('kd-record-update');
  });

  test('is frozen (single source of truth)', () => {
    expect(Object.isFrozen(KD_COMMAND_NAME_MAP)).toBe(true);
  });
});

describe('KD_ROLES', () => {
  test('matches Commander allowed values', () => {
    expect(KD_ROLES).toEqual([
      'viewer',
      'share-manager',
      'content-manager',
      'content-share-manager',
      'full-manager'
    ]);
  });
});

describe('appendEmails', () => {
  test('returns command unchanged when userField is empty', () => {
    expect(appendEmails('cmd', undefined)).toBe('cmd');
    expect(appendEmails('cmd', '')).toBe('cmd');
  });

  test('emits one -e flag per comma-separated email', () => {
    expect(appendEmails('', 'alice@example.com')).toBe(" -e 'alice@example.com'");
    expect(appendEmails('', 'alice@example.com, bob@example.com')).toBe(
      " -e 'alice@example.com' -e 'bob@example.com'"
    );
  });

  test('escapes single quotes in email values', () => {
    expect(appendEmails('', "weird'user@example.com")).toBe(
      " -e 'weird'\\''user@example.com'"
    );
  });
});

describe('appendAction', () => {
  test('appends -a <action> when set', () => {
    expect(appendAction('', 'grant')).toBe(' -a grant');
    expect(appendAction('', 'revoke')).toBe(' -a revoke');
    expect(appendAction('', 'remove')).toBe(' -a remove');
  });

  test('no-ops when action is missing', () => {
    expect(appendAction('cmd', undefined)).toBe('cmd');
    expect(appendAction('cmd', '')).toBe('cmd');
  });
});

describe('appendRole', () => {
  test('appends -r <role> on grant', () => {
    expect(appendRole('', { role: 'viewer' }, 'grant')).toBe(' -r viewer');
  });

  test('appends -r on revoke (filter usage)', () => {
    expect(appendRole('', { role: 'viewer' }, 'revoke')).toBe(' -r viewer');
  });

  test('skips role for remove (kd-share-folder)', () => {
    expect(appendRole('', { role: 'viewer' }, 'remove')).toBe('');
  });

  test('skips role for owner (kd-share-record)', () => {
    expect(appendRole('', { role: 'viewer' }, 'owner')).toBe('');
  });

  test('no-ops when role is missing', () => {
    expect(appendRole('cmd', {}, 'grant')).toBe('cmd');
  });
});

describe('appendRecursive', () => {
  test('emits -R when recursive is truthy', () => {
    expect(appendRecursive('', { recursive: true })).toBe(' -R');
    expect(appendRecursive('', { recursive: 'true' })).toBe(' -R');
  });

  test('no-ops when recursive is false/absent', () => {
    expect(appendRecursive('cmd', {})).toBe('cmd');
    expect(appendRecursive('cmd', { recursive: false })).toBe('cmd');
  });
});

describe('toKdExpireAt', () => {
  test('returns input unchanged when it already has Z suffix', () => {
    expect(toKdExpireAt('2027-01-01T00:00:00Z')).toBe('2027-01-01T00:00:00Z');
  });

  test('returns input unchanged when it has explicit offset', () => {
    expect(toKdExpireAt('2027-01-01T00:00:00+05:30')).toBe('2027-01-01T00:00:00+05:30');
  });

  test('converts a datetime-local string to an ISO UTC string', () => {
    const result = toKdExpireAt('2027-01-01T00:00');
    expect(result).toMatch(/Z$/);
    expect(new Date(result).toISOString()).toBe(result);
  });

  test('returns empty string for empty input', () => {
    expect(toKdExpireAt('')).toBe('');
    expect(toKdExpireAt(undefined)).toBe('');
  });
});

describe('appendKdExpiration', () => {
  test('emits ISO --expire-at when expiration_type is expire-at', () => {
    const out = appendKdExpiration('', {
      expiration_type: 'expire-at',
      expire_at: '2027-01-01T00:00:00Z'
    });
    expect(out).toBe(' --expire-at "2027-01-01T00:00:00Z"');
  });

  test('emits --expire-in <duration> when expiration_type is expire-in', () => {
    expect(
      appendKdExpiration('', { expiration_type: 'expire-in', expire_in: '30d' })
    ).toBe(' --expire-in 30d');
  });

  test('drops malformed expire_in entirely (no shell injection surface)', () => {
    expect(
      appendKdExpiration('', { expiration_type: 'expire-in', expire_in: '30d; rm -rf /' })
    ).toBe('');
  });

  test('accepts mi / mo / y units documented by Commander', () => {
    expect(
      appendKdExpiration('', { expiration_type: 'expire-in', expire_in: '30mi' })
    ).toBe(' --expire-in 30mi');
    expect(
      appendKdExpiration('', { expiration_type: 'expire-in', expire_in: '6mo' })
    ).toBe(' --expire-in 6mo');
    expect(
      appendKdExpiration('', { expiration_type: 'expire-in', expire_in: '1y' })
    ).toBe(' --expire-in 1y');
  });

  test('accepts literal `never`', () => {
    expect(
      appendKdExpiration('', { expiration_type: 'expire-in', expire_in: 'never' })
    ).toBe(' --expire-in never');
  });

  test('no-ops when expiration is none / missing', () => {
    expect(appendKdExpiration('cmd', {})).toBe('cmd');
    expect(appendKdExpiration('cmd', { expiration_type: 'none' })).toBe('cmd');
  });
});

describe('buildKdShareFolderArgs', () => {
  test('matches the known-good CLI form (grant + role + email)', () => {
    const args = buildKdShareFolderArgs({
      folder: 'A9c07imejy27JD34Wl1bcQ',
      user: 'abdul.deshmukh@metronlabs.com',
      action: 'grant',
      role: 'content-share-manager'
    });
    expect(args).toBe(
      " 'A9c07imejy27JD34Wl1bcQ' -e 'abdul.deshmukh@metronlabs.com' -a grant -r content-share-manager"
    );
  });

  test('supports multiple -e emails and --expire-in', () => {
    const args = buildKdShareFolderArgs({
      folder: 'FOLDER_UID',
      user: 'alice@example.com, bob@example.com',
      action: 'grant',
      role: 'viewer',
      expiration_type: 'expire-in',
      expire_in: '30d'
    });
    expect(args).toBe(
      " 'FOLDER_UID' -e 'alice@example.com' -e 'bob@example.com' -a grant -r viewer --expire-in 30d"
    );
  });

  test('does NOT emit role on remove action', () => {
    const args = buildKdShareFolderArgs({
      folder: 'FOLDER_UID',
      user: 'alice@example.com',
      action: 'remove',
      role: 'viewer'
    });
    expect(args).toBe(" 'FOLDER_UID' -e 'alice@example.com' -a remove");
  });

  test('does NOT emit Classic -p/-o/-s/-d/--force flags', () => {
    const args = buildKdShareFolderArgs({
      folder: 'FOLDER_UID',
      user: 'alice@example.com',
      action: 'grant',
      role: 'viewer',
      manage_records: true,
      manage_users: true,
      can_share: true,
      can_edit: true
    });
    expect(args).not.toMatch(/-p /);
    expect(args).not.toMatch(/-o /);
    expect(args).not.toMatch(/-s /);
    expect(args).not.toMatch(/-d /);
    expect(args).not.toMatch(/--force/);
  });
});

describe('buildKdShareRecordArgs', () => {
  test('grant on a record UID emits role', () => {
    const args = buildKdShareRecordArgs({
      record: 'REC_UID',
      user: 'alice@example.com',
      action: 'grant',
      role: 'viewer'
    });
    expect(args).toBe(" 'REC_UID' -e 'alice@example.com' -a grant -r viewer");
  });

  test('revoke does not require role; passes role through as filter when set', () => {
    expect(
      buildKdShareRecordArgs({
        record: 'REC_UID',
        user: 'alice@example.com',
        action: 'revoke'
      })
    ).toBe(" 'REC_UID' -e 'alice@example.com' -a revoke");

    expect(
      buildKdShareRecordArgs({
        record: 'REC_UID',
        user: 'alice@example.com',
        action: 'revoke',
        role: 'viewer'
      })
    ).toBe(" 'REC_UID' -e 'alice@example.com' -a revoke -r viewer");
  });

  test('owner action never emits -r', () => {
    expect(
      buildKdShareRecordArgs({
        record: 'REC_UID',
        user: 'bob@example.com',
        action: 'owner',
        role: 'viewer'
      })
    ).toBe(" 'REC_UID' -e 'bob@example.com' -a owner");
  });

  test('folder positional + recursive grant', () => {
    const args = buildKdShareRecordArgs({
      sharedFolder: 'FOLDER_UID',
      user: 'alice@example.com',
      action: 'grant',
      role: 'viewer',
      recursive: true
    });
    expect(args).toBe(
      " 'FOLDER_UID' -e 'alice@example.com' -a grant -r viewer -R"
    );
  });

  test('does NOT emit Classic -s / -w / -f flags', () => {
    const args = buildKdShareRecordArgs({
      record: 'REC_UID',
      user: 'alice@example.com',
      action: 'grant',
      role: 'viewer',
      can_share: true,
      can_write: true
    });
    expect(args).not.toMatch(/ -s\b/);
    expect(args).not.toMatch(/ -w\b/);
    expect(args).not.toMatch(/ -f\b/);
  });
});

describe('buildKdRecordPermissionArgs', () => {
  test('grant with role and -f', () => {
    expect(
      buildKdRecordPermissionArgs({
        folder: 'FOLDER_UID',
        action: 'grant',
        role: 'viewer'
      })
    ).toBe(" 'FOLDER_UID' -a grant -r viewer -f");
  });

  test('revoke recursive with -f', () => {
    expect(
      buildKdRecordPermissionArgs({
        folder: 'FOLDER_UID',
        action: 'revoke',
        recursive: true
      })
    ).toBe(" 'FOLDER_UID' -a revoke -R -f");
  });

  test('falls back to sharedFolder when folder is absent', () => {
    expect(
      buildKdRecordPermissionArgs({
        sharedFolder: 'FOLDER_UID',
        action: 'grant',
        role: 'content-manager'
      })
    ).toBe(" 'FOLDER_UID' -a grant -r content-manager -f");
  });

  test('does NOT emit Classic -d / -s flags', () => {
    const args = buildKdRecordPermissionArgs({
      folder: 'FOLDER_UID',
      action: 'grant',
      role: 'viewer',
      can_share: true,
      can_edit: true
    });
    expect(args).not.toMatch(/ -d\b/);
    expect(args).not.toMatch(/ -s\b/);
  });
});
