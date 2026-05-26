/**
 * Keeper Commander API Module
 * Handles all interactions with Keeper Security Commander API
 * Uses API v2 (async queue mode) - introduced in Commander 17.1.7
 * 
 * API v2 Reference: https://docs.keeper.io/en/keeperpam/commander-cli/service-mode-rest-api/api-usage
 */

import { storage, fetch } from '@forge/api';
import { logger } from './utils/logger.js';

// ============================================================================
// Configuration Constants
// ============================================================================

const API_CONFIG = {
  // Polling configuration for async requests
  polling: {
    initialDelayMs: 500,      // Initial delay before first status check
    intervalMs: 1000,         // Delay between status checks
    maxAttempts: 60,          // Maximum polling attempts (60 * 1s = 60s timeout)
    backoffMultiplier: 1.5,   // Exponential backoff multiplier
    maxIntervalMs: 5000,      // Maximum interval between polls
    // Forge UI resolvers hard-kill at 25s. Cap polling below that so the user
    // sees a clear error instead of the opaque "Task timed out" message.
    forgeMaxAttempts: 18,
    forgeMaxTotalWaitMs: 22000,
  },
  
  // Fetch retry configuration for Keeper API calls
  fetchRetry: {
    maxRetries: 3,            // Maximum retry attempts
    initialDelayMs: 1000,     // Initial delay (1 second)
    maxDelayMs: 10000,        // Maximum delay (10 seconds)
    backoffMultiplier: 2,     // Exponential backoff multiplier
    jitterFactor: 0.2,        // Add up to 20% random jitter
    retryableStatusCodes: [429, 503, 502, 504], // Status codes that trigger retry
  },
  
  // Request states from API v2
  requestStates: {
    QUEUED: 'queued',
    PROCESSING: 'processing',
    COMPLETED: 'completed',
    FAILED: 'failed',
    EXPIRED: 'expired',
  },
  
  // Rate limiting configuration
  // Keeper Commander queue capacity is 100 requests
  // These limits allow ~10 concurrent users before queue stress
  //
  // Split into two independent per-user buckets:
  //   - `read`  : cheap idempotent list/get commands (vault browsers, dropdowns)
  //   - `write` : mutations (share-*, record-*, nsf-share-*, nsf-record-*, rm, etc.)
  // Bucket is auto-detected from the command verb inside executeKeeperCommand,
  // so resolvers and other call sites don't need to opt in to a bucket.
  rateLimit: {
    // Read-only / list bucket. Generous so UI dropdowns and Classic-toggle
    // refreshes never trip the limit.
    read: {
      perMinute: 30,
      perHour: 300,
    },
    // Mutation bucket. Kept conservative to protect Commander queue capacity.
    write: {
      perMinute: 5,                  // Max write commands per minute per user
      perHour: 50,                   // Max write commands per hour per user
    },
    minuteWindowMs: 60 * 1000,       // 1 minute window
    hourWindowMs: 60 * 60 * 1000,    // 1 hour window
  },
};

// ============================================================================
// Fetch Retry Helper Functions
// ============================================================================

/**
 * Add jitter to delay to prevent thundering herd problem
 * @param {number} delay - Base delay in milliseconds
 * @returns {number} - Delay with jitter added
 */
function addFetchJitter(delay) {
  const jitter = delay * API_CONFIG.fetchRetry.jitterFactor * Math.random();
  return Math.floor(delay + jitter);
}

/**
 * Sleep utility for async/await
 * @param {number} ms - Milliseconds to sleep
 * @returns {Promise<void>}
 */
