import React, { useState, useEffect, useRef } from "react";
import { invoke } from "@forge/bridge";

import Button from "@atlaskit/button";
import SectionMessage from "@atlaskit/section-message";
import Spinner from "@atlaskit/spinner";
import Badge from "@atlaskit/badge";
import Select from "@atlaskit/select";

// Icons
import SuccessIcon from "@atlaskit/icon/glyph/check-circle";
import ErrorIcon from "@atlaskit/icon/glyph/error";
import InfoIcon from "@atlaskit/icon/glyph/info";
import LockIcon from "@atlaskit/icon/glyph/lock";
import CrossIcon from "@atlaskit/icon/glyph/cross";

// Keeper action options with required fields based on CLI documentation
const keeperActionOptions = [
  { 
    value: 'record-add', 
    label: 'Create New Secret', 
    description: 'Create new secret after approval.',
    fields: [
      { name: 'recordType', label: 'Record Type', type: 'select', required: true, options: [], placeholder: 'Select record type' }
    ]
  },
  { 
    value: 'record-update', 
    label: 'Update Record',
    description: 'Update existing record fields. Only fill in the fields you want to change.',
    fields: [
      { name: 'record', label: 'Record ID/Title', type: 'text', required: true, placeholder: 'Record ID or title to update' },
      { name: 'title', label: 'Title', type: 'text', required: false, placeholder: 'Title' },
      { name: 'recordType', label: 'Record Type', type: 'select', required: false, options: [], placeholder: 'Record Type' },
      { name: 'login', label: 'Login', type: 'text', required: false, placeholder: 'Username' },
      { name: 'password', label: 'Password', type: 'text', required: false, placeholder: 'Password' },
      { name: 'url', label: 'URL', type: 'url', required: false, placeholder: 'URL' },
      { name: 'email', label: 'Email', type: 'email', required: false, placeholder: 'Email' },
      { name: 'notes', label: 'Notes', type: 'textarea', required: false, placeholder: 'Notes' },
      { name: 'force', label: 'Force Update', type: 'checkbox', required: false, description: 'Ignore warnings and force the update' }
    ]
  },
  { 
    value: 'record-permission', 
    label: 'Record Permission', 
    description: 'Grant or revoke record permissions for all users in shared folder.',
    requiresSharedFolderSelection: true,
    fields: [
      { name: 'sharedFolder', label: 'Shared Folder', type: 'folder-select', required: true, placeholder: 'Select shared folder' },
      { name: 'action', label: 'Action', type: 'select', required: true, options: ['grant', 'revoke'], placeholder: 'Select action' },
      { name: 'can_share', label: 'Can Share Records', type: 'checkbox', required: false, description: 'Allow sharing records' },
      { name: 'can_edit', label: 'Can Edit Records', type: 'checkbox', required: false, description: 'Allow modifying records in the folder' },
      { name: 'recursive', label: 'Apply Recursively', type: 'checkbox', required: false, description: 'Apply permission changes to all sub folders' },
      { name: 'dry_run', label: 'Dry Run', type: 'checkbox', required: false, description: 'Display permission changes without actually changing them' }
    ]
  },
  { 
    value: 'share-record', 
    label: 'Share Record', 
    description: 'Grant or revoke user access to record(s).',
    fields: [
      { name: 'record', label: 'Record UID/Path', type: 'text', required: true, placeholder: 'Record UID, path, or folder path' },
      { name: 'user', label: 'Email', type: 'email', required: true, placeholder: 'Email of account to edit permissions for' },
      { name: 'action', label: 'Action', type: 'select', required: true, options: ['grant', 'revoke', 'owner', 'cancel'], placeholder: 'Select action' },
      { name: 'can_share', label: 'Allow Sharing', type: 'checkbox', required: false, description: 'Allow user to share record' },
      { name: 'can_write', label: 'Allow Writing', type: 'checkbox', required: false, description: 'Allow user to modify record' },
      { name: 'recursive', label: 'Apply Recursively', type: 'checkbox', required: false, description: 'Apply to shared folder hierarchy' }
    ]
  },
  { 
    value: 'share-folder', 
    label: 'Share Folder', 
    description: 'Grant or remove user/team access to folder with specific permissions.',
    fields: [
      { name: 'folder', label: 'Folder UID', type: 'text', required: true, placeholder: 'Folder UID to share' },
      { name: 'user', label: 'Email/Team', type: 'text', required: true, placeholder: 'Email, team name, or * for all' },
      { name: 'action', label: 'Action', type: 'select', required: true, options: ['grant', 'remove'], placeholder: 'Select action' },
      { name: 'manage_records', label: 'Can Manage Records', type: 'checkbox', required: false, description: 'Allow user to manage records in folder' },
      { name: 'manage_users', label: 'Can Manage Users', type: 'checkbox', required: false, description: 'Allow user to manage other users access' },
      { name: 'can_share', label: 'Can Share Records', type: 'checkbox', required: false, description: 'Allow user to share records (records only)' },
      { name: 'can_edit', label: 'Can Edit Records', type: 'checkbox', required: false, description: 'Allow user to modify records (records only)' }
    ]
  },
  { 
    value: 'pam-action-rotate', 
    label: 'PAM Action Rotate', 
    description: 'Rotate passwords for PAM resources based on record UID or folder.',
    requiresFolderOrRecordSelection: true,
    fields: [
      { name: 'target_type', label: 'Target Type', type: 'select', required: true, options: ['record', 'folder'], placeholder: 'Select target type' },
      { name: 'recordUid', label: 'Record UID', type: 'record-select', required: false, placeholder: 'Select PAM record' },
      { name: 'folder', label: 'Folder', type: 'folder-select', required: false, placeholder: 'Select folder' },
      { name: 'dry_run', label: 'Dry Run', type: 'checkbox', required: false, description: 'Enable dry-run mode to test without actually rotating' }
    ]
  },
  { 
    value: 'audit-report', 
    label: 'Audit Report', 
    description: 'Generate audit logs for tracking Keeper activity.',
    fields: [
      { name: 'report_type', label: 'Report Type', type: 'select', required: true, options: ['raw', 'dim', 'hour', 'day', 'week', 'month'], placeholder: 'Select report type' },
      { name: 'report_format', label: 'Format', type: 'select', required: true, options: ['table', 'csv', 'json'], placeholder: 'Output format' },
      { name: 'max_events', label: 'Max Events', type: 'number', required: false, placeholder: 'Maximum number of events (default: 1000)' }
    ]
  },
  { 
    value: 'compliance-report', 
    label: 'Compliance Report', 
    description: 'Provide compliance-related reporting for audits.',
    fields: [
      { name: 'report_format', label: 'Format', type: 'select', required: true, options: ['table', 'csv', 'json'], placeholder: 'Output format' },
      { name: 'node', label: 'Node', type: 'text', required: false, placeholder: 'Specific node (optional)' }
    ]
  },
  { 
    value: 'enterprise-user', 
    label: 'Enterprise User', 
    description: 'Manage enterprise users (add, update, delete).',
    fields: [
      { name: 'action', label: 'Action', type: 'select', required: true, options: ['add', 'update', 'delete'], placeholder: 'Select action' },
      { name: 'email', label: 'User Email', type: 'email', required: true, placeholder: 'User email address' },
      { name: 'name', label: 'Display Name', type: 'text', required: false, placeholder: 'User display name' },
      { name: 'node', label: 'Node', type: 'text', required: false, placeholder: 'Organization node' }
    ]
  },
  { 
    value: 'enterprise-team', 
    label: 'Enterprise Team', 
    description: 'Manage teams (add, delete, add/remove users).',
    fields: [
      { name: 'action', label: 'Action', type: 'select', required: true, options: ['add', 'delete', 'add-user', 'remove-user'], placeholder: 'Select action' },
      { name: 'team', label: 'Team Name', type: 'text', required: true, placeholder: 'Team name' },
      { name: 'user', label: 'User Email', type: 'email', required: false, placeholder: 'User email (for add/remove user actions)' },
      { name: 'node', label: 'Node', type: 'text', required: false, placeholder: 'Organization node' }
    ]
  },
  { 
    value: 'enterprise-role', 
    label: 'Enterprise Role', 
    description: 'Manage roles (add, delete, update permissions).',
    fields: [
      { name: 'action', label: 'Action', type: 'select', required: true, options: ['add', 'delete', 'update'], placeholder: 'Select action' },
      { name: 'role', label: 'Role Name', type: 'text', required: true, placeholder: 'Role name' },
      { name: 'node', label: 'Node', type: 'text', required: false, placeholder: 'Organization node' },
      { name: 'permissions', label: 'Permissions', type: 'text', required: false, placeholder: 'Role permissions (comma-separated)' }
    ]
  }
];

