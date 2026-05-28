/**
 * Server-side password complexity policy (KJ-26-04).
 *
 * Pure module. Mirrors the Keeper enterprise default minimums so client-side
 * checks (which can be bypassed via a web proxy) cannot weaken the effective
 * policy. Wire in from `validateCommandParameters` in `src/index.js`; never
 * inline these checks anywhere else.
 *
 * The frontend currently uses a stricter UX policy (20+ chars). The server is
 * a safety net, not the source of truth for the UX message.
 */

const PASSWORD_POLICY = Object.freeze({
  minLength: 8,
  requireUppercase: true,
  requireLowercase: true,
  requireDigit: true,
  requireSpecial: true,
});

/**
 * Sentinels the command builder treats as "generate a password server-side".
 * These should always bypass the complexity check.
 */
const PASSWORD_GENERATION_SENTINELS = Object.freeze(new Set(['$GEN', 'generate']));

/**
 * Should `validatePasswordComplexity` skip this value?
 * Centralised so callers don't repeat the `$GEN`/`generate` check.
 * @param {*} value
 * @returns {boolean}
 */
function isPasswordGenerationSentinel(value) {
  return typeof value === 'string' && PASSWORD_GENERATION_SENTINELS.has(value);
}

/**
 * Validate a plaintext password against `PASSWORD_POLICY`.
 *
 * Returns `{ valid: true }` for `$GEN`/`generate` (Commander handles those)
 * and for empty/undefined input (callers decide whether absence is allowed).
 *
 * @param {string|undefined} password
 * @param {object} [policy] - Override individual rules (used by tests).
 * @returns {{ valid: boolean, errors: string[] }}
 */
function validatePasswordComplexity(password, policy = PASSWORD_POLICY) {
  if (password === undefined || password === null || password === '') {
    return { valid: true, errors: [] };
  }
  if (isPasswordGenerationSentinel(password)) {
    return { valid: true, errors: [] };
  }
  if (typeof password !== 'string') {
    return { valid: false, errors: ['Password must be a string'] };
  }

  const errors = [];
  if (password.length < policy.minLength) {
    errors.push(`at least ${policy.minLength} characters`);
  }
  if (policy.requireUppercase && !/[A-Z]/.test(password)) {
    errors.push('at least one uppercase letter');
  }
  if (policy.requireLowercase && !/[a-z]/.test(password)) {
    errors.push('at least one lowercase letter');
  }
  if (policy.requireDigit && !/[0-9]/.test(password)) {
    errors.push('at least one digit');
  }
  if (policy.requireSpecial && !/[^A-Za-z0-9]/.test(password)) {
    errors.push('at least one special character');
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Convenience formatter producing the user-facing message embedded into
 * `validateCommandParameters` error arrays. Keeps the message in one place.
 * @param {string[]} errors
 * @returns {string}
 */
function formatPasswordPolicyError(errors) {
  return `Password does not meet complexity requirements: requires ${errors.join(', ')}`;
}

module.exports = {
  PASSWORD_POLICY,
  PASSWORD_GENERATION_SENTINELS,
  isPasswordGenerationSentinel,
  validatePasswordComplexity,
  formatPasswordPolicyError,
};
