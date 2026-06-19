/**
 * Nested Shared Subfolders (NSF) share command argument builders.
 *
 * Pure helpers for assembling `nsf-share-folder`, `nsf-share-record`, and
 * `nsf-record-permission` argument suffixes. The builders return only the
 * argument portion (no command name) so `buildKeeperCommand` can prepend
 * the resolved command name.
 *
 * Design rules:
 * - Pure functions, no I/O, no state -> trivially unit-testable.
 * - Same shell-escaping helpers as Classic branches in `src/index.js`.
 * - Classic command builders are NOT touched here; this module is additive
 *   so existing Legacy/Classic emitted strings remain byte-identical.
 *
 * CommonJS module.exports (matches `nsfParser.js`).
 */

/**
 * Single source of truth for UI-action -> NSF Commander command name.
 * Consumed by the command-name mapping in `buildKeeperCommand` and the
 * server-side allowlist in `getKeeperCommand` to avoid drift.
 */
const NSF_COMMAND_NAME_MAP = Object.freeze({
  'record-add': 'nsf-record-add',
  'record-update': 'nsf-record-update',
  'share-folder': 'nsf-share-folder',
  'share-record': 'nsf-share-record',
  'record-permission': 'nsf-record-permission'
});

/** Allowed NSF roles. Frontend peer: NSF_ROLES in static/keeper-issue-ui/src/constants/index.js */
const NSF_ROLES = Object.freeze([
  'viewer',
  'share-manager',
  'content-manager',
  'content-share-manager',
  'full-manager'
]);

const { escapeForSingleQuotes, escapeForDoubleQuotes } = require('./commandBuilder');

// --------------------------------------------------------------------------
// Argument appenders
// --------------------------------------------------------------------------

/**
 * Append repeatable `-e 'email'` flags from a comma-separated email field.
 * Mirrors the Classic pattern from `src/index.js` (share-record, share-folder).
 *
 * @param {string} command - Command-so-far (or empty for suffix-only builds).
 * @param {string|undefined} userField - `parameters.user` value.
 * @returns {string}
 */
function appendEmails(command, userField) {
  if (!userField) return command;
  const emails = String(userField)
    .split(',')
    .map((email) => email.trim())
    .filter((email) => email);
  for (const email of emails) {
    command += ` -e '${escapeForSingleQuotes(email)}'`;
  }
  return command;
}

/**
 * Append `-a <action>` when action is set. Action values are validated
 * upstream (`validateCommandParameters`), so no further escaping is needed.
 *
 * @param {string} command
 * @param {string|undefined} action
 * @returns {string}
 */
function appendAction(command, action) {
  if (!action) return command;
  return `${command} -a '${escapeForSingleQuotes(action)}'`;
}

/**
 * Append `-r <role>` only when the action requires it and the role is set.
 * NSF share commands accept role on `grant` (and tolerate it elsewhere where
 * documented, e.g. record-permission revoke as a filter).
 *
 * @param {string} command
 * @param {object} parameters
 * @param {string|undefined} action
 * @returns {string}
 */
function appendRole(command, parameters, action) {
  const role = parameters && parameters.role ? String(parameters.role).trim() : '';
  if (!role) return command;
  // Allow grant always; allow revoke as filter (nsf-record-permission revoke -r).
  // Skip for `remove` (nsf-share-folder) and `owner` (nsf-share-record) where
  // role is not meaningful per Commander docs.
  if (action === 'remove' || action === 'owner') return command;
  return `${command} -r '${escapeForSingleQuotes(role)}'`;
}

/**
 * Append `-R` recursive flag when truthy.
 *
 * @param {string} command
 * @param {object} parameters
 * @returns {string}
 */
function appendRecursive(command, parameters) {
  if (parameters && (parameters.recursive === true || parameters.recursive === 'true')) {
    return `${command} -R`;
  }
  return command;
}

/**
 * Convert a `datetime-local` value (no timezone) to an ISO UTC string
 * accepted by NSF Commander (`2026-05-18T21:30:00Z`). Inputs that already
 * carry a `Z` or explicit offset are passed through unchanged.
 *
 * @param {string} value
 * @returns {string}
 */
function toNsfExpireAt(value) {
  if (!value) return '';
  const raw = String(value).trim();
  if (!raw) return '';
  if (/[zZ]$/.test(raw) || /[+-]\d{2}:?\d{2}$/.test(raw)) return raw;
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return raw;
  return date.toISOString();
}

/**
 * Append `--expire-at` or `--expire-in` for NSF commands. Classic uses a
 * different `--expire-at` format (space-separated local time) and lives in
 * `src/index.js`; this helper is NSF-only on purpose to avoid touching
 * Classic emitted strings.
 *
 * @param {string} command
 * @param {object} parameters
 * @returns {string}
 */
