/**
 * Rate-limit bucket classification for Keeper Commander commands.
 *
 * Extracted into a standalone CJS module so it can be unit-tested without
 * pulling in the Forge ESM runtime that keeperApi.js depends on.
 */

const READ_ONLY_COMMAND_VERBS = new Set([
  'list', 'ls', 'get', 'search', 'tree', 'cd',
  'nsf-list', 'nsf-get',
  'record-type-info', 'rti',
  'service-status',
  'enterprise-info', 'ei', 'enterprise-role', 'enterprise-user',
]);

/**
 * Classify a Keeper Commander command string into a rate-limit bucket.
 * @param {string} command - Full command, e.g. "nsf-list --records --format=json"
 * @returns {'read'|'write'}
 */
function getRateLimitBucketForCommand(command) {
  if (typeof command !== 'string' || !command.trim()) return 'write';
  const verb = command.trim().split(/\s+/)[0].toLowerCase();
  return READ_ONLY_COMMAND_VERBS.has(verb) ? 'read' : 'write';
}

module.exports = {
  READ_ONLY_COMMAND_VERBS,
  getRateLimitBucketForCommand
};
