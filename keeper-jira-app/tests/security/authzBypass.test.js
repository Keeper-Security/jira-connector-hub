/**
 * Security Tests - KJ-26-03 Authorization-Bypass / Command-Injection hardening
 *
 * These tests lock in the two server-side guarantees introduced for the
 * resolver authorization-bypass report:
 *
 *   1. The `parameters.cliCommand` passthrough is gone. A caller can no longer
 *      hand the backend a pre-formatted Commander command and have it executed
 *      verbatim — every command is rebuilt from structured params.
 *
 *   2. The two "approval" verbs (EPM + device admin) are rebuilt server-side
 *      from a strict charset, so a crafted invoke cannot smuggle an arbitrary
 *      Commander command (e.g. `enterprise-info`, `get <uid>`) or shell
 *      metacharacters through the approval UID / device target.
 *
 * Note: the resolver-level admin gate (requireProjectAdmin / requireGlobalAdmin)
 * lives in `src/modules/utils/adminGate.js`, which is an ES module and is
 * exercised end-to-end in the Forge runtime. Its pure decision logic
 * (buildAdminVerdict, group/permission resolution) is covered by
 * `tests/unit/auth.test.js`. This file covers the command-construction
 * boundary, which is the actual code-execution sink.
 */

const {
  buildKeeperCommand,
  validateCommandParameters,
} = require('../../src/modules/utils/commandBuilder');

describe('KJ-26-03: cliCommand passthrough removal', () => {
  test('buildKeeperCommand no longer returns a caller-supplied cliCommand verbatim', () => {
    // Previously this returned `enterprise-info` as-is. Now `record-add`
    // is validated structurally and fails for lack of a title, proving the
    // passthrough is gone.
    expect(() => {
      buildKeeperCommand('record-add', { cliCommand: 'enterprise-info' }, 'TEST-1');
    }).toThrow('Input validation failed');
  });

  test('validateCommandParameters does not short-circuit on a cliCommand field', () => {
    const result = validateCommandParameters('share-record', {
      cliCommand: 'get someRecordUid --format=json',
    });
    // share-record still requires record + user; a stray cliCommand cannot
    // make validation pass.
    expect(result.valid).toBe(false);
  });
});

describe('KJ-26-03: EPM approval command is rebuilt from a strict charset', () => {
  test('valid approve/deny round-trip', () => {
    expect(
      buildKeeperCommand('epm approval action', { epmDecision: 'approve', approvalUid: 'AbC_123-xyz' }, 'T-1')
    ).toBe('epm approval action --approve AbC_123-xyz');
    expect(
      buildKeeperCommand('epm approval action', { epmDecision: 'deny', approvalUid: 'AbC_123-xyz' }, 'T-1')
    ).toBe('epm approval action --deny AbC_123-xyz');
  });

  const injectionUids = [
    'abc; enterprise-info',
    'abc && get xyz',
    'abc | cat',
    'abc`whoami`',
    'abc$(whoami)',
    'abc --approve other',
    'abc\nrm -rf /',
  ];
  test.each(injectionUids)('rejects malicious approval UID: %s', (uid) => {
    expect(() => {
      buildKeeperCommand('epm approval action', { epmDecision: 'approve', approvalUid: uid }, 'T-1');
    }).toThrow('invalid EPM approval request UID');
  });

  test('rejects a missing/unknown decision', () => {
    expect(() => {
      buildKeeperCommand('epm approval action', { approvalUid: 'abc123' }, 'T-1');
    }).toThrow('EPM approval decision');
  });
});
