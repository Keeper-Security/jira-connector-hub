/**
 * Webhook Handler Module
 * Handles incoming webhooks from Keeper Security and creates Jira tickets
 * 
 * Security Features:
 * - Token-based authentication (query parameter)
 * - Rate limiting (50 requests/hour per source)
 * - Request schema validation
 * - Audit logging
 */

import { storage } from '@forge/api';
import { fetchEpmApprovalDetails } from './keeperApi.js';
import { buildEnrichedTicketDescription, buildBasicTicketDescription } from './utils/adfBuilder.js';
import { buildTicketLabels } from './utils/labelBuilder.js';
import { requestJiraAsAppWithRetry, route } from './utils/jiraApiRetry.js';
import { logger } from './utils/logger.js';

// ============================================================================
// Security Configuration
// ============================================================================

const SECURITY_CONFIG = {
  // Rate limiting: max requests per hour per source
  rateLimitPerHour: 50,
  // Rate limit window in milliseconds (1 hour)
  rateLimitWindowMs: 60 * 60 * 1000,
  // Maximum payload size (100KB)
  maxPayloadSize: 100 * 1024,
};

// ============================================================================
// Storage Retry Configuration
// ============================================================================

const STORAGE_RETRY_CONFIG = {
  maxRetries: 3,              // Maximum number of retry attempts
  initialDelayMs: 1000,       // Initial delay (1 second)
  maxDelayMs: 10000,          // Maximum delay (10 seconds)
  backoffMultiplier: 2,       // Exponential backoff multiplier
  jitterFactor: 0.2,          // Add up to 20% random jitter
};

// ============================================================================
// Storage Retry Helper Functions
// ============================================================================

/**
 * Add jitter to delay to prevent retry collisions
 * @param {number} delay - Base delay in milliseconds
 * @returns {number} - Delay with jitter added
 */
function addJitter(delay) {
  const jitter = delay * STORAGE_RETRY_CONFIG.jitterFactor * Math.random();
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
 * Execute a storage operation with retry logic and exponential backoff
 * Handles HTTP 429 rate limit errors from Forge Storage API
 * 
 * @param {Function} operation - Async function that performs the storage operation
 * @param {string} operationName - Name of the operation for logging
 * @returns {Promise<*>} - Result of the operation
 * @throws {Error} - If all retries are exhausted
 */
async function withStorageRetry(operation, operationName = 'storage operation') {
  let lastError;
  let delay = STORAGE_RETRY_CONFIG.initialDelayMs;
  
  for (let attempt = 1; attempt <= STORAGE_RETRY_CONFIG.maxRetries + 1; attempt++) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      
      // Check if this is a rate limit error (429) or transient error
      const isRateLimitError = error.status === 429 || 
                               error.statusCode === 429 ||
                               (error.message && error.message.includes('429')) ||
                               (error.message && error.message.toLowerCase().includes('rate limit'));
      
      const isTransientError = isRateLimitError ||
                               error.status === 503 ||
                               error.statusCode === 503 ||
                               (error.message && error.message.includes('503'));
      
      // Only retry on transient/rate limit errors
      if (!isTransientError || attempt > STORAGE_RETRY_CONFIG.maxRetries) {
        throw error;
      }
      
      // Calculate delay with jitter
      const delayWithJitter = addJitter(delay);
      
      logger.warn('Storage operation failed, retrying', {
        operation: operationName,
        attempt,
        maxAttempts: STORAGE_RETRY_CONFIG.maxRetries + 1,
        error: error.message,
        retryDelayMs: delayWithJitter
      });
      
      // Wait before retry
      await sleep(delayWithJitter);
      
      // Increase delay for next attempt (exponential backoff)
      delay = Math.min(delay * STORAGE_RETRY_CONFIG.backoffMultiplier, STORAGE_RETRY_CONFIG.maxDelayMs);
    }
  }
  
  // This shouldn't be reached, but just in case
  throw lastError;
}

/**
 * Storage.get with retry logic
 * @param {string} key - Storage key
 * @returns {Promise<*>} - Stored value or undefined
 */
async function storageGetWithRetry(key) {
  return withStorageRetry(
    () => storage.get(key),
    `get(${key})`
  );
}

/**
 * Storage.set with retry logic
 * @param {string} key - Storage key
 * @param {*} value - Value to store
 * @returns {Promise<void>}
 */
