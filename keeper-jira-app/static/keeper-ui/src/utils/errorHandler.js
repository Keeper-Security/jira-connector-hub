/**
 * Utility functions for handling API errors
 */

/**
 * Check if content contains HTML
 * @param {*} text - Text to check
 * @returns {boolean} - True if text contains HTML
 */
const containsHtml = (text) => {
  if (typeof text !== 'string') return false;
  return /<\/?[a-z][\s\S]*>/i.test(text);
};

/**
 * Centralized error handler for API calls
 * @param {Object} error - Error object
 * @param {string} defaultMessage - Default error message
 * @param {boolean} isAdmin - Whether user is admin
 * @returns {string} - Formatted error message
 */
export const handleApiError = (error, defaultMessage = "An error occurred", isAdmin = false) => {
  // Try to extract error message from various possible locations
  let errorMessage = '';
  
  // Check error.error - skip if it contains HTML
  if (error.error && !containsHtml(error.error)) {
    errorMessage = error.error;
  }
  
  // Check error.message - skip if it contains HTML
  if (!errorMessage && error.message && !containsHtml(error.message)) {
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
  
  // Otherwise, check for HTTP error codes and provide connection guidance
  let errorStatus = error.status || error.statusCode;
  
  if (!errorStatus && error.message) {
    // Try to extract status code from error message
    const statusMatch = error.message.match(/\b(401|403|400|500|502|503|504)\b/);
    if (statusMatch) {
      errorStatus = parseInt(statusMatch[1], 10);
    }
  }
  
  // Handle specific error codes with connection configuration messages
  if (errorStatus === 401 || errorStatus === 403 || errorStatus === 400 || 
      errorStatus === 500 || errorStatus === 502 || errorStatus === 503 || errorStatus === 504) {
    const statusText = errorStatus === 401 ? 'Unauthorized (401)' :
                      errorStatus === 403 ? 'Forbidden (403)' :
                      errorStatus === 400 ? 'Bad Request (400)' :
                      errorStatus === 500 ? 'Internal Server Error (500)' :
                      errorStatus === 502 ? 'Bad Gateway (502)' :
                      errorStatus === 503 ? 'Service Unavailable (503)' :
                      errorStatus === 504 ? 'Gateway Timeout (504)' :
                      `Error (${errorStatus})`;
    
    if (isAdmin) {
      return `${statusText}: Please check your API URL and tunnel configuration. Ensure the tunnel is active and the URL is correctly configured in the app settings.`;
    } else {
      return `${statusText}: Unable to connect to the server. Please ask your administrator to check the tunnel configuration and ensure the Keeper Commander service is running properly.`;
    }
  }
  
  return errorMessage;
};

/**
 * Get detailed error context for connection test failures
 * @param {string} errorMessage - Error message
 * @returns {string} - Enhanced error message with context
 */
export const getConnectionErrorContext = (errorMessage, error) => {
  // Add more context for specific error scenarios (if not already handled by handleApiError)
  // These provide additional details beyond the HTTP status code messages
  if (!error.status && !error.statusCode) {
    // Only add detailed context if we don't have a status code (already handled by handleApiError)
    if (errorMessage.includes('ERR_NGROK_3200') || errorMessage.includes('ngrok') || errorMessage.includes('cloudflare') || errorMessage.includes('tunnel') || errorMessage.includes('offline')) {
      return `Tunnel connection is offline: ${errorMessage}. Please start your tunnel (ngrok/Cloudflare) and ensure the Keeper Commander service is running.`;
    } else if (errorMessage.includes('fetch')) {
      return `Network error: ${errorMessage}. Please check your API URL and ensure the Keeper Commander service is running.`;
    } else if (errorMessage.includes('404')) {
      return `Service not found: ${errorMessage}. Please check your API URL and ensure the Keeper Commander service is accessible.`;
    } else if (errorMessage.includes('timeout')) {
      return `Connection timeout: ${errorMessage}. The service may be slow to respond or unavailable.`;
    } else if (errorMessage.includes('<!DOCTYPE html>') || errorMessage.includes('<html')) {
      return `Received HTML response instead of JSON. This usually means the service is not running or the URL is incorrect. Please check your API URL and ensure the Keeper Commander service is running.`;
    }
  }
  
  return errorMessage;
};

