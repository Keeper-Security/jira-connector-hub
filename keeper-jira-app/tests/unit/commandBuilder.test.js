/**
 * Unit Tests for Command Builder
 * 
 * Tests the command building, validation, and escaping functions
 * that prevent command injection and ensure proper CLI formatting.
 */

const {
  VALIDATION_LIMITS,
  VALIDATION_PATTERNS,
  validateField,
  validateEmails,
  validatePhoneEntry,
  validateCommandParameters,
  escapeForSingleQuotes,
  escapeForDoubleQuotes,
  sanitizeJsonObject,
  capitalizeFieldName,
  buildKeeperCommand
} = require('../../src/modules/utils/commandBuilder');

// ============================================================================
// Shell Escaping Tests
// ============================================================================

describe('escapeForSingleQuotes', () => {
  test('returns empty string for null/undefined', () => {
    expect(escapeForSingleQuotes(null)).toBe('');
    expect(escapeForSingleQuotes(undefined)).toBe('');
  });

  test('converts non-strings to strings', () => {
    expect(escapeForSingleQuotes(123)).toBe('123');
    expect(escapeForSingleQuotes(true)).toBe('true');
  });

  test('returns simple strings unchanged', () => {
    expect(escapeForSingleQuotes('hello')).toBe('hello');
    expect(escapeForSingleQuotes('test@example.com')).toBe('test@example.com');
  });

  test('escapes single quotes properly', () => {
    expect(escapeForSingleQuotes("it's a test")).toBe("it'\\''s a test");
    expect(escapeForSingleQuotes("'quoted'")).toBe("'\\''quoted'\\''");
    expect(escapeForSingleQuotes("O'Connor")).toBe("O'\\''Connor");
  });

  test('handles multiple single quotes', () => {
    expect(escapeForSingleQuotes("it's John's book")).toBe("it'\\''s John'\\''s book");
  });

  test('does not escape other special characters', () => {
    expect(escapeForSingleQuotes('$HOME')).toBe('$HOME');
    expect(escapeForSingleQuotes('`whoami`')).toBe('`whoami`');
    expect(escapeForSingleQuotes('"quoted"')).toBe('"quoted"');
  });
});

describe('escapeForDoubleQuotes', () => {
  test('returns empty string for null/undefined', () => {
    expect(escapeForDoubleQuotes(null)).toBe('');
    expect(escapeForDoubleQuotes(undefined)).toBe('');
  });

  test('converts non-strings to strings', () => {
    expect(escapeForDoubleQuotes(123)).toBe('123');
    expect(escapeForDoubleQuotes(false)).toBe('false');
  });

  test('returns simple strings unchanged', () => {
    expect(escapeForDoubleQuotes('hello')).toBe('hello');
    expect(escapeForDoubleQuotes('test@example.com')).toBe('test@example.com');
  });

  test('escapes double quotes', () => {
    expect(escapeForDoubleQuotes('say "hello"')).toBe('say \\"hello\\"');
  });

  test('escapes dollar signs', () => {
    expect(escapeForDoubleQuotes('$HOME')).toBe('\\$HOME');
    expect(escapeForDoubleQuotes('cost: $100')).toBe('cost: \\$100');
  });

  test('escapes backticks', () => {
    expect(escapeForDoubleQuotes('`whoami`')).toBe('\\`whoami\\`');
  });

  test('escapes backslashes', () => {
    expect(escapeForDoubleQuotes('path\\to\\file')).toBe('path\\\\to\\\\file');
  });

  test('escapes exclamation marks', () => {
    expect(escapeForDoubleQuotes('Hello!')).toBe('Hello\\!');
  });

  test('escapes multiple special characters together', () => {
    const input = 'echo "$USER" && `whoami` > file!';
    const expected = 'echo \\"\\$USER\\" && \\`whoami\\` > file\\!';
    expect(escapeForDoubleQuotes(input)).toBe(expected);
  });

  test('does not escape single quotes', () => {
    expect(escapeForDoubleQuotes("it's fine")).toBe("it's fine");
  });
});

describe('sanitizeJsonObject', () => {
  test('removes control characters from string values', () => {
    const input = { field: 'test\x00value\x1f' };
    const result = sanitizeJsonObject(input);
    expect(result.field).toBe('testvalue');
  });

  test('preserves non-string values', () => {
    const input = { num: 123, bool: true, obj: { nested: 'value' } };
    const result = sanitizeJsonObject(input);
    expect(result.num).toBe(123);
    expect(result.bool).toBe(true);
    expect(result.obj).toEqual({ nested: 'value' });
  });

  test('handles empty objects', () => {
    expect(sanitizeJsonObject({})).toEqual({});
  });

  test('preserves normal strings', () => {
    const input = { name: 'John Doe', email: 'john@example.com' };
    const result = sanitizeJsonObject(input);
    expect(result).toEqual(input);
  });
});

