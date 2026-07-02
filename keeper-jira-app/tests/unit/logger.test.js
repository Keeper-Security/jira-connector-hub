/**
 * Unit tests for the logger's sensitive-key redaction.
 *
 * Focus is on KJ-26-08 — confirming that PII / credential identifiers
 * (`email`, `login`) and the pre-existing sensitive keys are redacted from
 * any structured payload before it hits stdout.
 *
 * Note: the logger captures `console.log` at module-load time, so the spy
 * must be installed BEFORE the module is `require`d. We rely on
 * `jest.isolateModules` to give every test a fresh logger instance whose
 * `console.log` reference is our spy.
 */

describe('logger sensitive-key redaction', () => {
  let logSpy;
  let logger;

  beforeEach(() => {
    logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.isolateModules(() => {
      logger = require('../../src/modules/utils/logger').logger;
    });
  });

  afterEach(() => {
    logSpy.mockRestore();
  });

  // Helper: grab the formatted-data string from the last `console.log` call.
  const lastLoggedData = () => {
    const calls = logSpy.mock.calls;
    if (!calls.length) return '';
    const call = calls[calls.length - 1];
    return call[1] || '';
  };

  test('redacts the pre-existing keys (apiKey, password, token, secret, authorization)', () => {
    logger.info('test', {
      apiKey: 'secret-key',
      api_key: 'snake-key',
      password: 'p4ssw0rd',
      token: 'tok-123',
      secret: 'shh',
      authorization: 'Bearer abc',
    });
    const data = lastLoggedData();
    for (const value of ['secret-key', 'snake-key', 'p4ssw0rd', 'tok-123', 'shh', 'Bearer abc']) {
      expect(data).not.toContain(value);
    }
  });

  // KJ-26-08
  test('redacts email-flavoured fields by substring match', () => {
    logger.info('test', {
      email: 'alice@example.com',
      userEmail: 'bob@example.com',
      contact_email: 'carol@example.com',
    });
    const data = lastLoggedData();
    expect(data).not.toContain('alice@example.com');
    expect(data).not.toContain('bob@example.com');
    expect(data).not.toContain('carol@example.com');
    expect(data).toContain('[REDACTED]');
  });

  test('redacts login-flavoured fields by substring match', () => {
    logger.info('test', {
      login: 'alice',
      loginName: 'bob',
      user_login: 'carol',
    });
    const data = lastLoggedData();
    expect(data).not.toContain('alice');
    expect(data).not.toContain('bob');
    expect(data).not.toContain('carol');
  });

  test('redacts nested sensitive fields recursively', () => {
    logger.info('test', {
      outer: {
        inner: {
          email: 'leak@example.com',
          safe: 'visible',
        },
      },
    });
    const data = lastLoggedData();
    expect(data).not.toContain('leak@example.com');
    expect(data).toContain('visible');
  });

  test('redacts sensitive fields inside arrays', () => {
    logger.info('test', {
      users: [
        { email: 'a@example.com', name: 'Alice' },
        { email: 'b@example.com', name: 'Bob' },
      ],
    });
    const data = lastLoggedData();
    expect(data).not.toContain('a@example.com');
    expect(data).not.toContain('b@example.com');
    expect(data).toContain('Alice');
    expect(data).toContain('Bob');
  });

  test('leaves non-sensitive fields untouched', () => {
    logger.info('test', {
      issueKey: 'SEC-123',
      commandType: 'record-add',
      count: 42,
    });
    const data = lastLoggedData();
    expect(data).toContain('SEC-123');
    expect(data).toContain('record-add');
    expect(data).toContain('42');
  });
});
