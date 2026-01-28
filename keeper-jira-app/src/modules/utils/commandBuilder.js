/**
 * Command Builder Utility
 * 
 * Builds Keeper Commander CLI commands from structured parameters.
 * Includes input validation and shell escaping to prevent command injection.
 * 
 * Extracted for testability - these functions are used by the main index.js resolvers.
 */

// ============================================================================
// Validation Configuration
// ============================================================================

/**
 * Maximum field lengths to prevent memory exhaustion and buffer overflows
 */
const VALIDATION_LIMITS = {
  title: 256,
  notes: 10000,
  login: 256,
  password: 1024,
  url: 2048,
  email: 254,
  recordUid: 64,
  recordType: 64,
  folderUid: 64,
  street: 256,
  city: 128,
  state: 64,
  zip: 32,
  country: 64,
  phone: 32,
  phoneRegion: 8,
  phoneExt: 16,
  user: 1024, // Can be multiple comma-separated emails
  expiration: 64,
  firstName: 64,
  middleName: 64,
  lastName: 64,
  hostname: 256,
  port: 10,
  default: 1024
};

/**
 * Validation patterns for specific field types
 */
const VALIDATION_PATTERNS = {
  // Email: RFC 5322 simplified - allows most valid emails
  email: /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/,
  
  // URL: Basic URL validation
  url: /^https?:\/\/.+$/i,
  
  // UID: Alphanumeric, underscore, hyphen (Keeper record/folder UIDs)
  uid: /^[a-zA-Z0-9_-]+$/,
  
  // Phone: Digits, spaces, dashes, plus, parentheses
  phone: /^[0-9\s\-+()]+$/,
  
  // Record type: Alphanumeric, spaces, underscores, hyphens
  recordType: /^[a-zA-Z0-9\s_-]+$/,
  
  // Port: Digits only, 1-65535
  port: /^[0-9]{1,5}$/
};

// ============================================================================
// Validation Functions
// ============================================================================

/**
 * Validate a single field value
 * @param {string} fieldName - Name of the field for error messages
 * @param {string} value - Value to validate
 * @param {Object} options - Validation options
 * @returns {Object} - { valid: boolean, error?: string }
 */
function validateField(fieldName, value, options = {}) {
  const {
    limitKey = 'default',
    pattern = null,
    required = false,
    allowNewlines = false
  } = options;
  
  // Required check
  if (required && (!value || !value.toString().trim())) {
    return { valid: false, error: `${fieldName} is required` };
  }
  
  // Skip further validation if empty and not required
  if (!value) {
    return { valid: true };
  }
  
  const stringValue = value.toString();
  
  // Length check
  const maxLength = VALIDATION_LIMITS[limitKey] || VALIDATION_LIMITS.default;
  if (stringValue.length > maxLength) {
    return { 
      valid: false, 
      error: `${fieldName} exceeds maximum length of ${maxLength} characters` 
    };
  }
  
  // Newline check (unless allowed)
  if (!allowNewlines && (stringValue.includes('\n') || stringValue.includes('\r'))) {
    return { 
      valid: false, 
      error: `${fieldName} cannot contain newline characters` 
    };
  }
  
  // Pattern check
  if (pattern && VALIDATION_PATTERNS[pattern]) {
    if (!VALIDATION_PATTERNS[pattern].test(stringValue)) {
      return { 
        valid: false, 
        error: `${fieldName} has invalid format` 
      };
    }
  }
  
  return { valid: true };
}

/**
 * Validate email addresses (can be comma-separated)
 * @param {string} emailsString - Comma-separated email addresses
 * @returns {Object} - { valid: boolean, error?: string }
 */
function validateEmails(emailsString) {
  if (!emailsString) {
    return { valid: true };
  }
  
  const emails = emailsString.split(',').map(e => e.trim()).filter(e => e);
  
  for (const email of emails) {
    if (email.length > VALIDATION_LIMITS.email) {
      return { valid: false, error: `Email "${email}" exceeds maximum length` };
    }
    if (!VALIDATION_PATTERNS.email.test(email)) {
      return { valid: false, error: `Invalid email format: "${email}"` };
    }
  }
  
  return { valid: true };
}

