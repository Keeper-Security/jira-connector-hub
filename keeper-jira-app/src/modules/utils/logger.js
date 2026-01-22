/**
 * Structured Logging Utility
 * 
 * Provides structured JSON logging with log levels for better filtering
 * and searching in Forge Developer Console.
 * 
 * Issue #11: Structured Logging
 * 
 * Usage:
 *   import { logger, createContextLogger } from './utils/logger.js';
 *   
 *   // Simple logging
 *   logger.info('Message', { key: 'value' });
 *   
 *   // Context-aware logging
 *   const log = createContextLogger({ userId: '123', issueKey: 'PROJ-1' });
 *   log.info('Processing request');
 * 
 * View logs with: forge logs --verbose --grouped
 */

// ============================================================================
// Configuration
// ============================================================================

const LOG_CONFIG = {
  // Application identifier for filtering
  appName: 'keeper-jira-app',
  
  // Log level thresholds (lower = more verbose)
  levels: {
    DEBUG: 0,
    INFO: 1,
    WARN: 2,
    ERROR: 3,
  },
  
  // Minimum log level to output (can be adjusted for production)
  minLevel: 'DEBUG',
  
  // Maximum length for data fields to prevent huge logs
  maxDataLength: 1000,
};

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Get current timestamp in ISO format
 * @returns {string}
 */
function getTimestamp() {
  return new Date().toISOString();
}

/**
 * Truncate long strings to prevent log bloat
 * @param {*} value - Value to truncate
 * @param {number} maxLength - Maximum length
 * @returns {*}
 */
function truncateValue(value, maxLength = LOG_CONFIG.maxDataLength) {
  if (typeof value === 'string' && value.length > maxLength) {
    return value.substring(0, maxLength) + '...[truncated]';
  }
  return value;
}

/**
 * Sanitize data for logging (remove sensitive info, truncate large values)
 * @param {Object} data - Data to sanitize
 * @returns {Object}
 */
function sanitizeLogData(data) {
  if (!data || typeof data !== 'object') return data;
  
  const sanitized = {};
  const sensitiveKeys = ['apiKey', 'api_key', 'password', 'token', 'secret', 'authorization'];
  
  for (const [key, value] of Object.entries(data)) {
    // Redact sensitive fields
    if (sensitiveKeys.some(k => key.toLowerCase().includes(k))) {
      sanitized[key] = '[REDACTED]';
    }
    // Handle nested objects
    else if (value && typeof value === 'object' && !Array.isArray(value)) {
      sanitized[key] = sanitizeLogData(value);
    }
    // Handle arrays
    else if (Array.isArray(value)) {
      sanitized[key] = value.length > 10 
        ? `[Array(${value.length})]` 
        : value.map(v => typeof v === 'object' ? sanitizeLogData(v) : truncateValue(v));
    }
    // Truncate long strings
    else {
      sanitized[key] = truncateValue(value);
    }
  }
  
  return sanitized;
}

/**
 * Check if a log level should be output
 * @param {string} level - Log level to check
 * @returns {boolean}
 */
function shouldLog(level) {
  return LOG_CONFIG.levels[level] >= LOG_CONFIG.levels[LOG_CONFIG.minLevel];
}

/**
 * Format error object for logging
 * @param {Error} error - Error object
 * @returns {Object}
 */
function formatError(error) {
  if (!error) return null;
  
  return {
    message: error.message,
    name: error.name,
    stack: error.stack?.split('\n').slice(0, 5).join('\n'), // First 5 stack frames
  };
}

// ============================================================================
// Core Logging Functions
// ============================================================================

/**
 * Create a structured log entry
 * @param {string} level - Log level (DEBUG, INFO, WARN, ERROR)
 * @param {string} message - Log message
 * @param {Object} context - Context data (userId, issueKey, etc.)
 * @param {Object} data - Additional data to log
 * @returns {Object} - Structured log entry
 */
function createLogEntry(level, message, context = {}, data = {}) {
  return {
    timestamp: getTimestamp(),
    level,
    app: LOG_CONFIG.appName,
    message,
    ...context,
    ...(Object.keys(data).length > 0 ? { data: sanitizeLogData(data) } : {}),
  };
}

/**
 * Output a log entry
 * @param {string} level - Log level
 * @param {string} message - Log message
 * @param {Object} context - Context data
 * @param {Object} data - Additional data
 */
function log(level, message, context = {}, data = {}) {
  if (!shouldLog(level)) return;
  
  const entry = createLogEntry(level, message, context, data);
  const jsonEntry = JSON.stringify(entry);
  
  switch (level) {
    case 'ERROR':
      console.error(jsonEntry);
      break;
    case 'WARN':
      console.warn(jsonEntry);
      break;
    case 'DEBUG':
      console.debug?.(jsonEntry) || console.log(jsonEntry);
      break;
    default:
      console.log(jsonEntry);
  }
}