async function storageSetWithRetry(key, value) {
  return withStorageRetry(
    () => storage.set(key, value),
    `set(${key})`
  );
}

/**
 * Storage.delete with retry logic
 * @param {string} key - Storage key
 * @returns {Promise<void>}
 */
async function storageDeleteWithRetry(key) {
  return withStorageRetry(
    () => storage.delete(key),
    `delete(${key})`
  );
}

// ============================================================================
// Security Helper Functions
// ============================================================================

/**
 * Generate a cryptographically secure random token
 * Uses Web Crypto API for secure random number generation
 * @returns {string} - 64-character hex token
 */
export function generateWebhookToken() {
  // Generate 32 random bytes (256 bits) using Web Crypto API
  // This produces a 64-character hex string
  const randomBytes = new Uint8Array(32);
  crypto.getRandomValues(randomBytes);
  
  // Convert to hexadecimal string
  const token = Array.from(randomBytes)
    .map(byte => byte.toString(16).padStart(2, '0'))
    .join('');
  
  return token;
}

/**
 * Validate the webhook authentication token from Authorization header
 * Expects: Authorization: Bearer <token>
 * @param {Object} request - Incoming request object
 * @param {Object} config - Web trigger configuration
 * @returns {Object} - { valid: boolean, error?: string }
 */
function validateWebhookToken(request, config) {
  // Check if token authentication is configured (REQUIRED)
  if (!config.webhookToken) {
    // Token not configured - reject request for security
    return { 
      valid: false, 
      error: 'Webhook token not configured. Please configure a webhook token in the Keeper app settings before sending webhooks.' 
    };
  }
  
  // Extract token from Authorization header
  // Forge provides headers as an object (may be case-insensitive)
  const headers = request.headers || {};
  let authHeader = headers['authorization'] || headers['Authorization'] || '';
  
  // Handle case where header is an array
  if (Array.isArray(authHeader)) {
    authHeader = authHeader[0] || '';
  }
  
  // Ensure it's a string
  authHeader = String(authHeader);
  
  // Check for Bearer token format
  if (!authHeader) {
    return { 
      valid: false, 
      error: 'Missing Authorization header. Include "Authorization: Bearer <token>" in the request.' 
    };
  }
  
  // Parse Bearer token
  const bearerMatch = authHeader.match(/^Bearer\s+(.+)$/i);
  if (!bearerMatch) {
    return { 
      valid: false, 
      error: 'Invalid Authorization header format. Expected "Bearer <token>".' 
    };
  }
  
  const providedToken = bearerMatch[1].trim();
  
  if (!providedToken) {
    return { 
      valid: false, 
      error: 'Empty Bearer token provided.' 
    };
  }
  
  // Constant-time comparison to prevent timing attacks
  const expectedToken = config.webhookToken;
  if (providedToken.length !== expectedToken.length) {
    return { valid: false, error: 'Invalid authentication token' };
  }
  
  let mismatch = 0;
  for (let i = 0; i < providedToken.length; i++) {
    mismatch |= providedToken.charCodeAt(i) ^ expectedToken.charCodeAt(i);
  }
  
  if (mismatch !== 0) {
    return { valid: false, error: 'Invalid authentication token' };
  }
  
  return { valid: true };
}

/**
 * Check rate limiting for webhook requests
 * @param {string} sourceIdentifier - Identifier for the request source
 * @returns {Promise<Object>} - { allowed: boolean, remaining: number, resetAt: string }
 */