function appendNsfExpiration(command, parameters) {
  if (!parameters) return command;
  if (parameters.expiration_type === 'expire-at' && parameters.expire_at) {
    const iso = toNsfExpireAt(parameters.expire_at);
    return `${command} --expire-at "${escapeForDoubleQuotes(iso)}"`;
  }
  if (parameters.expiration_type === 'expire-in' && parameters.expire_in) {
    const safe = sanitizeNsfDuration(parameters.expire_in);
    if (safe) {
      return `${command} --expire-in ${safe}`;
    }
  }
  return command;
}

/**
 * Validate and normalize a NSF expire-in duration. Accepts the units documented
 * by Commander (`d`, `h`, `m`, `s`, `mi`, `mo`, `y`) and the literal `never`.
 * Returns an empty string for anything else, so we never emit shell-unsafe or
 * malformed durations to Commander.
 *
 * @param {string} value
 * @returns {string}
 */
function sanitizeNsfDuration(value) {
  if (!value) return '';
  const raw = String(value).trim().toLowerCase();
  if (!raw) return '';
  if (raw === 'never') return 'never';
  const match = raw.match(/^(\d+)(mi|mo|d|h|m|s|y)$/);
  return match ? `${match[1]}${match[2]}` : '';
}

// --------------------------------------------------------------------------
// NSF command argument builders (return suffix only, no command name)
// --------------------------------------------------------------------------

/**
 * Build the argument suffix for `nsf-share-folder`.
 * Shape: `<folderUid> -e ... -a grant|remove [-r role] [--expire-*]`.
 *
 * @param {object} parameters
 * @returns {string}
 */
function buildNsfShareFolderArgs(parameters) {
  let args = '';
  if (parameters && parameters.folder) {
    args += ` '${escapeForSingleQuotes(parameters.folder)}'`;
  }
  args = appendEmails(args, parameters && parameters.user);
  args = appendAction(args, parameters && parameters.action);
  args = appendRole(args, parameters || {}, parameters && parameters.action);
  args = appendNsfExpiration(args, parameters || {});
  return args;
}

/**
 * Build the argument suffix for `nsf-share-record`.
 * Shape: `<recordOrFolderUid> -e ... -a grant|revoke|owner [-r role] [-R] [--expire-*]`.
 *
 * @param {object} parameters
 * @returns {string}
 */
function buildNsfShareRecordArgs(parameters) {
  let args = '';
  const positional = (parameters && (parameters.record || parameters.sharedFolder)) || '';
  if (positional) {
    args += ` '${escapeForSingleQuotes(positional)}'`;
  }
  args = appendEmails(args, parameters && parameters.user);
  args = appendAction(args, parameters && parameters.action);
  args = appendRole(args, parameters || {}, parameters && parameters.action);
  // -R only applies when sharing a folder (recursive descent).
  if (parameters && parameters.sharedFolder && !parameters.record) {
    args = appendRecursive(args, parameters);
  } else if (parameters && parameters.record && parameters.recursive) {
    args = appendRecursive(args, parameters);
  }
  args = appendNsfExpiration(args, parameters || {});
  return args;
}

/**
 * Build the argument suffix for `nsf-record-permission`.
 * Shape: `<folderUid> -a grant|revoke [-r role] [-R] -f`.
 *
 * Commander's examples always pass `-f` for grant/revoke; we follow suit so
 * the Jira flow does not block on a confirmation prompt that the API mode
 * cannot answer.
 *
 * @param {object} parameters
 * @returns {string}
 */
function buildNsfRecordPermissionArgs(parameters) {
  let args = '';
  const folderUid =
    (parameters && (parameters.folder || parameters.sharedFolder)) || '';
  if (folderUid) {
    args += ` '${escapeForSingleQuotes(folderUid)}'`;
  }
  const action = parameters && parameters.action;
  args = appendAction(args, action);
  args = appendRole(args, parameters || {}, action);
  args = appendRecursive(args, parameters || {});
  if (action === 'grant' || action === 'revoke') {
    args += ' -f';
  }
  return args;
}

module.exports = {
  NSF_COMMAND_NAME_MAP,
  NSF_ROLES,
  appendEmails,
  appendAction,
  appendRole,
  appendRecursive,
  appendNsfExpiration,
  sanitizeNsfDuration,
  toNsfExpireAt,
  buildNsfShareFolderArgs,
  buildNsfShareRecordArgs,
  buildNsfRecordPermissionArgs
};