function sleepMs(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Parse Retry-After header value
 * @param {Response} response - Fetch response object
 * @returns {number|null} - Delay in milliseconds or null
 */
function parseRetryAfterHeader(response) {
  const retryAfter = response.headers?.get?.('Retry-After') || 
                     response.headers?.get?.('retry-after');
  
  if (!retryAfter) return null;
  
  // Try parsing as seconds
  const seconds = parseInt(retryAfter, 10);
  if (!isNaN(seconds)) {
    return seconds * 1000;
  }
  
  // Try parsing as HTTP-date
  try {
    const date = new Date(retryAfter);
    if (!isNaN(date.getTime())) {
      const delayMs = date.getTime() - Date.now();
      return Math.max(delayMs, 0);
    }
  } catch (e) {
    // Ignore parsing errors
  }
  
  return null;
}

/**
 * Execute a fetch request with retry logic and exponential backoff
 * Handles transient errors (429, 503, 502, 504) from Keeper API
 * 
 * @param {string} url - URL to fetch
 * @param {Object} options - Fetch options
 * @param {string} operationName - Name of the operation for logging
 * @returns {Promise<Response>} - Fetch response
 */
async function fetchWithRetry(url, options = {}, operationName = 'Keeper API') {
  const { maxRetries, initialDelayMs, maxDelayMs, backoffMultiplier, retryableStatusCodes } = API_CONFIG.fetchRetry;
  let lastResponse;
  let delay = initialDelayMs;
  
  for (let attempt = 1; attempt <= maxRetries + 1; attempt++) {
    try {
      const response = await fetch(url, options);
      lastResponse = response;
      
      // Check if we should retry
      if (retryableStatusCodes.includes(response.status)) {
        if (attempt > maxRetries) {
          // Out of retries, return the response for caller to handle
          logger.warn('Keeper API failed after retries', {
            operation: operationName,
            status: response.status,
            maxRetries
          });
          return response;
        }
        
        // Get Retry-After header if present
        const retryAfterMs = parseRetryAfterHeader(response);
        const actualDelay = retryAfterMs !== null 
          ? Math.min(addFetchJitter(retryAfterMs), maxDelayMs * 2)
          : addFetchJitter(delay);
        
        logger.warn('Keeper API retryable error, retrying', {
          operation: operationName,
          status: response.status,
          attempt,
          maxAttempts: maxRetries + 1,
          retryDelayMs: actualDelay
        });
        
        await sleepMs(actualDelay);
        delay = Math.min(delay * backoffMultiplier, maxDelayMs);
        continue;
      }
      
      // Not a retryable status, return the response
      return response;
      
    } catch (error) {
      // Network errors
      if (attempt > maxRetries) {
        logger.error('Keeper API network error after retries', {
          operation: operationName,
          maxRetries,
          error: error.message
        });
        throw error;
      }
      
      const actualDelay = addFetchJitter(delay);
      logger.warn('Keeper API network error, retrying', {
        operation: operationName,
        attempt,
        maxAttempts: maxRetries + 1,
        retryDelayMs: actualDelay,
        error: error.message
      });
      
      await sleepMs(actualDelay);
      delay = Math.min(delay * backoffMultiplier, maxDelayMs);
    }
  }
  
  return lastResponse;
}

// ============================================================================
// Rate Limiting Functions
// ============================================================================

// Verbs considered read-only / idempotent. Anything else is treated as a
// write. Match is case-insensitive on the first whitespace-delimited token.
// Keep in sync with ALLOWED_COMMAND_PREFIXES in src/index.js.
const READ_ONLY_COMMAND_VERBS = new Set([
  'list', 'ls', 'get', 'search', 'tree', 'cd',
  'nsf-list', 'nsf-get',
  'record-type-info', 'rti',
  'service-status',
  'enterprise-info', 'ei', 'enterprise-role', 'enterprise-user',
]);

/**
 * Classify a Keeper Commander command string into a rate-limit bucket.
 * Used by executeKeeperCommand so resolvers don't need to know about buckets.
 * @param {string} command - Full command, e.g. "nsf-list --records --format=json"
 * @returns {'read'|'write'}
 */
function getRateLimitBucketForCommand(command) {
  if (typeof command !== 'string' || !command.trim()) return 'write';
  const verb = command.trim().split(/\s+/)[0].toLowerCase();
  return READ_ONLY_COMMAND_VERBS.has(verb) ? 'read' : 'write';
}

/**
 * Load per-bucket rate-limit window counts from Forge storage.
 * @param {'read'|'write'} bucket
 * @param {string} userId
 * @param {number} now
 */
async function loadBucketWindowCounts(bucket, userId, now) {
  const minuteWindowStart = now - API_CONFIG.rateLimit.minuteWindowMs;
  const hourWindowStart = now - API_CONFIG.rateLimit.hourWindowMs;
  const rateLimitKey = `keeper-cmd-ratelimit-${bucket}-${userId}`;
  let rateLimitData = await storage.get(rateLimitKey);

  if (!rateLimitData) {
    rateLimitData = { requests: [], lastCleanup: now };
  }

  const validRequests = (rateLimitData.requests || []).filter(timestamp => timestamp > hourWindowStart);
  const requestsInMinute = validRequests.filter(t => t > minuteWindowStart).length;
  const requestsInHour = validRequests.length;

  return {
    rateLimitKey,
    rateLimitData,
    validRequests,
    requestsInMinute,
    requestsInHour,
    minuteWindowStart,
    hourWindowStart,
  };
}

/**
 * Check and update rate limit for a user
 * Uses dual-window rate limiting: per-minute and per-hour
 * Each bucket ('read' / 'write') has its own storage entry so they
 * cannot starve each other.
 *
 * @param {string} userId - Unique user identifier (accountId)
 * @param {'read'|'write'} [bucket='write'] - Which rate-limit bucket to apply
 * @returns {Promise<Object>} - { allowed: boolean, error?: string, retryAfter?: number }
 */
export async function checkCommandRateLimit(userId, bucket = 'write') {
  if (!userId) {
    // If no user ID available, use a global limit (more restrictive)
    userId = 'global';
  }

  // Fall back to the conservative write bucket if an unknown bucket is passed.
  const limits = API_CONFIG.rateLimit[bucket] || API_CONFIG.rateLimit.write;

  const now = Date.now();
  const {
    rateLimitKey,
    rateLimitData,
    validRequests,
    requestsInMinute,
    requestsInHour,
    minuteWindowStart,
    hourWindowStart,
  } = await loadBucketWindowCounts(bucket, userId, now);

  rateLimitData.requests = validRequests;
  
  // Check minute limit (per-bucket)
  if (requestsInMinute >= limits.perMinute) {
    // Find when the oldest request in the minute window will expire
    const oldestInMinute = rateLimitData.requests
      .filter(t => t > minuteWindowStart)
      .sort((a, b) => a - b)[0];
    const retryAfter = Math.ceil((oldestInMinute + API_CONFIG.rateLimit.minuteWindowMs - now) / 1000);

    // Save the data (to preserve request history)
    await storage.set(rateLimitKey, rateLimitData);

    return {
      allowed: false,
      error: `Rate limit exceeded (${bucket}): Maximum ${limits.perMinute} commands per minute. Please wait ${retryAfter} seconds.`,
      retryAfter: retryAfter,
      limitType: 'minute',
      bucket,
      remaining: {
        minute: 0,
        hour: Math.max(0, limits.perHour - requestsInHour)
      }
    };
  }

  // Check hour limit (per-bucket)
  if (requestsInHour >= limits.perHour) {
    // Find when the oldest request in the hour window will expire
    const oldestInHour = rateLimitData.requests.sort((a, b) => a - b)[0];
    const retryAfter = Math.ceil((oldestInHour + API_CONFIG.rateLimit.hourWindowMs - now) / 1000);

    // Save the data
    await storage.set(rateLimitKey, rateLimitData);

    return {
      allowed: false,
      error: `Rate limit exceeded (${bucket}): Maximum ${limits.perHour} commands per hour. Please wait ${Math.ceil(retryAfter / 60)} minutes.`,
      retryAfter: retryAfter,
      limitType: 'hour',
      bucket,
      remaining: {
        minute: 0,
        hour: 0
      }
    };
  }
  
  // Add current request timestamp
  rateLimitData.requests.push(now);
  rateLimitData.lastCleanup = now;
  
  // Save updated rate limit data
  await storage.set(rateLimitKey, rateLimitData);
  
  return {
    allowed: true,
    bucket,
    remaining: {
      minute: limits.perMinute - requestsInMinute - 1,
      hour: limits.perHour - requestsInHour - 1
    }
  };
}

/**
 * Get current rate limit status for a user (without incrementing).
 * Returns per-bucket detail under `read` / `write` plus legacy top-level
 * fields that mirror the write bucket — keeps older UI status displays
 * working without changes.
 *
 * @param {string} userId - Unique user identifier
 * @returns {Promise<Object>} - { read, write, limits, usage, remaining }
 */
export async function getRateLimitStatus(userId) {
  if (!userId) userId = 'global';

  const now = Date.now();

  // Read each per-bucket storage entry and compute usage/remaining.
  const snapshot = async (bucket) => {
    const limits = API_CONFIG.rateLimit[bucket];
    const { requestsInMinute, requestsInHour } = await loadBucketWindowCounts(bucket, userId, now);
    return {
      limits: { perMinute: limits.perMinute, perHour: limits.perHour },
      usage: { minute: requestsInMinute, hour: requestsInHour },
      remaining: {
        minute: Math.max(0, limits.perMinute - requestsInMinute),
        hour: Math.max(0, limits.perHour - requestsInHour)
      }
    };
  };

  const read = await snapshot('read');
  const write = await snapshot('write');

  return {
    read,
    write,
    // Back-compat: legacy callers see the write bucket at the root.
    limits: write.limits,
    usage: write.usage,
    remaining: write.remaining
  };
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Sanitize sensitive data from error messages
 * Removes API keys, tokens, and other secrets that might be exposed in errors
 * @param {string} message - The error message to sanitize
 * @returns {string} - Sanitized message with secrets redacted
 */
function sanitizeSensitiveData(message) {
  if (!message || typeof message !== 'string') return message;
  
  let sanitized = message;
  
  // Pattern for API keys (long alphanumeric strings, typically 32+ chars)
  // Matches sequences that look like API keys/tokens
  sanitized = sanitized.replace(/\b[A-Za-z0-9_-]{32,}\b/g, '[REDACTED]');
  
  // Pattern for Bearer tokens in headers
  sanitized = sanitized.replace(/Bearer\s+[A-Za-z0-9_.-]+/gi, 'Bearer [REDACTED]');
  
  // Pattern for api-key header values
  sanitized = sanitized.replace(/api-key[:\s]+[A-Za-z0-9_.-]+/gi, 'api-key: [REDACTED]');
  
  // Pattern for authorization headers
  sanitized = sanitized.replace(/authorization[:\s]+[^\s]+/gi, 'Authorization: [REDACTED]');
  
  // Pattern for password fields in JSON
  sanitized = sanitized.replace(/"password"\s*:\s*"[^"]*"/gi, '"password": "[REDACTED]"');
  sanitized = sanitized.replace(/"apiKey"\s*:\s*"[^"]*"/gi, '"apiKey": "[REDACTED]"');
  sanitized = sanitized.replace(/"api_key"\s*:\s*"[^"]*"/gi, '"api_key": "[REDACTED]"');
  sanitized = sanitized.replace(/"token"\s*:\s*"[^"]*"/gi, '"token": "[REDACTED]"');
  sanitized = sanitized.replace(/"secret"\s*:\s*"[^"]*"/gi, '"secret": "[REDACTED]"');
  
  return sanitized;
}

/**
 * Helper function to parse and clean Keeper CLI error messages
 * Extracts the meaningful user-friendly error message from verbose CLI output
 * Also sanitizes any sensitive data (API keys, tokens) from error messages
 */
function parseKeeperErrorMessage(errorMessage) {
  if (!errorMessage || typeof errorMessage !== 'string') return errorMessage;
  
  let errorText = errorMessage;
  
  // Try to parse JSON response and extract error field
  try {
    const jsonError = JSON.parse(errorMessage);
    if (jsonError.error) {
      errorText = jsonError.error;
    } else if (jsonError.message) {
      errorText = jsonError.message;
    }
  } catch (e) {
    // Not JSON, use as-is
  }
  
  // Split by newlines and process each line
  const lines = errorText.split('\n').map(line => line.trim()).filter(line => line);
  
  // Skip system messages like "Bypassing master password enforcement..."
  const meaningfulLines = lines.filter(line => 
    !line.startsWith('Bypassing master password') &&
    !line.includes('running in service mode')
  );
  
  let result;
  
  // If we have meaningful lines, process them
  if (meaningfulLines.length > 0) {
    const lastLine = meaningfulLines[meaningfulLines.length - 1];
    
    // Look for pattern: "Failed to ... : <actual error message>"
    // Extract the part after the last colon if it contains a meaningful message
    const colonIndex = lastLine.lastIndexOf(': ');
    if (colonIndex !== -1) {
      const afterColon = lastLine.substring(colonIndex + 2).trim();
      // Check if the part after colon is a meaningful message (not just a short token)
      if (afterColon.length > 20 && !afterColon.includes('Failed to')) {
        result = afterColon;
      }
    }
    
    // If no colon pattern found, return the last meaningful line
    if (!result) {
      result = lastLine;
    }
  } else {
    result = errorText;
  }
  
  // Sanitize sensitive data before returning
  return sanitizeSensitiveData(result);
}

/**
 * Normalize the API URL
 * Expects complete API v2 URL like: https://my-tunnel.ngrok.io/api/v2 or https://keeper.your-domain.com/api/v2
 * Removes any trailing slashes for consistent endpoint construction
 * 
 * @param {string} apiUrl - The configured API URL (including /api/v2)
 * @returns {string} - Normalized API URL
 */
function normalizeApiUrl(apiUrl) {
  // Remove trailing slashes
  let url = apiUrl.replace(/\/+$/, '');
  return url;
}

/**
 * Get the API v2 endpoint
 * Constructs full endpoint URL from the provided API URL
 * 
 * User provides complete URL including /api/v2, e.g.:
 * - https://my-tunnel.ngrok.io/api/v2
 * - https://keeper.your-domain.com/api/v2
 * 
 * This function appends the specific endpoint:
 * - POST {apiUrl}/executecommand-async - Submit command to queue
 * - GET  {apiUrl}/status/{request_id}  - Check request status
 * - GET  {apiUrl}/result/{request_id}  - Get request result
 * - GET  {apiUrl}/queue/status         - Get queue status
 * 
 * @param {string} apiUrl - Complete API URL (e.g., https://keeper.your-domain.com/api/v2)
 * @param {string} endpoint - Endpoint path (e.g., executecommand-async)
 * @returns {string} - Full endpoint URL
 */
function getApiEndpoint(apiUrl, endpoint) {
  return `${apiUrl}/${endpoint}`;
}

/**
 * Sleep utility for async/await
 * @param {number} ms - Milliseconds to sleep
 * @returns {Promise<void>}
 */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Calculate next polling interval with exponential backoff
 * @param {number} currentInterval - Current interval in ms
 * @returns {number} - Next interval in ms
 */
function calculateNextInterval(currentInterval) {
  const nextInterval = Math.floor(currentInterval * API_CONFIG.polling.backoffMultiplier);
  return Math.min(nextInterval, API_CONFIG.polling.maxIntervalMs);
}

// ============================================================================
// API v2 - Asynchronous Queue Execution
// ============================================================================

/**
 * Submit an async command to the API v2 queue
 * @param {string} baseUrl - Base API URL
 * @param {string} apiKey - API key
 * @param {string} command - Command to execute
 * @param {Object} options - Additional options (e.g., filedata)
 * @returns {Promise<Object>} - Queue submission response with request_id
 */
async function submitAsyncCommand(baseUrl, apiKey, command, options = {}) {
  const endpoint = getApiEndpoint(baseUrl, 'executecommand-async');
  
  const body = { command };
  if (options.filedata) {
    body.filedata = options.filedata;
  }

  // Use fetchWithRetry for automatic retry on transient errors
  const response = await fetchWithRetry(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'api-key': apiKey,
    },
    body: JSON.stringify(body),
  }, 'Submit async command');

  // Handle error codes that persist after retries
  if (response.status === 503) {
    throw new Error('Keeper API queue is full. Please try again later.');
  }
  if (response.status === 429) {
    throw new Error('Keeper API rate limit exceeded. Please try again later.');
  }

  if (!response.ok) {
    const errorText = await response.text();
    const cleanedError = parseKeeperErrorMessage(errorText);
    throw new Error(`Keeper API submit error: ${response.status} - ${cleanedError}`);
  }

  const data = await response.json();

  if (!data.success || !data.request_id) {
    throw new Error(`Keeper API submit failed: ${data.message || 'No request_id returned'}`);
  }

  return {
    requestId: data.request_id,
    status: data.status,
    message: data.message,
  };
}

