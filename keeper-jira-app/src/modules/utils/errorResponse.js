/**
 * Structured Error Response Utility
 * 
 * Provides standardized error responses for Forge resolvers.
 * Instead of throwing errors (which Forge wraps with "There was an error invoking the function -"),
 * this returns structured objects that give better UX control to the frontend.
 * 
 * Reference: https://community.atlassian.com/t5/Forge-discussions/Error-handling-in-Forge/td-p/1831422
 */

const { logger } = require('./logger.js');

// ========================================================================
// Error Codes
// Organized by category for easy reference and consistent error handling
// ========================================================================

const ERROR_CODES = {
  // Validation Errors (400-level)
  VALIDATION_REQUIRED_FIELD: 'VALIDATION_REQUIRED_FIELD',
  VALIDATION_INVALID_FORMAT: 'VALIDATION_INVALID_FORMAT',
  VALIDATION_LENGTH_EXCEEDED: 'VALIDATION_LENGTH_EXCEEDED',
  VALIDATION_INVALID_EMAIL: 'VALIDATION_INVALID_EMAIL',
  VALIDATION_INVALID_URL: 'VALIDATION_INVALID_URL',
  VALIDATION_INVALID_RECORD: 'VALIDATION_INVALID_RECORD',
  
  // Authentication/Authorization Errors
  AUTH_NOT_CONFIGURED: 'AUTH_NOT_CONFIGURED',
  AUTH_INVALID_CREDENTIALS: 'AUTH_INVALID_CREDENTIALS',
  AUTH_PERMISSION_DENIED: 'AUTH_PERMISSION_DENIED',
  AUTH_NOT_ADMIN: 'AUTH_NOT_ADMIN',
  AUTH_NOT_PROJECT_ADMIN: 'AUTH_NOT_PROJECT_ADMIN',
  
  // Rate Limiting Errors
  RATE_LIMIT_EXCEEDED: 'RATE_LIMIT_EXCEEDED',
  RATE_LIMIT_MINUTE: 'RATE_LIMIT_MINUTE',
  RATE_LIMIT_HOUR: 'RATE_LIMIT_HOUR',
  
  // Connection/Network Errors
  CONNECTION_FAILED: 'CONNECTION_FAILED',
  CONNECTION_TIMEOUT: 'CONNECTION_TIMEOUT',
  CONNECTION_TUNNEL_OFFLINE: 'CONNECTION_TUNNEL_OFFLINE',
  CONNECTION_SERVICE_UNAVAILABLE: 'CONNECTION_SERVICE_UNAVAILABLE',
  
  // Keeper API Errors
  KEEPER_NOT_CONFIGURED: 'KEEPER_NOT_CONFIGURED',
  KEEPER_CONNECTION_FAILED: 'KEEPER_CONNECTION_FAILED',
  KEEPER_COMMAND_FAILED: 'KEEPER_COMMAND_FAILED',
  KEEPER_RECORD_NOT_FOUND: 'KEEPER_RECORD_NOT_FOUND',
  KEEPER_FOLDER_NOT_FOUND: 'KEEPER_FOLDER_NOT_FOUND',
  KEEPER_PERMISSION_DENIED: 'KEEPER_PERMISSION_DENIED',
  KEEPER_QUEUE_FULL: 'KEEPER_QUEUE_FULL',
  KEEPER_TIMEOUT: 'KEEPER_TIMEOUT',
  
  // EPM-specific Errors (Endpoint Privilege Manager)
  EPM_ALREADY_APPROVED: 'EPM_ALREADY_APPROVED',
  EPM_ALREADY_DENIED: 'EPM_ALREADY_DENIED',
  EPM_EXPIRED: 'EPM_EXPIRED',
  EPM_INVALID_UID: 'EPM_INVALID_UID',
  
  // Jira API Errors
  JIRA_API_ERROR: 'JIRA_API_ERROR',
  JIRA_ISSUE_NOT_FOUND: 'JIRA_ISSUE_NOT_FOUND',
  JIRA_PROJECT_NOT_FOUND: 'JIRA_PROJECT_NOT_FOUND',
  JIRA_PERMISSION_DENIED: 'JIRA_PERMISSION_DENIED',
  
  // Storage Errors
  STORAGE_ERROR: 'STORAGE_ERROR',
  STORAGE_NOT_FOUND: 'STORAGE_NOT_FOUND',
  
  // Webhook Errors
  WEBHOOK_NOT_CONFIGURED: 'WEBHOOK_NOT_CONFIGURED',
  WEBHOOK_INVALID_TOKEN: 'WEBHOOK_INVALID_TOKEN',
  WEBHOOK_RATE_LIMITED: 'WEBHOOK_RATE_LIMITED',
  
  // Generic Errors
  INTERNAL_ERROR: 'INTERNAL_ERROR',
  UNKNOWN_ERROR: 'UNKNOWN_ERROR'
};