async function checkRateLimit(sourceIdentifier) {
  const rateLimitKey = `webhook-ratelimit-${sourceIdentifier}`;
  const now = Date.now();
  const windowStart = now - SECURITY_CONFIG.rateLimitWindowMs;
  
  // Get current rate limit data (with retry for 429 errors)
  let rateLimitData = await storageGetWithRetry(rateLimitKey);
  
  if (!rateLimitData || rateLimitData.windowStart < windowStart) {
    // Start new window
    rateLimitData = {
      windowStart: now,
      count: 0,
      requests: []
    };
  }
  
  // Clean old requests outside the window
  rateLimitData.requests = (rateLimitData.requests || []).filter(
    timestamp => timestamp > windowStart
  );
  rateLimitData.count = rateLimitData.requests.length;
  
  // Check if limit exceeded
  if (rateLimitData.count >= SECURITY_CONFIG.rateLimitPerHour) {
    const resetAt = new Date(rateLimitData.windowStart + SECURITY_CONFIG.rateLimitWindowMs);
    return {
      allowed: false,
      remaining: 0,
      resetAt: resetAt.toISOString(),
      error: `Rate limit exceeded. Maximum ${SECURITY_CONFIG.rateLimitPerHour} requests per hour. Resets at ${resetAt.toISOString()}`
    };
  }
  
  // Add current request
  rateLimitData.requests.push(now);
  rateLimitData.count = rateLimitData.requests.length;
  
  // Save updated rate limit data (with retry for 429 errors)
  await storageSetWithRetry(rateLimitKey, rateLimitData);
  
  return {
    allowed: true,
    remaining: SECURITY_CONFIG.rateLimitPerHour - rateLimitData.count,
    resetAt: new Date(rateLimitData.windowStart + SECURITY_CONFIG.rateLimitWindowMs).toISOString()
  };
}

/**
 * Validate the webhook payload schema
 * @param {Object} payload - Parsed webhook payload
 * @returns {Object} - { valid: boolean, error?: string }
 */
function validatePayloadSchema(payload) {
  // Check if payload exists
  if (!payload || typeof payload !== 'object') {
    return { valid: false, error: 'Invalid payload: must be a JSON object' };
  }
  
  // For EPM approval requests, validate required fields
  if (payload.category === 'endpoint_privilege_manager' && 
      payload.audit_event === 'approval_request_created') {
    
    // request_uid is required for EPM approval requests
    if (!payload.request_uid && !payload.requestUid) {
      return { 
        valid: false, 
        error: 'Invalid payload: missing required field request_uid for approval_request_created event' 
      };
    }
  }
  
  // Validate category if provided (must be a string)
  if (payload.category !== undefined && typeof payload.category !== 'string') {
    return { valid: false, error: 'Invalid payload: category must be a string' };
  }
  
  // Validate audit_event if provided (must be a string)
  if (payload.audit_event !== undefined && typeof payload.audit_event !== 'string') {
    return { valid: false, error: 'Invalid payload: audit_event must be a string' };
  }
  
  return { valid: true };
}

/**
 * Log webhook attempt for audit purposes
 * @param {Object} logEntry - Log entry data
 */
async function logWebhookAttempt(logEntry) {
  try {
    const logsKey = 'webhook-audit-log';
    let logs = await storageGetWithRetry(logsKey) || [];
    
    // Add timestamp
    logEntry.timestamp = new Date().toISOString();
    
    // Keep only last 100 log entries to prevent storage bloat
    logs.unshift(logEntry);
    if (logs.length > 100) {
      logs = logs.slice(0, 100);
    }
    
    await storageSetWithRetry(logsKey, logs);
  } catch (error) {
    // Don't fail the request if logging fails (even after retries)
    logger.error('Failed to log webhook attempt', error);
  }
}

/**
 * Get a safe source identifier from request
 * @param {Object} request - Incoming request
 * @returns {string} - Source identifier for rate limiting
 */
function getSourceIdentifier(request) {
  // Try to get a reasonable identifier
  // In Forge, we may not have direct IP access, so use a combination
  const headers = request.headers || {};
  
  // Use X-Forwarded-For if available, otherwise use a generic key
  let forwardedFor = headers['x-forwarded-for'] || headers['X-Forwarded-For'];
  if (forwardedFor) {
    // Handle case where header is an array
    if (Array.isArray(forwardedFor)) {
      forwardedFor = forwardedFor[0];
    }
    // Ensure it's a string
    if (typeof forwardedFor === 'string') {
      // Take the first IP in the chain
      return forwardedFor.split(',')[0].trim().replace(/[^a-zA-Z0-9.-]/g, '_');
    }
  }
  
  // Fallback to a generic identifier (all requests share the same limit)
  return 'default';
}

// ============================================================================
// Main Webhook Handler
// ============================================================================

/**
 * Web trigger handler - receives Keeper Security alerts and creates Jira issues
 * Implements layered security: token auth, rate limiting, schema validation
 * @param {Object} request - Incoming webhook request
 * @returns {Promise<Object>} - HTTP response
 */