/**
 * Check the status of an async request
 * @param {string} baseUrl - Base API URL
 * @param {string} apiKey - API key
 * @param {string} requestId - Request ID from submit
 * @returns {Promise<Object>} - Status response
 */
async function checkRequestStatus(baseUrl, apiKey, requestId) {
  const endpoint = getApiEndpoint(baseUrl, `status/${requestId}`);

  // Use fetchWithRetry for automatic retry on transient errors
  const response = await fetchWithRetry(endpoint, {
    method: 'GET',
    headers: {
      'api-key': apiKey,
    },
  }, 'Check request status');

  if (response.status === 404) {
    throw new Error(`Request ${requestId} not found. It may have expired.`);
  }

  if (!response.ok) {
    const errorText = await response.text();
    const cleanedError = parseKeeperErrorMessage(errorText);
    throw new Error(`Keeper API status check error: ${response.status} - ${cleanedError}`);
  }

  const data = await response.json();

  return {
    requestId: data.request_id,
    command: data.command,
    status: data.status,
    createdAt: data.created_at,
    startedAt: data.started_at,
    completedAt: data.completed_at,
  };
}

/**
 * Get the result of a completed async request
 * @param {string} baseUrl - Base API URL
 * @param {string} apiKey - API key
 * @param {string} requestId - Request ID from submit
 * @returns {Promise<Object>} - Command result
 */
