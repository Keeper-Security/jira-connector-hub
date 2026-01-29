/**
 * Jira API Retry Utility
 * 
 * Implements retry logic with exponential backoff for Jira API calls
 * to comply with the 2026 point-based rate limit changes.
 * 
 * Starting March 2, 2026, Jira API enforces point-based quotas and returns
 * HTTP 429 responses when quotas are exceeded.
 * 
 * Reference: https://developer.atlassian.com/cloud/jira/platform/rate-limiting/
 * 
 * @module jiraApiRetry
 */

import { asApp, asUser, route } from '@forge/api';
import { logger } from './logger.js';

// ============================================================================
// Jira API Rate Limit Configuration
// ============================================================================

const JIRA_RETRY_CONFIG = {
  maxRetries: 3,                    // Maximum number of retry attempts
  initialDelayMs: 1000,             // Initial delay (1 second)
  maxDelayMs: 30000,                // Maximum delay (30 seconds)
  backoffMultiplier: 2,             // Exponential backoff multiplier
  jitterFactor: 0.2,                // Add up to 20% random jitter
  retryableStatusCodes: [429, 503], // Status codes that trigger retry
};

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Add jitter to delay to prevent thundering herd problem
 * @param {number} delay - Base delay in milliseconds
 * @returns {number} - Delay with jitter added
 */
function addJitter(delay) {
  const jitter = delay * JIRA_RETRY_CONFIG.jitterFactor * Math.random();
  return Math.floor(delay + jitter);
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
 * Parse Retry-After header value
 * Can be either a number of seconds or an HTTP-date
 * @param {string|null} retryAfter - Value of Retry-After header
 * @returns {number} - Delay in milliseconds
 */
function parseRetryAfter(retryAfter) {
  if (!retryAfter) {
    return null;
  }
  
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
 * Calculate delay for next retry attempt
 * @param {number} attempt - Current attempt number (1-based)
 * @param {string|null} retryAfterHeader - Value of Retry-After header from response
 * @returns {number} - Delay in milliseconds
 */
function calculateRetryDelay(attempt, retryAfterHeader) {
  // If Retry-After header is present, respect it
  const retryAfterMs = parseRetryAfter(retryAfterHeader);
  if (retryAfterMs !== null) {
    // Cap at maxDelayMs but don't go below it if server requests more
    // Add small jitter to prevent synchronized retries
    return Math.min(addJitter(retryAfterMs), JIRA_RETRY_CONFIG.maxDelayMs * 2);
  }
  
  // Calculate exponential backoff
  const baseDelay = JIRA_RETRY_CONFIG.initialDelayMs * 
                    Math.pow(JIRA_RETRY_CONFIG.backoffMultiplier, attempt - 1);
  const cappedDelay = Math.min(baseDelay, JIRA_RETRY_CONFIG.maxDelayMs);
  
  return addJitter(cappedDelay);
}

/**
 * Check if the response status code is retryable
 * @param {number} status - HTTP status code
 * @returns {boolean}
 */
function isRetryableStatus(status) {
  return JIRA_RETRY_CONFIG.retryableStatusCodes.includes(status);
}

// ============================================================================
// Main Retry Wrapper Functions
// ============================================================================

/**
 * Execute a Jira API request with retry logic
 * 
 * @param {Function} requestFn - Function that returns a Promise<Response>
 * @param {string} operationName - Name of the operation for logging
 * @param {Object} options - Optional configuration
 * @param {number} options.maxRetries - Override max retries
 * @returns {Promise<Response>} - The successful response
 * @throws {Error} - If all retries are exhausted or non-retryable error occurs
 */
export async function withJiraRetry(requestFn, operationName = 'Jira API call', options = {}) {
  const maxRetries = options.maxRetries ?? JIRA_RETRY_CONFIG.maxRetries;
  let lastResponse;
  
  for (let attempt = 1; attempt <= maxRetries + 1; attempt++) {
    try {
      const response = await requestFn();
      lastResponse = response;
      
      // Check if we should retry
      if (isRetryableStatus(response.status)) {
        if (attempt > maxRetries) {
          // Out of retries, return the response as-is for caller to handle
          logger.warn('Jira API rate limited after retries', {
            operation: operationName,
            status: response.status,
            maxRetries
          });
          return response;
        }
        
        // Get Retry-After header
        const retryAfter = response.headers?.get?.('Retry-After') || 
                          response.headers?.['retry-after'] ||
                          response.headers?.['Retry-After'];
        
        // Calculate delay
        const delay = calculateRetryDelay(attempt, retryAfter);
        
        logger.warn('Jira API rate limited, retrying', {
          operation: operationName,
          status: response.status,
          attempt,
          maxAttempts: maxRetries + 1,
          retryDelayMs: delay
        });
        
        // Wait before retry
        await sleep(delay);
        continue;
      }
      
      // Not a retryable status, return the response
      return response;
      
    } catch (error) {
      // Network errors or other exceptions
      if (attempt > maxRetries) {
        logger.error('Jira API failed after retries', {
          operation: operationName,
          maxRetries,
          error: error.message
        });
        throw error;
      }
      
      // Retry on network errors
      const delay = calculateRetryDelay(attempt, null);
      logger.warn('Jira API network error, retrying', {
        operation: operationName,
        attempt,
        maxAttempts: maxRetries + 1,
        retryDelayMs: delay,
        error: error.message
      });
      
      await sleep(delay);
    }
  }
  
  // Return last response if we somehow exit the loop
  return lastResponse;
}

/**
 * Make a Jira API request as the app with retry logic
 * 
 * @param {string|TemplateStringsArray} routeOrPath - The API route
 * @param {Object} options - Fetch options (method, headers, body, etc.)
 * @param {string} operationName - Name of the operation for logging
 * @returns {Promise<Response>}
 */
export async function requestJiraAsAppWithRetry(routeOrPath, options = {}, operationName = 'Jira API') {
  return withJiraRetry(
    () => asApp().requestJira(routeOrPath, options),
    operationName
  );
}

/**
 * Make a Jira API request as the user with retry logic
 * 
 * @param {string|TemplateStringsArray} routeOrPath - The API route
 * @param {Object} options - Fetch options (method, headers, body, etc.)
 * @param {string} operationName - Name of the operation for logging
 * @returns {Promise<Response>}
 */
export async function requestJiraAsUserWithRetry(routeOrPath, options = {}, operationName = 'Jira API') {
  return withJiraRetry(
    () => asUser().requestJira(routeOrPath, options),
    operationName
  );
}

// Re-export route for convenience
export { route };
