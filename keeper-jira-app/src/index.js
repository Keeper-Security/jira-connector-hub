import Resolver from '@forge/resolver';
import { storage, webTrigger } from '@forge/api';
import { webTriggerHandler, generateWebhookToken } from './modules/webhookHandler.js';
import { testKeeperConnection, executeKeeperCommand as executeKeeperApiCommand, getRateLimitStatus } from './modules/keeperApi.js';
import { requestJiraAsAppWithRetry, requestJiraAsUserWithRetry, route } from './modules/utils/jiraApiRetry.js';
import { logger } from './modules/utils/logger.js';
import { 
  ERROR_CODES, 
  successResponse, 
  errorResponse, 
  validationError, 
  rateLimitError, 
  connectionError, 
  keeperError, 
  epmError 
} from './modules/utils/errorResponse.js';

const resolver = new Resolver();

// ============================================================================
// API URL Validation Configuration (Issue #8: Overly Broad Fetch Permissions)
// ============================================================================

/**
 * Known tunnel URL patterns that match the default manifest.yml external fetch permissions.
 * These patterns help identify common tunnel services and provide appropriate warnings.
 * 
 * Note: For per-customer deployments, customers may add custom domains to their manifest.yml.
 * Custom domains are allowed but will show a reminder to verify manifest configuration.
 */
const KNOWN_TUNNEL_PATTERNS = [
  // Ngrok tunnels (default in manifest)
  { 
    pattern: /^https:\/\/[a-z0-9-]+\.ngrok-free\.app$/i,
    name: 'ngrok-free.app',
    isFree: true,
    isDefaultManifest: true,
    warning: 'Free ngrok URLs change on each restart. Consider a custom domain for production use.'
  },
  { 
    pattern: /^https:\/\/[a-z0-9-]+\.ngrok\.io$/i,
    name: 'ngrok.io',
    isFree: false,
    isDefaultManifest: true
  },
  { 
    pattern: /^https:\/\/[a-z0-9-]+\.ngrok\.app$/i,
    name: 'ngrok.app',
    isFree: false,
    isDefaultManifest: true
  },
  // Cloudflare tunnels (default in manifest)
  { 
    pattern: /^https:\/\/[a-z0-9-]+\.trycloudflare\.com$/i,
    name: 'trycloudflare.com',
    isFree: true,
    isDefaultManifest: true,
    warning: 'Free Cloudflare tunnel URLs are temporary. Configure a custom domain for production.'
  },
  { 
    pattern: /^https:\/\/[a-z0-9-]+\.cloudflareaccess\.com$/i,
    name: 'cloudflareaccess.com',
    isFree: false,
    isDefaultManifest: true
  },
  { 
    pattern: /^https:\/\/[a-z0-9-]+\.cfargotunnel\.com$/i,
    name: 'cfargotunnel.com',
    isFree: false,
    isDefaultManifest: true
  },
  // Localhost for development (only http, not https)
  { 
    pattern: /^http:\/\/localhost(:\d+)?$/i,
    name: 'localhost',
    isFree: true,
    isDev: true,
    warning: 'localhost URLs only work during local development.'
  }
];

/**
 * Validate API URL format and check against known tunnel patterns
 * 
 * For per-customer deployments, custom domains are allowed but will show a reminder
 * to verify the manifest.yml is configured correctly.
 * 
 * @param {string} url - The API URL to validate
 * @returns {Object} - { valid: boolean, error?: string, warning?: string, matchedPattern?: Object, isCustomDomain?: boolean }
 */
function validateApiUrl(url) {
  // Check if URL is provided
  if (!url || typeof url !== 'string') {
    return { 
      valid: false, 
      error: 'API URL is required' 
    };
  }
  
  // Trim and normalize
  const trimmedUrl = url.trim();
  
  // Check for empty string
  if (!trimmedUrl) {
    return { 
      valid: false, 
      error: 'API URL cannot be empty' 
    };
  }
  
  // Validate URL format
  let parsedUrl;
  try {
    parsedUrl = new URL(trimmedUrl);
  } catch (e) {
    return { 
      valid: false, 
      error: 'Invalid URL format. URL must be a valid HTTPS URL (e.g., https://your-tunnel.ngrok-free.app or https://keeper.your-company.com)' 
    };
  }
  
  // Check protocol (must be https, except localhost)
  const isLocalhost = parsedUrl.hostname === 'localhost' || parsedUrl.hostname === '127.0.0.1';
  if (!isLocalhost && parsedUrl.protocol !== 'https:') {
    return { 
      valid: false, 
      error: 'API URL must use HTTPS protocol for security (except localhost for development)' 
    };
  }
  
  // Validate hostname format (basic security check)
  const hostname = parsedUrl.hostname;
  
  // Block obviously suspicious patterns
  if (hostname.includes('..') || hostname.startsWith('-') || hostname.endsWith('-')) {
    return {
      valid: false,
      error: 'Invalid hostname format in URL'
    };
  }
  
  // Block IP addresses (except localhost) - require proper domain names
  const ipv4Pattern = /^(\d{1,3}\.){3}\d{1,3}$/;
  if (ipv4Pattern.test(hostname) && hostname !== '127.0.0.1') {
    return {
      valid: false,
      error: 'Direct IP addresses are not allowed. Please use a domain name or tunnel URL.'
    };
  }
  
  // Remove trailing slash for consistent matching
  const normalizedUrl = trimmedUrl.replace(/\/+$/, '');
  
  // Extract origin (protocol + hostname + port) for pattern matching
  // This allows URLs with paths like /api/v2 to still validate against the domain pattern
  const originUrl = parsedUrl.origin;
  
  // Check against known tunnel patterns (match against origin, not full URL)
  for (const tunnelPattern of KNOWN_TUNNEL_PATTERNS) {
    if (tunnelPattern.pattern.test(originUrl)) {
      const result = { 
        valid: true, 
        normalizedUrl,
        matchedPattern: tunnelPattern,
        isCustomDomain: false
      };
      
      // Add warning for free-tier or development URLs
      if (tunnelPattern.warning) {
        result.warning = tunnelPattern.warning;
      }
      
      return result;
    }
  }
  
  // URL doesn't match known patterns - allow as custom domain with informational message
  // This supports per-customer deployments where customers add their own domains to manifest.yml
  return { 
    valid: true,
    normalizedUrl,
    isCustomDomain: true,
    warning: `Custom domain detected (${hostname}). Ensure this domain is added to your manifest.yml external fetch permissions before deploying. Connection test will verify the URL is accessible.`
  };
}

/**
 * Test if the API URL is reachable and responds correctly
 * This helps prevent saving misconfigured or malicious URLs
 * @param {string} apiUrl - The API URL to test
 * @param {string} apiKey - The API key for authentication
 * @returns {Object} - { reachable: boolean, error?: string }
 */
async function testApiUrlReachability(apiUrl, apiKey) {
  try {
    // Use the existing connection test function
    const result = await testKeeperConnection(apiUrl, apiKey);
    
    // Check if the response indicates a valid Keeper Commander API
    const serviceMessage = result.data?.message || '';
    const isValidKeeperApi = serviceMessage.toLowerCase().includes('running') || 
                            serviceMessage.toLowerCase().includes('keeper') ||
                            result.success === true;
    
    if (!isValidKeeperApi) {
      return {
        reachable: false,
        error: 'URL is reachable but does not appear to be a valid Keeper Commander API. Verify the tunnel is pointing to your Keeper Commander service.'
      };
    }
    
    return { reachable: true };
  } catch (error) {
    // Parse the error message to provide helpful feedback
    const errorMessage = error.message || 'Unknown error';
    
    if (errorMessage.includes('fetch') || errorMessage.includes('network')) {
      return {
        reachable: false,
        error: `Cannot connect to URL: ${errorMessage}. Verify the tunnel is running and the URL is correct.`
      };
    }
    
    if (errorMessage.includes('401') || errorMessage.includes('Unauthorized')) {
      // URL is reachable but auth failed - this is actually a valid Keeper API
      return {
        reachable: true,
        warning: 'URL is reachable but authentication failed. Verify your API key is correct.'
      };
    }
    
    return {
      reachable: false,
      error: `Connection test failed: ${errorMessage}`
    };
  }
}

/**
 * Helper function to get current user information
 * Reusable across all resolvers to avoid code duplication
 */
async function getCurrentUser() {
  try {
    const response = await requestJiraAsUserWithRetry(
      route`/rest/api/3/myself`,
      {
        method: 'GET',
        headers: { 'Accept': 'application/json' }
      },
      'Get current user'
    );
    
    if (response.ok) {
      return await response.json();
    } else {
      logger.error('Failed to fetch current user info', { status: response.status });
      return null;
    }
  } catch (error) {
    logger.error('Error fetching current user info', error);
    return null;
  }
}

/**
 * Get Keeper config (called from frontend)
 */
resolver.define('getConfig', async () => {
  const config = await storage.get('keeperConfig');
  return config || {};
});

/**
 * Save Keeper config (called from frontend)
 * Includes URL validation to prevent saving malicious tunnel URLs (Issue #8)
 */
resolver.define('setConfig', async (req) => {
  // Handle double nesting: req.payload.payload
  let payload = req?.payload?.payload || req?.payload || req;
  
  logger.info('setConfig: Setting Keeper configuration');
  
  if (!payload) {
    return validationError('payload', 'No payload provided');
  }
  
  const apiUrl = payload.apiUrl;
  const apiKey = payload.apiKey;
  const skipConnectionTest = payload.skipConnectionTest || false;
  
  // ========================================================================
  // Security: URL Validation (Issue #8: Overly Broad Fetch Permissions)
  // Validates the URL matches allowed tunnel patterns before saving
  // ========================================================================
  
  // Validate API URL format and pattern
  const urlValidation = validateApiUrl(apiUrl);
  if (!urlValidation.valid) {
    return errorResponse(
      ERROR_CODES.VALIDATION_INVALID_URL, 
      `Invalid API URL: ${urlValidation.error}`,
      { field: 'apiUrl' }
    );
  }
  
  // Log warning for free-tier URLs
  if (urlValidation.warning) {
    logger.warn('URL validation warning', { warning: urlValidation.warning });
  }
  
  // Validate API key is provided
  if (!apiKey || typeof apiKey !== 'string' || !apiKey.trim()) {
    return validationError('apiKey', 'API Key is required');
  }
  
  // Use the normalized URL (trailing slashes removed)
  const normalizedApiUrl = urlValidation.normalizedUrl;
  
  // ========================================================================
  // Security: Connection Test (prevents saving URLs that don't work)
  // ========================================================================
  
  let connectionWarning = null;
  
  if (!skipConnectionTest) {
    const reachabilityTest = await testApiUrlReachability(normalizedApiUrl, apiKey);
    
    if (!reachabilityTest.reachable) {
      return connectionError(`Connection test failed: ${reachabilityTest.error}`);
    }
    
    if (reachabilityTest.warning) {
      connectionWarning = reachabilityTest.warning;
    }
  }
  
  // Save the validated and normalized config
  const configToSave = { 
    apiUrl: normalizedApiUrl, 
    apiKey: apiKey.trim() 
  };
  
  await storage.set('keeperConfig', configToSave);
  
  // Build response with any warnings
  const response = { 
    success: true, 
    message: 'Configuration saved successfully' 
  };
  
  // Include warnings in response for UI to display
  const warnings = [];
  if (urlValidation.warning) {
    warnings.push(urlValidation.warning);
  }
  if (connectionWarning) {
    warnings.push(connectionWarning);
  }
  if (warnings.length > 0) {
    response.warnings = warnings;
  }
  
  return response;
});

/**
 * Test Keeper connection (called from frontend)
 * Uses API v2 async queue mode
 */
resolver.define('testConnection', async (req) => {
  // Handle double nesting: req.payload.payload
  let payload = req?.payload?.payload || req?.payload || req;
  
  if (!payload) {
    return validationError('payload', 'No payload provided');
  }
  
  const apiUrl = payload.apiUrl;
  const apiKey = payload.apiKey;
  
  if (!apiUrl || !apiKey) {
    return validationError('apiUrl', 'API URL and API Key are required for testing connection');
  }

  try {
    // Use the v2 API test connection function from keeperApi module
    const result = await testKeeperConnection(apiUrl, apiKey);

    // Extract service status information from the response
    const serviceMessage = result.data?.message || 'Service status unknown';
    const isRunning = serviceMessage.toLowerCase().includes('running');

    return successResponse({ 
      message: isRunning ? 'Connection test successful!' : 'Connection established but service may not be running properly',
      serviceStatus: serviceMessage,
      isServiceRunning: isRunning
    });
  } catch (err) {
    return connectionError(`Connection test failed: ${err.message}`, err);
  }
});

/**
 * Issue panel resolver - provides context and handles requests from issue panel
 */
resolver.define('getIssueContext', async (req) => {
  const { context } = req;
  
  const issueKey = context?.extension?.issue?.key;
  const projectKey = context?.extension?.project?.key;
  const currentUserAccountId = context?.accountId;
  
  // Get current config
  const config = await storage.get('keeperConfig');
  
  // Fetch issue labels to determine if this is a webhook-created ticket
  let labels = [];
  if (issueKey) {
    try {
      const issueResponse = await requestJiraAsAppWithRetry(
        route`/rest/api/3/issue/${issueKey}?fields=labels`,
        {
          method: 'GET',
          headers: { 'Accept': 'application/json' }
        },
        'Get issue labels'
      );
      
      if (issueResponse.ok) {
        const issueData = await issueResponse.json();
        labels = issueData.fields?.labels || [];
      }
    } catch (error) {
      logger.error('Failed to fetch issue labels', error);
      // Continue without labels if fetch fails
    }
  }
  
  // Fetch current user's email using helper function
  const currentUser = await getCurrentUser();
  const currentUserEmail = currentUser?.emailAddress || null;
  
  // Return simplified context - works with any project
  return {
    issueKey,
    projectKey,
    hasConfig: !!config,
    labels: labels,
    currentUserAccountId,
    currentUserEmail
  };
});

// ============================================================================
// Input Validation Module
// ============================================================================

/**
 * Field length limits to prevent memory exhaustion and buffer overflows
 * Based on reasonable maximums and industry standards
 */
const VALIDATION_LIMITS = {
  // Record fields
  title: { maxLength: 256, label: 'Title' },
  notes: { maxLength: 10000, label: 'Notes' },
  login: { maxLength: 254, label: 'Login/Username' },  // RFC 5321 email max
  password: { maxLength: 1024, label: 'Password' },
  url: { maxLength: 2048, label: 'URL' },  // Common browser limit
  email: { maxLength: 254, label: 'Email' },  // RFC 5321 SMTP max
  
  // Contact fields
  phone: { maxLength: 32, label: 'Phone Number' },
  phoneExt: { maxLength: 16, label: 'Phone Extension' },
  phoneRegion: { maxLength: 8, label: 'Phone Region' },
  
  // Address fields
  street: { maxLength: 256, label: 'Street Address' },
  city: { maxLength: 128, label: 'City' },
  state: { maxLength: 64, label: 'State/Province' },
  zip: { maxLength: 32, label: 'ZIP/Postal Code' },
  country: { maxLength: 64, label: 'Country' },
  
  // Name fields
  firstName: { maxLength: 64, label: 'First Name' },
  middleName: { maxLength: 64, label: 'Middle Name' },
  lastName: { maxLength: 64, label: 'Last Name' },
  
  // Identity fields
  recordUid: { maxLength: 64, label: 'Record UID' },  // Keeper UIDs are ~22 chars
  folderUid: { maxLength: 64, label: 'Folder UID' },
  recordType: { maxLength: 64, label: 'Record Type' },
  
  // Network fields
  hostName: { maxLength: 253, label: 'Hostname' },  // DNS FQDN max
  port: { maxLength: 5, label: 'Port' },  // Max port 65535
  
  // SSH fields
  privateKey: { maxLength: 16000, label: 'Private Key' },
  publicKey: { maxLength: 8000, label: 'Public Key' },
  passphrase: { maxLength: 1024, label: 'Passphrase' },
  
  // Sharing fields
  user: { maxLength: 1024, label: 'User' },  // Can be multiple comma-separated emails
  expiration: { maxLength: 64, label: 'Expiration' },
  
  // Custom fields
  customField: { maxLength: 1024, label: 'Custom Field' },
  
  // Generic fallback
  default: { maxLength: 1024, label: 'Field' },
};