export async function webTriggerHandler(request) {
  const sourceId = getSourceIdentifier(request);
  
  logger.info('webTrigger: Webhook received', { sourceId, method: request.method });
  
  try {
    // Get the web trigger configuration (with retry for 429 errors)
    const config = await storageGetWithRetry('webTriggerConfig');
    
    if (!config || !config.projectKey || !config.issueType) {
      logger.warn('webTrigger: Webhook rejected - not configured', { sourceId });
      await logWebhookAttempt({
        source: sourceId,
        status: 'rejected',
        reason: 'not_configured'
      });
      
      return {
        statusCode: 400,
        body: JSON.stringify({
          success: false,
          error: 'Web trigger not configured. Please configure project and issue type in the Keeper app settings.'
        })
      };
    }
    
    // ========================================================================
    // Security Layer 1: Token Authentication
    // ========================================================================
    const tokenValidation = validateWebhookToken(request, config);
    if (!tokenValidation.valid) {
      logger.warn('webTrigger: Webhook rejected - invalid token', { sourceId, error: tokenValidation.error });
      await logWebhookAttempt({
        source: sourceId,
        status: 'rejected',
        reason: 'invalid_token',
        error: tokenValidation.error
      });
      
      return {
        statusCode: 401,
        body: JSON.stringify({
          success: false,
          error: tokenValidation.error
        })
      };
    }
    
    // ========================================================================
    // Security Layer 2: Rate Limiting
    // ========================================================================
    const rateLimit = await checkRateLimit(sourceId);
    if (!rateLimit.allowed) {
      logger.warn('webTrigger: Webhook rejected - rate limited', { 
        sourceId,
        remaining: rateLimit.remaining, 
        resetAt: rateLimit.resetAt 
      });
      await logWebhookAttempt({
        source: sourceId,
        status: 'rejected',
        reason: 'rate_limited',
        remaining: rateLimit.remaining,
        resetAt: rateLimit.resetAt
      });
      
      return {
        statusCode: 429,
        headers: {
          'X-RateLimit-Remaining': String(rateLimit.remaining),
          'X-RateLimit-Reset': rateLimit.resetAt
        },
        body: JSON.stringify({
          success: false,
          error: rateLimit.error
        })
      };
    }
    
    // ========================================================================
    // Security Layer 3: Payload Size Check
    // ========================================================================
    const bodySize = request.body ? request.body.length : 0;
    if (bodySize > SECURITY_CONFIG.maxPayloadSize) {
      await logWebhookAttempt({
        source: sourceId,
        status: 'rejected',
        reason: 'payload_too_large',
        size: bodySize
      });
      
      return {
        statusCode: 413,
        body: JSON.stringify({
          success: false,
          error: `Payload too large. Maximum size is ${SECURITY_CONFIG.maxPayloadSize} bytes.`
        })
      };
    }
    
    // Parse the incoming request body
    let payload;
    try {
      payload = request.body ? JSON.parse(request.body) : {};
    } catch (parseError) {
      await logWebhookAttempt({
        source: sourceId,
        status: 'rejected',
        reason: 'invalid_json'
      });
      
      return {
        statusCode: 400,
        body: JSON.stringify({
          success: false,
          error: 'Invalid JSON payload'
        })
      };
    }
    
    // ========================================================================
    // Security Layer 4: Schema Validation
    // ========================================================================
    const schemaValidation = validatePayloadSchema(payload);
    if (!schemaValidation.valid) {
      await logWebhookAttempt({
        source: sourceId,
        status: 'rejected',
        reason: 'invalid_schema',
        error: schemaValidation.error,
        category: payload.category,
        auditEvent: payload.audit_event
      });
      
      return {
        statusCode: 400,
        body: JSON.stringify({
          success: false,
          error: schemaValidation.error
        })
      };
    }
    
    // Validate that this is an endpoint privilege manager approval request
    if (payload.category !== 'endpoint_privilege_manager' || payload.audit_event !== 'approval_request_created') {
      await logWebhookAttempt({
        source: sourceId,
        status: 'skipped',
        reason: 'event_filtered',
        category: payload.category,
        auditEvent: payload.audit_event
      });
      
      return {
        statusCode: 200,
        body: JSON.stringify({
          success: true,
          message: 'Webhook received but skipped - only endpoint_privilege_manager approval_request_created events create tickets',
          category: payload.category,
          audit_event: payload.audit_event
        })
      };
    }
    
    // Extract request_uid
    const requestUid = payload.request_uid || payload.requestUid || new Date().toISOString();
    
    // Check if a ticket already exists for this request_uid (prevent duplicates)
    // Using storage for atomic check-and-set to prevent race conditions
    const sanitizedUid = requestUid.replace(/[^a-zA-Z0-9_-]/g, '-');
    const uidLabel = `request-${sanitizedUid}`;
    const storageKey = `webhook-processed-${sanitizedUid}`;
    
    // First check storage (faster and atomic, with retry for 429 errors)
    const existingTicket = await storageGetWithRetry(storageKey);
    if (existingTicket) {
      return {
        statusCode: 200,
        body: JSON.stringify({
          success: true,
          message: 'Duplicate webhook - ticket already exists',
          issueKey: existingTicket.issueKey,
          issueId: existingTicket.issueId,
          duplicate: true
        })
      };
    }
    
    // Also check Jira in case storage was cleared but ticket exists (with rate limit retry)
    const searchResponse = await requestJiraAsAppWithRetry(
      route`/rest/api/3/search?jql=${encodeURIComponent(`labels = "${uidLabel}"`)}`,
      {},
      'Search for duplicate ticket'
    );
    
    if (searchResponse.ok) {
      const searchResults = await searchResponse.json();
      if (searchResults.issues && searchResults.issues.length > 0) {
        const existingIssue = searchResults.issues[0];
        
        // Store for future checks (with retry for 429 errors)
        await storageSetWithRetry(storageKey, {
          issueKey: existingIssue.key,
          issueId: existingIssue.id,
          created: new Date().toISOString()
        });
        
        return {
          statusCode: 200,
          body: JSON.stringify({
            success: true,
            message: 'Duplicate webhook - ticket already exists',
            issueKey: existingIssue.key,
            issueId: existingIssue.id,
            duplicate: true
          })
        };
      }
    }
    
    // Mark as processing immediately (claim this request_uid, with retry for 429 errors)
    await storageSetWithRetry(storageKey, {
      issueKey: 'processing',
      issueId: 'processing',
      created: new Date().toISOString()
    });
    
    // Fetch detailed EPM approval data from Keeper API
    const approvalDetails = await fetchEpmApprovalDetails(requestUid);
    
    // Build ticket summary and description based on available data
    let summary;
    let adfDescription;
    
    if (approvalDetails) {
      const approvalType = approvalDetails.approval_type || 'Unknown';
      summary = `EPM ${approvalType} Request - ${requestUid}`;
      adfDescription = buildEnrichedTicketDescription(approvalDetails, payload);
    } else {
      summary = `KeeperSecurity Alert - ${requestUid}`;
      adfDescription = buildBasicTicketDescription(payload);
    }
    
    // Build labels from both sources
    const labels = buildTicketLabels(payload, approvalDetails);
    
    // Add unique request_uid label for duplicate detection
    labels.push(uidLabel);
    
    // Create the Jira issue (with rate limit retry)
    const response = await requestJiraAsAppWithRetry(
      route`/rest/api/3/issue`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fields: {
            project: { key: config.projectKey },
            summary: summary,
            description: adfDescription,
            issuetype: { name: config.issueType },
            labels: labels
          }
        })
      },
      'Create webhook ticket'
    );
    
    if (!response.ok) {
      const errorText = await response.text();
      // Clean up the processing lock on failure so it can be retried (with retry for 429 errors)
      await storageDeleteWithRetry(storageKey);
      return {
        statusCode: response.status,
        body: JSON.stringify({
          success: false,
          error: `Failed to create issue: ${errorText}`
        })
      };
    }
    
    const issue = await response.json();
    
    // Update storage with the actual ticket info (with retry for 429 errors)
    await storageSetWithRetry(storageKey, {
      issueKey: issue.key,
      issueId: issue.id,
      created: new Date().toISOString()
    });
    
    // For EPM approval requests, assign to a project admin
    if (payload.category === 'endpoint_privilege_manager' && payload.audit_event === 'approval_request_created') {
      try {
        await assignToProjectAdmin(config.projectKey, issue.key);
      } catch (assignError) {
        // Don't fail the entire webhook if assignment fails
      }
    }
    
    // Log successful webhook processing
    logger.info('webTrigger: Webhook processed successfully - ticket created', {
      sourceId,
      issueKey: issue.key,
      issueId: issue.id,
      requestUid: requestUid,
      category: payload.category,
      auditEvent: payload.audit_event
    });
    
    await logWebhookAttempt({
      source: sourceId,
      status: 'success',
      issueKey: issue.key,
      issueId: issue.id,
      requestUid: requestUid,
      category: payload.category,
      auditEvent: payload.audit_event
    });
    
    return {
      statusCode: 200,
      headers: {
        'X-RateLimit-Remaining': String(rateLimit.remaining)
      },
      body: JSON.stringify({
        success: true,
        message: 'Issue created successfully',
        issueKey: issue.key,
        issueId: issue.id
      })
    };
    
  } catch (error) {
    // Log the error
    logger.error('webTrigger: Webhook processing failed', { sourceId, error: error.message });
    
    await logWebhookAttempt({
      source: sourceId,
      status: 'error',
      reason: 'processing_error',
      error: error.message
    });
    
    // Try to clean up storage lock if it was set (with retry for 429 errors)
    try {
      const errorPayload = request.body ? JSON.parse(request.body) : {};
      const errorRequestUid = errorPayload.request_uid || errorPayload.requestUid;
      if (errorRequestUid) {
        const sanitizedUid = errorRequestUid.replace(/[^a-zA-Z0-9_-]/g, '-');
        const errorStorageKey = `webhook-processed-${sanitizedUid}`;
        const existing = await storageGetWithRetry(errorStorageKey);
        if (existing && existing.issueKey === 'processing') {
          await storageDeleteWithRetry(errorStorageKey);
        }
      }
    } catch (cleanupError) {
      // Silent cleanup failure (even after retries)
    }
    
    return {
      statusCode: 500,
      body: JSON.stringify({
        success: false,
        error: error.message || 'Internal server error'
      })
    };
  }
}