describe('capitalizeFieldName', () => {
  test('capitalizes first letter', () => {
    expect(capitalizeFieldName('title')).toBe('Title');
    expect(capitalizeFieldName('password')).toBe('Password');
  });

  test('handles empty/null inputs', () => {
    expect(capitalizeFieldName('')).toBe('');
    expect(capitalizeFieldName(null)).toBe('');
    expect(capitalizeFieldName(undefined)).toBe('');
  });

  test('handles already capitalized strings', () => {
    expect(capitalizeFieldName('Title')).toBe('Title');
  });

  test('handles single characters', () => {
    expect(capitalizeFieldName('a')).toBe('A');
  });
});

// ============================================================================
// Validation Tests
// ============================================================================

describe('validateField', () => {
  test('validates required fields', () => {
    const result = validateField('title', '', { required: true });
    expect(result.valid).toBe(false);
    expect(result.error).toContain('required');
  });

  test('passes empty non-required fields', () => {
    const result = validateField('notes', '', { required: false });
    expect(result.valid).toBe(true);
  });

  test('enforces length limits', () => {
    const longString = 'a'.repeat(VALIDATION_LIMITS.title + 1);
    const result = validateField('title', longString, { limitKey: 'title' });
    expect(result.valid).toBe(false);
    expect(result.error).toContain('exceeds maximum length');
  });

  test('validates email pattern', () => {
    expect(validateField('email', 'test@example.com', { pattern: 'email' }).valid).toBe(true);
    expect(validateField('email', 'invalid-email', { pattern: 'email' }).valid).toBe(false);
  });

  test('validates URL pattern', () => {
    expect(validateField('url', 'https://example.com', { pattern: 'url' }).valid).toBe(true);
    expect(validateField('url', 'not-a-url', { pattern: 'url' }).valid).toBe(false);
  });

  test('validates UID pattern', () => {
    expect(validateField('record', 'abc123_-XYZ', { pattern: 'uid' }).valid).toBe(true);
    expect(validateField('record', 'invalid uid!', { pattern: 'uid' }).valid).toBe(false);
  });

  test('rejects newlines by default', () => {
    const result = validateField('title', 'line1\nline2', { limitKey: 'title' });
    expect(result.valid).toBe(false);
    expect(result.error).toContain('newline');
  });

  test('allows newlines when configured', () => {
    const result = validateField('notes', 'line1\nline2', { allowNewlines: true });
    expect(result.valid).toBe(true);
  });
});

describe('validateEmails', () => {
  test('validates single email', () => {
    expect(validateEmails('test@example.com').valid).toBe(true);
  });

  test('validates multiple emails', () => {
    expect(validateEmails('a@b.com, c@d.com, e@f.com').valid).toBe(true);
  });

  test('rejects invalid email in list', () => {
    const result = validateEmails('valid@email.com, invalid-email, another@valid.com');
    expect(result.valid).toBe(false);
    expect(result.error).toContain('invalid-email');
  });

  test('handles empty string', () => {
    expect(validateEmails('').valid).toBe(true);
    expect(validateEmails(null).valid).toBe(true);
  });
});

describe('validatePhoneEntry', () => {
  test('validates complete phone entry', () => {
    const entry = { number: '+1-555-1234', region: 'US', ext: '123', type: 'Work' };
    expect(validatePhoneEntry(entry).valid).toBe(true);
  });

  test('requires phone number', () => {
    const entry = { region: 'US' };
    const result = validatePhoneEntry(entry);
    expect(result.valid).toBe(false);
    expect(result.error).toContain('required');
  });

  test('validates phone number format', () => {
    const entry = { number: 'not-a-phone!' };
    const result = validatePhoneEntry(entry);
    expect(result.valid).toBe(false);
  });

  test('handles null/undefined', () => {
    expect(validatePhoneEntry(null).valid).toBe(true);
    expect(validatePhoneEntry(undefined).valid).toBe(true);
  });
});