async function getRequestResult(baseUrl, apiKey, requestId) {
  const endpoint = getApiEndpoint(baseUrl, `result/${requestId}`);

  // Use fetchWithRetry for automatic retry on transient errors
  const response = await fetchWithRetry(endpoint, {
    method: 'GET',
    headers: {
      'api-key': apiKey,
    },
  }, 'Get request result');

  if (response.status === 404) {
    throw new Error(`Result for request ${requestId} not found. It may have expired.`);
  }

  if (!response.ok) {
    const errorText = await response.text();
    const cleanedError = parseKeeperErrorMessage(errorText);
    throw new Error(`Keeper API result error: ${response.status} - ${cleanedError}`);
  }

  const data = await response.json();

  return data;
}

/**
 * Execute command using API v2 (async queue mode) with polling
 * This is the main wrapper function that handles the full async flow:
 * 1. Submit command to queue
 * 2. Poll for status until completed/failed
 * 3. Retrieve and return result
 * 
 * @param {string} baseUrl - Base API URL
 * @param {string} apiKey - API key
 * @param {string} command - Command to execute
 * @param {Object} options - Additional options
 * @param {Object} options.filedata - File data for commands requiring file input
 * @param {number} options.maxAttempts - Override max polling attempts
 * @param {number} options.pollingIntervalMs - Override polling interval
 * @param {boolean} options.forgeSafe - When true, cap total wait to ~22s so
 *   Forge resolvers respond before the 25s hard-kill.
 * @returns {Promise<Object>} - Command result
 */
