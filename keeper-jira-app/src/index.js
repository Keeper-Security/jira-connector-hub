import Resolver from '@forge/resolver';
import { storage, fetch, route, asApp, asUser, requestJira, webTrigger } from '@forge/api';
import { webTriggerHandler } from './modules/webhookHandler.js';

const resolver = new Resolver();

/**
 * Helper function to get current user information
 * Reusable across all resolvers to avoid code duplication
 */
async function getCurrentUser() {
  try {
    const response = await asUser().requestJira(
      route`/rest/api/3/myself`,
      {
        method: 'GET',
        headers: { 'Accept': 'application/json' }
      }
    );
    
    if (response.ok) {
      return await response.json();
    } else {
      console.error('Failed to fetch current user info, status:', response.status);
      return null;
    }
  } catch (error) {
    console.error('Error fetching current user info:', error);
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
 */
resolver.define('setConfig', async (req) => {
  // Handle double nesting: req.payload.payload
  let payload = req?.payload?.payload || req?.payload || req;
  
  if (!payload) {
    throw new Error('No payload provided');
  }
  
  const apiUrl = payload.apiUrl;
  const apiKey = payload.apiKey; 
  
  const configToSave = { apiUrl, apiKey };
  
  await storage.set('keeperConfig', configToSave);
  
  return { success: true, message: 'Configuration saved successfully' };
});

/**
 * Test Keeper connection (called from frontend)
 */
resolver.define('testConnection', async (req) => {
  // Handle double nesting: req.payload.payload
  let payload = req?.payload?.payload || req?.payload || req;
  
  if (!payload) {
    throw new Error('No payload provided');
  }
  
  const apiUrl = payload.apiUrl;
  const apiKey = payload.apiKey;
  
  if (!apiUrl || !apiKey) {
    throw new Error('API URL and API Key are required for testing connection');
  }
  
  // Construct the full API endpoint
  // Use the complete API URL as provided by the user
  const fullApiUrl = apiUrl.endsWith('/') ? apiUrl.slice(0, -1) : apiUrl;

  try {
    // Test with service-status command to check Keeper Commander service
    const response = await fetch(fullApiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'api-key': apiKey,
      },
      body: JSON.stringify({
        command: 'service-status', // Check service status
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Connection failed: ${response.status} - ${errorText}`);
    }

    const data = await response.json();

    if (data.status !== 'success' || data.error) {
      throw new Error(`Connection failed: ${data.error || data.message || 'Unknown error'}`);
    }

    // Extract service status information
    const serviceMessage = data.message || 'Service status unknown';
    const isRunning = serviceMessage.toLowerCase().includes('running');

    return { 
      success: true, 
      message: isRunning ? 'Connection test successful!' : 'Connection established but service may not be running properly',
      serviceStatus: serviceMessage,
      isServiceRunning: isRunning
    };
  } catch (err) {
    throw new Error(`Connection test failed: ${err.message}`);
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
      const issueResponse = await asApp().requestJira(
        route`/rest/api/3/issue/${issueKey}?fields=labels`,
        {
          method: 'GET',
          headers: { 'Accept': 'application/json' }
        }
      );
      
      if (issueResponse.ok) {
        const issueData = await issueResponse.json();
        labels = issueData.fields?.labels || [];
      }
    } catch (error) {
      console.error('Failed to fetch issue labels:', error);
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

/**
 * Helper function to parse and clean Keeper CLI error messages
 * Extracts the meaningful user-friendly error message from verbose CLI output
 */
function parseKeeperErrorMessage(errorMessage) {
  if (!errorMessage || typeof errorMessage !== 'string') return errorMessage;
  
  let errorText = errorMessage;
  
  // Try to parse JSON response and extract error field
  try {
    const jsonError = JSON.parse(errorMessage);
    if (jsonError.error) {
      errorText = jsonError.error;
    } else if (jsonError.message) {
      errorText = jsonError.message;
    }
  } catch (e) {
    // Not JSON, use as-is
  }
  
  // Split by newlines and process each line
  const lines = errorText.split('\n').map(line => line.trim()).filter(line => line);
  
  // Skip system messages like "Bypassing master password enforcement..."
  const meaningfulLines = lines.filter(line => 
    !line.startsWith('Bypassing master password') &&
    !line.includes('running in service mode')
  );
  
  // If we have meaningful lines, process them
  if (meaningfulLines.length > 0) {
    const lastLine = meaningfulLines[meaningfulLines.length - 1];
    
    // Look for pattern: "Failed to ... : <actual error message>"
    // Extract the part after the last colon if it contains a meaningful message
    const colonIndex = lastLine.lastIndexOf(': ');
    if (colonIndex !== -1) {
      const afterColon = lastLine.substring(colonIndex + 2).trim();
      // Check if the part after colon is a meaningful message (not just a short token)
      if (afterColon.length > 20 && !afterColon.includes('Failed to')) {
        return afterColon;
      }
    }
    
    // If no colon pattern found, return the last meaningful line
    return lastLine;
  }
  
  return errorText;
}

/**
 * Build Keeper CLI command from action and parameters
 */
// Helper function to capitalize first letter of a field name
function capitalizeFieldName(fieldName) {
  if (!fieldName || typeof fieldName !== 'string') return fieldName;
  return fieldName.charAt(0).toUpperCase() + fieldName.slice(1);
}

function buildKeeperCommand(action, parameters, issueKey) {
  // Check if we have a pre-formatted CLI command (used for record-permission)
  if (parameters.cliCommand) {
    return parameters.cliCommand;
  }
  
  let command = action;
  
  // Build command based on action type
  switch (action) {
    case 'record-add':
      // Use the recordType parameter if provided, otherwise default to login
      const recordType = parameters.recordType || 'login';
      command += ` --record-type='${recordType}'`;
      
      // Title is required for all record types
      if (!parameters.title) {
        throw new Error(`Title is required for record-add command. Record type: ${recordType}`);
      }
      command += ` --title="${parameters.title}"`;
      // Handle common fields for all record types
      if (parameters.notes) {
        command += ` Notes="${parameters.notes}"`;
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
          command += ` Phone='$JSON:${JSON.stringify(phoneObj)}'`;
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
          // Handle custom fields (c.text.Department, c.secret.API_Key, etc.)
          if (key.startsWith('c.')) {
              command += ` ${key}='${value}'`;
          }
          // Handle text.fieldname format (e.g., text.type for databaseCredentials)
          else if (key.startsWith('text.')) {
              // Keep as-is (lowercase) for Keeper CLI
              command += ` ${key}='${value}'`;
          }
          // Handle grouped fields that don't need JSON - skip, handled in jsonFields
          else if (key.includes('_')) {
            // These are handled in jsonFields section
          }
          // Single fields (login, password, url, email, etc.) - keep lowercase
          else {
            command += ` ${key}='${value}'`;
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
            // Keep field names lowercase for Keeper CLI
            command += ` ${fieldName}='$JSON:${JSON.stringify(fieldData)}'`;
          }
        }
      });
      
      break;
      
    case 'record-update':
      // Required record parameter
      if (parameters.record) {
        command += ` --record='${parameters.record}'`;
      }
      
      // Optional title update
      if (parameters.title) {
        command += ` --title='${parameters.title}'`;
      }
      
      // Optional record type change
      if (parameters.recordType) {
        command += ` --record-type='${parameters.recordType}'`;
      }
      
      // Notes handling (with + prefix to append, without to replace)
      if (parameters.notes) {
        if (parameters.appendNotes === true) {
          command += ` --notes='+${parameters.notes}'`;
        } else {
          command += ` --notes='${parameters.notes}'`;
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
                const addressCommand = ` address='$JSON:${JSON.stringify(addressObj)}'`;
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
                command += ` name='$JSON:${JSON.stringify(nameObj)}'`;
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
                command += ` phone='$JSON:${JSON.stringify(simplePhoneObj)}'`;
              }
              break;
              
            case 'keyPair':
              // SSH keyPair format: keyPair='$JSON:{"privateKey": "...", "publicKey": "..."}'
              const keyPairObj = {};
              if (fieldData.privateKey) keyPairObj.privateKey = fieldData.privateKey;
              if (fieldData.publicKey) keyPairObj.publicKey = fieldData.publicKey;
              
              if (Object.keys(keyPairObj).length > 0) {
                command += ` keyPair='$JSON:${JSON.stringify(keyPairObj)}'`;
              }
              break;
              
            case 'host':
              // Host format: host='$JSON:{"hostName": "...", "port": "..."}'
              const hostObj = {};
              if (fieldData.hostName) hostObj.hostName = fieldData.hostName;
              if (fieldData.port) hostObj.port = fieldData.port;
              
              if (Object.keys(hostObj).length > 0) {
                command += ` host='$JSON:${JSON.stringify(hostObj)}'`;
              }
              break;
              
            default:
              // Handle any other grouped fields as custom fields
              Object.keys(fieldData).forEach(subField => {
                const subValue = fieldData[subField];
                if (subValue) {
                  // Use only the original field name (subField) for custom fields
                  command += ` c.text.${subField}="${subValue}"`;
                }
              });
              break;
          }
        } else {
          // Handle single fields
          const value = fieldData;
          
          switch (fieldGroup) {
            case 'login':
              command += ` login='${value}'`;
              break;
              
            case 'password':
              if (value === '$GEN' || value === 'generate') {
                command += ` password=$GEN`;
              } else {
                command += ` password='${value}'`;
              }
              break;
              
            case 'passphrase':
              // Passphrase is a password-type field with label "passphrase"
              // Keeper CLI format: password.label='value'
              if (value === '$GEN' || value === 'generate') {
                command += ` password.passphrase=$GEN`;
              } else {
                command += ` password.passphrase='${value}'`;
              }
              break;
              
            case 'url':
              command += ` url='${value}'`;
              break;
              
            case 'email':
              command += ` email='${value}'`;
              break;
              
            case 'licenseNumber':
              // Standard Keeper field type for software licenses
              command += ` licenseNumber='${value}'`;
              break;
              
            case 'accountNumber':
              // Standard Keeper field type for memberships
              command += ` accountNumber='${value}'`;
              break;
              
            case 'expirationDate':
              // Standard Keeper field type for expiration dates
              command += ` expirationDate='${value}'`;
              break;
              
            case 'note':
              // Standard Keeper field type for notes
              command += ` note='${value}'`;
              break;
              
            case 'date':
              // Handle different date formats
              if (value.match(/^\d{4}-\d{2}-\d{2}$/)) {
                command += ` date='${value}'`;
              } else if (value.match(/^\d+$/)) {
                command += ` date=${value}`;
              } else {
                command += ` date='${value}'`;
              }
              break;
              
            case 'text':
            case 'multiline':
            case 'secret':
              // Handle as custom field with appropriate type
              command += ` c.${fieldGroup}.${fieldGroup}='${value}'`;
              break;
              
            default:
              // Handle custom fields (c.*) and labeled fields (type.label format like date.dateActive, password.passphrase)
              if (fieldGroup.startsWith('c.') || fieldGroup.startsWith('text.') || fieldGroup.startsWith('date.') || fieldGroup.startsWith('password.')) {
                command += ` ${fieldGroup}='${value}'`;
                break;
              }
              // Any other single field - use c.secret for $GEN values, c.text for others
              if (value === '$GEN' || value === 'generate') {
                command += ` c.secret.${fieldGroup}=$GEN`;
              } else {
                command += ` c.text.${fieldGroup}='${value}'`;
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
          command += ` phone='$JSON:${JSON.stringify(phoneObj)}'`;
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
        command += ` '${parameters.folder}'`;
      } else if (parameters.sharedFolder) {
        command += ` '${parameters.sharedFolder}'`;
      }
      
      // Add action flag (-a)
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
        command += ` '${parameters.record}'`;
      }
      
      // For cancel action, add either record UID or folder UID (admin can select either)
      if (parameters.action === 'cancel') {
        if (parameters.record) {
          command += ` '${parameters.record}'`;
        } else if (parameters.sharedFolder) {
          command += ` '${parameters.sharedFolder}'`;
        }
      }
      
      // Handle email addresses - support comma-separated values
      if (parameters.user) {
        // Split by comma and trim whitespace
        const emails = parameters.user.split(',').map(email => email.trim()).filter(email => email);
        // Add each email with its own -e flag
        emails.forEach(email => {
          command += ` -e '${email}'`;
        });
      }
      
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
          command += ` --expire-at "${expireAtFormatted}"`;
        } else if (parameters.expiration_type === 'expire-in' && parameters.expire_in) {
          command += ` --expire-in ${parameters.expire_in}`;
        }
      }
      
      // Add force flag at the end
      command += ` -f`;
      break;
      
    case 'share-folder':
      // Format: share-folder "FOLDER_UID" -e "EMAIL" -a "ACTION" [options] [--expire-at|--expire-in] --force
      if (parameters.folder) {
        command += ` '${parameters.folder}'`;
      }
      
      // Handle email addresses - support comma-separated values
      if (parameters.user) {
        // Split by comma and trim whitespace
        const emails = parameters.user.split(',').map(email => email.trim()).filter(email => email);
        // Add each email with its own -e flag
        emails.forEach(email => {
          command += ` -e '${email}'`;
        });
      }
      
      if (parameters.action) {
        command += ` -a ${parameters.action}`;
      }
      // Add optional permission flags only when set to 'on'
      // Only include permissions that are explicitly granted
      if (parameters.manage_records === true) {
        command += ` -p on`;
      }
      if (parameters.manage_users === true) {
        command += ` -o on`;
      }
      if (parameters.can_share === true) {
        command += ` -s on`;
      }
      if (parameters.can_edit === true) {
        command += ` -d on`;
      }
      // Add expiration options
      if (parameters.expiration_type === 'expire-at' && parameters.expire_at) {
        // Convert datetime-local format to ISO format (yyyy-MM-dd hh:mm:ss)
        const expireAtFormatted = parameters.expire_at.replace('T', ' ');
        command += ` --expire-at "${expireAtFormatted}"`;
      } else if (parameters.expiration_type === 'expire-in' && parameters.expire_in) {
        command += ` --expire-in ${parameters.expire_in}`;
      }
      // Add force flag at the end
      command += ` --force`;
      break;
      
    default:
      // For any other commands, add parameters as key=value pairs
      Object.keys(parameters).forEach(key => {
        if (parameters[key]) {
            command += ` ${key}='${parameters[key]}'`;
        }
      });
  }
  
  return command;
}

/**
 * Get records list from Keeper API (called from issue panel)
 */
resolver.define('getKeeperRecords', async (req) => {
  const config = await storage.get('keeperConfig');
  if (!config) {
    throw new Error('Keeper configuration not found. Please configure the app first.');
  }

  const { apiUrl, apiKey } = config;
  
  // Construct the full API endpoint
  // Use the complete API URL as provided by the user
  const fullApiUrl = apiUrl.endsWith('/') ? apiUrl.slice(0, -1) : apiUrl;

  try {
    const response = await fetch(fullApiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'api-key': apiKey,
      },
      body: JSON.stringify({
        command: 'list --format=json',
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      const cleanedError = parseKeeperErrorMessage(errorText);
      throw new Error(`Keeper API error: ${response.status} - ${cleanedError}`);
    }

    const data = await response.json();

    if (data.status !== "success" || data.error) {
      const rawError = data.error || data.message || 'Unknown error';
      const cleanedError = parseKeeperErrorMessage(rawError);
      throw new Error(cleanedError);
    }

    // Parse the JSON data from the response
    let records = [];
    if (data.data && Array.isArray(data.data)) {
      records = data.data;
    } else if (data.message && typeof data.message === 'string') {
      try {
        records = JSON.parse(data.message);
      } catch (parseError) {
        throw new Error('Failed to parse records data from message field');
      }
    } else if (data.data && typeof data.data === 'string') {
      try {
        records = JSON.parse(data.data);
      } catch (parseError) {
        throw new Error('Failed to parse records data from data field');
      }
    } else {
      // No records found
    }

    return { success: true, records: records || [] };
  } catch (err) {
    throw err;
  }
});

/**
 * Get folders list from Keeper API (called from issue panel)
 */
resolver.define('getKeeperFolders', async (req) => {
  const config = await storage.get('keeperConfig');
  if (!config) {
    throw new Error('Keeper configuration not found. Please configure the app first.');
  }

  const { apiUrl, apiKey } = config;
  
  // Construct the full API endpoint
  // Use the complete API URL as provided by the user
  const fullApiUrl = apiUrl.endsWith('/') ? apiUrl.slice(0, -1) : apiUrl;

  try {
    const response = await fetch(fullApiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'api-key': apiKey,
      },
      body: JSON.stringify({
        command: 'ls -f --format=json',
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      const cleanedError = parseKeeperErrorMessage(errorText);
      throw new Error(`Keeper API error: ${response.status} - ${cleanedError}`);
    }

    const data = await response.json();

    if (data.success === false || data.error) {
      const rawError = data.error || data.message || 'Unknown error';
      const cleanedError = parseKeeperErrorMessage(rawError);
      throw new Error(cleanedError);
    }

    // Parse the JSON data from the response
    let folders = [];
    if (data.data && Array.isArray(data.data)) {
      try {
        // data.data is directly an array of folders for ls -f command
        folders = data.data.map((folder, index) => {
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
            folder_uid: folder.uid, // Use uid from the new format
            uid: folder.uid, // Use uid from the new format
            name: cleanName,
            title: cleanName, // Add title alias
            path: cleanName,
            flags: flags,
            parent_uid: parentUid,
            shared: flags && flags.includes('S'), // Mark as shared if flags contains "S"
            raw_data: folder
          };
        });
      } catch (parseError) {
        throw new Error('Failed to parse folders data');
      }
    } else {
      // No folder data found
    }

    return { success: true, folders: folders || [] };
  } catch (err) {
    throw err;
  }
});

/**
 * Get detailed record information from Keeper API (called from issue panel for record-update)
 */
resolver.define('getKeeperRecordDetails', async (req) => {
  const { recordUid } = req.payload || {};
  
  if (!recordUid) {
    throw new Error('Record UID is required to fetch record details');
  }
  
  const config = await storage.get('keeperConfig');
  if (!config) {
    throw new Error('Keeper configuration not found. Please configure the app first.');
  }

  const { apiUrl, apiKey } = config;
  
  // Construct the full API endpoint
  // Use the complete API URL as provided by the user
  const fullApiUrl = apiUrl.endsWith('/') ? apiUrl.slice(0, -1) : apiUrl;

  try {
    const response = await fetch(fullApiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'api-key': apiKey,
      },
      body: JSON.stringify({
        command: `get "${recordUid}" --format=json`,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      const cleanedError = parseKeeperErrorMessage(errorText);
      throw new Error(`Keeper API error: ${response.status} - ${cleanedError}`);
    }

    const data = await response.json();

    if (data.success === false || data.error) {
      const rawError = data.error || data.message || 'Unknown error';
      const cleanedError = parseKeeperErrorMessage(rawError);
      throw new Error(cleanedError);
    }

    // Parse the JSON data from the response
    let recordDetails = {};
    if (data.data) {
      try {
        // Parse the JSON response from get command
        if (typeof data.data === 'string') {
          recordDetails = JSON.parse(data.data);
        } else if (typeof data.data === 'object') {
          recordDetails = data.data;
        }
      } catch (parseError) {
        throw new Error('Failed to parse record details data');
      }
    }

    return { success: true, recordDetails: recordDetails || {} };
  } catch (err) {
    throw err;
  }
});

/**
 * Execute a simple Keeper command (called from config page for PEDM, etc.)
 */
resolver.define('executeKeeperCommand', async (req) => {
  // Handle double nesting: req.payload.payload
  let payload = req?.payload?.payload || req?.payload || req;
  
  if (!payload) {
    throw new Error('No payload provided');
  }
  
  const { command } = payload;
  
  if (!command) {
    throw new Error('Command is required');
  }
  
  const config = await storage.get('keeperConfig');
  if (!config) {
    throw new Error('Keeper configuration not found. Please configure the app first.');
  }

  const { apiUrl, apiKey } = config;
  
  // Construct the full API endpoint
  // Use the complete API URL as provided by the user
  const fullApiUrl = apiUrl.endsWith('/') ? apiUrl.slice(0, -1) : apiUrl;

  try {
    // Call Keeper API
    const response = await fetch(fullApiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'api-key': apiKey,
      },
      body: JSON.stringify({
        command: command,
      }),
    });

    // Check if the API call was successful
    if (!response.ok) {
      const errorText = await response.text();
      const cleanedError = parseKeeperErrorMessage(errorText);
      throw new Error(`Keeper API error: ${response.status} - ${cleanedError}`);
    }

    const data = await response.json();

    // Check if API response indicates error
    if (data.success === false || data.error) {
      const rawError = data.error || data.message || 'Unknown error';
      const cleanedError = parseKeeperErrorMessage(rawError);
      throw new Error(cleanedError);
    }

    return { 
      success: true, 
      data: data,
      message: data.message || 'Command executed successfully'
    };
  } catch (err) {
    throw err;
  }
});

/**
 * Manual Keeper action trigger (called from issue panel)
 */
resolver.define('executeKeeperAction', async (req) => {
  const { issueKey, command, commandDescription, parameters, formattedTimestamp } = req.payload;
  
  if (!issueKey) {
    throw new Error('Issue key is required');
  }
  
  if (!command) {
    throw new Error('Command is required');
  }
  
  // Check if this is a PEDM command and if the request is already expired or action was already taken
  const isPedmCommand = command.startsWith('pedm approval action');
  if (isPedmCommand) {
    // Check if any action label already exists
    try {
      const issueResponse = await asApp().requestJira(
        route`/rest/api/3/issue/${issueKey}?fields=labels`,
        {
          method: 'GET',
          headers: { 'Accept': 'application/json' }
        }
      );
      
      if (issueResponse.ok) {
        const issueData = await issueResponse.json();
        const labels = issueData.fields?.labels || [];
        
        if (labels.includes('pedm-approved')) {
          throw new Error('This approval request has already been approved');
        }
        if (labels.includes('pedm-denied')) {
          throw new Error('This approval request has already been denied');
        }
        if (labels.includes('pedm-expired')) {
          throw new Error('This approval request has expired and can no longer be approved or denied');
        }
      }
    } catch (error) {
      // If it's our custom error, throw it
      if (error.message.includes('approval request')) {
        throw error;
      }
      // Otherwise, continue
    }
  }
  
  const config = await storage.get('keeperConfig');
  if (!config) {
    throw new Error('Keeper configuration not found. Please configure the app first.');
  }

  const { apiUrl, apiKey } = config;
  
  // Build dynamic command based on action and parameters
  const dynamicCommand = buildKeeperCommand(command, parameters || {}, issueKey);
  
  // Construct the full API endpoint
  // Use the complete API URL as provided by the user
  const fullApiUrl = apiUrl.endsWith('/') ? apiUrl.slice(0, -1) : apiUrl;

  try {
    // Call Keeper API
    const response = await fetch(fullApiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'api-key': apiKey,
      },
      body: JSON.stringify({
        command: dynamicCommand,
      }),
    });

    // Check if the API call was successful
    if (!response.ok) {
      const errorText = await response.text();
      const cleanedError = parseKeeperErrorMessage(errorText);
      throw new Error(`Keeper API error: ${response.status} - ${cleanedError}`);
    }

    const data = await response.json();

    // Check if API response indicates error
    if (data.success === false || data.error) {
      const rawError = data.error || data.message || 'Unknown error';
      const cleanedError = parseKeeperErrorMessage(rawError);
      throw new Error(cleanedError);
    }

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

    // Check if this is a PEDM command
    const isPedmCommand = command.startsWith('pedm approval action');
    
    // Only add comment for main record creation, not for records created as references
    // Check if this is a main record creation (not just a reference record)
    // Records created as references will have skipComment: true parameter
    const isMainRecordCreation = !parameters.skipComment;
    
    if (isMainRecordCreation || isPedmCommand) {
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
      
      // Set command-specific messages
      // Handle PEDM commands first
      if (isPedmCommand) {
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
          
          // Build detailed message for share-record
          actionMessage = `Shared record with ${parameters.user}`;
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
          break;
          
        case 'share-folder':
          // Build detailed action description
          actionDescription = `Share Folder - ${parameters.action ? parameters.action.charAt(0).toUpperCase() + parameters.action.slice(1) : 'Grant'} access to ${parameters.user}`;
          
          // Build detailed message for share-folder
          actionMessage = `Shared folder with ${parameters.user}`;
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
          break;
          
          default:
            actionMessage = data.message || 'Keeper action executed successfully';
        }
      }
      
      // Build ADF content with panel (matching save/reject request format)
      let panelTitle = 'Keeper Request Approved and Executed';
      if (isPedmCommand) {
        if (command.includes('--approve')) {
          panelTitle = 'Endpoint Privilege Approval Request - Approved';
        } else if (command.includes('--deny')) {
          panelTitle = 'Endpoint Privilege Approval Request - Denied';
        }
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
      
      // Add record UID if available
      if (recordUid) {
        contentArray.push({
          type: 'hardBreak'
        });
        contentArray.push({
          type: 'text',
          text: `Record UID: ${recordUid}`
        });
      }
      
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
      
      // Use different panel types for PEDM commands
      let panelType = 'success';
      if (isPedmCommand && command.includes('--deny')) {
        panelType = 'warning';
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

      // For PEDM commands, add appropriate label FIRST (before comment) to prevent race conditions
      if (isPedmCommand) {
        try {
          // Get current labels
          const issueResponse = await asApp().requestJira(
            route`/rest/api/3/issue/${issueKey}?fields=labels`,
            {
              method: 'GET',
              headers: { 'Accept': 'application/json' }
            }
          );
          
          const issueData = await issueResponse.json();
          const currentLabels = issueData.fields?.labels || [];
          
          // Determine which label to add
          let newLabel = '';
          if (command.includes('--approve')) {
            newLabel = 'pedm-approved';
          } else if (command.includes('--deny')) {
            newLabel = 'pedm-denied';
          }
          
          // Add new label if not already present
          if (newLabel && !currentLabels.includes(newLabel)) {
            const updatedLabels = [...currentLabels, newLabel];
            
            await asApp().requestJira(
              route`/rest/api/3/issue/${issueKey}`,
              {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  fields: {
                    labels: updatedLabels
                  }
                }),
              }
            );
          }
        } catch (labelErr) {
          console.error('Failed to add PEDM label:', labelErr);
          // Don't fail the entire operation if label update fails
        }
      }
      
      // Add comment back to Jira using ADF format (after label is set)
      await asApp().requestJira(
        route`/rest/api/3/issue/${issueKey}/comment`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            body: adfBody,
          }),
        }
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
    
    // No JIRA comment for errors - only successful responses get comments
    throw err;
  }
});

/**
 * Reject Keeper request (called from issue panel)
 */
resolver.define('rejectKeeperRequest', async (req) => {
  const { issueKey, rejectionReason, formattedTimestamp } = req.payload;
  
  if (!issueKey) {
    throw new Error('Issue key is required');
  }
  
  if (!rejectionReason || !rejectionReason.trim()) {
    throw new Error('Rejection reason is required');
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

    // Add rejection comment to Jira using ADF format
    await asApp().requestJira(
      route`/rest/api/3/issue/${issueKey}/comment`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          body: adfBody,
        }),
      }
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
    // Activate the Keeper panel for this issue
    // This makes the panel visible to all users viewing the issue
    await asApp().requestJira(
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
      }
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
    
    // Get permissions data
    try {
      const permResponse = await asUser().requestJira(route`/rest/api/3/mypermissions?projectKey=${projectKey}&permissions=ADMINISTER_PROJECTS`);
      
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
 */
resolver.define('getWebTriggerUrl', async () => {
  try {
    const url = await webTrigger.getUrl('keeper-alert-trigger');
    return {
      success: true,
      url: url
    };
  } catch (err) {
    throw new Error(`Failed to get web trigger URL: ${err.message}`);
  }
});

/**
 * Get web trigger configuration
 */
resolver.define('getWebTriggerConfig', async () => {
  const config = await storage.get('webTriggerConfig');
  return config || {};
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
  
  const configToSave = { projectKey, issueType };
  
  await storage.set('webTriggerConfig', configToSave);
  
  return { success: true, message: 'Web trigger configuration saved successfully' };
});

/**
 * Get all Jira projects
 */
resolver.define('getJiraProjects', async () => {
  try {
    const response = await asApp().requestJira(route`/rest/api/3/project`);
    
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
    // Get project details which includes issue types
    const response = await asApp().requestJira(route`/rest/api/3/project/${projectKey}`);
    
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
    // Create a test issue
    const response = await asApp().requestJira(
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
      }
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
    
    // Create the Jira issue
    const response = await asApp().requestJira(
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
      }
    );
    
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Failed to create issue: ${errorText}`);
    }
    
    const issue = await response.json();
    
    // For PEDM approval requests (test or real), assign to a project admin
    if (payload.category === 'endpoint_privilege_manager' && payload.audit_event === 'approval_request_created') {
      try {
        // Get project admins
        const projectKey = config.projectKey;
        
        // Get project roles
        const rolesResponse = await asApp().requestJira(route`/rest/api/3/project/${projectKey}/role`);
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
            
            // Get role details with actors
            const roleDetailsResponse = await asApp().requestJira(route`/rest/api/3/project/${projectKey}/role/${roleId}`);
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
              
              // Assign ticket to admin
              if (assigneeAccountId) {
                await asApp().requestJira(
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
                  }
                );
                console.log(`Assigned PEDM ticket ${issue.key} to project admin`);
              }
            }
          }
        }
      } catch (assignError) {
        console.error('Failed to assign ticket to project admin:', assignError);
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
    
    // Fetch issues using the new JQL enhanced search API (POST /rest/api/3/search/jql)
    const response = await asApp().requestJira(
      route`/rest/api/3/search/jql`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jql: jql,
          maxResults: 100,
          fields: ['summary', 'created', 'description', 'status', 'labels', 'key', 'issuetype']
        })
      }
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
        console.error('Failed to parse JSON from description:', e);
      }
      
      return {
        key: issue.key,
        id: issue.id,
        summary: issue.fields.summary,
        created: issue.fields.created,
        status: issue.fields.status?.name || 'Unknown',
        labels: issue.fields.labels || [],
        issueType: issue.fields.issuetype?.name || 'Unknown',
        description: jsonPayload?.description || issue.fields.summary,
        requestUid: jsonPayload?.request_uid || null,
        agentUid: jsonPayload?.agent_uid || null,
        username: jsonPayload?.username || null,
        category: jsonPayload?.category || null,
        auditEvent: jsonPayload?.audit_event || null,
        alertName: jsonPayload?.alert_name || null
      };
    });
    
    return {
      success: true,
      issues: issues,
      total: data.total
    };
    
  } catch (error) {
    console.error('Error fetching webhook tickets:', error);
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
    // Fetch the issue with description field
    const response = await asApp().requestJira(
      route`/rest/api/3/issue/${issueKey}?fields=description,labels`,
      {
        method: 'GET',
        headers: { 'Accept': 'application/json' }
      }
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
          console.error('Failed to parse webhook payload:', e);
        }
      }
    }
    
    return {
      success: true,
      payload: webhookPayload,
      labels: labels
    };
    
  } catch (error) {
    console.error('Error fetching webhook payload:', error);
    throw new Error(`Failed to fetch webhook payload: ${error.message}`);
  }
});