/**
 * Validation patterns for format checking
 */
const VALIDATION_PATTERNS = {
  // Email: RFC 5322 simplified - allows most valid emails
  email: /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/,
  
  // URL: Basic validation for http/https URLs
  url: /^https?:\/\/[^\s<>"{}|\\^`[\]]+$/i,
  
  // Phone: International format, digits, spaces, dashes, parens, plus
  phone: /^[+]?[\d\s\-().]{1,30}$/,
  
  // Port: 1-65535
  port: /^([1-9]\d{0,3}|[1-5]\d{4}|6[0-4]\d{3}|65[0-4]\d{2}|655[0-2]\d|6553[0-5])$/,
  
  // UID: Alphanumeric with common UID characters
  uid: /^[a-zA-Z0-9_\-]{1,100}$/,
  
  // Hostname: Valid DNS hostname
  hostname: /^(?=.{1,253}$)(?:(?!-)[a-zA-Z0-9-]{1,63}(?<!-)\.)*(?!-)[a-zA-Z0-9-]{1,63}(?<!-)$/,
  
  // Record type: Alphanumeric with underscores, hyphens, dots
  recordType: /^[a-zA-Z][a-zA-Z0-9_.\-]{0,99}$/,
  
  // Date: ISO format YYYY-MM-DD or Unix timestamp
  date: /^(\d{4}-\d{2}-\d{2}|\d{10,13})$/,
  
  // Expiration duration: Number with time unit (e.g., 30d, 24h, 60m)
  duration: /^\d+[dhms]?$/i,
};

/**
 * Validate a single field value
 * @param {string} fieldName - Name of the field being validated
 * @param {*} value - Value to validate
 * @param {Object} options - Validation options
 * @returns {Object} - { valid: boolean, error?: string, sanitized?: string }
 */
function validateField(fieldName, value, options = {}) {
  // Skip validation for null/undefined (optional fields)
  if (value === null || value === undefined) {
    return { valid: true, sanitized: null };
  }
  
  // Convert to string for validation
  const strValue = String(value).trim();
  
  // Check if field is required
  if (options.required && strValue.length === 0) {
    return { valid: false, error: `${options.label || fieldName} is required` };
  }
  
  // Skip further validation for empty optional fields
  if (strValue.length === 0) {
    return { valid: true, sanitized: '' };
  }
  
  // Get length limit for this field type
  const limitKey = options.limitKey || fieldName;
  const limits = VALIDATION_LIMITS[limitKey] || VALIDATION_LIMITS.default;
  
  // Check length limit
  if (strValue.length > limits.maxLength) {
    return { 
      valid: false, 
      error: `${limits.label} exceeds maximum length of ${limits.maxLength} characters (provided: ${strValue.length})` 
    };
  }
  
  // Format validation for specific field types
  if (options.pattern) {
    const pattern = VALIDATION_PATTERNS[options.pattern];
    if (pattern && !pattern.test(strValue)) {
      return { 
        valid: false, 
        error: `${limits.label} has invalid format` 
      };
    }
  }
  
  // Check for dangerous control characters (except newlines in notes)
  const allowNewlines = options.allowNewlines || fieldName === 'notes';
  const controlCharPattern = allowNewlines ? /[\x00-\x08\x0b\x0c\x0e-\x1f]/ : /[\x00-\x1f]/;
  if (controlCharPattern.test(strValue)) {
    return { 
      valid: false, 
      error: `${limits.label} contains invalid control characters` 
    };
  }
  
  return { valid: true, sanitized: strValue };
}

/**
 * Validate email address with multiple emails support (comma-separated)
 * @param {string} emailString - Single email or comma-separated emails
 * @returns {Object} - { valid: boolean, error?: string, emails?: string[] }
 */
function validateEmails(emailString) {
  if (!emailString || typeof emailString !== 'string') {
    return { valid: false, error: 'Email address is required' };
  }
  
  const emails = emailString.split(',').map(e => e.trim()).filter(e => e);
  
  if (emails.length === 0) {
    return { valid: false, error: 'At least one email address is required' };
  }
  
  // Limit number of emails to prevent abuse
  if (emails.length > 50) {
    return { valid: false, error: 'Maximum 50 email addresses allowed per request' };
  }
  
  for (const email of emails) {
    // Check length
    if (email.length > VALIDATION_LIMITS.email.maxLength) {
      return { 
        valid: false, 
        error: `Email "${email.substring(0, 20)}..." exceeds maximum length of ${VALIDATION_LIMITS.email.maxLength} characters` 
      };
    }
    
    // Check format
    if (!VALIDATION_PATTERNS.email.test(email)) {
      return { 
        valid: false, 
        error: `Invalid email format: "${email.substring(0, 50)}${email.length > 50 ? '...' : ''}"` 
      };
    }
  }
  
  return { valid: true, emails };
}

/**
 * Validate phone entry object
 * @param {Object} phoneEntry - Phone entry with number, type, region, ext
 * @returns {Object} - { valid: boolean, error?: string }
 */
function validatePhoneEntry(phoneEntry) {
  if (!phoneEntry || typeof phoneEntry !== 'object') {
    return { valid: true }; // Optional
  }
  
  // Validate phone number
  if (phoneEntry.number) {
    const numberValidation = validateField('phone', phoneEntry.number, { 
      limitKey: 'phone', 
      pattern: 'phone' 
    });
    if (!numberValidation.valid) {
      return numberValidation;
    }
  }
  
  // Validate extension
  if (phoneEntry.ext) {
    const extValidation = validateField('ext', phoneEntry.ext, { limitKey: 'phoneExt' });
    if (!extValidation.valid) {
      return extValidation;
    }
  }
  
  // Validate region
  if (phoneEntry.region) {
    const regionValidation = validateField('region', phoneEntry.region, { limitKey: 'phoneRegion' });
    if (!regionValidation.valid) {
      return regionValidation;
    }
  }
  
  return { valid: true };
}

/**
 * Validate all parameters for a Keeper command
 * @param {string} action - The command action (record-add, record-update, etc.)
 * @param {Object} parameters - The parameters object
 * @returns {Object} - { valid: boolean, errors?: string[] }
 */
function validateCommandParameters(action, parameters) {
  const errors = [];
  
  // Skip validation for pre-formatted CLI commands
  if (parameters.cliCommand) {
    return { valid: true };
  }
  
  // Common validations based on action type
  switch (action) {
    case 'record-add':
    case 'record-update': {
      // Title validation
      if (action === 'record-add' && !parameters.title) {
        errors.push('Title is required for record-add');
      } else if (parameters.title) {
        const titleValidation = validateField('title', parameters.title, { 
          limitKey: 'title',
          required: action === 'record-add'
        });
        if (!titleValidation.valid) errors.push(titleValidation.error);
      }
      
      // Record UID validation (for record-update)
      if (action === 'record-update' && parameters.record) {
        const recordValidation = validateField('record', parameters.record, { 
          limitKey: 'recordUid',
          pattern: 'uid'
        });
        if (!recordValidation.valid) errors.push(recordValidation.error);
      }
      
      // Record type validation
      if (parameters.recordType) {
        const typeValidation = validateField('recordType', parameters.recordType, { 
          limitKey: 'recordType',
          pattern: 'recordType'
        });
        if (!typeValidation.valid) errors.push(typeValidation.error);
      }
      
      // Notes validation
      if (parameters.notes) {
        const notesValidation = validateField('notes', parameters.notes, { 
          limitKey: 'notes',
          allowNewlines: true
        });
        if (!notesValidation.valid) errors.push(notesValidation.error);
      }
      
      // Login/username validation
      if (parameters.login) {
        const loginValidation = validateField('login', parameters.login, { limitKey: 'login' });
        if (!loginValidation.valid) errors.push(loginValidation.error);
      }
      
      // Password validation (skip $GEN)
      if (parameters.password && parameters.password !== '$GEN' && parameters.password !== 'generate') {
        const passwordValidation = validateField('password', parameters.password, { limitKey: 'password' });
        if (!passwordValidation.valid) errors.push(passwordValidation.error);
      }
      
      // URL validation
      if (parameters.url) {
        const urlValidation = validateField('url', parameters.url, { 
          limitKey: 'url',
          pattern: 'url'
        });
        if (!urlValidation.valid) errors.push(urlValidation.error);
      }
      
      // Email validation
      if (parameters.email) {
        const emailValidation = validateField('email', parameters.email, { 
          limitKey: 'email',
          pattern: 'email'
        });
        if (!emailValidation.valid) errors.push(emailValidation.error);
      }
      
      // Phone entries validation
      if (parameters.phoneEntries && Array.isArray(parameters.phoneEntries)) {
        for (let i = 0; i < parameters.phoneEntries.length; i++) {
          const phoneValidation = validatePhoneEntry(parameters.phoneEntries[i]);
          if (!phoneValidation.valid) {
            errors.push(`Phone entry ${i + 1}: ${phoneValidation.error}`);
          }
        }
      }
      
      // Address fields validation
      const addressFields = ['address_street1', 'address_street2', 'address_city', 'address_state', 'address_zip', 'address_country'];
      for (const field of addressFields) {
        if (parameters[field]) {
          const limitKey = field.includes('street') ? 'street' : 
                          field.includes('city') ? 'city' :
                          field.includes('state') ? 'state' :
                          field.includes('zip') ? 'zip' : 'country';
          const validation = validateField(field, parameters[field], { limitKey });
          if (!validation.valid) errors.push(validation.error);
        }
      }
      
      // Name fields validation
      const nameFields = ['name_first', 'name_middle', 'name_last'];
      for (const field of nameFields) {
        if (parameters[field]) {
          const limitKey = field.includes('first') ? 'firstName' :
                          field.includes('middle') ? 'middleName' : 'lastName';
          const validation = validateField(field, parameters[field], { limitKey });
          if (!validation.valid) errors.push(validation.error);
        }
      }
      
      // Host fields validation
      if (parameters.host_hostName || parameters.hostName) {
        const hostname = parameters.host_hostName || parameters.hostName;
        const validation = validateField('hostName', hostname, { 
          limitKey: 'hostName',
          pattern: 'hostname'
        });
        if (!validation.valid) errors.push(validation.error);
      }
      
      if (parameters.host_port || parameters.port) {
        const port = parameters.host_port || parameters.port;
        const validation = validateField('port', port, { 
          limitKey: 'port',
          pattern: 'port'
        });
        if (!validation.valid) errors.push(validation.error);
      }
      
      // Validate all remaining string parameters against default limits
      for (const [key, value] of Object.entries(parameters)) {
        if (typeof value === 'string' && !['cliCommand'].includes(key)) {
          // Skip already validated fields
          if (['title', 'notes', 'record', 'recordType', 'login', 'password', 'url', 'email'].includes(key)) {
            continue;
          }
          if (addressFields.includes(key) || nameFields.includes(key)) {
            continue;
          }
          
          // Validate against default limit
          const validation = validateField(key, value, { limitKey: 'default' });
          if (!validation.valid) errors.push(validation.error);
        }
      }
      break;
    }
    
    case 'share-record':
    case 'share-folder': {
      // Record/Folder UID validation
      const uidParam = parameters.record || parameters.folder || parameters.sharedFolder;
      if (uidParam) {
        const uidValidation = validateField('uid', uidParam, { 
          limitKey: action === 'share-record' ? 'recordUid' : 'folderUid',
          pattern: 'uid'
        });
        if (!uidValidation.valid) errors.push(uidValidation.error);
      }
      
      // Email validation (required for share actions)
      if (parameters.user) {
        const emailValidation = validateEmails(parameters.user);
        if (!emailValidation.valid) errors.push(emailValidation.error);
      } else if (parameters.action !== 'cancel') {
        errors.push('User email is required for share operations');
      }
      
      // Expiration validation
      if (parameters.expire_in) {
        const durationValidation = validateField('expire_in', parameters.expire_in, {
          pattern: 'duration'
        });
        if (!durationValidation.valid) errors.push('Invalid expiration duration format');
      }
      
      if (parameters.expire_at) {
        // Basic datetime validation
        const expireAt = parameters.expire_at;
        if (typeof expireAt === 'string' && expireAt.length > 30) {
          errors.push('Expiration date exceeds maximum length');
        }
      }
      break;
    }
    
    case 'record-permission': {
      // Folder UID validation
      const folderUid = parameters.folder || parameters.sharedFolder;
      if (folderUid) {
        const uidValidation = validateField('folder', folderUid, { 
          limitKey: 'folderUid',
          pattern: 'uid'
        });
        if (!uidValidation.valid) errors.push(uidValidation.error);
      }
      
      // Action validation
      if (parameters.action && !['grant', 'revoke'].includes(parameters.action)) {
        errors.push('Invalid action. Must be "grant" or "revoke"');
      }
      break;
    }
    
    default: {
      // For unknown actions, validate all string parameters against default limits
      for (const [key, value] of Object.entries(parameters)) {
        if (typeof value === 'string') {
          const validation = validateField(key, value, { limitKey: 'default' });
          if (!validation.valid) errors.push(validation.error);
        }
      }
    }
  }
  
  return {
    valid: errors.length === 0,
    errors: errors.length > 0 ? errors : undefined
  };
}

// ============================================================================
// Command Building Functions
// ============================================================================

/**
 * Build Keeper CLI command from action and parameters
 */
// Helper function to capitalize first letter of a field name
function capitalizeFieldName(fieldName) {
  if (!fieldName || typeof fieldName !== 'string') return fieldName;
  return fieldName.charAt(0).toUpperCase() + fieldName.slice(1);
}

/**
 * Escape a value for use inside single-quoted shell arguments.
 * Single quotes in shell cannot contain escaped single quotes, so we use
 * the technique: replace ' with '\'' (end quote, escaped quote, start quote)
 * 
 * Example: "Test's Record" becomes "Test'\''s Record"
 * Which in shell becomes: 'Test'\''s Record' = Test's Record
 * 
 * @param {string} value - The user input value to escape
 * @returns {string} - The escaped value safe for single-quoted context
 */
function escapeForSingleQuotes(value) {
  if (value === null || value === undefined) return '';
  if (typeof value !== 'string') value = String(value);
  // Replace single quotes with the escape sequence '\''
  return value.replace(/'/g, "'\\''");
}

/**
 * Escape a value for use inside double-quoted shell arguments.
 * Characters that need escaping in double quotes: " $ ` \ !
 * 
 * @param {string} value - The user input value to escape
 * @returns {string} - The escaped value safe for double-quoted context
 */
function escapeForDoubleQuotes(value) {
  if (value === null || value === undefined) return '';
  if (typeof value !== 'string') value = String(value);
  // Escape backslashes first, then other special characters
  return value
    .replace(/\\/g, '\\\\')   // Escape backslashes
    .replace(/"/g, '\\"')     // Escape double quotes
    .replace(/\$/g, '\\$')    // Escape dollar signs (variable expansion)
    .replace(/`/g, '\\`')     // Escape backticks (command substitution)
    .replace(/!/g, '\\!');    // Escape exclamation marks (history expansion)
}

/**
 * Sanitize JSON field values before JSON.stringify to prevent injection
 * through JSON string escaping edge cases.
 * 
 * @param {Object} obj - Object with string values to sanitize
 * @returns {Object} - Object with sanitized values
 */
function sanitizeJsonObject(obj) {
  const sanitized = {};
  for (const key of Object.keys(obj)) {
    const value = obj[key];
    if (typeof value === 'string') {
      // JSON.stringify handles most escaping, but we ensure no null bytes
      // or other control characters that could cause parsing issues
      sanitized[key] = value.replace(/[\x00-\x1f]/g, '');
    } else {
      sanitized[key] = value;
    }
  }
  return sanitized;
}

function buildKeeperCommand(action, parameters, issueKey) {
  // Check if we have a pre-formatted CLI command (used for record-permission)
  if (parameters.cliCommand) {
    return parameters.cliCommand;
  }
  
  // ========================================================================
  // Input Validation - validate all parameters before building command
  // ========================================================================
  const validation = validateCommandParameters(action, parameters);
  if (!validation.valid) {
    throw new Error(`Input validation failed: ${validation.errors.join('; ')}`);
  }
  
  let command = action;
  
  // Build command based on action type
  switch (action) {
    case 'record-add':
      // Use the recordType parameter if provided, otherwise default to login
      const recordType = parameters.recordType || 'login';
      command += ` --record-type='${escapeForSingleQuotes(recordType)}'`;
      
      // Title is required for all record types
      if (!parameters.title) {
        throw new Error(`Title is required for record-add command. Record type: ${recordType}`);
      }
      command += ` --title="${escapeForDoubleQuotes(parameters.title)}"`;
      // Handle common fields for all record types
      if (parameters.notes) {
        command += ` Notes="${escapeForDoubleQuotes(parameters.notes)}"`;
      }
      
      // Dynamic field processing for any record type
      // Process all parameters except metadata fields
      const metadataFields = ['recordType', 'title', 'notes', 'skipComment', 'phoneEntries'];
      
      // Special handling for login record type (password generation)
      if (recordType === 'login' && !parameters.password) {
        command += ` Password=$GEN`; // Generate password if not provided for login records
      }
      
      // Special handling for single phone entry (contact record type)
      if (parameters.phoneEntries && Array.isArray(parameters.phoneEntries) && parameters.phoneEntries.length > 0) {
        const entry = parameters.phoneEntries[0]; // Only first phone entry
        if (entry.number && entry.number.trim()) {
          const phoneObj = {
            number: entry.number.trim()
          };
          if (entry.region && entry.region.trim()) {
            phoneObj.region = entry.region.trim();
          }
          if (entry.ext && entry.ext.trim()) {
            phoneObj.ext = entry.ext.trim();
          }
          if (entry.type) {
            phoneObj.type = entry.type;
          }
          // Sanitize JSON object values and escape for single-quoted shell context
          const sanitizedPhone = sanitizeJsonObject(phoneObj);
          command += ` Phone='$JSON:${escapeForSingleQuotes(JSON.stringify(sanitizedPhone))}'`;
        }
      }
      
      // Process all fields dynamically with proper JSON formatting for complex field types
      const addProcessedFields = new Set(); // Track processed fields to avoid duplicates
      const jsonFields = {}; // Group fields that need JSON formatting
      
      // Define field types that require JSON formatting as per documentation
      const jsonFieldTypes = {
        'address': ['street1', 'street2', 'city', 'state', 'zip', 'country'],
        'name': ['first', 'middle', 'last'],
        'phone': ['region', 'number', 'ext', 'type'],
        'host': ['hostName', 'port'],
        'pamHostname': ['hostName', 'port'],
        'keyPair': ['privateKey', 'publicKey']
      };
      
      // Map reference fields to their corresponding JSON field types
      // When a reference field is provided, skip the corresponding JSON field
      // Currently empty as no reference fields are used in static record types
      const referenceFieldMappings = {};
      
      // First pass: Group fields that need JSON formatting
      Object.keys(parameters).forEach(key => {
        if (metadataFields.includes(key) || !parameters[key]) {
          return; // Skip metadata fields and empty values
        }
        
        const value = parameters[key].toString().trim();
        if (!value) return;
        
        // Check for grouped fields (like address_street1, name_first, phone_Work_number)
        if (key.includes('_')) {
          const parts = key.split('_');
          const prefix = parts[0];
          const suffix = parts[1];
          
          // Check if this is a JSON field type
          if (jsonFieldTypes[prefix] && jsonFieldTypes[prefix].includes(suffix)) {
            if (!jsonFields[prefix]) {
              jsonFields[prefix] = {};
            }
            jsonFields[prefix][suffix] = value;
            addProcessedFields.add(key);
            return;
          }
          
          // Handle phone.Work, phone.Mobile pattern (phone_Work_number, phone_Mobile_number)
          if (prefix === 'phone' && parts.length === 3) {
            const phoneType = parts[1]; // Work, Mobile, etc.
            const phoneField = parts[2]; // number, ext, etc.
            
            if (!jsonFields[`phone.${phoneType}`]) {
              jsonFields[`phone.${phoneType}`] = {};
              // Automatically add the type field based on phone type
              jsonFields[`phone.${phoneType}`]['type'] = phoneType;
            }
            jsonFields[`phone.${phoneType}`][phoneField] = value;
            addProcessedFields.add(key);
            return;
          }
        }
        
        // Check for direct field names that should be grouped
        Object.keys(jsonFieldTypes).forEach(fieldType => {
          if (jsonFieldTypes[fieldType].includes(key)) {
            if (!jsonFields[fieldType]) {
              jsonFields[fieldType] = {};
            }
            jsonFields[fieldType][key] = value;
            addProcessedFields.add(key);
            return;
          }
        });
      });
      
      // Second pass: Add JSON formatted fields and individual fields
      Object.keys(parameters).forEach(key => {
        if (metadataFields.includes(key) || !parameters[key] || addProcessedFields.has(key)) {
          return; // Skip metadata fields, empty values, and already processed fields
        }
        
        const value = parameters[key].toString().trim();
        if (value) {
          // Escape user input for single-quoted shell context
          const escapedValue = escapeForSingleQuotes(value);
          
          // Handle custom fields (c.text.Department, c.secret.API_Key, etc.)
          if (key.startsWith('c.')) {
              command += ` ${key}='${escapedValue}'`;
          }
          // Handle text.fieldname format (e.g., text.type for databaseCredentials)
          else if (key.startsWith('text.')) {
              // Keep as-is (lowercase) for Keeper CLI
              command += ` ${key}='${escapedValue}'`;
          }
          // Handle grouped fields that don't need JSON - skip, handled in jsonFields
          else if (key.includes('_')) {
            // These are handled in jsonFields section
          }
          // Single fields (login, password, url, email, etc.) - keep lowercase
          else {
            command += ` ${key}='${escapedValue}'`;
          }
        }
      });
      
      // Add JSON formatted fields (but skip if we have corresponding reference fields)
      Object.keys(jsonFields).forEach(fieldName => {
        const fieldData = jsonFields[fieldName];
        if (Object.keys(fieldData).length > 0) {
          // Check if we have a reference field that should exclude this JSON field
          let shouldSkip = false;
          Object.keys(referenceFieldMappings).forEach(refField => {
            if (parameters[refField] && referenceFieldMappings[refField] === fieldName) {
              shouldSkip = true;
            }
          });
          
          if (!shouldSkip) {
            // Sanitize JSON object values and escape for single-quoted shell context
            const sanitizedData = sanitizeJsonObject(fieldData);
            command += ` ${fieldName}='$JSON:${escapeForSingleQuotes(JSON.stringify(sanitizedData))}'`;
          }
        }
      });
      
      break;
      
    case 'record-update':
      // Required record parameter
      if (parameters.record) {
        command += ` --record='${escapeForSingleQuotes(parameters.record)}'`;
      }
      
      // Optional title update
      if (parameters.title) {
        command += ` --title='${escapeForSingleQuotes(parameters.title)}'`;
      }
      
      // Optional record type change
      if (parameters.recordType) {
        command += ` --record-type='${escapeForSingleQuotes(parameters.recordType)}'`;
      }
      
      // Notes handling (with + prefix to append, without to replace)
      if (parameters.notes) {
        if (parameters.appendNotes === true) {
          command += ` --notes='+${escapeForSingleQuotes(parameters.notes)}'`;
        } else {
          command += ` --notes='${escapeForSingleQuotes(parameters.notes)}'`;
        }
      }
      
      // Dynamic Field Processing - handles all record types and field formats
      const processedFields = new Set(); // Track processed fields to avoid duplicates
      const groupedFields = {}; // Group related fields (name_, address_, phone_, etc.)
      
      // First pass: Group related fields and identify patterns
      Object.keys(parameters).forEach(key => {
        if (!parameters[key] || (typeof parameters[key] === 'string' && parameters[key].trim() === '')) {
          return; // Skip empty values
        }
        
        const value = parameters[key].toString().trim();
        
        // Skip already processed core fields and metadata
        if (['record', 'title', 'recordType', 'notes', 'appendNotes', 'force', 'phoneEntries'].includes(key)) {
          return;
        }
        
        // Detect field patterns and group them
        // Don't split custom fields (c.text.*, c.secret.*, c.date.*) or labeled fields (date.*, password.*) - preserve them as-is
        if (key.startsWith('c.') || key.startsWith('text.') || key.startsWith('date.') || key.startsWith('password.')) {
          // Custom fields and labeled fields should be preserved as single fields with full key
          groupedFields[key] = value;
        } else if (key.includes('_')) {
          const [prefix, suffix] = key.split('_', 2);
          if (!groupedFields[prefix]) {
            groupedFields[prefix] = {};
          }
          groupedFields[prefix][suffix] = value;
        } else {
          // Single fields (login, password, url, etc.)
          groupedFields[key] = value;
        }
      });
      
      // Second pass: Process grouped fields according to Keeper CLI formats
      Object.keys(groupedFields).forEach(fieldGroup => {
        if (processedFields.has(fieldGroup)) return;
        
        const fieldData = groupedFields[fieldGroup];
        
        // Handle grouped JSON fields (address, name, phone, etc.)
        if (typeof fieldData === 'object' && fieldData !== null) {
          switch (fieldGroup) {
            case 'address':
              // Address format: address='$JSON:{"street1": "...", "city": "..."}''
              const addressObj = {};
              if (fieldData.street1) addressObj.street1 = fieldData.street1;
              if (fieldData.street2) addressObj.street2 = fieldData.street2;
              if (fieldData.city) addressObj.city = fieldData.city;
              if (fieldData.state) addressObj.state = fieldData.state;
              if (fieldData.zip) addressObj.zip = fieldData.zip;
              if (fieldData.country) addressObj.country = fieldData.country;
              
              if (Object.keys(addressObj).length > 0) {
                const sanitizedAddress = sanitizeJsonObject(addressObj);
                const addressCommand = ` address='$JSON:${escapeForSingleQuotes(JSON.stringify(sanitizedAddress))}'`;
                command += addressCommand;
              }
              break;
              
            case 'name':
              // Name format: name='$JSON:{"first": "John", "middle": "Michael", "last": "Doe"}'
              const nameObj = {};
              if (fieldData.first) nameObj.first = fieldData.first;
              if (fieldData.middle) nameObj.middle = fieldData.middle;
              if (fieldData.last) nameObj.last = fieldData.last;
              
              if (Object.keys(nameObj).length > 0) {
                const sanitizedName = sanitizeJsonObject(nameObj);
                command += ` name='$JSON:${escapeForSingleQuotes(JSON.stringify(sanitizedName))}'`;
              }
              break;
              
            case 'phone':
              // Simple phone format without type: phone='$JSON:{"number": "...", ...}'
              const simplePhoneObj = {};
              if (fieldData.number) simplePhoneObj.number = fieldData.number;
              if (fieldData.ext) simplePhoneObj.ext = fieldData.ext;
              if (fieldData.region) simplePhoneObj.region = fieldData.region;
              if (fieldData.type) simplePhoneObj.type = fieldData.type;
              
              if (Object.keys(simplePhoneObj).length > 0) {
                const sanitizedPhone = sanitizeJsonObject(simplePhoneObj);
                command += ` phone='$JSON:${escapeForSingleQuotes(JSON.stringify(sanitizedPhone))}'`;
              }
              break;
              
            case 'keyPair':
              // SSH keyPair format: keyPair='$JSON:{"privateKey": "...", "publicKey": "..."}'
              const keyPairObj = {};
              if (fieldData.privateKey) keyPairObj.privateKey = fieldData.privateKey;
              if (fieldData.publicKey) keyPairObj.publicKey = fieldData.publicKey;
              
              if (Object.keys(keyPairObj).length > 0) {
                const sanitizedKeyPair = sanitizeJsonObject(keyPairObj);
                command += ` keyPair='$JSON:${escapeForSingleQuotes(JSON.stringify(sanitizedKeyPair))}'`;
              }
              break;
              
            case 'host':
              // Host format: host='$JSON:{"hostName": "...", "port": "..."}'
              const hostObj = {};
              if (fieldData.hostName) hostObj.hostName = fieldData.hostName;
              if (fieldData.port) hostObj.port = fieldData.port;
              
              if (Object.keys(hostObj).length > 0) {
                const sanitizedHost = sanitizeJsonObject(hostObj);
                command += ` host='$JSON:${escapeForSingleQuotes(JSON.stringify(sanitizedHost))}'`;
              }
              break;
              
            case 'pamHostname':
              // PAM Hostname format: pamHostname='$JSON:{"hostName": "...", "port": "..."}'
              const pamHostObj = {};
              if (fieldData.hostName) pamHostObj.hostName = fieldData.hostName;
              if (fieldData.port) pamHostObj.port = fieldData.port;
              
              if (Object.keys(pamHostObj).length > 0) {
                const sanitizedPamHost = sanitizeJsonObject(pamHostObj);
                command += ` pamHostname='$JSON:${escapeForSingleQuotes(JSON.stringify(sanitizedPamHost))}'`;
              }
              break;
              
            default:
              // Handle any other grouped fields as custom fields
              Object.keys(fieldData).forEach(subField => {
                const subValue = fieldData[subField];
                if (subValue) {
                  // Use only the original field name (subField) for custom fields
                  // Escape for double-quoted context
                  command += ` c.text.${subField}="${escapeForDoubleQuotes(subValue)}"`;
                }
              });
              break;
          }
        } else {
          // Handle single fields
          const value = fieldData;
          // Escape value for single-quoted shell context
          const escapedValue = escapeForSingleQuotes(value);
          
          switch (fieldGroup) {
            case 'login':
              command += ` login='${escapedValue}'`;
              break;
              
            case 'password':
              if (value === '$GEN' || value === 'generate') {
                command += ` password=$GEN`;
              } else {
                command += ` password='${escapedValue}'`;
              }
              break;
              
            case 'passphrase':
              // Passphrase is a password-type field with label "passphrase"
              // Keeper CLI format: password.label='value'
              if (value === '$GEN' || value === 'generate') {
                command += ` password.passphrase=$GEN`;
              } else {
                command += ` password.passphrase='${escapedValue}'`;
              }
              break;
              
            case 'url':
              command += ` url='${escapedValue}'`;
              break;
              
            case 'email':
              command += ` email='${escapedValue}'`;
              break;
              
            case 'licenseNumber':
              // Standard Keeper field type for software licenses
              command += ` licenseNumber='${escapedValue}'`;
              break;
              
            case 'accountNumber':
              // Standard Keeper field type for memberships
              command += ` accountNumber='${escapedValue}'`;
              break;
              
            case 'expirationDate':
              // Standard Keeper field type for expiration dates
              command += ` expirationDate='${escapedValue}'`;
              break;
              
            case 'note':
              // Standard Keeper field type for notes
              command += ` note='${escapedValue}'`;
              break;
              
            case 'date':
              // Handle different date formats
              if (value.match(/^\d{4}-\d{2}-\d{2}$/)) {
                command += ` date='${escapedValue}'`;
              } else if (value.match(/^\d+$/)) {
                command += ` date=${value}`; // Numeric dates don't need quotes
              } else {
                command += ` date='${escapedValue}'`;
              }
              break;
              
            case 'text':
            case 'multiline':
            case 'secret':
              // Handle as custom field with appropriate type
              command += ` c.${fieldGroup}.${fieldGroup}='${escapedValue}'`;
              break;
              
            default:
              // Handle custom fields (c.*) and labeled fields (type.label format like date.dateActive, password.passphrase)
              if (fieldGroup.startsWith('c.') || fieldGroup.startsWith('text.') || fieldGroup.startsWith('date.') || fieldGroup.startsWith('password.')) {
                command += ` ${fieldGroup}='${escapedValue}'`;
                break;
              }
              // Any other single field - use c.secret for $GEN values, c.text for others
              if (value === '$GEN' || value === 'generate') {
                command += ` c.secret.${fieldGroup}=$GEN`;
              } else {
                command += ` c.text.${fieldGroup}='${escapedValue}'`;
              }
              break;
          }
        }
        
        processedFields.add(fieldGroup);
      });
      
      // Handle single phone entry for contact record updates
      // Format per Keeper docs: phone='$JSON:{"number":"...", "type":"...", ...}'
      if (parameters.phoneEntries && Array.isArray(parameters.phoneEntries) && parameters.phoneEntries.length > 0) {
        const entry = parameters.phoneEntries[0]; // Only first phone entry
        if (entry.number && entry.number.trim()) {
          const phoneObj = {
            number: entry.number.trim()
          };
          if (entry.type) {
            phoneObj.type = entry.type;
          }
          if (entry.region) {
            phoneObj.region = entry.region;
          }
          if (entry.ext && entry.ext.trim()) {
            phoneObj.ext = entry.ext.trim();
          }
          // Sanitize JSON object values and escape for single-quoted shell context
          const sanitizedPhoneUpdate = sanitizeJsonObject(phoneObj);
          command += ` phone='$JSON:${escapeForSingleQuotes(JSON.stringify(sanitizedPhoneUpdate))}'`;
        }
      }
      
      // Force flag to ignore warnings
      if (parameters.force === true) {
        command += ` --force`;
      }
      
      
      break;
      
    case 'record-permission':
      // Format: record-permission FOLDER_UID -a ACTION [-d] [-s] [-R] [--force]
      // Example: record-permission jdrkYEaf03bG0ShCGlnKww -a revoke -d -R --force
      // -a = action (grant/revoke)
      // -d = edit permission flag (can_edit)
      // -s = share permission flag (can_share)
      // -R = recursive flag (apply to all sub folders)
      // --force = force flag (for grant and revoke actions)
      
      // Add folder UID (from selectedFolder or sharedFolder)
      if (parameters.folder) {
        command += ` '${escapeForSingleQuotes(parameters.folder)}'`;
      } else if (parameters.sharedFolder) {
        command += ` '${escapeForSingleQuotes(parameters.sharedFolder)}'`;
      }
      
      // Add action flag (-a) - action is validated against known values so no escaping needed
      if (parameters.action) {
        command += ` -a ${parameters.action}`;
      }
      
      // Add edit permission flag (-d) if can_edit is true
      if (parameters.can_edit === true || parameters.can_edit === 'true') {
        command += ` -d`;
      }
      
      // Add share permission flag (-s) if can_share is true
      if (parameters.can_share === true || parameters.can_share === 'true') {
        command += ` -s`;
      }
      
      // Add recursive flag (-R) if recursive is true
      if (parameters.recursive === true || parameters.recursive === 'true') {
        command += ` -R`;
      }
      
      // Add force flag (--force) for grant and revoke actions
      if (parameters.action === 'grant' || parameters.action === 'revoke') {
        command += ` --force`;
      }
      
      break;
      
    case 'share-record':
      // Format: share-record "RECORD_UID" -e "EMAIL" -a "ACTION" [-s] [-w] [-R] [--expire-at|--expire-in] --force
      // For cancel action with record: share-record "RECORD_UID" -a cancel -e "EMAIL" [-e "EMAIL2" ...] -f
      // For cancel action with folder: share-record "FOLDER_UID" -a cancel -e "EMAIL" [-e "EMAIL2" ...] -f
      
      // Add record UID for all non-cancel actions
      if (parameters.record && parameters.action !== 'cancel') {
        command += ` '${escapeForSingleQuotes(parameters.record)}'`;
      }
      
      // For cancel action, add either record UID or folder UID (admin can select either)
      if (parameters.action === 'cancel') {
        if (parameters.record) {
          command += ` '${escapeForSingleQuotes(parameters.record)}'`;
        } else if (parameters.sharedFolder) {
          command += ` '${escapeForSingleQuotes(parameters.sharedFolder)}'`;
        }
      }
      
      // Handle email addresses - support comma-separated values
      if (parameters.user) {
        // Split by comma and trim whitespace
        const emails = parameters.user.split(',').map(email => email.trim()).filter(email => email);
        // Add each email with its own -e flag, properly escaped
        emails.forEach(email => {
          command += ` -e '${escapeForSingleQuotes(email)}'`;
        });
      }
      
      // Action is validated against known values so no escaping needed
      if (parameters.action) {
        command += ` -a ${parameters.action}`;
      }
      
      // Only add permission flags if action is NOT cancel
      if (parameters.action !== 'cancel') {
        // Add optional permission flags
        if (parameters.can_share === true) {
          command += ` -s`;
        }
        if (parameters.can_write === true) {
          command += ` -w`;
        }
        if (parameters.recursive === true) {
          command += ` -R`;
        }
        // Add expiration options
        if (parameters.expiration_type === 'expire-at' && parameters.expire_at) {
          // Convert datetime-local format to ISO format (yyyy-MM-dd hh:mm:ss)
          const expireAtFormatted = parameters.expire_at.replace('T', ' ');
          command += ` --expire-at "${escapeForDoubleQuotes(expireAtFormatted)}"`;
        } else if (parameters.expiration_type === 'expire-in' && parameters.expire_in) {
          // expire_in is expected to be a numeric duration, validate it's safe
          const expireInValue = String(parameters.expire_in).replace(/[^0-9dhms]/gi, '');
          command += ` --expire-in ${expireInValue}`;
        }
      }
      
      // Add force flag at the end
      command += ` -f`;
      break;
      
    case 'share-folder':
      // Format: share-folder "FOLDER_UID" -e "EMAIL" -a "ACTION" [options] [--expire-at|--expire-in] --force
      if (parameters.folder) {
        command += ` '${escapeForSingleQuotes(parameters.folder)}'`;
      }
      
      // Handle email addresses - support comma-separated values
      if (parameters.user) {
        // Split by comma and trim whitespace
        const emails = parameters.user.split(',').map(email => email.trim()).filter(email => email);
        // Add each email with its own -e flag, properly escaped
        emails.forEach(email => {
          command += ` -e '${escapeForSingleQuotes(email)}'`;
        });
      }
      
      // Action is validated against known values so no escaping needed
      if (parameters.action) {
        command += ` -a ${parameters.action}`;
      }
      // Always include ALL four permission flags explicitly with either 'on' or 'off'
      // Never omit a flag — omitting defaults to the shared folder's settings, which may grant unintended permissions
      command += ` -p ${parameters.manage_records === true ? 'on' : 'off'}`;  // User permission: Can manage records
      command += ` -o ${parameters.manage_users === true ? 'on' : 'off'}`;    // User permission: Can manage users
      command += ` -s ${parameters.can_share === true ? 'on' : 'off'}`;       // Record permission: Can be shared
      command += ` -d ${parameters.can_edit === true ? 'on' : 'off'}`;        // Record permission: Can be modified
      // Add expiration options
      if (parameters.expiration_type === 'expire-at' && parameters.expire_at) {
        // Convert datetime-local format to ISO format (yyyy-MM-dd hh:mm:ss)
        const expireAtFormatted = parameters.expire_at.replace('T', ' ');
        command += ` --expire-at "${escapeForDoubleQuotes(expireAtFormatted)}"`;
      } else if (parameters.expiration_type === 'expire-in' && parameters.expire_in) {
        // expire_in is expected to be a numeric duration, validate it's safe
        const expireInValue = String(parameters.expire_in).replace(/[^0-9dhms]/gi, '');
        command += ` --expire-in ${expireInValue}`;
      }
      // Add force flag at the end
      command += ` --force`;
      break;
      
    default:
      // For any other commands, add parameters as key=value pairs with proper escaping
      Object.keys(parameters).forEach(key => {
        if (parameters[key]) {
            command += ` ${key}='${escapeForSingleQuotes(String(parameters[key]))}'`;
        }
      });
  }
  
  return command;
}

/**
 * Get records list from Keeper API (called from issue panel)
 */
resolver.define('getKeeperRecords', async (req) => {
  const userId = req?.context?.accountId;
  
  try {
    const result = await executeKeeperApiCommand('list --format=json', { userId });
    const apiData = result.data;

    // Parse the JSON data from the response
    let records = [];
    if (apiData.data && Array.isArray(apiData.data)) {
      records = apiData.data;
    } else if (apiData.message && typeof apiData.message === 'string') {
      try {
        records = JSON.parse(apiData.message);
      } catch (parseError) {
        return keeperError('Failed to parse records data from Keeper API');
      }
    } else if (apiData.data && typeof apiData.data === 'string') {
      try {
        records = JSON.parse(apiData.data);
      } catch (parseError) {
        return keeperError('Failed to parse records data from Keeper API');
      }
    }

    return successResponse({ records: records || [] });
  } catch (err) {
    // Check for rate limit error
    if (err.rateLimited) {
      return rateLimitError(err.limitType || 'minute', err.retryAfter || 60);
    }
    return keeperError(err.message || 'Failed to fetch records', err);
  }
});

/**
 * Get folders list from Keeper API (called from issue panel)
 */
resolver.define('getKeeperFolders', async (req) => {
  const userId = req?.context?.accountId;
  
  try {
    const result = await executeKeeperApiCommand('ls -f --format=json', { userId });
    const apiData = result.data;

    // Parse the JSON data from the response
    let folders = [];
    if (apiData.data && Array.isArray(apiData.data)) {
      try {
        // data.data is directly an array of folders for ls -f command
        folders = apiData.data.map((folder, index) => {
          // Clean ANSI color codes from folder name
          let cleanName = folder.name || '';
          cleanName = cleanName.replace(/\[?\d+m/g, ''); // Remove [31m, [39m etc.
          
          // Extract flags from details string (format: "Flags: S, Parent: /")
          let flags = '';
          let parentUid = '';
          if (folder.details) {
            const flagsMatch = folder.details.match(/Flags:\s*([^,]*)/);
            if (flagsMatch) {
              flags = flagsMatch[1].trim();
            }
            const parentMatch = folder.details.match(/Parent:\s*(.+)/);
            if (parentMatch) {
              parentUid = parentMatch[1].trim();
            }
          }
          
          return {
            number: index + 1,
            folder_uid: folder.uid,
            uid: folder.uid,
            name: cleanName,
            title: cleanName,
            path: cleanName,
            flags: flags,
            parent_uid: parentUid,
            shared: flags && flags.includes('S'),
            raw_data: folder
          };
        });
      } catch (parseError) {
        return keeperError('Failed to parse folders data from Keeper API');
      }
    }

    return successResponse({ folders: folders || [] });
  } catch (err) {
    // Check for rate limit error
    if (err.rateLimited) {
      return rateLimitError(err.limitType || 'minute', err.retryAfter || 60);
    }
    return keeperError(err.message || 'Failed to fetch folders', err);
  }
});

/**
 * Get detailed record information from Keeper API (called from issue panel for record-update)
 */
resolver.define('getKeeperRecordDetails', async (req) => {
  const userId = req?.context?.accountId;
  const { recordUid } = req.payload || {};
  
  if (!recordUid) {
    return validationError('recordUid', 'Record UID is required to fetch record details');
  }

  try {
    const result = await executeKeeperApiCommand(`get "${recordUid}" --format=json`, { userId });
    const apiData = result.data;

    // Parse the JSON data from the response
    let recordDetails = {};
    if (apiData.data) {
      try {
        // Parse the JSON response from get command
        if (typeof apiData.data === 'string') {
          recordDetails = JSON.parse(apiData.data);
        } else if (typeof apiData.data === 'object') {
          recordDetails = apiData.data;
        }
      } catch (parseError) {
        return keeperError('Failed to parse record details data from Keeper API');
      }
    }

    return successResponse({ recordDetails: recordDetails || {} });
  } catch (err) {
    // Check for rate limit error
    if (err.rateLimited) {
      return rateLimitError(err.limitType || 'minute', err.retryAfter || 60);
    }
    return keeperError(err.message || 'Failed to fetch record details', err);
  }
});

/**
 * Execute a simple Keeper command (called from config page for EPM, etc.)
 */
resolver.define('executeKeeperCommand', async (req) => {
  const userId = req?.context?.accountId;
  
  // Handle double nesting: req.payload.payload
  let payload = req?.payload?.payload || req?.payload || req;
  
  if (!payload) {
    return validationError('payload', 'No payload provided');
  }
  
  const { command } = payload;
  
  if (!command) {
    return validationError('command', 'Command is required');
  }

  try {
    const result = await executeKeeperApiCommand(command, { userId });
    return result;
  } catch (err) {
    // Check for rate limit error
    if (err.rateLimited) {
      return rateLimitError(err.limitType || 'minute', err.retryAfter || 60);
    }
    return keeperError(err.message || 'Failed to execute command', err);
  }
});

/**
 * Manual Keeper action trigger (called from issue panel)
 */
resolver.define('executeKeeperAction', async (req) => {
  const userId = req?.context?.accountId;
  const { issueKey, command, commandDescription, parameters, formattedTimestamp } = req.payload;
  
  logger.info('executeKeeperAction: Executing Keeper action', { 
    issueKey, 
    commandType: command?.split(' ')[0], 
    hasParameters: !!parameters 
  });
  
  if (!issueKey) {
    return validationError('issueKey', 'Issue key is required');
  }
  
  if (!command) {
    return validationError('command', 'Command is required');
  }
  
  // Check if this is an EPM command and if the request is already expired or action was already taken
  const isEpmCommand = command.startsWith('epm approval action');
  if (isEpmCommand) {
    // Check if any action label already exists (with rate limit retry)
    try {
      const issueResponse = await requestJiraAsAppWithRetry(
        route`/rest/api/3/issue/${issueKey}?fields=labels`,
        {
          method: 'GET',
          headers: { 'Accept': 'application/json' }
        },
        'Check EPM action labels'
      );
      
      if (issueResponse.ok) {
        const issueData = await issueResponse.json();
        const labels = issueData.fields?.labels || [];
        
        if (labels.includes('epm-approved')) {
          return epmError('approved');
        }
        if (labels.includes('epm-denied')) {
          return epmError('denied');
        }
        if (labels.includes('epm-expired')) {
          return epmError('expired');
        }
      }
    } catch (error) {
      // If it's a structured error response, return it
      if (error.success === false) {
        return error;
      }
      // Otherwise, continue
    }
  }
  
  // Validate share-record: prevent sharing with record owner
  // Sharing with owner causes issues: revokes owner from record (moves to deleted items) and then share fails
  if (command === 'share-record' && parameters.record && parameters.user && parameters.action !== 'cancel') {
    try {
      // Fetch record details to get owner email (skip rate limit for internal validation)
      const recordResult = await executeKeeperApiCommand(`get "${parameters.record}" --format=json`, { userId, skipRateLimit: true });
      const recordApiData = recordResult.data;
      
      let recordOwnerEmail = null;
      if (recordApiData.data) {
        let recordDetails = {};
        if (typeof recordApiData.data === 'string') {
          recordDetails = JSON.parse(recordApiData.data);
        } else if (typeof recordApiData.data === 'object') {
          recordDetails = recordApiData.data;
        }
        
        // Owner email is in user_permissions array where owner: true
        // Example: { "username": "user@example.com", "owner": true, ... }
        if (recordDetails.user_permissions && Array.isArray(recordDetails.user_permissions)) {
          const ownerPermission = recordDetails.user_permissions.find(p => p.owner === true);
          if (ownerPermission) {
            recordOwnerEmail = ownerPermission.username;
          }
        }
      }
      
      if (recordOwnerEmail) {
        // Split user emails by comma and check if any matches the owner
        const targetEmails = parameters.user.split(',').map(email => email.trim().toLowerCase()).filter(email => email);
        const ownerEmailLower = recordOwnerEmail.toLowerCase();
        
        if (targetEmails.includes(ownerEmailLower)) {
          return errorResponse(
            ERROR_CODES.VALIDATION_INVALID_FORMAT,
            `Cannot share record with its owner (${recordOwnerEmail}). Sharing with the record owner would revoke their ownership and cause the operation to fail.`,
            { field: 'user' }
          );
        }
      }
    } catch (ownerCheckError) {
      // If it's a structured error response, return it
      if (ownerCheckError.success === false) {
        return ownerCheckError;
      }
      // Otherwise, log and continue (don't block if we can't fetch record details)
      logger.error('Failed to check record owner for share-record validation', { error: ownerCheckError.message });
    }
  }

  try {
    // Build dynamic command based on action and parameters
    // This is inside try block so validation errors are properly caught
    const dynamicCommand = buildKeeperCommand(command, parameters || {}, issueKey);

    // Call Keeper API using v2 async queue (with rate limiting)
    const result = await executeKeeperApiCommand(dynamicCommand, { userId });
    const data = result.data;

    // Extract record_uid if this is a record-add command
    let record_uid = null;
    if (command === 'record-add' && data.data) {
      try {
        let recordData = data.data;
        if (typeof recordData === 'string') {
          recordData = JSON.parse(recordData);
        }
        record_uid = recordData.record_uid || recordData.uid;
        
        // If not found in data, try to extract from message
        if (!record_uid && data.message && data.message.includes('record_uid')) {
          const match = data.message.match(/record_uid[:\s]+([a-zA-Z0-9_-]+)/);
          if (match) {
            record_uid = match[1];
          }
        }
      } catch (parseError) {
      }
    }

    // Check if this is an EPM command
    const isEpmCommand = command.startsWith('epm approval action');
    
    // Only add comment for main record creation, not for records created as references
    // Check if this is a main record creation (not just a reference record)
    // Records created as references will have skipComment: true parameter
    const isMainRecordCreation = !parameters.skipComment;
    
    if (isMainRecordCreation || isEpmCommand) {
      // Get current user info for the comment
      const currentUser = await getCurrentUser();
      
      // Use the timestamp formatted on frontend with user's local time
      const timestamp = formattedTimestamp;
      
      // Create comment with command-specific messages and record_uid
      let actionMessage = '';
      let actionDescription = commandDescription || command;
      let recordUid = '';
      
      // Check for record_uid in different possible locations in the response
      recordUid = data.record_uid || 
                 (data.data && data.data.record_uid) || 
                 (data.data && data.data.data && data.data.data.record_uid);
      
      // Track if share invitation is pending (not yet accepted)
      let isShareInvitationPending = false;
      
      // Set command-specific messages
      // Handle EPM commands first
      if (isEpmCommand) {
        if (command.includes('--approve')) {
          actionMessage = `Endpoint privilege approval request has been approved`;
          actionDescription = `Endpoint Privilege Approval: Approved request ${parameters.cliCommand ? parameters.cliCommand.split(' ').pop() : ''}`;
        } else if (command.includes('--deny')) {
          actionMessage = `Endpoint privilege approval request has been denied`;
          actionDescription = `Endpoint Privilege Approval: Denied request ${parameters.cliCommand ? parameters.cliCommand.split(' ').pop() : ''}`;
        }
      } else {
        switch (command) {
          case 'record-add':
            actionMessage = 'Record created successfully';
            break;
          case 'record-update':
            actionMessage = 'Record updated successfully';
            break;
          case 'record-permission':
            actionMessage = 'Record permissions updated successfully';
            break;
          case 'share-record':
          // Build detailed action description
          actionDescription = `Share Record - ${parameters.action ? parameters.action.charAt(0).toUpperCase() + parameters.action.slice(1) : 'Grant'} access to ${parameters.user}`;
          
          // Check if this is a share invitation pending case
          // Response message can be a string or array
          const shareRecordMessages = Array.isArray(data.message) ? data.message : [data.message];
          const shareInvitationMessage = shareRecordMessages.find(msg => 
            msg && typeof msg === 'string' && msg.includes('Share invitation has been sent to')
          );
          
          if (shareInvitationMessage) {
            // Extract email from message like "Share invitation has been sent to 'email@example.com'"
            const emailMatch = shareInvitationMessage.match(/Share invitation has been sent to '([^']+)'/);
            const invitedEmail = emailMatch ? emailMatch[1] : parameters.user;
            
            actionMessage = `Share invitation sent to ${invitedEmail}. The invitation is pending acceptance.`;
            isShareInvitationPending = true;
          } else {
            // Build detailed message for share-record
            const recordName = parameters.recordTitle ? `"${parameters.recordTitle}"` : 'record';
            actionMessage = `Shared ${recordName} with ${parameters.user}`;
            if (parameters.action) {
              actionMessage += ` (Action: ${parameters.action})`;
            }
            
            // Add permissions details
            const recordPerms = [];
            if (parameters.can_share === true) recordPerms.push('Can Share');
            if (parameters.can_write === true) recordPerms.push('Can Write');
            if (parameters.recursive === true) recordPerms.push('Recursive');
            
            if (recordPerms.length > 0) {
              actionMessage += ` - Permissions: ${recordPerms.join(', ')}`;
            }
            
            // Add expiration info
            if (parameters.expiration_type === 'expire-at' && parameters.expire_at) {
              actionMessage += ` - Expires at: ${parameters.expire_at.replace('T', ' ')}`;
            } else if (parameters.expiration_type === 'expire-in' && parameters.expire_in) {
              actionMessage += ` - Expires in: ${parameters.expire_in}`;
            }
          }
          break;
          
        case 'share-folder':
          // Build detailed action description
          actionDescription = `Share Folder - ${parameters.action ? parameters.action.charAt(0).toUpperCase() + parameters.action.slice(1) : 'Grant'} access to ${parameters.user}`;
          
          // Check if this is a share invitation pending case
          // Response message can be a string or array
          const shareFolderMessages = Array.isArray(data.message) ? data.message : [data.message];
          const folderInvitationMessage = shareFolderMessages.find(msg => 
            msg && typeof msg === 'string' && msg.includes('Share invitation has been sent to')
          );
          
          if (folderInvitationMessage) {
            // Extract email from message like "Share invitation has been sent to 'email@example.com'"
            const emailMatch = folderInvitationMessage.match(/Share invitation has been sent to '([^']+)'/);
            const invitedEmail = emailMatch ? emailMatch[1] : parameters.user;
            
            actionMessage = `Share invitation sent to ${invitedEmail}. The invitation is pending acceptance.`;
            isShareInvitationPending = true;
          } else {
            // Build detailed message for share-folder
            const folderName = parameters.folderTitle ? `"${parameters.folderTitle}"` : 'folder';
            actionMessage = `Shared ${folderName} folder with ${parameters.user}`;
            if (parameters.action) {
              actionMessage += ` (Action: ${parameters.action})`;
            }
            
            // Add permissions details
            const folderPerms = [];
            if (parameters.manage_records === true) folderPerms.push('Manage Records');
            if (parameters.manage_users === true) folderPerms.push('Manage Users');
            if (parameters.can_share === true) folderPerms.push('Can Share');
            if (parameters.can_edit === true) folderPerms.push('Can Edit');
            
            if (folderPerms.length > 0) {
              actionMessage += ` - Permissions: ${folderPerms.join(', ')}`;
            }
            
            // Add expiration info
            if (parameters.expiration_type === 'expire-at' && parameters.expire_at) {
              actionMessage += ` - Expires at: ${parameters.expire_at.replace('T', ' ')}`;
            } else if (parameters.expiration_type === 'expire-in' && parameters.expire_in) {
              actionMessage += ` - Expires in: ${parameters.expire_in}`;
            }
          }
          break;
          
          default:
            actionMessage = data.message || 'Keeper action executed successfully';
        }
      }
      
      // Build ADF content with panel (matching save/reject request format)
      let panelTitle = 'Keeper Request Approved and Executed';
      if (isEpmCommand) {
        if (command.includes('--approve')) {
          panelTitle = 'Endpoint Privilege Approval Request - Approved';
        } else if (command.includes('--deny')) {
          panelTitle = 'Endpoint Privilege Approval Request - Denied';
        }
      } else if (isShareInvitationPending) {
        panelTitle = 'Keeper Request - Share Invitation Sent';
      }
      
      const contentArray = [
        {
          type: 'text',
          text: panelTitle,
          marks: [{ type: 'strong' }]
        },
        {
          type: 'hardBreak'
        },
        {
          type: 'text',
          text: `Action: ${actionDescription}`
        },
        {
          type: 'hardBreak'
        },
        {
          type: 'text',
          text: `Result: ${actionMessage}`
        }
      ];
      
      // Note: Record UID is intentionally not included in comments to avoid exposing it to non-admin users
      
      // Add executed by and timestamp
      contentArray.push({
        type: 'hardBreak'
      });
      contentArray.push({
        type: 'text',
        text: `Executed by: ${currentUser.displayName}`,
        marks: [{ type: 'em' }]
      });
      contentArray.push({
        type: 'hardBreak'
      });
      contentArray.push({
        type: 'text',
        text: `Executed at: ${timestamp}`,
        marks: [{ type: 'em' }]
      });
      
      // Use different panel types for different scenarios
      let panelType = 'success';
      if (isEpmCommand && command.includes('--deny')) {
        panelType = 'warning';
      } else if (isShareInvitationPending) {
        panelType = 'info';
      }
      
      const adfBody = {
        version: 1,
        type: 'doc',
        content: [
          {
            type: 'panel',
            attrs: {
              panelType: panelType
            },
            content: [
              {
                type: 'paragraph',
                content: contentArray
              }
            ]
          }
        ]
      };

      // For EPM commands, add appropriate label FIRST (before comment) to prevent race conditions
      if (isEpmCommand) {
        try {
          // Get current labels (with rate limit retry)
          const issueResponse = await requestJiraAsAppWithRetry(
            route`/rest/api/3/issue/${issueKey}?fields=labels`,
            {
              method: 'GET',
              headers: { 'Accept': 'application/json' }
            },
            'Get labels for EPM update'
          );
          
          const issueData = await issueResponse.json();
          const currentLabels = issueData.fields?.labels || [];
          
          // Determine which label to add
          let newLabel = '';
          if (command.includes('--approve')) {
            newLabel = 'epm-approved';
          } else if (command.includes('--deny')) {
            newLabel = 'epm-denied';
          }
          
          // Add new label if not already present (with rate limit retry)
          if (newLabel && !currentLabels.includes(newLabel)) {
            const updatedLabels = [...currentLabels, newLabel];
            
            await requestJiraAsAppWithRetry(
              route`/rest/api/3/issue/${issueKey}`,
              {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  fields: {
                    labels: updatedLabels
                  }
                }),
              },
              'Update EPM label'
            );
          }
        } catch (labelErr) {
          logger.error('Failed to add EPM label', labelErr);
          // Don't fail the entire operation if label update fails
        }
      }
      
      // Add comment back to Jira using ADF format (after label is set, with rate limit retry)
      await requestJiraAsAppWithRetry(
        route`/rest/api/3/issue/${issueKey}/comment`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            body: adfBody,
          }),
        },
        'Add command result comment'
      );
    }

    // Clear stored request data after successful execution (admin approval completed)
    try {
      await storage.delete(`keeper_request_${issueKey}`);
    } catch (deleteErr) {
      // Don't fail the entire operation if cleanup fails
    }
    
    return { 
      success: true, 
      message: 'Keeper action executed successfully and comment added to issue.',
      record_uid: record_uid
    };
  } catch (err) {
    // Check for specific error types and provide user-friendly messages
    const errorMessage = err.message || String(err);
    
    // Check if this is an input validation error
    if (errorMessage.startsWith('Input validation failed:')) {
      const validationDetails = errorMessage.replace('Input validation failed: ', '');
      return validationError('parameters', validationDetails);
    }
    
    // Check if this is a rate limit error
    if (err.rateLimited) {
      return rateLimitError(
        err.limitType || 'minute',
        err.retryAfter || 60,
        0
      );
    }
    
    // Check if this is a record owner error (user already owns the record)
    if (isRecordOwnerError(errorMessage)) {
      return errorResponse(
        ERROR_CODES.KEEPER_PERMISSION_DENIED,
        'Cannot share record with its owner. The selected user is the current owner of this record and already has full permissions.',
        { troubleshooting: ['Select a different user to share with', 'The record owner already has full access'] }
      );
    }
    
    // Check if this is a permission conflict error
    if (isPermissionConflictError(errorMessage)) {
      return errorResponse(
        ERROR_CODES.KEEPER_PERMISSION_DENIED,
        'Cannot grant access - permission conflict. The user may already have different access to this record. Please revoke their existing access first, then try again.',
        { troubleshooting: ['Revoke existing access for this user first', 'Then grant the new access level'] }
      );
    }
    
    // Return Keeper error with automatic error type detection
    return keeperError(errorMessage, err);
  }
});

