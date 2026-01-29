/**
 * Sensitive Data Redaction Utility
 * 
 * Redacts sensitive information from Jira ticket descriptions to prevent
 * information disclosure to users with "Browse Projects" permission.
 * 
 * Issue #10: Sensitive Data in Jira Comments
 * 
 * Redaction targets:
 * - Email domains: john.doe@company.com → john.doe@***
 * - Internal FQDNs: prod-db-01.internal.company.com → prod-db-01.***
 * - IP addresses: 192.168.1.100 → [IP REDACTED]
 * - Commands: sudo mysql -u root → [COMMAND REDACTED]
 * - File paths: Truncated to filename only
 * - Justifications: First 50 chars + "..."
 */

// ============================================================================
// Configuration
// ============================================================================

const REDACTION_CONFIG = {
  // Maximum length for justification text before truncation
  maxJustificationLength: 100,
  
  // Maximum length for command preview
  maxCommandPreviewLength: 30,
  
  // Patterns to identify internal/sensitive hostnames
  internalHostnamePatterns: [
    /\.internal\./i,
    /\.local\./i,
    /\.corp\./i,
    /\.lan\./i,
    /\.intranet\./i,
    /\.private\./i,
    /-prod-/i,
    /-dev-/i,
    /-staging-/i,
    /-db-/i,
    /-srv-/i,
  ],
  
  // File extensions that indicate sensitive scripts/executables
  sensitiveFileExtensions: [
    '.sh', '.bash', '.ps1', '.bat', '.cmd', '.exe', '.py', '.rb', '.pl'
  ],
};

// ============================================================================
// Redaction Functions
// ============================================================================

/**
 * Redact email domain while preserving the local part
 * john.doe@company.com → john.doe@***
 * @param {string} email - Email address to redact
 * @returns {string} - Redacted email
 */
export function redactEmailDomain(email) {
  if (!email || typeof email !== 'string') return email;
  
  // Match email pattern
  const emailPattern = /^([^@]+)@(.+)$/;
  const match = email.match(emailPattern);
  
  if (match) {
    return `${match[1]}@***`;
  }
  
  return email;
}

/**
 * Redact internal FQDN while preserving the first part (hostname)
 * prod-db-01.internal.company.com → prod-db-01.***
 * @param {string} fqdn - FQDN to redact
 * @returns {string} - Redacted FQDN
 */
export function redactFQDN(fqdn) {
  if (!fqdn || typeof fqdn !== 'string') return fqdn;
  
  // Check if it looks like an FQDN (contains dots and matches internal patterns)
  const isInternalFQDN = REDACTION_CONFIG.internalHostnamePatterns.some(
    pattern => pattern.test(fqdn)
  );
  
  if (isInternalFQDN) {
    // Extract first part (hostname) and redact the rest
    const parts = fqdn.split('.');
    if (parts.length > 1) {
      return `${parts[0]}.***`;
    }
  }
  
  // Also redact multi-part domains that look internal (3+ parts)
  const parts = fqdn.split('.');
  if (parts.length >= 3) {
    return `${parts[0]}.***`;
  }
  
  return fqdn;
}

/**
 * Redact IP addresses
 * 192.168.1.100 → [IP REDACTED]
 * @param {string} text - Text that may contain IP addresses
 * @returns {string} - Text with IPs redacted
 */
