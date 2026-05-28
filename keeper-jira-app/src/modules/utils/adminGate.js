/**
 * Admin-gate IO wrappers.
 *
 * ES Module — matches `jiraApiRetry.js`. All Jira API calls live here so the
 * pure helpers in `auth.js` stay testable without a Forge sandbox.
 *
 * Used by:
 *   - `getUserRole` resolver  -> `verifyProjectAdmin`
 *   - `executeKeeperAction`   -> `requireProjectAdmin`
 *
 * Fail-closed semantics: if every Jira lookup throws, callers treat the
 * user as non-admin (see `requireProjectAdmin`).
 */

import { requestJiraAsUserWithRetry, route } from './jiraApiRetry.js';
import { logger } from './logger.js';
import { ERROR_CODES, errorResponse } from './errorResponse.js';
import { extractProjectKey, buildAdminVerdict, isAdminGroup } from './auth.js';

/**
 * Fetch the current Jira user along with their group memberships.
 * Throws on failure so callers can fail closed.
 * @returns {Promise<{ userData: object, userGroups: string[] }>}
 */
export async function getCurrentUserWithGroups() {
  const resp = await requestJiraAsUserWithRetry(
    route`/rest/api/3/myself?expand=groups`,
    { method: 'GET', headers: { Accept: 'application/json' } },
    'Get current user with groups',
  );
  if (!resp || !resp.ok) {
    throw new Error(`/myself returned status ${resp?.status ?? 'unknown'}`);
  }
  const userData = await resp.json();
  const userGroups = Array.isArray(userData?.groups?.items)
    ? userData.groups.items.map((g) => g?.name).filter(Boolean)
    : [];
  return { userData, userGroups };
}

/**
 * Check `ADMINISTER_PROJECTS` for a given project key. Returns `false` on any
 * failure so callers can layer this on top of group checks without throwing.
 * @param {string} projectKey
 * @returns {Promise<boolean>}
 */
async function hasAdministerProjects(projectKey) {
  try {
    const resp = await requestJiraAsUserWithRetry(
      route`/rest/api/3/mypermissions?projectKey=${projectKey}&permissions=ADMINISTER_PROJECTS`,
      { method: 'GET', headers: { Accept: 'application/json' } },
      'Check ADMINISTER_PROJECTS permission',
    );
    if (!resp || !resp.ok) return false;
    const data = await resp.json();
    return data?.permissions?.ADMINISTER_PROJECTS?.havePermission === true;
  } catch (err) {
    logger.warn('hasAdministerProjects failed', { error: err.message, projectKey });
    return false;
  }
}

/**
 * Determine whether the current user is an admin for the project derived from
 * `issueKey`. Returns a structured verdict containing the detection method so
 * `getUserRole` can surface it to the UI for diagnostics.
 *
 * Strategy: group membership first (reliable across Jira plans), then
 * fall back to `ADMINISTER_PROJECTS`. The permission lookup is skipped when
 * the group check already grants admin, keeping the common case to one round
 * trip.
 *
 * @param {string} issueKey
 * @returns {Promise<{ isAdmin: boolean, adminCheckMethod: string, userKey: string|null, displayName: string, projectKey: string, error?: string }>}
 */
export async function verifyProjectAdmin(issueKey) {
  const projectKey = extractProjectKey(issueKey);
  if (!projectKey) {
    return buildAdminVerdict({
      userData: null,
      userGroups: [],
      hasPermAdmin: false,
      projectKey: '',
      error: 'Unable to extract project key from issue key',
    });
  }

  let userData = null;
  let userGroups = [];
  let groupError = null;
  try {
    const result = await getCurrentUserWithGroups();
    userData = result.userData;
    userGroups = result.userGroups;
  } catch (err) {
    groupError = err.message;
    logger.warn('verifyProjectAdmin: group lookup failed', { error: err.message, projectKey });
  }

  const isGroupAdmin = userGroups.some((g) => isAdminGroup(g));
  const hasPermAdmin = isGroupAdmin ? false : await hasAdministerProjects(projectKey);

  return buildAdminVerdict({
    userData,
    userGroups,
    hasPermAdmin,
    projectKey,
    error: groupError,
  });
}

/**
 * Convenience gate for resolvers: returns `null` when the user is an admin and
 * a ready-to-return `errorResponse` otherwise.
 *
 *   const adminErr = await requireProjectAdmin(issueKey);
 *   if (adminErr) return adminErr;
 *
 * @param {string} issueKey
 * @returns {Promise<object|null>}
 */
export async function requireProjectAdmin(issueKey) {
  const verdict = await verifyProjectAdmin(issueKey);
  if (verdict.isAdmin) return null;
  logger.warn('requireProjectAdmin: denied', {
    issueKey,
    adminCheckMethod: verdict.adminCheckMethod,
  });
  return errorResponse(
    ERROR_CODES.AUTH_NOT_PROJECT_ADMIN,
    'Only Jira project administrators are allowed to perform this action.',
    {
      requiredPermission: 'ADMINISTER_PROJECTS',
      adminCheckMethod: verdict.adminCheckMethod,
    },
  );
}