/**
 * Helper function to detect record owner/share errors from Keeper API response
 * This is a fallback - the pre-check should catch owner issues before command execution
 */
function isRecordOwnerError(errorMessage) {
  if (!errorMessage) return false;
  const lowerError = errorMessage.toLowerCase();
  
  // Pattern: "Failed to change record... access permissions for user" 
  // This happens when trying to share with the owner (owner gets revoked, then share fails)
  if (lowerError.includes('failed to change record') && 
      lowerError.includes('access permissions')) {
    return true;
  }
  
  // Pattern: "Failed to change" + "permissions"
  if (lowerError.includes('failed to change') && 
      lowerError.includes('permissions')) {
    return true;
  }
  
  return false;
}

/**
 * Helper function to detect permission conflict errors from Keeper API response
 * Similar to Slack app's is_permission_conflict_error utility
 */
function isPermissionConflictError(errorMessage) {
  if (!errorMessage) return false;
  const lowerError = errorMessage.toLowerCase();
  
  // Check for patterns that indicate permission conflict
  return lowerError.includes('permission') && (
    lowerError.includes('conflict') ||
    lowerError.includes('already exists') ||
    lowerError.includes('already has')
  ) || lowerError.includes('share already exists');
}

/**
 * Reject Keeper request (called from issue panel)
 */
