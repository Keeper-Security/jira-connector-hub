/**
 * Centralized error handler for API calls
 * 
 * Supports both:
 * 1. Structured error responses: { success: false, error: 'CODE', message: '...', troubleshooting: [...] }
 * 2. Legacy thrown errors (for backward compatibility)
 */

// Helper function to check if content contains HTML
const containsHtml = (text) => {
  if (typeof text !== 'string') return false;
  return /<\/?[a-z][\s\S]*>/i.test(text);
};

/**
 * Check if a result is a structured error response
 * @param {Object} result - API result
 * @returns {boolean} - True if structured error
 */
export const isStructuredError = (result) => {
  return result && typeof result === 'object' && result.success === false && result.error;
};

/**
 * Format troubleshooting steps for display
 * @param {Array<string>} steps - Troubleshooting steps
 * @returns {string} - Formatted string
 */
export const formatTroubleshooting = (steps) => {
  if (!steps || !Array.isArray(steps) || steps.length === 0) {
    return '';
  }
  return '\n\nTroubleshooting:\n• ' + steps.join('\n• ');
};

/**
 * Get the error code from a structured error
 * @param {Object} error - Error object
 * @returns {string|null} - Error code or null
 */
export const getErrorCode = (error) => {
  if (isStructuredError(error)) {
    return error.error;
  }
  return null;
};

/**
 * Centralized error handler for API calls
 * @param {Object} error - Error object or structured error response
 * @param {string} defaultMessage - Default error message
 * @returns {string} - Formatted error message
 */
export const handleApiError = (error, defaultMessage = "An error occurred") => {
  // Handle structured error responses (new pattern)
  if (isStructuredError(error)) {
    let message = error.message || defaultMessage;
    
    // Include troubleshooting steps if available
    if (error.troubleshooting && error.troubleshooting.length > 0) {
      message += formatTroubleshooting(error.troubleshooting);
    }
    
    return message;
  }
  
  // Legacy error handling for thrown errors
  let errorMessage = '';
  
  // Check if error is a string - skip if it contains HTML
  if (typeof error === 'string' && !containsHtml(error)) {
    errorMessage = error;
  } 
  // Check error.error - skip if it contains HTML
  else if (error.error && !containsHtml(error.error)) {
    errorMessage = error.error;
  }
  // Check error.message - skip if it contains HTML
  else if (error.message && !containsHtml(error.message)) {
    errorMessage = error.message;
  }
  
  // If no valid message found (or all contained HTML), use default
  if (!errorMessage || errorMessage.trim().length === 0) {
    errorMessage = defaultMessage;
  }
  
  // If message is too long (likely an error dump), use default message
  if (errorMessage.length > 500) {
    errorMessage = defaultMessage;
  }
  
  // If we have a valid error message, use it
  if (errorMessage && errorMessage !== defaultMessage && errorMessage.trim().length > 0) {
    return errorMessage;
  }
  
  // Otherwise, check for HTTP error codes and provide ngrok-related guidance
  let errorStatus = error.status || error.statusCode;
  
  if (!errorStatus && error.message) {
    // Try to extract status code from error message
    const statusMatch = error.message.match(/\b(401|403|400|500|502|503|504)\b/);
    if (statusMatch) {
      errorStatus = parseInt(statusMatch[1], 10);
    }
  }
  
  // Handle specific error codes with ngrok configuration messages
  if (errorStatus === 401 || errorStatus === 403 || errorStatus === 400 || 
      errorStatus === 500 || errorStatus === 502 || errorStatus === 503 || errorStatus === 504) {
    const statusText = errorStatus === 401 ? 'Unauthorized (401)' :
                      errorStatus === 403 ? 'Forbidden (403)' :
                      errorStatus === 400 ? 'Bad Request (400)' :
                      errorStatus === 500 ? 'Internal Server Error (500)' :
                      errorStatus === 502 ? 'Bad Gateway (502)' :
                      errorStatus === 503 ? 'Service Unavailable (503)' :
                      'Gateway Timeout (504)';
                      
    return `${statusText} - Unable to connect to Keeper service. Please verify that:\n\n` +
           `1. Your tunneling service (ngrok/Cloudflare) is running\n` +
           `2. The Keeper Commander service is active\n` +
           `3. The API URL in global settings is correct\n` +
           `4. Your tunnel authentication is valid`;
  }
  
  // Default error message
  return defaultMessage;
};