// ========================================================================
// Troubleshooting Steps by Error Code
// ========================================================================

const TROUBLESHOOTING = {
  // Validation
  [ERROR_CODES.VALIDATION_REQUIRED_FIELD]: [
    'Ensure all required fields are filled out',
    'Check that form data is being submitted correctly'
  ],
  [ERROR_CODES.VALIDATION_INVALID_FORMAT]: [
    'Check the format of your input',
    'Refer to the field description for expected format'
  ],
  [ERROR_CODES.VALIDATION_INVALID_URL]: [
    'Ensure the URL starts with https://',
    'Check for typos in the URL',
    'Verify the tunnel service is running'
  ],
  
  // Authentication
  [ERROR_CODES.AUTH_NOT_CONFIGURED]: [
    'Go to Global Settings and configure your Keeper API URL and API Key',
    'Test the connection before saving'
  ],
  [ERROR_CODES.AUTH_INVALID_CREDENTIALS]: [
    'Verify your API Key is correct',
    'Regenerate the API Key if needed',
    'Check that the Keeper Commander service is running with the correct configuration'
  ],
  [ERROR_CODES.AUTH_PERMISSION_DENIED]: [
    'You may not have permission to perform this action',
    'Contact your Jira administrator for access'
  ],
  [ERROR_CODES.AUTH_NOT_ADMIN]: [
    'This action requires Jira administrator privileges',
    'Contact your Jira administrator'
  ],
  
  // Rate Limiting
  [ERROR_CODES.RATE_LIMIT_EXCEEDED]: [
    'Wait a moment before trying again',
    'Reduce the frequency of your requests'
  ],
  [ERROR_CODES.RATE_LIMIT_MINUTE]: [
    'You have exceeded the per-minute request limit (5 commands/minute)',
    'Wait 60 seconds before trying again'
  ],
  [ERROR_CODES.RATE_LIMIT_HOUR]: [
    'You have exceeded the hourly request limit (50 commands/hour)',
    'Try again later or contact your administrator'
  ],
  
  // Connection
  [ERROR_CODES.CONNECTION_FAILED]: [
    'Verify your tunnel (ngrok/Cloudflare) is running',
    'Check that the Keeper Commander service is active',
    'Verify the API URL in Global Settings is correct'
  ],
  [ERROR_CODES.CONNECTION_TUNNEL_OFFLINE]: [
    'Start your tunnel service (ngrok or Cloudflare)',
    'If using ngrok free tier, the URL changes on restart - update Global Settings',
    'Consider using a paid ngrok plan or Cloudflare for stable URLs'
  ],
  [ERROR_CODES.CONNECTION_TIMEOUT]: [
    'The service may be slow to respond',
    'Check your network connection',
    'Verify the Keeper Commander service is running'
  ],
  
  // Keeper API
  [ERROR_CODES.KEEPER_NOT_CONFIGURED]: [
    'Configure the Keeper API connection in Global Settings',
    'Provide both API URL and API Key',
    'Test the connection before saving'
  ],
  [ERROR_CODES.KEEPER_CONNECTION_FAILED]: [
    'Verify the Keeper Commander service is running',
    'Check the tunnel connection',
    'Verify API credentials'
  ],
  [ERROR_CODES.KEEPER_COMMAND_FAILED]: [
    'Check the command syntax',
    'Verify you have permission for this operation',
    'Check Keeper Commander logs for details'
  ],
  [ERROR_CODES.KEEPER_RECORD_NOT_FOUND]: [
    'Verify the record UID is correct',
    'The record may have been deleted',
    'Refresh the record list'
  ],
  [ERROR_CODES.KEEPER_QUEUE_FULL]: [
    'The Keeper Commander queue is full (max 100 requests)',
    'Wait for pending requests to complete',
    'Try again in a few moments'
  ],
  
  // EPM (Endpoint Privilege Manager)
  [ERROR_CODES.EPM_ALREADY_APPROVED]: [
    'This approval request has already been processed',
    'No further action is needed'
  ],
  [ERROR_CODES.EPM_ALREADY_DENIED]: [
    'This approval request has already been denied',
    'A new request must be submitted if access is still needed'
  ],
  [ERROR_CODES.EPM_EXPIRED]: [
    'This approval request has expired',
    'The user must submit a new access request'
  ],
  
  // Jira API
  [ERROR_CODES.JIRA_API_ERROR]: [
    'A Jira API error occurred',
    'Try refreshing the page',
    'If the issue persists, contact your Jira administrator'
  ],
  [ERROR_CODES.JIRA_PERMISSION_DENIED]: [
    'You may not have permission to access this resource',
    'Check your Jira project permissions'
  ],
  
  // Webhook
  [ERROR_CODES.WEBHOOK_NOT_CONFIGURED]: [
    'Configure the webhook in Global Settings > Webhook Configuration',
    'Set the target project and issue type',
    'Generate an authentication token'
  ],
  
  // Generic
  [ERROR_CODES.INTERNAL_ERROR]: [
    'An unexpected error occurred',
    'Try refreshing the page',
    'If the issue persists, check the Forge logs or contact support'
  ]
};