resolver.define('rejectKeeperRequest', async (req) => {
  const { issueKey, rejectionReason, formattedTimestamp } = req.payload;
  
  logger.info('rejectKeeperRequest: Processing Keeper request rejection', { issueKey });
  
  if (!issueKey) {
    return validationError('issueKey', 'Issue key is required');
  }
  
  if (!rejectionReason || !rejectionReason.trim()) {
    return validationError('rejectionReason', 'Rejection reason is required');
  }

  try {
    // Get current user info
    const currentUser = await getCurrentUser();

    // Create ADF (Atlassian Document Format) for the rejection comment
    const adfBody = {
      version: 1,
      type: 'doc',
      content: [
        {
          type: 'panel',
          attrs: {
            panelType: 'error'
          },
          content: [
            {
              type: 'paragraph',
              content: [
                {
                  type: 'text',
                  text: 'Keeper Request Rejected',
                  marks: [{ type: 'strong' }]
                },
                {
                  type: 'hardBreak'
                },
                {
                  type: 'text',
                  text: `Reason: ${rejectionReason.trim()}`
                },
                {
                  type: 'hardBreak'
                },
                {
                  type: 'text',
                  text: `Rejected by: ${currentUser.displayName}`,
                  marks: [{ type: 'em' }]
                },
                {
                  type: 'hardBreak'
                },
                {
                  type: 'text',
                  text: `Rejected at: ${formattedTimestamp}`,
                  marks: [{ type: 'em' }]
                }
              ]
            }
          ]
        }
      ]
    };

    // Add rejection comment to Jira using ADF format (with rate limit retry)
    await requestJiraAsAppWithRetry(
      route`/rest/api/3/issue/${issueKey}/comment`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          body: adfBody,
        }),
      },
      'Add rejection comment'
    );

    // Clear stored request data after rejection (admin review completed)
    try {
      await storage.delete(`keeper_request_${issueKey}`);
    } catch (deleteErr) {
      // Don't fail the entire operation if cleanup fails
    }
    
    return { 
      success: true, 
      message: 'Request has been rejected and a comment has been added to the issue.' 
    };
  } catch (err) {
    throw err;
  }
});

