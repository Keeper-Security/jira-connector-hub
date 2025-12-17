/**
 * Keeper Commander API Module
 * Handles all interactions with Keeper Security Commander API
 * Uses API v2 (async queue mode) - introduced in Commander 17.1.7
 * 
 * API v2 Reference: https://docs.keeper.io/en/keeperpam/commander-cli/service-mode-rest-api/api-usage
 */

import { storage, fetch } from '@forge/api';

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
  },
  
  // Request states from API v2
  requestStates: {
    QUEUED: 'queued',
    PROCESSING: 'processing',
    COMPLETED: 'completed',
    FAILED: 'failed',
    EXPIRED: 'expired',
  },
};

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Helper function to parse and clean Keeper CLI error messages
 * Extracts the meaningful user-friendly error message from verbose CLI output
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
        return afterColon;
      }
    }
    
    // If no colon pattern found, return the last meaningful line
    return lastLine;
  }
  
  return errorText;
}

/**
 * Normalize the API URL
 * Expects complete API v2 URL like: http://localhost:8080/api/v2 or https://my-tunnel.ngrok.io/api/v2
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
 * - http://localhost:8080/api/v2
 * 
 * This function appends the specific endpoint:
 * - POST {apiUrl}/executecommand-async - Submit command to queue
 * - GET  {apiUrl}/status/{request_id}  - Check request status
 * - GET  {apiUrl}/result/{request_id}  - Get request result
 * - GET  {apiUrl}/queue/status         - Get queue status
 * 
 * @param {string} apiUrl - Complete API URL (e.g., http://localhost:8080/api/v2)
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

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'api-key': apiKey,
    },
    body: JSON.stringify(body),
  });

  // Handle specific v2 error codes
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

  const response = await fetch(endpoint, {
    method: 'GET',
    headers: {
      'api-key': apiKey,
    },
  });

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

  const response = await fetch(endpoint, {
    method: 'GET',
    headers: {
      'api-key': apiKey,
    },
  });

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
 * @returns {Promise<Object>} - Command result
 */
async function executeCommandAsync(baseUrl, apiKey, command, options = {}) {
  const {
    filedata,
    maxAttempts = API_CONFIG.polling.maxAttempts,
    pollingIntervalMs = API_CONFIG.polling.intervalMs,
  } = options;

  // Step 1: Submit the command to the async queue
  const submitResponse = await submitAsyncCommand(baseUrl, apiKey, command, { filedata });
  const { requestId } = submitResponse;

  // Step 2: Wait for initial delay before first poll
  await sleep(API_CONFIG.polling.initialDelayMs);

  // Step 3: Poll for completion with exponential backoff
  let currentInterval = pollingIntervalMs;
  let attempts = 0;

  while (attempts < maxAttempts) {
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

    // Still queued or processing - wait and retry
    await sleep(currentInterval);
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
 * Extract PEDM approval data from various API response formats
 * Handles different structures returned by Commander API v2
 * @param {Object} rawData - Raw API response
 * @returns {Object|null} - Extracted approval details or null
 */
function extractPedmApprovalData(rawData) {
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
      return extractPedmApprovalData(parsed); // Recursively extract from parsed output
    } catch (e) {
      // Not JSON, ignore
    }
  }

  return null;
}

/**
 * Fetch PEDM approval details from Keeper API with auto-sync fallback
 * @param {string} requestUid - The request UID to fetch details for
 * @returns {Promise<Object|null>} - Approval details or null if failed
 */
export async function fetchPedmApprovalDetails(requestUid) {
  try {
    const keeperConfig = await storage.get('keeperConfig');
    if (!keeperConfig || !keeperConfig.apiUrl || !keeperConfig.apiKey) {
      return null;
    }

    const { apiUrl, apiKey } = keeperConfig;
    const baseUrl = normalizeApiUrl(apiUrl);
    const viewCommand = `pedm approval view ${requestUid} --format=json`;

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
        await executeCommandAsync(baseUrl, apiKey, 'pedm sync-down');
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
    const approvalData = extractPedmApprovalData(rawData);
    
    return approvalData || null;
  } catch (error) {
    return null;
  }
}

/**
 * Execute a Keeper Commander command using API v2 async queue
 * @param {string} command - The command to execute
 * @returns {Promise<Object>} - API response
 */
export async function executeKeeperCommand(command) {
  const config = await storage.get('keeperConfig');
  if (!config) {
    throw new Error('Keeper configuration not found. Please configure the app first.');
  }

  const { apiUrl, apiKey } = config;
  const baseUrl = normalizeApiUrl(apiUrl);

  const data = await executeCommandAsync(baseUrl, apiKey, command);

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