describe('validateCommandParameters', () => {
  test('validates record-add with required title', () => {
    const result = validateCommandParameters('record-add', {});
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('Title is required for record-add');
  });

  test('passes valid record-add parameters', () => {
    const result = validateCommandParameters('record-add', {
      title: 'Test Record',
      recordType: 'login',
      url: 'https://example.com'
    });
    expect(result.valid).toBe(true);
  });

  test('validates share-record requires record and user', () => {
    const result = validateCommandParameters('share-record', {});
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThanOrEqual(2);
  });

  test('passes cliCommand without validation', () => {
    const result = validateCommandParameters('any-action', {
      cliCommand: 'some pre-built command'
    });
    expect(result.valid).toBe(true);
  });
});

// ============================================================================
// Command Builder Tests
// ============================================================================

describe('buildKeeperCommand', () => {
  describe('record-add', () => {
    test('builds basic login record command', () => {
      const command = buildKeeperCommand('record-add', {
        title: 'My Login',
        recordType: 'login'
      }, 'TEST-1');
      
      expect(command).toContain('record-add');
      expect(command).toContain("--record-type='login'");
      expect(command).toContain('--title="My Login"');
      expect(command).toContain('Password=$GEN');
    });

    test('escapes title with special characters', () => {
      const command = buildKeeperCommand('record-add', {
        title: 'Test "quoted" $var',
        recordType: 'login'
      }, 'TEST-1');
      
      expect(command).toContain('--title="Test \\"quoted\\" \\$var"');
    });

    test('handles notes field', () => {
      const command = buildKeeperCommand('record-add', {
        title: 'Test',
        notes: 'Some notes'
      }, 'TEST-1');
      
      expect(command).toContain('Notes="Some notes"');
    });

    test('handles phone entries', () => {
      const command = buildKeeperCommand('record-add', {
        title: 'Contact',
        recordType: 'contact',
        phoneEntries: [{ number: '+1-555-1234', type: 'Work' }]
      }, 'TEST-1');
      
      expect(command).toContain("Phone='$JSON:");
      expect(command).toContain('+1-555-1234');
    });

    test('throws on missing title', () => {
      expect(() => {
        buildKeeperCommand('record-add', { recordType: 'login' }, 'TEST-1');
      }).toThrow('Title is required');
    });
  });

  describe('record-update', () => {
    test('builds record update command', () => {
      const command = buildKeeperCommand('record-update', {
        record: 'abc123',
        title: 'Updated Title'
      }, 'TEST-1');
      
      expect(command).toContain('record-update');
      expect(command).toContain('"abc123"');
      expect(command).toContain('Title="Updated Title"');
    });

    test('throws on missing record UID', () => {
      expect(() => {
        buildKeeperCommand('record-update', { title: 'Test' }, 'TEST-1');
      }).toThrow('Record UID is required');
    });
  });

  describe('share-record', () => {
    test('builds share record command', () => {
      const command = buildKeeperCommand('share-record', {
        record: 'abc123',
        user: 'user@example.com',
        action: 'grant'
      }, 'TEST-1');
      
      expect(command).toContain('share-record');
      expect(command).toContain("--record='abc123'");
      expect(command).toContain("--user='user@example.com'");
      expect(command).toContain("--action='grant'");
    });

    test('adds permission flags', () => {
      const command = buildKeeperCommand('share-record', {
        record: 'abc123',
        user: 'user@example.com',
        can_share: true,
        can_write: true
      }, 'TEST-1');
      
      expect(command).toContain('--can-share');
      expect(command).toContain('--can-write');
    });

    test('escapes user email with quotes', () => {
      const command = buildKeeperCommand('share-record', {
        record: 'abc123',
        user: "user'test@example.com"
      }, 'TEST-1');
      
      expect(command).toContain("--user='user'\\''test@example.com'");
    });

    test('throws on missing record', () => {
      expect(() => {
        buildKeeperCommand('share-record', { user: 'user@example.com' }, 'TEST-1');
      }).toThrow('record UID is required');
    });

    test('throws on missing user', () => {
      expect(() => {
        buildKeeperCommand('share-record', { record: 'abc123' }, 'TEST-1');
      }).toThrow('User email is required');
    });
  });

  describe('share-folder', () => {
    test('builds share folder command', () => {
      const command = buildKeeperCommand('share-folder', {
        folder: 'folder123',
        user: 'user@example.com'
      }, 'TEST-1');
      
      expect(command).toContain('share-folder');
      expect(command).toContain("--folder='folder123'");
      expect(command).toContain("--user='user@example.com'");
    });
  });

  describe('pre-formatted commands', () => {
    test('returns cliCommand as-is', () => {
      const prebuilt = 'epm approval action --approve abc123';
      const command = buildKeeperCommand('epm approval action', {
        cliCommand: prebuilt
      }, 'TEST-1');
      
      expect(command).toBe(prebuilt);
    });
  });
});