/**
 * Check if PEDM request is already expired (has the issue property)
 */
resolver.define('checkPedmExpired', async (req) => {
  const { issueKey } = req.payload;
  
  if (!issueKey) {
    throw new Error('Issue key is required');
  }
  
  try {
    const propertyResponse = await asApp().requestJira(
      route`/rest/api/3/issue/${issueKey}/properties/pedm-request-expired`,
      {
        method: 'GET',
        headers: { 'Accept': 'application/json' }
      }
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
    console.error('Error checking PEDM expiration:', error);
    return { 
      success: true, 
      isExpired: false 
    };
  }
});

/**
 * Add comment for expired PEDM approval request
 */
/**
 * Check if PEDM action was already taken by checking labels
 */
resolver.define('checkPedmActionTaken', async (req) => {
  const { issueKey } = req.payload;
  
  if (!issueKey) {
    throw new Error('Issue key is required');
  }
  
  try {
    // Fetch issue labels
    const issueResponse = await asApp().requestJira(
      route`/rest/api/3/issue/${issueKey}?fields=labels`,
      {
        method: 'GET',
        headers: { 'Accept': 'application/json' }
      }
    );
    
    if (!issueResponse.ok) {
      throw new Error('Failed to fetch issue details');
    }
    
    const issueData = await issueResponse.json();
    const labels = issueData.fields?.labels || [];
    
    // Check for PEDM action labels
    if (labels.includes('pedm-approved')) {
      return { 
        success: true, 
        actionTaken: true, 
        action: 'approved',
        message: 'Request already approved'
      };
    }
    
    if (labels.includes('pedm-denied')) {
      return { 
        success: true, 
        actionTaken: true, 
        action: 'denied',
        message: 'Request already denied'
      };
    }
    
    if (labels.includes('pedm-expired')) {
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
    console.error('Error checking PEDM action:', err);
    return { 
      success: false, 
      actionTaken: false,
      action: null,
      message: err.message 
    };
  }
});

resolver.define('addPedmExpiredComment', async (req) => {
  const { issueKey, formattedTimestamp } = req.payload;
  
  if (!issueKey) {
    throw new Error('Issue key is required');
  }
  
  try {
    // FIRST: Try to set the issue property as a lock to prevent race conditions
    // Check if property already exists
    const propertyCheckResponse = await asApp().requestJira(
      route`/rest/api/3/issue/${issueKey}/properties/pedm-request-expired`,
      {
        method: 'GET',
        headers: { 'Accept': 'application/json' }
      }
    );
    
    // If property already exists, someone else already processed this
    if (propertyCheckResponse.ok) {
      return { 
        success: true, 
        message: 'Expired comment already processed',
        alreadyExpired: true
      };
    }
    
    // Check if any action label already exists (expired, approved, or denied)
    const issueResponse = await asApp().requestJira(
      route`/rest/api/3/issue/${issueKey}?fields=labels`,
      {
        method: 'GET',
        headers: { 'Accept': 'application/json' }
      }
    );
    
    if (issueResponse.ok) {
      const issueData = await issueResponse.json();
      const labels = issueData.fields?.labels || [];
      
      if (labels.includes('pedm-approved') || 
          labels.includes('pedm-denied') || 
          labels.includes('pedm-expired')) {
        return { 
          success: true, 
          message: 'Action already taken (label found)',
          alreadyExpired: true
        };
      }
    }
    
    // Set the property BEFORE adding comment (as a lock)
    await asApp().requestJira(
      route`/rest/api/3/issue/${issueKey}/properties/pedm-request-expired`,
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
      }
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
    
    // Add 'pedm-expired' label FIRST (before comment) to prevent race conditions
    try {
      // Get current labels (we already fetched this earlier, but need fresh data)
      const labelResponse = await asApp().requestJira(
        route`/rest/api/3/issue/${issueKey}?fields=labels`,
        {
          method: 'GET',
          headers: { 'Accept': 'application/json' }
        }
      );
      
      const labelData = await labelResponse.json();
      const currentLabels = labelData.fields?.labels || [];
      
      // Add expired label if not already present
      if (!currentLabels.includes('pedm-expired')) {
        const updatedLabels = [...currentLabels, 'pedm-expired'];
        
        await asApp().requestJira(
          route`/rest/api/3/issue/${issueKey}`,
          {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              fields: {
                labels: updatedLabels
              }
            }),
          }
        );
      }
    } catch (labelErr) {
      console.error('Failed to add pedm-expired label:', labelErr);
      // Don't fail the entire operation if label update fails
    }
    
    // Now add comment to Jira (after label is set)
    await asApp().requestJira(
      route`/rest/api/3/issue/${issueKey}/comment`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          body: adfBody,
        }),
      }
    );
    
    // Update issue property with final details
    await asApp().requestJira(
      route`/rest/api/3/issue/${issueKey}/properties/pedm-request-expired`,
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
      }
    );
    
    return { 
      success: true, 
      message: 'Expired comment added successfully',
      alreadyExpired: false
    };
  } catch (error) {
    console.error('Error adding expired comment:', error);
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
    // Single API call checks both permission types
    try {
      const permResponse = await asUser().requestJira(
        route`/rest/api/3/mypermissions?permissions=ADMINISTER,ADMINISTER_PROJECTS`
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
    
    // Get project details
    const projectResponse = await asApp().requestJira(route`/rest/api/3/project/${projectKey}`);
    const project = await projectResponse.json();
    
    if (!project || !project.id) {
      throw new Error('Unable to fetch project details');
    }
    
    // Get all roles for the project
    const rolesResponse = await asApp().requestJira(route`/rest/api/3/project/${projectKey}/role`);
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
    
    // Get role details with actors (users)
    const roleDetailsResponse = await asApp().requestJira(route`/rest/api/3/project/${projectKey}/role/${roleId}`);
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
        
        // Fetch fresh user details from Jira API
        const userResponse = await asApp().requestJira(route`/rest/api/3/user?accountId=${accountId}`);
        
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
  
  if (!issueKey) {
    throw new Error('Issue key is required');
  }
  
  if (!requestData) {
    throw new Error('Request data is required');
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
        // Get project roles
        const rolesResponse = await asApp().requestJira(route`/rest/api/3/project/${projectKey}/role`);
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
            
            // Get role details with actors
            const roleDetailsResponse = await asApp().requestJira(route`/rest/api/3/project/${projectKey}/role/${roleId}`);
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
                
                // Assign ticket to randomly selected admin
                await asApp().requestJira(
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
                  }
                );
                console.log(`Assigned ticket ${issueKey} to random project admin`);
              }
            }
          }
        }
      }
    } catch (assignError) {
      console.error('Failed to assign ticket to project admin:', assignError);
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

    // Add comment to Jira using ADF format
    await asApp().requestJira(
      route`/rest/api/3/issue/${issueKey}/comment`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          body: adfBody,
        }),
      }
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
    const timestamp = now.toLocaleString('en-GB', {
      day: '2-digit',
      month: '2-digit',
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
    
    // Add comment to Jira using ADF format
    await asApp().requestJira(
      route`/rest/api/3/issue/${issueKey}/comment`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          body: adfBody,
        }),
      }
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
 * Enhanced with API integration for fetching PEDM approval details
 * See: modules/webhookHandler.js for full implementation
 * 
 * Features:
 * - Fetches detailed approval data from Keeper API
 * - Auto-sync fallback (pedm sync-down) if data doesn't exist
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