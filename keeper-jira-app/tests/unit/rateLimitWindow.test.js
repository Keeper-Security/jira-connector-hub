/**
 * Unit tests for the pure rate-limit window math (KJ-26-09).
 *
 * The IO surface (`checkCommandRateLimit`, `getRateLimitStatus`) lives in
 * `keeperApi.js` and is exercised end-to-end; these tests pin down the math
 * that determines bucket keys, epoch rollover, and `retryAfter` calculation.
 */

const {
  computeWindowEpoch,
  buildRateLimitKey,
  windowEndsInMs,
  coerceCounter,
} = require('../../src/modules/utils/rateLimitWindow');

const MIN_MS = 60 * 1000;
const HR_MS = 60 * 60 * 1000;

describe('computeWindowEpoch', () => {
  test('returns floor(now / windowMs)', () => {
    expect(computeWindowEpoch(0, MIN_MS)).toBe(0);
    expect(computeWindowEpoch(MIN_MS - 1, MIN_MS)).toBe(0);
    expect(computeWindowEpoch(MIN_MS, MIN_MS)).toBe(1);
    expect(computeWindowEpoch(2 * MIN_MS + 30000, MIN_MS)).toBe(2);
  });

  test('uses the same epoch for two timestamps within one window', () => {
    // Anchor exactly at a minute boundary so we know both samples are in
    // the same window (`base + 5s` and `base + 30s` both belong to epoch N).
    const base = MIN_MS * 28_333_334;
    expect(computeWindowEpoch(base + 5_000, MIN_MS)).toBe(
      computeWindowEpoch(base + 30_000, MIN_MS),
    );
  });

  test('emits different epochs across a window boundary', () => {
    const base = 1_700_000_000_000;
    const before = computeWindowEpoch(base, MIN_MS);
    const after = computeWindowEpoch(base + MIN_MS, MIN_MS);
    expect(after).toBe(before + 1);
  });
});

describe('buildRateLimitKey', () => {
  test('encodes bucket, user, kind and epoch into the key', () => {
    expect(buildRateLimitKey('write', 'alice', 'min', 123)).toBe('rl:write:alice:min:123');
    expect(buildRateLimitKey('read', 'global', 'hr', 42)).toBe('rl:read:global:hr:42');
  });

  test('two requests in the same window produce identical keys', () => {
    // Anchor at an exact minute boundary so both samples share an epoch.
    const base = MIN_MS * 28_333_334;
    const epoch = computeWindowEpoch(base + 500, MIN_MS);
    const sameEpoch = computeWindowEpoch(base + 10_500, MIN_MS);
    expect(epoch).toBe(sameEpoch);
    expect(buildRateLimitKey('write', 'u1', 'min', epoch)).toBe(
      buildRateLimitKey('write', 'u1', 'min', sameEpoch),
    );
  });

  test('keys change at the window boundary', () => {
    const base = 1_700_000_000_000;
    const e1 = computeWindowEpoch(base, MIN_MS);
    const e2 = computeWindowEpoch(base + MIN_MS, MIN_MS);
    expect(buildRateLimitKey('write', 'u1', 'min', e1)).not.toBe(
      buildRateLimitKey('write', 'u1', 'min', e2),
    );
  });
});

describe('windowEndsInMs', () => {
  test('reports the time remaining in the current window', () => {
    // At t = 30s into a 60s window, 30s remain.
    const now = 30_000;
    const epoch = computeWindowEpoch(now, MIN_MS);
    expect(windowEndsInMs(epoch, MIN_MS, now)).toBe(30_000);
  });

  test('never returns a negative value', () => {
    // Pass an epoch from the past.
    expect(windowEndsInMs(0, MIN_MS, 5 * MIN_MS)).toBe(0);
  });

  test('returns the full window when `now` is at the start', () => {
    const now = 2 * MIN_MS;
    const epoch = computeWindowEpoch(now, MIN_MS);
    expect(windowEndsInMs(epoch, MIN_MS, now)).toBe(MIN_MS);
  });

  test('produces a sensible retry hint for the hour window', () => {
    const now = 1_700_000_000_000;
    const epoch = computeWindowEpoch(now, HR_MS);
    const remaining = windowEndsInMs(epoch, HR_MS, now);
    expect(remaining).toBeGreaterThanOrEqual(0);
    expect(remaining).toBeLessThanOrEqual(HR_MS);
  });
});

describe('coerceCounter', () => {
  test('passes finite non-negative numbers through unchanged', () => {
    expect(coerceCounter(0)).toBe(0);
    expect(coerceCounter(1)).toBe(1);
    expect(coerceCounter(9999)).toBe(9999);
  });

  test('rejects negative or non-finite numbers (returns 0)', () => {
    expect(coerceCounter(-1)).toBe(0);
    expect(coerceCounter(NaN)).toBe(0);
    expect(coerceCounter(Infinity)).toBe(0);
  });

  test('coerces non-number storage shapes (legacy) to 0', () => {
    expect(coerceCounter(undefined)).toBe(0);
    expect(coerceCounter(null)).toBe(0);
    expect(coerceCounter('5')).toBe(0);
    expect(coerceCounter({ requests: [1, 2, 3] })).toBe(0);
    expect(coerceCounter([])).toBe(0);
  });
});

describe('TOCTOU race window properties', () => {
  // The KJ-26-09 fix replaces an unbounded race window (timestamp array
  // mutation) with one bounded to the first request of each new epoch.
  // We can't reproduce a true race in Jest, but we can pin down the
  // structural property: two requests in the same window write the SAME
  // key, so subsequent reads observe the increment from the first.
  test('two requests in the same window share a key', () => {
    const base = MIN_MS * 28_333_334; // exact minute boundary
    const t1 = base + 500;
    const t2 = base + 5_500;
    const k1 = buildRateLimitKey('write', 'u', 'min', computeWindowEpoch(t1, MIN_MS));
    const k2 = buildRateLimitKey('write', 'u', 'min', computeWindowEpoch(t2, MIN_MS));
    expect(k1).toBe(k2);
  });

  test('crossing the window boundary yields a brand-new counter key', () => {
    const t1 = 2 * MIN_MS - 1;
    const t2 = 2 * MIN_MS + 1;
    const k1 = buildRateLimitKey('write', 'u', 'min', computeWindowEpoch(t1, MIN_MS));
    const k2 = buildRateLimitKey('write', 'u', 'min', computeWindowEpoch(t2, MIN_MS));
    expect(k1).not.toBe(k2);
  });
});
