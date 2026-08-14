/**
 * Unit Tests - Forge poll-deadline enforcement (KJ-26-11)
 *
 * Mirrors keeperApi.js's withPollDeadline / pollDeadlineExceededError logic
 * for testability without ESM (keeperApi.js uses `import`/`export` and is
 * excluded from Jest's transform -- see TESTING.md and the collectCoverageFrom
 * exclusion in package.json).
 *
 * Regression test for the reviewer's repro: pollDeadline was only checked
 * inside the polling loop, before each checkRequestStatus call. Once status
 * became "completed", getRequestResult ran with no deadline check at all, so
 * a slow result call could push the resolver past the documented Forge-safe
 * cap and into Forge's own 25s hard-kill instead of throwing the documented,
 * catchable timeout error.
 */

const FORGE_MAX_TOTAL_WAIT_MS = 22000;

function pollDeadlineExceededError(requestId) {
  return new Error(
    `Keeper command did not complete within ${FORGE_MAX_TOTAL_WAIT_MS}ms (Forge resolver limit). ` +
    `Request ${requestId} may still be running on the service. ` +
    `Common causes: ngrok/tunnel latency, service queue backlog, or slow nsf-* commands.`
  );
}

async function withPollDeadline(promise, pollDeadline, requestId) {
  if (!pollDeadline) return promise;

  let timer;
  const deadlineTimeout = new Promise((_, reject) => {
    const remainingMs = Math.max(pollDeadline - Date.now(), 0);
    timer = setTimeout(() => reject(pollDeadlineExceededError(requestId)), remainingMs);
  });

  try {
    return await Promise.race([promise, deadlineTimeout]);
  } finally {
    clearTimeout(timer);
  }
}

function delay(ms, value) {
  return new Promise((resolve) => setTimeout(() => resolve(value), ms));
}

describe('withPollDeadline (KJ-26-11 poll-deadline enforcement)', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  test('throws the deadline error when the result call resolves after the cap', async () => {
    const pollDeadline = Date.now() + FORGE_MAX_TOTAL_WAIT_MS;
    // Mirrors the reviewer's repro: result call delayed 1s past the 22s cap.
    const slowResultCall = delay(FORGE_MAX_TOTAL_WAIT_MS + 1000, { success: true });

    const assertion = expect(
      withPollDeadline(slowResultCall, pollDeadline, 'req-123')
    ).rejects.toThrow(/did not complete within 22000ms \(Forge resolver limit\)/);

    await jest.advanceTimersByTimeAsync(FORGE_MAX_TOTAL_WAIT_MS + 1000);
    await assertion;
  });

  test('returns the result when the call resolves before the deadline', async () => {
    const pollDeadline = Date.now() + FORGE_MAX_TOTAL_WAIT_MS;
    const fastResultCall = delay(1000, { success: true });

    const assertion = expect(
      withPollDeadline(fastResultCall, pollDeadline, 'req-456')
    ).resolves.toEqual({ success: true });

    await jest.advanceTimersByTimeAsync(1000);
    await assertion;
  });

  test('is a no-op when pollDeadline is null (non-forgeSafe calls)', async () => {
    const result = await withPollDeadline(Promise.resolve('ok'), null, 'req-789');
    expect(result).toBe('ok');
  });

  test('throws immediately when the deadline has already elapsed', async () => {
    const pastDeadline = Date.now() - 1000;
    const hungCall = new Promise(() => {}); // never resolves, simulates a stuck call

    const assertion = expect(
      withPollDeadline(hungCall, pastDeadline, 'req-999')
    ).rejects.toThrow(/did not complete within 22000ms \(Forge resolver limit\)/);

    await jest.advanceTimersByTimeAsync(0);
    await assertion;
  });
});