/**
 * Activate Keeper panel for all users on an issue
 */
resolver.define('activateKeeperPanel', async (req) => {
  const { issueKey } = req.payload;
  
  if (!issueKey) {
    throw new Error('Issue key is required');
  }
  
  try {
    // Activate the Keeper panel for this issue (with rate limit retry)
    // This makes the panel visible to all users viewing the issue
    await requestJiraAsAppWithRetry(
      route`/rest/api/3/issue/${issueKey}/properties/keeper-panel-activated`,
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          value: {
            activated: true,
            activatedAt: new Date().toISOString(),
            activatedBy: 'system'
          }
        }),
      },
      'Activate Keeper panel'
    );
    
    return { 
      success: true, 
      message: 'Keeper panel activated for all users on this issue' 
    };
  } catch (err) {
    // Don't throw error - panel activation is not critical
    return { 
      success: false, 
      message: 'Panel activation failed, but app will still work' 
    };
  }
});

/**
 * Get user role - check if current user is admin using Jira permissions API
 */
resolver.define('getUserRole', async (req) => {
  const { issueKey } = req.payload;
  
  if (!issueKey) {
    throw new Error('Issue key is required');
  }
  
  try {
    // Extract project key from issue key (e.g., "DM-5" -> "DM")
    const projectKey = issueKey.split('-')[0];
    
    if (!projectKey) {
      throw new Error('Unable to extract project key from issue key');
    }
    
    let userApiResponse = null;
    let permissionsApiResponse = null;
    
    // Get current user info
    try {
      const userData = await getCurrentUser();
        
      if (userData && Object.keys(userData).length > 0) {
        userApiResponse = userData;
      }
    } catch (userErr) {
    }
    
    // Get permissions data (with rate limit retry)
    try {
      const permResponse = await requestJiraAsUserWithRetry(
        route`/rest/api/3/mypermissions?projectKey=${projectKey}&permissions=ADMINISTER_PROJECTS`,
        {},
        'Check admin permissions'
      );
      
      if (permResponse && permResponse.ok) {
        const permissionsData = await permResponse.json();
        
        if (permissionsData && Object.keys(permissionsData).length > 0) {
          permissionsApiResponse = permissionsData;
        }
      }
    } catch (permErr) {
    }
    
    // Process results if we have data
    if ((userApiResponse && Object.keys(userApiResponse).length > 0) || 
        (permissionsApiResponse && Object.keys(permissionsApiResponse).length > 0)) {
      
      const hasAdminPermission = permissionsApiResponse?.permissions?.ADMINISTER_PROJECTS?.havePermission === true;
      
      return {
        success: true,
        isAdmin: hasAdminPermission,
        adminCheckMethod: 'project_permissions',
        userKey: userApiResponse?.accountId || userApiResponse?.key || 'unknown',
        displayName: userApiResponse?.displayName || userApiResponse?.name || userApiResponse?.emailAddress || 'User',
        projectKey: projectKey
      };
    }
    
    // Fallback if no data available
    throw new Error('Unable to retrieve user or permissions data');
    
  } catch (err) {
    
    // Try to get project key even on error
    let projectKey = null;
    try {
      projectKey = issueKey.split('-')[0];
    } catch (projectKeyError) {
      // Ignore extraction error
    }
    
    // Default to non-admin on error
    return {
      success: false,
      isAdmin: false,
      adminCheckMethod: 'error_fallback',
      userKey: null,
      displayName: 'User',
      projectKey: projectKey,
      error: err.message
    };
  }
});

