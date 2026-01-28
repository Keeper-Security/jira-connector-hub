/**
 * Simple Logger Utility
 * 
 * Lightweight logging with log levels for Forge apps.
 * Includes automatic redaction of sensitive data.
 * 
 * Usage:
 *   import { logger } from './utils/logger.js';
 *   
 *   logger.info('Message');
 *   logger.info('Message with data', { key: 'value' });
 *   logger.error('Failed', { error: error.message });
 * 
 * View logs with: forge logs --verbose --grouped
 */

// === CONFIGURATION ===
const LOG_LEVELS = { DEBUG: 0, INFO: 1, WARN: 2, ERROR: 3 };

const config = {
  // Default log level (change to DEBUG for more verbose logging)
  level: LOG_LEVELS.INFO,
  // Sensitive field names to redact
  sensitiveKeys: ['apiKey', 'api_key', 'password', 'token', 'secret', 'authorization'],
};

// === SANITIZATION ===
/**
 * Check if a key contains sensitive information
 * @param {string} key - Key name to check
 * @returns {boolean} - True if key is sensitive
 */
const isSensitiveKey = (key) =>
  config.sensitiveKeys.some(k => key.toLowerCase().includes(k));

/**
 * Sanitize data for logging (redact sensitive fields)
 * @param {*} data - Data to sanitize
 * @returns {*} - Sanitized data
 */
const sanitize = (data) => {
  if (!data || typeof data !== 'object') return data;
  if (Array.isArray(data)) return data.map(sanitize);
  
  return Object.fromEntries(
    Object.entries(data).map(([key, value]) => [
      key,
      isSensitiveKey(key) ? '[REDACTED]' : sanitize(value)
    ])
  );
};

// === FORMATTING ===
/**
 * Format data for log output
 * @param {*} data - Data to format
 * @returns {string} - Formatted string
 */
const formatData = (data) =>
  data !== undefined ? JSON.stringify(sanitize(data)) : '';

// === LOG METHOD FACTORY ===
/**
 * Create a log method for a specific level
 * @param {number} level - Log level threshold
 * @param {Function} consoleFn - Console function to use
 * @returns {Function} - Log method
 */
const createLogMethod = (level, consoleFn) => (message, data) => {
  if (config.level <= level) {
    consoleFn(message, formatData(data));
  }
};

// === LOGGER ===
const logger = {
  debug: createLogMethod(LOG_LEVELS.DEBUG, console.debug),
  info: createLogMethod(LOG_LEVELS.INFO, console.log),
  warn: createLogMethod(LOG_LEVELS.WARN, console.warn),
  error: createLogMethod(LOG_LEVELS.ERROR, console.error),
  
  // Allow runtime configuration
  setLevel: (level) => { config.level = LOG_LEVELS[level] ?? level; },
  addSensitiveKey: (key) => { config.sensitiveKeys.push(key); },
};

module.exports = { logger, LOG_LEVELS };
