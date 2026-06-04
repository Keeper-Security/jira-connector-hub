import Resolver from '@forge/resolver';
import { storage, webTrigger } from '@forge/api';
import { testKeeperConnection, executeKeeperCommand as executeKeeperApiCommand, getRateLimitStatus, fetchEpmApprovalDetails } from './modules/keeperApi.js';
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
  epmError,
  deviceError,
  isKeeperNsfUnavailableError,
  nsfNotAvailableError
} from './modules/utils/errorResponse.js';
import { parseNsfFoldersFromRaw, parseNsfRecordsFromRaw } from './modules/utils/nsfParser.js';
import {
  NSF_COMMAND_NAME_MAP,
  NSF_ROLES,
  buildNsfShareFolderArgs,
  buildNsfShareRecordArgs,
  buildNsfRecordPermissionArgs,
  sanitizeNsfDuration
} from './modules/utils/nsfShareCommands.js';
import {
  escapeForSingleQuotes,
  escapeForDoubleQuotes,
  sanitizeJsonObject,
  capitalizeFieldName
} from './modules/utils/commandBuilder.js';
import { maskApiKey, isMaskedApiKey } from './modules/utils/auth.js';
import {
  requireProjectAdmin,
  verifyProjectAdmin
} from './modules/utils/adminGate.js';
import {
  validatePasswordComplexity,
  formatPasswordPolicyError
} from './modules/utils/passwordPolicy.js';

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
 * Get Keeper config (called from frontend).
 *
 * KJ-26-07: The full apiKey is never returned to the client. We return a
 * masked form (`****<last 4 chars>`) so the UI can still indicate that a
 * key is configured and surface its tail for visual verification, while the
 * real secret remains server-side in Forge storage.
 */