/**
 * Get web trigger URL using Forge SDK
 * Returns URL and token separately - token should be used in Authorization header
 */
resolver.define('getWebTriggerUrl', async () => {
  try {
    const url = await webTrigger.getUrl('keeper-alert-trigger');
    const config = await storage.get('webTriggerConfig');
    
    return {
      success: true,
      url: url,
      hasToken: !!(config && config.webhookToken),
      // Include token for display/copy in UI (to configure in Keeper webhook settings)
      bearerToken: config?.webhookToken || null,
      authHeader: config?.webhookToken ? `Bearer ${config.webhookToken}` : null
    };
  } catch (err) {
    throw new Error(`Failed to get web trigger URL: ${err.message}`);
  }
});

/**
 * Get web trigger configuration
 * Note: webhookToken is included so UI can show if token is configured
 */
resolver.define('getWebTriggerConfig', async () => {
  const config = await storage.get('webTriggerConfig');
  if (!config) return {};
  
  // Return config with token presence indicator (not the actual token for security)
  return {
    projectKey: config.projectKey,
    issueType: config.issueType,
    hasWebhookToken: !!config.webhookToken,
    webhookTokenPreview: config.webhookToken 
      ? `${config.webhookToken.substring(0, 8)}...${config.webhookToken.substring(config.webhookToken.length - 4)}`
      : null
  };
});

/**
 * Save web trigger configuration
 */
resolver.define('setWebTriggerConfig', async (req) => {
  let payload = req?.payload?.payload || req?.payload || req;
  
  if (!payload) {
    throw new Error('No payload provided');
  }
  
  const projectKey = payload.projectKey;
  const issueType = payload.issueType;
  
  logger.info('setWebTriggerConfig: Saving web trigger configuration', { projectKey, issueType });
  
  // Get existing config to preserve the token if not being changed
  const existingConfig = await storage.get('webTriggerConfig') || {};
  
  const configToSave = { 
    projectKey, 
    issueType,
    // Preserve existing token unless explicitly clearing it
    webhookToken: existingConfig.webhookToken
  };
  
  await storage.set('webTriggerConfig', configToSave);
  
  logger.info('setWebTriggerConfig: Web trigger configuration saved');
  return { success: true, message: 'Web trigger configuration saved successfully' };
});

/**
 * Generate or regenerate webhook authentication token
 * This creates a new secure token that must be included in the Authorization header
 * Format: Authorization: Bearer <token>
 */
resolver.define('generateWebhookToken', async (req) => {
  logger.info('generateWebhookToken: Generating new webhook authentication token');
  
  try {
    // Generate a new secure token
    const newToken = generateWebhookToken();
    
    // Get existing config
    const existingConfig = await storage.get('webTriggerConfig') || {};
    
    // Update config with new token
    const updatedConfig = {
      ...existingConfig,
      webhookToken: newToken,
      tokenGeneratedAt: new Date().toISOString()
    };
    
    await storage.set('webTriggerConfig', updatedConfig);
    
    // Get the webhook URL
    const webhookUrl = await webTrigger.getUrl('keeper-alert-trigger');
    
    logger.info('generateWebhookToken: Webhook token generated successfully');
    
    return {
      success: true,
      message: 'Webhook token generated successfully. Configure your Keeper webhook with the Authorization header.',
      webhookUrl: webhookUrl,
      bearerToken: newToken,
      authHeader: `Bearer ${newToken}`,
      tokenPreview: `${newToken.substring(0, 8)}...${newToken.substring(newToken.length - 4)}`,
      generatedAt: updatedConfig.tokenGeneratedAt,
      instructions: 'Add this header to your Keeper webhook configuration: Authorization: Bearer <token>'
    };
  } catch (err) {
    logger.error('generateWebhookToken: Failed to generate webhook token', { error: err.message });
    throw new Error(`Failed to generate webhook token: ${err.message}`);
  }
});

/**
 * Revoke webhook token (disable token authentication)
 * WARNING: This makes the webhook URL accessible without authentication
 */
resolver.define('revokeWebhookToken', async () => {
  try {
    // Get existing config
    const existingConfig = await storage.get('webTriggerConfig') || {};
    
    // Remove token from config
    const updatedConfig = {
      projectKey: existingConfig.projectKey,
      issueType: existingConfig.issueType
      // Deliberately not including webhookToken
    };
    
    await storage.set('webTriggerConfig', updatedConfig);
    
    return {
      success: true,
      message: 'Webhook token revoked. WARNING: The webhook URL is now accessible without authentication.',
      warning: 'Token authentication disabled. Consider generating a new token for security.'
    };
  } catch (err) {
    throw new Error(`Failed to revoke webhook token: ${err.message}`);
  }
});

/**
 * Get webhook audit logs
 * Returns the last 100 webhook attempts for monitoring
 */
resolver.define('getWebhookAuditLogs', async () => {
  try {
    const logs = await storage.get('webhook-audit-log') || [];
    return {
      success: true,
      logs: logs,
      count: logs.length
    };
  } catch (err) {
    throw new Error(`Failed to get webhook audit logs: ${err.message}`);
  }
});

/**
 * Clear webhook audit logs
 */
resolver.define('clearWebhookAuditLogs', async () => {
  try {
    await storage.delete('webhook-audit-log');
    return {
      success: true,
      message: 'Webhook audit logs cleared'
    };
  } catch (err) {
    throw new Error(`Failed to clear webhook audit logs: ${err.message}`);
  }
});

/**
 * Get current user's rate limit status
 * Returns remaining commands in minute/hour windows
 */
resolver.define('getRateLimitStatus', async (req) => {
  const userId = req?.context?.accountId;
  
  try {
    const status = await getRateLimitStatus(userId);
    return {
      success: true,
      ...status
    };
  } catch (err) {
    throw new Error(`Failed to get rate limit status: ${err.message}`);
  }
});

/**
 * Get all Jira projects
 */
resolver.define('getJiraProjects', async () => {
  try {
    const response = await requestJiraAsAppWithRetry(
      route`/rest/api/3/project`,
      {},
      'Get Jira projects'
    );
    
    if (!response.ok) {
      throw new Error(`Failed to fetch projects: ${response.status}`);
    }
    
    const projects = await response.json();
    
    return {
      success: true,
      projects: projects || []
    };
  } catch (err) {
    throw new Error(`Failed to fetch Jira projects: ${err.message}`);
  }
});

/**
 * Get issue types for a specific project
 */
resolver.define('getProjectIssueTypes', async (req) => {
  let payload = req?.payload?.payload || req?.payload || req;
  
  if (!payload || !payload.projectKey) {
    throw new Error('Project key is required');
  }
  
  const { projectKey } = payload;
  
  try {
    // Get project details which includes issue types (with rate limit retry)
    const response = await requestJiraAsAppWithRetry(
      route`/rest/api/3/project/${projectKey}`,
      {},
      'Get project issue types'
    );
    
    if (!response.ok) {
      throw new Error(`Failed to fetch project: ${response.status}`);
    }
    
    const project = await response.json();
    
    // Extract issue types from project
    const issueTypes = project.issueTypes || [];
    
    return {
      success: true,
      issueTypes: issueTypes
    };
  } catch (err) {
    throw new Error(`Failed to fetch issue types: ${err.message}`);
  }
});

/**
 * Test web trigger by creating a test issue
 */
