/**
 * Pure rate-limit window math (KJ-26-09).
 *
 * CommonJS so it is unit-testable without Forge stubs. The IO surface
 * (Forge storage reads/writes) stays in `keeperApi.js`; this file only knows
 * how to compute window epochs, build storage keys, and report how many
 * milliseconds remain in a given window.
 *
 * Key shape:  `rl:<bucket>:<userId>:<min|hr>:<epoch>`
 *
 * Encoding the window epoch directly into the key:
 *   - eliminates the need to scan or filter timestamp arrays
 *   - lets old window keys age out automatically without explicit cleanup
 *   - bounds the TOCTOU race window to the FIRST request of each new epoch
 *     (vs. an unbounded race in the previous timestamp-array implementation)
 */

/**
 * Compute the integer window epoch for the given timestamp and window length.
 * @param {number} now - Current millisecond timestamp
 * @param {number} windowMs - Window length in milliseconds
 * @returns {number}
 */
function computeWindowEpoch(now, windowMs) {
  return Math.floor(now / windowMs);
}

/**
 * Build the deterministic storage key for a (bucket, user, window-kind, epoch)
 * tuple.
 * @param {string} bucket
 * @param {string} userId
 * @param {'min'|'hr'} kind
 * @param {number} epoch
 * @returns {string}
 */
function buildRateLimitKey(bucket, userId, kind, epoch) {
  return `rl:${bucket}:${userId}:${kind}:${epoch}`;
}

/**
 * Compute the milliseconds remaining in the current window. Used to populate
 * `retryAfter` when a request is denied.
 * @param {number} epoch
 * @param {number} windowMs
 * @param {number} now
 * @returns {number}
 */
function windowEndsInMs(epoch, windowMs, now) {
  return Math.max(0, (epoch + 1) * windowMs - now);
}

/**
 * Coerce a Forge storage value into a non-negative integer counter. The
 * pre-KJ-26-09 implementation stored an object (`{ requests: [...] }`); this
 * helper makes the rollover idempotent — old shapes resolve to 0 and are
 * overwritten on the next increment.
 * @param {*} value
 * @returns {number}
 */
function coerceCounter(value) {
  if (typeof value === 'number' && Number.isFinite(value) && value >= 0) {
    return value;
  }
  return 0;
}

module.exports = {
  computeWindowEpoch,
  buildRateLimitKey,
  windowEndsInMs,
  coerceCounter,
};