async function executeCommandAsync(baseUrl, apiKey, command, options = {}) {
  const forgeSafe = options.forgeSafe === true;
  const {
    filedata,
    maxAttempts = forgeSafe
      ? API_CONFIG.polling.forgeMaxAttempts
      : API_CONFIG.polling.maxAttempts,
    pollingIntervalMs = API_CONFIG.polling.intervalMs,
  } = options;

  const pollDeadline = forgeSafe
    ? Date.now() + API_CONFIG.polling.forgeMaxTotalWaitMs
    : null;

  // Step 1: Submit the command to the async queue
  const submitResponse = await submitAsyncCommand(baseUrl, apiKey, command, { filedata });
  const { requestId } = submitResponse;

  // Step 2: Wait for initial delay before first poll
  await sleep(API_CONFIG.polling.initialDelayMs);

  // Step 3: Poll for completion with exponential backoff
  let currentInterval = pollingIntervalMs;
  let attempts = 0;

  while (attempts < maxAttempts) {
    if (pollDeadline && Date.now() >= pollDeadline) {
      throw new Error(
        `Keeper command did not complete within ${API_CONFIG.polling.forgeMaxTotalWaitMs}ms (Forge resolver limit). ` +
        `Request ${requestId} may still be running on the service. ` +
        `Common causes: ngrok/tunnel latency, service queue backlog, or slow nsf-* commands.`
      );
    }

    attempts++;

    const statusResponse = await checkRequestStatus(baseUrl, apiKey, requestId);
    const { status } = statusResponse;

    // Check terminal states
    if (status === API_CONFIG.requestStates.COMPLETED) {
      // Step 4: Get and return the result
      const result = await getRequestResult(baseUrl, apiKey, requestId);
      return result;
    }

    if (status === API_CONFIG.requestStates.FAILED) {
      throw new Error(`Keeper command execution failed for request ${requestId}`);
    }

    if (status === API_CONFIG.requestStates.EXPIRED) {
      throw new Error(`Keeper command request ${requestId} expired before processing`);
    }

    // Still queued or processing - wait and retry (capped by deadline)
    const sleepMs = pollDeadline
      ? Math.min(currentInterval, Math.max(pollDeadline - Date.now(), 0))
      : currentInterval;
    await sleep(sleepMs);
    currentInterval = calculateNextInterval(currentInterval);
  }

  // Timeout - max attempts reached
  throw new Error(
    `Keeper command timed out after ${maxAttempts} polling attempts. ` +
    `Request ${requestId} may still be processing. ` +
    `Check status manually or increase timeout.`
  );
}