// ========================================================================
// Response Builders
// ========================================================================

/**
 * Create a success response
 * @param {Object} data - Response data
 * @param {string} message - Optional success message
 * @returns {Object} Structured success response
 */
function successResponse(data = {}, message = null) {
  const response = {
    success: true,
    ...data
  };
  
  if (message) {
    response.message = message;
  }
  
  return response;
}

/**
 * Create an error response
 * @param {string} code - Error code from ERROR_CODES
 * @param {string} message - User-friendly error message
 * @param {Object} options - Additional options
 * @param {Array<string>} options.troubleshooting - Custom troubleshooting steps (overrides defaults)
 * @param {Object} options.details - Additional error details (for debugging)
 * @param {string} options.field - Field name if validation error
 * @param {number} options.retryAfter - Seconds until retry is allowed (for rate limits)
 * @returns {Object} Structured error response
 */
function errorResponse(code, message, options = {}) {
  const {
    troubleshooting = null,
    details = null,
    field = null,
    retryAfter = null
  } = options;
  
  const response = {
    success: false,
    error: code,
    message: message
  };
  
  // Add troubleshooting steps (custom or default)
  const steps = troubleshooting || TROUBLESHOOTING[code];
  if (steps && steps.length > 0) {
    response.troubleshooting = steps;
  }
  
  // Add optional fields
  if (field) {
    response.field = field;
  }
  
  if (retryAfter !== null) {
    response.retryAfter = retryAfter;
  }
  
  if (details) {
    response.details = details;
  }
  
  return response;
}

/**
 * Create a validation error response
 * @param {string} field - Field name that failed validation
 * @param {string} message - Validation error message
 * @param {string} code - Optional specific error code (defaults to VALIDATION_REQUIRED_FIELD)
 * @returns {Object} Structured validation error response
 */
function validationError(field, message, code = ERROR_CODES.VALIDATION_REQUIRED_FIELD) {
  return errorResponse(code, message, { field });
}

/**
 * Create a rate limit error response
 * @param {string} limitType - 'minute' or 'hour'
 * @param {number} retryAfter - Seconds until retry is allowed
 * @param {number} remaining - Remaining requests in the window
 * @returns {Object} Structured rate limit error response
 */
function rateLimitError(limitType, retryAfter, remaining = 0) {
  const code = limitType === 'minute' ? ERROR_CODES.RATE_LIMIT_MINUTE : ERROR_CODES.RATE_LIMIT_HOUR;
  const windowName = limitType === 'minute' ? 'minute' : 'hour';
  
  return errorResponse(
    code,
    `Rate limit exceeded. Please wait before trying again.`,
    {
      retryAfter,
      details: {
        limitType,
        remaining,
        resetIn: `${retryAfter} seconds`
      }
    }
  );
}

/**
 * Create a connection error response
 * @param {string} message - Error message
 * @param {Object} originalError - Original error object
 * @returns {Object} Structured connection error response
 */
function connectionError(message, originalError = null) {
  let code = ERROR_CODES.CONNECTION_FAILED;
  let troubleshooting = null;
  
  // Detect specific connection issues
  const lowerMessage = (message || '').toLowerCase();
  const errorString = originalError?.message?.toLowerCase() || '';
  
  if (lowerMessage.includes('ngrok') || 
      lowerMessage.includes('tunnel') || 
      errorString.includes('err_ngrok') ||
      errorString.includes('tunnel offline')) {
    code = ERROR_CODES.CONNECTION_TUNNEL_OFFLINE;
  } else if (lowerMessage.includes('timeout') || errorString.includes('timeout')) {
    code = ERROR_CODES.CONNECTION_TIMEOUT;
  } else if (lowerMessage.includes('503') || lowerMessage.includes('unavailable')) {
    code = ERROR_CODES.CONNECTION_SERVICE_UNAVAILABLE;
  }
  
  return errorResponse(code, message, { troubleshooting });
}

/**
 * Create a Keeper API error response
 * @param {string} message - Error message
 * @param {Object} originalError - Original error object
 * @returns {Object} Structured Keeper error response
 */
