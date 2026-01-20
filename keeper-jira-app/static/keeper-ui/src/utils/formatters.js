/**
 * Utility functions for formatting data
 */

/**
 * Format date to readable string
 * @param {string|Date} date - Date to format
 * @returns {string} - Formatted date string
 */
export const formatDate = (date) => {
  if (!date) return 'N/A';
  const d = new Date(date);
  if (isNaN(d.getTime())) return 'Invalid Date';
  
  return d.toLocaleString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  });
};

/**
 * Format time remaining
 * @param {Date} expirationDate - Expiration date
 * @param {Date} currentTime - Current time
 * @returns {string} - Formatted time remaining
 */
export const formatTimeRemaining = (expirationDate, currentTime) => {
  if (!expirationDate) return 'No expiration';
  
  const expiration = new Date(expirationDate);
  if (isNaN(expiration.getTime())) return 'Invalid date';
  
  const diff = expiration - currentTime;
  
  if (diff <= 0) return 'Expired';
  
  const days = Math.floor(diff / (1000 * 60 * 60 * 24));
  const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
  const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
  
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
};

/**
 * Check if date is expired
 * @param {Date} expirationDate - Expiration date
 * @param {Date} currentTime - Current time
 * @returns {boolean} - True if expired
 */
export const isExpired = (expirationDate, currentTime) => {
  if (!expirationDate) return false;
  const expiration = new Date(expirationDate);
  if (isNaN(expiration.getTime())) return false;
  return expiration <= currentTime;
};

/**
 * Mask sensitive data (API keys, passwords, etc.)
 * @param {string} value - Value to mask
 * @param {number} visibleChars - Number of characters to show at start and end
 * @returns {string} - Masked value
 */
export const maskSensitiveData = (value, visibleChars = 4) => {
  if (!value || value.length <= visibleChars * 2) return value;
  const start = value.substring(0, visibleChars);
  const end = value.substring(value.length - visibleChars);
  return `${start}${'*'.repeat(value.length - visibleChars * 2)}${end}`;
};

/**
 * Truncate long text
 * @param {string} text - Text to truncate
 * @param {number} maxLength - Maximum length
 * @returns {string} - Truncated text
 */
export const truncateText = (text, maxLength = 50) => {
  if (!text || text.length <= maxLength) return text;
  return `${text.substring(0, maxLength)}...`;
};