// ============================================================================
// Main API Interface
// ============================================================================

/**
 * Extract EPM approval data from various API response formats
 * Handles different structures returned by Commander API v2
 * @param {Object} rawData - Raw API response
 * @returns {Object|null} - Extracted approval details or null
 */
function extractEpmApprovalData(rawData) {
  if (!rawData) return null;

  // Structure 1: Direct data array - { status: 'success', data: [...] }
  if (rawData.status === 'success' && Array.isArray(rawData.data) && rawData.data.length > 0) {
    return rawData.data[0];
  }

  // Structure 2: Direct array response - [{ approval_uid: ... }]
  if (Array.isArray(rawData) && rawData.length > 0) {
    return rawData[0];
  }

  // Structure 3: Result wrapper - { result: { data: [...] } } or { result: [...] }
  if (rawData.result) {
    if (Array.isArray(rawData.result) && rawData.result.length > 0) {
      return rawData.result[0];
    }
    if (rawData.result.data && Array.isArray(rawData.result.data) && rawData.result.data.length > 0) {
      return rawData.result.data[0];
    }
    // If result is directly the approval object
    if (rawData.result.approval_uid || rawData.result.account_info) {
      return rawData.result;
    }
  }

  // Structure 4: Data wrapper - { data: { ... } } (single object, not array)
  if (rawData.data && !Array.isArray(rawData.data) && (rawData.data.approval_uid || rawData.data.account_info)) {
    return rawData.data;
  }

  // Structure 5: Direct approval object at root
  if (rawData.approval_uid || rawData.account_info) {
    return rawData;
  }

  // Structure 6: Output field contains JSON string (Commander CLI output format)
  if (rawData.output && typeof rawData.output === 'string') {
    try {
      const parsed = JSON.parse(rawData.output);
      return extractEpmApprovalData(parsed); // Recursively extract from parsed output
    } catch (e) {
      // Not JSON, ignore
    }
  }

  return null;
}