function keeperError(message, originalError = null) {
  let code = ERROR_CODES.KEEPER_COMMAND_FAILED;
  
  const lowerMessage = (message || '').toLowerCase();
  
  // Detect specific Keeper errors
  if (lowerMessage.includes('not configured') || lowerMessage.includes('api url is required')) {
    code = ERROR_CODES.KEEPER_NOT_CONFIGURED;
  } else if (lowerMessage.includes('not found') || lowerMessage.includes('does not exist')) {
    code = ERROR_CODES.KEEPER_RECORD_NOT_FOUND;
  } else if (lowerMessage.includes('permission') || lowerMessage.includes('access denied')) {
    code = ERROR_CODES.KEEPER_PERMISSION_DENIED;
  } else if (lowerMessage.includes('queue') || lowerMessage.includes('capacity')) {
    code = ERROR_CODES.KEEPER_QUEUE_FULL;
  } else if (lowerMessage.includes('timeout')) {
    code = ERROR_CODES.KEEPER_TIMEOUT;
  } else if (lowerMessage.includes('connection') || lowerMessage.includes('connect')) {
    code = ERROR_CODES.KEEPER_CONNECTION_FAILED;
  }
  
  return errorResponse(code, message);
}

/**
 * Create an EPM-specific error response (Endpoint Privilege Manager)
 * @param {string} type - 'approved', 'denied', or 'expired'
 * @param {string} message - Optional custom message
 * @returns {Object} Structured EPM error response
 */
function epmError(type, message = null) {
  const codeMap = {
    approved: ERROR_CODES.EPM_ALREADY_APPROVED,
    denied: ERROR_CODES.EPM_ALREADY_DENIED,
    expired: ERROR_CODES.EPM_EXPIRED
  };
  
  const messageMap = {
    approved: 'This approval request has already been approved',
    denied: 'This approval request has already been denied',
    expired: 'This approval request has expired and can no longer be processed'
  };
  
  const code = codeMap[type] || ERROR_CODES.INTERNAL_ERROR;
  const defaultMessage = messageMap[type] || 'Unknown EPM error';
  
  return errorResponse(code, message || defaultMessage);
}

/**
 * Wrap an async resolver function with structured error handling
 * Catches any thrown errors and converts them to structured error responses
 * 
 * @param {Function} resolverFn - The resolver function to wrap
 * @param {string} resolverName - Name of the resolver for logging
 * @returns {Function} Wrapped resolver function
 */
function withErrorHandling(resolverFn, resolverName) {
  return async (req) => {
    try {
      const result = await resolverFn(req);
      
      // If result is already a structured response, return as-is
      if (result && typeof result === 'object' && 'success' in result) {
        return result;
      }
      
      // Wrap non-structured results
      return successResponse(result);
    } catch (error) {
      // Log the error for debugging
      logger.error(`Resolver ${resolverName} failed`, {
        resolver: resolverName,
        error: error.message,
        stack: error.stack
      });
      
      // Convert thrown error to structured response
      return errorFromException(error);
    }
  };
}

/**
 * Convert an exception/thrown error to a structured error response
 * @param {Error} error - The caught error
 * @returns {Object} Structured error response
 */
function errorFromException(error) {
  const message = error.message || 'An unexpected error occurred';
  const lowerMessage = message.toLowerCase();
  
  // Detect error type from message
  if (lowerMessage.includes('approval request has already been approved')) {
    return epmError('approved', message);
  }
  if (lowerMessage.includes('approval request has already been denied')) {
    return epmError('denied', message);
  }
  if (lowerMessage.includes('expired')) {
    return epmError('expired', message);
  }
  if (lowerMessage.includes('rate limit')) {
    return errorResponse(ERROR_CODES.RATE_LIMIT_EXCEEDED, message);
  }
  if (lowerMessage.includes('not configured')) {
    return errorResponse(ERROR_CODES.AUTH_NOT_CONFIGURED, message);
  }
  if (lowerMessage.includes('permission') || lowerMessage.includes('not authorized')) {
    return errorResponse(ERROR_CODES.AUTH_PERMISSION_DENIED, message);
  }
  if (lowerMessage.includes('required')) {
    return errorResponse(ERROR_CODES.VALIDATION_REQUIRED_FIELD, message);
  }
  if (lowerMessage.includes('invalid')) {
    return errorResponse(ERROR_CODES.VALIDATION_INVALID_FORMAT, message);
  }
  
  // Default to internal error
  return errorResponse(ERROR_CODES.INTERNAL_ERROR, message);
}

// ========================================================================
// Module Exports
// ========================================================================

module.exports = {
  ERROR_CODES,
  TROUBLESHOOTING,
  successResponse,
  errorResponse,
  validationError,
  rateLimitError,
  connectionError,
  keeperError,
  epmError,
  withErrorHandling,
  errorFromException
};