resolver.define('testWebTrigger', async (req) => {
  let payload = req?.payload?.payload || req?.payload || req;
  
  if (!payload) {
    throw new Error('No payload provided');
  }
  
  const { projectKey, issueType } = payload;
  
  if (!projectKey || !issueType) {
    throw new Error('Project key and issue type are required');
  }
  
  try {
    // Create a test issue (with rate limit retry)
    const response = await requestJiraAsAppWithRetry(
      route`/rest/api/3/issue`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fields: {
            project: {
              key: projectKey
            },
            summary: `Keeper Security Alert - Test Trigger [${new Date().toISOString()}]`,
            description: {
              type: 'doc',
              version: 1,
              content: [
                {
                  type: 'paragraph',
                  content: [
                    {
                      type: 'text',
                      text: 'This is a test issue created by the Keeper Security web trigger. This confirms that your web trigger configuration is working correctly.'
                    }
                  ]
                }
              ]
            },
            issuetype: {
              name: issueType
            },
            labels: ['keeper-webhook', 'keeper-test']
          }
        })
      },
      'Create test issue'
    );
    
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Failed to create test issue: ${response.status} - ${errorText}`);
    }
    
    const issue = await response.json();
    
    return {
      success: true,
      message: 'Test issue created successfully!',
      issueKey: issue.key,
      issueUrl: issue.self
    };
  } catch (err) {
    throw new Error(`Failed to test web trigger: ${err.message}`);
  }
});

/**
 * Test web trigger with full payload (simulating actual webhook call)
 */
resolver.define('testWebTriggerWithPayload', async (req) => {
  let payload = req?.payload?.payload || req?.payload || req;
  
  if (!payload) {
    throw new Error('No payload provided');
  }
  
  try {
    // Get the web trigger configuration
    const config = await storage.get('webTriggerConfig');
    
    if (!config || !config.projectKey || !config.issueType) {
      throw new Error('Web trigger not configured. Please configure project and issue type first.');
    }
    
    // Extract alert details from payload
    const summary = payload.summary || payload.alert_name || payload.message || `Keeper Security Alert - ${new Date().toISOString()}`;
    const description = payload.description || payload.message || 'A security alert was received from Keeper Security.';
    const alertType = payload.alertType || payload.alert_type || 'security_alert';
    const severity = payload.severity || 'medium';
    const source = payload.source || 'keeper_security';
    
    // Build detailed description in ADF format
    const adfDescription = {
      type: 'doc',
      version: 1,
      content: [
        {
          type: 'paragraph',
          content: [
            {
              type: 'text',
              text: description
            }
          ]
        },
        {
          type: 'paragraph',
          content: [
            {
              type: 'text',
              text: '\n\nAlert Details:',
              marks: [{ type: 'strong' }]
            }
          ]
        },
        {
          type: 'bulletList',
          content: [
            {
              type: 'listItem',
              content: [
                {
                  type: 'paragraph',
                  content: [
                    {
                      type: 'text',
                      text: `Alert Type: ${alertType}`,
                      marks: [{ type: 'strong' }]
                    }
                  ]
                }
              ]
            },
            {
              type: 'listItem',
              content: [
                {
                  type: 'paragraph',
                  content: [
                    {
                      type: 'text',
                      text: `Severity: ${severity.toUpperCase()}`,
                      marks: [{ type: 'strong' }]
                    }
                  ]
                }
              ]
            },
            {
              type: 'listItem',
              content: [
                {
                  type: 'paragraph',
                  content: [
                    {
                      type: 'text',
                      text: `Source: ${source}`
                    }
                  ]
                }
              ]
            },
            {
              type: 'listItem',
              content: [
                {
                  type: 'paragraph',
                  content: [
                    {
                      type: 'text',
                      text: `Timestamp: ${payload.timestamp || new Date().toISOString()}`
                    }
                  ]
                }
              ]
            }
          ]
        }
      ]
    };
    
    // Add user information if present
    if (payload.user || payload.username) {
      const userEmail = payload.user?.email || payload.username || 'Unknown';
      adfDescription.content.push({
        type: 'paragraph',
        content: [
          {
            type: 'text',
            text: `\nUser: ${userEmail}`
          }
        ]
      });
    }
    
    // Add additional details if present
    if (payload.details) {
      adfDescription.content.push({
        type: 'paragraph',
        content: [
          {
            type: 'text',
            text: '\n\nAdditional Information:',
            marks: [{ type: 'strong' }]
          }
        ]
      });
      adfDescription.content.push({
        type: 'codeBlock',
        attrs: { language: 'json' },
        content: [
          {
            type: 'text',
            text: JSON.stringify(payload.details, null, 2)
          }
        ]
      });
    }
    
    // Determine labels based on payload
    const labels = ['keeper-webhook'];
    if (payload.source === 'keeper_admin_test' || payload.details?.test) {
      labels.push('keeper-webhook-test');
    }
    if (severity) {
      labels.push(`severity-${severity.toLowerCase()}`);
    }
    if (alertType) {
      labels.push(alertType.toLowerCase().replace(/_/g, '-'));
    }
    
    // Create the Jira issue (with rate limit retry)
    const response = await requestJiraAsAppWithRetry(
      route`/rest/api/3/issue`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fields: {
            project: {
              key: config.projectKey
            },
            summary: summary,
            description: adfDescription,
            issuetype: {
              name: config.issueType
            },
            labels: labels
          }
        })
      },
      'Create webhook issue'
    );
    
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Failed to create issue: ${errorText}`);
    }
    
    const issue = await response.json();
    
    // For EPM approval requests (test or real), assign to a project admin
    if (payload.category === 'endpoint_privilege_manager' && payload.audit_event === 'approval_request_created') {
      try {
        // Get project admins
        const projectKey = config.projectKey;
        
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
                  route`/rest/api/3/issue/${issue.key}`,
                  {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                      fields: {
                        assignee: {
                          accountId: assigneeAccountId
                        }
                      }
                    })
                  },
                  'Assign EPM ticket to admin'
                );
                logger.info('Assigned EPM ticket to project admin', { issueKey: issue.key });
              }
            }
          }
        }
      } catch (assignError) {
        logger.error('Failed to assign ticket to project admin', assignError);
        // Don't fail the entire test if assignment fails
      }
    }
    
    return {
      success: true,
      message: 'Issue created successfully via webhook test',
      issueKey: issue.key,
      issueId: issue.id,
      labels: labels
    };
    
  } catch (error) {
    throw new Error(`Failed to test web trigger: ${error.message}`);
  }
});

/**
 * Fetch tickets created by webhook (with keeper-webhook label)
 */