const IssuePanel = () => {
  const [issueContext, setIssueContext] = useState(null);
  const [isExecuting, setIsExecuting] = useState(false);
  const [lastResult, setLastResult] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [selectedAction, setSelectedAction] = useState(null);
  
  useEffect(() => {
    // Trigger any necessary actions when selectedAction changes
    if (selectedAction?.value === 'record-permission') {
      // Fetch shared folders for record-permission command
      fetchKeeperFolders();
    }
    if (selectedAction?.value === 'pam-action-rotate') {
      // Fetch PAM resources for pam-action-rotate command
      fetchPamResources();
      fetchKeeperFolders(); // Still need folders for folder-based rotation
    }
    if (selectedAction?.value === 'record-update') {
      // Fetch records for the update record dropdown
      fetchKeeperRecords();
    }
  }, [selectedAction]);
  const [searchTerm, setSearchTerm] = useState("");
  const [showDropdown, setShowDropdown] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const [formData, setFormData] = useState({});
  const [isFormDisabled, setIsFormDisabled] = useState(false);
  const [keeperRecords, setKeeperRecords] = useState([]);
  const [loadingRecords, setLoadingRecords] = useState(false);
  const [selectedRecord, setSelectedRecord] = useState(null);
  const [recordSearchTerm, setRecordSearchTerm] = useState("");
  const [showRecordDropdown, setShowRecordDropdown] = useState(false);
  const [recordCurrentPage, setRecordCurrentPage] = useState(1);
  const [keeperFolders, setKeeperFolders] = useState([]);
  const [loadingFolders, setLoadingFolders] = useState(false);
  
  // PAM-specific resources
  const [pamResources, setPamResources] = useState([]);
  const [loadingPamResources, setLoadingPamResources] = useState(false);
  const [selectedPamResource, setSelectedPamResource] = useState(null);
  const [pamResourceSearchTerm, setPamResourceSearchTerm] = useState("");
  const [showPamResourceDropdown, setShowPamResourceDropdown] = useState(false);
  const [pamResourceCurrentPage, setPamResourceCurrentPage] = useState(1);
  
  // Rejection functionality
  const [isRejecting, setIsRejecting] = useState(false);
  const [rejectionReason, setRejectionReason] = useState("");
  const [showRejectionForm, setShowRejectionForm] = useState(false);
  const [rejectionResult, setRejectionResult] = useState(null);
  const [selectedFolder, setSelectedFolder] = useState(null);
  
  // Save request message state
  const [saveRequestMessage, setSaveRequestMessage] = useState(null); // { type: 'success' | 'error', message: 'text', timestamp: 'ISO string', showTimestamp: boolean }
  const [showStoredRequestMessage, setShowStoredRequestMessage] = useState(true); // Control visibility of stored request dialog
  const [showWorkflowInfo, setShowWorkflowInfo] = useState(true); // Control visibility of workflow info dialog
  const [folderSearchTerm, setFolderSearchTerm] = useState("");
  const [showFolderDropdown, setShowFolderDropdown] = useState(false);
  const [folderCurrentPage, setFolderCurrentPage] = useState(1);
  
  // Record-update specific states
  const [selectedRecordForUpdate, setSelectedRecordForUpdate] = useState(null);
  
  useEffect(() => {
    // Handle selectedRecordForUpdate changes
  }, [selectedRecordForUpdate]);
  const [recordForUpdateSearchTerm, setRecordForUpdateSearchTerm] = useState("");
  const [showRecordForUpdateDropdown, setShowRecordForUpdateDropdown] = useState(false);
  const [recordForUpdateCurrentPage, setRecordForUpdateCurrentPage] = useState(1);
  const [recordDetails, setRecordDetails] = useState({});
  const [loadingRecordDetails, setLoadingRecordDetails] = useState(false);
  const [resolvedAddresses, setResolvedAddresses] = useState({}); // Cache for resolved address references
  const [loadingAddresses, setLoadingAddresses] = useState(new Set()); // Track loading address references
  const [showPinCode, setShowPinCode] = useState(false); // Toggle for PIN code visibility
  const [showAddressDropdown, setShowAddressDropdown] = useState(false); // Address dropdown visibility
  const [showNewAddressModal, setShowNewAddressModal] = useState(false); // New address modal visibility
  const [newAddressFormData, setNewAddressFormData] = useState({}); // Form data for new address
  const [addressTemplate, setAddressTemplate] = useState({});
  const [addressRecords, setAddressRecords] = useState([]); // Existing address records
  const [loadingAddressRecords, setLoadingAddressRecords] = useState(false); // Loading state for address records // Template for address record type
  const [loadingAddressTemplate, setLoadingAddressTemplate] = useState(false); // Loading state for address template
  const [dynamicCustomFields, setDynamicCustomFields] = useState([]);
  const [manualCustomFields, setManualCustomFields] = useState([]);
  const [recordTypes, setRecordTypes] = useState([]);
  const [loadingRecordTypes, setLoadingRecordTypes] = useState(false);
  const [recordTypeTemplate, setRecordTypeTemplate] = useState({});
  const [loadingTemplate, setLoadingTemplate] = useState(false);
  const [templateFields, setTemplateFields] = useState([]);
  const [originalRecordType, setOriginalRecordType] = useState(null); // Track original record type
  const [originalFormData, setOriginalFormData] = useState({}); // Store original form data
  
  // New workflow states
  const [isAdmin, setIsAdmin] = useState(false); // Track if current user is admin
  const [storedRequestData, setStoredRequestData] = useState(null); // Store user's saved request
  const [hasStoredData, setHasStoredData] = useState(false); // Track if data has been stored
  const [isUpdating, setIsUpdating] = useState(false); // Track update operation
  
  
  const itemsPerPage = 5;
  const recordsPerPage = 3;
  const foldersPerPage = 3;

  // Centralized error handler for API calls
  const handleApiError = (error, defaultMessage = "An error occurred") => {
    // Try to extract error message from various possible locations in the error object
    let errorMessage = error.error || error.message || (typeof error === 'string' ? error : defaultMessage);
    
    // If we have an error message from the response, use it directly
    if (errorMessage && errorMessage !== defaultMessage) {
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
                        errorStatus === 504 ? 'Gateway Timeout (504)' :
                        `Error (${errorStatus})`;
      
      if (isAdmin) {
        return `${statusText}: Please check your URL and ngrok configuration. Ensure the ngrok tunnel is active and the URL is correctly configured in the app settings.`;
      } else {
        return `${statusText}: Unable to connect to the server. Please ask your administrator to check the ngrok configuration and ensure the service is running properly.`;
      }
    }
    
    return errorMessage;
  };

  // Get keeper action options with dynamic record types
  const getKeeperActionOptions = () => {
    const dynamicRecordTypeOptions = recordTypes;

    return keeperActionOptions.map(action => {
      if (action.value === 'record-update' || action.value === 'record-add') {
        return {
          ...action,
          fields: action.fields.map(field => {
            if (field.name === 'recordType') {
              return {
                ...field,
                options: dynamicRecordTypeOptions
              };
            }
            return field;
          })
        };
      }
      return action;
    });
  };

  // Filter and paginate options
  const filteredOptions = getKeeperActionOptions().filter(option =>
    option.label.toLowerCase().includes(searchTerm.toLowerCase()) ||
    option.description.toLowerCase().includes(searchTerm.toLowerCase()) ||
    option.value.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const totalPages = Math.ceil(filteredOptions.length / itemsPerPage);
  const startIndex = (currentPage - 1) * itemsPerPage;
  const paginatedOptions = filteredOptions.slice(startIndex, startIndex + itemsPerPage);

  // Filter and paginate records
  const filteredRecords = keeperRecords.filter(record =>
    record.title?.toLowerCase().includes(recordSearchTerm.toLowerCase())
  );
  const totalRecordPages = Math.ceil(filteredRecords.length / recordsPerPage);
  const recordStartIndex = (recordCurrentPage - 1) * recordsPerPage;
  const paginatedRecords = filteredRecords.slice(recordStartIndex, recordStartIndex + recordsPerPage);

  // Filter and paginate PAM resources
  const filteredPamResources = pamResources.filter(resource =>
    (resource.title || resource.record_uid)?.toLowerCase().includes(pamResourceSearchTerm.toLowerCase()) ||
    (resource.record_type || resource.type || '')?.toLowerCase().includes(pamResourceSearchTerm.toLowerCase())
  );
  const totalPamResourcePages = Math.ceil(filteredPamResources.length / recordsPerPage);
  const pamResourceStartIndex = (pamResourceCurrentPage - 1) * recordsPerPage;
  const paginatedPamResources = filteredPamResources.slice(pamResourceStartIndex, pamResourceStartIndex + recordsPerPage);

  // Filter and paginate folders
  const getFilteredFolders = () => {
    let foldersToFilter = keeperFolders;
    
    // For record-permission, only show shared folders (flags contains "S")
    if (selectedAction?.value === 'record-permission') {
      foldersToFilter = keeperFolders.filter(folder => folder.shared || (folder.flags && folder.flags.includes('S')));
    }
    
    // For pam-action-rotate, show all folders (no filtering)
    if (selectedAction?.value === 'pam-action-rotate') {
      foldersToFilter = keeperFolders;
    }
    
    // Apply search filter
    return foldersToFilter.filter(folder =>
      (folder.name || folder.title)?.toLowerCase().includes(folderSearchTerm.toLowerCase())
    );
  };
  
  const filteredFolders = getFilteredFolders();
  const totalFolderPages = Math.ceil(filteredFolders.length / foldersPerPage);
  const folderStartIndex = (folderCurrentPage - 1) * foldersPerPage;
  const paginatedFolders = filteredFolders.slice(folderStartIndex, folderStartIndex + foldersPerPage);

  // Filter and paginate records for record-update
  const filteredRecordsForUpdate = keeperRecords.filter(record =>
    record.title?.toLowerCase().includes(recordForUpdateSearchTerm.toLowerCase())
  );
  const totalRecordForUpdatePages = Math.ceil(filteredRecordsForUpdate.length / recordsPerPage);
  const recordForUpdateStartIndex = (recordForUpdateCurrentPage - 1) * recordsPerPage;
  const paginatedRecordsForUpdate = filteredRecordsForUpdate.slice(recordForUpdateStartIndex, recordForUpdateStartIndex + recordsPerPage);

  // Reset pagination when search changes
  useEffect(() => {
    setCurrentPage(1);
  }, [searchTerm]);

  // Reset record pagination when record search changes
  useEffect(() => {
    setRecordCurrentPage(1);
  }, [recordSearchTerm]);

  // Reset folder pagination when folder search changes
  useEffect(() => {
    setFolderCurrentPage(1);
  }, [folderSearchTerm]);

  // Reset record-update pagination when record-update search changes
  useEffect(() => {
    setRecordForUpdateCurrentPage(1);
  }, [recordForUpdateSearchTerm]);

  // Reset PAM resource pagination when PAM resource search changes
  useEffect(() => {
    setPamResourceCurrentPage(1);
  }, [pamResourceSearchTerm]);

  // Fetch Keeper records when needed
  const fetchKeeperRecords = async () => {
    setLoadingRecords(true);
    try {
      const result = await invoke("getKeeperRecords");
      setKeeperRecords(result.records || []);
    } catch (error) {
      // Handle error
      const errorMessage = handleApiError(error, "Failed to fetch Keeper records");
      
      setLastResult({ 
        success: false, 
        message: errorMessage
      });
      
      setKeeperRecords([]);
    } finally {
      setLoadingRecords(false);
    }
  };

  // Fetch Keeper folders when needed
  const fetchKeeperFolders = async () => {
    setLoadingFolders(true);
    try {
      const result = await invoke("getKeeperFolders");
      setKeeperFolders(result.folders || []);
    } catch (error) {
      // Handle error
      const errorMessage = handleApiError(error, "Failed to fetch Keeper folders");
      
      setLastResult({ 
        success: false, 
        message: errorMessage
      });
      
      setKeeperFolders([]);
    } finally {
      setLoadingFolders(false);
    }
  };

  // Fetch PAM resources by filtering Keeper records for PAM types
  const fetchPamResources = async () => {
    setLoadingPamResources(true);
    try {
      const result = await invoke("getKeeperRecords");
      
      // Filter for PAM-specific record types
      const pamRecordTypes = ['pamMachine', 'pamUser', 'pamDatabase', 'pamDirectory', 'pamRemoteBrowser'];
      const pamResources = (result.records || []).filter(record => {
        const recordType = record.record_type || record.type || '';
        return pamRecordTypes.includes(recordType);
      });
      
      setPamResources(pamResources);
    } catch (error) {
      // Handle error
      const errorMessage = handleApiError(error, "Failed to fetch PAM resources");
      
      setLastResult({ 
        success: false, 
        message: errorMessage
      });
      
      setPamResources([]);
    } finally {
      setLoadingPamResources(false);
    }
  };

  // Flag to track if we're preserving stored data
  const [isPreservingStoredData, setIsPreservingStoredData] = useState(false);
  const isPreservingStoredDataRef = useRef(false);
  
  // Fetch Keeper record details when needed for record-update
  const fetchKeeperRecordDetails = async (recordUid, preserveStoredData = null) => {
    setLoadingRecordDetails(true);
    try {
      const result = await invoke("getKeeperRecordDetails", { recordUid });
      
      // The API returns { success: true, recordDetails: {...} }
      // The recordDetails contains the actual record data
      const details = result.recordDetails || {};
      
      setRecordDetails(details);
      
      // Store original record type for later comparison
      if (details.type) {
        setOriginalRecordType(details.type);
      }
      
      // Auto-populate form fields with existing values
      if (details && Object.keys(details).length > 0) {
        
        // Set existing values in form data for display  
        const existingValues = {};
        
        // Standard top-level fields
        existingValues.record = details.record_uid || recordUid; // Ensure record UID is set
        existingValues.title = details.title || '';
        existingValues.recordType = details.type || '';
        
        // Parse the fields array to extract standard field values
        if (details.fields && Array.isArray(details.fields)) {
          details.fields.forEach(field => {
            if (field.type === 'login' && field.value && field.value.length > 0) {
              existingValues.login = field.value[0] || '';
            }
            else if (field.type === 'password' && field.value && field.value.length > 0) {
              existingValues.password = field.value[0] ? '••••••••' : ''; // Show masked password if exists
            }
            else if (field.type === 'url' && field.value && field.value.length > 0) {
              existingValues.url = field.value[0] || '';
            }
            else if (field.type === 'email' && field.value && field.value.length > 0) {
              existingValues.email = field.value[0] || '';
            }
            else if (field.type === 'notes' && field.value && field.value.length > 0) {
              existingValues.notes = field.value[0] || '';
            }
            else if (field.type === 'name' && field.value && field.value.length > 0) {
              // Handle name field structure - combine first, middle, last
              const nameObj = field.value[0];
              if (nameObj && typeof nameObj === 'object') {
                const nameParts = [];
                if (nameObj.first) nameParts.push(nameObj.first);
                if (nameObj.middle) nameParts.push(nameObj.middle);
                if (nameObj.last) nameParts.push(nameObj.last);
                if (nameParts.length > 0) {
                  existingValues.name = nameParts.join(' ');
                }
              }
            }
            // Handle other complex field types as custom fields
            else if (field.type === 'bankAccount' && field.value && field.value.length > 0) {
              const bankData = field.value[0];
              if (bankData && typeof bankData === 'object') {
                if (bankData.accountNumber) existingValues.custom_accountNumber = bankData.accountNumber;
                if (bankData.routingNumber) existingValues.custom_routingNumber = bankData.routingNumber;
                if (bankData.accountType) existingValues.custom_accountType = bankData.accountType;
              }
            }
          });
        }
        
        // Ensure all standard fields have at least empty string values
        if (!existingValues.login) existingValues.login = '';
        if (!existingValues.password) existingValues.password = '';
        if (!existingValues.url) existingValues.url = '';
        if (!existingValues.email) existingValues.email = '';
        if (!existingValues.notes) existingValues.notes = '';
        
        // Create dynamic custom fields based on actual record data from fields array
        const customFields = [];
        const standardFieldTypes = ['title', 'login', 'password', 'url', 'email', 'notes', 'name', 'cardRef', 'fileRef', 'oneTimeCode'];
        
        if (details.fields && Array.isArray(details.fields)) {
          details.fields.forEach(field => {
            // Skip standard field types and empty fields
            if (!standardFieldTypes.includes(field.type) && field.value && field.value.length > 0) {
              // Handle complex field types (like bankAccount) as custom fields
              if (field.type === 'bankAccount' && field.value[0] && typeof field.value[0] === 'object') {
                const bankData = field.value[0];
                
                // Create separate custom fields for each bank account property
                if (bankData.accountNumber) {
                  customFields.push({
                    name: 'custom_accountNumber',
                    displayName: 'Account Number',
                    value: bankData.accountNumber,
                    label: 'Account Number',
                    type: 'text',
                    placeholder: `Current: ${bankData.accountNumber}`
                  });
                }
                
                if (bankData.routingNumber) {
                  customFields.push({
                    name: 'custom_routingNumber',
                    displayName: 'Routing Number',
                    value: bankData.routingNumber,
                    label: 'Routing Number',
                    type: 'text',
                    placeholder: `Current: ${bankData.routingNumber}`
                  });
                }
                
                if (bankData.accountType) {
                  customFields.push({
                    name: 'custom_accountType',
                    displayName: 'Account Type',
                    value: bankData.accountType,
                    label: 'Account Type',
                    type: 'text',
                    placeholder: `Current: ${bankData.accountType}`
                  });
                }
              }
              // Handle other field types as simple custom fields
              else if (typeof field.value[0] === 'string') {
                customFields.push({
                  name: field.type,
                  displayName: field.type,
                  value: field.value[0],
                  label: `${field.type.charAt(0).toUpperCase() + field.type.slice(1)}`,
                  type: 'text',
                  placeholder: field.type
                });
                
                // Add to form data
                existingValues[field.type] = field.value[0] || '';
              }
            }
          });
        }
        
        // Also check for any other custom fields in the response
        if (details.custom && Array.isArray(details.custom)) {
          details.custom.forEach(customField => {
            if (customField.name && customField.value) {
              customFields.push({
                name: `custom_${customField.name}`,
                displayName: customField.name,
                value: customField.value,
                label: `${customField.name.charAt(0).toUpperCase() + customField.name.slice(1)}`,
                type: 'text',
                placeholder: customField.name
              });
              
              existingValues[`custom_${customField.name}`] = customField.value || '';
            }
          });
        }
        
        // For record-update, don't populate custom fields with existing values
        // User should see empty fields and fill only what they want to change
        // Store custom field definitions for reference but don't set their values
        const blankCustomFields = customFields.map(field => ({
          ...field,
          value: '', // Keep field definition but clear the value
          placeholder: `Enter new ${field.displayName.toLowerCase()} (leave blank to keep current)`
        }));
        
        // Only set initial custom fields if template processing isn't happening yet
        if (!loadingTemplate && !loadingRecordTypes) {
          setDynamicCustomFields(blankCustomFields);
        } else {
          setDynamicCustomFields([]);
        }
        
        // For record-update action, keep fields blank by default
        // If user has previously saved data for this record, restore their values
        
        const storedDataToUse = preserveStoredData || (hasStoredData && storedRequestData ? storedRequestData : null);
        
        // Only preserve stored data if it's for the SAME record being selected
        const isMatchingRecord = storedDataToUse && 
          storedDataToUse.formData && 
          storedDataToUse.formData.record === recordUid;
        
        
        // Block template processing for record-update to prevent auto-filling fields
        isPreservingStoredDataRef.current = true;
        setIsPreservingStoredData(true);
        
        if (storedDataToUse && storedDataToUse.formData && isMatchingRecord) {
          
          // Restore user's previously saved values for this record
          const preservedFormData = {
            record: recordUid,
            ...storedDataToUse.formData
          };
          
          // Apply preserved form data
          setFormData(preservedFormData);
          
          // Reset flags after template processing completes
          setTimeout(() => {
            isPreservingStoredDataRef.current = false;
            setIsPreservingStoredData(false);
          }, 10000);
        } else {
          // Show blank fields for different/new record
          
          // Set blank form data for new record with the original record type
          const blankFormData = {
            record: recordUid,
            recordType: details.type || details.record_type || existingValues.recordType || ''
          };
          setFormData(blankFormData);
          
          // Reset flags after processing
          setTimeout(() => {
            isPreservingStoredDataRef.current = false;
            setIsPreservingStoredData(false);
          }, 10000);
        }
        
        setTimeout(() => {
          setOriginalFormData(existingValues);
        }, 100);
        
        // Fetch template for the current record type
        if (details.type) {
          
          // Fetch template and map record details to form fields
          fetchRecordTypeTemplate(details.type, details);
        }
      }
      
      // Fetch record types after record details are loaded successfully
      // This ensures record types are available when the dropdown becomes visible
      fetchRecordTypes();
      
    } catch (error) {
      // Handle error
      const errorMessage = handleApiError(error, "Failed to fetch record details");
      
      setLastResult({ 
        success: false, 
        message: errorMessage
      });
      
      setRecordDetails({});
      setDynamicCustomFields([]);
    } finally {
      setLoadingRecordDetails(false);
    }
  };

  // Fetch Keeper record types
  const fetchRecordTypes = async () => {
    setLoadingRecordTypes(true);
    try {
      const result = await invoke("getRecordTypes");
      
      // Transform the response to match the select options format
      if (result && result.data && Array.isArray(result.data)) {
        const transformedOptions = result.data.map(recordType => ({
          label: recordType.content,
          value: recordType.content
        }));
        setRecordTypes(transformedOptions);
      } else {
        setRecordTypes([]);
      }
    } catch (error) {
      // Handle error
      const errorMessage = handleApiError(error, "Failed to fetch record types");
      
      setLastResult({ 
        success: false, 
        message: errorMessage
      });
      
      setRecordTypes([]);
    } finally {
      setLoadingRecordTypes(false);
    }
  };

  // Check user role and load stored data
  const checkUserRoleAndLoadData = async (context = issueContext) => {
    try {
      // Ensure we have a valid context with issueKey
      if (!context || !context.issueKey) {
        setIsAdmin(false);
        return;
      }
      
      // Set flag to prevent action change reset during data loading
      setIsLoadingStoredData(true);
      
      // Check if current user is admin by calling the backend
      const userRole = await invoke("getUserRole", { issueKey: context.issueKey });
      setIsAdmin(userRole.isAdmin || false);
      
      // If admin, try to load any stored request data
      if (userRole.isAdmin) {
        const storedData = await invoke("getStoredRequestData", { issueKey: context.issueKey });
        if (storedData && storedData.data) {
          setStoredRequestData(storedData.data);
          setHasStoredData(true);
          
          // Pre-populate form with stored data for admin
          setSelectedAction(storedData.data.selectedAction);
          setFormData(storedData.data.formData || {});
          
          // Restore temporary address data if present
          if (storedData.data.formData?.addressRef && storedData.data.formData.addressRef.startsWith('temp_addr_')) {
            const tempAddressUid = storedData.data.formData.addressRef;
            const tempAddressData = storedData.data.tempAddressData?.[tempAddressUid];
            if (tempAddressData) {
              setResolvedAddresses(prev => ({
                ...prev,
                [tempAddressUid]: tempAddressData
              }));
            }
          }
          
          // Restore selected records for record-update actions
          // Use setTimeout to ensure state updates complete before triggering any side effects
          setTimeout(() => {
            if (storedData.data.selectedAction?.value === 'record-update' && storedData.data.selectedRecordForUpdate) {
              setSelectedRecordForUpdate(storedData.data.selectedRecordForUpdate);
              // Fetch all necessary data to ensure form conditions are met
              fetchKeeperRecords();
              // Pass the stored data to preserve user's saved values
              fetchKeeperRecordDetails(storedData.data.selectedRecordForUpdate.record_uid, storedData.data);
              fetchRecordTypes();
            } else if (storedData.data.selectedAction?.value === 'record-add' && storedData.data.formData?.recordType) {
              // For record-add actions, fetch the template for the stored record type
              fetchRecordTypeTemplateWithFormMapping(storedData.data.formData.recordType, storedData.data.formData);
              fetchRecordTypes();
            }
            if (storedData.data.selectedRecord) {
              setSelectedRecord(storedData.data.selectedRecord);
            }
            if (storedData.data.selectedFolder) {
              setSelectedFolder(storedData.data.selectedFolder);
            }
          }, 200); // Delay to allow template processing to start
        }
      } else {
        // For regular users, check if they have previously stored data
        const storedData = await invoke("getStoredRequestData", { issueKey: context.issueKey });
        if (storedData && storedData.data) {
          setHasStoredData(true);
          // Pre-populate their own stored data
          setStoredRequestData(storedData.data);
          setSelectedAction(storedData.data.selectedAction);
          setFormData(storedData.data.formData || {});
          
          // Restore temporary address data if present
          if (storedData.data.formData?.addressRef && storedData.data.formData.addressRef.startsWith('temp_addr_')) {
            const tempAddressUid = storedData.data.formData.addressRef;
            const tempAddressData = storedData.data.tempAddressData?.[tempAddressUid];
            if (tempAddressData) {
              setResolvedAddresses(prev => ({
                ...prev,
                [tempAddressUid]: tempAddressData
              }));
            }
          }
          
          // Restore selected records for record-update actions
          // Use setTimeout to ensure state updates complete before triggering any side effects
          setTimeout(() => {
            if (storedData.data.selectedAction?.value === 'record-update' && storedData.data.selectedRecordForUpdate) {
              
              setSelectedRecordForUpdate(storedData.data.selectedRecordForUpdate);
              // Fetch all necessary data to ensure form conditions are met
              fetchKeeperRecords();
              // Pass the stored data to preserve user's saved values
              fetchKeeperRecordDetails(storedData.data.selectedRecordForUpdate.record_uid, storedData.data);
              fetchRecordTypes();
            } else if (storedData.data.selectedAction?.value === 'record-add' && storedData.data.formData?.recordType) {
              // For record-add actions, fetch the template for the stored record type
              fetchRecordTypeTemplateWithFormMapping(storedData.data.formData.recordType, storedData.data.formData);
              fetchRecordTypes();
            }
            if (storedData.data.selectedRecord) {
              setSelectedRecord(storedData.data.selectedRecord);
            }
            if (storedData.data.selectedFolder) {
              setSelectedFolder(storedData.data.selectedFolder);
            }
          }, 200); // Delay to allow template processing to start
        }
      }
    } catch (error) {
      // Default to non-admin if check fails
      setIsAdmin(false);
    } finally {
      // Clear the loading flag after data is loaded (or failed to load)
      setTimeout(() => setIsLoadingStoredData(false), 200);
    }
  };

  // Save/Update form data
  const updateFormData = async () => {
    if (!selectedAction) {
      setSaveRequestMessage({ type: 'error', message: 'Please select an action first' });
      setTimeout(() => setSaveRequestMessage(null), 5000);
      return;
    }
    
    if (!issueContext?.issueKey) {
      setSaveRequestMessage({ type: 'error', message: 'Issue context not loaded. Please refresh the page.' });
      setTimeout(() => setSaveRequestMessage(null), 5000);
      return;
    }
    
    setIsUpdating(true);
    try {
      // Include temporary address data if present
      const tempAddressData = {};
      if (formData.addressRef && formData.addressRef.startsWith('temp_addr_')) {
        const tempAddressUid = formData.addressRef;
        const addressDetails = resolvedAddresses[tempAddressUid];
        if (addressDetails && addressDetails.isTemporary) {
          tempAddressData[tempAddressUid] = addressDetails;
        }
      }
      
      const requestData = {
        selectedAction,
        formData,
        selectedRecord,
        selectedRecordForUpdate,
        selectedFolder,
        tempAddressData, // Store temporary address data
        timestamp: new Date().toISOString()
      };
      
      const result = await invoke("storeRequestData", { 
        issueKey: issueContext.issueKey,
        requestData 
      });
      
      if (result.success) {
        setStoredRequestData(requestData);
        setHasStoredData(true);
        // Don't show success message - the "Request Saved" dialog box already shows this info
      }
    } catch (error) {
      // Handle error
      const errorMessage = handleApiError(error, "Failed to save request data. Please try again.");
      
      // Only show error messages - the "Request Saved" dialog handles success
      setSaveRequestMessage({ 
        type: 'error', 
        message: errorMessage,
        showTimestamp: false
      });
      setTimeout(() => setSaveRequestMessage(null), 5000);
    } finally {
      setIsUpdating(false);
    }
  };

  // Resolve address reference to get address details
  const resolveAddressReference = async (addressUid) => {
    if (!addressUid) {
      return null;
    }
    
    try {
      const result = await invoke("getKeeperRecordDetails", { recordUid: addressUid });
      
      if (result && result.recordDetails) {
        return result.recordDetails;
      } else {
        return null;
      }
    } catch (error) {
      return null;
    }
  };

  // Format address details into single line display
  const formatAddressDisplay = (addressDetails) => {
    if (!addressDetails) return "No address available";
    
    const parts = [];
    
    // Add title if available (e.g., "Home", "Work")
    if (addressDetails.title) {
      parts.push(`${addressDetails.title}:`);
    }
    
    // Extract address fields from the fields array
    if (addressDetails.fields && Array.isArray(addressDetails.fields)) {
      addressDetails.fields.forEach(field => {
        if (field.type === 'address' && field.value && field.value.length > 0) {
          const addressValue = field.value[0];
          if (typeof addressValue === 'object' && addressValue !== null) {
            // Create address parts in logical order
            const addressParts = [];
            
            // Street address (street1 + street2 if available)
            const streetParts = [];
            if (addressValue.street1) streetParts.push(addressValue.street1);
            if (addressValue.street2) streetParts.push(addressValue.street2);
            if (streetParts.length > 0) {
              addressParts.push(streetParts.join(', '));
            }
            
            // City, State ZIP format
            const locationParts = [];
            if (addressValue.city) locationParts.push(addressValue.city);
            if (addressValue.state) locationParts.push(addressValue.state);
            if (addressValue.zip) locationParts.push(addressValue.zip);
            if (locationParts.length > 0) {
              addressParts.push(locationParts.join(', '));
            }
            
            // Country (if specified and not US)
            if (addressValue.country && addressValue.country !== 'US' && addressValue.country !== 'USA') {
              addressParts.push(addressValue.country);
            }
            
            if (addressParts.length > 0) {
              parts.push(addressParts.join(' | '));
            }
          }
        }
      });
    }
    
    return parts.length > 0 ? parts.join(' ') : "Address details unavailable";
  };

  // Resolve and cache address reference
  const resolveAndCacheAddress = async (addressUid, force = false) => {
    if (!addressUid) return;
    
    // Skip resolution for temporary addresses
    if (addressUid.startsWith('temp_addr_')) {
      return;
    }
    
    // Check if already resolved or currently loading (unless forced)
    if (!force && (resolvedAddresses[addressUid] || loadingAddresses.has(addressUid))) {
      return;
    }
    
    // Mark as loading
    setLoadingAddresses(prev => new Set([...prev, addressUid]));
    
    try {
      const addressDetails = await resolveAddressReference(addressUid);
      if (addressDetails) {
        setResolvedAddresses(prev => ({
          ...prev,
          [addressUid]: addressDetails
        }));
        
        // Force component re-render by updating formData to trigger UI refresh
        setFormData(currentFormData => ({ ...currentFormData }));
      } else {
        // Cache "not found" state to prevent infinite retries
        setResolvedAddresses(prev => ({
          ...prev,
          [addressUid]: {
            record_uid: addressUid,
            type: 'address',
            title: 'Address Not Found',
            error: 'Address record does not exist',
            notFound: true
          }
        }));
      }
    } catch (error) {
      
      // Cache error state to prevent infinite retries
      const errorMessage = handleApiError(error, 'Failed to load address');
      setResolvedAddresses(prev => ({
        ...prev,
        [addressUid]: {
          record_uid: addressUid,
          type: 'address',
          title: 'Address Error',
          error: errorMessage,
          hasError: true
        }
      }));
    } finally {
      // Remove from loading set
      setLoadingAddresses(prev => {
        const newSet = new Set(prev);
        newSet.delete(addressUid);
        return newSet;
      });
    }
  };

  // Get display value for address reference
  const getAddressDisplayValue = (addressUid) => {
    if (!addressUid) {
      return "No address selected";
    }
    
    // First, check if we have temporary address data in form data (regardless of UID)
    const hasTemporaryAddressData = formData.street1 || formData.street2 || formData.city || 
                                   formData.state || formData.zip || formData.country;
    
    if (hasTemporaryAddressData) {
      // Show the full address details from form data
      const addressParts = [];
      if (formData.street1) addressParts.push(formData.street1);
      if (formData.street2) addressParts.push(formData.street2);
      if (formData.city) addressParts.push(formData.city);
      if (formData.state) addressParts.push(formData.state);
      if (formData.zip) addressParts.push(formData.zip);
      if (formData.country) addressParts.push(formData.country);
      
      if (addressParts.length > 0) {
        const fullAddress = addressParts.join(', ');
        return ` ${fullAddress} (Pending Creation)`;
      }
    }
    
    // Check if this is a temporary address first (before checking cache)
    if (addressUid.startsWith('temp_addr_')) {
      const addressDetails = resolvedAddresses[addressUid];
      if (addressDetails && addressDetails.isTemporary) {
        // Show the full address details for temporary addresses
        const addressParts = [];
        if (addressDetails.tempData) {
          if (addressDetails.tempData.street1) addressParts.push(addressDetails.tempData.street1);
          if (addressDetails.tempData.street2) addressParts.push(addressDetails.tempData.street2);
          if (addressDetails.tempData.city) addressParts.push(addressDetails.tempData.city);
          if (addressDetails.tempData.state) addressParts.push(addressDetails.tempData.state);
          if (addressDetails.tempData.zip) addressParts.push(addressDetails.tempData.zip);
          if (addressDetails.tempData.country) addressParts.push(addressDetails.tempData.country);
        }
        
        const fullAddress = addressParts.length > 0 ? addressParts.join(', ') : addressDetails.title;
        return ` ${fullAddress} (Pending Creation)`;
      }
      
      // Fallback to generic message for temporary addresses
      return " Address (Pending Creation)";
    }
    
    // Handle old/invalid address UIDs that might cause errors
    if (addressUid.startsWith('addr_') && !addressUid.startsWith('temp_addr_')) {
      const addressDetails = resolvedAddresses[addressUid];
      if (addressDetails) {
        // Check error state
        if (addressDetails.hasError) {
          return `Error: ${addressDetails.error}`;
        }
        if (addressDetails.notFound) {
          return `Address not found: ${addressUid}`;
        }
        return formatAddressDisplay(addressDetails);
      }
      
      // For old address UIDs, only show invalid message if no temporary data is available
      if (!hasTemporaryAddressData) {
        return ` Invalid Address Reference: ${addressUid}`;
      }
      // If we have temporary data, show that instead
      return "No address selected";
    }
    
    const addressDetails = resolvedAddresses[addressUid];
    
    // Prioritize cached result over loading state
    if (addressDetails) {
      // Check error state
      if (addressDetails.hasError) {
        return `Error: ${addressDetails.error}`;
      }
      if (addressDetails.notFound) {
        return `Address not found: ${addressUid}`;
      }
      return formatAddressDisplay(addressDetails);
    }
    
    if (loadingAddresses.has(addressUid)) {
      return "Loading address...";
    }
    
    // Try to trigger resolution if not already loading (only for real addresses)
    if (!loadingAddresses.has(addressUid)) {
      resolveAndCacheAddress(addressUid);
    }
    
    // Return UID as fallback while loading
    return addressUid;
  };

  // Clear stored data from backend
  const clearStoredData = async () => {
    try {
      // Check if issueContext is available
      if (!issueContext || !issueContext.issueKey) {
        throw new Error('Issue context not available. Please refresh the page.');
      }
      
      // Pass issueKey to the backend
      const result = await invoke("clearStoredRequestData", { issueKey: issueContext.issueKey });
      
      if (!result || !result.success) {
        throw new Error(result?.error || 'Failed to clear stored data');
      }
      
      // Clear all form data and reset state
      setFormData({});
      setSelectedAction(null);
      setSelectedRecord(null);
      setSelectedRecordForUpdate(null);
      setSelectedFolder(null);
      setResolvedAddresses({});
      setLoadingAddresses(new Set());
      setShowNewAddressModal(false);
      setNewAddressFormData({});
      setAddressTemplate(null);
      setLoadingAddressTemplate(false);
      setDynamicCustomFields([]);
      
      // Clear stored request data states
      setStoredRequestData(null);
      setHasStoredData(false);
      setShowStoredRequestMessage(true); // Reset for next time data is saved
      
      // Reset record-update specific states
      setRecordDetails({});
      setRecordTypeTemplate({});
      setTemplateFields([]);
      setManualCustomFields([]);
      
      // Show success message
      setSaveRequestMessage({ 
        type: 'success', 
        message: 'All stored data has been cleared. You can now start fresh with a new request.',
        showTimestamp: false
      });
      setTimeout(() => setSaveRequestMessage(null), 5000);
      
    } catch (error) {
      const errorMessage = handleApiError(error, 'Failed to clear stored data. Please try again.');
      
      setSaveRequestMessage({ 
        type: 'error', 
        message: errorMessage,
        showTimestamp: false
      });
      setTimeout(() => setSaveRequestMessage(null), 8000);
    }
  };


  // Fetch address records for dropdown
  const fetchAddressRecords = async () => {
    setLoadingAddressRecords(true);
    try {
      const result = await invoke("getKeeperRecords");
      
      // Filter for address type records
      const addressRecords = (result.records || []).filter(record => {
        const recordType = record.record_type || record.type || '';
        return recordType === 'address';
      });
      
      setAddressRecords(addressRecords);
    } catch (error) {
      // Handle error
      const errorMessage = handleApiError(error, "Failed to fetch address records");
      
      setLastResult({ 
        success: false, 
        message: errorMessage
      });
      
      setAddressRecords([]);
    } finally {
      setLoadingAddressRecords(false);
    }
  };

  // Fetch address template for new address creation
  const fetchAddressTemplate = async () => {
    setLoadingAddressTemplate(true);
    try {
      const result = await invoke("getRecordTypeTemplate", { recordType: "address" });
      
      if (result && result.data) {
        setAddressTemplate(result.data);
        
        // Process template fields to initialize form data dynamically
        const initialFormData = {
          title: ''
        };
        
        // Initialize address fields if they exist in the template
        if (result.data.fields && Array.isArray(result.data.fields)) {
          result.data.fields.forEach(field => {
            if (field.type === 'address' && field.value && Array.isArray(field.value) && field.value.length > 0) {
              const addressFields = field.value[0];
              // Initialize all address sub-fields
              if (addressFields.street1) initialFormData.street1 = '';
              if (addressFields.street2) initialFormData.street2 = '';
              if (addressFields.city) initialFormData.city = '';
              if (addressFields.state) initialFormData.state = '';
              if (addressFields.zip) initialFormData.zip = '';
              if (addressFields.country) initialFormData.country = '';
            }
          });
        }
        
        // Initialize notes field if available
        if (result.data.notes) {
          initialFormData.notes = '';
        }
        
        setNewAddressFormData(initialFormData);
      }
    } catch (error) {
      // Handle error
      const errorMessage = handleApiError(error, "Failed to fetch address template");
      
      setLastResult({ 
        success: false, 
        message: errorMessage
      });
    } finally {
      setLoadingAddressTemplate(false);
    }
  };

  // Handle new address creation
  const handleNewAddress = async () => {
    setShowAddressDropdown(false);
    // Show modal immediately for instant response
    setShowNewAddressModal(true);
    // Fetch template in background - modal will show loading state
    await fetchAddressTemplate();
  };

  // Handle address form field changes
  const handleAddressFieldChange = (fieldName, value) => {
    setNewAddressFormData(prev => ({
      ...prev,
      [fieldName]: value
    }));
  };

  // Save new address record
  const saveNewAddress = async () => {
    try {
      // Generate a temporary UID for the address (will be replaced with real UID during approval)
      const tempAddressUid = `temp_addr_${Date.now()}`;
      
      // Create temporary address record for display purposes
      const tempAddressRecord = {
        record_uid: tempAddressUid,
        type: 'address',
        title: newAddressFormData.title,
        fields: [
          {
            type: 'address',
            value: [{
              street1: newAddressFormData.street1 || '',
              street2: newAddressFormData.street2 || '',
              city: newAddressFormData.city || '',
              state: newAddressFormData.state || '',
              zip: newAddressFormData.zip || '',
              country: newAddressFormData.country || ''
            }]
          }
        ],
        notes: newAddressFormData.notes || '',
        isTemporary: true, // Mark as temporary
        tempData: {
          title: newAddressFormData.title,
          street1: newAddressFormData.street1 || '',
          street2: newAddressFormData.street2 || '',
          city: newAddressFormData.city || '',
          state: newAddressFormData.state || '',
          zip: newAddressFormData.zip || '',
          country: newAddressFormData.country || '',
          notes: newAddressFormData.notes || ''
        }
      };
      
      // Cache the temporary address for immediate display
      setResolvedAddresses(prev => ({
        ...prev,
        [tempAddressUid]: tempAddressRecord
      }));
      
      // Update the addressRef field with temporary address UID
      handleInputChange('addressRef', tempAddressUid);
      
      // Also store the individual address fields in form data for display purposes
      // This ensures we can reconstruct the full address even if cache is not available
      const addressFields = {
        addressRef: tempAddressUid,
        street1: newAddressFormData.street1 || '',
        street2: newAddressFormData.street2 || '',
        city: newAddressFormData.city || '',
        state: newAddressFormData.state || '',
        zip: newAddressFormData.zip || '',
        country: newAddressFormData.country || '',
        addressNotes: newAddressFormData.notes || ''
      };
      
      // Update form data with all address fields
      setFormData(prev => ({
        ...prev,
        ...addressFields
      }));
      
      // Close modal
      setShowNewAddressModal(false);
      
      // Clear the form data
      setNewAddressFormData({});
      
      
    } catch (error) {
      const errorMessage = handleApiError(error, "Error saving address. Please try again.");
      alert(errorMessage);
    }
  };

  // Fetch record type template when record type is changed
  const fetchRecordTypeTemplate = async (recordType, recordDetailsForMapping = null) => {
    
    // Clear custom fields immediately when template processing starts
    setDynamicCustomFields([]);
    
    if (!recordType) {
      setRecordTypeTemplate({});
      setTemplateFields([]);
      return;
    }

    setLoadingTemplate(true);
    
    try {
      const result = await invoke("getRecordTypeTemplate", { recordType });
        
        if (result && result.template) {
          setRecordTypeTemplate(result.template);
        
        // Extract template fields for rendering
        const fields = result.template.fields || [];
        
        
        const processedFields = [];
        
        // First, add top-level fields from template (title, notes)
        if (result.template.title !== undefined) {
          processedFields.push({
            name: 'title',
            label: 'Title',
            type: 'text',
            required: true, // Title is typically required for new records
            placeholder: 'Enter record title',
            templateField: true,
            isTopLevel: true
          });
        }
        
        if (result.template.notes !== undefined) {
          processedFields.push({
            name: 'notes',
            label: 'Notes',
            type: 'textarea',
            required: false,
            placeholder: 'Enter notes (optional)',
            templateField: true,
            isTopLevel: true
          });
        }
        
        // Process fields - handle both $ref and type properties
        fields
          .forEach((field, index) => {
            // Try to determine field type from available properties
            let fieldType = field.$ref || field.type || null;
            
            // If no clear field type, skip
            if (!fieldType) {
              return;
            }
            
            // Handle reference fields with proper labels
            
            let fieldLabel = fieldType.charAt(0).toUpperCase() + fieldType.slice(1);
            
            // Use custom label if provided
            if (field.label) {
              fieldLabel = field.label.charAt(0).toUpperCase() + field.label.slice(1);
            }
            
            // Enhance labels for complex field types
            fieldLabel = enhanceFieldLabel(fieldType, fieldLabel);
            
            // Handle complex field types based on their schema or value structure
            if (fieldType === 'name') {
              // Create separate fields for name components
              // If no value structure, create default name structure
              const nameStructure = field.value && field.value.length > 0 && typeof field.value[0] === 'object' 
                ? field.value[0] 
                : { first: "text", middle: "text", last: "text" };
              if (nameStructure.first !== undefined) {
                processedFields.push({
                  name: 'name_first',
                  label: 'First Name',
                  type: 'text',
                  required: field.required || false,
                  placeholder: 'First Name',
                  templateField: true,
                  originalField: field,
                  isComplexType: true,
                  parentType: 'name',
                  subField: 'first'
                });
              }
              if (nameStructure.middle !== undefined) {
                processedFields.push({
                  name: 'name_middle',
                  label: 'Middle Name',
                  type: 'text',
                  required: false,
                  placeholder: 'Middle Name',
                  templateField: true,
                  originalField: field,
                  isComplexType: true,
                  parentType: 'name',
                  subField: 'middle'
                });
              }
              if (nameStructure.last !== undefined) {
                processedFields.push({
                  name: 'name_last',
                  label: 'Last Name',
                  type: 'text',
                  required: field.required || false,
                  placeholder: 'Last Name',
                  templateField: true,
                  originalField: field,
                  isComplexType: true,
                  parentType: 'name',
                  subField: 'last'
                });
              }
            } else if (fieldType === 'phone') {
              // Create separate fields for phone components
              // If no value structure, create default phone structure
              const phoneStructure = field.value && field.value.length > 0 && typeof field.value[0] === 'object'
                ? field.value[0]
                : { number: "text", ext: "text", type: "", region: "US" };
              if (phoneStructure.number !== undefined) {
                processedFields.push({
                  name: 'phone_number',
                  label: 'Phone Number',
                  type: 'tel',
                  required: field.required || false,
                  placeholder: '+1 (555) 123-4567',
                  templateField: true,
                  originalField: field,
                  isComplexType: true,
                  parentType: 'phone',
                  subField: 'number'
                });
              }
              if (phoneStructure.ext !== undefined) {
                processedFields.push({
                  name: 'phone_ext',
                  label: 'Extension',
                  type: 'text',
                  required: false,
                  placeholder: 'Ext',
                  templateField: true,
                  originalField: field,
                  isComplexType: true,
                  parentType: 'phone',
                  subField: 'ext'
                });
              }
              if (phoneStructure.type !== undefined) {
                processedFields.push({
                  name: 'phone_type',
                  label: 'Phone Type',
                  type: 'select',
                  required: false,
                  options: [
                    { value: '', label: 'Select Type' },
                    { value: 'Home', label: 'Home' },
                    { value: 'Work', label: 'Work' },
                    { value: 'Mobile', label: 'Mobile' },
                    { value: 'Other', label: 'Other' }
                  ],
                  templateField: true,
                  originalField: field,
                  isComplexType: true,
                  parentType: 'phone',
                  subField: 'type'
                });
              }
            } else if (fieldType === 'address') {
              // Create separate fields for address components based on API response
              // API shows: city, country, state, street1, street2, zip
              const addressStructure = field.value && field.value.length > 0 && typeof field.value[0] === 'object' 
                ? field.value[0] 
                : { street1: "text", street2: "text", city: "text", state: "text", zip: "text", country: "text" };
              
              if (addressStructure.street1 !== undefined) {
                processedFields.push({
                  name: 'address_street1',
                  label: 'Street Address 1',
                  type: 'text',
                  required: field.required || false,
                  placeholder: 'Enter street address',
                  templateField: true,
                  originalField: field,
                  isComplexType: true,
                  parentType: 'address',
                  subField: 'street1'
                });
              }
              if (addressStructure.street2 !== undefined) {
                processedFields.push({
                  name: 'address_street2',
                  label: 'Street Address 2',
                  type: 'text',
                  required: false,
                  placeholder: 'Apartment, suite, etc. (optional)',
                  templateField: true,
                  originalField: field,
                  isComplexType: true,
                  parentType: 'address',
                  subField: 'street2'
                });
              }
              if (addressStructure.city !== undefined) {
                processedFields.push({
                  name: 'address_city',
                  label: 'City',
                  type: 'text',
                  required: field.required || false,
                  placeholder: 'Enter city',
                  templateField: true,
                  originalField: field,
                  isComplexType: true,
                  parentType: 'address',
                  subField: 'city'
                });
              }
              if (addressStructure.state !== undefined) {
                processedFields.push({
                  name: 'address_state',
                  label: 'State/Province',
                  type: 'text',
                  required: false,
                  placeholder: 'Enter state or province',
                  templateField: true,
                  originalField: field,
                  isComplexType: true,
                  parentType: 'address',
                  subField: 'state'
                });
              }
              if (addressStructure.zip !== undefined) {
                processedFields.push({
                  name: 'address_zip',
                  label: 'ZIP/Postal Code',
                  type: 'text',
                  required: false,
                  placeholder: 'Enter ZIP or postal code',
                  templateField: true,
                  originalField: field,
                  isComplexType: true,
                  parentType: 'address',
                  subField: 'zip'
                });
              }
              if (addressStructure.country !== undefined) {
                processedFields.push({
                  name: 'address_country',
                  label: 'Country',
                  type: 'text',
                  required: false,
                  placeholder: 'Enter country',
                  templateField: true,
                  originalField: field,
                  isComplexType: true,
                  parentType: 'address',
                  subField: 'country'
                });
              }
            } else if (fieldType === 'paymentCard') {
              // Create separate fields for payment card components based on API response
              // API shows: cardNumber, cardExpirationDate, cardSecurityCode
              const cardStructure = field.value && field.value.length > 0 && typeof field.value[0] === 'object' 
                ? field.value[0] 
                : { cardNumber: "text", cardExpirationDate: "text", cardSecurityCode: "text" };
              
              if (cardStructure.cardNumber !== undefined) {
                processedFields.push({
                  name: 'paymentCard_cardNumber',
                  label: 'Card Number',
                  type: 'text',
                  required: field.required || false,
                  placeholder: '•••• •••• •••• 1234',
                  templateField: true,
                  originalField: field,
                  isComplexType: true,
                  parentType: 'paymentCard',
                  subField: 'cardNumber'
                });
              }
              if (cardStructure.cardExpirationDate !== undefined) {
                // Split expiration date into month and year fields (stored as MM/YYYY format)
                processedFields.push({
                  name: 'paymentCard_cardExpirationMonth',
                  label: 'Expiration Month',
                  type: 'select',
                  required: field.required || false,
                  options: [
                    { value: '', label: 'Month' },
                    { value: '01', label: '01 - January' },
                    { value: '02', label: '02 - February' },
                    { value: '03', label: '03 - March' },
                    { value: '04', label: '04 - April' },
                    { value: '05', label: '05 - May' },
                    { value: '06', label: '06 - June' },
                    { value: '07', label: '07 - July' },
                    { value: '08', label: '08 - August' },
                    { value: '09', label: '09 - September' },
                    { value: '10', label: '10 - October' },
                    { value: '11', label: '11 - November' },
                    { value: '12', label: '12 - December' }
                  ],
                  templateField: true,
                  originalField: field,
                  isComplexType: true,
                  parentType: 'paymentCard',
                  subField: 'cardExpirationMonth'
                });
                
                processedFields.push({
                  name: 'paymentCard_cardExpirationYear',
                  label: 'Expiration Year',
                  type: 'select',
                  required: field.required || false,
                  options: [
                    { value: '', label: 'Year' },
                    ...Array.from({ length: 20 }, (_, i) => {
                      const year = new Date().getFullYear() + i;
                      return { value: year.toString(), label: year.toString() };
                    })
                  ],
                  templateField: true,
                  originalField: field,
                  isComplexType: true,
                  parentType: 'paymentCard',
                  subField: 'cardExpirationYear'
                });
              }
              if (cardStructure.cardSecurityCode !== undefined) {
                processedFields.push({
                  name: 'paymentCard_cardSecurityCode',
                  label: 'Security Code (CVV)',
                  type: 'text',
                  required: field.required || false,
                  placeholder: '123',
                  templateField: true,
                  originalField: field,
                  isComplexType: true,
                  parentType: 'paymentCard',
                  subField: 'cardSecurityCode'
                });
              }
            } else if (fieldType === 'addressRef') {
              // Handle address reference field
              processedFields.push({
                name: 'addressRef',
                label: 'Address',
                type: 'addressRef', // Special type for address reference
                required: field.required || false,
                placeholder: 'Select or add address...',
                templateField: true,
                originalField: field,
                isComplexType: false,
                parentType: 'addressRef'
              });
            } else if (fieldType === 'fileRef') {
              // Handle file reference field
              processedFields.push({
                name: 'fileRef',
                label: 'Files',
                type: 'fileRef', // Special type for file reference
                required: field.required || false,
                placeholder: 'Select files...',
                templateField: true,
                originalField: field,
                isComplexType: false,
                parentType: 'fileRef'
              });
            } else if (fieldType === 'cardRef') {
              // Handle payment card reference field
              processedFields.push({
                name: 'cardRef',
                label: 'Payment Card',
                type: 'cardRef', // Special type for card reference
                required: field.required || false,
                placeholder: 'Select payment card...',
                templateField: true,
                originalField: field,
                isComplexType: false,
                parentType: 'cardRef'
              });
            } else if (fieldType === 'bankAccount') {
              // Create separate fields for bank account components
              // If no value structure, create default bank account structure
              const bankStructure = field.value && field.value.length > 0 && typeof field.value[0] === 'object'
                ? field.value[0]
                : { accountNumber: "text", accountType: "", otherType: "text", routingNumber: "text" };
                
              if (bankStructure.accountNumber !== undefined) {
                processedFields.push({
                  name: 'bankAccount_accountNumber',
                  label: 'Account Number',
                  type: 'text',
                  required: field.required || false,
                  placeholder: 'Enter account number',
                  templateField: true,
                  originalField: field,
                  isComplexType: true,
                  parentType: 'bankAccount',
                  subField: 'accountNumber'
                });
              }
              if (bankStructure.routingNumber !== undefined) {
                processedFields.push({
                  name: 'bankAccount_routingNumber',
                  label: 'Routing Number',
                  type: 'text',
                  required: false,
                  placeholder: 'Enter routing number',
                  templateField: true,
                  originalField: field,
                  isComplexType: true,
                  parentType: 'bankAccount',
                  subField: 'routingNumber'
                });
              }
              if (bankStructure.accountType !== undefined) {
                processedFields.push({
                  name: 'bankAccount_accountType',
                  label: 'Account Type',
                  type: 'select',
                  required: false,
                  options: [
                    { value: '', label: 'Select Account Type' },
                    { value: 'checking', label: 'Checking' },
                    { value: 'savings', label: 'Savings' },
                    { value: 'other', label: 'Other' }
                  ],
                  templateField: true,
                  originalField: field,
                  isComplexType: true,
                  parentType: 'bankAccount',
                  subField: 'accountType'
                });
              }
              if (bankStructure.otherType !== undefined) {
                processedFields.push({
                  name: 'bankAccount_otherType',
                  label: 'Other Account Type',
                  type: 'text',
                  required: false,
                  placeholder: 'Specify other account type',
                  templateField: true,
                  originalField: field,
                  isComplexType: true,
                  parentType: 'bankAccount',
                  subField: 'otherType'
                });
              }
            } else {
              // Handle simple field types
              processedFields.push({
                name: fieldType,
                label: fieldLabel,
                type: getInputTypeForField(fieldType),
                required: field.required || false,
                placeholder: getPlaceholderForField(fieldType, fieldLabel),
                templateField: true,
                originalField: field, // Keep reference to original field for complex types
                isComplexType: isComplexFieldType(fieldType)
              });
            }
          });
        
        setTemplateFields(processedFields);
        
        // Map existing record values to template fields
        const detailsToUse = recordDetailsForMapping || recordDetails;
        if (detailsToUse && Object.keys(detailsToUse).length > 0) {
        // Clear existing form data for template fields to start fresh, but preserve recordType
        const clearedFormData = { ...formData };
        processedFields.forEach(field => {
          delete clearedFormData[field.name];
        });
        
        // Ensure recordType is preserved in cleared data to avoid losing user selection
        if (formData.recordType) {
          clearedFormData.recordType = formData.recordType;
        } else if (detailsToUse && detailsToUse.type) {
          // If no user selection, use the original record type
          clearedFormData.recordType = detailsToUse.type;
        }
        
        // Call mapping function with cleared form data and provided record details
        mapExistingValuesToTemplateWithClearedData(processedFields, clearedFormData, detailsToUse);
        } else {
        }
        
      } else {
        setRecordTypeTemplate({});
        setTemplateFields([]);
      }
    } catch (error) {
      // Handle error
      const errorMessage = handleApiError(error, "Failed to fetch record type template");
      
      setLastResult({ 
        success: false, 
        message: errorMessage
      });
      
      setRecordTypeTemplate({});
      setTemplateFields([]);
    }
    
    setLoadingTemplate(false);
  };

  // Enhanced template fetching function that preserves and maps current form data
  const fetchRecordTypeTemplateWithFormMapping = async (recordType, currentFormData) => {
    
    // Clear custom fields immediately when template processing starts
    setDynamicCustomFields([]);
    
    if (!recordType) {
      setRecordTypeTemplate({});
      setTemplateFields([]);
      return;
    }

    setLoadingTemplate(true);
    
    try {
      const result = await invoke("getRecordTypeTemplate", { recordType });
        
        if (result && result.template) {
          const template = result.template;
          setRecordTypeTemplate(template);
          
          // Process fields from template
          const fields = template.fields || [];
          
          
          const processedFields = [];
          
          // First, add top-level fields from template (title, notes)
          if (template.title !== undefined) {
            processedFields.push({
              name: 'title',
              label: 'Title',
              type: 'text',
              required: true, // Title is typically required for new records
              placeholder: 'Enter record title',
              templateField: true,
              isTopLevel: true
            });
          }
          
          if (template.notes !== undefined) {
            processedFields.push({
              name: 'notes',
              label: 'Notes',
              type: 'textarea',
              required: false,
              placeholder: 'Enter notes (optional)',
              templateField: true,
              isTopLevel: true
            });
          }
          
          // Process fields - handle both $ref and type properties
          fields
            .forEach((field, index) => {
              // Try to determine field type from available properties
              let fieldType = null;
              
              // Check for $ref first
              if (field['$ref']) {
                fieldType = field['$ref'];
              } else if (field.type) {
                fieldType = field.type;
              } else {
                return; // Skip fields without identifiable types
              }
              
              
              // Handle complex field types that need to be broken down into sub-fields
              if (fieldType === 'name') {
                // If no value structure, create default name structure
                const nameStructure = field.value && field.value.length > 0 && typeof field.value[0] === 'object' 
                  ? field.value[0] 
                  : { first: "text", middle: "text", last: "text" };
                if (nameStructure.first !== undefined) {
                  processedFields.push({
                    name: 'name_first',
                    label: 'First Name',
                    type: 'text',
                    required: field.required || false,
                    placeholder: 'First Name',
                    originalType: fieldType,
                    isComplexType: true,
                    parentType: 'name',
                    subField: 'first'
                  });
                }
                if (nameStructure.middle !== undefined) {
                  processedFields.push({
                    name: 'name_middle',
                    label: 'Middle Name',
                    type: 'text',
                    required: false,
                    placeholder: 'Middle Name',
                    originalType: fieldType,
                    isComplexType: true,
                    parentType: 'name',
                    subField: 'middle'
                  });
                }
                if (nameStructure.last !== undefined) {
                  processedFields.push({
                    name: 'name_last',
                    label: 'Last Name',
                    type: 'text',
                    required: field.required || false,
                    placeholder: 'Last Name',
                    originalType: fieldType,
                    isComplexType: true,
                    parentType: 'name',
                    subField: 'last'
                  });
                }
              } else if (fieldType === 'phone') {
                // If no value structure, create default phone structure
                const phoneStructure = field.value && field.value.length > 0 && typeof field.value[0] === 'object'
                  ? field.value[0]
                  : { number: "text", ext: "text", type: "", region: "US" };
                if (phoneStructure.number !== undefined) {
                  processedFields.push({
                    name: 'phone_number',
                    label: 'Phone Number',
                    type: 'tel',
                    required: field.required || false,
                    placeholder: '+1 (555) 123-4567',
                    originalType: fieldType,
                    isComplexType: true,
                    parentType: 'phone',
                    subField: 'number'
                  });
                }
                if (phoneStructure.ext !== undefined) {
                  processedFields.push({
                    name: 'phone_ext',
                    label: 'Extension',
                    type: 'text',
                    required: false,
                    placeholder: 'Ext',
                    originalType: fieldType,
                    isComplexType: true,
                    parentType: 'phone',
                    subField: 'ext'
                  });
                }
                if (phoneStructure.type !== undefined) {
                  processedFields.push({
                    name: 'phone_type',
                    label: 'Phone Type',
                    type: 'select',
                    required: false,
                    options: [
                      { value: 'Home', label: 'Home' },
                      { value: 'Work', label: 'Work' },
                      { value: 'Mobile', label: 'Mobile' },
                      { value: 'Main', label: 'Main' },
                      { value: 'Other', label: 'Other' }
                    ],
                    placeholder: 'Phone Type',
                    originalType: fieldType,
                    isComplexType: true,
                    parentType: 'phone',
                    subField: 'type'
                  });
                }
              } else if (fieldType === 'address') {
                // If no value structure, create default address structure
                const addressStructure = field.value && field.value.length > 0 && typeof field.value[0] === 'object' 
                  ? field.value[0] 
                  : { street1: "text", street2: "text", city: "text", state: "text", zip: "text", country: "text" };
                
                if (addressStructure.street1 !== undefined) {
                  processedFields.push({
                    name: 'address_street1',
                    label: 'Street Address 1',
                    type: 'text',
                    required: field.required || false,
                    placeholder: 'Enter street address',
                    originalType: fieldType,
                    isComplexType: true,
                    parentType: 'address',
                    subField: 'street1'
                  });
                }
                if (addressStructure.street2 !== undefined) {
                  processedFields.push({
                    name: 'address_street2',
                    label: 'Street Address 2',
                    type: 'text',
                    required: false,
                    placeholder: 'Apartment, suite, etc. (optional)',
                    originalType: fieldType,
                    isComplexType: true,
                    parentType: 'address',
                    subField: 'street2'
                  });
                }
                if (addressStructure.city !== undefined) {
                  processedFields.push({
                    name: 'address_city',
                    label: 'City',
                    type: 'text',
                    required: field.required || false,
                    placeholder: 'Enter city',
                    originalType: fieldType,
                    isComplexType: true,
                    parentType: 'address',
                    subField: 'city'
                  });
                }
                if (addressStructure.state !== undefined) {
                  processedFields.push({
                    name: 'address_state',
                    label: 'State/Province',
                    type: 'text',
                    required: false,
                    placeholder: 'Enter state or province',
                    originalType: fieldType,
                    isComplexType: true,
                    parentType: 'address',
                    subField: 'state'
                  });
                }
                if (addressStructure.zip !== undefined) {
                  processedFields.push({
                    name: 'address_zip',
                    label: 'ZIP/Postal Code',
                    type: 'text',
                    required: false,
                    placeholder: 'Enter ZIP or postal code',
                    originalType: fieldType,
                    isComplexType: true,
                    parentType: 'address',
                    subField: 'zip'
                  });
                }
                if (addressStructure.country !== undefined) {
                  processedFields.push({
                    name: 'address_country',
                    label: 'Country',
                    type: 'text',
                    required: false,
                    placeholder: 'Enter country',
                    originalType: fieldType,
                    isComplexType: true,
                    parentType: 'address',
                    subField: 'country'
                  });
                }
              } else if (fieldType === 'paymentCard') {
                // If no value structure, create default card structure
                const cardStructure = field.value && field.value.length > 0 && typeof field.value[0] === 'object' 
                  ? field.value[0] 
                  : { cardNumber: "text", cardExpirationDate: "text", cardSecurityCode: "text" };
                
                if (cardStructure.cardNumber !== undefined) {
                  processedFields.push({
                    name: 'paymentCard_cardNumber',
                    label: 'Card Number',
                    type: 'text',
                    required: field.required || false,
                    placeholder: '•••• •••• •••• 1234',
                    originalType: fieldType,
                    isComplexType: true,
                    parentType: 'paymentCard',
                    subField: 'cardNumber'
                  });
                }
                if (cardStructure.cardExpirationDate !== undefined) {
                  // Split expiration date into month and year fields (stored as MM/YYYY format)
                  processedFields.push({
                    name: 'paymentCard_cardExpirationMonth',
                    label: 'Expiration Month',
                    type: 'select',
                    required: field.required || false,
                    options: [
                      { value: '01', label: '01 - January' },
                      { value: '02', label: '02 - February' },
                      { value: '03', label: '03 - March' },
                      { value: '04', label: '04 - April' },
                      { value: '05', label: '05 - May' },
                      { value: '06', label: '06 - June' },
                      { value: '07', label: '07 - July' },
                      { value: '08', label: '08 - August' },
                      { value: '09', label: '09 - September' },
                      { value: '10', label: '10 - October' },
                      { value: '11', label: '11 - November' },
                      { value: '12', label: '12 - December' }
                    ],
                    placeholder: 'Month',
                    originalType: fieldType,
                    isComplexType: true,
                    parentType: 'paymentCard',
                    subField: 'cardExpirationMonth'
                  });
                  
                  processedFields.push({
                    name: 'paymentCard_cardExpirationYear',
                    label: 'Expiration Year',
                    type: 'select',
                    required: field.required || false,
                    options: [
                      { value: '2024', label: '2024' },
                      { value: '2025', label: '2025' },
                      { value: '2026', label: '2026' },
                      { value: '2027', label: '2027' },
                      { value: '2028', label: '2028' },
                      { value: '2029', label: '2029' },
                      { value: '2030', label: '2030' },
                      { value: '2031', label: '2031' },
                      { value: '2032', label: '2032' },
                      { value: '2033', label: '2033' },
                      { value: '2034', label: '2034' }
                    ],
                    placeholder: 'Year',
                    originalType: fieldType,
                    isComplexType: true,
                    parentType: 'paymentCard',
                    subField: 'cardExpirationYear'
                  });
                }
                if (cardStructure.cardSecurityCode !== undefined) {
                  processedFields.push({
                    name: 'paymentCard_cardSecurityCode',
                    label: 'Security Code (CVV)',
                    type: 'text',
                    required: field.required || false,
                    placeholder: '123',
                    originalType: fieldType,
                    isComplexType: true,
                    parentType: 'paymentCard',
                    subField: 'cardSecurityCode'
                  });
                }
              } else if (fieldType === 'bankAccount') {
                // If no value structure, create default bank account structure
                const bankStructure = field.value && field.value.length > 0 && typeof field.value[0] === 'object' 
                  ? field.value[0] 
                  : { accountNumber: "text", routingNumber: "text", accountType: "text" };
                
                if (bankStructure.accountNumber !== undefined) {
                  processedFields.push({
                    name: 'bankAccount_accountNumber',
                    label: 'Account Number',
                    type: 'text',
                    required: field.required || false,
                    placeholder: 'Account number',
                    originalType: fieldType,
                    isComplexType: true,
                    parentType: 'bankAccount',
                    subField: 'accountNumber'
                  });
                }
                if (bankStructure.routingNumber !== undefined) {
                  processedFields.push({
                    name: 'bankAccount_routingNumber',
                    label: 'Routing Number',
                    type: 'text',
                    required: field.required || false,
                    placeholder: 'Routing number',
                    originalType: fieldType,
                    isComplexType: true,
                    parentType: 'bankAccount',
                    subField: 'routingNumber'
                  });
                }
                if (bankStructure.accountType !== undefined) {
                  processedFields.push({
                    name: 'bankAccount_accountType',
                    label: 'Account Type',
                    type: 'select',
                    required: false,
                    options: [
                      { value: 'checking', label: 'Checking' },
                      { value: 'savings', label: 'Savings' },
                      { value: 'other', label: 'Other' }
                    ],
                    placeholder: 'Account type',
                    originalType: fieldType,
                    isComplexType: true,
                    parentType: 'bankAccount',
                    subField: 'accountType'
                  });
                }
              } else {
                // Handle simple field types directly
                const inputType = getInputTypeForField(fieldType);
                const enhancedLabel = enhanceFieldLabel(fieldType, field.label || fieldType);
                const placeholder = getPlaceholderForField(fieldType, enhancedLabel);
                
                processedFields.push({
                  name: fieldType,
                  label: enhancedLabel,
                  type: inputType,
                  required: field.required || false,
                  placeholder: placeholder,
                  originalType: fieldType
                });
              }
            });
          
          setTemplateFields(processedFields);
          
          // Map current form data to new template fields
          mapCurrentFormDataToTemplate(processedFields, currentFormData, recordType);
          
        } else {
          setRecordTypeTemplate({});
          setTemplateFields([]);
        }
      } catch (error) {
        setRecordTypeTemplate({});
        setTemplateFields([]);
      }
    
    setLoadingTemplate(false);
  };

  // Simplified field mapping for update record action
  const mapCurrentFormDataToTemplate = (templateFields, currentFormData, currentRecordType = null) => {
    
    const selectedRecordType = currentFormData.recordType;
    const actualOriginalRecordType = originalRecordType; // Always use the true original record type
    const isReturningToOriginalType = selectedRecordType === actualOriginalRecordType;
    
    
    const templateFieldNames = templateFields.map(f => f.name);
    
    // SIMPLE LOGIC: Handle the three main scenarios
    if (isReturningToOriginalType) {
      // Scenario 3: Returning to original record type - reset completely
      const restoredFormData = { ...originalFormData, recordType: selectedRecordType };
      
      // Ensure address is resolved for UI consistency
      if (restoredFormData.addressRef) {
        
        // Check if address is already cached
        const isAddressCached = resolvedAddresses[restoredFormData.addressRef];
        
        if (!isAddressCached) {
          // Only trigger resolution if not already cached
          resolveAndCacheAddress(restoredFormData.addressRef, true);
        } else {
        }
      }
      
      // Set form data and clear custom fields - EXPLICIT RESET
      
      // Clear any existing artificial fields before setting
      const cleanRestoredData = Object.keys(restoredFormData).reduce((acc, key) => {
        if (!key.startsWith('_lastAddressUpdate') && !key.startsWith('_addressRefresh')) {
          acc[key] = restoredFormData[key];
        }
        return acc;
      }, {});
      
      
      // Update form state immediately
      // Skip if preserving stored data
      if (!isPreservingStoredDataRef.current) {
        setFormData(() => {
          return cleanRestoredData;
        });
      }
      setDynamicCustomFields([]);
      
      // Verify form data update
      setTimeout(() => {
      }, 50);
      
      // Update UI for address resolution
      if (restoredFormData.addressRef) {
        
        // Trigger form re-render
        // Skip if preserving stored data
        if (!isPreservingStoredDataRef.current) {
          setTimeout(() => {
            setFormData(current => ({ ...current }));
          }, 10);
          
          setTimeout(() => {
            setFormData(current => ({ ...current }));
          }, 50);
          
          setTimeout(() => {
            setFormData(current => ({ ...current }));
          }, 100);
        }
      }
      
      
      // Add verification that template fields will be rendered
      setTimeout(() => {
      }, 100);
      
      return;
    }
    
    // Build new form data starting with core fields
    const newFormData = {
      record: currentFormData.record,
      recordType: selectedRecordType,
      title: currentFormData.title || ''
    };
    
    const unmatchedFields = [];
    
    // Get ALL fields with values (current form data + original form data)
    const allFieldsWithValues = { ...originalFormData, ...currentFormData };
    
    // Filter out fields from current custom fields to prevent nesting
    const currentCustomFieldNames = dynamicCustomFields.map(cf => cf.originalFieldName || cf.id);
    const oldCustomFields = Object.keys(allFieldsWithValues).filter(key => 
      currentCustomFieldNames.includes(key) && !templateFieldNames.includes(key)
    );
    if (oldCustomFields.length > 0) {
    }
    
    const fieldsWithValues = Object.keys(allFieldsWithValues).filter(key => 
      allFieldsWithValues[key] && allFieldsWithValues[key] !== '' && 
      !['record', 'recordType', 'title'].includes(key) &&
      !(currentCustomFieldNames.includes(key) && !templateFieldNames.includes(key)) && // Exclude old custom fields from processing
      !key.startsWith('_lastAddressUpdate') && !key.startsWith('_addressRefresh') // Exclude artificial UI fields
    );
    
    // Map ALL fields with values to new template fields
    Object.keys(allFieldsWithValues).forEach(fieldName => {
      const fieldValue = allFieldsWithValues[fieldName];
      
        // Skip core fields, empty values, OLD CUSTOM FIELDS, and ARTIFICIAL UI FIELDS
        const isOldCustomField = currentCustomFieldNames.includes(fieldName) && !templateFieldNames.includes(fieldName);
        const isArtificialField = fieldName.startsWith('_lastAddressUpdate') || fieldName.startsWith('_addressRefresh');
        
        if (['record', 'recordType', 'title'].includes(fieldName) || 
            !fieldValue || fieldValue === '' || 
            isOldCustomField || isArtificialField) {
          if (isOldCustomField) {
          }
          if (isArtificialField) {
          }
          return;
        }
      
      
      // Direct match with template field
      const directMatch = templateFields.find(tf => tf.name === fieldName);
      if (directMatch) {
        newFormData[fieldName] = fieldValue;
        return;
      }
      
      // Check if this field name directly matches a template field (like addressRef -> addressRef)
      if (templateFields.find(tf => tf.name === fieldName)) {
        newFormData[fieldName] = fieldValue;
        
        // Special handling for addressRef
        if (fieldName === 'addressRef' && fieldValue) {
          resolveAndCacheAddress(fieldValue);
        }
        return;
      }
      
      // Check for partial matches (e.g., accountNumber -> bankAccount_accountNumber)
      const partialMatch = templateFields.find(tf => 
        tf.name.includes(fieldName) || 
        tf.name.endsWith('_' + fieldName) ||
        (tf.originalType && tf.originalType === fieldName)
      );
      
      if (partialMatch) {
        newFormData[partialMatch.name] = fieldValue;
        return;
      }
      
      // No match found - add to unmatched fields (but skip artificial UI fields)
      const isArtificialUIField = fieldName.startsWith('_lastAddressUpdate') || fieldName.startsWith('_addressRefresh');
      if (isArtificialUIField) {
        return;
      }
      
      unmatchedFields.push({
        name: fieldName,
        value: fieldValue,
        originalFieldName: fieldName
      });
    });
    
    // Handle unmatched fields as custom fields  
    
    if (unmatchedFields.length > 0) {
      
      const customFields = unmatchedFields.map((field, index) => {
        // Clean the field name by removing prefixes (e.g., paymentCard_cardNumber -> cardNumber)
        let cleanFieldName = field.originalFieldName;
        
        // Extract base field name from prefixed names
        if (cleanFieldName.includes('_')) {
          const parts = cleanFieldName.split('_');
          if (parts.length === 2) {
            // For patterns like paymentCard_cardNumber, bankAccount_accountNumber
            cleanFieldName = parts[1]; // Take the last part (cardNumber, accountNumber, etc.)
          } else {
            // For more complex patterns, take the last part
            cleanFieldName = parts[parts.length - 1];
          }
        }
        
        const customFieldId = field.originalFieldName; // Keep original for form data key
        
        // Determine input type based on cleaned field name
        let inputType = 'text';
        const name = cleanFieldName.toLowerCase();
        
        if (name === 'addressref') inputType = 'addressRef'; // Special handling for address references
        else if (name.includes('password') || name.includes('pass')) inputType = 'password';
        else if (name.includes('email')) inputType = 'email';
        else if (name.includes('url') || name.includes('website')) inputType = 'url';
        else if (name.includes('phone') || name.includes('tel')) inputType = 'tel';
        else if (name.includes('date')) inputType = 'date';
        else if (name.includes('note') || name.includes('description')) inputType = 'textarea';
        
        // Add to form data
        newFormData[customFieldId] = field.value;
        
        // Special handling for addressRef custom fields - trigger address resolution
        if (field.originalFieldName === 'addressRef' && field.value) {
          resolveAndCacheAddress(field.value, true); // Force resolution to ensure UI updates
        }
        
        return {
          id: customFieldId,
          label: cleanFieldName.charAt(0).toUpperCase() + cleanFieldName.slice(1), // Use cleaned name for display
          type: inputType,
          value: field.value,
          isUnmatchedField: true,
          originalFieldName: field.originalFieldName,
          cleanFieldName: cleanFieldName // Store both for reference
        };
      });
      
      setDynamicCustomFields(customFields);
    } else {
      setDynamicCustomFields([]);
    }
    
    // Update form data
    // Skip if preserving stored data
    if (!isPreservingStoredDataRef.current) {
      setFormData(newFormData);
    }
  };

  // Helper function to determine input type for field
  const getInputTypeForField = (fieldType) => {
    switch (fieldType) {
      case 'password':
      case 'secret':
      case 'pinCode':
        return 'password';
      case 'url':
        return 'url';
      case 'email':
        return 'email';
      case 'notes':
      case 'note':
      case 'multiline':
      case 'address':
      case 'licenseNumber':
      case 'keyPair':
        return 'textarea';
      case 'phone':
        return 'tel';
      case 'birthDate':
      case 'expirationDate':
      case 'date':
        return 'date';
      case 'login':
      case 'username':
      case 'title':
      case 'name':
      case 'company':
      case 'text':
      case 'passkey':
      case 'oneTimeCode':
      case 'otp':
      case 'accountNumber':
      case 'groupNumber':
      case 'host':
      case 'paymentCard':
      case 'bankAccount':
      case 'securityQuestion':
        return 'text';
      case 'addressRef':
        return 'addressRef';
      case 'fileRef':
        return 'fileRef';
      case 'cardRef':
        return 'cardRef';
      default:
        return 'text';
    }
  };

  // Map existing record values to template fields (with cleared form data to avoid race conditions)
  const mapExistingValuesToTemplateWithClearedData = (templateFields, clearedFormData, recordDetailsToUse = null) => {
    const detailsToUse = recordDetailsToUse || recordDetails;
    
    if (!detailsToUse || Object.keys(detailsToUse).length === 0) {
      return;
    }

    const updatedFormData = { ...clearedFormData }; // Start with cleared form data
    const unmatchedFields = [];
    const templateFieldTypes = templateFields.map(f => f.name); // Template field types
    const mappedFieldTypes = new Set(); // Track which template field types we've mapped

    
    // Clear existing custom fields first
    setDynamicCustomFields([]);

    // Map top-level fields (title, etc.)
    if (detailsToUse.title && templateFieldTypes.includes('title')) {
      updatedFormData.title = detailsToUse.title;
      mappedFieldTypes.add('title');
    }

    // Process the fields array from record details
    if (detailsToUse.fields && Array.isArray(detailsToUse.fields)) {
      
        detailsToUse.fields.forEach((field, index) => {
        
        if (!field.type || !field.value || !Array.isArray(field.value) || field.value.length === 0) {
          return;
        }

        const fieldType = field.type;
        const fieldValue = field.value[0]; // Get first value
        const fieldLabel = field.label || null;

        // Handle complex field types
        if (fieldType === 'name' && typeof fieldValue === 'object' && fieldValue !== null) {
          // Map name components to separate template fields
          if (fieldValue.first && templateFields.find(tf => tf.name === 'name_first')) {
            updatedFormData.name_first = fieldValue.first;
            mappedFieldTypes.add('name');
          }
          if (fieldValue.middle && templateFields.find(tf => tf.name === 'name_middle')) {
            updatedFormData.name_middle = fieldValue.middle;
          }
          if (fieldValue.last && templateFields.find(tf => tf.name === 'name_last')) {
            updatedFormData.name_last = fieldValue.last;
          }
        } else if (fieldType === 'phone' && typeof fieldValue === 'object' && fieldValue !== null) {
          // Map phone components to separate template fields
          if (fieldValue.number && templateFields.find(tf => tf.name === 'phone_number')) {
            updatedFormData.phone_number = fieldValue.number;
            mappedFieldTypes.add('phone');
          }
          if (fieldValue.ext && templateFields.find(tf => tf.name === 'phone_ext')) {
            updatedFormData.phone_ext = fieldValue.ext;
          }
          if (fieldValue.type && templateFields.find(tf => tf.name === 'phone_type')) {
            updatedFormData.phone_type = fieldValue.type;
          }
        } else if (fieldType === 'address' && typeof fieldValue === 'object' && fieldValue !== null) {
          // Map address components to separate template fields
          if (fieldValue.street1 && templateFields.find(tf => tf.name === 'address_street1')) {
            updatedFormData.address_street1 = fieldValue.street1;
            mappedFieldTypes.add('address');
          }
          if (fieldValue.street2 && templateFields.find(tf => tf.name === 'address_street2')) {
            updatedFormData.address_street2 = fieldValue.street2;
          }
          if (fieldValue.city && templateFields.find(tf => tf.name === 'address_city')) {
            updatedFormData.address_city = fieldValue.city;
          }
          if (fieldValue.state && templateFields.find(tf => tf.name === 'address_state')) {
            updatedFormData.address_state = fieldValue.state;
          }
          if (fieldValue.zip && templateFields.find(tf => tf.name === 'address_zip')) {
            updatedFormData.address_zip = fieldValue.zip;
          }
          if (fieldValue.country && templateFields.find(tf => tf.name === 'address_country')) {
            updatedFormData.address_country = fieldValue.country;
          }
        } else if (fieldType === 'paymentCard' && typeof fieldValue === 'object' && fieldValue !== null) {
          // Map payment card components to separate template fields
          if (fieldValue.cardNumber && templateFields.find(tf => tf.name === 'paymentCard_cardNumber')) {
            updatedFormData.paymentCard_cardNumber = fieldValue.cardNumber;
            mappedFieldTypes.add('paymentCard');
          }
          if (fieldValue.cardExpirationDate) {
            // Parse MM/YYYY format into separate month and year fields
            const expirationParts = fieldValue.cardExpirationDate.split('/');
            if (expirationParts.length === 2) {
              const [month, year] = expirationParts;
              if (templateFields.find(tf => tf.name === 'paymentCard_cardExpirationMonth')) {
                updatedFormData.paymentCard_cardExpirationMonth = month;
              }
              if (templateFields.find(tf => tf.name === 'paymentCard_cardExpirationYear')) {
                updatedFormData.paymentCard_cardExpirationYear = year;
              }
            } else {
            }
          }
          if (fieldValue.cardSecurityCode && templateFields.find(tf => tf.name === 'paymentCard_cardSecurityCode')) {
            updatedFormData.paymentCard_cardSecurityCode = fieldValue.cardSecurityCode;
          }
        } else if (fieldType === 'addressRef') {
          // Handle address reference field - value comes as array with UID
          const addressUid = Array.isArray(fieldValue) ? fieldValue[0] : fieldValue;
          
          if (addressUid && typeof addressUid === 'string' && templateFields.find(tf => tf.name === 'addressRef')) {
            updatedFormData.addressRef = addressUid; // Store the address UID
            mappedFieldTypes.add('addressRef');
            
            // Resolve the address reference asynchronously
            resolveAndCacheAddress(addressUid);
          }
        } else if (fieldType === 'bankAccount' && typeof fieldValue === 'object' && fieldValue !== null) {
          // Map bank account components to separate template fields
          if (fieldValue.accountNumber && templateFields.find(tf => tf.name === 'bankAccount_accountNumber')) {
            updatedFormData.bankAccount_accountNumber = fieldValue.accountNumber;
            mappedFieldTypes.add('bankAccount');
          }
          if (fieldValue.routingNumber && templateFields.find(tf => tf.name === 'bankAccount_routingNumber')) {
            updatedFormData.bankAccount_routingNumber = fieldValue.routingNumber;
          }
          if (fieldValue.accountType && templateFields.find(tf => tf.name === 'bankAccount_accountType')) {
            updatedFormData.bankAccount_accountType = fieldValue.accountType;
          }
          if (fieldValue.otherType && templateFields.find(tf => tf.name === 'bankAccount_otherType')) {
            updatedFormData.bankAccount_otherType = fieldValue.otherType;
          }
        } else {
          // Handle simple field types
          const templateField = templateFields.find(tf => tf.name === fieldType);
          
          if (templateField && !mappedFieldTypes.has(fieldType)) {
            // Field type matches template - map the value
            const mappedValue = extractFieldValue(field);
            if (mappedValue !== null && mappedValue !== '') {
              updatedFormData[fieldType] = mappedValue;
              mappedFieldTypes.add(fieldType);
            }
          } else if (templateField && mappedFieldTypes.has(fieldType)) {
            // This field type already mapped, but we have another instance
            // Add as custom field with label distinction
            const mappedValue = extractFieldValue(field);
            if (mappedValue !== null && mappedValue !== '') {
              const customFieldKey = fieldLabel ? `${fieldType}_${fieldLabel}` : `${fieldType}_${index}`;
              const customFieldLabel = fieldLabel ? `${fieldType} (${fieldLabel})` : `${fieldType} #${index + 1}`;
              
              unmatchedFields.push({
                name: customFieldKey,
                value: mappedValue,
                label: formatFieldLabel(customFieldLabel),
                isCustom: true,
                originalType: fieldType
              });
              updatedFormData[customFieldKey] = mappedValue;
            }
          } else {
            // Field type doesn't match template - add as custom field
            const mappedValue = extractFieldValue(field);
            if (mappedValue !== null && mappedValue !== '') {
              const customFieldKey = fieldLabel ? `${fieldType}_${fieldLabel}` : fieldType;
              const customFieldLabel = fieldLabel ? `${fieldType} (${fieldLabel})` : fieldType;
              
              unmatchedFields.push({
                name: customFieldKey,
                value: mappedValue,
                label: formatFieldLabel(customFieldLabel),
                isCustom: true,
                originalType: fieldType
              });
              updatedFormData[customFieldKey] = mappedValue;
            }
          }
        }
      });
    }


    // Preserve the currently selected record type (don't override with original record type)
    const originalRecordType = updatedFormData.recordType;
    const selectedRecordType = clearedFormData.recordType;
    
    
    if (selectedRecordType && selectedRecordType !== originalRecordType) {
      updatedFormData.recordType = selectedRecordType;
    } else if (selectedRecordType) {
      updatedFormData.recordType = selectedRecordType;
    } else if (originalRecordType) {
      updatedFormData.recordType = originalRecordType;
    }

    // Final safety check - ensure record type is preserved
    
    if (selectedRecordType && !updatedFormData.recordType) {
      updatedFormData.recordType = selectedRecordType;
    }
    
    // Clear any residual fields from different record types
    const cleanedFormData = {};
    
    // Only keep fields that are relevant to current record type
    Object.keys(updatedFormData).forEach(key => {
      // Always keep these essential fields
      if (['record', 'title', 'recordType', 'notes'].includes(key)) {
        cleanedFormData[key] = updatedFormData[key];
      }
      // Keep fields that match the current record type's template
      else if (templateFields.some(tf => tf.name === key)) {
        cleanedFormData[key] = updatedFormData[key];
      }
      // Keep properly matched custom fields (now using direct field names)
      else if (unmatchedFields.some(uf => uf.name === key)) {
        cleanedFormData[key] = updatedFormData[key];
      }
    });
    
    // Update form data with cleaned values
    // Skip if preserving stored data
    if (!isPreservingStoredDataRef.current) {
      setFormData(cleanedFormData);
    }
    
    // If this is the initial load for the original record type, update originalFormData with all expanded fields
    if (cleanedFormData.recordType === originalRecordType && detailsToUse) {
      setOriginalFormData(cleanedFormData);
    }
    
    // Set unmatched fields as custom fields - this completely replaces any initial custom fields
    if (unmatchedFields.length > 0) {
      // Clean field names for better display (consistent with main processing function)
      const cleanedCustomFields = unmatchedFields.map(field => {
        let cleanFieldName = field.name;
        
        // Extract base field name from prefixed names
        if (cleanFieldName.includes('_')) {
          const parts = cleanFieldName.split('_');
          if (parts.length === 2) {
            // For patterns like paymentCard_cardNumber, bankAccount_accountNumber
            cleanFieldName = parts[1]; // Take the last part (cardNumber, accountNumber, etc.)
          } else {
            // For more complex patterns, take the last part
            cleanFieldName = parts[parts.length - 1];
          }
        }
        
        return {
          ...field,
          id: field.name, // Keep original name as ID
          label: field.label || (cleanFieldName.charAt(0).toUpperCase() + cleanFieldName.slice(1)),
          cleanFieldName: cleanFieldName,
          isUnmatchedField: true
        };
      });
      
      setDynamicCustomFields(cleanedCustomFields);
    } else {
      setDynamicCustomFields([]);
    }

  };

  // Map existing record values to template fields (legacy function - keeping for compatibility)
  const mapExistingValuesToTemplate = (templateFields) => {
    
    if (!recordDetails || Object.keys(recordDetails).length === 0) {
      return;
    }

    const updatedFormData = { ...formData };
    const unmatchedFields = [];
    const templateFieldTypes = templateFields.map(f => f.name); // Template field types
    const mappedFieldTypes = new Set(); // Track which template field types we've mapped

    
    // Clear existing custom fields first
    setDynamicCustomFields([]);

    // Map top-level fields (title, etc.)
    if (recordDetails.title && templateFieldTypes.includes('title')) {
      updatedFormData.title = recordDetails.title;
      mappedFieldTypes.add('title');
    }

    // Process the fields array from record details
    if (recordDetails.fields && Array.isArray(recordDetails.fields)) {
      
        recordDetails.fields.forEach((field, index) => {
        
        if (!field.type || !field.value || !Array.isArray(field.value) || field.value.length === 0) {
          return;
        }

        const fieldType = field.type;
        const fieldValue = field.value[0]; // Get first value
        const fieldLabel = field.label || null;

        // Handle complex field types
        if (fieldType === 'name' && typeof fieldValue === 'object' && fieldValue !== null) {
          // Map name components to separate template fields
          if (fieldValue.first && templateFields.find(tf => tf.name === 'name_first')) {
            updatedFormData.name_first = fieldValue.first;
            mappedFieldTypes.add('name');
          }
          if (fieldValue.middle && templateFields.find(tf => tf.name === 'name_middle')) {
            updatedFormData.name_middle = fieldValue.middle;
          }
          if (fieldValue.last && templateFields.find(tf => tf.name === 'name_last')) {
            updatedFormData.name_last = fieldValue.last;
          }
        } else if (fieldType === 'phone' && typeof fieldValue === 'object' && fieldValue !== null) {
          // Map phone components to separate template fields
          if (fieldValue.number && templateFields.find(tf => tf.name === 'phone_number')) {
            updatedFormData.phone_number = fieldValue.number;
            mappedFieldTypes.add('phone');
          }
          if (fieldValue.ext && templateFields.find(tf => tf.name === 'phone_ext')) {
            updatedFormData.phone_ext = fieldValue.ext;
          }
          if (fieldValue.type && templateFields.find(tf => tf.name === 'phone_type')) {
            updatedFormData.phone_type = fieldValue.type;
          }
        } else if (fieldType === 'address' && typeof fieldValue === 'object' && fieldValue !== null) {
          // Map address components to separate template fields
          if (fieldValue.street1 && templateFields.find(tf => tf.name === 'address_street1')) {
            updatedFormData.address_street1 = fieldValue.street1;
            mappedFieldTypes.add('address');
          }
          if (fieldValue.street2 && templateFields.find(tf => tf.name === 'address_street2')) {
            updatedFormData.address_street2 = fieldValue.street2;
          }
          if (fieldValue.city && templateFields.find(tf => tf.name === 'address_city')) {
            updatedFormData.address_city = fieldValue.city;
          }
          if (fieldValue.state && templateFields.find(tf => tf.name === 'address_state')) {
            updatedFormData.address_state = fieldValue.state;
          }
          if (fieldValue.zip && templateFields.find(tf => tf.name === 'address_zip')) {
            updatedFormData.address_zip = fieldValue.zip;
          }
          if (fieldValue.country && templateFields.find(tf => tf.name === 'address_country')) {
            updatedFormData.address_country = fieldValue.country;
          }
        } else if (fieldType === 'paymentCard' && typeof fieldValue === 'object' && fieldValue !== null) {
          // Map payment card components to separate template fields
          if (fieldValue.cardNumber && templateFields.find(tf => tf.name === 'paymentCard_cardNumber')) {
            updatedFormData.paymentCard_cardNumber = fieldValue.cardNumber;
            mappedFieldTypes.add('paymentCard');
          }
          if (fieldValue.cardExpirationDate) {
            // Parse MM/YYYY format into separate month and year fields
            const expirationParts = fieldValue.cardExpirationDate.split('/');
            if (expirationParts.length === 2) {
              const [month, year] = expirationParts;
              if (templateFields.find(tf => tf.name === 'paymentCard_cardExpirationMonth')) {
                updatedFormData.paymentCard_cardExpirationMonth = month;
              }
              if (templateFields.find(tf => tf.name === 'paymentCard_cardExpirationYear')) {
                updatedFormData.paymentCard_cardExpirationYear = year;
              }
            } else {
            }
          }
          if (fieldValue.cardSecurityCode && templateFields.find(tf => tf.name === 'paymentCard_cardSecurityCode')) {
            updatedFormData.paymentCard_cardSecurityCode = fieldValue.cardSecurityCode;
          }
        } else if (fieldType === 'addressRef') {
          // Handle address reference field - value comes as array with UID
          const addressUid = Array.isArray(fieldValue) ? fieldValue[0] : fieldValue;
          
          if (addressUid && typeof addressUid === 'string' && templateFields.find(tf => tf.name === 'addressRef')) {
            updatedFormData.addressRef = addressUid; // Store the address UID
            mappedFieldTypes.add('addressRef');
            
            // Resolve the address reference asynchronously
            resolveAndCacheAddress(addressUid);
          }
        } else if (fieldType === 'bankAccount' && typeof fieldValue === 'object' && fieldValue !== null) {
          // Map bank account components to separate template fields
          if (fieldValue.accountNumber && templateFields.find(tf => tf.name === 'bankAccount_accountNumber')) {
            updatedFormData.bankAccount_accountNumber = fieldValue.accountNumber;
            mappedFieldTypes.add('bankAccount');
          }
          if (fieldValue.routingNumber && templateFields.find(tf => tf.name === 'bankAccount_routingNumber')) {
            updatedFormData.bankAccount_routingNumber = fieldValue.routingNumber;
          }
          if (fieldValue.accountType && templateFields.find(tf => tf.name === 'bankAccount_accountType')) {
            updatedFormData.bankAccount_accountType = fieldValue.accountType;
          }
          if (fieldValue.otherType && templateFields.find(tf => tf.name === 'bankAccount_otherType')) {
            updatedFormData.bankAccount_otherType = fieldValue.otherType;
          }
        } else {
          // Handle simple field types
          const templateField = templateFields.find(tf => tf.name === fieldType);
          
          if (templateField && !mappedFieldTypes.has(fieldType)) {
            // Field type matches template - map the value
            const mappedValue = extractFieldValue(field);
            if (mappedValue !== null && mappedValue !== '') {
              updatedFormData[fieldType] = mappedValue;
              mappedFieldTypes.add(fieldType);
            }
          } else if (templateField && mappedFieldTypes.has(fieldType)) {
            // This field type already mapped, but we have another instance
            // Add as custom field with label distinction
            const mappedValue = extractFieldValue(field);
            if (mappedValue !== null && mappedValue !== '') {
              const customFieldKey = fieldLabel ? `${fieldType}_${fieldLabel}` : `${fieldType}_${index}`;
              const customFieldLabel = fieldLabel ? `${fieldType} (${fieldLabel})` : `${fieldType} #${index + 1}`;
              
              unmatchedFields.push({
                name: customFieldKey,
                value: mappedValue,
                label: formatFieldLabel(customFieldLabel),
                isCustom: true,
                originalType: fieldType
              });
              updatedFormData[customFieldKey] = mappedValue;
            }
          } else {
            // Field type doesn't match template - add as custom field
            const mappedValue = extractFieldValue(field);
            if (mappedValue !== null && mappedValue !== '') {
              const customFieldKey = fieldLabel ? `${fieldType}_${fieldLabel}` : fieldType;
              const customFieldLabel = fieldLabel ? `${fieldType} (${fieldLabel})` : fieldType;
              
              unmatchedFields.push({
                name: customFieldKey,
                value: mappedValue,
                label: formatFieldLabel(customFieldLabel),
                isCustom: true,
                originalType: fieldType
              });
              updatedFormData[customFieldKey] = mappedValue;
            }
          }
        }
      });
    }


    // Preserve the currently selected record type (don't override with original record type)
    if (formData.recordType && formData.recordType !== updatedFormData.recordType) {
      updatedFormData.recordType = formData.recordType;
    }

    // Clear any residual fields from different record types
    const cleanedFormData = {};
    
    // Only keep fields that are relevant to current record type
    Object.keys(updatedFormData).forEach(key => {
      // Always keep these essential fields
      if (['record', 'title', 'recordType', 'notes'].includes(key)) {
        cleanedFormData[key] = updatedFormData[key];
      }
      // Keep fields that match the current record type's template
      else if (templateFields.some(tf => tf.name === key)) {
        cleanedFormData[key] = updatedFormData[key];
      }
      // Keep properly matched custom fields (now using direct field names)
      else if (unmatchedFields.some(uf => uf.name === key)) {
        cleanedFormData[key] = updatedFormData[key];
      }
    });
    
    // Update form data with cleaned values
    // Skip if preserving stored data
    if (!isPreservingStoredDataRef.current) {
      setFormData(cleanedFormData);
    }
    
    // If this is the initial load for the original record type, update originalFormData with all expanded fields
    if (cleanedFormData.recordType === originalRecordType && recordDetailsToUse) {
      setOriginalFormData(cleanedFormData);
    }
    
    // Set unmatched fields as custom fields - this completely replaces any initial custom fields
    if (unmatchedFields.length > 0) {
      // Clean field names for better display (same logic as main function)
      const cleanedCustomFields = unmatchedFields.map(field => {
        let cleanFieldName = field.name;
        
        // Extract base field name from prefixed names
        if (cleanFieldName.includes('_')) {
          const parts = cleanFieldName.split('_');
          if (parts.length === 2) {
            // For patterns like paymentCard_cardNumber, bankAccount_accountNumber
            cleanFieldName = parts[1]; // Take the last part (cardNumber, accountNumber, etc.)
          } else {
            // For more complex patterns, take the last part
            cleanFieldName = parts[parts.length - 1];
          }
        }
        
        return {
          ...field,
          id: field.name, // Keep original name as ID
          label: field.label || (cleanFieldName.charAt(0).toUpperCase() + cleanFieldName.slice(1)),
          cleanFieldName: cleanFieldName,
          isUnmatchedField: true
        };
      });
      
      setDynamicCustomFields(cleanedCustomFields);
    } else {
      setDynamicCustomFields([]);
    }

  };

  // Helper function to extract field value based on field type
  const extractFieldValue = (field) => {
    if (!field.value || !Array.isArray(field.value) || field.value.length === 0) {
      return null;
    }

    const value = field.value[0];
    
    switch (field.type) {
      case 'name':
        // Handle name object structure: {first, middle, last}
        if (typeof value === 'object' && value !== null) {
          const nameParts = [];
          if (value.first) nameParts.push(value.first);
          if (value.middle) nameParts.push(value.middle);
          if (value.last) nameParts.push(value.last);
          return nameParts.length > 0 ? nameParts.join(' ') : '';
        }
        return String(value);
        
      case 'host':
        // Handle host object structure: {hostName, port}
        if (typeof value === 'object' && value !== null) {
          const hostParts = [];
          if (value.hostName) hostParts.push(value.hostName);
          if (value.port) hostParts.push(`:${value.port}`);
          return hostParts.join('');
        }
        return String(value);
        
      case 'paymentCard':
        // Handle payment card object structure: {cardNumber, expirationDate, securityCode}
        if (typeof value === 'object' && value !== null) {
          return value.cardNumber ? `****-****-****-${String(value.cardNumber).slice(-4)}` : '';
        }
        return String(value);
        
      case 'bankAccount':
        // Handle bank account object structure
        if (typeof value === 'object' && value !== null) {
          const parts = [];
          if (value.accountNumber) parts.push(`Account: ${value.accountNumber}`);
          if (value.accountType) parts.push(`Type: ${value.accountType}`);
          return parts.length > 0 ? parts.join(' | ') : '';
        }
        return String(value);
        
      case 'address':
        // Handle address object structure
        if (typeof value === 'object' && value !== null) {
          const addressParts = [];
          if (value.street1) addressParts.push(value.street1);
          if (value.street2) addressParts.push(value.street2);
          if (value.city) addressParts.push(value.city);
          if (value.state) addressParts.push(value.state);
          if (value.zip) addressParts.push(value.zip);
          return addressParts.length > 0 ? addressParts.join(', ') : '';
        }
        return String(value);
        
      case 'password':
        // Mask password values
        return value ? '••••••••' : '';
        
      default:
        // For simple field types, return the string value
        return String(value);
    }
  };

  // Helper function to format field labels nicely
  const formatFieldLabel = (label) => {
    return label.charAt(0).toUpperCase() + label.slice(1)
      .replace(/([A-Z])/g, ' $1')
      .replace(/_/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  };

  // Helper function to validate password strength
  const validatePassword = (password) => {
    if (!password || password === '$GEN') {
      return { isValid: true, errors: [] };
    }

    const errors = [];
    
    if (password.length < 20) {
      errors.push('Password must be at least 20 characters long');
    }
    
    if (!/[a-z]/.test(password)) {
      errors.push('Password must contain at least one lowercase letter');
    }
    
    if (!/[A-Z]/.test(password)) {
      errors.push('Password must contain at least one uppercase letter');
    }
    
    if (!/[0-9]/.test(password)) {
      errors.push('Password must contain at least one number');
    }
    
    if (!/[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?~`]/.test(password)) {
      errors.push('Password must contain at least one symbol');
    }
    
    return {
      isValid: errors.length === 0,
      errors: errors
    };
  };

  // Helper function to enhance field labels for better UX
  const enhanceFieldLabel = (fieldType, currentLabel) => {
    const labelMap = {
      'login': 'Username/Login',
      'password': 'Password',
      'url': 'Website URL',
      'email': 'Email Address',
      'phone': 'Phone Number',
      'name': 'Full Name',
      'company': 'Company Name',
      'title': 'Title',
      'notes': 'Notes',
      'note': 'Notes',
      'address': 'Address Information',
      'birthDate': 'Birth Date',
      'expirationDate': 'Expiration Date',
      'paymentCard': 'Payment Card Information',
      'bankAccount': 'Bank Account Information',
      'host': 'Host/Server',
      'securityQuestion': 'Security Question',
      'pinCode': 'PIN Code',
      'oneTimeCode': 'Two-Factor Code',
      'otp': 'One-Time Password',
      'passkey': 'Passkey',
      'keyPair': 'Key Pair',
      'licenseNumber': 'License Number',
      'multiline': 'Text Area',
      'accountNumber': 'Account Number',
      'groupNumber': 'Group Number',
      'addressRef': 'Address',
      'fileRef': 'Files',
      'cardRef': 'Payment Card'
    };
    
    return labelMap[fieldType] || currentLabel;
  };

  // Helper function to get appropriate placeholders for field types
  const getPlaceholderForField = (fieldType, fieldLabel) => {
    const placeholderMap = {
      'login': 'Enter username or email',
      'password': 'Enter password',
      'url': 'https://example.com',
      'email': 'user@example.com',
      'phone': '+1 (555) 123-4567',
      'name': 'First Middle Last',
      'company': 'Company name',
      'title': 'Record title',
      'notes': 'Enter additional notes...',
      'note': 'Enter notes...',
      'address': 'Street, City, State, ZIP',
      'birthDate': 'MM/DD/YYYY',
      'expirationDate': 'MM/DD/YYYY',
      'paymentCard': '•••• •••• •••• 1234',
      'bankAccount': 'Bank account details',
      'host': 'hostname:port',
      'securityQuestion': 'Question and answer',
      'pinCode': 'Enter PIN',
      'oneTimeCode': 'TOTP code',
      'otp': 'One-time password',
      'passkey': 'Passkey information',
      'keyPair': 'Private key',
      'licenseNumber': 'License number',
      'multiline': 'Enter multiple lines of text...',
      'accountNumber': 'Account number',
      'groupNumber': 'Group number'
    };
    
    return placeholderMap[fieldType] || `Enter ${fieldLabel.toLowerCase()}`;
  };

  // Helper function to identify complex field types
  const isComplexFieldType = (fieldType) => {
    const complexTypes = [
      'name', 'paymentCard', 'bankAccount', 'host', 'address', 
      'securityQuestion', 'keyPair', 'phone', 'email'
    ];
    return complexTypes.includes(fieldType);
  };

  // Remove a custom field
  const removeCustomField = (fieldIdentifier) => {
    
    // Remove from dynamic custom fields array - handle both 'name' and 'id' properties
    setDynamicCustomFields(prev => prev.filter(field => 
      (field.name !== fieldIdentifier) && 
      (field.id !== fieldIdentifier)
    ));
    
    // Remove from form data
    setFormData(prev => {
      const newFormData = { ...prev };
      delete newFormData[fieldIdentifier];
      return newFormData;
    });
    
  };

  // Render grouped template fields with sophisticated UI like Keeper vault
  const renderGroupedTemplateFields = (templateFields) => {
    if (!templateFields || templateFields.length === 0) {
      return null;
    }

    // Group fields by their parent type (name, phone) or treat as individual
    const fieldGroups = {};
    const individualFields = [];

    
    templateFields.forEach((field) => {
      if (field.parentType) {
        // This is a complex field component (name_first, phone_number, etc.)
        if (!fieldGroups[field.parentType]) {
          fieldGroups[field.parentType] = [];
        }
        fieldGroups[field.parentType].push(field);
      } else {
        // This is an individual field
        if (field.name === 'addressRef') {
        }
        individualFields.push(field);
      }
    });


    const renderElements = [];

    // Render grouped complex fields
    Object.keys(fieldGroups).forEach((groupType) => {
      const groupFields = fieldGroups[groupType];
      const groupLabel = groupType === 'name' ? 'Name' : 
                        groupType === 'phone' ? 'Phone Number' : 
                        groupType === 'bankAccount' ? 'Bank Account' : 
                        groupType;

      if (groupType === 'name') {
        // Render Name group with First/Middle/Last layout
        const firstField = groupFields.find(f => f.subField === 'first');
        const middleField = groupFields.find(f => f.subField === 'middle');
        const lastField = groupFields.find(f => f.subField === 'last');

        renderElements.push(
          <div key={`group-${groupType}`} style={{ marginBottom: "20px" }}>
            <div style={{ 
              fontSize: "14px", 
              fontWeight: "600", 
              color: "#1A1A1A", 
              marginBottom: "8px" 
            }}>
              {groupLabel}
            </div>
            
            {/* First and Middle Name Row */}
            <div style={{ 
              display: "flex", 
              gap: "12px", 
              marginBottom: "12px" 
            }}>
              {firstField && (
                <div style={{ flex: "1" }}>
                  <label style={{ 
                    display: "block", 
                    marginBottom: "4px", 
                    fontSize: "13px", 
                    fontWeight: "500", 
                    color: "#1A1A1A" 
                  }}>
                    {firstField.label} {firstField.required && <span style={{ color: '#FF5630' }}>*</span>}
                  </label>
                  {renderFormInput(firstField)}
                </div>
              )}
              {middleField && (
                <div style={{ flex: "1" }}>
                  <label style={{ 
                    display: "block", 
                    marginBottom: "4px", 
                    fontSize: "13px", 
                    fontWeight: "500", 
                    color: "#1A1A1A" 
                  }}>
                    {middleField.label}
                  </label>
                  {renderFormInput(middleField)}
                </div>
              )}
            </div>
            
            {/* Last Name Row */}
            {lastField && (
              <div style={{ marginBottom: "12px" }}>
                <label style={{ 
                  display: "block", 
                  marginBottom: "4px", 
                  fontSize: "13px", 
                  fontWeight: "500", 
                  color: "#1A1A1A" 
                }}>
                  {lastField.label} {lastField.required && <span style={{ color: '#FF5630' }}>*</span>}
                </label>
                {renderFormInput(lastField)}
              </div>
            )}
          </div>
        );
      } else if (groupType === 'phone') {
        // Render Phone group with Number/Extension/Type layout
        const numberField = groupFields.find(f => f.subField === 'number');
        const extField = groupFields.find(f => f.subField === 'ext');
        const typeField = groupFields.find(f => f.subField === 'type');

        renderElements.push(
          <div key={`group-${groupType}`} style={{ marginBottom: "20px" }}>
            <div style={{ 
              fontSize: "14px", 
              fontWeight: "600", 
              color: "#1A1A1A", 
              marginBottom: "8px" 
            }}>
              {groupLabel}
            </div>
            
            {/* Phone Number */}
            {numberField && (
              <div style={{ marginBottom: "12px" }}>
                <label style={{ 
                  display: "block", 
                  marginBottom: "4px", 
                  fontSize: "13px", 
                  fontWeight: "500", 
                  color: "#1A1A1A" 
                }}>
                  {numberField.label} {numberField.required && <span style={{ color: '#FF5630' }}>*</span>}
                </label>
                {renderFormInput(numberField)}
              </div>
            )}
            
            {/* Extension and Type Row */}
            <div style={{ 
              display: "flex", 
              gap: "12px", 
              marginBottom: "12px" 
            }}>
              {extField && (
                <div style={{ flex: "1" }}>
                  <label style={{ 
                    display: "block", 
                    marginBottom: "4px", 
                    fontSize: "13px", 
                    fontWeight: "500", 
                    color: "#1A1A1A" 
                  }}>
                    {extField.label}
                  </label>
                  {renderFormInput(extField)}
                </div>
              )}
              {typeField && (
                <div style={{ flex: "1" }}>
                  <label style={{ 
                    display: "block", 
                    marginBottom: "4px", 
                    fontSize: "13px", 
                    fontWeight: "500", 
                    color: "#1A1A1A" 
                  }}>
                    {typeField.label}
                  </label>
                  {renderFormInput(typeField)}
                </div>
              )}
            </div>
          </div>
        );
      } else if (groupType === 'bankAccount') {
        // Render Bank Account group with Account Number/Routing Number/Account Type layout
        const accountNumberField = groupFields.find(f => f.subField === 'accountNumber');
        const routingNumberField = groupFields.find(f => f.subField === 'routingNumber');
        const accountTypeField = groupFields.find(f => f.subField === 'accountType');
        const otherTypeField = groupFields.find(f => f.subField === 'otherType');

        renderElements.push(
          <div key={`group-${groupType}`} style={{ marginBottom: "20px" }}>
            <div style={{ 
              fontSize: "14px", 
              fontWeight: "600", 
              color: "#1A1A1A", 
              marginBottom: "8px" 
            }}>
              {groupLabel}
            </div>
            
            {/* Account Number */}
            {accountNumberField && (
              <div style={{ marginBottom: "12px" }}>
                <label style={{ 
                  display: "block", 
                  marginBottom: "4px", 
                  fontSize: "13px", 
                  fontWeight: "500", 
                  color: "#1A1A1A" 
                }}>
                  {accountNumberField.label} {accountNumberField.required && <span style={{ color: '#FF5630' }}>*</span>}
                </label>
                {renderFormInput(accountNumberField)}
              </div>
            )}
            
            {/* Routing Number and Account Type Row */}
            <div style={{ 
              display: "flex", 
              gap: "12px", 
              marginBottom: "12px" 
            }}>
              {routingNumberField && (
                <div style={{ flex: "1" }}>
                  <label style={{ 
                    display: "block", 
                    marginBottom: "4px", 
                    fontSize: "13px", 
                    fontWeight: "500", 
                    color: "#1A1A1A" 
                  }}>
                    {routingNumberField.label}
                  </label>
                  {renderFormInput(routingNumberField)}
                </div>
              )}
              {accountTypeField && (
                <div style={{ flex: "1" }}>
                  <label style={{ 
                    display: "block", 
                    marginBottom: "4px", 
                    fontSize: "13px", 
                    fontWeight: "500", 
                    color: "#1A1A1A" 
                  }}>
                    {accountTypeField.label}
                  </label>
                  {renderFormInput(accountTypeField)}
                </div>
              )}
            </div>
            
            {/* Other Account Type */}
            {otherTypeField && (
              <div style={{ marginBottom: "12px" }}>
                <label style={{ 
                  display: "block", 
                  marginBottom: "4px", 
                  fontSize: "13px", 
                  fontWeight: "500", 
                  color: "#1A1A1A" 
                }}>
                  {otherTypeField.label}
                </label>
                {renderFormInput(otherTypeField)}
              </div>
            )}
          </div>
        );
      } else {
        // Render other complex field groups
        renderElements.push(
          <div key={`group-${groupType}`} style={{ marginBottom: "20px" }}>
            <div style={{ 
              fontSize: "14px", 
              fontWeight: "600", 
              color: "#1A1A1A", 
              marginBottom: "8px" 
            }}>
              {groupLabel}
            </div>
            {groupFields.map((field) => {
              
              return (
                <div key={field.name} style={{ marginBottom: "12px" }}>
                  <label style={{ 
                    display: "block", 
                    marginBottom: "4px", 
                    fontSize: "13px", 
                    fontWeight: "500", 
                    color: "#1A1A1A" 
                  }}>
                    {field.label} {field.required && <span style={{ color: '#FF5630' }}>*</span>}
                  </label>
                {renderFormInput(field)}
              </div>
            )})}
          </div>
        );
      }
    });

    // Render individual fields
    individualFields.forEach((field) => {
      
      renderElements.push(
        <div key={field.name} style={{ marginBottom: "16px" }}>
          <label style={{ 
            display: "block", 
            marginBottom: "4px", 
            fontSize: "13px", 
            fontWeight: "500", 
            color: "#1A1A1A" 
          }}>
            {field.label} {field.required && <span style={{ color: '#FF5630' }}>*</span>} {field.templateField && <span style={{ color: '#666', fontSize: '11px' }}>(Template)</span>}
          </label>
          {renderFormInput(field)}
        </div>
      );
    });

    return renderElements;
  };

  // Store previous action to detect actual changes
  const [previousAction, setPreviousAction] = useState(null);
  // Flag to prevent reset when loading stored data
  const [isLoadingStoredData, setIsLoadingStoredData] = useState(false);

  // Reset form data when action changes and fetch records/folders if needed
  useEffect(() => {
    
    // Only reset states if this is actually a different action and we're not loading stored data
    const actionActuallyChanged = !previousAction || 
      (selectedAction?.value !== previousAction?.value);
    
    
    if (actionActuallyChanged && !isLoadingStoredData) {
      setFormData({});
      setSelectedRecord(null);
      setRecordSearchTerm("");
      setShowRecordDropdown(false);
      setRecordCurrentPage(1);
      setSelectedFolder(null);
      setFolderSearchTerm("");
      setShowFolderDropdown(false);
      setFolderCurrentPage(1);
      
      // Reset record-update specific states
      setSelectedRecordForUpdate(null);
      setRecordForUpdateSearchTerm("");
      setShowRecordForUpdateDropdown(false);
      setRecordForUpdateCurrentPage(1);
      setRecordDetails({});
      setLoadingRecordDetails(false);
      setDynamicCustomFields([]);
      setManualCustomFields([]);
      setRecordTypeTemplate({});
      setTemplateFields([]);
      setLoadingTemplate(false);
    }
    
    // Update previous action
    setPreviousAction(selectedAction);
    
    // Fetch records when share-record or record-update is selected (but not when loading stored data)
    if (selectedAction && (selectedAction.value === 'share-record' || selectedAction.value === 'record-update') && !isLoadingStoredData) {
      fetchKeeperRecords();
    }
    
    // Fetch record types when record-add or record-update is selected (but not when loading stored data)
    if (selectedAction && (selectedAction.value === 'record-add' || selectedAction.value === 'record-update') && !isLoadingStoredData) {
      fetchRecordTypes();
    }
    
    // Fetch folders when share-folder, record-permission, or pam-action-rotate is selected
    if (selectedAction && (selectedAction.value === 'share-folder' || selectedAction.value === 'record-permission' || selectedAction.value === 'pam-action-rotate')) {
      fetchKeeperFolders();
    }
    
    // Fetch PAM resources when pam-action-rotate is selected
    if (selectedAction && selectedAction.value === 'pam-action-rotate') {
      fetchPamResources();
    }
  }, [selectedAction, isLoadingStoredData]);

  // Auto-dismiss workflow info dialog after 5 seconds
  useEffect(() => {
    if (showWorkflowInfo && issueContext?.hasConfig && !isLoading && !isLoadingStoredData) {
      const timer = setTimeout(() => {
        setShowWorkflowInfo(false);
      }, 5000); // 5 seconds
      
      return () => clearTimeout(timer);
    }
  }, [showWorkflowInfo, issueContext, isLoading, isLoadingStoredData]);

  // Handle form input changes
  const handleInputChange = (fieldName, value) => {
    setFormData(prev => ({
      ...prev,
      [fieldName]: value
    }));
    
    // Special handling for addressRef fields - trigger address resolution
    if (fieldName === 'addressRef' && value) {
      resolveAndCacheAddress(value, true); // Force resolution to ensure UI updates
    }
  };

  // Add manual custom field
  const addManualCustomField = () => {
    const fieldId = `manual_custom_${Date.now()}`;
    const newField = {
      id: fieldId,
      name: '',
      value: '',
      placeholder: 'Enter custom field name'
    };
    setManualCustomFields(prev => [...prev, newField]);
  };

  // Remove manual custom field
  const removeManualCustomField = (fieldId) => {
    setManualCustomFields(prev => prev.filter(field => field.id !== fieldId));
    // Also remove from form data
    setFormData(prev => {
      const newData = { ...prev };
      const fieldToRemove = manualCustomFields.find(field => field.id === fieldId);
      if (fieldToRemove && fieldToRemove.name) {
        delete newData[fieldToRemove.name];
      }
      return newData;
    });
  };

  // Update manual custom field name
  const updateManualCustomFieldName = (fieldId, newName) => {
    setManualCustomFields(prev => 
      prev.map(field => 
        field.id === fieldId ? { ...field, name: newName, placeholder: `Enter value for ${newName || 'custom field'}` } : field
      )
    );
  };


  // Validate required fields
  const validateForm = () => {
    if (!selectedAction?.fields) return true;
    
    // Special handling for share-record action
    if (selectedAction.value === 'share-record') {
      // Check if record is selected
      if (!selectedRecord) {
        return false;
      }
      
      // Check if action is selected
      if (!formData['action'] || formData['action'].trim() === '') {
        return false;
      }
      
      // Check if user/email is entered
      if (!formData['user'] || formData['user'].trim() === '') {
        return false;
      }
      
      return true;
    }
    
    // Special handling for record-update action
    if (selectedAction.value === 'record-update') {
      // Check if record is selected for update
      if (!selectedRecordForUpdate) {
        return false;
      }
      
      // For record-update, only record selection is required
      // All other fields are optional for updates
      return true;
    }
    
    // Special handling for share-folder action
    if (selectedAction.value === 'share-folder') {
      // Check if folder is selected
      if (!selectedFolder) {
        return false;
      }
      
      // Check if action is selected
      if (!formData['action'] || formData['action'].trim() === '') {
        return false;
      }
      
      // Check if user/email is entered
      if (!formData['user'] || formData['user'].trim() === '') {
        return false;
      }
      
      return true;
    }
    
    // Special handling for record-permission action
    if (selectedAction.value === 'record-permission') {
      // Check if folder is selected
      if (!selectedFolder) {
        return false;
      }
      
      // Action field is required
      if (!formData.action || formData.action === '') {
        return false;
      }
      
      // At least one permission flag should be set
      const hasPermissionFlags = formData.can_share || formData.can_edit;
      if (!hasPermissionFlags) {
        return false;
      }
      
      return true;
    }
    
    // Special handling for pam-action-rotate action
    if (selectedAction.value === 'pam-action-rotate') {
      // Target type is required
      if (!formData.target_type || formData.target_type === '') {
        return false;
      }
      
      // Based on target type, either PAM resource or folder must be selected
      if (formData.target_type === 'record') {
        if (!selectedPamResource) {
          return false;
        }
      } else if (formData.target_type === 'folder') {
        if (!selectedFolder) {
          return false;
        }
      }
      
      return true;
    }
    
    // Special handling for record-add action
    if (selectedAction.value === 'record-add') {
      // Get dynamic action with updated record type options
      const dynamicAction = getKeeperActionOptions().find(action => action.value === 'record-add');
      
      // Validate standard fields (including recordType)
      for (let field of (dynamicAction?.fields || [])) {
        if (field.required && (!formData[field.name] || formData[field.name].trim() === '')) {
          return false;
        }
      }
      
      // Validate template fields if they exist
      if (templateFields && templateFields.length > 0) {
        for (let templateField of templateFields) {
          if (templateField.required && (!formData[templateField.name] || formData[templateField.name].toString().trim() === '')) {
            return false;
          }
        }
      }
      
      return true;
    }
    
    // Standard validation for other actions
    for (let field of selectedAction.fields) {
      if (field.required && (!formData[field.name] || formData[field.name].trim() === '')) {
        return false;
      }
    }
    
    return true;
  };

  // Format card number for display (4-4-4-4 format)
  const formatCardNumber = (cardNumber) => {
    if (!cardNumber) return '';
    // Remove all non-digits and format as groups of 4
    const digits = cardNumber.replace(/\D/g, '');
    return digits.replace(/(\d{4})/g, '$1 ').trim();
  };

  // Parse formatted card number back to digits only
  const parseCardNumber = (formatted) => {
    return formatted.replace(/\s/g, '');
  };

  // Render form input based on field type
  const renderFormInput = (field) => {
    let value = formData[field.name] || '';
    
    // Special formatting for card number display
    if (field.name === 'paymentCard_cardNumber') {
      value = formatCardNumber(value);
    }
    
    // For record-update, get the current value from record details to check if field has data
    let currentRecordValue = '';
    if (selectedAction?.value === 'record-update' && recordDetails) {
      currentRecordValue = recordDetails[field.name] || '';
      // Handle special cases for record details field names
      if (field.name === 'email' && !currentRecordValue) {
        currentRecordValue = recordDetails['email.0'] || '';
      }
      if (field.name === 'recordType' && !currentRecordValue) {
        currentRecordValue = recordDetails.record_type || recordDetails.type || '';
      }
    }
    
    // For record-update, show different border color when field has current value (either in form or in record)
    const hasCurrentValue = selectedAction?.value === 'record-update' && (value !== '' || currentRecordValue !== '');
    const borderColor = isFormDisabled ? '#E0E0E0' : 
                       hasCurrentValue ? '#006644' :
                       (field.required && !value && selectedAction?.value !== 'record-update') ? '#FF5630' : '#DFE1E6';

    const baseStyle = {
      width: '100%',
      padding: '8px 12px',
      borderRadius: '4px',
      border: `1px solid ${borderColor}`,
      fontSize: '14px',
      backgroundColor: isFormDisabled ? '#F5F5F5' : hasCurrentValue ? '#F8FFF8' : 'white',
      color: isFormDisabled ? '#999' : '#000',
      cursor: isFormDisabled ? 'not-allowed' : 'text',
      outline: 'none',
      boxSizing: 'border-box'
    };


    switch (field.type) {
      case 'select':
        if (field.name === 'recordType') {
        }
        
        return (
          <select
            value={value}
            disabled={isFormDisabled}
            onChange={(e) => {
              const newValue = e.target.value;
              handleInputChange(field.name, newValue);
              
              // Special handling for recordType field
              if (field.name === 'recordType') {
                
                // Preserve current form data before switching templates
                const currentFormData = { ...formData, recordType: newValue };
                
                // Clear existing template fields first
                setTemplateFields([]);
                setDynamicCustomFields([]);
                
                if (newValue && newValue !== '') {
                  fetchRecordTypeTemplateWithFormMapping(newValue, currentFormData);
                } else {
                  setRecordTypeTemplate({});
                  setTemplateFields([]);
                  setDynamicCustomFields([]);
                }
              }
            }}
            style={baseStyle}
          >
            <option value="">{field.placeholder}</option>
            {field.options?.map(option => {
              // Handle both string options and object options {label, value}
              if (typeof option === 'string') {
                return <option key={option} value={option}>{option}</option>;
              } else if (option && option.value && option.label) {
                return <option key={option.value} value={option.value}>{option.label}</option>;
              }
              return null;
            })}
          </select>
        );
      case 'textarea':
        return (
          <textarea
            value={value}
            disabled={isFormDisabled}
            onChange={(e) => handleInputChange(field.name, e.target.value)}
            placeholder={field.placeholder}
            rows={3}
            style={{...baseStyle, resize: 'vertical', fontFamily: 'inherit'}}
          />
        );
      case 'number':
        return (
          <input
            type="number"
            value={value}
            disabled={isFormDisabled}
            onChange={(e) => handleInputChange(field.name, e.target.value)}
            placeholder={field.placeholder}
            style={baseStyle}
          />
        );
      case 'checkbox':
        return (
          <div style={{ 
            display: 'flex', 
            alignItems: 'flex-start', 
            gap: '10px',
            padding: '8px 12px',
            backgroundColor: isFormDisabled ? '#F9F9F9' : '#FAFBFC',
            borderRadius: '4px',
            border: '1px solid #DFE1E6',
            marginBottom: '8px'
          }}>
            <input
              type="checkbox"
              checked={value === true || value === 'true'}
              disabled={isFormDisabled}
              onChange={(e) => handleInputChange(field.name, e.target.checked)}
              style={{
                cursor: isFormDisabled ? 'not-allowed' : 'pointer',
                marginTop: '2px',
                minWidth: '16px',
                width: '16px',
                height: '16px'
              }}
            />
            <div style={{ flex: 1 }}>
              <div style={{ 
                fontSize: '13px', 
                fontWeight: '500',
                color: isFormDisabled ? '#999' : '#1A1A1A',
                marginBottom: '2px'
              }}>
                {field.label}
              </div>
              {field.description && (
                <div style={{ 
                  fontSize: '11px', 
                  color: isFormDisabled ? '#999' : '#6B778C',
                  lineHeight: '1.3'
                }}>
                  {field.description}
                </div>
              )}
            </div>
          </div>
        );
      case 'folder-select':
        return (
          <div style={{ position: 'relative' }}>
            <select
              value={value}
              disabled={isFormDisabled}
              onChange={(e) => {
                const selectedFolderId = e.target.value;
                handleInputChange(field.name, selectedFolderId);
                
                // Find and set the selected folder object
                const folder = keeperFolders.find(f => f.folder_uid === selectedFolderId);
                if (folder) {
                  setSelectedFolder(folder);
                }
              }}
              style={baseStyle}
            >
              <option value="">{field.placeholder || 'Select shared folder'}</option>
              {keeperFolders
                .filter(folder => folder.shared || (folder.flags && folder.flags.includes('S')))
                .map(folder => (
                <option key={folder.folder_uid} value={folder.folder_uid}>
                  {folder.name || folder.title || `Folder ${folder.folder_uid}`} (Shared)
                </option>
              ))}
            </select>
            
            {loadingFolders && (
              <div style={{
                position: 'absolute',
                right: '12px',
                top: '50%',
                transform: 'translateY(-50%)',
                fontSize: '11px',
                color: '#0066CC'
              }}>
                Loading...
              </div>
            )}
            
              {!loadingFolders && getFilteredFolders().length === 0 && (
                <div style={{
                  fontSize: '11px',
                  color: '#FF5630',
                  marginTop: '4px'
                }}>
                  {keeperFolders.length === 0 
                    ? 'No folders found.' 
                    : 'No shared folders found. Only folders with "S" flag (shared folders) are available for record-permission commands.'
                  }
                </div>
              )}
          </div>
        );
      case 'password':
        // Special handling for PIN code fields with show/hide toggle
        if (field.name === 'pinCode') {
          return (
            <div style={{ position: 'relative' }}>
              <input
                type={showPinCode ? 'text' : 'password'}
                value={value}
                disabled={isFormDisabled}
                onChange={(e) => handleInputChange(field.name, e.target.value)}
                placeholder={field.placeholder}
                style={{
                  ...baseStyle,
                  paddingRight: '60px' // Add space for the Show/Hide button
                }}
              />
              <button
                type="button"
                onClick={() => setShowPinCode(!showPinCode)}
                onMouseEnter={(e) => {
                  e.target.style.background = '#e6f2ff';
                  e.target.style.borderColor = '#0066cc';
                }}
                onMouseLeave={(e) => {
                  e.target.style.background = '#f4f5f7';
                  e.target.style.borderColor = '#ddd';
                }}
                style={{
                  position: 'absolute',
                  right: '8px',
                  top: '50%',
                  transform: 'translateY(-50%)',
                  background: '#f4f5f7',
                  border: '1px solid #ddd',
                  cursor: 'pointer',
                  padding: '4px 8px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  borderRadius: '4px',
                  fontSize: '11px',
                  height: '28px',
                  fontWeight: '500',
                  color: '#6B778C',
                  transition: 'all 0.2s ease'
                }}
                title={showPinCode ? 'Hide PIN' : 'Show PIN'}
              >
                {showPinCode ? 'Hide' : 'Show'}
              </button>
            </div>
          );
        }
        // Regular password field
        const passwordValidation = validatePassword(value);
        const hasValidationErrors = !passwordValidation.isValid && value && value !== '$GEN';
        
        return (
          <div>
            <input
              type="password"
              value={value}
              disabled={isFormDisabled}
              onChange={(e) => handleInputChange(field.name, e.target.value)}
              placeholder={field.placeholder || "Password or $GEN"}
              style={{
                ...baseStyle,
                borderColor: hasValidationErrors ? '#FF5630' : baseStyle.borderColor
              }}
            />
            <div style={{ 
              fontSize: "11px", 
              color: "#1A1A1A", 
              marginTop: "4px",
              fontStyle: "italic"
            }}>
              Enter your own password or type <strong>$GEN</strong> for automatic password generation
            </div>
            {hasValidationErrors && (
              <div style={{ 
                fontSize: "11px", 
                color: "#FF5630", 
                marginTop: "4px",
                fontWeight: "500"
              }}>
                Password requirements:
                <ul style={{ margin: "2px 0 0 16px", padding: 0 }}>
                  {passwordValidation.errors.map((error, index) => (
                    <li key={index} style={{ marginBottom: "2px" }}>{error}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        );
      case 'addressRef':
        // Special handling for address reference fields
        const addressUid = value;
        const displayValue = addressUid ? getAddressDisplayValue(addressUid) : field.placeholder || 'Select or add address...';
        const isLoading = addressUid && loadingAddresses.has(addressUid);
        
        return (
          <div style={{ position: 'relative' }}>
            <div
              style={{
                ...baseStyle,
                cursor: isFormDisabled ? 'not-allowed' : 'pointer',
                backgroundColor: isFormDisabled ? '#F5F5F5' : hasCurrentValue ? '#F8FFF8' : 'white',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                minHeight: '42px'
              }}
              onClick={() => {
                if (!isFormDisabled) {
                  if (!showAddressDropdown) {
                    // Fetch address records when opening dropdown
                    fetchAddressRecords();
                  }
                  setShowAddressDropdown(!showAddressDropdown);
                }
              }}
            >
              <span
                style={{
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                  color: addressUid ? '#000' : '#999',
                  fontSize: '14px'
                }}
              >
                {isLoading ? 'Loading address...' : displayValue}
              </span>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0 }}>
                {addressUid && (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      if (!isFormDisabled) {
                        handleInputChange(field.name, '');
                        // Clear from resolved addresses cache
                        setResolvedAddresses(prev => {
                          const updated = { ...prev };
                          delete updated[addressUid];
                          return updated;
                        });
                      }
                    }}
                    style={{
                      background: 'none',
                      border: 'none',
                      cursor: 'pointer',
                      padding: '4px',
                      borderRadius: '50%',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      color: '#6B778C',
                      fontSize: '16px'
                    }}
                    title="Remove address"
                  >
                    ×
                  </button>
                )}
                <span
                  style={{
                    color: '#6B778C',
                    fontSize: '12px',
                    cursor: 'pointer'
                  }}
                >
                  ▼
                </span>
              </div>
            </div>
            
            {/* Address Dropdown */}
            {showAddressDropdown && !isFormDisabled && (
              <div
                style={{
                  position: 'absolute',
                  top: '100%',
                  left: 0,
                  right: 0,
                  backgroundColor: 'white',
                  border: '1px solid #DFE1E6',
                  borderRadius: '4px',
                  boxShadow: '0 4px 8px rgba(0,0,0,0.1)',
                  zIndex: 1000,
                  marginTop: '2px',
                  maxHeight: '300px',
                  overflowY: 'auto'
                }}
              >
                {loadingAddressRecords ? (
                  <div style={{ padding: '12px', textAlign: 'center', color: '#6B778C', fontSize: '13px' }}>
                    Loading addresses...
                  </div>
                ) : (
                  <>
                    {/* Current Address (if selected) */}
                    {addressUid && (
                      <div
                        style={{
                          padding: '12px',
                          borderBottom: '1px solid #F4F5F7',
                          cursor: 'pointer',
                          backgroundColor: 'white'
                        }}
                        onClick={() => {
                          setShowAddressDropdown(false);
                          // Keep current address selected
                        }}
                        onMouseEnter={(e) => { e.target.style.backgroundColor = '#F4F5F7'; }}
                        onMouseLeave={(e) => { e.target.style.backgroundColor = 'white'; }}
                      >
                        <div style={{ fontWeight: '500', fontSize: '13px', color: '#1A1A1A', marginBottom: '4px' }}>
                          Current Address
                        </div>
                        <div style={{ fontSize: '12px', color: '#6B778C', wordBreak: 'break-word' }}>
                          {displayValue}
                        </div>
                      </div>
                    )}

                    {/* Existing Address Records */}
                    {addressRecords.length > 0 && (
                      <>
                        <div style={{ 
                          padding: '8px 12px', 
                          backgroundColor: '#F4F5F7', 
                          fontSize: '11px', 
                          fontWeight: '600', 
                          color: '#6B778C',
                          textTransform: 'uppercase',
                          letterSpacing: '0.5px'
                        }}>
                          Existing Addresses ({addressRecords.length})
                        </div>
                        {addressRecords.map((record) => {
                          // Build address display from record fields
                          const addressParts = [];
                          if (record.fields) {
                            record.fields.forEach(field => {
                              if (field.type === 'address' && field.value && Array.isArray(field.value) && field.value.length > 0) {
                                const addr = field.value[0];
                                if (addr.street1) addressParts.push(addr.street1);
                                if (addr.street2) addressParts.push(addr.street2);
                                if (addr.city) addressParts.push(addr.city);
                                if (addr.state) addressParts.push(addr.state);
                                if (addr.zip) addressParts.push(addr.zip);
                                if (addr.country) addressParts.push(addr.country);
                              }
                            });
                          }
                          const fullAddress = addressParts.join(', ');
                          const displayText = fullAddress || record.title || record.record_uid || 'Address Record';

                          return (
                            <div
                              key={record.record_uid}
                              style={{
                                padding: '12px',
                                cursor: 'pointer',
                                backgroundColor: 'white',
                                borderBottom: '1px solid #F4F5F7'
                              }}
                              onClick={() => {
                                handleInputChange('addressRef', record.record_uid);
                                setShowAddressDropdown(false);
                              }}
                              onMouseEnter={(e) => { e.target.style.backgroundColor = '#F4F5F7'; }}
                              onMouseLeave={(e) => { e.target.style.backgroundColor = 'white'; }}
                            >
                              <div style={{ fontWeight: '500', fontSize: '13px', color: '#1A1A1A', marginBottom: '4px' }}>
                                {record.title || 'Address Record'}
                              </div>
                              <div style={{ fontSize: '12px', color: '#6B778C', wordBreak: 'break-word' }}>
                                {displayText}
                              </div>
                              <div style={{ fontSize: '11px', color: '#999', marginTop: '2px' }}>
                                ID: {record.record_uid}
                              </div>
                            </div>
                          );
                        })}
                      </>
                    )}

                    {/* New Address Option */}
                    <div
                      style={{
                        padding: '12px',
                        cursor: 'pointer',
                        backgroundColor: 'white',
                        color: '#0052CC',
                        fontSize: '13px',
                        fontWeight: '500',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '8px',
                        borderTop: addressRecords.length > 0 ? '1px solid #F4F5F7' : 'none'
                      }}
                      onClick={() => {
                        handleNewAddress();
                      }}
                      onMouseEnter={(e) => { e.target.style.backgroundColor = '#F4F5F7'; }}
                      onMouseLeave={(e) => { e.target.style.backgroundColor = 'white'; }}
                    >
                      <span style={{ fontSize: '16px' }}>+</span>
                      New Address
                    </div>
                  </>
                )}
              </div>
            )}
            
            {/* Click outside to close dropdown */}
            {showAddressDropdown && (
              <div
                style={{
                  position: 'fixed',
                  top: 0,
                  left: 0,
                  right: 0,
                  bottom: 0,
                  zIndex: 999
                }}
                onClick={() => setShowAddressDropdown(false)}
              />
            )}
          </div>
        );
      case 'fileRef':
        // Special handling for file reference fields
        const fileUid = value;
        const fileDisplayValue = fileUid ? `File: ${fileUid}` : field.placeholder || 'Select files...';
        
        return (
          <div style={{ position: 'relative' }}>
            <div
              style={{
                ...baseStyle,
                cursor: isFormDisabled ? 'not-allowed' : 'pointer',
                backgroundColor: isFormDisabled ? '#F5F5F5' : hasCurrentValue ? '#F8FFF8' : 'white',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                minHeight: '42px'
              }}
              onClick={() => {
                if (!isFormDisabled) {
                  alert('File selection functionality will be implemented soon');
                }
              }}
            >
              <span
                style={{
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                  color: fileUid ? '#000' : '#999',
                  flex: 1
                }}
              >
                {fileDisplayValue}
              </span>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0 }}>
                <span style={{ fontSize: '12px', color: '#6B778C' }}>FOLDER</span>
              </div>
            </div>
          </div>
        );
      case 'cardRef':
        // Special handling for payment card reference fields
        const cardUid = value;
        const cardDisplayValue = cardUid ? `Card: ${cardUid}` : field.placeholder || 'Select payment card...';
        
        return (
          <div style={{ position: 'relative' }}>
            <div
              style={{
                ...baseStyle,
                cursor: isFormDisabled ? 'not-allowed' : 'pointer',
                backgroundColor: isFormDisabled ? '#F5F5F5' : hasCurrentValue ? '#F8FFF8' : 'white',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                minHeight: '42px'
              }}
              onClick={() => {
                if (!isFormDisabled) {
                  alert('Payment card selection functionality will be implemented soon');
                }
              }}
            >
              <span
                style={{
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                  color: cardUid ? '#000' : '#999',
                  flex: 1
                }}
              >
                {cardDisplayValue}
              </span>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0 }}>
                <span style={{ fontSize: '12px', color: '#6B778C' }}>CARD</span>
              </div>
            </div>
          </div>
        );
      default:
        // Special handling for card number formatting
        if (field.name === 'paymentCard_cardNumber') {
          return (
            <input
              type="text"
              value={value} // Already formatted by renderFormInput
              disabled={isFormDisabled}
              onChange={(e) => {
                // Parse formatted input and store digits only
                const digitsOnly = parseCardNumber(e.target.value);
                handleInputChange(field.name, digitsOnly);
              }}
              placeholder="•••• •••• •••• 1234"
              maxLength={19} // 16 digits + 3 spaces
              style={baseStyle}
            />
          );
        }
        
        // Use getInputTypeForField to map field types to proper HTML input types
        const inputType = getInputTypeForField(field.type);
        
        // Special handling for password-like fields to show the $GEN note
        if (inputType === 'password') {
          const passwordValidation = validatePassword(value);
          const hasValidationErrors = !passwordValidation.isValid && value && value !== '$GEN';
          
          return (
            <div>
              <input
                type="password"
                value={value}
                disabled={isFormDisabled}
                onChange={(e) => handleInputChange(field.name, e.target.value)}
                placeholder={field.placeholder || "Password or $GEN"}
                style={{
                  ...baseStyle,
                  borderColor: hasValidationErrors ? '#FF5630' : baseStyle.borderColor
                }}
              />
              <div style={{ 
                fontSize: "11px", 
                color: "#1A1A1A", 
                marginTop: "4px",
                fontStyle: "italic"
              }}>
                Enter your own password or type <strong>$GEN</strong> for automatic password generation
              </div>
              {hasValidationErrors && (
                <div style={{ 
                  fontSize: "11px", 
                  color: "#FF5630", 
                  marginTop: "4px",
                  fontWeight: "500"
                }}>
                  Password requirements:
                  <ul style={{ margin: "2px 0 0 16px", padding: 0 }}>
                    {passwordValidation.errors.map((error, index) => (
                      <li key={index} style={{ marginBottom: "2px" }}>{error}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          );
        }
        
        return (
          <input
            type={inputType}
            value={value}
            disabled={isFormDisabled}
            onChange={(e) => handleInputChange(field.name, e.target.value)}
            placeholder={field.placeholder}
            style={baseStyle}
          />
        );
    }
  };

  useEffect(() => {
    // Load issue context
    setIsLoading(true);
    invoke("getIssueContext")
      .then((context) => {
        
        setIssueContext(context);
        
        // Clear any previous stored data to ensure fresh start for new ticket
        setStoredRequestData(null);
        setHasStoredData(false);
        
        // Activate Keeper panel for all users on this issue
        if (context.issueKey) {
          invoke("activateKeeperPanel", { issueKey: context.issueKey })
            .then((result) => {
            })
            .catch((error) => {
              // Log error but don't show to user as this is not critical
              const errorMessage = handleApiError(error, "Failed to activate Keeper panel");
              console.error(errorMessage);
            });
        }
        
        // Check user role and load stored data after context is loaded
        if (context && context.issueKey) {
          checkUserRoleAndLoadData(context).finally(() => {
            // Only set loading to false after admin role check is complete
            setIsLoading(false);
          });
        } else {
          // If no context or issueKey, set loading to false immediately
          setIsLoading(false);
        }
      })
      .catch((error) => {
        const errorMessage = handleApiError(error, "Failed to load issue context");
        setLastResult({ 
          success: false, 
          message: errorMessage
        });
        setIsLoading(false);
      });
  }, []);

  const executeKeeperAction = async () => {
    if (!issueContext?.issueKey) {
      setLastResult({ 
        success: false, 
        message: "Issue context not loaded. Please refresh the page." 
      });
      return;
    }

    if (!selectedAction?.value) {
      setLastResult({ 
        success: false, 
        message: "Please select an action from the dropdown" 
      });
      return;
    }

    if (!validateForm()) {
      setLastResult({ 
        success: false, 
        message: "Please fill in all required fields (marked with red borders)" 
      });
      return;
    }

    setIsExecuting(true);
    setLastResult(null);

    try {
      
      // Prepare final parameters for special actions
      let finalParameters = { ...formData };
      
      if (selectedAction.value === 'share-record' && selectedRecord) {
        // Ensure record field is populated with selected record UID
        finalParameters.record = selectedRecord.record_uid;
        // User/email and action fields are already in formData from manual input
        
      }
      
      if (selectedAction.value === 'record-update' && selectedRecordForUpdate) {
        // Ensure record field is populated with selected record UID for update
        finalParameters.record = selectedRecordForUpdate.record_uid;
        // All other fields from formData contain the updated values
        
        // Special handling for password field - don't send masked password
        if (finalParameters.password === '••••••••') {
          delete finalParameters.password; // Don't send masked password back
        }
      }
      
      if (selectedAction.value === 'share-folder' && selectedFolder) {
        // Ensure folder field is populated with selected folder UID
        finalParameters.folder = selectedFolder.uid || selectedFolder.path || selectedFolder.name;
        // User/email field is already in formData from manual input
        
      }
      
      if (selectedAction.value === 'record-permission' && selectedFolder) {
        // For record-permission command, format follows CLI pattern:
        // record-permission <folder_uid> --action <grant|revoke> [--user <email>] [--can-share] [--can-edit] [--recursive] [--force] [--dry-run]
        
        // Build the CLI command format
        let commandParts = [
          'record-permission',
          selectedFolder.folder_uid || selectedFolder.uid || selectedFolder.path || selectedFolder.name
        ];
        
        // Add required action
        if (finalParameters.action) {
          commandParts.push('--action', finalParameters.action);
        }
        
        // Note: No user email needed - record-permission applies to all users in the shared folder
        
        // Add permission flags
        if (finalParameters.can_share) commandParts.push('--can-share');
        if (finalParameters.can_edit) commandParts.push('--can-edit');
        if (finalParameters.recursive) commandParts.push('--recursive');
        if (finalParameters.dry_run) commandParts.push('--dry-run');
        
        // Always add --force flag for API execution (no interactive prompts possible)
        commandParts.push('--force');
        
        // Replace parameters with the properly formatted CLI command
        finalParameters = {
          cliCommand: commandParts.join(' ')
        };
      }
      
      if (selectedAction.value === 'pam-action-rotate') {
        // For pam action rotate command, format follows CLI pattern:
        // pam action rotate --record-uid <record_uid> [--dry-run] OR
        // pam action rotate --folder <folder_uid> [--dry-run]
        
        // Build the CLI command format
        let commandParts = ['pam', 'action', 'rotate'];
        
        // Add target based on selection type
        if (finalParameters.target_type === 'record' && selectedPamResource) {
          commandParts.push('--record-uid', selectedPamResource.record_uid);
        } else if (finalParameters.target_type === 'folder' && selectedFolder) {
          commandParts.push('--folder', selectedFolder.folder_uid || selectedFolder.uid || selectedFolder.path || selectedFolder.name);
        }
        
        // Add optional flags
        if (finalParameters.dry_run) commandParts.push('--dry-run');
        
        // Replace parameters with the properly formatted CLI command
        finalParameters = {
          cliCommand: commandParts.join(' ')
        };
      }
      
      // Handle address creation before executing the main action
      let realAddressUid = null;
      let addressCreated = false;
      
      // Check if we need to create a new address from modal data
      if (finalParameters.addressRef && finalParameters.addressRef.startsWith('temp_addr_')) {
        // This is a temporary address from the old system - handle it
        const tempAddressUid = finalParameters.addressRef;
        const tempAddressData = resolvedAddresses[tempAddressUid];
        
        if (tempAddressData && tempAddressData.isTemporary && tempAddressData.tempData) {
          try {
            
            // Prepare address data for API call
            const addressData = {
              title: tempAddressData.tempData.title,
              fields: [
                {
                  type: 'address',
                  value: [{
                    street1: tempAddressData.tempData.street1 || '',
                    street2: tempAddressData.tempData.street2 || '',
                    city: tempAddressData.tempData.city || '',
                    state: tempAddressData.tempData.state || '',
                    zip: tempAddressData.tempData.zip || '',
                    country: tempAddressData.tempData.country || ''
                  }]
                }
              ]
            };

            // Add notes if provided
            if (tempAddressData.tempData.notes) {
              addressData.fields.push({
                type: 'text',
                value: tempAddressData.tempData.notes
              });
            }

            // Create the address record in Keeper using executeKeeperAction
            const addressResult = await invoke("executeKeeperAction", {
              issueKey: issueContext.issueKey,
              command: "record-add",
              commandDescription: "Create address record",
              parameters: {
                recordType: "address",
                title: tempAddressData.tempData.title,
                skipComment: true, // Don't create comment for reference records
                ...addressData.fields.reduce((acc, field) => {
                  if (field.type === 'address' && field.value && Array.isArray(field.value) && field.value.length > 0) {
                    const addr = field.value[0];
                    if (addr.street1) acc.street1 = addr.street1;
                    if (addr.street2) acc.street2 = addr.street2;
                    if (addr.city) acc.city = addr.city;
                    if (addr.state) acc.state = addr.state;
                    if (addr.zip) acc.zip = addr.zip;
                    if (addr.country) acc.country = addr.country;
                  } else if (field.type === 'text' && field.value) {
                    acc.notes = field.value;
                  }
                  return acc;
                }, {}),
                notes: tempAddressData.tempData.notes || ''
              }
            });

            if (addressResult && addressResult.record_uid) {
              realAddressUid = addressResult.record_uid;
              addressCreated = true;
              
              // Update the parameters to use the real address UID
              finalParameters.addressRef = realAddressUid;
              
              // Update the resolved addresses cache
              setResolvedAddresses(prev => ({
                ...prev,
                [realAddressUid]: {
                  record_uid: realAddressUid,
                  type: 'address',
                  title: tempAddressData.tempData.title,
                  fields: addressData.fields
                },
                // Remove the temporary address
                [tempAddressUid]: undefined
              }));
              
            } else {
              throw new Error("Failed to create address record from temp data");
            }
          } catch (error) {
            const errorMessage = handleApiError(error, "Failed to create address record");
            setLastResult({ 
              success: false, 
              message: errorMessage
            });
            setIsExecuting(false);
            return;
          }
        }
      } else if (newAddressFormData && newAddressFormData.title && Object.keys(newAddressFormData).length > 1) {
        // This is a new address from the modal - create it
        try {
          
          // Prepare address data for API call
          const addressData = {
            title: newAddressFormData.title,
            fields: [
              {
                type: 'address',
                value: [{
                  street1: newAddressFormData.street1 || '',
                  street2: newAddressFormData.street2 || '',
                  city: newAddressFormData.city || '',
                  state: newAddressFormData.state || '',
                  zip: newAddressFormData.zip || '',
                  country: newAddressFormData.country || ''
                }]
              }
            ]
          };

          // Add notes if provided
          if (newAddressFormData.notes) {
            addressData.fields.push({
              type: 'text',
              value: newAddressFormData.notes
            });
          }

          // Create the address record in Keeper using executeKeeperAction
          const addressResult = await invoke("executeKeeperAction", {
            issueKey: issueContext.issueKey,
            command: "record-add",
            commandDescription: "Create address record",
            parameters: {
              recordType: "address",
              title: newAddressFormData.title,
              skipComment: true, // Don't create comment for reference records
              street1: newAddressFormData.street1 || '',
              street2: newAddressFormData.street2 || '',
              city: newAddressFormData.city || '',
              state: newAddressFormData.state || '',
              zip: newAddressFormData.zip || '',
              country: newAddressFormData.country || '',
              notes: newAddressFormData.notes || ''
            }
          });

          if (addressResult && addressResult.record_uid) {
            realAddressUid = addressResult.record_uid;
            addressCreated = true;
            
            // Update the parameters to use the real address UID
            finalParameters.addressRef = realAddressUid;
            
            // Update the resolved addresses cache
            setResolvedAddresses(prev => ({
              ...prev,
              [realAddressUid]: {
                record_uid: realAddressUid,
                type: 'address',
                title: newAddressFormData.title,
                fields: addressData.fields
              }
            }));
            
            
            // Clear the modal data since address has been created
            setNewAddressFormData({});
            setShowNewAddressModal(false);
          } else {
            throw new Error("Failed to create address record from modal data");
          }
        } catch (error) {
          const errorMessage = handleApiError(error, "Failed to create address record");
          setLastResult({ 
            success: false, 
            message: errorMessage
          });
          setIsExecuting(false);
          return;
        }
      }
      
      const result = await invoke("executeKeeperAction", {
        issueKey: issueContext.issueKey,
        command: selectedAction.value,
        commandDescription: selectedAction.description,
        parameters: finalParameters
      });
      
      
      // Create success message that includes address creation info if applicable
      let successMessage = result.message;
      if (realAddressUid) {
        successMessage = ` Address record created successfully (${realAddressUid})\n\n${result.message}`;
      }
      
      setLastResult({ success: true, message: successMessage });

      // Clear stored request data since it's been approved and executed
      setStoredRequestData(null);
      setHasStoredData(false);

      // Clear and disable form after successful execution
      setSelectedAction(null);
      setFormData({});
      setSearchTerm("");
      setShowDropdown(false);
      setIsFormDisabled(true);

      // Re-enable form after 3 seconds
      setTimeout(() => {
        setIsFormDisabled(false);
      }, 3000);

    } catch (error) {
      
      // Handle error
      let errorMessage = handleApiError(error, "An unknown error occurred");
      
      // PAM Configuration error check
      if (selectedAction.value === 'pam-action-rotate' && 
          (errorMessage.includes('PAM Configuration') && errorMessage.includes('is not available'))) {
        errorMessage = `PAM Configuration Error: No PAM Configuration is available. Please:\n\n` +
                      `1. Create a PAM Configuration in Keeper Vault:\n` +
                      `   - Go to Secrets Manager > PAM Configurations\n` +
                      `   - Click "New Configuration"\n` +
                      `   - Configure Gateway and environment settings\n\n` +
                      `2. Enable Rotation feature in PAM Settings\n\n` +
                      `3. Create records with PAM types (pamMachine, pamUser, pamDatabase)\n\n` +
                      `4. Verify proper access permissions to the PAM Configuration\n\n` +
                      `Note: PAM resources are regular Keeper records with specific types (pamMachine, pamUser, etc.).\n\n` +
                      `For detailed setup instructions, see: https://docs.keeper.io/en/keeperpam/privileged-access-manager/getting-started/pam-configuration`;
      }
      
      setLastResult({ 
        success: false, 
        message: errorMessage
      });
    } finally {
      setIsExecuting(false);
    }
  };

  // Handle request rejection
  const handleRejectRequest = async () => {
    if (!rejectionReason.trim()) {
      alert('Please provide a reason for rejection.');
      return;
    }

    if (!issueContext?.issueKey) {
      alert('Issue context not loaded. Please refresh the page.');
      return;
    }

    setIsRejecting(true);
    setRejectionResult(null);

    try {
      // Update the JIRA ticket with rejection comment
      const result = await invoke("rejectKeeperRequest", {
        issueKey: issueContext.issueKey,
        rejectionReason: rejectionReason.trim()
      });

      setRejectionResult({ 
        success: true, 
        message: "Request has been rejected and the ticket has been updated with the rejection reason." 
      });

      // Clear the form and stored data
      setRejectionReason("");
      setShowRejectionForm(false);
      
      // Clear stored request data since it's been rejected
      setStoredRequestData(null);
      setHasStoredData(false);
      
      // Reset form to clean state for next request
      setSelectedAction(null);
      setFormData({});

    } catch (error) {
      // Handle error
      const errorMessage = handleApiError(error, "An error occurred while rejecting the request.");
      
      setRejectionResult({ 
        success: false, 
        message: errorMessage
      });
    } finally {
      setIsRejecting(false);
    }
  };

  // Handle cancel rejection
  const handleCancelRejection = () => {
    setShowRejectionForm(false);
    setRejectionReason("");
    setRejectionResult(null);
  };

  if (isLoading) {
    return (
      <div
        style={{
          fontFamily: "Inter, Arial, sans-serif",
          padding: "16px",
          textAlign: "center",
        }}
      >
        <Spinner size="medium" />
        <p style={{ marginTop: "12px", color: "#6B778C" }}>Loading...</p>
      </div>
    );
  }

  if (!issueContext) {
    return (
      <div
        style={{
          fontFamily: "Inter, Arial, sans-serif",
          padding: "16px",
        }}
      >
        <SectionMessage appearance="error" title="Error">
          Failed to load issue context. Please refresh the page.
        </SectionMessage>
      </div>
    );
  }

  return (
    <div
      style={{
        fontFamily: "Inter, Arial, sans-serif",
        padding: "16px",
        backgroundColor: "#F7F7FA",
        minHeight: (showDropdown || showRecordDropdown || showFolderDropdown || showRecordForUpdateDropdown || showPamResourceDropdown) 
          ? "max(100vh, 700px)" 
          : selectedAction 
            ? "100vh" 
            : "auto",
        boxSizing: "border-box",
        transition: "min-height 0.3s ease-in-out"
      }}
    >
      <div
        style={{
          backgroundColor: "#FFFFFF",
          borderRadius: "8px",
          padding: "16px",
          boxShadow: "0 1px 3px rgba(0,0,0,0.1)",
          minHeight: (showDropdown || showRecordDropdown || showFolderDropdown || showRecordForUpdateDropdown || showPamResourceDropdown) 
            ? "600px" 
            : selectedAction 
              ? "400px" 
              : "auto",
          position: "relative",
          transition: "min-height 0.3s ease-in-out"
        }}
      >
        {/* Header */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            marginBottom: "12px",
            gap: "8px",
          }}
        >
          <LockIcon size="medium" primaryColor="#FFD700" />
          <h3
            style={{
              margin: 0,
              fontWeight: "600",
              color: "#1A1A1A",
            }}
          >
            Keeper Integration Hub
          </h3>
        </div>


        {/* Configuration Status */}
        {!issueContext.hasConfig && (
          <SectionMessage appearance="warning" title="Configuration Required">
            Keeper integration hub is not configured. Please go to the Keeper global
            page to set up the integration hub.
          </SectionMessage>
        )}

        {/* Action Selection and Approval */}
        {issueContext.hasConfig && (
          <>
            {/* Action Dropdown */}
            <div style={{ marginBottom: "12px" }}>
              <label
                style={{
                  display: "block",
                  marginBottom: "8px",
                  fontWeight: "600",
                  fontSize: "14px",
                  color: "#1A1A1A",
                }}
              >
                Select Keeper Action:
              </label>
              
              {/* Dropdown Container */}
              <div style={{ position: "relative", zIndex: 1001 }}>
                {/* Search Input */}
                <input
                id="keeper-action-input"
                type="text"
                disabled={isFormDisabled}
                placeholder={
                  isFormDisabled ? "Form disabled after successful execution..." :
                  showDropdown ? "Type to search actions..." : 
                  (selectedAction ? selectedAction.label : "Click to select action...")
                }
                value={showDropdown ? searchTerm : (selectedAction ? selectedAction.label : "")}
                onChange={(e) => {
                  if (!isFormDisabled) {
                    setSearchTerm(e.target.value);
                    setShowDropdown(true);
                  }
                }}
                onClick={() => {
                  if (!isFormDisabled) {
                    setShowDropdown(!showDropdown);
                  }
                }}
                onFocus={(e) => {
                  if (!isFormDisabled) {
                    setSearchTerm(""); // Clear search when focused to make searching obvious
                    setShowDropdown(true);
                  }
                }}
                style={{
                  width: "100%",
                  padding: "8px 40px 8px 12px",
                  borderRadius: "6px",
                  border: isFormDisabled ? "2px solid #E0E0E0" : (showDropdown ? "2px solid #0066CC" : "2px solid #DFE1E6"),
                  fontSize: "14px",
                  backgroundColor: isFormDisabled ? "#F5F5F5" : "white",
                  color: isFormDisabled ? "#999" : "#000",
                  outline: "none",
                  cursor: isFormDisabled ? "not-allowed" : "pointer",
                  boxSizing: "border-box",
                  transition: "border-color 0.2s ease, background-color 0.2s ease"
                }}
              />
              
              {/* Dropdown Arrow */}
              <div
                onClick={() => {
                  if (!isFormDisabled) {
                    setShowDropdown(!showDropdown);
                  }
                }}
                style={{
                  position: "absolute",
                  right: "12px",
                  top: "50%",
                  transform: "translateY(-50%)",
                  cursor: isFormDisabled ? "not-allowed" : "pointer",
                  fontSize: "16px",
                  color: isFormDisabled ? "#CCC" : "#666",
                  userSelect: "none"
                }}
              >
                ▼
              </div>

              {/* Dropdown Menu */}
              {showDropdown && !isFormDisabled && (
                <div
                  style={{
                    position: "absolute",
                    top: "100%",
                    left: "0",
                    right: "0",
                    backgroundColor: "white",
                    border: "2px solid #DFE1E6",
                    borderTop: "none",
                    borderRadius: "0 0 6px 6px",
                    maxHeight: "320px",
                    overflowY: "auto",
                    zIndex: 1000,
                    boxShadow: "0 8px 24px rgba(0,0,0,0.2)",
                    boxSizing: "border-box"
                  }}
                >
                  {/* Search Hint */}
                  {!searchTerm && (
                    <div
                      style={{
                        padding: "8px 12px",
                        fontSize: "11px",
                        color: "#666",
                        fontStyle: "italic",
                        borderBottom: "1px solid #F0F0F0",
                        backgroundColor: "#FAFAFA"
                      }}
                    >
                      Tip: Type in the field above to search options
                    </div>
                  )}

                  {/* Options */}
                  {paginatedOptions.length > 0 ? (
                    <>
                      {paginatedOptions.map((option) => (
                        <div
                          key={option.value}
                          onClick={() => {
                            setSelectedAction(option);
                            setShowDropdown(false);
                            setSearchTerm("");
                          }}
                          style={{
                            padding: "6px 12px",
                            cursor: "pointer",
                            borderBottom: "1px solid #F0F0F0",
                            backgroundColor: selectedAction?.value === option.value ? "#FFF8CC" : "transparent",
                            "&:hover": {
                              backgroundColor: "#F8F9FA"
                            }
                          }}
                          onMouseEnter={(e) => e.target.style.backgroundColor = "#F8F9FA"}
                          onMouseLeave={(e) => e.target.style.backgroundColor = selectedAction?.value === option.value ? "#FFF8CC" : "transparent"}
                        >
                          <div style={{ fontWeight: "600", fontSize: "13px", color: "#1A1A1A" }}>
                            {option.label}
                          </div>
                          <div style={{ fontSize: "11px", color: "#6B778C", marginTop: "2px" }}>
                            {option.description}
                          </div>
                        </div>
                      ))}
                      
                      {/* Pagination */}
                      {totalPages > 1 && (
                        <div
                          style={{
                            padding: "8px 12px",
                            borderTop: "1px solid #DFE1E6",
                            backgroundColor: "#F8F9FA",
                            display: "flex",
                            justifyContent: "space-between",
                            alignItems: "center",
                            fontSize: "12px"
                          }}
                        >
                          <button
                            disabled={currentPage === 1}
                            onClick={() => setCurrentPage(prev => prev - 1)}
                            style={{
                              padding: "4px 8px",
                              border: "1px solid #DFE1E6",
                              backgroundColor: currentPage === 1 ? "#F0F0F0" : "white",
                              color: currentPage === 1 ? "#999" : "#333",
                              borderRadius: "4px",
                              cursor: currentPage === 1 ? "not-allowed" : "pointer",
                              fontSize: "11px"
                            }}
                          >
                            Previous
                          </button>
                          
                          <span style={{ color: "#6B778C" }}>
                            Page {currentPage} of {totalPages} ({filteredOptions.length} items)
                          </span>
                          
                          <button
                            disabled={currentPage === totalPages}
                            onClick={() => setCurrentPage(prev => prev + 1)}
                            style={{
                              padding: "4px 8px",
                              border: "1px solid #DFE1E6",
                              backgroundColor: currentPage === totalPages ? "#F0F0F0" : "white",
                              color: currentPage === totalPages ? "#999" : "#333",
                              borderRadius: "4px",
                              cursor: currentPage === totalPages ? "not-allowed" : "pointer",
                              fontSize: "11px"
                            }}
                          >
                            Next
                          </button>
                        </div>
                      )}
                    </>
                  ) : (
                    <div
                      style={{
                        padding: "12px",
                        textAlign: "center",
                        color: "#6B778C",
                        fontSize: "14px"
                      }}
                    >
                      No actions found matching "{searchTerm}"
                    </div>
                  )}
                </div>
              )}

              {/* Click outside to close dropdown */}
              {showDropdown && (
                <div
                  style={{
                    position: "fixed",
                    top: 0,
                    left: 0,
                    right: 0,
                    bottom: 0,
                    zIndex: 999
                  }}
                  onClick={() => setShowDropdown(false)}
                />
              )}
              </div>
              
              {/* Show description for selected action */}
              {selectedAction && (
                <div
                  style={{
                    marginTop: "8px",
                    padding: "8px 12px",
                    backgroundColor: "#F4F5F7",
                    borderRadius: "4px",
                    fontSize: "12px",
                    color: "#6B778C",
                    border: "1px solid #DFE1E6"
                  }}
                >
                  <strong>{selectedAction.label}:</strong> {selectedAction.description}
                  {selectedAction.value === 'record-update' && (
                    <div style={{ 
                      marginTop: "6px", 
                      fontSize: "11px", 
                      color: "#0065FF",
                      fontStyle: "italic" 
                    }}>
                      Note: Form fields will be blank. Only fill in the fields you want to update - empty fields will be ignored.
                    </div>
                  )}
                </div>
              )}

              {/* Dynamic Form Fields */}
              {selectedAction && getKeeperActionOptions().find(action => action.value === selectedAction.value)?.fields && getKeeperActionOptions().find(action => action.value === selectedAction.value)?.fields.length > 0 && (
                <div
                  style={{
                    marginTop: "16px",
                    padding: "16px",
                    backgroundColor: "#FFFFFF",
                    borderRadius: "4px",
                    border: "1px solid #DFE1E6"
                  }}
                >
                  <div
                    style={{
                      marginBottom: "12px",
                      fontWeight: "600",
                      fontSize: "14px",
                      color: "#1A1A1A"
                    }}
                  >
                    Required Information:
                  </div>

                  {/* Records Selector for record-update action only */}
                  {selectedAction.value === 'record-update' && (
                    <div style={{ marginBottom: "16px" }}>
                      <label
                        style={{
                          display: "block",
                          marginBottom: "8px",
                          fontWeight: "600",
                          fontSize: "14px",
                          color: "#1A1A1A",
                        }}
                      >
                        Step 1: Select Record to Update <span style={{ color: "#FF5630" }}>*</span>
                      </label>
                      
                      {/* Info about the record update process */}
                      {!selectedRecordForUpdate && (
                        <div
                          style={{
                            marginBottom: "8px",
                            padding: "8px 12px",
                            backgroundColor: "#E3FCEF",
                            borderRadius: "4px",
                            fontSize: "11px",
                            color: "#006644",
                            border: "1px solid #ABF5D1",
                            fontStyle: "italic"
                          }}
                        >
                          Select a record to update.
                        </div>
                      )}
                      
                      {/* Records Dropdown Container for Update */}
                      <div style={{ position: "relative", zIndex: 1000 }}>
                        {loadingRecords ? (
                          <div style={{
                            width: "100%",
                            padding: "8px 12px",
                            borderRadius: "6px",
                            border: "2px solid #DFE1E6",
                            fontSize: "14px",
                            backgroundColor: "#F5F5F5",
                            color: "#666",
                            boxSizing: "border-box"
                          }}>
                            Loading records...
                          </div>
                        ) : (
                          <>
                            {/* Records Search Input for Update */}
                            <input
                              id="keeper-records-update-input"
                              type="text"
                              disabled={isFormDisabled}
                              placeholder={
                                isFormDisabled ? "Form disabled..." :
                                showRecordForUpdateDropdown ? "Type to search records..." : 
                                (selectedRecordForUpdate ? selectedRecordForUpdate.title : "Click to select record to update...")
                              }
                              value={showRecordForUpdateDropdown ? recordForUpdateSearchTerm : (selectedRecordForUpdate ? selectedRecordForUpdate.title : "")}
                              onChange={(e) => {
                                if (!isFormDisabled) {
                                  setRecordForUpdateSearchTerm(e.target.value);
                                  setShowRecordForUpdateDropdown(true);
                                }
                              }}
                              onClick={() => {
                                if (!isFormDisabled) {
                                  setShowRecordForUpdateDropdown(!showRecordForUpdateDropdown);
                                }
                              }}
                              onFocus={(e) => {
                                if (!isFormDisabled) {
                                  setRecordForUpdateSearchTerm("");
                                  setShowRecordForUpdateDropdown(true);
                                }
                              }}
                              style={{
                                width: "100%",
                                padding: "8px 40px 8px 12px",
                                borderRadius: "6px",
                                border: isFormDisabled ? "2px solid #E0E0E0" : (showRecordForUpdateDropdown ? "2px solid #0066CC" : "2px solid #DFE1E6"),
                                fontSize: "14px",
                                backgroundColor: isFormDisabled ? "#F5F5F5" : "white",
                                color: isFormDisabled ? "#999" : "#000",
                                outline: "none",
                                cursor: isFormDisabled ? "not-allowed" : "pointer",
                                boxSizing: "border-box",
                                transition: "border-color 0.2s ease, background-color 0.2s ease"
                              }}
                            />
                            
                            {/* Records Dropdown Arrow for Update */}
                            <div
                              onClick={() => {
                                if (!isFormDisabled) {
                                  setShowRecordForUpdateDropdown(!showRecordForUpdateDropdown);
                                }
                              }}
                              style={{
                                position: "absolute",
                                right: "12px",
                                top: "50%",
                                transform: "translateY(-50%)",
                                cursor: isFormDisabled ? "not-allowed" : "pointer",
                                fontSize: "16px",
                                color: isFormDisabled ? "#CCC" : "#666",
                                userSelect: "none"
                              }}
                            >
                              ▼
                            </div>

                            {/* Records Dropdown Menu for Update */}
                            {showRecordForUpdateDropdown && !isFormDisabled && (
                              <div
                                style={{
                                  position: "absolute",
                                  top: "100%",
                                  left: "0",
                                  right: "0",
                                  backgroundColor: "white",
                                  border: "2px solid #DFE1E6",
                                  borderTop: "none",
                                  borderRadius: "0 0 6px 6px",
                                  maxHeight: "300px",
                                  overflowY: "auto",
                                  zIndex: 999,
                                  boxShadow: "0 8px 24px rgba(0,0,0,0.2)",
                                  boxSizing: "border-box"
                                }}
                              >
                                {/* Records Search Hint for Update */}
                                {!recordForUpdateSearchTerm && (
                                  <div
                                    style={{
                                      padding: "8px 12px",
                                      fontSize: "11px",
                                      color: "#666",
                                      fontStyle: "italic",
                                      borderBottom: "1px solid #F0F0F0",
                                      backgroundColor: "#FAFAFA"
                                    }}
                                  >
                                    Tip: Type in the field above to search records
                                  </div>
                                )}

                                {/* Records Options for Update */}
                                {paginatedRecordsForUpdate.length > 0 ? (
                                  <>
                                    {paginatedRecordsForUpdate.map((record) => (
                                      <div
                                        key={record.record_uid}
                                        onClick={() => {
                                          setSelectedRecordForUpdate(record);
                                          setShowRecordForUpdateDropdown(false);
                                          setRecordForUpdateSearchTerm("");
                                          // Clear previous record data immediately to avoid showing old custom fields
                                          setRecordDetails({});
                                          setDynamicCustomFields([]); // Clear immediately
                                          // For record-update, keep the record identifier but clear other fields
                                          setFormData({
                                            record: record.record_uid || record.title // Keep record identifier
                                          });
                                          setRecordTypeTemplate({});
                                          setTemplateFields([]);
                                          setOriginalRecordType(null);
                                          setOriginalFormData({});
                                          // Ensure custom fields stay cleared during loading
                                          setTimeout(() => setDynamicCustomFields([]), 100);
                                          // Fetch record details but preserve stored data if it exists
                                          const currentStoredData = hasStoredData && storedRequestData ? storedRequestData : null;
                                          fetchKeeperRecordDetails(record.record_uid, currentStoredData);
                                        }}
                                        style={{
                                          padding: "8px 12px",
                                          cursor: "pointer",
                                          borderBottom: "1px solid #F0F0F0",
                                          backgroundColor: selectedRecordForUpdate?.record_uid === record.record_uid ? "#FFF8CC" : "transparent",
                                        }}
                                        onMouseEnter={(e) => e.target.style.backgroundColor = "#F8F9FA"}
                                        onMouseLeave={(e) => e.target.style.backgroundColor = selectedRecordForUpdate?.record_uid === record.record_uid ? "#FFF8CC" : "transparent"}
                                      >
                                        <div style={{ fontWeight: "600", fontSize: "13px", color: "#1A1A1A" }}>
                                          {record.title}
                                        </div>
                                        <div style={{ fontSize: "11px", color: "#6B778C", marginTop: "2px" }}>
                                          UID: {record.record_uid}
                                        </div>
                                      </div>
                                    ))}
                                    
                                    {/* Records Pagination for Update */}
                                    {totalRecordForUpdatePages > 1 && (
                                      <div
                                        style={{
                                          padding: "8px 12px",
                                          borderTop: "1px solid #DFE1E6",
                                          backgroundColor: "#F8F9FA",
                                          display: "flex",
                                          justifyContent: "space-between",
                                          alignItems: "center",
                                          fontSize: "12px"
                                        }}
                                      >
                                        <button
                                          disabled={recordForUpdateCurrentPage === 1}
                                          onClick={() => setRecordForUpdateCurrentPage(prev => prev - 1)}
                                          style={{
                                            padding: "4px 8px",
                                            border: "1px solid #DFE1E6",
                                            backgroundColor: recordForUpdateCurrentPage === 1 ? "#F0F0F0" : "white",
                                            color: recordForUpdateCurrentPage === 1 ? "#999" : "#333",
                                            borderRadius: "4px",
                                            cursor: recordForUpdateCurrentPage === 1 ? "not-allowed" : "pointer",
                                            fontSize: "11px"
                                          }}
                                        >
                                          Previous
                                        </button>
                                        
                                        <span style={{ color: "#6B778C" }}>
                                          Page {recordForUpdateCurrentPage} of {totalRecordForUpdatePages} ({filteredRecordsForUpdate.length} records)
                                        </span>
                                        
                                        <button
                                          disabled={recordForUpdateCurrentPage === totalRecordForUpdatePages}
                                          onClick={() => setRecordForUpdateCurrentPage(prev => prev + 1)}
                                          style={{
                                            padding: "4px 8px",
                                            border: "1px solid #DFE1E6",
                                            backgroundColor: recordForUpdateCurrentPage === totalRecordForUpdatePages ? "#F0F0F0" : "white",
                                            color: recordForUpdateCurrentPage === totalRecordForUpdatePages ? "#999" : "#333",
                                            borderRadius: "4px",
                                            cursor: recordForUpdateCurrentPage === totalRecordForUpdatePages ? "not-allowed" : "pointer",
                                            fontSize: "11px"
                                          }}
                                        >
                                          Next
                                        </button>
                                      </div>
                                    )}
                                  </>
                                ) : (
                                  <div
                                    style={{
                                      padding: "12px",
                                      textAlign: "center",
                                      color: "#6B778C",
                                      fontSize: "14px"
                                    }}
                                  >
                                    No records found matching "{recordForUpdateSearchTerm}"
                                  </div>
                                )}
                              </div>
                            )}

                            {/* Click outside to close records dropdown for update */}
                            {showRecordForUpdateDropdown && (
                              <div
                                style={{
                                  position: "fixed",
                                  top: 0,
                                  left: 0,
                                  right: 0,
                                  bottom: 0,
                                  zIndex: 998
                                }}
                                onClick={() => setShowRecordForUpdateDropdown(false)}
                              />
                            )}
                          </>
                        )}
                      </div>
                      
                      {/* Selected record for update info */}
                      {selectedRecordForUpdate && (
                        <div
                          style={{
                            marginTop: "8px",
                            padding: "8px 12px",
                            backgroundColor: "#E3FCEF",
                            borderRadius: "4px",
                            fontSize: "12px",
                            color: "#006644",
                            border: "1px solid #ABF5D1"
                          }}
                        >
                          <div>Selected: <strong>{selectedRecordForUpdate.title}</strong> (UID: {selectedRecordForUpdate.record_uid})</div>
                          {loadingRecordDetails && (
                            <div style={{ marginTop: "4px", fontSize: "11px", fontStyle: "italic" }}>
                              Loading...
                            </div>
                          )}
                        </div>
                      )}

                      {keeperRecords.length > 0 && (
                        <div style={{ 
                          fontSize: '11px', 
                          color: '#6B778C', 
                          marginTop: '4px',
                          fontStyle: 'italic'
                        }}>
                          {keeperRecords.length} total records available for update
                        </div>
                      )}
                    </div>
                  )}

                  {/* Records Selector for share-record action only */}
                  {selectedAction.value === 'share-record' && (
                    <div style={{ marginBottom: "16px" }}>
                      <label
                        style={{
                          display: "block",
                          marginBottom: "8px",
                          fontWeight: "600",
                          fontSize: "14px",
                          color: "#1A1A1A",
                        }}
                      >
                        Select Record: <span style={{ color: "#FF5630" }}>*</span>
                      </label>
                      
                      {/* Info about hidden fields */}
                      {!selectedRecord && (
                        <div
                          style={{
                            marginBottom: "8px",
                            padding: "8px 12px",
                            backgroundColor: "#E3FCEF",
                            borderRadius: "4px",
                            fontSize: "11px",
                            color: "#006644",
                            border: "1px solid #ABF5D1",
                            fontStyle: "italic"
                          }}
                        >
                          Record ID field is hidden for Share Record action. Select a record, enter an email, and choose permission level to enable the Execute button.
                        </div>
                      )}
                      
                      {/* Records Dropdown Container */}
                      <div style={{ position: "relative", zIndex: 1000 }}>
                        {loadingRecords ? (
                          <div style={{
                            width: "100%",
                            padding: "8px 12px",
                            borderRadius: "6px",
                            border: "2px solid #DFE1E6",
                            fontSize: "14px",
                            backgroundColor: "#F5F5F5",
                            color: "#666",
                            boxSizing: "border-box"
                          }}>
                            Loading records...
                          </div>
                        ) : (
                          <>
                            {/* Records Search Input */}
                            <input
                              id="keeper-records-input"
                              type="text"
                              disabled={isFormDisabled}
                              placeholder={
                                isFormDisabled ? "Form disabled..." :
                                showRecordDropdown ? "Type to search records..." : 
                                (selectedRecord ? selectedRecord.title : "Click to select record...")
                              }
                              value={showRecordDropdown ? recordSearchTerm : (selectedRecord ? selectedRecord.title : "")}
                              onChange={(e) => {
                                if (!isFormDisabled) {
                                  setRecordSearchTerm(e.target.value);
                                  setShowRecordDropdown(true);
                                }
                              }}
                              onClick={() => {
                                if (!isFormDisabled) {
                                  setShowRecordDropdown(!showRecordDropdown);
                                }
                              }}
                              onFocus={(e) => {
                                if (!isFormDisabled) {
                                  setRecordSearchTerm("");
                                  setShowRecordDropdown(true);
                                }
                              }}
                              style={{
                                width: "100%",
                                padding: "8px 40px 8px 12px",
                                borderRadius: "6px",
                                border: isFormDisabled ? "2px solid #E0E0E0" : (showRecordDropdown ? "2px solid #0066CC" : "2px solid #DFE1E6"),
                                fontSize: "14px",
                                backgroundColor: isFormDisabled ? "#F5F5F5" : "white",
                                color: isFormDisabled ? "#999" : "#000",
                                outline: "none",
                                cursor: isFormDisabled ? "not-allowed" : "pointer",
                                boxSizing: "border-box",
                                transition: "border-color 0.2s ease, background-color 0.2s ease"
                              }}
                            />
                            
                            {/* Records Dropdown Arrow */}
                            <div
                              onClick={() => {
                                if (!isFormDisabled) {
                                  setShowRecordDropdown(!showRecordDropdown);
                                }
                              }}
                              style={{
                                position: "absolute",
                                right: "12px",
                                top: "50%",
                                transform: "translateY(-50%)",
                                cursor: isFormDisabled ? "not-allowed" : "pointer",
                                fontSize: "16px",
                                color: isFormDisabled ? "#CCC" : "#666",
                                userSelect: "none"
                              }}
                            >
                              ▼
                            </div>

                            {/* Records Dropdown Menu */}
                            {showRecordDropdown && !isFormDisabled && (
                              <div
                                style={{
                                  position: "absolute",
                                  top: "100%",
                                  left: "0",
                                  right: "0",
                                  backgroundColor: "white",
                                  border: "2px solid #DFE1E6",
                                  borderTop: "none",
                                  borderRadius: "0 0 6px 6px",
                                  maxHeight: "300px",
                                  overflowY: "auto",
                                  zIndex: 999,
                                  boxShadow: "0 8px 24px rgba(0,0,0,0.2)",
                                  boxSizing: "border-box"
                                }}
                              >
                                {/* Records Search Hint */}
                                {!recordSearchTerm && (
                                  <div
                                    style={{
                                      padding: "8px 12px",
                                      fontSize: "11px",
                                      color: "#666",
                                      fontStyle: "italic",
                                      borderBottom: "1px solid #F0F0F0",
                                      backgroundColor: "#FAFAFA"
                                    }}
                                  >
                                    Tip: Type in the field above to search records
                                  </div>
                                )}

                                {/* Records Options */}
                                {paginatedRecords.length > 0 ? (
                                  <>
                                    {paginatedRecords.map((record) => (
                                      <div
                                        key={record.record_uid}
                                        onClick={() => {
                                          setSelectedRecord(record);
                                          setShowRecordDropdown(false);
                                          setRecordSearchTerm("");
                                          // Auto-populate the Record ID/Title field
                                          handleInputChange('record', record.record_uid);
                                          // Auto-populate the Email field with issue creator's email
                                          if (issueContext?.issueCreatorEmail) {
                                            handleInputChange('user', issueContext.issueCreatorEmail);
                                          }
                                        }}
                                        style={{
                                          padding: "8px 12px",
                                          cursor: "pointer",
                                          borderBottom: "1px solid #F0F0F0",
                                          backgroundColor: selectedRecord?.record_uid === record.record_uid ? "#FFF8CC" : "transparent",
                                        }}
                                        onMouseEnter={(e) => e.target.style.backgroundColor = "#F8F9FA"}
                                        onMouseLeave={(e) => e.target.style.backgroundColor = selectedRecord?.record_uid === record.record_uid ? "#FFF8CC" : "transparent"}
                                      >
                                        <div style={{ fontWeight: "600", fontSize: "13px", color: "#1A1A1A" }}>
                                          {record.title}
                                        </div>
                                      </div>
                                    ))}
                                    
                                    {/* Records Pagination */}
                                    {totalRecordPages > 1 && (
                                      <div
                                        style={{
                                          padding: "8px 12px",
                                          borderTop: "1px solid #DFE1E6",
                                          backgroundColor: "#F8F9FA",
                                          display: "flex",
                                          justifyContent: "space-between",
                                          alignItems: "center",
                                          fontSize: "12px"
                                        }}
                                      >
                                        <button
                                          disabled={recordCurrentPage === 1}
                                          onClick={() => setRecordCurrentPage(prev => prev - 1)}
                                          style={{
                                            padding: "4px 8px",
                                            border: "1px solid #DFE1E6",
                                            backgroundColor: recordCurrentPage === 1 ? "#F0F0F0" : "white",
                                            color: recordCurrentPage === 1 ? "#999" : "#333",
                                            borderRadius: "4px",
                                            cursor: recordCurrentPage === 1 ? "not-allowed" : "pointer",
                                            fontSize: "11px"
                                          }}
                                        >
                                          Previous
                                        </button>
                                        
                                        <span style={{ color: "#6B778C" }}>
                                          Page {recordCurrentPage} of {totalRecordPages} ({filteredRecords.length} records)
                                        </span>
                                        
                                        <button
                                          disabled={recordCurrentPage === totalRecordPages}
                                          onClick={() => setRecordCurrentPage(prev => prev + 1)}
                                          style={{
                                            padding: "4px 8px",
                                            border: "1px solid #DFE1E6",
                                            backgroundColor: recordCurrentPage === totalRecordPages ? "#F0F0F0" : "white",
                                            color: recordCurrentPage === totalRecordPages ? "#999" : "#333",
                                            borderRadius: "4px",
                                            cursor: recordCurrentPage === totalRecordPages ? "not-allowed" : "pointer",
                                            fontSize: "11px"
                                          }}
                                        >
                                          Next
                                        </button>
                                      </div>
                                    )}
                                  </>
                                ) : (
                                  <div
                                    style={{
                                      padding: "12px",
                                      textAlign: "center",
                                      color: "#6B778C",
                                      fontSize: "14px"
                                    }}
                                  >
                                    No records found matching "{recordSearchTerm}"
                                  </div>
                                )}
                              </div>
                            )}

                            {/* Click outside to close records dropdown */}
                            {showRecordDropdown && (
                              <div
                                style={{
                                  position: "fixed",
                                  top: 0,
                                  left: 0,
                                  right: 0,
                                  bottom: 0,
                                  zIndex: 998
                                }}
                                onClick={() => setShowRecordDropdown(false)}
                              />
                            )}
                          </>
                        )}
                      </div>
                      
                      {/* Selected record info */}
                      {selectedRecord && (
                        <div
                          style={{
                            marginTop: "8px",
                            padding: "8px 12px",
                            backgroundColor: "#E3FCEF",
                            borderRadius: "4px",
                            fontSize: "12px",
                            color: "#006644",
                            border: "1px solid #ABF5D1"
                          }}
                        >
                          <div>Selected: <strong>{selectedRecord.title}</strong> (UID: {selectedRecord.record_uid})</div>
                          {selectedAction?.value === 'share-record' && (
                            <div style={{ marginTop: "4px", fontSize: "11px", fontStyle: "italic" }}>
                              Record ID will be sent automatically: {selectedRecord.record_uid}
                            </div>
                          )}
                        </div>
                      )}

                      {keeperRecords.length > 0 && (
                        <div style={{ 
                          fontSize: '11px', 
                          color: '#6B778C', 
                          marginTop: '4px',
                          fontStyle: 'italic'
                        }}>
                          {keeperRecords.length} total records available
                        </div>
                      )}
                    </div>
                  )}

                  {/* Folders Selector for share-folder action only */}
                  {selectedAction.value === 'share-folder' && (
                    <div style={{ marginBottom: "16px" }}>
                      <label
                        style={{
                          display: "block",
                          marginBottom: "8px",
                          fontWeight: "600",
                          fontSize: "14px",
                          color: "#1A1A1A",
                        }}
                      >
                        Select Folder: <span style={{ color: "#FF5630" }}>*</span>
                      </label>
                      
                      {/* Info about hidden fields */}
                      {!selectedFolder && (
                        <div
                          style={{
                            marginBottom: "8px",
                            padding: "8px 12px",
                            backgroundColor: "#E3FCEF",
                            borderRadius: "4px",
                            fontSize: "11px",
                            color: "#006644",
                            border: "1px solid #ABF5D1",
                            fontStyle: "italic"
                          }}
                        >
                          Folder Path field is hidden for Share Folder action. Select a folder, enter an email, and choose permission level to enable the Execute button.
                        </div>
                      )}
                      
                      {/* Folders Dropdown Container */}
                      <div style={{ position: "relative", zIndex: 999 }}>
                        {loadingFolders ? (
                          <div style={{
                            width: "100%",
                            padding: "8px 12px",
                            borderRadius: "6px",
                            border: "2px solid #DFE1E6",
                            fontSize: "14px",
                            backgroundColor: "#F5F5F5",
                            color: "#666",
                            boxSizing: "border-box"
                          }}>
                            Loading folders...
                          </div>
                        ) : (
                          <>
                            {/* Folders Search Input */}
                            <input
                              id="keeper-folders-input"
                              type="text"
                              disabled={isFormDisabled}
                              placeholder={
                                isFormDisabled ? "Form disabled..." :
                                showFolderDropdown ? "Type to search folders..." : 
                                (selectedFolder ? (selectedFolder.name || selectedFolder.title) : "Click to select folder...")
                              }
                              value={showFolderDropdown ? folderSearchTerm : (selectedFolder ? (selectedFolder.name || selectedFolder.title) : "")}
                              onChange={(e) => {
                                if (!isFormDisabled) {
                                  setFolderSearchTerm(e.target.value);
                                  setShowFolderDropdown(true);
                                }
                              }}
                              onClick={() => {
                                if (!isFormDisabled) {
                                  setShowFolderDropdown(!showFolderDropdown);
                                }
                              }}
                              onFocus={(e) => {
                                if (!isFormDisabled) {
                                  setFolderSearchTerm("");
                                  setShowFolderDropdown(true);
                                }
                              }}
                              style={{
                                width: "100%",
                                padding: "8px 40px 8px 12px",
                                borderRadius: "6px",
                                border: isFormDisabled ? "2px solid #E0E0E0" : (showFolderDropdown ? "2px solid #0066CC" : "2px solid #DFE1E6"),
                                fontSize: "14px",
                                backgroundColor: isFormDisabled ? "#F5F5F5" : "white",
                                color: isFormDisabled ? "#999" : "#000",
                                outline: "none",
                                cursor: isFormDisabled ? "not-allowed" : "pointer",
                                boxSizing: "border-box",
                                transition: "border-color 0.2s ease, background-color 0.2s ease"
                              }}
                            />
                            
                            {/* Folders Dropdown Arrow */}
                            <div
                              onClick={() => {
                                if (!isFormDisabled) {
                                  setShowFolderDropdown(!showFolderDropdown);
                                }
                              }}
                              style={{
                                position: "absolute",
                                right: "12px",
                                top: "50%",
                                transform: "translateY(-50%)",
                                cursor: isFormDisabled ? "not-allowed" : "pointer",
                                fontSize: "16px",
                                color: isFormDisabled ? "#CCC" : "#666",
                                userSelect: "none"
                              }}
                            >
                              ▼
                            </div>

                            {/* Folders Dropdown Menu */}
                            {showFolderDropdown && !isFormDisabled && (
                              <div
                                style={{
                                  position: "absolute",
                                  top: "100%",
                                  left: "0",
                                  right: "0",
                                  backgroundColor: "white",
                                  border: "2px solid #DFE1E6",
                                  borderTop: "none",
                                  borderRadius: "0 0 6px 6px",
                                  maxHeight: "300px",
                                  overflowY: "auto",
                                  zIndex: 998,
                                  boxShadow: "0 8px 24px rgba(0,0,0,0.2)",
                                  boxSizing: "border-box"
                                }}
                              >
                                {/* Folders Search Hint */}
                                {!folderSearchTerm && (
                                  <div
                                    style={{
                                      padding: "8px 12px",
                                      fontSize: "11px",
                                      color: "#666",
                                      fontStyle: "italic",
                                      borderBottom: "1px solid #F0F0F0",
                                      backgroundColor: "#FAFAFA"
                                    }}
                                  >
                                    Tip: Type in the field above to search folders
                                  </div>
                                )}

                                {/* Folders Options */}
                                {paginatedFolders.length > 0 ? (
                                  <>
                                    {paginatedFolders.map((folder, index) => (
                                      <div
                                        key={folder.uid || folder.path || index}
                                        onClick={() => {
                                          setSelectedFolder(folder);
                                          setShowFolderDropdown(false);
                                          setFolderSearchTerm("");
                                          // Auto-populate the Folder Path field with folder UID
                                          handleInputChange('folder', folder.uid || folder.path || folder.name);
                                          // Auto-populate the Email field with issue creator's email
                                          if (issueContext?.issueCreatorEmail) {
                                            handleInputChange('user', issueContext.issueCreatorEmail);
                                          }
                                        }}
                                        style={{
                                          padding: "8px 12px",
                                          cursor: "pointer",
                                          borderBottom: "1px solid #F0F0F0",
                                          backgroundColor: selectedFolder?.uid === folder.uid ? "#FFF8CC" : "transparent",
                                        }}
                                        onMouseEnter={(e) => e.target.style.backgroundColor = "#F8F9FA"}
                                        onMouseLeave={(e) => e.target.style.backgroundColor = selectedFolder?.uid === folder.uid ? "#FFF8CC" : "transparent"}
                                      >
                                        <div style={{ fontWeight: "600", fontSize: "13px", color: "#1A1A1A" }}>
                                          {folder.name || folder.title}
                                        </div>
                                        {folder.uid && (
                                          <div style={{ fontSize: "11px", color: "#6B778C", marginTop: "2px" }}>
                                            UID: {folder.uid}
                                          </div>
                                        )}
                                      </div>
                                    ))}
                                    
                                    {/* Folders Pagination */}
                                    {totalFolderPages > 1 && (
                                      <div
                                        style={{
                                          padding: "8px 12px",
                                          borderTop: "1px solid #DFE1E6",
                                          backgroundColor: "#F8F9FA",
                                          display: "flex",
                                          justifyContent: "space-between",
                                          alignItems: "center",
                                          fontSize: "12px"
                                        }}
                                      >
                                        <button
                                          disabled={folderCurrentPage === 1}
                                          onClick={() => setFolderCurrentPage(prev => prev - 1)}
                                          style={{
                                            padding: "4px 8px",
                                            border: "1px solid #DFE1E6",
                                            backgroundColor: folderCurrentPage === 1 ? "#F0F0F0" : "white",
                                            color: folderCurrentPage === 1 ? "#999" : "#333",
                                            borderRadius: "4px",
                                            cursor: folderCurrentPage === 1 ? "not-allowed" : "pointer",
                                            fontSize: "11px"
                                          }}
                                        >
                                          Previous
                                        </button>
                                        
                                        <span style={{ color: "#6B778C" }}>
                                          Page {folderCurrentPage} of {totalFolderPages} ({filteredFolders.length} folders)
                                        </span>
                                        
                                        <button
                                          disabled={folderCurrentPage === totalFolderPages}
                                          onClick={() => setFolderCurrentPage(prev => prev + 1)}
                                          style={{
                                            padding: "4px 8px",
                                            border: "1px solid #DFE1E6",
                                            backgroundColor: folderCurrentPage === totalFolderPages ? "#F0F0F0" : "white",
                                            color: folderCurrentPage === totalFolderPages ? "#999" : "#333",
                                            borderRadius: "4px",
                                            cursor: folderCurrentPage === totalFolderPages ? "not-allowed" : "pointer",
                                            fontSize: "11px"
                                          }}
                                        >
                                          Next
                                        </button>
                                      </div>
                                    )}
                                  </>
                                ) : (
                                  <div
                                    style={{
                                      padding: "12px",
                                      textAlign: "center",
                                      color: "#6B778C",
                                      fontSize: "14px"
                                    }}
                                  >
                                    No folders found matching "{folderSearchTerm}"
                                  </div>
                                )}
                              </div>
                            )}

                            {/* Click outside to close folders dropdown */}
                            {showFolderDropdown && (
                              <div
                                style={{
                                  position: "fixed",
                                  top: 0,
                                  left: 0,
                                  right: 0,
                                  bottom: 0,
                                  zIndex: 997
                                }}
                                onClick={() => setShowFolderDropdown(false)}
                              />
                            )}
                          </>
                        )}
                      </div>
                      
                      {/* Selected folder info */}
                      {selectedFolder && (
                        <div
                          style={{
                            marginTop: "8px",
                            padding: "8px 12px",
                            backgroundColor: "#E3FCEF",
                            borderRadius: "4px",
                            fontSize: "12px",
                            color: "#006644",
                            border: "1px solid #ABF5D1"
                          }}
                        >
                          <div>Selected: <strong>{selectedFolder.name || selectedFolder.title}</strong></div>
                          {selectedFolder.uid && (
                            <div style={{ marginTop: "4px", fontSize: "11px", fontStyle: "italic" }}>
                              Folder UID will be sent automatically: {selectedFolder.uid}
                            </div>
                          )}
                        </div>
                      )}

                      {keeperFolders.length > 0 && (
                        <div style={{ 
                          fontSize: '11px', 
                          color: '#6B778C', 
                          marginTop: '4px',
                          fontStyle: 'italic'
                        }}>
                          {keeperFolders.length} total folders available
                        </div>
                      )}
                    </div>
                  )}

                  {/* Folders Selector for record-permission action only */}
                  {selectedAction.value === 'record-permission' && (
                    <div style={{ marginBottom: "16px" }}>
                      <label
                        style={{
                          display: "block",
                          marginBottom: "8px",
                          fontSize: "13px",
                          fontWeight: "500",
                          color: "#1A1A1A",
                        }}
                      >
                        Select Shared Folder: <span style={{ color: "#FF5630" }}>*</span>
                      </label>
                      
                      {/* Info about record-permission workflow */}
                      {!selectedFolder && (
                        <div
                          style={{
                            marginBottom: "8px",
                            padding: "8px 12px",
                            backgroundColor: "#E3FCEF",
                            borderRadius: "4px",
                            fontSize: "11px",
                            color: "#006644",
                            border: "1px solid #ABF5D1",
                            fontStyle: "italic"
                          }}
                        >
                          Shared Folder field is hidden for Record Permission action. Select a shared folder and configure permissions to enable the Execute button. Changes apply to all users in the folder.
                        </div>
                      )}
                      
                      {/* Folders Dropdown Container */}
                      <div style={{ position: "relative", zIndex: 998 }}>
                        {loadingFolders ? (
                          <div style={{
                            width: "100%",
                            padding: "8px 12px",
                            borderRadius: "6px",
                            border: "2px solid #DFE1E6",
                            fontSize: "14px",
                            backgroundColor: "#F5F5F5",
                            color: "#666",
                            boxSizing: "border-box"
                          }}>
                            Loading shared folders...
                          </div>
                        ) : (
                          <>
                            {/* Folders Search Input */}
                            <input
                              id="keeper-folders-permissions-input"
                              type="text"
                              disabled={isFormDisabled}
                              placeholder={
                                isFormDisabled ? "Form disabled..." :
                                showFolderDropdown ? "Type to search folders..." : 
                                (selectedFolder ? selectedFolder.name || selectedFolder.title : "Click to select shared folder...")
                              }
                              value={folderSearchTerm}
                              onClick={() => {
                                if (!isFormDisabled) {
                                  setShowFolderDropdown(true);
                                }
                              }}
                              onChange={(e) => {
                                setFolderSearchTerm(e.target.value);
                                setFolderCurrentPage(1);
                                if (!showFolderDropdown) setShowFolderDropdown(true);
                              }}
                              onBlur={(e) => {
                                setTimeout(() => {
                                  if (!e.currentTarget.contains(document.activeElement)) {
                                    setShowFolderDropdown(false);
                                  }
                                }, 150);
                              }}
                              style={{
                                width: "100%",
                                padding: "8px 12px",
                                borderRadius: "6px",
                                border: selectedFolder ? "2px solid #006644" : "2px solid #DFE1E6",
                                fontSize: "14px",
                                backgroundColor: isFormDisabled ? "#F5F5F5" : selectedFolder ? "#F8FFF8" : "white",
                                color: isFormDisabled ? "#999" : "#000",
                                cursor: isFormDisabled ? "not-allowed" : "pointer",
                                outline: "none",
                                boxSizing: "border-box"
                              }}
                            />
                            
                            {/* Folders Dropdown */}
                            {showFolderDropdown && !isFormDisabled && (
                              <div
                                style={{
                                  position: "absolute",
                                  top: "100%",
                                  left: 0,
                                  right: 0,
                                  backgroundColor: "white",
                                  border: "1px solid #DFE1E6",
                                  borderRadius: "6px",
                                  boxShadow: "0 4px 8px rgba(0,0,0,0.1)",
                                  zIndex: 1001,
                                  maxHeight: "200px",
                                  overflowY: "auto"
                                }}
                              >
                                {paginatedFolders.map((folder) => (
                                  <div
                                    key={folder.folder_uid}
                                    onClick={() => {
                                      setSelectedFolder(folder);
                                      setFormData(prev => ({ ...prev, sharedFolder: folder.folder_uid }));
                                      setFolderSearchTerm(folder.name || folder.title || `Folder ${folder.folder_uid}`);
                                      setShowFolderDropdown(false);
                                    }}
                                    style={{
                                      padding: "8px 12px",
                                      cursor: "pointer",
                                      borderBottom: "1px solid #F4F5F7"
                                    }}
                                    onMouseEnter={(e) => {
                                      e.target.style.backgroundColor = "#F4F5F7";
                                    }}
                                    onMouseLeave={(e) => {
                                      e.target.style.backgroundColor = "white";
                                    }}
                                  >
                                    <div style={{ fontSize: "14px", fontWeight: "500" }}>
                                      {folder.name || folder.title || `Folder ${folder.folder_uid}`}
                                    </div>
                                    <div style={{ fontSize: "11px", color: "#6B778C", marginTop: "2px" }}>
                                      UID: {folder.folder_uid} - Shared Folder (flags: {folder.flags})
                                    </div>
                                  </div>
                                ))}
                                
                                {/* Pagination Controls */}
                                {totalFolderPages > 1 && (
                                  <div style={{
                                    display: "flex",
                                    justifyContent: "space-between",
                                    alignItems: "center",
                                    padding: "8px 12px",
                                    backgroundColor: "#F8F9FA",
                                    borderTop: "1px solid #E1E5E9"
                                  }}>
                                    <button
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        if (folderCurrentPage > 1) {
                                          setFolderCurrentPage(folderCurrentPage - 1);
                                        }
                                      }}
                                      disabled={folderCurrentPage <= 1}
                                      style={{
                                        padding: "4px 8px",
                                        fontSize: "11px",
                                        border: "1px solid #DFE1E6",
                                        borderRadius: "4px",
                                        backgroundColor: folderCurrentPage <= 1 ? "#F5F5F5" : "white",
                                        cursor: folderCurrentPage <= 1 ? "not-allowed" : "pointer"
                                      }}
                                    >
                                      Previous
                                    </button>
                                    <span style={{ fontSize: "11px", color: "#6B778C" }}>
                                      Page {folderCurrentPage} of {totalFolderPages}
                                    </span>
                                    <button
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        if (folderCurrentPage < totalFolderPages) {
                                          setFolderCurrentPage(folderCurrentPage + 1);
                                        }
                                      }}
                                      disabled={folderCurrentPage >= totalFolderPages}
                                      style={{
                                        padding: "4px 8px",
                                        fontSize: "11px",
                                        border: "1px solid #DFE1E6",
                                        borderRadius: "4px",
                                        backgroundColor: folderCurrentPage >= totalFolderPages ? "#F5F5F5" : "white",
                                        cursor: folderCurrentPage >= totalFolderPages ? "not-allowed" : "pointer"
                                      }}
                                    >
                                      Next
                                    </button>
                                  </div>
                                )}
                              </div>
                            )}
                          </>
                        )}
                      </div>

                      {/* Selected Folder Display */}
                      {selectedFolder && (
                        <div
                          style={{
                            marginTop: "8px",
                            padding: "8px 12px",
                            backgroundColor: "#E3FCEF",
                            borderRadius: "4px",
                            fontSize: "12px",
                            color: "#006644",
                            border: "1px solid #ABF5D1"
                          }}
                        >
                          <div>Selected: <strong>{selectedFolder.name || selectedFolder.title}</strong></div>
                          <div style={{ marginTop: "4px", fontSize: "11px", fontStyle: "italic" }}>
                            Folder UID will be used for record-permission command: {selectedFolder.folder_uid}
                          </div>
                        </div>
                      )}

                      {getFilteredFolders().length > 0 && (
                        <div style={{ 
                          fontSize: '11px', 
                          color: '#6B778C', 
                          marginTop: '4px',
                          fontStyle: 'italic'
                        }}>
                          {getFilteredFolders().length} shared folders available (filtered for "S" flag only)
                        </div>
                      )}
                    </div>
                  )}

                  {/* Folders and Records Selector for pam-action-rotate action */}
                  {selectedAction.value === 'pam-action-rotate' && (  
                    <div>
                      {/* Info about pam-action-rotate workflow */}
                      {!selectedPamResource && !selectedFolder && (
                        <div style={{ marginBottom: "16px" }}>
                          <div
                            style={{
                              padding: "8px 12px",
                              backgroundColor: "#E3FCEF",
                              borderRadius: "4px",
                              fontSize: "11px",
                              color: "#006644",
                              border: "1px solid #ABF5D1",
                              fontStyle: "italic",
                              marginBottom: "8px"
                            }}
                          >
                            PAM Action Rotate shows available PAM resources - Keeper records with types like 'pamMachine', 'pamUser', 'pamDatabase'. Choose target type and select the appropriate PAM resource or folder for password rotation.
                          </div>
                          
                          {/* PAM Configuration Warning */}
                          <div
                            style={{
                              padding: "8px 12px",
                              backgroundColor: "#FFF3CD",
                              borderRadius: "4px",
                              fontSize: "11px",
                              color: "#856404",
                              border: "1px solid #FFEAA7",
                              fontStyle: "italic"
                            }}
                          >
                            <strong>Prerequisites:</strong> Ensure you have a PAM Configuration set up in Keeper Vault with:
                            <br />- Associated Gateway configured and running
                            <br />- "Rotation" feature enabled in PAM Settings
                            <br />- Proper access permissions to the PAM Configuration
                            <br />- Records with PAM types (pamMachine, pamUser, pamDatabase) created
                          </div>
                        </div>
                      )}

                      {/* Show record or folder selector based on target_type */}
                      {formData.target_type === 'record' && (
                        <div style={{ marginBottom: "16px" }}>
                          <label
                            style={{
                              display: "block",
                              marginBottom: "8px", 
                              fontSize: "13px",
                              fontWeight: "500",
                              color: "#1A1A1A",
                            }}
                          >
                            Select PAM Resource: <span style={{ color: "#FF5630" }}>*</span>
                          </label>

                          {/* PAM Resources Dropdown Container */}
                          <div style={{ position: "relative", zIndex: 997 }}>
                            {loadingPamResources ? (
                              <div style={{
                                width: "100%",
                                padding: "8px 12px",
                                borderRadius: "6px",
                                border: "2px solid #DFE1E6",
                                fontSize: "14px",
                                backgroundColor: "#F5F5F5",
                                color: "#666",
                                boxSizing: "border-box"
                              }}>
                                Loading PAM resources...
                              </div>
                            ) : (
                              <>
                                {/* PAM Resources Search Input */}
                                <input
                                  type="text"
                                  placeholder="Search PAM resources..."
                                  value={pamResourceSearchTerm}
                                  onChange={(e) => {
                                    setPamResourceSearchTerm(e.target.value);
                                    setPamResourceCurrentPage(1);
                                  }}
                                  onClick={() => setShowPamResourceDropdown(true)}
                                  style={{
                                    width: "100%",
                                    padding: "8px 12px",
                                    borderRadius: "6px",
                                    border: "2px solid #DFE1E6",
                                    fontSize: "14px",
                                    backgroundColor: "#FAFBFC",
                                    cursor: "pointer",
                                    boxSizing: "border-box"
                                  }}
                                />

                                {/* PAM Resources Dropdown */}
                                {showPamResourceDropdown && paginatedPamResources.length > 0 && (
                                  <div
                                    style={{
                                      position: "absolute",
                                      top: "100%",
                                      left: "0",
                                      right: "0",
                                      backgroundColor: "#fff",
                                      border: "2px solid #DFE1E6",
                                      borderRadius: "6px",
                                      boxShadow: "0 4px 8px rgba(9,30,66,0.25)",
                                      zIndex: 997,
                                      maxHeight: "200px",
                                      overflowY: "auto"
                                    }}
                                  >
                                    {paginatedPamResources.map((resource, index) => (
                                      <div
                                        key={resource.record_uid || resource.uid || index}
                                        onClick={() => {
                                          setSelectedPamResource(resource);
                                          setShowPamResourceDropdown(false);
                                          setPamResourceSearchTerm(resource.title || 'Untitled PAM Resource');
                                        }}
                                        style={{
                                          padding: "12px 16px",
                                          cursor: "pointer",
                                          borderBottom: index < paginatedPamResources.length - 1 ? "1px solid #F4F5F7" : "none",
                                          backgroundColor: "#fff",
                                          fontSize: "14px",
                                          transition: "background-color 0.2s"
                                        }}
                                        onMouseEnter={(e) => e.target.style.backgroundColor = "#F4F5F7"}
                                        onMouseLeave={(e) => e.target.style.backgroundColor = "#fff"}
                                      >
                                        <div style={{ fontWeight: "500", marginBottom: "2px" }}>
                                          {resource.title || 'Untitled PAM Resource'}
                                        </div>
                                        <div style={{ fontSize: "11px", color: "#6B778C", fontFamily: "monospace" }}>
                                          UID: {resource.record_uid}
                                        </div>
                                        {(resource.record_type || resource.type) && (
                                          <div style={{ fontSize: "11px", color: "#0066CC", marginTop: "2px" }}>
                                            Type: {resource.record_type || resource.type}
                                          </div>
                                        )}
                                      </div>
                                    ))}

                                    {/* PAM Resources Pagination */}
                                    {totalPamResourcePages > 1 && (
                                      <div style={{
                                        display: "flex",
                                        justifyContent: "space-between",
                                        alignItems: "center",
                                        padding: "8px 16px",
                                        borderTop: "1px solid #F4F5F7",
                                        backgroundColor: "#FAFBFC",
                                        fontSize: "12px",
                                        color: "#6B778C"
                                      }}>
                                        <button
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            if (pamResourceCurrentPage > 1) {
                                              setPamResourceCurrentPage(pamResourceCurrentPage - 1);
                                            }
                                          }}
                                          disabled={pamResourceCurrentPage === 1}
                                          style={{
                                            padding: "4px 8px",
                                            fontSize: "11px",
                                            border: "1px solid #DFE1E6",
                                            backgroundColor: pamResourceCurrentPage === 1 ? "#F4F5F7" : "#fff",
                                            cursor: pamResourceCurrentPage === 1 ? "not-allowed" : "pointer",
                                            borderRadius: "3px"
                                          }}
                                        >
                                          Previous
                                        </button>
                                        <span>Page {pamResourceCurrentPage} of {totalPamResourcePages}</span>
                                        <button
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            if (pamResourceCurrentPage < totalPamResourcePages) {
                                              setPamResourceCurrentPage(pamResourceCurrentPage + 1);
                                            }
                                          }}
                                          disabled={pamResourceCurrentPage === totalPamResourcePages}
                                          style={{
                                            padding: "4px 8px",
                                            fontSize: "11px",
                                            border: "1px solid #DFE1E6",
                                            backgroundColor: pamResourceCurrentPage === totalPamResourcePages ? "#F4F5F7" : "#fff",
                                            cursor: pamResourceCurrentPage === totalPamResourcePages ? "not-allowed" : "pointer",
                                            borderRadius: "3px"
                                          }}
                                        >
                                          Next
                                        </button>
                                      </div>
                                    )}
                                  </div>
                                )}
                              </>
                            )}

                              {pamResources.length === 0 && !loadingPamResources && (
                              <div style={{
                                fontSize: '12px',
                                color: '#FF5630',
                                marginTop: '4px'
                              }}>
                                No PAM resources found. Create records with types 'pamMachine', 'pamUser', or 'pamDatabase' to enable rotation.
                              </div>
                            )}
                          </div>

                          {/* Selected PAM Resource Indicator */}
                          {selectedPamResource && (
                            <div
                              style={{
                                marginTop: "8px",
                                padding: "8px 12px",
                                backgroundColor: "#E3FCEF",
                                borderRadius: "4px",
                                fontSize: "12px",
                                color: "#006644",
                                border: "1px solid #ABF5D1"
                              }}
                            >
                              <div>Selected: <strong>{selectedPamResource.title || 'Untitled PAM Resource'}</strong></div>
                              <div style={{ marginTop: "4px", fontSize: "11px", fontStyle: "italic" }}>
                                Record UID: {selectedPamResource.record_uid}
                              </div>
                              {(selectedPamResource.record_type || selectedPamResource.type) && (
                                <div style={{ marginTop: "2px", fontSize: "11px", fontStyle: "italic" }}>
                                  Type: {selectedPamResource.record_type || selectedPamResource.type}
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      )}

                      {formData.target_type === 'folder' && (
                        <div style={{ marginBottom: "16px" }}>
                          <label
                            style={{
                              display: "block",
                              marginBottom: "8px",
                              fontSize: "13px",
                              fontWeight: "500",
                              color: "#1A1A1A",
                            }}
                          >
                            Select Folder: <span style={{ color: "#FF5630" }}>*</span>
                          </label>

                          {/* Folders Dropdown Container */}
                          <div style={{ position: "relative", zIndex: 998 }}>
                            {loadingFolders ? (
                              <div style={{
                                width: "100%",
                                padding: "8px 12px",
                                borderRadius: "6px",
                                border: "2px solid #DFE1E6",
                                fontSize: "14px",
                                backgroundColor: "#F5F5F5",
                                color: "#666",
                                boxSizing: "border-box"
                              }}>
                                Loading folders...
                              </div>
                            ) : (
                              <>
                                {/* Folders Search Input */}
                                <input
                                  type="text"
                                  placeholder="Search folders..."
                                  value={folderSearchTerm}
                                  onChange={(e) => {
                                    setFolderSearchTerm(e.target.value);
                                    setFolderCurrentPage(1);
                                  }}
                                  onClick={() => setShowFolderDropdown(true)}
                                  style={{
                                    width: "100%",
                                    padding: "8px 12px",
                                    borderRadius: "6px",
                                    border: "2px solid #DFE1E6",
                                    fontSize: "14px",
                                    backgroundColor: "#FAFBFC",
                                    cursor: "pointer",
                                    boxSizing: "border-box"
                                  }}
                                />

                                {/* Folders Dropdown */}
                                {showFolderDropdown && paginatedFolders.length > 0 && (
                                  <div
                                    style={{
                                      position: "absolute",
                                      top: "100%",
                                      left: "0",
                                      right: "0",
                                      backgroundColor: "#fff",
                                      border: "2px solid #DFE1E6",
                                      borderRadius: "6px",
                                      boxShadow: "0 4px 8px rgba(9,30,66,0.25)",
                                      zIndex: 998,
                                      maxHeight: "200px",
                                      overflowY: "auto"
                                    }}
                                  >
                                    {paginatedFolders.map((folder, index) => (
                                      <div
                                        key={folder.folder_uid || folder.uid || index}
                                        onClick={() => {
                                          setSelectedFolder(folder);
                                          setShowFolderDropdown(false);
                                          setFolderSearchTerm(folder.name || folder.title || 'Untitled Folder');
                                        }}
                                        style={{
                                          padding: "12px 16px",
                                          cursor: "pointer",
                                          borderBottom: index < paginatedFolders.length - 1 ? "1px solid #F4F5F7" : "none",
                                          backgroundColor: "#fff",
                                          fontSize: "14px",
                                          transition: "background-color 0.2s"
                                        }}
                                        onMouseEnter={(e) => e.target.style.backgroundColor = "#F4F5F7"}
                                        onMouseLeave={(e) => e.target.style.backgroundColor = "#fff"}
                                      >
                                        <div style={{ fontWeight: "500", marginBottom: "2px" }}>
                                          {folder.name || folder.title || 'Untitled Folder'}
                                        </div>
                                        <div style={{ fontSize: "11px", color: "#6B778C", fontFamily: "monospace" }}>
                                          UID: {folder.folder_uid || folder.uid}
                                        </div>
                                      </div>
                                    ))}

                                    {/* Folders Pagination */}
                                    {totalFolderPages > 1 && (
                                      <div style={{
                                        display: "flex",
                                        justifyContent: "space-between",
                                        alignItems: "center",
                                        padding: "8px 16px",
                                        borderTop: "1px solid #F4F5F7",
                                        backgroundColor: "#FAFBFC",
                                        fontSize: "12px",
                                        color: "#6B778C"
                                      }}>
                                        <button
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            if (folderCurrentPage > 1) {
                                              setFolderCurrentPage(folderCurrentPage - 1);
                                            }
                                          }}
                                          disabled={folderCurrentPage === 1}
                                          style={{
                                            padding: "4px 8px",
                                            fontSize: "11px",
                                            border: "1px solid #DFE1E6",
                                            backgroundColor: folderCurrentPage === 1 ? "#F4F5F7" : "#fff",
                                            cursor: folderCurrentPage === 1 ? "not-allowed" : "pointer",
                                            borderRadius: "3px"
                                          }}
                                        >
                                          Previous
                                        </button>
                                        <span>Page {folderCurrentPage} of {totalFolderPages}</span>
                                        <button
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            if (folderCurrentPage < totalFolderPages) {
                                              setFolderCurrentPage(folderCurrentPage + 1);
                                            }
                                          }}
                                          disabled={folderCurrentPage === totalFolderPages}
                                          style={{
                                            padding: "4px 8px",
                                            fontSize: "11px",
                                            border: "1px solid #DFE1E6",
                                            backgroundColor: folderCurrentPage === totalFolderPages ? "#F4F5F7" : "#fff",
                                            cursor: folderCurrentPage === totalFolderPages ? "not-allowed" : "pointer",
                                            borderRadius: "3px"
                                          }}
                                        >
                                          Next
                                        </button>
                                      </div>
                                    )}
                                  </div>
                                )}
                              </>
                            )}

                            {getFilteredFolders().length === 0 && !loadingFolders && (
                              <div style={{
                                fontSize: '12px',
                                color: '#FF5630',
                                marginTop: '4px'
                              }}>
                                No folders found.
                              </div>
                            )}
                          </div>

                          {/* Selected Folder Indicator */}
                          {selectedFolder && (
                            <div
                              style={{
                                marginTop: "8px",
                                padding: "8px 12px",
                                backgroundColor: "#E3FCEF",
                                borderRadius: "4px",
                                fontSize: "12px",
                                color: "#006644",
                                border: "1px solid #ABF5D1"
                              }}
                            >
                              <div>Selected: <strong>{selectedFolder.name || selectedFolder.title}</strong></div>
                              <div style={{ marginTop: "4px", fontSize: "11px", fontStyle: "italic" }}>
                                Folder UID will be used for pam action rotate: {selectedFolder.folder_uid || selectedFolder.uid}
                              </div>
                            </div>
                          )}

                          {getFilteredFolders().length > 0 && (
                            <div style={{ 
                              fontSize: '11px', 
                              color: '#6B778C', 
                              marginTop: '4px',
                              fontStyle: 'italic'
                            }}>
                              {getFilteredFolders().length} folders available for folder-based PAM rotation
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                  
                  {/* Loading state for record types */}
                  {selectedAction.value === 'record-update' && selectedRecordForUpdate && Object.keys(recordDetails).length > 0 && !loadingRecordDetails && loadingRecordTypes && (
                    <div style={{
                      padding: '24px',
                      textAlign: 'center',
                      backgroundColor: '#F8F9FA',
                      borderRadius: '8px',
                      border: '2px dashed #DFE1E6',
                      marginBottom: '16px',
                      marginTop: '24px'
                    }}>
                      <div style={{
                        fontSize: '14px',
                        color: '#0066CC',
                        fontWeight: '500',
                        marginBottom: '8px'
                      }}>
                        Loading record types...
                      </div>
                      <div style={{
                        fontSize: '12px',
                        color: '#6B778C',
                        fontStyle: 'italic'
                      }}>
                        Please wait while we load the available record types
                      </div>
                    </div>
                  )}
                  
                  {/* Step 2: Dynamic Form Fields for record-update (only show after record selection) */}
                  {selectedAction.value === 'record-update' && selectedRecordForUpdate && Object.keys(recordDetails).length > 0 && !loadingRecordDetails && !loadingRecordTypes && recordTypes.length > 0 && (
                    <div style={{ marginBottom: "16px", marginTop: "24px" }}>
                      <div
                        style={{
                          fontSize: "16px",
                          fontWeight: "600",
                          color: "#1A1A1A",
                          marginBottom: "12px",
                          paddingBottom: "8px",
                          borderBottom: "2px solid #0066CC"
                        }}
                      >
                        Step 2: Update Record Fields
                      </div>
                      
                      
                      {/* Record Type Field */}
                      <div style={{ marginBottom: "16px" }}>
                        <label
                          style={{
                            display: "block",
                            marginBottom: "4px",
                            fontSize: "13px",
                            fontWeight: "500",
                            color: "#1A1A1A"
                          }}
                        >
                          Record Type
                        </label>
                        <select
                          value={formData.recordType || ''}
                          disabled={isFormDisabled}
                          onChange={(e) => {
                            const newRecordType = e.target.value;
                            
                            // Capture current form data with new record type for enhanced mapping
                            const currentFormDataWithNewType = {
                              ...formData,
                              recordType: newRecordType
                            };
                            
                            // Update the form data immediately
                            setFormData(currentFormDataWithNewType);
                            
                            // Fetch template using the enhanced function that preserves all form data
                            if (newRecordType && newRecordType !== '') {
                              fetchRecordTypeTemplateWithFormMapping(newRecordType, currentFormDataWithNewType);
                            } else {
                              setRecordTypeTemplate({});
                              setTemplateFields([]);
                              setDynamicCustomFields([]);
                            }
                          }}
                          style={{
                            width: '100%',
                            padding: '8px 12px',
                            borderRadius: '4px',
                            border: `1px solid ${isFormDisabled ? '#E0E0E0' : (formData.recordType ? '#006644' : '#DFE1E6')}`,
                            fontSize: '14px',
                            backgroundColor: isFormDisabled ? '#F5F5F5' : (formData.recordType ? '#F8FFF8' : 'white'),
                            color: isFormDisabled ? '#999' : '#000',
                            cursor: isFormDisabled ? 'not-allowed' : 'pointer',
                            outline: 'none',
                            boxSizing: 'border-box'
                          }}
                        >
                          <option value="">
                            {recordTypes.length === 0 ? "Loading record types..." : "Select Type"}
                          </option>
                          {recordTypes.map((recordType) => (
                            <option key={recordType.value} value={recordType.value}>
                              {recordType.label}
                            </option>
                          ))}
                        </select>
                        {(loadingRecordTypes || loadingTemplate) && (
                          <div
                            style={{
                              fontSize: "11px",
                              color: "#0066CC",
                              marginTop: "2px",
                              fontStyle: "italic"
                            }}
                          >
                            {loadingRecordTypes ? "Loading record types..." : "Loading template..."}
                          </div>
                        )}
                        <div
                          style={{
                            fontSize: "11px",
                            color: "#6B778C",
                            marginTop: "2px",
                            fontStyle: "italic"
                          }}
                        >
                          Change the record type if needed (optional)
                        </div>
                      </div>
                      
                      {/* Loading indicator when template is being fetched */}
                      {selectedAction.value === 'record-update' && loadingTemplate && (
                        <div style={{
                          padding: '24px',
                          textAlign: 'center',
                          backgroundColor: '#F8F9FA',
                          borderRadius: '8px',
                          border: '2px dashed #DFE1E6',
                          marginBottom: '16px'
                        }}>
                          <div style={{
                            fontSize: '14px',
                            color: '#0066CC',
                            fontWeight: '500',
                            marginBottom: '8px'
                          }}>
                            Loading template fields for {formData.recordType}...
                          </div>
                          <div style={{
                            fontSize: '12px',
                            color: '#6B778C',
                            fontStyle: 'italic'
                          }}>
                            Please wait while we fetch the appropriate form fields
                          </div>
                        </div>
                      )}
                      
                      {/* Dynamic Template Fields for record-update only */}
                      {selectedAction.value === 'record-update' && templateFields.length > 0 && !loadingTemplate && (
                        <div>
                          <div
                            style={{
                              fontSize: "14px",
                              fontWeight: "600",
                              color: "#1A1A1A",
                              marginBottom: "8px",
                              paddingBottom: "4px",
                              borderBottom: "1px solid #E1E5E9"
                            }}
                          >
                            {recordTypeTemplate.$id ? `${recordTypeTemplate.$id} Fields:` : recordTypeTemplate.type ? `${recordTypeTemplate.type} Fields:` : 'Template Fields:'} ({templateFields.length} fields)
                          </div>
                          
                          {/* Render Template Fields Dynamically with Grouping */}
                          {renderGroupedTemplateFields(templateFields)}
                        </div>
                      )}
                      
                      
                      {/* Fallback Standard Fields for record-update when no template */}
                      {selectedAction.value === 'record-update' && templateFields.length === 0 && !loadingTemplate && (
                        <div>
                          <div
                            style={{
                              fontSize: "14px",
                              fontWeight: "600",
                              color: "#1A1A1A",
                              marginBottom: "8px",
                              paddingBottom: "4px",
                              borderBottom: "1px solid #E1E5E9"
                            }}
                          >
                            Standard Fields:
                          </div>
                          
                          {/* Title Field */}
                          <div style={{ marginBottom: "12px" }}>
                            <label style={{ display: "block", marginBottom: "4px", fontSize: "13px", fontWeight: "500", color: "#1A1A1A" }}>
                              Title
                            </label>
                            <input
                              type="text"
                              value={formData.title || ''}
                              disabled={isFormDisabled}
                              onChange={(e) => handleInputChange('title', e.target.value)}
                              placeholder="Title"
                              style={{
                                width: '100%', padding: '8px 12px', borderRadius: '4px',
                                border: `1px solid ${isFormDisabled ? '#E0E0E0' : (formData.title ? '#006644' : '#DFE1E6')}`,
                                fontSize: '14px', backgroundColor: isFormDisabled ? '#F5F5F5' : (formData.title ? '#F8FFF8' : 'white'),
                                color: isFormDisabled ? '#999' : '#000', cursor: isFormDisabled ? 'not-allowed' : 'text',
                                outline: 'none', boxSizing: 'border-box'
                              }}
                            />
                          </div>
                          
                          {/* Name Field */}
                          <div style={{ marginBottom: "12px" }}>
                            <label style={{ display: "block", marginBottom: "4px", fontSize: "13px", fontWeight: "500", color: "#1A1A1A" }}>
                              Name (Full Name)
                            </label>
                            <input
                              type="text"
                              value={formData.name || ''}
                              disabled={isFormDisabled}
                              onChange={(e) => handleInputChange('name', e.target.value)}
                              placeholder="Full Name"
                              style={{
                                width: '100%', padding: '8px 12px', borderRadius: '4px',
                                border: `1px solid ${isFormDisabled ? '#E0E0E0' : (formData.name ? '#006644' : '#DFE1E6')}`,
                                fontSize: '14px', backgroundColor: isFormDisabled ? '#F5F5F5' : (formData.name ? '#F8FFF8' : 'white'),
                                color: isFormDisabled ? '#999' : '#000', cursor: isFormDisabled ? 'not-allowed' : 'text',
                                outline: 'none', boxSizing: 'border-box'
                              }}
                            />
                          </div>

                          {/* Login Field */}
                          <div style={{ marginBottom: "12px" }}>
                            <label style={{ display: "block", marginBottom: "4px", fontSize: "13px", fontWeight: "500", color: "#1A1A1A" }}>
                              Login/Username
                            </label>
                            <input
                              type="text"
                              value={formData.login || ''}
                              disabled={isFormDisabled}
                              onChange={(e) => handleInputChange('login', e.target.value)}
                              placeholder="Username"
                              style={{
                                width: '100%', padding: '8px 12px', borderRadius: '4px',
                                border: `1px solid ${isFormDisabled ? '#E0E0E0' : (formData.login ? '#006644' : '#DFE1E6')}`,
                                fontSize: '14px', backgroundColor: isFormDisabled ? '#F5F5F5' : (formData.login ? '#F8FFF8' : 'white'),
                                color: isFormDisabled ? '#999' : '#000', cursor: isFormDisabled ? 'not-allowed' : 'text',
                                outline: 'none', boxSizing: 'border-box'
                              }}
                            />
                          </div>

                          {/* Password Field */}
                          <div style={{ marginBottom: "12px" }}>
                            <label style={{ display: "block", marginBottom: "4px", fontSize: "13px", fontWeight: "500", color: "#1A1A1A" }}>
                              Password
                            </label>
                            <input
                              type="password"
                              value={formData.password || ''}
                              disabled={isFormDisabled}
                              onChange={(e) => handleInputChange('password', e.target.value)}
                              placeholder="Password or $GEN"
                              style={{
                                width: '100%', padding: '8px 12px', borderRadius: '4px',
                                border: `1px solid ${isFormDisabled ? '#E0E0E0' : (formData.password && formData.password !== '••••••••' ? '#006644' : '#DFE1E6')}`,
                                fontSize: '14px', backgroundColor: isFormDisabled ? '#F5F5F5' : (formData.password && formData.password !== '••••••••' ? '#F8FFF8' : 'white'),
                                color: isFormDisabled ? '#999' : '#000', cursor: isFormDisabled ? 'not-allowed' : 'text',
                                outline: 'none', boxSizing: 'border-box'
                              }}
                            />
                          </div>

                          {/* URL Field */}
                          <div style={{ marginBottom: "12px" }}>
                            <label style={{ display: "block", marginBottom: "4px", fontSize: "13px", fontWeight: "500", color: "#1A1A1A" }}>
                              URL
                            </label>
                            <input
                              type="url"
                              value={formData.url || ''}
                              disabled={isFormDisabled}
                              onChange={(e) => handleInputChange('url', e.target.value)}
                              placeholder="URL"
                              style={{
                                width: '100%', padding: '8px 12px', borderRadius: '4px',
                                border: `1px solid ${isFormDisabled ? '#E0E0E0' : (formData.url ? '#006644' : '#DFE1E6')}`,
                                fontSize: '14px', backgroundColor: isFormDisabled ? '#F5F5F5' : (formData.url ? '#F8FFF8' : 'white'),
                                color: isFormDisabled ? '#999' : '#000', cursor: isFormDisabled ? 'not-allowed' : 'text',
                                outline: 'none', boxSizing: 'border-box'
                              }}
                            />
                          </div>

                          {/* Email Field */}
                          <div style={{ marginBottom: "12px" }}>
                            <label style={{ display: "block", marginBottom: "4px", fontSize: "13px", fontWeight: "500", color: "#1A1A1A" }}>
                              Email
                            </label>
                            <input
                              type="email"
                              value={formData.email || ''}
                              disabled={isFormDisabled}
                              onChange={(e) => handleInputChange('email', e.target.value)}
                              placeholder="Email"
                              style={{
                                width: '100%', padding: '8px 12px', borderRadius: '4px',
                                border: `1px solid ${isFormDisabled ? '#E0E0E0' : (formData.email ? '#006644' : '#DFE1E6')}`,
                                fontSize: '14px', backgroundColor: isFormDisabled ? '#F5F5F5' : (formData.email ? '#F8FFF8' : 'white'),
                                color: isFormDisabled ? '#999' : '#000', cursor: isFormDisabled ? 'not-allowed' : 'text',
                                outline: 'none', boxSizing: 'border-box'
                              }}
                            />
                          </div>

                          {/* Notes Field */}
                          <div style={{ marginBottom: "12px" }}>
                            <label style={{ display: "block", marginBottom: "4px", fontSize: "13px", fontWeight: "500", color: "#1A1A1A" }}>
                              Notes
                            </label>
                            <textarea
                              value={formData.notes || ''}
                              disabled={isFormDisabled}
                              onChange={(e) => handleInputChange('notes', e.target.value)}
                              placeholder="Notes"
                              rows={3}
                              style={{
                                width: '100%', padding: '8px 12px', borderRadius: '4px',
                                border: `1px solid ${isFormDisabled ? '#E0E0E0' : (formData.notes && formData.notes !== recordDetails.notes ? '#006644' : '#DFE1E6')}`,
                                fontSize: '14px', backgroundColor: isFormDisabled ? '#F5F5F5' : (formData.notes && formData.notes !== recordDetails.notes ? '#F8FFF8' : 'white'),
                                color: isFormDisabled ? '#999' : '#000', cursor: isFormDisabled ? 'not-allowed' : 'text',
                                outline: 'none', boxSizing: 'border-box', resize: 'vertical', fontFamily: 'inherit'
                              }}
                            />
                            <div style={{ 
                              display: 'flex', 
                              alignItems: 'center', 
                              gap: '10px',
                              marginTop: '8px',
                              padding: '8px 12px',
                              backgroundColor: '#FAFBFC',
                              borderRadius: '4px',
                              border: '1px solid #DFE1E6'
                            }}>
                              <input
                                type="checkbox"
                                id="appendNotes"
                                checked={formData.appendNotes === true || formData.appendNotes === 'true'}
                                disabled={isFormDisabled}
                                onChange={(e) => handleInputChange('appendNotes', e.target.checked)}
                                style={{
                                  cursor: isFormDisabled ? 'not-allowed' : 'pointer',
                                  minWidth: '16px',
                                  width: '16px',
                                  height: '16px'
                                }}
                              />
                              <label htmlFor="appendNotes" style={{ fontSize: '12px', color: '#1A1A1A', cursor: 'pointer', flex: 1 }}>
                                <strong>Append to existing notes</strong> (if checked, adds to current notes instead of replacing)
                              </label>
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Record Add Section - Step by Step Flow */}
                  {selectedAction.value === 'record-add' && (
                    <div>
                      <div
                        style={{
                          fontSize: "16px",
                          fontWeight: "600",
                          color: "#1A1A1A",
                          marginBottom: "12px",
                          paddingBottom: "8px",
                          borderBottom: "2px solid #0066CC"
                        }}
                      >
                        Step 1: Select Record Type
                      </div>
                      
                      <div style={{ marginBottom: "16px" }}>
                        <label
                          style={{
                            display: "block",
                            marginBottom: "8px",
                            fontSize: "14px",
                            fontWeight: "500",
                            color: "#1A1A1A"
                          }}
                        >
                          Record Type <span style={{ color: "#FF5630" }}>*</span>
                        </label>
                        <select
                          value={formData.recordType || ''}
                          disabled={isFormDisabled}
                          onChange={(e) => {
                            const newRecordType = e.target.value;
                            handleInputChange('recordType', newRecordType);
                            
                            // Clear existing template fields first
                            setTemplateFields([]);
                            setDynamicCustomFields([]);
                            
                            // Prepare current form data with new record type
                            const currentFormDataWithNewType = { ...formData, recordType: newRecordType };
                            
                            // Update the form data immediately
                            setFormData(currentFormDataWithNewType);
                            
                            // Fetch template for record-add
                            if (newRecordType && newRecordType !== '') {
                              fetchRecordTypeTemplateWithFormMapping(newRecordType, currentFormDataWithNewType);
                            } else {
                              setRecordTypeTemplate({});
                              setTemplateFields([]);
                              setDynamicCustomFields([]);
                            }
                          }}
                          style={{
                            width: '100%',
                            padding: '8px 12px',
                            borderRadius: '4px',
                            border: `1px solid ${isFormDisabled ? '#E0E0E0' : (formData.recordType ? '#006644' : '#DFE1E6')}`,
                            fontSize: '14px',
                            backgroundColor: isFormDisabled ? '#F5F5F5' : (formData.recordType ? '#F8FFF8' : 'white'),
                            color: isFormDisabled ? '#999' : '#000',
                            cursor: isFormDisabled ? 'not-allowed' : 'pointer',
                            outline: 'none',
                            boxSizing: 'border-box'
                          }}
                        >
                          <option value="">
                            {recordTypes.length === 0 ? "Loading record types..." : "Select Type"}
                          </option>
                          {recordTypes.map((recordType) => (
                            <option key={recordType.value} value={recordType.value}>
                              {recordType.label}
                            </option>
                          ))}
                        </select>
                        {(loadingRecordTypes || loadingTemplate) && (
                          <div
                            style={{
                              fontSize: "11px",
                              color: "#0066CC",
                              marginTop: "2px",
                              fontStyle: "italic"
                            }}
                          >
                            {loadingRecordTypes ? "Loading record types..." : "Loading template..."}
                          </div>
                        )}
                        <div
                          style={{
                            fontSize: "11px",
                            color: "#6B778C",
                            marginTop: "4px",
                            lineHeight: "1.4"
                          }}
                        >
                          Choose the type of record you want to create
                        </div>
                      </div>

                      {/* Step 2: Show template fields after record type is selected */}
                      {formData.recordType && (
                        <div>
                          <div
                            style={{
                              fontSize: "16px",
                              fontWeight: "600",
                              color: "#1A1A1A",
                              marginBottom: "12px",
                              paddingBottom: "8px",
                              borderBottom: "2px solid #0066CC"
                            }}
                          >
                            Step 2: Configure {formData.recordType} Fields
                          </div>
                          
                          {/* Loading indicator when template is being fetched */}
                          {loadingTemplate && (
                            <div style={{
                              padding: '24px',
                              textAlign: 'center',
                              backgroundColor: '#F8F9FA',
                              borderRadius: '8px',
                              border: '2px dashed #DFE1E6',
                              marginBottom: '16px'
                            }}>
                              <div style={{
                                fontSize: '14px',
                                color: '#0066CC',
                                fontWeight: '500',
                                marginBottom: '8px'
                              }}>
                                Loading template fields for {formData.recordType}...
                              </div>
                              <div style={{
                                fontSize: '12px',
                                color: '#6B778C',
                                fontStyle: 'italic'
                              }}>
                                Please wait while we fetch the appropriate form fields
                              </div>
                            </div>
                          )}
                          
                          {/* Dynamic Template Fields */}
                          {templateFields.length > 0 && !loadingTemplate && (
                            <div>
                              <div
                                style={{
                                  fontSize: "14px",
                                  fontWeight: "600",
                                  color: "#1A1A1A",
                                  marginBottom: "8px",
                                  paddingBottom: "4px",
                                  borderBottom: "1px solid #E1E5E9"
                                }}
                              >
                                {recordTypeTemplate.$id ? `${recordTypeTemplate.$id} Fields:` : recordTypeTemplate.type ? `${recordTypeTemplate.type} Fields:` : 'Template Fields:'} ({templateFields.length} fields)
                              </div>
                              
                              {/* Render Template Fields Dynamically with Grouping */}
                              {renderGroupedTemplateFields(templateFields)}
                            </div>
                          )}
                          
                          {/* Fallback message when no template fields */}
                          {templateFields.length === 0 && !loadingTemplate && (
                            <div style={{
                              padding: '16px',
                              backgroundColor: '#FFF8E1',
                              border: '1px solid #FFC107',
                              borderRadius: '4px',
                              marginBottom: '16px'
                            }}>
                              <div style={{
                                fontSize: '14px',
                                color: '#F57C00',
                                fontWeight: '500'
                              }}>
                                No template fields available for {formData.recordType}
                              </div>
                              <div style={{
                                fontSize: '12px',
                                color: '#E65100',
                                marginTop: '4px'
                              }}>
                                You can still create the record. Standard fields will be available.
                              </div>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  )}

                  {/* Regular fields for other actions (not record-update and not record-add) */}
                  {selectedAction.value !== 'record-update' && selectedAction.value !== 'record-add' && getKeeperActionOptions().find(action => action.value === selectedAction.value)?.fields
                    .filter((field) => {
                      // Remove record field from UI when share-record is selected
                      // Remove folder field from UI when share-folder is selected  
                      // Remove sharedFolder field from UI when record-permission is selected
                      // Remove recordUid and folder fields from UI when pam-action-rotate is selected
                      // Keep user/email fields visible for manual input
                      const shouldRemoveRecordField = selectedAction.value === 'share-record' && field.name === 'record';
                      const shouldRemoveFolderField = selectedAction.value === 'share-folder' && field.name === 'folder';
                      const shouldRemoveSharedFolderField = selectedAction.value === 'record-permission' && field.name === 'sharedFolder';
                      const shouldRemovePamRotateFields = selectedAction.value === 'pam-action-rotate' && (field.name === 'recordUid' || field.name === 'folder');
                      return !shouldRemoveRecordField && !shouldRemoveFolderField && !shouldRemoveSharedFolderField && !shouldRemovePamRotateFields && field.type !== 'checkbox';
                    })
                    .map((field) => (
                      <div
                        key={field.name}
                        style={{ marginBottom: "12px" }}
                      >
                        <label
                          style={{
                            display: "block",
                            marginBottom: "4px",
                            fontSize: "13px",
                            fontWeight: "500",
                            color: "#1A1A1A"
                          }}
                        >
                          {field.label}
                          {field.required && (
                            <span style={{ color: "#FF5630", marginLeft: "4px" }}>*</span>
                          )}
                        </label>
                        {renderFormInput(field)}
                        {selectedAction.value === 'record-update' && (
                          <div
                            style={{
                              fontSize: "11px",
                              color: "#6B778C",
                              marginTop: "2px",
                              fontStyle: "italic"
                            }}
                          >
                          </div>
                        )}
                        {field.required && !formData[field.name] && selectedAction.value !== 'record-update' && (
                          <div
                            style={{
                              fontSize: "11px",
                              color: "#FF5630",
                              marginTop: "2px"
                            }}
                          >
                            This field is required
                          </div>
                        )}
                      </div>
                    ))}

                  {/* Checkbox fields for share-folder, share-record, and record-permission actions */}
                  {(selectedAction.value === 'share-folder' || selectedAction.value === 'share-record' || selectedAction.value === 'record-permission') && getKeeperActionOptions().find(action => action.value === selectedAction.value)?.fields
                    .filter((field) => {
                      // Only render checkbox fields
                      return field.type === 'checkbox';
                    })
                    .map((field) => (
                      <div
                        key={field.name}
                        style={{ marginBottom: "12px" }}
                      >
                        {renderFormInput(field)}
                      </div>
                    ))}

                  {/* Custom fields for record-update action handled on backend */}
                  
                  <div
                    style={{
                      fontSize: "11px",
                      color: "#6B778C",
                      fontStyle: "italic",
                      marginTop: "8px"
                    }}
                  >
                    * Required fields must be completed before approval
                  </div>
                </div>
              )}
            </div>

            {/* Action Buttons - Different for Admin vs Regular Users */}
            <div style={{ marginBottom: "16px" }}>
              
              {/* Show stored data status */}
              {hasStoredData && storedRequestData && showStoredRequestMessage && (
                <div style={{
                  marginBottom: "12px",
                  padding: "16px 20px",
                  backgroundColor: isAdmin ? "#EFF6FF" : "#F0FDF4",
                  borderRadius: "8px",
                  border: isAdmin ? "2px solid #93C5FD" : "2px solid #86EFAC",
                  position: "relative"
                }}>
                  {/* Close button */}
                  <button
                    onClick={() => setShowStoredRequestMessage(false)}
                    style={{
                      position: "absolute",
                      top: "12px",
                      right: "12px",
                      background: "transparent",
                      border: "none",
                      cursor: "pointer",
                      padding: "4px",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      borderRadius: "3px",
                      transition: "background-color 0.2s"
                    }}
                    onMouseEnter={(e) => e.currentTarget.style.backgroundColor = "rgba(0,0,0,0.1)"}
                    onMouseLeave={(e) => e.currentTarget.style.backgroundColor = "transparent"}
                    title="Dismiss"
                  >
                    <CrossIcon size="small" label="Close" primaryColor={isAdmin ? "#1E40AF" : "#166534"} />
                  </button>
                  
                  <div style={{
                    fontWeight: "600",
                    fontSize: "16px",
                    color: isAdmin ? "#1E40AF" : "#166534",
                    marginBottom: "8px",
                    paddingRight: "32px"
                  }}>
                    {isAdmin ? "Info Message" : "Success Message"}
                  </div>
                  <div style={{ 
                    fontSize: "14px", 
                    color: "#6B7280",
                    marginBottom: storedRequestData.timestamp ? "8px" : "0",
                    lineHeight: "1.5"
                  }}>
                    {isAdmin 
                      ? `A user has submitted a '${storedRequestData.selectedAction?.label}' request for review.`
                      : `Your ${storedRequestData.selectedAction?.label} request has been saved and is awaiting admin approval.`
                    }
                  </div>
                  {storedRequestData.timestamp && (
                    <div style={{ 
                      fontSize: "13px", 
                      color: "#9CA3AF",
                      marginTop: "8px",
                      borderTop: "1px solid #E5E7EB",
                      paddingTop: "8px"
                    }}>
                      Saved: {new Date(storedRequestData.timestamp).toLocaleString('en-GB', {
                        day: '2-digit',
                        month: '2-digit',
                        year: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit',
                        second: '2-digit',
                        hour12: false
                      })}
                    </div>
                  )}
                </div>
              )}

              {isAdmin && !isLoading && !isLoadingStoredData && !loadingTemplate && !loadingRecordTypes && !loadingRecordDetails ? (
                // Admin View - Show buttons based on their individual conditions
                <>
                <div style={{ display: "flex", gap: "12px" }}>
                  {/* Approve & Execute Button - show when there's stored data and form is valid */}
                  {hasStoredData && (
                    <Button
                      appearance="primary"
                      onClick={executeKeeperAction}
                      isLoading={isExecuting}
                      isDisabled={isExecuting || !selectedAction || !validateForm() || isFormDisabled || loadingTemplate || loadingRecordTypes}
                      style={{
                        backgroundColor: isFormDisabled ? "#D0D0D0" : 
                          (loadingTemplate || loadingRecordTypes) ? "#F0F0F0" :
                          (selectedAction && validateForm() && !isExecuting ? "#5FAD56" : isExecuting ? "#4A8F45" : "#E0E0E0"),
                        color: isFormDisabled ? "#777" : 
                          (loadingTemplate || loadingRecordTypes) ? "#999" :
                          ((selectedAction && validateForm()) || isExecuting ? "#FFFFFF" : "#999"),
                        fontWeight: "600",
                        fontSize: "14px",
                        padding: "8px 16px",
                        borderRadius: "8px",
                        border: "none",
                        cursor: isFormDisabled || loadingTemplate || loadingRecordTypes || (!selectedAction || !validateForm() || isExecuting) ? "not-allowed" : "pointer",
                        boxShadow: (selectedAction && validateForm() && !isExecuting) ? "0 2px 4px rgba(0,0,0,0.1)" : "none",
                        transition: "all 0.2s ease"
                      }}
                    >
                      {isFormDisabled ? "Form Disabled (Re-enabling...)" :
                       isExecuting ? "Approving..." :
                       loadingTemplate ? "Loading Template Fields..." :
                       loadingRecordTypes ? "Loading Record Types..." :
                       !selectedAction ? "Select Action to Enable" :
                       !validateForm() ? "Complete Required Fields" :
                       "Approve & Execute"}
                    </Button>
                  )}
                  
                  {/* Reject Button - show when there's stored data to reject */}
                  {hasStoredData && (
                    <Button
                      appearance="default"
                      onClick={() => setShowRejectionForm(true)}
                      isDisabled={isRejecting}
                      style={{
                        backgroundColor: "#E85D54",
                        color: "#FFFFFF",
                        fontWeight: "600",
                        fontSize: "14px",
                        padding: "8px 16px",
                        borderRadius: "8px",
                        border: "none",
                        cursor: isRejecting ? "not-allowed" : "pointer",
                        boxShadow: "0 2px 4px rgba(0,0,0,0.1)",
                        transition: "all 0.2s ease"
                      }}
                    >
                      Reject Request
                    </Button>
                  )}
                </div>
                
                {/* Rejection Form for Admin */}
                {showRejectionForm && (
                  <div style={{
                    marginTop: "16px",
                    backgroundColor: "#FFF5F5",
                    border: "1px solid #FFD1D1",
                    borderRadius: "6px",
                    padding: "16px"
                  }}>
                    <div style={{
                      marginBottom: "12px"
                    }}>
                      <h4 style={{
                        margin: "0 0 8px 0",
                        fontWeight: "600",
                        color: "#FF5630",
                        fontSize: "16px"
                      }}>
                        Reject Keeper Request
                      </h4>
                      <p style={{
                        margin: "0",
                        fontSize: "13px",
                        color: "#6B778C"
                      }}>
                        This will reject the request and add a comment to the JIRA ticket with your reason.
                      </p>
                    </div>
                    
                    <div style={{ marginBottom: "12px" }}>
                      <label style={{
                        display: "block",
                        marginBottom: "6px",
                        fontSize: "13px",
                        fontWeight: "500",
                        color: "#1A1A1A"
                      }}>
                        Rejection Reason <span style={{ color: "#FF5630" }}>*</span>
                      </label>
                      <textarea
                        value={rejectionReason}
                        onChange={(e) => setRejectionReason(e.target.value)}
                        placeholder="Please provide a clear reason for rejecting this request..."
                        rows={3}
                        disabled={isRejecting}
                        style={{
                          width: "100%",
                          padding: "8px 12px",
                          borderRadius: "4px",
                          border: "2px solid #DFE1E6",
                          fontSize: "14px",
                          fontFamily: "inherit",
                          resize: "vertical",
                          backgroundColor: isRejecting ? "#F5F5F5" : "#FFFFFF",
                          boxSizing: "border-box"
                        }}
                      />
                    </div>
                    
                    <div style={{
                      display: "flex",
                      gap: "12px",
                      alignItems: "center"
                    }}>
                      <Button
                        appearance="primary"
                        onClick={handleRejectRequest}
                        isLoading={isRejecting}
                        isDisabled={!rejectionReason.trim() || isRejecting}
                        style={{
                          backgroundColor: !rejectionReason.trim() || isRejecting ? "#E0E0E0" : "#E85D54",
                          color: !rejectionReason.trim() || isRejecting ? "#999" : "#FFFFFF",
                          fontWeight: "600",
                          fontSize: "14px",
                          padding: "8px 16px",
                          borderRadius: "8px",
                          border: "none",
                          cursor: !rejectionReason.trim() || isRejecting ? "not-allowed" : "pointer",
                          boxShadow: (rejectionReason.trim() && !isRejecting) ? "0 2px 4px rgba(0,0,0,0.1)" : "none",
                          transition: "all 0.2s ease"
                        }}
                      >
                        {isRejecting ? "Rejecting..." : "Confirm Rejection"}
                      </Button>
                      <Button
                        appearance="default"
                        onClick={handleCancelRejection}
                        isDisabled={isRejecting}
                        style={{
                          backgroundColor: "#FFFFFF",
                          color: "#6B778C",
                          fontWeight: "600",
                          fontSize: "14px",
                          padding: "8px 16px",
                          borderRadius: "8px",
                          border: "2px solid #DFE1E6",
                          cursor: isRejecting ? "not-allowed" : "pointer",
                          boxShadow: "0 2px 4px rgba(0,0,0,0.1)",
                          transition: "all 0.2s ease"
                        }}
                      >
                        Cancel
                      </Button>
                    </div>
                  </div>
                )}
                
                {/* Rejection Result Message for Admin */}
                {rejectionResult && (
                  <div style={{
                    marginTop: "16px",
                    padding: "12px",
                    backgroundColor: rejectionResult.success ? "#E3FCEF" : "#FFEBE6",
                    borderRadius: "4px",
                    border: rejectionResult.success ? "1px solid #ABF5D1" : "1px solid #FF5630",
                    position: "relative"
                  }}>
                    {/* Close button */}
                    <button
                      onClick={() => setRejectionResult(null)}
                      style={{
                        position: "absolute",
                        top: "8px",
                        right: "8px",
                        background: "transparent",
                        border: "none",
                        cursor: "pointer",
                        padding: "4px",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        borderRadius: "3px",
                        transition: "background-color 0.2s"
                      }}
                      onMouseEnter={(e) => e.currentTarget.style.backgroundColor = "rgba(0,0,0,0.1)"}
                      onMouseLeave={(e) => e.currentTarget.style.backgroundColor = "transparent"}
                      title="Dismiss"
                    >
                      <CrossIcon size="small" label="Close" primaryColor={rejectionResult.success ? "#006644" : "#BF2600"} />
                    </button>
                    
                    <div style={{
                      fontWeight: "600",
                      fontSize: "12px",
                      color: rejectionResult.success ? "#006644" : "#BF2600",
                      marginBottom: "4px",
                      paddingRight: "24px"
                    }}>
                      {rejectionResult.success ? "Request Rejected" : "Rejection Failed"}
                    </div>
                    <div style={{ fontSize: "11px", color: "#6B778C" }}>
                      {rejectionResult.message}
                    </div>
                  </div>
                )}
                </>
              ) : !isLoading && !isLoadingStoredData && !loadingTemplate && !loadingRecordTypes && !loadingRecordDetails ? (
                // Regular User View - Show Update button only after form loads
                <Button
                  appearance="primary"
                  onClick={updateFormData}
                  isLoading={isUpdating}
                  isDisabled={isUpdating || !selectedAction || !validateForm() || isFormDisabled || loadingTemplate || loadingRecordTypes}
                  style={{
                    backgroundColor: isFormDisabled ? "#D0D0D0" : 
                      (loadingTemplate || loadingRecordTypes) ? "#F0F0F0" :
                      (selectedAction && validateForm() && !isUpdating ? "#4285F4" : isUpdating ? "#357AE8" : "#E0E0E0"),
                    color: isFormDisabled ? "#777" : 
                      (loadingTemplate || loadingRecordTypes) ? "#999" :
                      ((selectedAction && validateForm()) || isUpdating ? "#FFFFFF" : "#999"),
                    fontWeight: "600",
                    fontSize: "14px",
                    padding: "8px 16px",
                    borderRadius: "8px",
                    border: "none",
                    cursor: isFormDisabled || loadingTemplate || loadingRecordTypes || (!selectedAction || !validateForm() || isUpdating) ? "not-allowed" : "pointer",
                    boxShadow: (selectedAction && validateForm() && !isUpdating) ? "0 2px 4px rgba(0,0,0,0.1)" : "none",
                    transition: "all 0.2s ease"
                  }}
                >
                  {isFormDisabled ? "Form Disabled (Re-enabling...)" :
                   isUpdating ? "Saving..." :
                   loadingTemplate ? "Loading Template Fields..." :
                   loadingRecordTypes ? "Loading Record Types..." :
                   !selectedAction ? "Select Action to Enable" :
                   !validateForm() ? "Complete Required Fields" :
                   hasStoredData ? "Update Request" : "Save Request"}
                </Button>
              ) : null}
              
              {/* Save Request Message for Non-Admin Users */}
              {!isAdmin && saveRequestMessage && (() => {
                const messageStyles = {
                  success: {
                    background: "#F0FDF4",
                    border: "2px solid #86EFAC",
                    titleColor: "#166534",
                    iconColor: "#166534",
                    title: "Success Message"
                  },
                  error: {
                    background: "#FEF2F2",
                    border: "2px solid #FCA5A5",
                    titleColor: "#991B1B",
                    iconColor: "#991B1B",
                    title: "Error Message"
                  },
                  warning: {
                    background: "#FFFBEB",
                    border: "2px solid #FCD34D",
                    titleColor: "#92400E",
                    iconColor: "#92400E",
                    title: "Warning Message"
                  },
                  info: {
                    background: "#EFF6FF",
                    border: "2px solid #93C5FD",
                    titleColor: "#1E40AF",
                    iconColor: "#1E40AF",
                    title: "Info Message"
                  }
                };
                
                const style = messageStyles[saveRequestMessage.type] || messageStyles.info;
                
                return (
                  <div style={{
                    marginTop: "16px",
                    padding: "16px 20px",
                    backgroundColor: style.background,
                    borderRadius: "8px",
                    border: style.border,
                    position: "relative"
                  }}>
                    {/* Close button */}
                    <button
                      onClick={() => setSaveRequestMessage(null)}
                      style={{
                        position: "absolute",
                        top: "12px",
                        right: "12px",
                        background: "transparent",
                        border: "none",
                        cursor: "pointer",
                        padding: "4px",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        borderRadius: "3px",
                        transition: "background-color 0.2s"
                      }}
                      onMouseEnter={(e) => e.currentTarget.style.backgroundColor = "rgba(0,0,0,0.1)"}
                      onMouseLeave={(e) => e.currentTarget.style.backgroundColor = "transparent"}
                      title="Dismiss"
                    >
                      <CrossIcon size="small" label="Close" primaryColor={style.iconColor} />
                    </button>
                    
                    <div style={{
                      fontWeight: "600",
                      fontSize: "16px",
                      color: style.titleColor,
                      marginBottom: "8px",
                      paddingRight: "32px"
                    }}>
                      {style.title}
                    </div>
                    <div style={{ 
                      fontSize: "14px", 
                      color: "#6B7280",
                      marginBottom: saveRequestMessage.showTimestamp ? "8px" : "0",
                      lineHeight: "1.5"
                    }}>
                      {saveRequestMessage.message}
                    </div>
                    {saveRequestMessage.showTimestamp && saveRequestMessage.timestamp && (
                      <div style={{ 
                        fontSize: "13px", 
                        color: "#9CA3AF",
                        marginTop: "8px",
                        borderTop: "1px solid #E5E7EB",
                        paddingTop: "8px"
                      }}>
                        Saved: {new Date(saveRequestMessage.timestamp).toLocaleString('en-GB', {
                          day: '2-digit',
                          month: '2-digit',
                          year: 'numeric',
                          hour: '2-digit',
                          minute: '2-digit',
                          second: '2-digit',
                          hour12: false
                        })}
                      </div>
                    )}
                  </div>
                );
              })()}
              
              {/* Clear Stored Data Button for Non-Admin Users */}
              {!isAdmin && hasStoredData && !isLoading && !isLoadingStoredData && !loadingTemplate && !loadingRecordTypes && !loadingRecordDetails && (
                <Button
                  appearance="subtle"
                  onClick={clearStoredData}
                  style={{
                    backgroundColor: "#FFFFFF",
                    color: "#4285F4",
                    fontWeight: "600",
                    fontSize: "14px",
                    padding: "8px 16px",
                    borderRadius: "8px",
                    border: "2px solid #4285F4",
                    cursor: "pointer",
                    marginTop: "16px",
                    boxShadow: "0 2px 4px rgba(0,0,0,0.1)",
                    transition: "all 0.2s ease"
                  }}
                >
                  Clear Data
                </Button>
              )}
              
            </div>
          </>
        )}

        {/* Result Display */}
        {lastResult && (
          <div style={{
            marginTop: "16px",
            marginBottom: "16px",
            padding: "12px",
            backgroundColor: lastResult.success ? "#E3FCEF" : "#FFEBE6",
            borderRadius: "4px",
            border: lastResult.success ? "1px solid #ABF5D1" : "1px solid #FF5630",
            position: "relative"
          }}>
            {/* Close button */}
            <button
              onClick={() => setLastResult(null)}
              style={{
                position: "absolute",
                top: "8px",
                right: "8px",
                background: "transparent",
                border: "none",
                cursor: "pointer",
                padding: "4px",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                borderRadius: "3px",
                transition: "background-color 0.2s"
              }}
              onMouseEnter={(e) => e.currentTarget.style.backgroundColor = "rgba(0,0,0,0.1)"}
              onMouseLeave={(e) => e.currentTarget.style.backgroundColor = "transparent"}
              title="Dismiss"
            >
              <CrossIcon size="small" label="Close" primaryColor={lastResult.success ? "#006644" : "#BF2600"} />
            </button>
            
            <div style={{
              fontWeight: "600",
              fontSize: "12px",
              color: lastResult.success ? "#006644" : "#BF2600",
              marginBottom: "4px",
              paddingRight: "24px"
            }}>
              {lastResult.success ? "Success" : "Error"}
            </div>
            <div style={{ fontSize: "11px", color: "#6B778C" }}>
              {lastResult.message}
            </div>
          </div>
        )}

        {/* Workflow info */}
        {issueContext.hasConfig && !isLoading && !isLoadingStoredData && showWorkflowInfo && (
          <div style={{
            marginTop: "16px",
            padding: "16px 20px",
            backgroundColor: "#EFF6FF",
            borderRadius: "8px",
            border: "2px solid #93C5FD",
            position: "relative"
          }}>
            {/* Close button */}
            <button
              onClick={() => setShowWorkflowInfo(false)}
              style={{
                position: "absolute",
                top: "12px",
                right: "12px",
                background: "transparent",
                border: "none",
                cursor: "pointer",
                padding: "4px",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                borderRadius: "3px",
                transition: "background-color 0.2s"
              }}
              onMouseEnter={(e) => e.currentTarget.style.backgroundColor = "rgba(0,0,0,0.1)"}
              onMouseLeave={(e) => e.currentTarget.style.backgroundColor = "transparent"}
              title="Dismiss"
            >
              <CrossIcon size="small" label="Close" primaryColor="#1E40AF" />
            </button>
            
            <div style={{
              fontWeight: "600",
              fontSize: "16px",
              color: "#1E40AF",
              marginBottom: "8px",
              paddingRight: "32px"
            }}>
              {isAdmin ? "Admin Review Mode" : "Request Submission Mode"}
            </div>
            <div style={{ 
              fontSize: "14px", 
              color: "#6B7280",
              lineHeight: "1.5"
            }}>
              {isAdmin 
                ? "Review user requests and use 'Approve & Execute' to run approved actions via ngrok API, or 'Reject Request' to decline with feedback."
                : "Fill out the form and use 'Save Request' to submit your Keeper action for admin review and approval."
              }
            </div>
          </div>
        )}

        {/* Simple Address Modal */}
        {showNewAddressModal && (
          <div style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: 'rgba(0, 0, 0, 0.5)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 10000
          }}>
            <div style={{
              backgroundColor: 'white',
              borderRadius: '8px',
              padding: '24px',
              maxWidth: '500px',
              width: '90%',
              maxHeight: '80vh',
              overflow: 'auto',
              boxShadow: '0 4px 20px rgba(0,0,0,0.3)'
            }}>
              <div style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                marginBottom: '20px'
              }}>
                <h3 style={{
                  margin: 0,
                  fontSize: '18px',
                  fontWeight: '600',
                  color: '#1A1A1A'
                }}>
                  Create New Address
                </h3>
                <button
                  onClick={() => setShowNewAddressModal(false)}
                  style={{
                    background: 'none',
                    border: 'none',
                    fontSize: '20px',
                    cursor: 'pointer',
                    color: '#6B778C',
                    padding: '4px'
                  }}
                >
                  ×
                </button>
              </div>

              <div>
                {/* Simple address form fields */}
                <div style={{ marginBottom: '16px' }}>
                  <label style={{
                    display: 'block',
                    marginBottom: '6px',
                    fontSize: '14px',
                    fontWeight: '500',
                    color: '#1A1A1A'
                  }}>
                    Title *
                  </label>
                  <input
                    type="text"
                    value={newAddressFormData.title || ''}
                    onChange={(e) => handleAddressFieldChange('title', e.target.value)}
                    placeholder="Enter address title"
                    style={{
                      width: '100%',
                      padding: '8px 12px',
                      borderRadius: '4px',
                      border: '1px solid #DFE1E6',
                      fontSize: '14px',
                      boxSizing: 'border-box'
                    }}
                  />
                </div>

                <div style={{ marginBottom: '16px' }}>
                  <label style={{
                    display: 'block',
                    marginBottom: '6px',
                    fontSize: '14px',
                    fontWeight: '500',
                    color: '#1A1A1A'
                  }}>
                    Street Address
                  </label>
                  <input
                    type="text"
                    value={newAddressFormData.street1 || ''}
                    onChange={(e) => handleAddressFieldChange('street1', e.target.value)}
                    placeholder="Enter street address"
                    style={{
                      width: '100%',
                      padding: '8px 12px',
                      borderRadius: '4px',
                      border: '1px solid #DFE1E6',
                      fontSize: '14px',
                      boxSizing: 'border-box'
                    }}
                  />
                </div>

                <div style={{ marginBottom: '16px' }}>
                  <label style={{
                    display: 'block',
                    marginBottom: '6px',
                    fontSize: '14px',
                    fontWeight: '500',
                    color: '#1A1A1A'
                  }}>
                    Street Address 2
                  </label>
                  <input
                    type="text"
                    value={newAddressFormData.street2 || ''}
                    onChange={(e) => handleAddressFieldChange('street2', e.target.value)}
                    placeholder="Enter street address 2 (optional)"
                    style={{
                      width: '100%',
                      padding: '8px 12px',
                      borderRadius: '4px',
                      border: '1px solid #DFE1E6',
                      fontSize: '14px',
                      boxSizing: 'border-box'
                    }}
                  />
                </div>

                <div style={{ marginBottom: '16px' }}>
                  <label style={{
                    display: 'block',
                    marginBottom: '6px',
                    fontSize: '14px',
                    fontWeight: '500',
                    color: '#1A1A1A'
                  }}>
                    City
                  </label>
                  <input
                    type="text"
                    value={newAddressFormData.city || ''}
                    onChange={(e) => handleAddressFieldChange('city', e.target.value)}
                    placeholder="Enter city"
                    style={{
                      width: '100%',
                      padding: '8px 12px',
                      borderRadius: '4px',
                      border: '1px solid #DFE1E6',
                      fontSize: '14px',
                      boxSizing: 'border-box'
                    }}
                  />
                </div>

                <div style={{ marginBottom: '16px' }}>
                  <label style={{
                    display: 'block',
                    marginBottom: '6px',
                    fontSize: '14px',
                    fontWeight: '500',
                    color: '#1A1A1A'
                  }}>
                    State
                  </label>
                  <input
                    type="text"
                    value={newAddressFormData.state || ''}
                    onChange={(e) => handleAddressFieldChange('state', e.target.value)}
                    placeholder="Enter state"
                    style={{
                      width: '100%',
                      padding: '8px 12px',
                      borderRadius: '4px',
                      border: '1px solid #DFE1E6',
                      fontSize: '14px',
                      boxSizing: 'border-box'
                    }}
                  />
                </div>

                <div style={{ marginBottom: '16px' }}>
                  <label style={{
                    display: 'block',
                    marginBottom: '6px',
                    fontSize: '14px',
                    fontWeight: '500',
                    color: '#1A1A1A'
                  }}>
                    ZIP Code
                  </label>
                  <input
                    type="text"
                    value={newAddressFormData.zip || ''}
                    onChange={(e) => handleAddressFieldChange('zip', e.target.value)}
                    placeholder="Enter ZIP code"
                    style={{
                      width: '100%',
                      padding: '8px 12px',
                      borderRadius: '4px',
                      border: '1px solid #DFE1E6',
                      fontSize: '14px',
                      boxSizing: 'border-box'
                    }}
                  />
                </div>

                <div style={{ marginBottom: '16px' }}>
                  <label style={{
                    display: 'block',
                    marginBottom: '6px',
                    fontSize: '14px',
                    fontWeight: '500',
                    color: '#1A1A1A'
                  }}>
                    Country
                  </label>
                  <input
                    type="text"
                    value={newAddressFormData.country || ''}
                    onChange={(e) => handleAddressFieldChange('country', e.target.value)}
                    placeholder="Enter country"
                    style={{
                      width: '100%',
                      padding: '8px 12px',
                      borderRadius: '4px',
                      border: '1px solid #DFE1E6',
                      fontSize: '14px',
                      boxSizing: 'border-box'
                    }}
                  />
                </div>

                <div style={{ marginBottom: '20px' }}>
                  <label style={{
                    display: 'block',
                    marginBottom: '6px',
                    fontSize: '14px',
                    fontWeight: '500',
                    color: '#1A1A1A'
                  }}>
                    Notes
                  </label>
                  <textarea
                    value={newAddressFormData.notes || ''}
                    onChange={(e) => handleAddressFieldChange('notes', e.target.value)}
                    placeholder="Enter notes (optional)"
                    rows={3}
                    style={{
                      width: '100%',
                      padding: '8px 12px',
                      borderRadius: '4px',
                      border: '1px solid #DFE1E6',
                      fontSize: '14px',
                      boxSizing: 'border-box',
                      resize: 'vertical'
                    }}
                  />
                </div>
                
                <div style={{
                  display: 'flex',
                  gap: '12px',
                  justifyContent: 'flex-end',
                  marginTop: '20px'
                }}>
                  <button
                    onClick={() => setShowNewAddressModal(false)}
                    style={{
                      padding: '8px 16px',
                      borderRadius: '4px',
                      border: '1px solid #DFE1E6',
                      backgroundColor: 'white',
                      color: '#6B778C',
                      cursor: 'pointer',
                      fontSize: '14px'
                    }}
                  >
                    Cancel
                  </button>
                  <button
                    onClick={saveNewAddress}
                    disabled={!newAddressFormData.title}
                    style={{
                      padding: '8px 16px',
                      borderRadius: '4px',
                      border: 'none',
                      backgroundColor: newAddressFormData.title ? '#0066CC' : '#E0E0E0',
                      color: newAddressFormData.title ? 'white' : '#999',
                      cursor: newAddressFormData.title ? 'pointer' : 'not-allowed',
                      fontSize: '14px'
                    }}
                  >
                    Create Address
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default IssuePanel;
