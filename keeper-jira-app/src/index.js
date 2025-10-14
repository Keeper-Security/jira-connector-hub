import Resolver from '@forge/resolver';
import { storage, fetch, route, asApp, asUser, requestJira } from '@forge/api';

const resolver = new Resolver();

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
  const baseUrl = apiUrl.endsWith('/') ? apiUrl.slice(0, -1) : apiUrl;
  const fullApiUrl = `${baseUrl}/api/v1/executecommand`;

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
  
  // Get current config
  const config = await storage.get('keeperConfig');
  
  // Return simplified context - works with any project
  return {
    issueKey,
    projectKey,
    hasConfig: !!config
  };
});

/**
 * Build Keeper CLI command from action and parameters
 */
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
        command += ` notes="${parameters.notes}"`;
      }
      
      // Dynamic field processing for any record type
      // Process all parameters except metadata fields
      const metadataFields = ['recordType', 'title', 'notes', 'skipComment'];
      
      // Special handling for login record type (password generation)
      if (recordType === 'login' && !parameters.password) {
        command += ` password=$GEN`; // Generate password if not provided for login records
      }
      
      // Process all fields dynamically with proper JSON formatting for complex field types
      const addProcessedFields = new Set(); // Track processed fields to avoid duplicates
      const jsonFields = {}; // Group fields that need JSON formatting
      
      // Define field types that require JSON formatting as per documentation
      const jsonFieldTypes = {
        'address': ['street1', 'street2', 'city', 'state', 'zip', 'country'],
        'name': ['first', 'middle', 'last'],
        'phone': ['region', 'number', 'ext', 'type'],
        'securityQuestion': ['question', 'answer'],
        'host': ['hostName', 'port'],
        'paymentCard': ['cardNumber', 'cardExpirationDate', 'cardSecurityCode'],
        'bankAccount': ['accountNumber', 'routingNumber', 'accountType', 'otherType']
      };
      
      // Check if we have reference fields that should exclude their corresponding JSON fields
      const hasAddressRef = parameters.addressRef;
      const hasCardRef = parameters.cardRef;
      const hasFileRef = parameters.fileRef;
      
      // Define reference field mappings to their corresponding JSON field types
      const referenceFieldMappings = {
        'addressRef': 'address',
        'cardRef': 'paymentCard',
        'fileRef': 'file'
      };
      
      // First pass: Group fields that need JSON formatting
      Object.keys(parameters).forEach(key => {
        if (metadataFields.includes(key) || !parameters[key]) {
          return; // Skip metadata fields and empty values
        }
        
        const value = parameters[key].toString().trim();
        if (!value) return;
        
        // Skip fields if we have corresponding reference fields
        Object.keys(referenceFieldMappings).forEach(refField => {
          if (parameters[refField]) {
            const jsonFieldType = referenceFieldMappings[refField];
            if (jsonFieldTypes[jsonFieldType] && 
                (key.startsWith(`${jsonFieldType}_`) || jsonFieldTypes[jsonFieldType].includes(key))) {
              return;
            }
          }
        });
        
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
            }
            jsonFields[`phone.${phoneType}`][phoneField] = value;
            addProcessedFields.add(key);
            return;
          }
          
          // Handle securityQuestion pattern (securityQuestion_Mother_question, securityQuestion_Mother_answer)
          if (prefix === 'securityQuestion' && parts.length === 3) {
            const questionType = parts[1]; // Mother, Pet, etc.
            const questionField = parts[2]; // question, answer
            
            if (!jsonFields[`securityQuestion.${questionType}`]) {
              jsonFields[`securityQuestion.${questionType}`] = [];
            }
            
            // Find existing question object or create new one
            let questionObj = jsonFields[`securityQuestion.${questionType}`].find(q => q[questionField]);
            if (!questionObj) {
              questionObj = {};
              jsonFields[`securityQuestion.${questionType}`].push(questionObj);
            }
            questionObj[questionField] = value;
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
          // Handle grouped fields that don't need JSON (like paymentCard_cardNumber)
          else if (key.includes('_')) {
            const [prefix, suffix] = key.split('_', 2);
            command += ` ${suffix}='${value}'`;
          }
          // Single fields (login, password, url, email, etc.)
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
        if (['record', 'title', 'recordType', 'notes', 'appendNotes', 'force'].includes(key)) {
          return;
        }
        
        // Detect field patterns and group them
        if (key.includes('_')) {
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
              // Phone format: phone.Work='$JSON:{"number": "(555) 555-1234", "type": "Work"}'
              Object.keys(fieldData).forEach(phoneType => {
                const phoneValue = fieldData[phoneType];
                if (phoneValue) {
                  const phoneObj = { number: phoneValue, type: phoneType };
                  command += ` phone.${phoneType}='$JSON:${JSON.stringify(phoneObj)}'`;
                }
              });
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
              
            case 'url':
              command += ` url='${value}'`;
              break;
              
            case 'email':
              command += ` email='${value}'`;
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
              // Any other single field as custom text field
              command += ` c.text.${fieldGroup}='${value}'`;
              break;
          }
        }
        
        processedFields.add(fieldGroup);
      });
      
      // Handle remaining custom fields (c. prefix for manually added custom fields)
      Object.keys(parameters).forEach(key => {
        if (key.startsWith('custom_') && parameters[key] && parameters[key].trim() !== '') {
          const customFieldName = key.replace('custom_', '');
          const customValue = parameters[key].toString().trim();
          
          // Skip if already processed by dynamic field processing
          if (processedFields.has(customFieldName) || processedFields.has(key)) {
            return;
          }
          
          // Detect field type and format accordingly
          if (customFieldName.toLowerCase().includes('secret') || customFieldName.toLowerCase().includes('key')) {
            command += ` c.secret.${customFieldName}='${customValue}'`;
          } else if (customFieldName.toLowerCase().includes('date') || customFieldName.toLowerCase().includes('expir')) {
            command += ` c.date.${customFieldName}='${customValue}'`;
          } else if (customValue.includes('\n') || customValue.length > 100) {
            command += ` c.multiline.${customFieldName}='${customValue}'`;
          } else {
            command += ` c.text.${customFieldName}='${customValue}'`;
          }
        }
      });
      
      // Handle security questions format (if any securityQuestion fields)
      const securityQuestions = {};
      Object.keys(parameters).forEach(key => {
        if (key.startsWith('securityQuestion_') && parameters[key] && parameters[key].trim() !== '') {
          const questionType = key.replace('securityQuestion_', '');
          const answerValue = parameters[key].toString().trim();
          
          // Create question based on common types
          let questionText = '';
          switch (questionType.toLowerCase()) {
            case 'mother':
              questionText = "What is your mother's maiden name?";
              break;
            case 'pet':
              questionText = "What was your first pet's name?";
              break;
            case 'school':
              questionText = "What was the name of your first school?";
              break;
            case 'city':
              questionText = "In what city were you born?";
              break;
            default:
              questionText = `What is your ${questionType}?`;
              break;
          }
          
          securityQuestions[questionType] = [{ question: questionText, answer: answerValue }];
        }
      });
      
      // Add security questions to command
      Object.keys(securityQuestions).forEach(questionType => {
        const questionArray = securityQuestions[questionType];
        command += ` securityQuestion.${questionType}='$JSON:${JSON.stringify(questionArray)}'`;
      });
      
      // Force flag to ignore warnings
      if (parameters.force === true) {
        command += ` --force`;
      }
      
      
      break;
      
    case 'record-permissions':
      if (parameters.record) {
        command += ` --record='${parameters.record}'`;
      }
      if (parameters.user) {
        command += ` --user='${parameters.user}'`;
      }
      if (parameters.action) {
        command += ` --action='${parameters.action}'`;
      }
      if (parameters.permissions) {
        command += ` --permissions='${parameters.permissions}'`;
      }
      break;
      
    case 'share-record':
      // Format: share-record "RECORD_UID" -e "EMAIL" -a "ACTION" [-s] [-w] [-R]
      if (parameters.record) {
        command += ` '${parameters.record}'`;
      }
      if (parameters.user) {
        command += ` -e '${parameters.user}'`;
      }
      if (parameters.action) {
        command += ` -a ${parameters.action}`;
      }
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
      break;
      
    case 'share-folder':
      // Format: share-folder "FOLDER_UID" -e "EMAIL" -a "ACTION" [options]
      if (parameters.folder) {
        command += ` '${parameters.folder}'`;
      }
      if (parameters.user) {
        command += ` -e '${parameters.user}'`;
      }
      if (parameters.action) {
        command += ` -a ${parameters.action}`;
      }
      // Add optional permission flags based on parameters
      if (parameters.manage_records === true) {
        command += ` -p`;
      }
      if (parameters.manage_users === true) {
        command += ` -o`;
      }
      if (parameters.can_share === true) {
        command += ` -s`;
      }
      if (parameters.can_edit === true) {
        command += ` -d`;
      }
      break;
      
    case 'pam-action-rotate':
      if (parameters.record) {
        command += ` --record='${parameters.record}'`;
      }
      if (parameters.schedule) {
        command += ` --schedule='${parameters.schedule}'`;
      }
      break;
      
    case 'audit-report':
      if (parameters.report_type) {
        command += ` --report-type='${parameters.report_type}'`;
      }
      if (parameters.report_format) {
        command += ` --report-format='${parameters.report_format}'`;
      }
      if (parameters.max_events) {
          command += ` --max-events='${parameters.max_events}'`;
      }
      break;
      
    case 'compliance-report':
      if (parameters.report_format) {
        command += ` --report-format='${parameters.report_format}'`;
      }
      if (parameters.node) {
        command += ` --node='${parameters.node}'`;
      }
      break;
      
    case 'enterprise-user':
      if (parameters.action) {
        command += ` --action='${parameters.action}'`;
      }
      if (parameters.email) {
        command += ` --email='${parameters.email}'`;
      }
      if (parameters.name) {
        command += ` --name='${parameters.name}'`;
      }
      if (parameters.node) {
        command += ` --node='${parameters.node}'`;
      }
      break;
      
    case 'enterprise-team':
      if (parameters.action) {
        command += ` --action='${parameters.action}'`;
      }
      if (parameters.team) {
        command += ` --team='${parameters.team}'`;
      }
      if (parameters.user) {
        command += ` --user='${parameters.user}'`;
      }
      if (parameters.node) {
        command += ` --node='${parameters.node}'`;
      }
      break;
      
    case 'enterprise-role':
      if (parameters.action) {
          command += ` --action='${parameters.action}'`;
      }
      if (parameters.role) {
        command += ` --role='${parameters.role}'`;
      }
      if (parameters.node) {
        command += ` --node='${parameters.node}'`;
      }
      if (parameters.permissions) {
        command += ` --permissions='${parameters.permissions}'`;
      }
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
  const baseUrl = apiUrl.endsWith('/') ? apiUrl.slice(0, -1) : apiUrl;
  const fullApiUrl = `${baseUrl}/api/v1/executecommand`;

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
      throw new Error(`Keeper API error: ${response.status} - ${errorText}`);
    }

    const data = await response.json();

    if (data.status !== "success" || data.error) {
      throw new Error(`Keeper API error: ${data.error || data.message || 'Unknown error'}`);
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
  const baseUrl = apiUrl.endsWith('/') ? apiUrl.slice(0, -1) : apiUrl;
  const fullApiUrl = `${baseUrl}/api/v1/executecommand`;

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
      throw new Error(`Keeper API error: ${response.status} - ${errorText}`);
    }

    const data = await response.json();

    if (data.success === false || data.error) {
      throw new Error(`Keeper API error: ${data.error || data.message || 'Unknown error'}`);
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
          
          return {
            number: index + 1,
            folder_uid: folder.folder_uid, // Use folder_uid to match CLI response format
            uid: folder.folder_uid, // Keep uid for backward compatibility
            name: cleanName,
            title: cleanName, // Add title alias
            path: cleanName,
            flags: folder.flags,
            parent_uid: folder.parent_uid,
            shared: folder.flags && folder.flags.includes('S'), // Mark as shared if flags contains "S"
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
 * Get record types list from Keeper API (called from issue panel)
 */
resolver.define('getRecordTypes', async (req) => {
  const config = await storage.get('keeperConfig');
  if (!config) {
    throw new Error('Keeper configuration not found. Please configure the app first.');
  }

  const { apiUrl, apiKey } = config;
  
  // Construct the full API endpoint
  const baseUrl = apiUrl.endsWith('/') ? apiUrl.slice(0, -1) : apiUrl;
  const fullApiUrl = `${baseUrl}/api/v1/executecommand`;

  try {
    const response = await fetch(fullApiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'api-key': apiKey,
      },
      body: JSON.stringify({
        command: 'record-type-info --format=json',
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Keeper API error: ${response.status} - ${errorText}`);
    }

    const data = await response.json();

    if (data.success === false || data.error) {
      throw new Error(`Keeper API error: ${data.error || data.message || 'Unknown error'}`);
    }

    // Handle the response data - it might be already parsed or a JSON string
    let recordTypes = [];
    if (data.data) {
      try {
        // First check if data.data is already an array/object (already parsed)
        if (Array.isArray(data.data)) {
          recordTypes = data.data;
        } else if (typeof data.data === 'object') {
          recordTypes = data.data;
        } else {
          // If it's a string, try to parse it as JSON
          recordTypes = JSON.parse(data.data);
        }
      } catch (parseError) {
        throw new Error('Failed to process record types data');
      }
    }

    return { success: true, data: recordTypes || [] };
  } catch (err) {
    throw err;
  }
});

/**
 * Get record type template from Keeper API (called from issue panel when record type is changed)
 */
resolver.define('getRecordTypeTemplate', async (req) => {
  const { recordType } = req.payload || {};
  
  if (!recordType) {
    throw new Error('Record type is required to fetch template');
  }

  const config = await storage.get('keeperConfig');
  if (!config) {
    throw new Error('Keeper configuration not found. Please configure the app first.');
  }

  const { apiUrl, apiKey } = config;
  
  // Construct the full API endpoint
  const baseUrl = apiUrl.endsWith('/') ? apiUrl.slice(0, -1) : apiUrl;
  const fullApiUrl = `${baseUrl}/api/v1/executecommand`;

  try {
    const response = await fetch(fullApiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'api-key': apiKey,
      },
      body: JSON.stringify({
        command: `record-type-info -lr='${recordType}' -e --format=json`,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Keeper API error: ${response.status} - ${errorText}`);
    }

    const data = await response.json();

    if (data.success === false || data.error) {
      throw new Error(`Keeper API error: ${data.error || data.message || 'Unknown error'}`);
    }

    // Handle the response data - it might be already parsed or a JSON string
    let template = {};
    if (data.data) {
      try {
        // First check if data.data is already an object (already parsed)
        if (typeof data.data === 'object') {
          template = data.data;
        } else {
          // If it's a string, try to parse it as JSON
          template = JSON.parse(data.data);
        }
      } catch (parseError) {
        throw new Error('Failed to process record type template data');
      }
    }

    return { success: true, template: template || {} };
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
  const baseUrl = apiUrl.endsWith('/') ? apiUrl.slice(0, -1) : apiUrl;
  const fullApiUrl = `${baseUrl}/api/v1/executecommand`;

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
      throw new Error(`Keeper API error: ${response.status} - ${errorText}`);
    }

    const data = await response.json();

    if (data.success === false || data.error) {
      throw new Error(`Keeper API error: ${data.error || data.message || 'Unknown error'}`);
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
 * Manual Keeper action trigger (called from issue panel)
 */
resolver.define('executeKeeperAction', async (req) => {
  const { issueKey, command, commandDescription, parameters } = req.payload;
  
  if (!issueKey) {
    throw new Error('Issue key is required');
  }
  
  if (!command) {
    throw new Error('Command is required');
  }
  
  const config = await storage.get('keeperConfig');
  if (!config) {
    throw new Error('Keeper configuration not found. Please configure the app first.');
  }

  const { apiUrl, apiKey } = config;
  
  // Build dynamic command based on action and parameters
  const dynamicCommand = buildKeeperCommand(command, parameters || {}, issueKey);
  
  // Construct the full API endpoint
  const baseUrl = apiUrl.endsWith('/') ? apiUrl.slice(0, -1) : apiUrl;
  const fullApiUrl = `${baseUrl}/api/v1/executecommand`;

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
      throw new Error(`Keeper API error: ${response.status} - ${errorText}`);
    }

    const data = await response.json();

    // Check if API response indicates error
    if (data.success === false || data.error) {
      throw new Error(`Keeper API error: ${data.error || data.message || 'Unknown error'}`);
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

    // Only add comment for main record creation, not for records created as references
    // Check if this is a main record creation (not just a reference record)
    // Records created as references will have skipComment: true parameter
    const isMainRecordCreation = !parameters.skipComment;
    
    if (isMainRecordCreation) {
      // Create simplified comment with command-specific messages and record_uid
      let commentText = '';
      let recordUid = '';
      
      // Check for record_uid in different possible locations in the response
      recordUid = data.record_uid || 
                 (data.data && data.data.record_uid) || 
                 (data.data && data.data.data && data.data.data.record_uid);
      
      // Set command-specific messages
      switch (command) {
        case 'record-add':
          commentText = 'Record created successfully.';
          if (recordUid) {
            commentText += `\n\nRecord UID: ${recordUid}`;
          }
          break;
        case 'record-update':
          commentText = 'Record updated successfully.';
          break;
        case 'share-record':
        case 'share-folder':
          commentText = 'Record UID shared successfully.';
          break;
        default:
          commentText = data.message || 'Keeper action executed successfully.';
          if (recordUid) {
            commentText += `\n\nRecord UID: ${recordUid}`;
          }
      }
      
      const adfBody = {
        version: 1,
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [
              {
                type: "text",
                text: commentText,
                marks: [{ type: "strong" }]
              }
            ]
          }
        ]
      };

      // Add comment back to Jira using ADF format
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
  const { issueKey, rejectionReason } = req.payload;
  
  if (!issueKey) {
    throw new Error('Issue key is required');
  }
  
  if (!rejectionReason || !rejectionReason.trim()) {
    throw new Error('Rejection reason is required');
  }

  try {

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
                  marks: [
                    {
                      type: 'strong'
                    }
                  ]
                }
              ]
            },
            {
              type: 'paragraph',
              content: [
                {
                  type: 'text',
                  text: 'Reason: '
                },
                {
                  type: 'text',
                  text: rejectionReason.trim()
                }
              ]
            },
            {
              type: 'paragraph',
              content: [
                {
                  type: 'text',
                  text: `Rejected at: ${new Date().toLocaleString()}`,
                  marks: [
                    {
                      type: 'em'
                    }
                  ]
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
      const response = await asUser().requestJira(route`/rest/api/3/myself`);
      
      if (response && response.ok) {
        const userData = await response.json();
        
        if (userData && Object.keys(userData).length > 0) {
          userApiResponse = userData;
        }
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
 * Get global user admin status - check if current user has admin permissions across Jira
 */
resolver.define('getGlobalUserRole', async (req) => {
  try {
    let userApiResponse = null;
    let permissionsApiResponse = null;
    
    // Get current user info
    try {
      const response = await asUser().requestJira(route`/rest/api/3/myself`);
      
      if (response && response.ok) {
        const userData = await response.json();
        
        if (userData && Object.keys(userData).length > 0) {
          userApiResponse = userData;
        }
      }
    } catch (userErr) {
      // User API call failed - continue with permissions check
    }
    
    // Get global permissions data (without project key)
    try {
      const permResponse = await asUser().requestJira(route`/rest/api/3/mypermissions?permissions=ADMINISTER_PROJECTS`);
      
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
      
      const hasAdminPermission = permissionsApiResponse?.permissions?.ADMINISTER_PROJECTS?.havePermission === true;
      
      return {
        success: true,
        isAdmin: hasAdminPermission,
        adminCheckMethod: 'global_permissions',
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
 * Store request data for admin approval
 */
resolver.define('storeRequestData', async (req) => {
  const { issueKey, requestData } = req.payload;
  
  if (!issueKey) {
    throw new Error('Issue key is required');
  }
  
  if (!requestData) {
    throw new Error('Request data is required');
  }
  
  try {
    // Get current user info
    const currentUser = await asUser().requestJira(route`/rest/api/3/myself`);
    
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


// Export resolver for frontend calls (getConfig, setConfig, testConnection, getIssueContext, executeKeeperAction, getKeeperRecords, getKeeperFolders, getRecordTypes, getRecordTypeTemplate, getKeeperRecordDetails, rejectKeeperRequest, getUserRole, getGlobalUserRole, storeRequestData, getStoredRequestData, activateKeeperPanel, clearStoredRequestData)
export const handler = resolver.getDefinitions();

// Export same resolver for issue panel - they can share the same functions
export const issuePanelHandler = resolver.getDefinitions();