resolver.define('getConfig', async () => {
  const config = await storage.get('keeperConfig');
  if (!config) return {};
  const masked = maskApiKey(config.apiKey);
  return { ...config, apiKey: masked };
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
  const submittedApiKey = payload.apiKey;
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
  if (!submittedApiKey || typeof submittedApiKey !== 'string' || !submittedApiKey.trim()) {
    return validationError('apiKey', 'API Key is required');
  }
  
  // KJ-26-07: If the UI round-tripped the masked placeholder (or the
  // explicit keep-existing sentinel), reuse the stored API key instead of
  // overwriting it. This lets users update the URL without re-typing the
  // secret and ensures the masked form is never persisted as a real key.
  let effectiveApiKey = submittedApiKey.trim();
  if (isMaskedApiKey(effectiveApiKey)) {
    const existing = await storage.get('keeperConfig');
    if (!existing?.apiKey) {
      return validationError('apiKey', 'API Key is required');
    }
    effectiveApiKey = existing.apiKey;
  }
  
  // Use the normalized URL (trailing slashes removed)
  const normalizedApiUrl = urlValidation.normalizedUrl;
  
  // ========================================================================
  // Security: Connection Test (prevents saving URLs that don't work)
  // ========================================================================
  
  let connectionWarning = null;
  
  if (!skipConnectionTest) {
    const reachabilityTest = await testApiUrlReachability(normalizedApiUrl, effectiveApiKey);
    
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
    apiKey: effectiveApiKey 
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
  const submittedApiKey = payload.apiKey;
  
  if (!apiUrl || !submittedApiKey) {
    return validationError('apiUrl', 'API URL and API Key are required for testing connection');
  }

  // KJ-26-07: If the UI submitted the masked placeholder (user clicked
  // "Test Connection" without retyping the key), fall back to the stored
  // key so the test actually exercises real credentials.
  let effectiveApiKey = submittedApiKey;
  if (isMaskedApiKey(submittedApiKey)) {
    const existing = await storage.get('keeperConfig');
    if (!existing?.apiKey) {
      return validationError('apiKey', 'API Key is required');
    }
    effectiveApiKey = existing.apiKey;
  }

  try {
    // Use the v2 API test connection function from keeperApi module
    const result = await testKeeperConnection(apiUrl, effectiveApiKey);

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
  
  // Expiration duration: Number with time unit (e.g., 30d, 24h, 60mi, 6mo, 1y)
  duration: /^\d+(mi|mo|d|h|m|s|y)$/i,
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
function validateCommandParameters(action, parameters, options = {}) {
  const errors = [];
  const isNsfMode = !!(options && options.mode === 'nsf');

  // Skip validation for pre-formatted Classic CLI commands; NSF always rebuilds server-side.
  if (parameters.cliCommand && !isNsfMode) {
    return { valid: true };
  }

  // NSF share/permission commands require -r <role> on grant per Commander docs.
  // Classic uses permission flags instead and is unaffected.
  if (
    isNsfMode &&
    parameters &&
    parameters.action === 'grant' &&
    ['share-folder', 'share-record', 'record-permission'].includes(action)
  ) {
    const role = parameters.role ? String(parameters.role).trim() : '';
    if (!role) {
      errors.push('Role is required for Nested Share Subfolders (NSF) grant operations');
    } else if (!NSF_ROLES.includes(role)) {
      errors.push(
        `Invalid Nested Share Subfolders (NSF) role "${role}". Allowed: ${NSF_ROLES.join(', ')}`
      );
    }
  }

  // Common validations based on action type
  switch (action) {
    case 'record-add':
    case 'record-update': {
      // Title validation
      if (action === 'record-add' && !parameters.title) {
        errors.push('Title is required for Nested Share Subfolders (NSF) record-add');
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
      
      // KJ-26-06: Record type is immutable on record-update. The UI greys
      // out the field, but a proxy can re-enable it; reject server-side too.
      if (action === 'record-update' && parameters.recordType) {
        errors.push('Record type cannot be changed after a record is created.');
      } else if (parameters.recordType) {
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
      
      // Password validation: length limit + KJ-26-04 server-side complexity
      // for any non-`$GEN` password on record-add / record-update. Client-
      // side checks can be bypassed via proxy; this is the authoritative gate.
      if (parameters.password && parameters.password !== '$GEN' && parameters.password !== 'generate') {
        const passwordValidation = validateField('password', parameters.password, { limitKey: 'password' });
        if (!passwordValidation.valid) errors.push(passwordValidation.error);

        const complexity = validatePasswordComplexity(parameters.password);
        if (!complexity.valid) {
          errors.push(formatPasswordPolicyError(complexity.errors));
        }
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
          if (['title', 'notes', 'record', 'recordType', 'login', 'password', 'url', 'email',
               'keyPair_privateKey', 'keyPair_publicKey', 'passphrase'].includes(key)) {
            continue;
          }
          if (addressFields.includes(key) || nameFields.includes(key)) {
            continue;
          }
          
          // Use field-specific limit when available (e.g. privateKey: 16000), else default.
          const validation = validateField(key, value, { limitKey: key });
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
        const expireAt = parameters.expire_at;
        if (typeof expireAt === 'string' && expireAt.length > 30) {
          errors.push('Expiration date exceeds maximum length');
        }
      }

      // rotate_on_expiration requires a valid expiration window.
      if (parameters.rotate_on_expiration === true) {
        if (!parameters.expiration_type || parameters.expiration_type === 'none') {
          errors.push('Expiration is required when rotate-on-expiration is enabled');
        } else if (parameters.expiration_type === 'expire-at' && !parameters.expire_at) {
          errors.push('Expire-at value is required when rotate-on-expiration is enabled');
        } else if (parameters.expiration_type === 'expire-in' && !parameters.expire_in) {
          errors.push('Expire-in value is required when rotate-on-expiration is enabled');
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

function buildKeeperCommand(action, parameters, issueKey, options = {}) {
  // NSF mode reroutes actions via NSF_COMMAND_NAME_MAP; Classic mode is unaffected.
  const isNsf = options?.mode === 'nsf';

  // Honor pre-formatted CLI commands only in Classic mode.
  if (parameters.cliCommand && !isNsf) {
    return parameters.cliCommand;
  }
  
  // ========================================================================
  // Input Validation - validate all parameters before building command
  // ========================================================================
  const validation = validateCommandParameters(action, parameters, { mode: isNsf ? 'nsf' : 'classic' });
  if (!validation.valid) {
    throw new Error(`Input validation failed: ${validation.errors.join('; ')}`);
  }

  let command;
  if (isNsf && NSF_COMMAND_NAME_MAP[action]) {
    command = NSF_COMMAND_NAME_MAP[action];
  } else {
    command = action;
  }
  
  // Build command based on action type
  switch (action) {
    case 'record-add':
      // Use the recordType parameter if provided, otherwise default to login
      const recordType = parameters.recordType || 'login';
      command += ` --record-type='${escapeForSingleQuotes(recordType)}'`;

      // NSF records must live inside an NSF folder; fail if folder UID is missing.
      if (isNsf) {
        const nsfFolder = parameters.folder;
        if (!nsfFolder || !String(nsfFolder).trim()) {
          throw new Error('Folder is required for nsf-record-add. Pick a folder in the issue panel.');
        }
        command += ` --folder='${escapeForSingleQuotes(String(nsfFolder).trim())}'`;
      } else if (parameters.folder && String(parameters.folder).trim()) {
        command += ` --folder='${escapeForSingleQuotes(String(parameters.folder).trim())}'`;
      }

      // Title is required for all record types
      if (!parameters.title) {
        throw new Error(`Title is required for record-add command. Record type: ${recordType}`);
      }
      command += ` --title="${escapeForDoubleQuotes(parameters.title)}"`;
      if (parameters.notes) {
        command += ` --notes='${escapeForSingleQuotes(parameters.notes)}'`;
      }
      
      // Skip metadata fields; folder is excluded (already emitted as --folder in NSF mode).
      const metadataFields = ['recordType', 'title', 'notes', 'skipComment', 'phoneEntries', 'folder'];
      
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
      // NSF uses short -r <UID>; Classic uses --record=<UID>.
      if (parameters.record) {
        if (isNsf) {
          command += ` -r '${escapeForSingleQuotes(parameters.record)}'`;
        } else {
          command += ` --record='${escapeForSingleQuotes(parameters.record)}'`;
        }
      }
      
      // Optional title update
      if (parameters.title) {
        command += ` --title='${escapeForSingleQuotes(parameters.title)}'`;
      }
      
      // KJ-26-06: recordType is immutable on update — defence-in-depth.
      // `validateCommandParameters` already rejects this branch; if anything
      // ever bypasses validation we still must NOT emit `--record-type`.
      
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
      if (isNsf) {
        command += buildNsfRecordPermissionArgs(parameters);
        break;
      }
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
      if (isNsf) {
        command += buildNsfShareRecordArgs(parameters);
        break;
      }
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
          const expireAtFormatted = parameters.expire_at.replace('T', ' ');
          command += ` --expire-at "${escapeForDoubleQuotes(expireAtFormatted)}"`;
        } else if (parameters.expiration_type === 'expire-in' && parameters.expire_in) {
          const expireInValue = sanitizeNsfDuration(parameters.expire_in);
          if (expireInValue) command += ` --expire-in ${expireInValue}`;
        }
        if (parameters.rotate_on_expiration === true) {
          command += ' --rotate-on-expiration';
        }
      }
      
      command += ` -f`;
      break;
      
    case 'share-folder':
      if (isNsf) {
        command += buildNsfShareFolderArgs(parameters);
        break;
      }
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
      if (parameters.expiration_type === 'expire-at' && parameters.expire_at) {
        const expireAtFormatted = parameters.expire_at.replace('T', ' ');
        command += ` --expire-at "${escapeForDoubleQuotes(expireAtFormatted)}"`;
      } else if (parameters.expiration_type === 'expire-in' && parameters.expire_in) {
        const expireInValue = sanitizeNsfDuration(parameters.expire_in);
        if (expireInValue) command += ` --expire-in ${expireInValue}`;
      }
      if (parameters.rotate_on_expiration === true) {
        command += ' --rotate-on-expiration';
      }
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
 * Normalize the `mode` payload field to one of 'classic' | 'nsf'. Defaults to
 * 'classic' so callers that haven't been updated keep their pre-toggle
 * behavior.
 */
function resolveVaultMode(payload) {
  const raw = (payload && payload.mode ? String(payload.mode).toLowerCase() : '').trim();
  return raw === 'nsf' ? 'nsf' : 'classic';
}

/**
 * Map vault mode → expected Commander `record_category` value (lowercased).
 * Commander tags Classic records as "Classic" and NSF records as "Nested".
 * Keeping the mapping in one place avoids scattered magic strings.
 */
const VAULT_MODE_CATEGORY = Object.freeze({ classic: 'classic', nsf: 'nested' });

/**
 * Filter a list of records so only those belonging to the requested vault mode
 * are returned.  Comparison is case-insensitive against Commander's
 * `record_category` field.  Records without a `record_category` are assumed
 * Classic (backward-compat with older Commander versions).
 *
 * Only meaningful for `classic` mode — Commander's `list` returns the entire
 * vault (both Classic and Nested).  The `nsf-list --records` command already
 * scopes to NSF records, so NSF mode passes through unfiltered.
 *
 * @param {object[]} records
 * @param {'classic'|'nsf'} mode
 * @returns {object[]}
 */
function filterRecordsByVaultMode(records, mode) {
  if (mode !== 'classic') return records;
  const expected = VAULT_MODE_CATEGORY[mode];
  return records.filter(r => {
    const cat = (r.record_category || 'classic').toLowerCase();
    return cat === expected;
  });
}

/**
 * Record types the app supports. Frontend peer: SUPPORTED_RECORD_TYPES in
 * static/keeper-issue-ui/src/constants/index.js.
 *
 * Keyed by Commander's `content` value (the $id used in record-type-info).
 * The Map gives O(1) lookup for both the intersection filter and the
 * server-side validation gate in executeKeeperAction (KJ-26-02).
 */
const SUPPORTED_RECORD_TYPES = new Map([
  ['contact',             'Contact'],
  ['databaseCredentials', 'Database'],
  ['encryptedNotes',      'Secure Note'],
  ['login',               'Login'],
  ['membership',          'Membership'],
  ['serverCredentials',   'Server'],
  ['softwareLicense',     'Software License'],
  ['sshKeys',             'SSH Keys'],
]);

/**
 * Convert the SUPPORTED_RECORD_TYPES map into the { label, value } shape
 * the frontend expects. Used both as the resolver response and as the
 * fallback when Commander's rti command is unavailable.
 */
function allSupportedRecordTypes() {
  return Array.from(SUPPORTED_RECORD_TYPES, ([value, label]) => ({ label, value }));
}

/**
 * Parse the JSON response from `rti -lr --effective --format=json` and
 * return only the entries whose `content` is in SUPPORTED_RECORD_TYPES.
 *
 * Commander returns: [{ recordTypeId: number, content: string }, ...]
 *
 * @param {unknown} raw - Parsed JSON array from Commander.
 * @returns {{ label: string, value: string }[]}
 */
function intersectEffectiveRecordTypes(raw) {
  if (!Array.isArray(raw)) return allSupportedRecordTypes();
  const effectiveIds = new Set(raw.map(r => r?.content).filter(Boolean));
  return Array.from(SUPPORTED_RECORD_TYPES, ([value, label]) => ({ label, value }))
    .filter(t => effectiveIds.has(t.value));
}

/**
 * KJ-26-02: Return the record types the current user is permitted to create,
 * intersected with the app's supported set.
 *
 * Runs `rti -lr --effective --format=json` to honour enterprise role policies
 * (RESTRICT_RECORD_TYPES). On any failure (older Commander, network error,
 * parse failure) falls back to the full supported list — no regression.
 */
resolver.define('getRecordTypes', async (req) => {
  const userId = req?.context?.accountId;
  try {
    const result = await executeKeeperApiCommand(
      'record-type-info -lr --effective --format=json',
      { userId, forgeSafe: true },
    );
    const apiData = result?.data;

    let parsed = [];
    if (apiData?.data && Array.isArray(apiData.data)) {
      parsed = apiData.data;
    } else if (apiData?.message && typeof apiData.message === 'string') {
      parsed = JSON.parse(apiData.message);
    } else if (apiData?.data && typeof apiData.data === 'string') {
      parsed = JSON.parse(apiData.data);
    }

    const types = intersectEffectiveRecordTypes(parsed);
    return successResponse({ recordTypes: types });
  } catch (err) {
    logger.warn('getRecordTypes: rti --effective failed, falling back to full list', {
      error: err.message,
    });
    return successResponse({ recordTypes: allSupportedRecordTypes() });
  }
});

// Get records from Keeper API. NSF mode uses nsf-list; items are tagged with source.
resolver.define('getKeeperRecords', async (req) => {
  const userId = req?.context?.accountId;
  const mode = resolveVaultMode(req?.payload);
  const command = mode === 'nsf'
    ? 'nsf-list --records --format=json'
    : 'list --format=json';

  try {
    const result = await executeKeeperApiCommand(command, { userId, forgeSafe: true });
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

    const parsedRecords = mode === 'nsf' ? parseNsfRecordsFromRaw(records) : (records || []);
    const scoped = filterRecordsByVaultMode(parsedRecords, mode);
    const tagged = scoped.map(record => ({
      ...record,
      source: mode
    }));

    return successResponse({ records: tagged, mode });
  } catch (err) {
      // NSF unavailable: return structured error so the UI can revert the toggle.
    if (mode === 'nsf' && isKeeperNsfUnavailableError(err)) {
      logger.error('Nested Share Subfolders (NSF) not available on this vault for getKeeperRecords', {
        message: err.message
      });
      return nsfNotAvailableError(err.message);
    }
    // Check for rate limit error
    if (err.rateLimited) {
      return rateLimitError(err.limitType || 'minute', err.retryAfter || 60);
    }
    return keeperError(err.message || 'Failed to fetch records', err);
  }
});

// Get folders from Keeper API. NSF mode uses nsf-list; folders are tagged with source and nested path.
resolver.define('getKeeperFolders', async (req) => {
  const userId = req?.context?.accountId;
  const mode = resolveVaultMode(req?.payload);
  const command = mode === 'nsf'
    ? 'nsf-list --folders --format=json'
    : 'ls -f -R --format=json';

  try {
    // Best-effort sync-down so newly created folders are visible without
    // requiring a Commander restart. Mirrors the pattern used by runEpmSyncDown.
    // Failures are logged and ignored — never block the user-facing fetch.
    try {
      await executeKeeperApiCommand('sync-down', { userId, skipRateLimit: true });
    } catch (syncErr) {
      logger.warn('sync-down before folder fetch failed; continuing with cached data', {
        error: syncErr.message
      });
    }

    const result = await executeKeeperApiCommand(command, { userId, forgeSafe: true });
    const apiData = result.data;

    // Parse the JSON data from the response
    let rawFolders = [];
    if (apiData.data && Array.isArray(apiData.data)) {
      rawFolders = apiData.data;
    } else if (apiData.message && typeof apiData.message === 'string') {
      try {
        rawFolders = JSON.parse(apiData.message);
      } catch (parseError) {
        return keeperError('Failed to parse folders data from Keeper API');
      }
    } else if (apiData.data && typeof apiData.data === 'string') {
      try {
        rawFolders = JSON.parse(apiData.data);
      } catch (parseError) {
        return keeperError('Failed to parse folders data from Keeper API');
      }
    }

    let folders = [];
    try {
      if (mode === 'nsf') {
        // Commander 18.x returns display keys: UID, Title, Parent/Folder.
        folders = parseNsfFoldersFromRaw(rawFolders);
      } else {
        // Classic: exclude NSF rows (they're surfaced via nsf-list --folders).
        // Rows without a source field are kept for backward compat.
        const classicRawFolders = (rawFolders || []).filter((folder) => {
          const rawSource = folder && folder.source != null ? String(folder.source).trim().toLowerCase() : '';
          if (!rawSource) return true;
          return rawSource === 'legacy';
        });

        // First pass: normalize each folder row.
        const normalized = classicRawFolders.map((folder, index) => {
          let cleanName = folder.name || '';
          cleanName = cleanName.replace(/\[?\d+m/g, '');

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
          // "/" means root level — treat as no parent.
          if (parentUid === '/') parentUid = '';

          return {
            number: index + 1,
            folder_uid: folder.uid,
            uid: folder.uid,
            name: cleanName,
            title: cleanName,
            flags: flags,
            parent_uid: parentUid,
            shared: !!(flags && flags.includes('S')),
            source: 'classic',
            raw_data: folder
          };
        });

        // Second pass: build nested paths from parent_uid chains (same algorithm as buildNsfFolderPaths).
        const byUid = new Map();
        for (const f of normalized) {
          if (f && f.uid) byUid.set(f.uid, f);
        }
        const pathCache = new Map();
        const resolvePath = (uid, visiting = new Set()) => {
          if (!uid) return '';
          if (pathCache.has(uid)) return pathCache.get(uid);
          if (visiting.has(uid)) return byUid.get(uid)?.name || '';
          const f = byUid.get(uid);
          if (!f) return '';
          visiting.add(uid);
          const name = f.name || '';
          const pUid = f.parent_uid || '';
          let path = name;
          if (pUid && byUid.has(pUid)) {
            const parentPath = resolvePath(pUid, visiting);
            path = parentPath ? `${parentPath} / ${name}` : name;
          }
          visiting.delete(uid);
          pathCache.set(uid, path);
          return path;
        };

        folders = normalized.map((f) => ({
          ...f,
          path: resolvePath(f.uid) || f.name || '',
          folderPath: resolvePath(f.uid) || f.name || ''
        }));
      }
    } catch (parseError) {
      return keeperError('Failed to parse folders data from Keeper API');
    }

    return successResponse({ folders: folders || [], mode });
  } catch (err) {
    if (mode === 'nsf' && isKeeperNsfUnavailableError(err)) {
      logger.error('Nested Share Subfolders (NSF) not available on this vault for getKeeperFolders', {
        message: err.message
      });
      return nsfNotAvailableError(err.message);
    }
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
    const result = await executeKeeperApiCommand(`get "${recordUid}" --format=json`, { userId, forgeSafe: true });
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

// Check if a record is pamUser or a folder is rotation-on-expiration eligible.
// Used by the issue panel to decide whether to show the "Rotate password upon
// expiration" checkbox on share-record / share-folder.
resolver.define('checkRotationEligibility', async (req) => {
  const userId = req?.context?.accountId;
  const { type, uid } = req?.payload || {};

  if (!uid) return validationError('uid', 'UID is required');
  if (type !== 'record' && type !== 'folder') {
    return validationError('type', 'type must be "record" or "folder"');
  }

  try {
    if (type === 'record') {
      const result = await executeKeeperApiCommand(
        `get "${uid}" --format=json`,
        { userId, skipRateLimit: true, forgeSafe: true }
      );
      let details = {};
      if (result.data?.data) {
        details = typeof result.data.data === 'string'
          ? JSON.parse(result.data.data)
          : result.data.data;
      }
      const recordType = details.record_type || details.type || '';
      return successResponse({
        eligible: recordType.toLowerCase() === 'pamuser',
        recordType
      });
    }

    // Folder: list-sf <uid> --roe-eligible --format=json
    const result = await executeKeeperApiCommand(
      `list-sf "${uid}" --roe-eligible --format=json`,
      { userId, skipRateLimit: true, forgeSafe: true }
    );
    let rows = [];
    if (result.data?.data) {
      rows = typeof result.data.data === 'string'
        ? JSON.parse(result.data.data)
        : result.data.data;
    }
    if (!Array.isArray(rows)) rows = [];
    const match = rows.some(r => r.shared_folder_uid === uid);
    return successResponse({ eligible: match, roeResponse: rows });
  } catch (err) {
    if (err.rateLimited) {
      return rateLimitError(err.limitType || 'minute', err.retryAfter || 60);
    }
    logger.error('checkRotationEligibility failed', { type, uid, error: err.message });
    return successResponse({ eligible: false, error: err.message });
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

  // KJ-26-05: Validate command against an allowlist and strip control characters
  // to prevent log injection via crafted "command" values.
  const ALLOWED_COMMAND_PREFIXES = [
    'list', 'list-sf', 'ls', 'get', 'search',
    'record-add', 'record-update', 'record-permission',
    'record-type-info', 'rti',
    'share-record', 'share-folder',
    'nsf-list', 'nsf-get',
    'nsf-record-add', 'nsf-record-update', 'nsf-record-permission',
    'nsf-share-record', 'nsf-share-folder',
    'epm',
    'device-approve',
    'service-status',
    'enterprise-info', 'enterprise-role', 'enterprise-user',
    'getConfig',
  ];
  // Strip newlines and control characters that could forge log entries
  const sanitizedCommand = command.replace(/[\r\n\t\x00-\x1f\x7f]/g, ' ').trim();
  const commandVerb = sanitizedCommand.split(/\s+/)[0].toLowerCase();
  if (!ALLOWED_COMMAND_PREFIXES.some(p => commandVerb === p.toLowerCase())) {
    return validationError('command', `Unknown command "${commandVerb}". Only approved commands are permitted.`);
  }

  try {
    const result = await executeKeeperApiCommand(sanitizedCommand, { userId });
    return result;
  } catch (err) {
    // Check for rate limit error
    if (err.rateLimited) {
      return rateLimitError(err.limitType || 'minute', err.retryAfter || 60);
    }
    return keeperError(err.message || 'Failed to execute command', err);
  }
});

// ============================================================================
// "Already processed outside Jira" — shared helpers (EPM + Device Approval)
// ============================================================================

// Label added to a Jira ticket when we detect that the underlying Keeper
// request (EPM approval OR device-approval) was already actioned outside
// Jira (e.g. directly in the Keeper Admin Console / vault). Used to
// short-circuit future panel loads so admins don't see stale buttons.
const PROCESSED_OUTSIDE_JIRA_LABEL = 'request-already-processed-outside-jira';

/**
 * Detect whether a Keeper Commander error message indicates that an EPM
 * approval request no longer exists (i.e. it was approved or denied outside
 * of Jira since the ticket was created). Keeper's CLI returns:
 *   "Failed to approved \"<uid>\": Approval request does not exist or cannot be modified"
 * which `parseKeeperErrorMessage()` typically trims to:
 *   "Approval request does not exist or cannot be modified"
 * We match defensively against both the trimmed and the original forms.
 */
function isEpmRequestNotFoundError(errorMessage) {
  if (!errorMessage || typeof errorMessage !== 'string') return false;
  const lower = errorMessage.toLowerCase();
  return (
    lower.includes('approval request does not exist') ||
    lower.includes('cannot be modified')
  );
}

/**
 * Best-effort `epm sync-down` to refresh Commander's local view of pending
 * EPM approvals before we attempt approve/deny. Without this, an approval
 * that was actioned in another session can still appear locally and produce
 * a confusing "request does not exist" error on the next call. We never
 * fail the user-facing action on a sync-down failure — just log and proceed.
 */
async function runEpmSyncDown(userId) {
  try {
    await executeKeeperApiCommand('epm sync-down', { userId, skipRateLimit: true });
  } catch (syncErr) {
    logger.warn('epm sync-down failed; continuing with approve/deny anyway', {
      error: syncErr.message
    });
  }
}

/**
 * Pull the device target (user email or device ID) out of a `device-approve`
 * CLI invocation. Order-agnostic: we accept either
 *   `device-approve <target> --approve`  (canonical)
 * or
 *   `device-approve --approve <target>`  (legacy)
 */
function extractDeviceTarget(cliCommand) {
  if (!cliCommand) return null;
  const tokens = cliCommand.split(/\s+/);
  return tokens.find((t, i) => i > 0 && t && !t.startsWith('-')) || null;
}

/**
 * Fetch Keeper's current list of pending device approvals via
 * `device-approve --reload --format=json`. Returns an array of
 * `{ device_id, email, ... }` objects (possibly empty).
 *
 * `skipRateLimit: true` is intentional — this is an internal pre-check that
 * runs on every Approve/Deny click and shouldn't count against the user's
 * Commander rate limit.
 */
async function fetchPendingDeviceApprovals(userId) {
  const result = await executeKeeperApiCommand(
    'device-approve --reload --format=json',
    { userId, skipRateLimit: true }
  );
  const raw = result?.data;
  if (!raw) return [];
  if (Array.isArray(raw.data)) return raw.data;
  if (Array.isArray(raw)) return raw;
  return [];
}

/**
 * Decide whether `target` (an email or device ID, exactly what we'd pass to
 * `device-approve <X> --approve|--deny`) is still in the pending list.
 *
 *   - emails are matched case-insensitively
 *   - device IDs match exactly OR by partial prefix (Keeper's CLI itself
 *     supports partial-prefix device ID matching)
 */
function isTargetPending(pendingList, target) {
  if (!Array.isArray(pendingList) || pendingList.length === 0 || !target) {
    return false;
  }
  const lowered = String(target).toLowerCase();
  const looksLikeEmail = lowered.includes('@');
  return pendingList.some((entry) => {
    if (!entry) return false;
    if (looksLikeEmail) {
      return String(entry.email || '').toLowerCase() === lowered;
    }
    const id = String(entry.device_id || '');
    return id === target || id.startsWith(target) || target.startsWith(id);
  });
}

/**
 * Mark the Jira ticket as resolved-outside-Jira: add the shared label so
 * future panel loads skip the buttons, and post an audit comment so the
 * activity history reflects what happened.
 *
 * @param {string} issueKey
 * @param {string} identifier   Human-friendly identifier of the request:
 *                              user email or device ID for device approvals,
 *                              EPM approval/request UID for EPM.
 * @param {string|null} formattedTimestamp
 * @param {'epm'|'device'} kind  Drives the wording of the audit comment.
 */
async function markAlreadyProcessedOutsideJira(
  issueKey,
  identifier,
  formattedTimestamp,
  kind = 'device'
) {
  // Add the label (idempotent — fetch current labels first).
  try {
    const labelsResp = await requestJiraAsAppWithRetry(
      route`/rest/api/3/issue/${issueKey}?fields=labels`,
      { method: 'GET', headers: { Accept: 'application/json' } },
      'Fetch labels before processed-outside marker'
    );
    if (labelsResp.ok) {
      const data = await labelsResp.json();
      const current = data.fields?.labels || [];
      if (!current.includes(PROCESSED_OUTSIDE_JIRA_LABEL)) {
        await requestJiraAsAppWithRetry(
          route`/rest/api/3/issue/${issueKey}`,
          {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              fields: { labels: [...current, PROCESSED_OUTSIDE_JIRA_LABEL] }
            })
          },
          'Add processed-outside-jira label'
        );
      }
    }
  } catch (labelErr) {
    logger.warn('Failed to add processed-outside-jira label', {
      issueKey,
      error: labelErr.message
    });
  }

  // Post an audit comment summarising what happened.
  try {
    const ts = formattedTimestamp || new Date().toISOString();
    const isEpm = kind === 'epm';
    const title = isEpm
      ? 'EPM Approval — Already Processed Outside Jira'
      : 'Device Admin Approval — Already Processed Outside Jira';
    const bodyText = isEpm
      ? `Approval request "${identifier}" is no longer pending in Keeper as of ${ts}. ` +
        'It appears to have already been approved or denied outside Jira ' +
        '(e.g. via the Keeper Admin Console / vault). No action was taken from this ticket.'
      : `Target "${identifier}" is no longer in Keeper's pending device-approval list ` +
        `as of ${ts}. The request appears to have already been approved or denied ` +
        'outside Jira (e.g. via the Keeper Admin Console). No action was taken from this ticket.';

    const commentBody = {
      type: 'doc',
      version: 1,
      content: [
        {
          type: 'panel',
          attrs: { panelType: 'warning' },
          content: [
            {
              type: 'paragraph',
              content: [
                { type: 'text', text: title, marks: [{ type: 'strong' }] }
              ]
            },
            {
              type: 'paragraph',
              content: [{ type: 'text', text: bodyText }]
            }
          ]
        }
      ]
    };
    await requestJiraAsAppWithRetry(
      route`/rest/api/3/issue/${issueKey}/comment`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body: commentBody })
      },
      'Add processed-outside-jira comment'
    );
  } catch (commentErr) {
    logger.warn('Failed to add processed-outside-jira comment', {
      issueKey,
      error: commentErr.message
    });
  }
}

/**
 * Manual Keeper action trigger (called from issue panel)
 */
resolver.define('executeKeeperAction', async (req) => {
  const userId = req?.context?.accountId;
  const { issueKey, command, commandDescription, parameters, formattedTimestamp } = req.payload;
  // `mode` toggles command-builder routing between Classic and Nested Share Subfolders (NSF).
  // Affects: record-add, record-update, share-folder, share-record, record-permission.
  // Defaults to 'classic' so callers that don't pass it keep their pre-toggle behavior.
  const mode = resolveVaultMode(req?.payload);
  
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

  // KJ-26-03: Enforce server-side admin gate for mutating actions. The
  // frontend hides record-add / record-update from non-admins, but those
  // restrictions are bypassable via direct invoke calls. `requireProjectAdmin`
  // centralises the (group-membership OR ADMINISTER_PROJECTS) check and
  // fails closed when both lookups fail.
  const ADMIN_GATED_COMMANDS = new Set(['record-add', 'record-update']);
  if (ADMIN_GATED_COMMANDS.has(command)) {
    const adminErr = await requireProjectAdmin(issueKey);
    if (adminErr) return adminErr;
  }

  // KJ-26-02: Validate that the submitted recordType is both supported by
  // the app AND permitted by the user's enterprise role policy.  The first
  // check (SUPPORTED_RECORD_TYPES) is synchronous and always enforced.  The
  // second check (rti --effective) is best-effort: on failure, we allow the
  // request through so older Commander installs don't break.
  if (command === 'record-add' && parameters?.recordType) {
    if (!SUPPORTED_RECORD_TYPES.has(parameters.recordType)) {
      return validationError(
        'recordType',
        `Record type "${parameters.recordType}" is not supported by this application.`,
      );
    }
    try {
      const rtiResult = await executeKeeperApiCommand(
        'record-type-info -lr --effective --format=json',
        { userId, skipRateLimit: true, forgeSafe: true },
      );
      const rtiData = rtiResult?.data;
      let rtiParsed = [];
      if (rtiData?.data && Array.isArray(rtiData.data)) {
        rtiParsed = rtiData.data;
      } else if (rtiData?.message && typeof rtiData.message === 'string') {
        rtiParsed = JSON.parse(rtiData.message);
      } else if (rtiData?.data && typeof rtiData.data === 'string') {
        rtiParsed = JSON.parse(rtiData.data);
      }
      if (Array.isArray(rtiParsed) && rtiParsed.length > 0) {
        const effectiveIds = new Set(rtiParsed.map(r => r?.content).filter(Boolean));
        if (!effectiveIds.has(parameters.recordType)) {
          return errorResponse(
            ERROR_CODES.VALIDATION_ERROR,
            `Your enterprise role policy does not permit creating "${parameters.recordType}" records.`,
            { recordType: parameters.recordType },
          );
        }
      }
    } catch (rtiErr) {
      logger.warn('executeKeeperAction: rti --effective check failed, allowing request', {
        error: rtiErr.message,
      });
    }
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
        if (labels.includes(PROCESSED_OUTSIDE_JIRA_LABEL)) {
          return epmError('processed_outside');
        }
      }
    } catch (error) {
      // If it's a structured error response, return it
      if (error.success === false) {
        return error;
      }
      // Otherwise, continue
    }

    // Refresh Commander's local view of pending EPM approvals before we
    // attempt approve/deny. This ensures requests that were actioned in
    // another session are removed from the local cache, so we either succeed
    // cleanly or fail with the canonical "Approval request does not exist"
    // error (which the catch-block handler below converts into a structured
    // "already processed outside Jira" response + label).
    if (command.includes('--approve') || command.includes('--deny')) {
      await runEpmSyncDown(userId);
    }
  }

  // Device admin approval requests (label: ITSM_device_admin_approval_requested)
  // are actioned via Keeper Commander's `device-approve <user_email_or_device_id>
  // --approve|--deny` command (see
  // https://docs.keeper.io/en/keeperpam/commander-cli/command-reference/enterprise-management-commands#device-approve-command).
  // Block re-execution once one of those commands has already succeeded.
  const isDeviceCommand = command.startsWith('device-approve');
  if (isDeviceCommand) {
    try {
      const issueResponse = await requestJiraAsAppWithRetry(
        route`/rest/api/3/issue/${issueKey}?fields=labels`,
        {
          method: 'GET',
          headers: { 'Accept': 'application/json' }
        },
        'Check device action labels'
      );

      if (issueResponse.ok) {
        const issueData = await issueResponse.json();
        const labels = issueData.fields?.labels || [];

        if (labels.includes('device-approved')) {
          return deviceError('approved');
        }
        if (labels.includes('device-denied')) {
          return deviceError('denied');
        }
        if (labels.includes(PROCESSED_OUTSIDE_JIRA_LABEL)) {
          return deviceError('processed_outside');
        }
      }
    } catch (error) {
      if (error.success === false) {
        return error;
      }
    }

    // Pre-execution guard: confirm the target is still in Keeper's pending
    // device-approval list. If it was approved/denied outside Jira between the
    // ticket being created and now, mark the ticket and refuse the action so
    // we never call approve/deny on a stale request.
    const isApproveOrDeny =
      command.includes('--approve') || command.includes('--deny');
    if (isApproveOrDeny) {
      const target = extractDeviceTarget(parameters?.cliCommand || command);
      if (target) {
        try {
          const pending = await fetchPendingDeviceApprovals(userId);
          if (!isTargetPending(pending, target)) {
            await markAlreadyProcessedOutsideJira(
              issueKey,
              target,
              formattedTimestamp,
              'device'
            );
            return deviceError(
              'processed_outside',
              `${target} is not in Keeper's pending device-approval list anymore. ` +
                'It looks like the request was already approved or denied outside Jira.'
            );
          }
        } catch (precheckErr) {
          // Treat the pre-check as best-effort: if Keeper is unreachable here
          // we don't want to permanently block legitimate approvals. Log and
          // let the actual approve/deny call surface the real error.
          logger.warn(
            'Device approval pre-check failed; proceeding to attempt action',
            { issueKey, target, error: precheckErr.message }
          );
        }
      }
    }
  }
  
  // Validate share-record: prevent sharing with record owner (Classic only).
  // In NSF mode Commander already rejects share-to-owner, and the extra
  // `get` round-trip would push us past Forge's 25s resolver timeout.
  if (command === 'share-record' && mode !== 'nsf' && parameters.record && parameters.user && parameters.action !== 'cancel') {
    try {
      // Fetch record details to get owner email (skip rate limit for internal validation)
      const recordResult = await executeKeeperApiCommand(`get "${parameters.record}" --format=json`, { userId, skipRateLimit: true, forgeSafe: true });
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
    const dynamicCommand = buildKeeperCommand(command, parameters || {}, issueKey, { mode });

    // Call Keeper API using v2 async queue (with rate limiting)
    const result = await executeKeeperApiCommand(dynamicCommand, { userId, forgeSafe: true });
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
    // Detect device admin approval commands; these always add an audit comment
    // and a `device-approved` / `device-denied` label, just like EPM does.
    // Both approve and deny use the same `device-approve` command differentiated
    // by the `--approve` / `--deny` flag.
    const isDeviceCommand = command.startsWith('device-approve');

    // Only add comment for main record creation, not for records created as references
    // Check if this is a main record creation (not just a reference record)
    // Records created as references will have skipComment: true parameter
    const isMainRecordCreation = !parameters.skipComment;

    if (isMainRecordCreation || isEpmCommand || isDeviceCommand) {
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
      } else if (isDeviceCommand) {
        // Canonical CLI form is `device-approve <user_email_or_device_id> --approve|--deny`,
        // but flag/positional order is interchangeable in argparse. Pick the
        // first non-flag token that isn't `device-approve` itself.
        const tokens = parameters.cliCommand ? parameters.cliCommand.split(/\s+/) : [];
        const target = tokens.find((t, i) => i > 0 && t && !t.startsWith('-')) || '';
        if (command.includes('--approve')) {
          actionMessage = 'Device admin approval request has been approved';
          actionDescription = `Device Admin Approval: Approved ${target}`;
        } else if (command.includes('--deny')) {
          actionMessage = 'Device admin approval request has been denied';
          actionDescription = `Device Admin Approval: Denied ${target}`;
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
            
            if (parameters.expiration_type === 'expire-at' && parameters.expire_at) {
              actionMessage += ` - Expires at: ${parameters.expire_at.replace('T', ' ')}`;
            } else if (parameters.expiration_type === 'expire-in' && parameters.expire_in) {
              actionMessage += ` - Expires in: ${parameters.expire_in}`;
            }
            if (parameters.rotate_on_expiration) {
              actionMessage += ' | Password will auto-rotate upon expiration';
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
            
            if (parameters.expiration_type === 'expire-at' && parameters.expire_at) {
              actionMessage += ` - Expires at: ${parameters.expire_at.replace('T', ' ')}`;
            } else if (parameters.expiration_type === 'expire-in' && parameters.expire_in) {
              actionMessage += ` - Expires in: ${parameters.expire_in}`;
            }
            if (parameters.rotate_on_expiration) {
              actionMessage += ' | Password will auto-rotate upon expiration';
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
      } else if (isDeviceCommand) {
        if (command.includes('--approve')) {
          panelTitle = 'Device Admin Approval Request - Approved';
        } else if (command.includes('--deny')) {
          panelTitle = 'Device Admin Approval Request - Denied';
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
      } else if (isDeviceCommand && command.includes('--deny')) {
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

      // For EPM commands, add appropriate label to the current ticket (always),
      // and to any sibling tickets that share a `request-<uid>` label (legacy
      // fan-out for environments that tagged tickets with the Keeper request UID).
      if (isEpmCommand) {
        try {
          const newLabel = command.includes('--approve')
            ? 'epm-approved'
            : command.includes('--deny')
              ? 'epm-denied'
              : '';
          if (newLabel) {
            const requestUid = command.split(/\s+/).pop();
            const sanitizedUid = (requestUid || '').replace(/[^a-zA-Z0-9_-]/g, '-');
            const uidLabel = sanitizedUid ? `request-${sanitizedUid}` : '';

            const updatedKeys = new Set();

            // 1. Always update the current ticket (covers ITSM-created tickets
            //    that only carry `ITSM_approval-request-created` and do not
            //    include `request-<uid>`).
            try {
              const currentLabelsResponse = await requestJiraAsAppWithRetry(
                route`/rest/api/3/issue/${issueKey}?fields=labels`,
                { method: 'GET', headers: { 'Accept': 'application/json' } },
                'Fetch labels before EPM label update'
              );
              if (currentLabelsResponse.ok) {
                const currentLabelsData = await currentLabelsResponse.json();
                const currentLabels = currentLabelsData.fields?.labels || [];
                const alreadyActioned =
                  currentLabels.includes('epm-approved') ||
                  currentLabels.includes('epm-denied') ||
                  currentLabels.includes('epm-expired');
                if (!alreadyActioned && !currentLabels.includes(newLabel)) {
                  const updatedLabels = [...currentLabels, newLabel];
                  await requestJiraAsAppWithRetry(
                    route`/rest/api/3/issue/${issueKey}`,
                    {
                      method: 'PUT',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ fields: { labels: updatedLabels } })
                    },
                    'Update EPM label on current ticket'
                  );
                }
                updatedKeys.add(issueKey);
              }
            } catch (currentLabelErr) {
              logger.error('Failed to add EPM label on current ticket', currentLabelErr);
            }

            // 2. Fan out to any other tickets that share `request-<uid>`.
            if (uidLabel) {
              const searchResponse = await requestJiraAsAppWithRetry(
                route`/rest/api/3/search/jql`,
                {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    jql: `labels = "${uidLabel}"`,
                    fields: ['labels', 'key']
                  })
                },
                'Search for EPM tickets to update'
              );
              if (searchResponse.ok) {
                const searchResults = await searchResponse.json();
                const issuesToUpdate = (searchResults.issues || []).filter((issue) => {
                  if (updatedKeys.has(issue.key)) return false;
                  const labels = issue.fields?.labels || [];
                  return (
                    !labels.includes('epm-approved') &&
                    !labels.includes('epm-denied') &&
                    !labels.includes('epm-expired')
                  );
                });
                for (const issue of issuesToUpdate) {
                  const currentLabels = issue.fields?.labels || [];
                  const updatedLabels = [...currentLabels, newLabel];
                  await requestJiraAsAppWithRetry(
                    route`/rest/api/3/issue/${issue.key}`,
                    {
                      method: 'PUT',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ fields: { labels: updatedLabels } })
                    },
                    'Update EPM label on sibling ticket'
                  );
                  updatedKeys.add(issue.key);
                }
              }
            }
          }
        } catch (labelErr) {
          logger.error('Failed to add EPM label', labelErr);
        }
      }

      // For device admin approval commands, add `device-approved` / `device-denied`
      // to the current ticket so future invocations are blocked and the panel
      // can show the correct state on reload.
      if (isDeviceCommand) {
        try {
          const newLabel = command.includes('--approve')
            ? 'device-approved'
            : command.includes('--deny')
              ? 'device-denied'
              : '';
          if (newLabel) {
            const issueLabelsResponse = await requestJiraAsAppWithRetry(
              route`/rest/api/3/issue/${issueKey}?fields=labels`,
              { method: 'GET', headers: { 'Accept': 'application/json' } },
              'Fetch labels before device label update'
            );
            if (issueLabelsResponse.ok) {
              const issueLabelsData = await issueLabelsResponse.json();
              const currentLabels = issueLabelsData.fields?.labels || [];
              if (!currentLabels.includes(newLabel)) {
                const updatedLabels = [...currentLabels, newLabel];
                await requestJiraAsAppWithRetry(
                  route`/rest/api/3/issue/${issueKey}`,
                  {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ fields: { labels: updatedLabels } })
                  },
                  'Update device approval label'
                );
              }
            }
          }
        } catch (labelErr) {
          logger.error('Failed to add device approval label', labelErr);
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

    // NSF unavailable: surface structured error so the UI reverts the toggle.
    if (mode === 'nsf' && isKeeperNsfUnavailableError(err)) {
      logger.error('Nested Shared Folder mode not available on this vault for executeKeeperAction', {
        message: err.message,
        command
      });
      return nsfNotAvailableError(err.message);
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

    // Rotation-on-expiration: Commander rejects the flag when the target record
    // is not a pamUser with rotation fully configured. The CLI shows
    // "rotate-on-expiration requires a pamUser record..." but the HTTP API
    // returns a generic 500 with just the record UID. Catch both cases.
    // Note: `command` here is the action name ('share-record'), not the full
    // CLI string, so we check `parameters.rotate_on_expiration` instead.
    if (errorMessage && (
      errorMessage.includes('rotate-on-expiration requires a pamUser record with rotation configured') ||
      (parameters?.rotate_on_expiration === true && errorMessage.includes('500'))
    )) {
      const ineligibleUid = errorMessage.match(/500\s*-\s*([A-Za-z0-9_-]{10,})/)?.[1];
      const roeMsg = ineligibleUid
        ? `Rotate-on-expiration failed — record "${ineligibleUid}" requires a fully configured PAM User with rotation enabled (linked PAM config/resource, enabled state, and an active Gateway).`
        : 'Rotate-on-expiration failed — the target record requires a fully configured PAM User with rotation enabled (linked PAM config/resource, enabled state, and an active Gateway).';
      return errorResponse(
        ERROR_CODES.KEEPER_PERMISSION_DENIED,
        roeMsg,
        { troubleshooting: [
          'Verify the record is of type pamUser',
          'Ensure rotation is enabled for that record (pam rotation edit)',
          'Check that a Keeper Gateway is active and connected'
        ] }
      );
    }

    // EPM-specific: Keeper returns "Approval request does not exist or cannot
    // be modified" when the underlying request was already actioned (in
    // another session, the Admin Console, or via another integration). Treat
    // this as "already processed outside Jira" — tag the ticket with the
    // shared label, post an audit comment, and return a structured error so
    // the panel can render a friendly resolved-state message instead of the
    // raw Keeper error.
    if (
      command.startsWith('epm approval action') &&
      isEpmRequestNotFoundError(errorMessage)
    ) {
      const requestUid =
        (parameters && (parameters.request_uid || parameters.approval_uid)) ||
        (parameters && parameters.cliCommand
          ? parameters.cliCommand.split(/\s+/).pop()
          : '') ||
        command.split(/\s+/).pop();
      try {
        await markAlreadyProcessedOutsideJira(
          issueKey,
          requestUid,
          formattedTimestamp,
          'epm'
        );
      } catch (markErr) {
        logger.warn('Failed to mark EPM ticket as processed-outside-jira', {
          issueKey,
          error: markErr.message
        });
      }
      return epmError(
        'processed_outside',
        `EPM approval request "${requestUid}" is no longer pending in Keeper. ` +
          'It looks like the request was already approved or denied outside Jira.'
      );
    }

    // Strip CLI-internal hint that is meaningless to Jira users.
    if (errorMessage && errorMessage.includes('Use --force to bypass password policy warnings')) {
      const cleaned = errorMessage
        .split('\n')
        .filter(line => !line.includes('Use --force to bypass password policy warnings'))
        .join('\n')
        .trim();
      return keeperError(cleaned || errorMessage, err);
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
 * Get user role - check if current user is a Jira admin for the project.
 *
 * KJ-26-03: Delegates to `verifyProjectAdmin`, which prefers Jira group
 * membership (reliable across all plan tiers) and falls back to
 * `ADMINISTER_PROJECTS` when the user isn't in an admin group. Returns the
 * same response shape callers already consume so the issue panel is
 * unchanged.
 */
resolver.define('getUserRole', async (req) => {
  const { issueKey } = req.payload;
  if (!issueKey) {
    throw new Error('Issue key is required');
  }

  try {
    const verdict = await verifyProjectAdmin(issueKey);
    return {
      success: !verdict.error,
      isAdmin: verdict.isAdmin,
      adminCheckMethod: verdict.adminCheckMethod,
      userKey: verdict.userKey || 'unknown',
      displayName: verdict.displayName,
      projectKey: verdict.projectKey,
      ...(verdict.error ? { error: verdict.error } : {}),
    };
  } catch (err) {
    logger.error('getUserRole: unexpected failure', { error: err.message, issueKey });
    return {
      success: false,
      isAdmin: false,
      adminCheckMethod: 'error_fallback',
      userKey: null,
      displayName: 'User',
      projectKey: issueKey ? issueKey.split('-')[0] : null,
      error: err.message,
    };
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
 * Get ITSM ticket data from issue description.
 * Tickets created by the JIRA ITSM Forge app embed the original alert payload
 * as a JSON code block in the issue description. This resolver fetches that
 * payload (and the ticket's labels) so the issue panel can render the right
 * UI for each ITSM_<audit_event> label (e.g. EPM approval, SSO device approval).
 */
resolver.define('getItsmTicketData', async (req) => {
  const issueKey = req.payload?.issueKey;

  if (!issueKey) {
    throw new Error('Issue key is required');
  }

  try {
    const response = await requestJiraAsAppWithRetry(
      route`/rest/api/3/issue/${issueKey}?fields=description,labels`,
      {
        method: 'GET',
        headers: { 'Accept': 'application/json' }
      },
      'Get ITSM ticket data'
    );

    if (!response.ok) {
      throw new Error(`Failed to fetch issue: ${response.statusText}`);
    }

    const issue = await response.json();
    const description = issue.fields?.description;
    const labels = issue.fields?.labels || [];

    let payload = null;
    if (description && description.content) {
      const codeBlock = description.content.find(
        block => block.type === 'codeBlock' && block.attrs?.language === 'json'
      );
      if (codeBlock && codeBlock.content && codeBlock.content[0]?.text) {
        try {
          payload = JSON.parse(codeBlock.content[0].text);
        } catch (e) {
          logger.error('Failed to parse ITSM ticket payload', e);
        }
      }
    }

    return {
      success: true,
      payload,
      labels
    };

  } catch (error) {
    logger.error('Error fetching ITSM ticket data', error);
    throw new Error(`Failed to fetch ITSM ticket data: ${error.message}`);
  }
});

function redactEpmApprovalDetails(value) {
  if (Array.isArray(value)) {
    return value.map(redactEpmApprovalDetails);
  }

  if (!value || typeof value !== 'object') {
    return value;
  }

  return Object.entries(value).reduce((acc, [key, entryValue]) => {
    if (/filehash/i.test(key)) {
      acc[key] = ['[REDACTED]'];
      return acc;
    }

    if (/commandline/i.test(key) && typeof entryValue === 'string') {
      acc[key] = entryValue.replace(/\s+.+$/, ' [ARGS REDACTED]');
      return acc;
    }

    acc[key] = redactEpmApprovalDetails(entryValue);
    return acc;
  }, {});
}

resolver.define('getEpmApprovalDetails', async (req) => {
  const requestUid = req.payload?.requestUid;

  if (!requestUid) {
    return { success: false, message: 'Request UID is required' };
  }

  try {
    const details = await fetchEpmApprovalDetails(requestUid);
    if (!details) {
      return {
        success: false,
        message: 'EPM approval details were not available from Keeper Commander'
      };
    }

    return {
      success: true,
      details,
      redactedDetails: redactEpmApprovalDetails(details)
    };
  } catch (error) {
    logger.warn('Failed to fetch EPM approval details', {
      requestUid,
      error: error.message
    });
    return {
      success: false,
      message: 'Failed to fetch EPM approval details'
    };
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

    if (labels.includes(PROCESSED_OUTSIDE_JIRA_LABEL)) {
      return {
        success: true,
        actionTaken: true,
        action: 'processed_outside',
        message:
          'This EPM approval request was already processed outside Jira ' +
          '(no longer pending in Keeper).'
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

/**
 * Check if a device admin approval action was already taken on this ticket.
 * Looks for the `device-approved` / `device-denied` labels added by the
 * executeKeeperAction resolver after a successful Commander call.
 */
resolver.define('checkDeviceActionTaken', async (req) => {
  const { issueKey } = req.payload;

  if (!issueKey) {
    throw new Error('Issue key is required');
  }

  try {
    const issueResponse = await requestJiraAsAppWithRetry(
      route`/rest/api/3/issue/${issueKey}?fields=labels`,
      {
        method: 'GET',
        headers: { 'Accept': 'application/json' }
      },
      'Check device action labels'
    );

    if (!issueResponse.ok) {
      throw new Error('Failed to fetch issue details');
    }

    const issueData = await issueResponse.json();
    const labels = issueData.fields?.labels || [];

    if (labels.includes('device-approved')) {
      return {
        success: true,
        actionTaken: true,
        action: 'approved',
        message: 'Device request already approved'
      };
    }

    if (labels.includes('device-denied')) {
      return {
        success: true,
        actionTaken: true,
        action: 'denied',
        message: 'Device request already denied'
      };
    }

    if (labels.includes(PROCESSED_OUTSIDE_JIRA_LABEL)) {
      return {
        success: true,
        actionTaken: true,
        action: 'processed_outside',
        message:
          'This device approval request was already processed outside Jira ' +
          '(no longer in Keeper\'s pending list).'
      };
    }

    return {
      success: true,
      actionTaken: false,
      action: null,
      message: 'No action taken yet'
    };

  } catch (err) {
    logger.error('Error checking device action', err);
    return {
      success: false,
      actionTaken: false,
      action: null,
      message: err.message
    };
  }
});

/**
 * Check whether the device referenced by this ticket is still in Keeper's
 * pending device-approval list. Called by DeviceApprovalPanel on load so we
 * can skip the Approve/Deny buttons (and tag the ticket) if an admin already
 * actioned the request outside Jira
 */
resolver.define('checkDevicePendingStatus', async (req) => {
  const userId = req?.context?.accountId;
  const issueKey = req.payload?.issueKey;

  if (!issueKey) {
    return { success: false, message: 'Issue key is required' };
  }

  try {
    // Reuse the same description-payload extraction the panel uses.
    const issueResp = await requestJiraAsAppWithRetry(
      route`/rest/api/3/issue/${issueKey}?fields=description,labels`,
      { method: 'GET', headers: { Accept: 'application/json' } },
      'Get ITSM ticket data for device pending check'
    );
    if (!issueResp.ok) {
      return { success: false, message: `Failed to fetch issue: ${issueResp.statusText}` };
    }
    const issue = await issueResp.json();
    const description = issue.fields?.description;

    let payload = null;
    if (description?.content) {
      const codeBlock = description.content.find(
        (b) => b.type === 'codeBlock' && b.attrs?.language === 'json'
      );
      if (codeBlock?.content?.[0]?.text) {
        try {
          payload = JSON.parse(codeBlock.content[0].text);
        } catch (e) {
          logger.warn('Failed to parse ITSM payload for pending check', { issueKey });
        }
      }
    }

    if (!payload) {
      return { success: false, message: 'No ITSM payload found on this ticket' };
    }

    // Same precedence as DeviceApprovalPanel.getDeviceTarget().
    const target =
      payload.username ||
      payload.email ||
      payload.user?.email ||
      payload.account_info?.Username ||
      payload.device_id ||
      payload.deviceId ||
      payload.device_uid ||
      payload.encrypted_device_token ||
      payload.device_token ||
      null;

    if (!target) {
      return {
        success: false,
        message: 'Could not resolve a user email or device ID from the ticket payload'
      };
    }

    const pending = await fetchPendingDeviceApprovals(userId);
    const isPending = isTargetPending(pending, target);

    if (!isPending) {
      // Persist the resolved state on the ticket so subsequent loads short-circuit
      // via checkDeviceActionTaken instead of hitting Keeper again.
      await markAlreadyProcessedOutsideJira(issueKey, target, null, 'device');
      return {
        success: true,
        pending: false,
        target,
        alreadyProcessed: true,
        message:
          `${target} is no longer in Keeper's pending device-approval list. ` +
          'The request was already processed outside Jira.'
      };
    }

    return { success: true, pending: true, target };
  } catch (err) {
    logger.error('Error checking device pending status', err);
    return { success: false, message: err.message };
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

export const handler = resolver.getDefinitions();

// Export same resolver for issue panel - they can share the same functions
export const issuePanelHandler = resolver.getDefinitions();