resolver.define('getWebhookTickets', async (req) => {
  try {
    const config = await storage.get('webTriggerConfig');
    
    if (!config || !config.projectKey) {
      return {
        success: false,
        message: 'Web trigger not configured',
        issues: []
      };
    }
    
    // Build JQL to find issues with keeper-webhook label in configured project
    const jql = `project = ${config.projectKey} AND labels = keeper-webhook ORDER BY created DESC`;
    
    // Fetch issues using the new JQL enhanced search API (with rate limit retry)
    const response = await requestJiraAsAppWithRetry(
      route`/rest/api/3/search/jql`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jql: jql,
          maxResults: 100,
          fields: ['summary', 'created', 'description', 'status', 'labels', 'key', 'issuetype']
        })
      },
      'Search webhook tickets'
    );
    
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Failed to fetch webhook tickets: ${errorText}`);
    }
    
    const data = await response.json();
    
    // Format the issues for frontend consumption
    const issues = data.issues.map(issue => {
      // Extract JSON payload from description if it exists
      let jsonPayload = null;
      try {
        // The description is in ADF format, look for codeBlock with JSON
        const description = issue.fields.description;
        if (description && description.content) {
          const codeBlock = description.content.find(
            block => block.type === 'codeBlock' && block.attrs?.language === 'json'
          );
          if (codeBlock && codeBlock.content && codeBlock.content[0]?.text) {
            jsonPayload = JSON.parse(codeBlock.content[0].text);
          }
        }
      } catch (e) {
        logger.error('Failed to parse JSON from description', e);
      }
      
      // Extract request UID - check multiple possible field names
      // 1. Basic webhook payload uses: request_uid
      // 2. Enriched EPM data uses: approval_uid
      // 3. Fallback: extract from labels (format: request-<uid>)
      let requestUid = jsonPayload?.request_uid || jsonPayload?.approval_uid || null;
      if (!requestUid) {
        const labels = issue.fields.labels || [];
        const requestLabel = labels.find(label => label.startsWith('request-'));
        if (requestLabel) {
          requestUid = requestLabel.replace('request-', '');
        }
      }
      
      // Extract username - check multiple possible field names
      // 1. Basic webhook payload uses: username
      // 2. Enriched EPM data uses: account_info.Username
      let username = jsonPayload?.username || 
                     jsonPayload?.account_info?.Username || 
                     null;
      
      // If this is enriched EPM data, try to get additional info
      const isEpmEnriched = !!jsonPayload?.approval_uid || !!jsonPayload?.account_info;
      
      // For description, prefer specific fields over summary
      let ticketDescription = issue.fields.summary;
      if (jsonPayload) {
        if (jsonPayload.description) {
          ticketDescription = jsonPayload.description;
        } else if (isEpmEnriched && jsonPayload.approval_type) {
          // For EPM tickets, create a meaningful description
          ticketDescription = `${jsonPayload.approval_type || 'EPM'} Request - ${requestUid || 'Unknown'}`;
          if (username) {
            ticketDescription = `${username} - ${ticketDescription}`;
          }
        }
      }
      
      return {
        key: issue.key,
        id: issue.id,
        summary: issue.fields.summary,
        created: issue.fields.created,
        status: issue.fields.status?.name || 'Unknown',
        labels: issue.fields.labels || [],
        issueType: issue.fields.issuetype?.name || 'Unknown',
        description: ticketDescription,
        requestUid: requestUid,
        agentUid: jsonPayload?.agent_uid || jsonPayload?.account_info?.agent_uid || null,
        username: username,
        category: jsonPayload?.category || (isEpmEnriched ? 'endpoint_privilege_manager' : null),
        auditEvent: jsonPayload?.audit_event || (isEpmEnriched ? 'approval_request_created' : null),
        alertName: jsonPayload?.alert_name || (isEpmEnriched ? 'EPM Approval Request' : null)
      };
    });
    
    return {
      success: true,
      issues: issues,
      total: data.total
    };
    
  } catch (error) {
    logger.error('Error fetching webhook tickets', error);
    throw new Error(`Failed to fetch webhook tickets: ${error.message}`);
  }
});

/**
 * Get webhook payload data from current issue description
 */
resolver.define('getWebhookPayload', async (req) => {
  const issueKey = req.payload?.issueKey;
  
  if (!issueKey) {
    throw new Error('Issue key is required');
  }
  
  try {
    // Fetch the issue with description field (with rate limit retry)
    const response = await requestJiraAsAppWithRetry(
      route`/rest/api/3/issue/${issueKey}?fields=description,labels`,
      {
        method: 'GET',
        headers: { 'Accept': 'application/json' }
      },
      'Get webhook payload'
    );
    
    if (!response.ok) {
      throw new Error(`Failed to fetch issue: ${response.statusText}`);
    }
    
    const issue = await response.json();
    const description = issue.fields?.description;
    const labels = issue.fields?.labels || [];
    
    // Extract JSON payload from description
    let webhookPayload = null;
    if (description && description.content) {
      const codeBlock = description.content.find(
        block => block.type === 'codeBlock' && block.attrs?.language === 'json'
      );
      if (codeBlock && codeBlock.content && codeBlock.content[0]?.text) {
        try {
          webhookPayload = JSON.parse(codeBlock.content[0].text);
        } catch (e) {
          logger.error('Failed to parse webhook payload', e);
        }
      }
    }
    
    return {
      success: true,
      payload: webhookPayload,
      labels: labels
    };
    
  } catch (error) {
    logger.error('Error fetching webhook payload', error);
    throw new Error(`Failed to fetch webhook payload: ${error.message}`);
  }
});

/**
 * Check if EPM request is already expired (has the issue property)
 */
resolver.define('checkEpmExpired', async (req) => {
  const { issueKey } = req.payload;
  
  if (!issueKey) {
    throw new Error('Issue key is required');
  }
  
  try {
    const propertyResponse = await requestJiraAsAppWithRetry(
      route`/rest/api/3/issue/${issueKey}/properties/epm-request-expired`,
      {
        method: 'GET',
        headers: { 'Accept': 'application/json' }
      },
      'Check EPM expiration property'
    );
    
    // If property exists, it's expired
    if (propertyResponse.ok) {
      const propertyData = await propertyResponse.json();
      return { 
        success: true, 
        isExpired: true,
        expiredData: propertyData.value
      };
    }
    
    return { 
      success: true, 
      isExpired: false 
    };
  } catch (error) {
    logger.error('Error checking EPM expiration', error);
    return { 
      success: true, 
      isExpired: false 
    };
  }
});

/**
 * Add comment for expired EPM approval request
 */
/**
 * Check if EPM action was already taken by checking labels
 */
resolver.define('checkEpmActionTaken', async (req) => {
  const { issueKey } = req.payload;
  
  if (!issueKey) {
    throw new Error('Issue key is required');
  }
  
  try {
    // Fetch issue labels (with rate limit retry)
    const issueResponse = await requestJiraAsAppWithRetry(
      route`/rest/api/3/issue/${issueKey}?fields=labels`,
      {
        method: 'GET',
        headers: { 'Accept': 'application/json' }
      },
      'Check EPM action labels'
    );
    
    if (!issueResponse.ok) {
      throw new Error('Failed to fetch issue details');
    }
    
    const issueData = await issueResponse.json();
    const labels = issueData.fields?.labels || [];
    
    // Check for EPM action labels
    if (labels.includes('epm-approved')) {
      return { 
        success: true, 
        actionTaken: true, 
        action: 'approved',
        message: 'Request already approved'
      };
    }
    
    if (labels.includes('epm-denied')) {
      return { 
        success: true, 
        actionTaken: true, 
        action: 'denied',
        message: 'Request already denied'
      };
    }
    
    if (labels.includes('epm-expired')) {
      return { 
        success: true, 
        actionTaken: true, 
        action: 'expired',
        message: 'Request already expired'
      };
    }
    
    // No action label found
    return { 
      success: true, 
      actionTaken: false,
      action: null,
      message: 'No action taken yet'
    };
    
  } catch (err) {
    logger.error('Error checking EPM action', err);
    return { 
      success: false, 
      actionTaken: false,
      action: null,
      message: err.message 
    };
  }
});

resolver.define('addEpmExpiredComment', async (req) => {
  const { issueKey, formattedTimestamp } = req.payload;
  
  if (!issueKey) {
    throw new Error('Issue key is required');
  }
  
  try {
    // FIRST: Try to set the issue property as a lock to prevent race conditions
    // Check if property already exists (with rate limit retry)
    const propertyCheckResponse = await requestJiraAsAppWithRetry(
      route`/rest/api/3/issue/${issueKey}/properties/epm-request-expired`,
      {
        method: 'GET',
        headers: { 'Accept': 'application/json' }
      },
      'Check EPM expiration lock'
    );
    
    // If property already exists, someone else already processed this
    if (propertyCheckResponse.ok) {
      return { 
        success: true, 
        message: 'Expired comment already processed',
        alreadyExpired: true
      };
    }
    
    // Check if any action label already exists (expired, approved, or denied, with rate limit retry)
    const issueResponse = await requestJiraAsAppWithRetry(
      route`/rest/api/3/issue/${issueKey}?fields=labels`,
      {
        method: 'GET',
        headers: { 'Accept': 'application/json' }
      },
      'Check action labels for expiration'
    );
    
    if (issueResponse.ok) {
      const issueData = await issueResponse.json();
      const labels = issueData.fields?.labels || [];
      
      if (labels.includes('epm-approved') || 
          labels.includes('epm-denied') || 
          labels.includes('epm-expired')) {
        return { 
          success: true, 
          message: 'Action already taken (label found)',
          alreadyExpired: true
        };
      }
    }
    
    // Set the property BEFORE adding comment (as a lock, with rate limit retry)
    await requestJiraAsAppWithRetry(
      route`/rest/api/3/issue/${issueKey}/properties/epm-request-expired`,
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          value: {
            expired: true,
            expiredAt: new Date().toISOString(),
            processing: true // Mark as being processed
          }
        }),
      },
      'Set EPM expiration lock'
    );
    
    // Get current user info (the one viewing when it expired)
    const currentUser = await getCurrentUser();
    
    const timestamp = formattedTimestamp || new Date().toLocaleString();
    
    // Create ADF for the expired comment
    const adfBody = {
      version: 1,
      type: 'doc',
      content: [
        {
          type: 'panel',
          attrs: {
            panelType: 'error'
          },
          content: [
            {
              type: 'paragraph',
              content: [
                {
                  type: 'text',
                  text: 'Endpoint Privilege Approval Request - Expired',
                  marks: [{ type: 'strong' }]
                },
                {
                  type: 'hardBreak'
                },
                {
                  type: 'text',
                  text: 'This approval request has expired (30 minutes time limit exceeded)'
                },
                {
                  type: 'hardBreak'
                },
                {
                  type: 'text',
                  text: `Viewed by: ${currentUser.displayName}`,
                  marks: [{ type: 'em' }]
                },
                {
                  type: 'hardBreak'
                },
                {
                  type: 'text',
                  text: `Checked at: ${timestamp}`,
                  marks: [{ type: 'em' }]
                }
              ]
            }
          ]
        }
      ]
    };
    
    // Add 'epm-expired' label FIRST (before comment) to prevent race conditions
    try {
      // Get current labels (we already fetched this earlier, but need fresh data, with rate limit retry)
      const labelResponse = await requestJiraAsAppWithRetry(
        route`/rest/api/3/issue/${issueKey}?fields=labels`,
        {
          method: 'GET',
          headers: { 'Accept': 'application/json' }
        },
        'Get labels for expiration'
      );
      
      const labelData = await labelResponse.json();
      const currentLabels = labelData.fields?.labels || [];
      
      // Add expired label if not already present (with rate limit retry)
      if (!currentLabels.includes('epm-expired')) {
        const updatedLabels = [...currentLabels, 'epm-expired'];
        
        await requestJiraAsAppWithRetry(
          route`/rest/api/3/issue/${issueKey}`,
          {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              fields: {
                labels: updatedLabels
              }
            }),
          },
          'Add epm-expired label'
        );
      }
    } catch (labelErr) {
      logger.error('Failed to add epm-expired label', labelErr);
      // Don't fail the entire operation if label update fails
    }
    
    // Now add comment to Jira (after label is set, with rate limit retry)
    await requestJiraAsAppWithRetry(
      route`/rest/api/3/issue/${issueKey}/comment`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          body: adfBody,
        }),
      },
      'Add expiration comment'
    );
    
    // Update issue property with final details (with rate limit retry)
    await requestJiraAsAppWithRetry(
      route`/rest/api/3/issue/${issueKey}/properties/epm-request-expired`,
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          value: {
            expired: true,
            expiredAt: new Date().toISOString(),
            markedBy: currentUser.displayName,
            processing: false // Mark as complete
          }
        }),
      },
      'Update expiration property'
    );
    
    return { 
      success: true, 
      message: 'Expired comment added successfully',
      alreadyExpired: false
    };
  } catch (error) {
    logger.error('Error adding expired comment', error);
    throw new Error(`Failed to add expired comment: ${error.message}`);
  }
});

/**
 * Check if current user has Administrator permissions
 * Checks for both Global Admin (ADMINISTER) and Project Admin (ADMINISTER_PROJECTS)
 * Returns true if user has either permission
 */
resolver.define('getGlobalUserRole', async (req) => {
  try {
    let userApiResponse = null;
    let permissionsApiResponse = null;
    
    // Get current user info
    try {
      const userData = await getCurrentUser();
        
      if (userData && Object.keys(userData).length > 0) {
        userApiResponse = userData;
      }
    } catch (userErr) {
      // User API call failed - continue with permissions check
    }
    
    // Check for both global admin (ADMINISTER) and project admin (ADMINISTER_PROJECTS) permissions
    // Single API call checks both permission types (with rate limit retry)
    try {
      const permResponse = await requestJiraAsUserWithRetry(
        route`/rest/api/3/mypermissions?permissions=ADMINISTER,ADMINISTER_PROJECTS`,
        {},
        'Check global admin permissions'
      );
      
      if (permResponse && permResponse.ok) {
        const permissionsData = await permResponse.json();
        
        if (permissionsData && Object.keys(permissionsData).length > 0) {
          permissionsApiResponse = permissionsData;
        }
      }
    } catch (permErr) {
      // Permissions API call failed - will use fallback
    }
    
    // Process results if we have data
    if ((userApiResponse && Object.keys(userApiResponse).length > 0) || 
        (permissionsApiResponse && Object.keys(permissionsApiResponse).length > 0)) {
      
      // User is admin if they have either global admin OR project admin permission
      const hasGlobalAdmin = permissionsApiResponse?.permissions?.ADMINISTER?.havePermission === true;
      const hasProjectAdmin = permissionsApiResponse?.permissions?.ADMINISTER_PROJECTS?.havePermission === true;
      const hasAdminPermission = hasGlobalAdmin || hasProjectAdmin;
      
      // Determine admin type for logging and display
      let adminType = 'none';
      if (hasGlobalAdmin && hasProjectAdmin) {
        adminType = 'global_and_project';
      } else if (hasGlobalAdmin) {
        adminType = 'global';
      } else if (hasProjectAdmin) {
        adminType = 'project';
      }
      
      return {
        success: true,
        isAdmin: hasAdminPermission,
        adminCheckMethod: adminType,
        userKey: userApiResponse?.accountId || userApiResponse?.key || 'unknown',
        displayName: userApiResponse?.displayName || userApiResponse?.name || userApiResponse?.emailAddress || 'User'
      };
    }
    
    // Fallback if no data available
    throw new Error('Unable to retrieve user or permissions data');
    
  } catch (err) {
    // Default to non-admin on error
    return {
      success: false,
      isAdmin: false,
      adminCheckMethod: 'error_fallback',
      userKey: null,
      displayName: 'User',
      error: err.message
    };
  }
});

/**
 * Get project admin users - fetch all users who have admin permissions for a project
 */
resolver.define('getProjectAdmins', async (req) => {
  const { issueKey } = req.payload;
  
  if (!issueKey) {
    throw new Error('Issue key is required');
  }
  
  try {
    // Extract project key from issue key (e.g., "DM-5" -> "DM")
    const projectKey = issueKey.split('-')[0];
    
    if (!projectKey) {
      throw new Error('Unable to extract project key from issue key');
    }
    
    // Get project details (with rate limit retry)
    const projectResponse = await requestJiraAsAppWithRetry(
      route`/rest/api/3/project/${projectKey}`,
      {},
      'Get project details'
    );
    const project = await projectResponse.json();
    
    if (!project || !project.id) {
      throw new Error('Unable to fetch project details');
    }
    
    // Get all roles for the project (with rate limit retry)
    const rolesResponse = await requestJiraAsAppWithRetry(
      route`/rest/api/3/project/${projectKey}/role`,
      {},
      'Get project roles'
    );
    const roles = await rolesResponse.json();
    
    // Find the admin role URL - try multiple common names
    let adminRoleUrl = null;
    const possibleAdminRoleNames = ['Administrators', 'Administrator', 'Admins', 'Project Administrators', 'administrators'];
    
    for (const roleName of possibleAdminRoleNames) {
      if (roles && roles[roleName]) {
        adminRoleUrl = roles[roleName];
        break;
      }
    }
    
    if (!adminRoleUrl) {
      throw new Error('Unable to find administrator role for this project. Available roles: ' + Object.keys(roles).join(', '));
    }
    
    // Extract the role ID from the URL
    const roleIdMatch = adminRoleUrl.match(/role\/(\d+)/);
    if (!roleIdMatch) {
      throw new Error('Unable to extract role ID from admin role URL: ' + adminRoleUrl);
    }
    const roleId = roleIdMatch[1];
    
    // Get role details with actors (users, with rate limit retry)
    const roleDetailsResponse = await requestJiraAsAppWithRetry(
      route`/rest/api/3/project/${projectKey}/role/${roleId}`,
      {},
      'Get admin role details'
    );
    const roleDetails = await roleDetailsResponse.json();
    
    if (!roleDetails) {
      throw new Error('Unable to fetch admin role details');
    }
    
    if (!roleDetails.actors || roleDetails.actors.length === 0) {
      throw new Error('No administrators found in this role');
    }
    
    // Extract admin users from actors
    const adminUsers = [];
    
    for (const actor of roleDetails.actors) {
      try {
        let accountId = null;
        
        // Try to extract accountId from different possible structures
        if (actor.actorUser && actor.actorUser.accountId) {
          accountId = actor.actorUser.accountId;
        } else if (actor.id) {
          accountId = actor.id;
        } else if (actor.accountId) {
          accountId = actor.accountId;
        }
        
        if (!accountId) {
          continue;
        }
        
        // Fetch fresh user details from Jira API (with rate limit retry)
        const userResponse = await requestJiraAsAppWithRetry(
          route`/rest/api/3/user?accountId=${accountId}`,
          {},
          'Get user details'
        );
        
        if (!userResponse.ok) {
          continue;
        }
        
        const userData = await userResponse.json();
        
        if (userData && userData.accountId) {
          adminUsers.push({
            accountId: userData.accountId,
            displayName: userData.displayName || userData.name || `User (${userData.accountId.substring(0, 8)})`,
            emailAddress: userData.emailAddress || null,
            avatarUrl: userData.avatarUrls ? 
              (userData.avatarUrls['48x48'] || userData.avatarUrls['32x32'] || userData.avatarUrls['24x24'] || userData.avatarUrls['16x16']) : 
              null
          });
        }
      } catch (userErr) {
        // Continue with next actor if error occurs
      }
    }
    
    if (adminUsers.length === 0) {
      throw new Error('No admin users could be extracted from the role. The role might only contain groups.');
    }
    
    return {
      success: true,
      admins: adminUsers,
      projectKey: projectKey
    };
  } catch (err) {
    throw new Error(`Failed to fetch project admins: ${err.message}`);
  }
});

/**
 * Store request data for admin approval
 */
resolver.define('storeRequestData', async (req) => {
  const { issueKey, requestData, formattedTimestamp } = req.payload;
  
  logger.info('storeRequestData: Storing request data for admin approval', { issueKey });
  
  if (!issueKey) {
    return validationError('issueKey', 'Issue key is required');
  }
  
  if (!requestData) {
    return validationError('requestData', 'Request data is required');
  }
  
  try {
    // Get current user info
    const currentUser = await getCurrentUser();
    
    // Check if there's already stored data to determine if this is an update
    const existingData = await storage.get(`keeper_request_${issueKey}`);
    const isUpdate = !!existingData;
    
    // Store the request data with user info and issue key
    const dataToStore = {
      ...requestData,
      issueKey: issueKey, // Store the issueKey within the data for validation
      submittedBy: {
        userKey: currentUser.accountId,
        displayName: currentUser.displayName,
        emailAddress: currentUser.emailAddress
      },
      submittedAt: new Date().toISOString(),
      status: 'pending'
    };
    
    await storage.set(`keeper_request_${issueKey}`, dataToStore);
    
    // Automatically assign ticket to a random project admin ONLY on first save (not on updates)
    if (!isUpdate) {
      try {
      // Extract project key from issue key
      const projectKey = issueKey.split('-')[0];
      
      if (projectKey) {
        // Get project roles (with rate limit retry)
        const rolesResponse = await requestJiraAsAppWithRetry(
          route`/rest/api/3/project/${projectKey}/role`,
          {},
          'Get roles for auto-assignment'
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
              'Get role actors for auto-assignment'
            );
            const roleDetails = await roleDetailsResponse.json();
            
            // Collect all admin users
            if (roleDetails && roleDetails.actors && roleDetails.actors.length > 0) {
              const adminAccountIds = [];
              
              for (const actor of roleDetails.actors) {
                let accountId = null;
                if (actor.actorUser && actor.actorUser.accountId) {
                  accountId = actor.actorUser.accountId;
                } else if (actor.id) {
                  accountId = actor.id;
                } else if (actor.accountId) {
                  accountId = actor.accountId;
                }
                
                if (accountId) {
                  adminAccountIds.push(accountId);
                }
              }
              
              // Randomly select one admin
              if (adminAccountIds.length > 0) {
                const randomIndex = Math.floor(Math.random() * adminAccountIds.length);
                const selectedAdminAccountId = adminAccountIds[randomIndex];
                
                // Assign ticket to randomly selected admin (with rate limit retry)
                await requestJiraAsAppWithRetry(
                  route`/rest/api/3/issue/${issueKey}`,
                  {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                      fields: {
                        assignee: {
                          accountId: selectedAdminAccountId
                        }
                      }
                    }),
                  },
                  'Auto-assign to admin'
                );
                logger.info('Assigned ticket to random project admin', { issueKey });
              }
            }
          }
        }
      }
    } catch (assignError) {
      logger.error('Failed to assign ticket to project admin', assignError);
      // Don't fail the entire operation if assignment fails
    }
    } // End of if (!isUpdate)
    
    // Add comment to JIRA ticket
    const actionLabel = requestData.selectedAction?.label || 'Keeper Action';
    
    // Use the timestamp formatted on frontend with user's local time
    const timestamp = formattedTimestamp;
    
    const adfBody = {
      version: 1,
      type: 'doc',
      content: [
        {
          type: 'panel',
          attrs: {
            panelType: 'info'
          },
          content: [
            {
              type: 'paragraph',
              content: [
                {
                  type: 'text',
                  text: `Keeper Request ${isUpdate ? 'Updated' : 'Submitted'}`,
                  marks: [{ type: 'strong' }]
                },
                {
                  type: 'hardBreak'
                },
                {
                  type: 'text',
                  text: `Action: ${actionLabel}`
                },
                {
                  type: 'hardBreak'
                },
                {
                  type: 'text',
                  text: `Submitted by: ${currentUser.displayName}`,
                  marks: [{ type: 'em' }]
                },
                {
                  type: 'hardBreak'
                },
                {
                  type: 'text',
                  text: `${isUpdate ? 'Updated' : 'Submitted'} at: ${timestamp}`,
                  marks: [{ type: 'em' }]
                }
              ]
            }
          ]
        }
      ]
    };

    // Add comment to Jira using ADF format (with rate limit retry)
    await requestJiraAsAppWithRetry(
      route`/rest/api/3/issue/${issueKey}/comment`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          body: adfBody,
        }),
      },
      'Add request data comment'
    );
    
    return { 
      success: true, 
      message: 'Request data saved successfully'
    };
  } catch (err) {
    throw err;
  }
});

/**
 * Get stored request data for admin review
 */
resolver.define('getStoredRequestData', async (req) => {
  const { issueKey } = req.payload;
  
  if (!issueKey) {
    throw new Error('Issue key is required');
  }
  
  try {
    const storedData = await storage.get(`keeper_request_${issueKey}`);
    
    if (storedData) {
      // Validate that the stored data is for the correct issue
      if (storedData.issueKey && storedData.issueKey !== issueKey) {
        return { 
          success: false, 
          message: 'Issue key mismatch in stored data'
        };
      }
      
      return { 
        success: true, 
        data: storedData
      };
    } else {
      return { 
        success: true, 
        data: null
      };
    }
  } catch (err) {
    throw err;
  }
});


// Clear stored request data
resolver.define('clearStoredRequestData', async (req) => {
  try {
    // Get issueKey from payload (preferred) or context (fallback)
    const issueKey = req?.payload?.issueKey || req?.context?.extension?.issue?.key;
    
    if (!issueKey) {
      throw new Error('Issue key is required to clear stored data');
    }
    
    const storageKey = `keeper_request_${issueKey}`;
    
    // Clear the stored data
    await storage.delete(storageKey);
    
    // Get current user info for the comment
    const currentUser = await getCurrentUser();
    
    // Format timestamp with user's local time (consistent with save/reject requests)
    const now = new Date();
    const timestamp = now.toLocaleString('en-US', {
      month: '2-digit',
      day: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false
    });
    
    // Create ADF (Atlassian Document Format) comment
    const adfBody = {
      version: 1,
      type: 'doc',
      content: [
        {
          type: 'panel',
          attrs: {
            panelType: 'note'
          },
          content: [
            {
              type: 'paragraph',
              content: [
                {
                  type: 'text',
                  text: 'Keeper Request Cleared',
                  marks: [{ type: 'strong' }]
                },
                {
                  type: 'hardBreak'
                },
                {
                  type: 'text',
                  text: 'The existing request has been cleared by the user.'
                },
                {
                  type: 'hardBreak'
                },
                {
                  type: 'text',
                  text: `Cleared by: ${currentUser.displayName}`,
                  marks: [{ type: 'em' }]
                },
                {
                  type: 'hardBreak'
                },
                {
                  type: 'text',
                  text: `Cleared at: ${timestamp}`,
                  marks: [{ type: 'em' }]
                }
              ]
            }
          ]
        }
      ]
    };
    
    // Add comment to Jira using ADF format (with rate limit retry)
    await requestJiraAsAppWithRetry(
      route`/rest/api/3/issue/${issueKey}/comment`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          body: adfBody,
        }),
      },
      'Add cleared request comment'
    );
    
    return {
      success: true,
      message: "Stored request data cleared successfully"
    };
  } catch (error) {
    return {
      success: false,
      error: error.message || 'Unknown error occurred'
    };
  }
});


/**
 * Web trigger handler - modularized implementation
 * 
 * Enhanced with API integration for fetching EPM approval details
 * See: modules/webhookHandler.js for full implementation
 * 
 * Features:
 * - Fetches detailed approval data from Keeper API
 * - Auto-sync fallback (epm sync-down) if data doesn't exist
 * - Creates enriched tickets with detailed information
 * - Graceful fallback to webhook payload if API unavailable
 * - Auto-assigns to project admin
 */
export { webTriggerHandler };

// Export resolver for frontend calls
// Note: webTriggerHandler now imported from modules/webhookHandler.js
export const handler = resolver.getDefinitions();

// Export same resolver for issue panel - they can share the same functions
export const issuePanelHandler = resolver.getDefinitions();