/**
 * Assign ticket to a project admin
 * @param {string} projectKey - Project key
 * @param {string} issueKey - Issue key
 */
async function assignToProjectAdmin(projectKey, issueKey) {
  // Get project roles (with rate limit retry)
  const rolesResponse = await requestJiraAsAppWithRetry(
    route`/rest/api/3/project/${projectKey}/role`,
    {},
    'Get project roles for assignment'
  );
  const roles = await rolesResponse.json();
  
  // Find admin role
  let adminRoleUrl = null;
  const possibleAdminRoleNames = ['Administrators', 'Administrator', 'Admins', 'Project Administrators', 'administrators'];
  
  for (const roleName of possibleAdminRoleNames) {
    if (roles && roles[roleName]) {
      adminRoleUrl = roles[roleName];
      break;
    }
  }
  
  if (adminRoleUrl) {
    // Extract role ID
    const roleIdMatch = adminRoleUrl.match(/role\/(\d+)/);
    if (roleIdMatch) {
      const roleId = roleIdMatch[1];
      
      // Get role details with actors (with rate limit retry)
      const roleDetailsResponse = await requestJiraAsAppWithRetry(
        route`/rest/api/3/project/${projectKey}/role/${roleId}`,
        {},
        'Get role details for assignment'
      );
      const roleDetails = await roleDetailsResponse.json();
      
      // Find first active admin user
      if (roleDetails && roleDetails.actors && roleDetails.actors.length > 0) {
        let assigneeAccountId = null;
        
        for (const actor of roleDetails.actors) {
          if (actor.actorUser && actor.actorUser.accountId) {
            assigneeAccountId = actor.actorUser.accountId;
            break;
          } else if (actor.id) {
            assigneeAccountId = actor.id;
            break;
          } else if (actor.accountId) {
            assigneeAccountId = actor.accountId;
            break;
          }
        }
        
        // Assign ticket to admin (with rate limit retry)
        if (assigneeAccountId) {
          await requestJiraAsAppWithRetry(
            route`/rest/api/3/issue/${issueKey}`,
            {
              method: 'PUT',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                fields: {
                  assignee: { accountId: assigneeAccountId }
                }
              })
            },
            'Assign ticket to admin'
          );
        }
      }
    }
  }
}