/**
 * Validate phone entry object
 * @param {Object} entry - Phone entry { number, region?, ext?, type? }
 * @returns {Object} - { valid: boolean, error?: string }
 */
function validatePhoneEntry(entry) {
  if (!entry) {
    return { valid: true };
  }
  
  // Number is required if entry exists
  if (!entry.number || !entry.number.trim()) {
    return { valid: false, error: 'Phone number is required' };
  }
  
  // Validate number
  const numberValidation = validateField('phone number', entry.number, {
    limitKey: 'phone',
    pattern: 'phone'
  });
  if (!numberValidation.valid) return numberValidation;
  
  // Validate region if provided
  if (entry.region) {
    const regionValidation = validateField('phone region', entry.region, {
      limitKey: 'phoneRegion'
    });
    if (!regionValidation.valid) return regionValidation;
  }
  
  // Validate extension if provided
  if (entry.ext) {
    const extValidation = validateField('phone extension', entry.ext, {
      limitKey: 'phoneExt'
    });
    if (!extValidation.valid) return extValidation;
  }
  
  return { valid: true };
}

/**
 * Validate all command parameters based on action type
 * @param {string} action - Command action (record-add, share-record, etc.)
 * @param {Object} parameters - Command parameters
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
        const emailValidation = validateEmails(parameters.email);
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
      break;
    }
    
    case 'share-record':
    case 'share-folder': {
      // Record/folder UID required
      const uidField = action === 'share-record' ? 'record' : 'folder';
      if (!parameters[uidField]) {
        errors.push(`${uidField} UID is required for ${action}`);
      } else {
        const uidValidation = validateField(uidField, parameters[uidField], {
          limitKey: action === 'share-record' ? 'recordUid' : 'folderUid',
          pattern: 'uid'
        });
        if (!uidValidation.valid) errors.push(uidValidation.error);
      }
      
      // User email(s) required
      if (!parameters.user) {
        errors.push('User email is required for share commands');
      } else {
        const userValidation = validateEmails(parameters.user);
        if (!userValidation.valid) errors.push(userValidation.error);
      }
      break;
    }
    
    case 'epm approval action': {
      // Approval UID required (handled by cliCommand path)
      break;
    }
  }
  
  return {
    valid: errors.length === 0,
    errors: errors.length > 0 ? errors : undefined
  };
}

// ============================================================================
// Shell Escaping Functions
// ============================================================================

/**
 * Escape a value for use inside single-quoted shell arguments.
 * In single quotes, only single quotes need escaping (via '\'' trick).
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

/**
 * Capitalize first letter of a field name
 * @param {string} fieldName - Field name to capitalize
 * @returns {string} - Capitalized field name
 */
function capitalizeFieldName(fieldName) {
  if (!fieldName) return '';
  return fieldName.charAt(0).toUpperCase() + fieldName.slice(1);
}

// ============================================================================
// Command Builder
// ============================================================================

/**
 * Build a Keeper Commander CLI command from structured parameters.
 * 
 * @param {string} action - The command action (record-add, share-record, etc.)
 * @param {Object} parameters - Command parameters
 * @param {string} issueKey - Jira issue key (for context/logging)
 * @returns {string} - The built CLI command string
 * @throws {Error} - If validation fails
 */