export function redactIPAddresses(text) {
  if (!text || typeof text !== 'string') return text;
  
  // IPv4 pattern
  const ipv4Pattern = /\b(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\b/g;
  
  // IPv6 pattern (simplified)
  const ipv6Pattern = /\b(?:[0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}\b/g;
  
  return text
    .replace(ipv4Pattern, '[IP REDACTED]')
    .replace(ipv6Pattern, '[IP REDACTED]');
}

/**
 * Redact command line while showing a safe preview
 * sudo mysql -u root -p password → sudo mysql [ARGS REDACTED]
 * @param {string} command - Command line to redact
 * @returns {string} - Redacted command
 */
export function redactCommand(command) {
  if (!command || typeof command !== 'string') return command;
  
  // Extract the base command (first word or path)
  const parts = command.trim().split(/\s+/);
  if (parts.length === 0) return command;
  
  // Get the command name (handle paths)
  let commandName = parts[0];
  if (commandName.includes('/') || commandName.includes('\\')) {
    // Extract just the filename from path
    const pathParts = commandName.split(/[/\\]/);
    commandName = pathParts[pathParts.length - 1];
  }
  
  // If there are arguments, indicate they're redacted
  if (parts.length > 1) {
    return `${commandName} [ARGS REDACTED]`;
  }
  
  return commandName;
}

/**
 * Truncate justification text
 * @param {string} justification - Justification text
 * @param {number} maxLength - Maximum length (default from config)
 * @returns {string} - Truncated justification
 */
export function truncateJustification(justification, maxLength = REDACTION_CONFIG.maxJustificationLength) {
  if (!justification || typeof justification !== 'string') return justification;
  
  if (justification.length <= maxLength) {
    return justification;
  }
  
  return justification.substring(0, maxLength) + '...';
}

/**
 * Redact file path, keeping only the filename
 * /opt/company/scripts/backup.sh → backup.sh
 * @param {string} filePath - File path to redact
 * @returns {string} - Filename only
 */
export function redactFilePath(filePath) {
  if (!filePath || typeof filePath !== 'string') return filePath;
  
  // Extract filename from path
  const parts = filePath.split(/[/\\]/);
  return parts[parts.length - 1] || filePath;
}

/**
 * Redact username/email in text
 * Handles both standalone emails and usernames that look like emails
 * @param {string} username - Username to redact
 * @returns {string} - Redacted username
 */
export function redactUsername(username) {
  if (!username || typeof username !== 'string') return username;
  
  // If it's an email, redact the domain
  if (username.includes('@')) {
    return redactEmailDomain(username);
  }
  
  // If it contains backslash (domain\user format), redact the domain
  if (username.includes('\\')) {
    const parts = username.split('\\');
    return `***\\${parts[parts.length - 1]}`;
  }
  
  // Otherwise return as-is (just a username)
  return username;
}

/**
 * Redact sensitive data from a JSON object (for Full API Response)
 * Creates a redacted copy without modifying the original
 * @param {Object} obj - Object to redact
 * @returns {Object} - Redacted copy
 */
export function redactSensitiveObject(obj) {
  if (!obj || typeof obj !== 'object') return obj;
  
  // Create a deep copy
  const redacted = JSON.parse(JSON.stringify(obj));
  
  // Fields to redact
  const fieldsToRedact = {
    // Email/username fields
    'Username': redactUsername,
    'username': redactUsername,
    'user': redactUsername,
    'email': redactEmailDomain,
    'Email': redactEmailDomain,
    'emailAddress': redactEmailDomain,
    
    // Command/path fields
    'CommandLine': redactCommand,
    'command': redactCommand,
    'cmd': redactCommand,
    'FilePath': redactFilePath,
    'file_path': redactFilePath,
    'path': redactFilePath,
    
    // Text fields to truncate
    'justification': truncateJustification,
    'Justification': truncateJustification,
    'description': truncateJustification,
    'Description': truncateJustification,
    
    // IP/hostname fields
    'remote_address': () => '[REDACTED]',
    'ip_address': () => '[REDACTED]',
    'host': redactFQDN,
    'hostname': redactFQDN,
    'server': redactFQDN,
  };
  
  // Recursively process object
  function processObject(obj) {
    if (Array.isArray(obj)) {
      return obj.map(item => processObject(item));
    }
    
    if (obj && typeof obj === 'object') {
      for (const key of Object.keys(obj)) {
        const value = obj[key];
        
        // Check if this field should be redacted
        if (fieldsToRedact[key] && typeof value === 'string') {
          obj[key] = fieldsToRedact[key](value);
        } else if (typeof value === 'object') {
          processObject(value);
        }
      }
    }
    
    return obj;
  }
  
  return processObject(redacted);
}

/**
 * Apply all redaction to approval details for ticket description
 * @param {Object} approvalDetails - Raw approval details from Keeper API
 * @returns {Object} - Redacted approval details
 */
export function redactApprovalDetails(approvalDetails) {
  if (!approvalDetails) return approvalDetails;
  
  // Create a redacted copy
  const redacted = { ...approvalDetails };
  
  // Redact specific fields
  if (redacted.justification) {
    redacted.justification = truncateJustification(redacted.justification);
  }
  
  // Redact account_info
  if (redacted.account_info) {
    redacted.account_info = { ...redacted.account_info };
    if (redacted.account_info.Username) {
      redacted.account_info.Username = redactUsername(redacted.account_info.Username);
    }
  }
  
  // Redact application_info
  if (redacted.application_info) {
    redacted.application_info = { ...redacted.application_info };
    if (redacted.application_info.CommandLine) {
      redacted.application_info.CommandLine = redactCommand(redacted.application_info.CommandLine);
    }
    if (redacted.application_info.FilePath) {
      redacted.application_info.FilePath = redactFilePath(redacted.application_info.FilePath);
    }
  }
  
  return redacted;
}

/**
 * Apply redaction to webhook payload for ticket description
 * @param {Object} payload - Raw webhook payload
 * @returns {Object} - Redacted payload
 */
export function redactWebhookPayload(payload) {
  if (!payload) return payload;
  
  // Create a redacted copy
  const redacted = { ...payload };
  
  // Redact specific fields
  if (redacted.username) {
    redacted.username = redactUsername(redacted.username);
  }
  if (redacted.remote_address) {
    redacted.remote_address = '[REDACTED]';
  }
  if (redacted.description) {
    redacted.description = truncateJustification(redacted.description, 200);
  }
  
  return redacted;
}
