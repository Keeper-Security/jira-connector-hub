// Centralized error handler for API calls
export const handleApiError = (error, defaultMessage = "An error occurred") => {
  // Helper function to check if content contains HTML
  const containsHtml = (text) => {
    if (typeof text !== 'string') return false;
    return /<\/?[a-z][\s\S]*>/i.test(text);
  };
  
  // Try to extract error message from various possible locations
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