/**
 * Fetch EPM approval details from Keeper API with auto-sync fallback
 * @param {string} requestUid - The request UID to fetch details for
 * @returns {Promise<Object|null>} - Approval details or null if failed
 */
export async function fetchEpmApprovalDetails(requestUid) {
  try {
    const keeperConfig = await storage.get('keeperConfig');
    if (!keeperConfig || !keeperConfig.apiUrl || !keeperConfig.apiKey) {
      return null;
    }

    const { apiUrl, apiKey } = keeperConfig;
    const baseUrl = normalizeApiUrl(apiUrl);
    const viewCommand = `epm approval view ${requestUid} --format=json`;

    // Execute view command using API v2
    let rawData;
    try {
      rawData = await executeCommandAsync(baseUrl, apiKey, viewCommand);
    } catch (error) {
      // Check if request doesn't exist
      const errorText = String(error.message || '');
      const doesNotExist = errorText.toLowerCase().includes('does not exist');

      if (!doesNotExist) {
        return null;
      }

      // Try sync-down and retry
      try {
        await executeCommandAsync(baseUrl, apiKey, 'epm sync-down');
      } catch (syncError) {
        return null;
      }

      // Wait 2 seconds for sync to propagate
      await sleep(2000);

      // Retry view command after sync
      try {
        rawData = await executeCommandAsync(baseUrl, apiKey, viewCommand);
      } catch (retryError) {
        return null;
      }
    }

    // Extract approval data from various possible response structures
    const approvalData = extractEpmApprovalData(rawData);
    
    return approvalData || null;
  } catch (error) {
    return null;
  }
}