// ============================================================================
// Public Logger API
// ============================================================================

/**
 * Main logger object with methods for each log level
 */
const logger = {
  /**
   * Log debug message
   * @param {string} message - Log message
   * @param {Object} data - Additional data
   */
  debug(message, data = {}) {
    log('DEBUG', message, {}, data);
  },
  
  /**
   * Log info message
   * @param {string} message - Log message
   * @param {Object} data - Additional data
   */
  info(message, data = {}) {
    log('INFO', message, {}, data);
  },
  
  /**
   * Log warning message
   * @param {string} message - Log message
   * @param {Object} data - Additional data
   */
  warn(message, data = {}) {
    log('WARN', message, {}, data);
  },
  
  /**
   * Log error message
   * @param {string} message - Log message
   * @param {Error|Object} errorOrData - Error object or additional data
   */
  error(message, errorOrData = {}) {
    const data = errorOrData instanceof Error 
      ? { error: formatError(errorOrData) }
      : errorOrData;
    log('ERROR', message, {}, data);
  },
};

/**
 * Create a context-aware logger that includes context in all log entries
 * 
 * @param {Object} context - Context to include in all logs
 * @param {string} context.userId - User account ID
 * @param {string} context.issueKey - Jira issue key
 * @param {string} context.requestId - Request/operation ID
 * @param {string} context.operation - Operation name
 * @returns {Object} - Logger with context bound
 * 
 * @example
 * const log = createContextLogger({ userId: 'abc123', issueKey: 'PROJ-1' });
 * log.info('Processing started');
 * log.error('Processing failed', new Error('timeout'));
 */
function createContextLogger(context = {}) {
  return {
    debug(message, data = {}) {
      log('DEBUG', message, context, data);
    },
    
    info(message, data = {}) {
      log('INFO', message, context, data);
    },
    
    warn(message, data = {}) {
      log('WARN', message, context, data);
    },
    
    error(message, errorOrData = {}) {
      const data = errorOrData instanceof Error 
        ? { error: formatError(errorOrData) }
        : errorOrData;
      log('ERROR', message, context, data);
    },
    
    /**
     * Create a child logger with additional context
     * @param {Object} additionalContext - Additional context to merge
     * @returns {Object} - New logger with merged context
     */
    child(additionalContext = {}) {
      return createContextLogger({ ...context, ...additionalContext });
    },
  };
}

/**
 * Log operation timing (useful for performance monitoring)
 * 
 * @param {string} operation - Operation name
 * @param {Function} fn - Async function to time
 * @param {Object} context - Context for logging
 * @returns {Promise<*>} - Result of the function
 * 
 * @example
 * const result = await logTiming('fetchRecords', async () => {
 *   return await api.getRecords();
 * }, { userId: 'abc123' });
 */
async function logTiming(operation, fn, context = {}) {
  const startTime = Date.now();
  const log = createContextLogger({ ...context, operation });
  
  log.debug('Operation started');
  
  try {
    const result = await fn();
    const duration = Date.now() - startTime;
    log.info('Operation completed', { durationMs: duration });
    return result;
  } catch (error) {
    const duration = Date.now() - startTime;
    log.error('Operation failed', { 
      error: formatError(error),
      durationMs: duration 
    });
    throw error;
  }
}

/**
 * Create a request logger for resolver functions
 * Automatically extracts context from Forge request object
 * 
 * @param {Object} req - Forge resolver request object
 * @param {string} resolverName - Name of the resolver
 * @returns {Object} - Context-aware logger
 * 
 * @example
 * resolver.define('myResolver', async (req) => {
 *   const log = createResolverLogger(req, 'myResolver');
 *   log.info('Resolver started');
 * });
 */
function createResolverLogger(req, resolverName) {
  const context = {
    resolver: resolverName,
    userId: req?.context?.accountId || 'unknown',
    issueKey: req?.context?.extension?.issue?.key || req?.payload?.issueKey || null,
    projectKey: req?.context?.extension?.project?.key || req?.payload?.projectKey || null,
  };
  
  // Remove null values
  Object.keys(context).forEach(key => {
    if (context[key] === null) delete context[key];
  });
  
  return createContextLogger(context);
}

/**
 * Create a webhook logger for web trigger handlers
 * 
 * @param {Object} request - Incoming webhook request
 * @param {string} sourceId - Source identifier
 * @returns {Object} - Context-aware logger
 */
function createWebhookLogger(request, sourceId) {
  return createContextLogger({
    handler: 'webTrigger',
    sourceId,
    method: request?.method || 'POST',
  });
}

// ============================================================================
// Module Exports
// ============================================================================

module.exports = {
  logger,
  createContextLogger,
  logTiming,
  createResolverLogger,
  createWebhookLogger
};