function buildKeeperCommand(action, parameters, issueKey) {
  // Check if we have a pre-formatted CLI command (used for record-permission)
  if (parameters.cliCommand) {
    return parameters.cliCommand;
  }
  
  // Input Validation
  const validation = validateCommandParameters(action, parameters);
  if (!validation.valid) {
    throw new Error(`Input validation failed: ${validation.errors.join('; ')}`);
  }
  
  let command = action;
  
  // Build command based on action type
  switch (action) {
    case 'record-add': {
      const recordType = parameters.recordType || 'login';
      command += ` --record-type='${escapeForSingleQuotes(recordType)}'`;
      
      if (!parameters.title) {
        throw new Error(`Title is required for record-add command. Record type: ${recordType}`);
      }
      command += ` --title="${escapeForDoubleQuotes(parameters.title)}"`;
      
      // Handle common fields
      if (parameters.notes) {
        command += ` Notes="${escapeForDoubleQuotes(parameters.notes)}"`;
      }
      
      // Password generation for login records
      if (recordType === 'login' && !parameters.password) {
        command += ` Password=$GEN`;
      }
      
      // Handle phone entries
      if (parameters.phoneEntries && Array.isArray(parameters.phoneEntries) && parameters.phoneEntries.length > 0) {
        const entry = parameters.phoneEntries[0];
        if (entry.number && entry.number.trim()) {
          const phoneObj = { number: entry.number.trim() };
          if (entry.region && entry.region.trim()) phoneObj.region = entry.region.trim();
          if (entry.ext && entry.ext.trim()) phoneObj.ext = entry.ext.trim();
          if (entry.type) phoneObj.type = entry.type;
          const sanitizedPhone = sanitizeJsonObject(phoneObj);
          command += ` Phone='$JSON:${escapeForSingleQuotes(JSON.stringify(sanitizedPhone))}'`;
        }
      }
      
      // Handle other fields dynamically
      const metadataFields = ['recordType', 'title', 'notes', 'skipComment', 'phoneEntries'];
      for (const [key, value] of Object.entries(parameters)) {
        if (metadataFields.includes(key) || !value) continue;
        const fieldName = capitalizeFieldName(key);
        if (typeof value === 'string') {
          command += ` ${fieldName}="${escapeForDoubleQuotes(value)}"`;
        }
      }
      break;
    }
    
    case 'record-update': {
      if (!parameters.record) {
        throw new Error('Record UID is required for record-update command');
      }
      command += ` "${escapeForDoubleQuotes(parameters.record)}"`;
      
      // Handle fields to update
      const skipFields = ['record', 'skipComment'];
      for (const [key, value] of Object.entries(parameters)) {
        if (skipFields.includes(key) || !value) continue;
        const fieldName = capitalizeFieldName(key);
        if (typeof value === 'string') {
          command += ` ${fieldName}="${escapeForDoubleQuotes(value)}"`;
        }
      }
      break;
    }
    
    case 'share-record': {
      if (!parameters.record) {
        throw new Error('Record UID is required for share-record command');
      }
      if (!parameters.user) {
        throw new Error('User email is required for share-record command');
      }
      
      command += ` --record='${escapeForSingleQuotes(parameters.record)}'`;
      command += ` --user='${escapeForSingleQuotes(parameters.user)}'`;
      
      if (parameters.action) {
        command += ` --action='${escapeForSingleQuotes(parameters.action)}'`;
      }
      if (parameters.can_share === true) {
        command += ` --can-share`;
      }
      if (parameters.can_write === true) {
        command += ` --can-write`;
      }
      break;
    }
    
    case 'share-folder': {
      if (!parameters.folder) {
        throw new Error('Folder UID is required for share-folder command');
      }
      if (!parameters.user) {
        throw new Error('User email is required for share-folder command');
      }
      
      command += ` --folder='${escapeForSingleQuotes(parameters.folder)}'`;
      command += ` --user='${escapeForSingleQuotes(parameters.user)}'`;
      
      if (parameters.action) {
        command += ` --action='${escapeForSingleQuotes(parameters.action)}'`;
      }
      break;
    }
    
    default:
      // For other actions, return as-is or with basic parameter handling
      break;
  }
  
  return command;
}

// ============================================================================
// Exports
// ============================================================================

module.exports = {
  // Configuration
  VALIDATION_LIMITS,
  VALIDATION_PATTERNS,
  
  // Validation functions
  validateField,
  validateEmails,
  validatePhoneEntry,
  validateCommandParameters,
  
  // Escaping functions
  escapeForSingleQuotes,
  escapeForDoubleQuotes,
  sanitizeJsonObject,
  capitalizeFieldName,
  
  // Main command builder
  buildKeeperCommand
};