/**
 * Execute a Keeper Commander command using API v2 async queue
 * Includes per-user rate limiting to prevent queue overflow.
 *
 * Rate-limit bucket is auto-detected from the command verb (read vs write).
 * Callers can pass `options.bucket` to override this, but it is usually not
 * needed — resolvers remain bucket-agnostic.
 *
 * @param {string} command - The command to execute
 * @param {Object} options - Optional configuration
 * @param {string} options.userId - User ID for rate limiting (accountId)
 * @param {boolean} options.skipRateLimit - Skip rate limiting (for internal/system calls)
 * @param {boolean} options.forgeSafe - Cap async polling for Forge 25s limit
 * @param {'read'|'write'} [options.bucket] - Explicit rate-limit bucket override
 * @returns {Promise<Object>} - API response
 */
export async function executeKeeperCommand(command, options = {}) {
  const { userId, skipRateLimit = false, forgeSafe = false, bucket } = options;

  // Auto-detect read vs write so resolvers don't have to know about buckets.
  const effectiveBucket = bucket || getRateLimitBucketForCommand(command);

  // Apply rate limiting unless explicitly skipped
  if (!skipRateLimit) {
    const rateLimit = await checkCommandRateLimit(userId, effectiveBucket);
    if (!rateLimit.allowed) {
      const error = new Error(rateLimit.error);
      error.rateLimited = true;
      error.retryAfter = rateLimit.retryAfter;
      error.limitType = rateLimit.limitType;
      error.bucket = effectiveBucket;
      throw error;
    }
  }
  
  const config = await storage.get('keeperConfig');
  if (!config) {
    throw new Error('Keeper configuration not found. Please configure the app first.');
  }

  const { apiUrl, apiKey } = config;
  const baseUrl = normalizeApiUrl(apiUrl);

  const data = await executeCommandAsync(baseUrl, apiKey, command, { forgeSafe });

  // Check for API-level errors in response
  if (data.success === false || data.error) {
    const rawError = data.error || data.message || 'Unknown error';
    const cleanedError = parseKeeperErrorMessage(rawError);
    throw new Error(cleanedError);
  }

  return { 
    success: true, 
    data: data,
    message: data.message || 'Command executed successfully'
  };
}

/**
 * Test connection to Keeper Commander API
 * @param {string} apiUrl - API URL
 * @param {string} apiKey - API Key
 * @returns {Promise<Object>} - Test result
 */
export async function testKeeperConnection(apiUrl, apiKey) {
  const baseUrl = normalizeApiUrl(apiUrl);

  const data = await executeCommandAsync(baseUrl, apiKey, 'service-status');

  // Check for API-level errors in response
  if (data.success === false || data.error) {
    const rawError = data.error || data.message || 'Unknown error';
    const cleanedError = parseKeeperErrorMessage(rawError);
    throw new Error(`Connection test failed: ${cleanedError}`);
  }

  return {
    success: true,
    message: 'Connection successful',
    data: data
  };
}
