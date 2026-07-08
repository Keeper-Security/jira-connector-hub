/**
 * Pure auth/authorization helpers.
 *
 * CommonJS so tests can `require()` this directly. All functions in this file
 * are pure — no IO, no Jira API calls. The IO wrappers live in `adminGate.js`
 * and consume the pure helpers here.
 *
 * Public surface (exported):
 *   - JIRA_ADMIN_GROUPS
 *   - API_KEY_KEEP_EXISTING_SENTINEL
 *   - isAdminGroup
 *   - extractProjectKey
 *   - maskApiKey
 *   - isMaskedApiKey
 *   - buildAdminVerdict
 */

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Canonical Jira groups that grant administrator privileges across all plan tiers.
 * Group membership is the primary admin signal because `ADMINISTER_PROJECTS`
 * is unreliable on Jira Free (returns `true` for every authenticated user).
 */
const JIRA_ADMIN_GROUPS = Object.freeze(new Set([
  'org-admins',
  'site-admins',
  'jira-administrators',
  'system-administrators',
  'administrators',
]));

/** Sentinel sent by the UI when saving config without re-typing the API key. */
const API_KEY_KEEP_EXISTING_SENTINEL = '__KEEP_EXISTING__';

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

/**
 * @param {string} name
 * @returns {boolean}
 */
function isAdminGroup(name) {
  return typeof name === 'string' && JIRA_ADMIN_GROUPS.has(name.trim());
}

/**
 * Pull the project key out of an issue key (`SEC-123` -> `SEC`).
 * Returns `''` for malformed inputs so callers can validate cleanly.
 * @param {string} issueKey
 * @returns {string}
 */
function extractProjectKey(issueKey) {
  if (!issueKey || typeof issueKey !== 'string') return '';
  const idx = issueKey.indexOf('-');
  return idx > 0 ? issueKey.slice(0, idx) : '';
}

/**
 * Mask an API key for safe display. Reveals only the last 4 characters,
 * preserving total length so the UI sees an indicative placeholder.
 * @param {string|undefined} secret
 * @returns {string|undefined}
 */
function maskApiKey(secret) {
  if (!secret || typeof secret !== 'string') return secret;
  const trimmed = secret.trim();
  if (!trimmed) return trimmed;
  if (trimmed.length <= 4) return '*'.repeat(trimmed.length);
  return `${'*'.repeat(trimmed.length - 4)}${trimmed.slice(-4)}`;
}

/**
 * True if `value` is the keep-existing sentinel, i.e. the frontend sent the
 * explicit marker indicating the user did not change the API key.
 * @param {string} value
 * @returns {boolean}
 */
function isMaskedApiKey(value) {
  return value === API_KEY_KEEP_EXISTING_SENTINEL;
}

/**
 * Combine raw user / permission signals into the admin verdict that
 * `verifyProjectAdmin` returns. Pure so we can unit-test every code path
 * without touching the Jira API.
 *
 * @param {object} args
 * @param {object|null} args.userData       - Result of /rest/api/3/myself (or null on failure)
 * @param {string[]}    args.userGroups     - Array of group names from /myself
 * @param {boolean}     args.hasPermAdmin   - Did ADMINISTER_PROJECTS return true?
 * @param {string}      args.projectKey
 * @param {string|null} [args.error]        - Optional reason for fallback path
 * @returns {{ isAdmin: boolean, adminCheckMethod: string, userKey: string|null, displayName: string, projectKey: string, error?: string }}
 */
function buildAdminVerdict({ userData, userGroups, hasPermAdmin, projectKey, error = null }) {
  const isGroupAdmin = Array.isArray(userGroups) && userGroups.some((g) => isAdminGroup(g));
  const isAdmin = isGroupAdmin || hasPermAdmin === true;
  let adminCheckMethod = 'none';
  if (isGroupAdmin) adminCheckMethod = 'group_membership';
  else if (hasPermAdmin === true) adminCheckMethod = 'project_permissions';

  const verdict = {
    isAdmin,
    adminCheckMethod,
    userKey: userData?.accountId || userData?.key || null,
    displayName:
      userData?.displayName || userData?.name || userData?.emailAddress || 'User',
    projectKey: projectKey || '',
  };
  if (error && !isAdmin) verdict.error = error;
  return verdict;
}

module.exports = {
  JIRA_ADMIN_GROUPS,
  API_KEY_KEEP_EXISTING_SENTINEL,
  isAdminGroup,
  extractProjectKey,
  maskApiKey,
  isMaskedApiKey,
  buildAdminVerdict,
};
