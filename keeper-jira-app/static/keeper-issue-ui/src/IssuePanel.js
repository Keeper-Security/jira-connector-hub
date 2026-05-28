import React, { useState, useEffect, useRef, useMemo } from "react";

import Button from "@atlaskit/button";
import SectionMessage from "@atlaskit/section-message";
import Spinner from "@atlaskit/spinner";

// Icons
import SuccessIcon from "@atlaskit/icon/glyph/check-circle";
import ErrorIcon from "@atlaskit/icon/glyph/error";
import LockIcon from "@atlaskit/icon/glyph/lock";
import CrossIcon from "@atlaskit/icon/glyph/cross";

import { KEEPER_ACTION_OPTIONS, KEEPER_ACTION_OPTIONS_NSF, SUPPORTED_RECORD_TYPES, PAGINATION_SETTINGS } from "./constants";
import * as api from "./services/api";
import { handleApiError as handleApiErrorUtil, isStructuredError, getErrorCode } from "./utils/errorHandler";
import { formatWithUid, filterByTitleOrUid } from "./utils/formatters";
import EpmApprovalPanel from "./components/issue/EpmApprovalPanel";
import DeviceApprovalPanel from "./components/issue/DeviceApprovalPanel";
import PaginationFooter from "./components/issue/PaginationFooter";
import LoadingPlaceholder from "./components/issue/LoadingPlaceholder";
import SelectedItemChip from "./components/issue/SelectedItemChip";
import SearchHint from "./components/issue/SearchHint";
import FormField from "./components/issue/FormField";
import RequirementsBlock from "./components/issue/RequirementsBlock";
import ActionSelector from "./components/issue/ActionSelector";
import "./styles/IssuePanel.css";

// Keeper action options - using imported constant
const keeperActionOptions = KEEPER_ACTION_OPTIONS;

// Page slice + totals. Pure helper.
const paginate = (items, page, pageSize) => {
  const totalPages = Math.ceil(items.length / pageSize);
  const startIndex = (page - 1) * pageSize;
  return {
    items: items.slice(startIndex, startIndex + pageSize),
    totalPages,
  };
};

// Reset picker page to 1 when search text changes.
function useResetPageOnSearch(searchTerm, setPage) {
  useEffect(() => {
    setPage(1);
  }, [searchTerm, setPage]);
}

const IssuePanel = () => {
  const [issueContext, setIssueContext] = useState(null);
  const [isExecuting, setIsExecuting] = useState(false);
  const [lastResult, setLastResult] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [selectedAction, setSelectedAction] = useState(null);
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
  const [recordForUpdateSearchTerm, setRecordForUpdateSearchTerm] = useState("");
  const [showRecordForUpdateDropdown, setShowRecordForUpdateDropdown] = useState(false);
  const [recordForUpdateCurrentPage, setRecordForUpdateCurrentPage] = useState(1);
  const [recordDetails, setRecordDetails] = useState({});
  const [loadingRecordDetails, setLoadingRecordDetails] = useState(false);
  const [resolvedAddresses, setResolvedAddresses] = useState({}); // Cache for resolved address references
  const [loadingAddresses, setLoadingAddresses] = useState(new Set()); // Track loading address references
  const [showPinCode, setShowPinCode] = useState(false); // Toggle for PIN code visibility
  const [showSecureNote, setShowSecureNote] = useState(false); // Toggle for secure note visibility
  const [showLicenseKey, setShowLicenseKey] = useState(false); // Toggle for license key visibility
  const [showPrivateKey, setShowPrivateKey] = useState(false); // Toggle for SSH private key visibility
  const [showPublicKey, setShowPublicKey] = useState(false); // Toggle for SSH public key visibility
  const [showPassword, setShowPassword] = useState(false); // Toggle for password visibility
  const [phoneEntries, setPhoneEntries] = useState([]); // Dynamic phone entries - starts empty, populated from record or user adds
  const [recordTypes, setRecordTypes] = useState([]);
  const [loadingRecordTypes, setLoadingRecordTypes] = useState(false);
  const [recordTypeTemplate, setRecordTypeTemplate] = useState({});
  const [loadingTemplate, setLoadingTemplate] = useState(false);
  const [templateFields, setTemplateFields] = useState([]);
  const [templateError, setTemplateError] = useState(null); // Track template loading errors
  const [originalRecordType, setOriginalRecordType] = useState(null); // Track original record type
  const [originalFormData, setOriginalFormData] = useState({}); // Store original form data
  const [originalComplexFields, setOriginalComplexFields] = useState({}); // Store original complex field values for merging (name, address, host, etc.)
  
  // New workflow states
  const [isAdmin, setIsAdmin] = useState(false); // Track if current user is admin
  const [storedRequestData, setStoredRequestData] = useState(null); // Store user's saved request
  const [hasStoredData, setHasStoredData] = useState(false); // Track if data has been stored
  const [isUpdating, setIsUpdating] = useState(false); // Track update operation
  const [isItsmApprovalTicket, setIsItsmApprovalTicket] = useState(false); // Ticket created by JIRA ITSM Forge app for an EPM approval request (label: ITSM_approval_request_created)
  const [isItsmDeviceApprovalTicket, setIsItsmDeviceApprovalTicket] = useState(false); // Ticket for a device admin approval request (label: ITSM_device_admin_approval_requested)


  // Expiration warning modal for share-record action
  const [showExpirationWarningModal, setShowExpirationWarningModal] = useState(false);
  const [pendingExpirationValue, setPendingExpirationValue] = useState(null);
  
  // Email validation state
  const [emailValidationError, setEmailValidationError] = useState(null);

  // Vault mode: NSF by default; Classic when user opts in via checkbox.
  const [isNsfMode, setIsNsfMode] = useState(true);

  // Rotation-on-expiration: visible when selected record is pamUser or folder is ROE-eligible.
  const [rotateOnExpiration, setRotateOnExpiration] = useState(false);
  const [isRotationEligible, setIsRotationEligible] = useState(false);
  const [checkingRotationEligibility, setCheckingRotationEligibility] = useState(false);

  // Pagination settings
  const itemsPerPage = PAGINATION_SETTINGS.ITEMS_PER_PAGE;
  const recordsPerPage = PAGINATION_SETTINGS.RECORDS_PER_PAGE;
  const foldersPerPage = PAGINATION_SETTINGS.FOLDERS_PER_PAGE;

  // Error handler wrapper for API calls
  const handleApiError = (error, defaultMessage = "An error occurred") => {
    return handleApiErrorUtil(error, defaultMessage);
  };
  
  // Helper to check if result is a structured error
  const checkResultError = (result) => {
    return isStructuredError(result);
  };

  // Classic / NSF badge for picker items; defaults to Classic if source is missing.
  const renderSourceBadge = (item) => {
    if (!item) return null;
    const source = item.source || 'classic';
    const isNsf = source === 'nsf';
    return (
      <span className={`source-badge ${isNsf ? 'source-badge-nsf' : 'source-badge-classic'}`}>
        {isNsf ? 'New' : 'Classic'}
      </span>
    );
  };

  // Lock mode checkbox when admin opens any stored request.
  const isModeLocked = isAdmin && hasStoredData;

  const activeVaultMode = isNsfMode ? 'nsf' : 'classic';

  const isSharableFolder = (folder) =>
    folder.source === 'nsf' || folder.shared || (folder.flags && folder.flags.includes('S'));

  // Render nested NSF folder path (hidden for Classic or when path equals folder name).
  const renderFolderPath = (folder) => {
    if (!folder) return null;
    const path = folder.path || folder.folderPath || '';
    if (!path || path === folder.name || path === folder.title) return null;
    return <div className="nsf-folder-path">{path}</div>;
  };

  // Merged action options (Classic + NSF overrides), memoized on mode/types/role.
  const actionOptions = useMemo(() => {
    const nsfOverridesByValue = isNsfMode
      ? KEEPER_ACTION_OPTIONS_NSF.reduce((acc, action) => {
          acc[action.value] = action;
          return acc;
        }, {})
      : {};

    return keeperActionOptions
      .map(action => {
        const merged = nsfOverridesByValue[action.value] || action;
        if (merged.value === 'record-update' || merged.value === 'record-add') {
          return {
            ...merged,
            fields: merged.fields.map(field => {
              if (field.name === 'recordType') {
                return { ...field, options: recordTypes };
              }
              return field;
            })
          };
        }
        return merged;
      })
      .filter(action => {
        if ((action.value === 'record-add' || action.value === 'record-update') && !isAdmin) {
          return false;
        }
        return true;
      });
  }, [isNsfMode, recordTypes, isAdmin]);

  // Filter and paginate options
  const filteredOptions = actionOptions.filter(option =>
    option.label.toLowerCase().includes(searchTerm.toLowerCase()) ||
    option.description.toLowerCase().includes(searchTerm.toLowerCase()) ||
    option.value.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const { items: paginatedOptions, totalPages } = paginate(filteredOptions, currentPage, itemsPerPage);

  // Defense-in-depth: filter records/folders to match active vault mode.
  // Primary gate is `source` (set by backend); secondary gate uses Commander's
  // `record_category` in classic mode to reject any Nested records that leaked
  // through (Commander's `list` returns the entire vault).  NSF mode skips the
  // category check because `nsf-list` already scopes to nested records and the
  // parsed output may not carry `record_category`.
  const recordsForActiveMode = keeperRecords.filter(record => {
    if ((record.source || 'classic') !== activeVaultMode) return false;
    if (activeVaultMode === 'classic') {
      return (record.record_category || 'classic').toLowerCase() === 'classic';
    }
    return true;
  });
  const foldersForActiveMode = keeperFolders.filter(folder => (folder.source || 'classic') === activeVaultMode);

  // Filter and paginate records (search by title or UID)
  const filteredRecords = filterByTitleOrUid(recordsForActiveMode, recordSearchTerm, 'title', 'record_uid');
  const { items: paginatedRecords, totalPages: totalRecordPages } = paginate(filteredRecords, recordCurrentPage, recordsPerPage);

  const getFilteredFolders = () => {
    let foldersToFilter = foldersForActiveMode;

    // For share/permission actions, show only sharable folders.
    if (selectedAction?.value === 'record-permission' || selectedAction?.value === 'share-folder') {
      foldersToFilter = foldersToFilter.filter(isSharableFolder);
    }

    return filterByTitleOrUid(foldersToFilter, folderSearchTerm, ['name', 'title'], ['folder_uid', 'folderUid']);
  };
  
  const filteredFolders = getFilteredFolders();
  const { items: paginatedFolders, totalPages: totalFolderPages } = paginate(filteredFolders, folderCurrentPage, foldersPerPage);

  // Records for record-update (filtered by active vault mode).
  const filteredRecordsForUpdate = filterByTitleOrUid(recordsForActiveMode, recordForUpdateSearchTerm, 'title', 'record_uid');
  const { items: paginatedRecordsForUpdate, totalPages: totalRecordForUpdatePages } = paginate(
    filteredRecordsForUpdate,
    recordForUpdateCurrentPage,
    recordsPerPage
  );

  useResetPageOnSearch(searchTerm, setCurrentPage);
  useResetPageOnSearch(recordSearchTerm, setRecordCurrentPage);
  useResetPageOnSearch(folderSearchTerm, setFolderCurrentPage);
  useResetPageOnSearch(recordForUpdateSearchTerm, setRecordForUpdateCurrentPage);

  // Monotonic token for the vault refetch cycle. Only the latest call may
  // write records/folders state or reset loading flags.
  const vaultFetchTokenRef = useRef(0);

  // Pure fetchers: return data on success, throw structured errors so the
  // coordinator can surface them instead of silently writing [].
  const fetchRecordsForMode = async (mode) => {
    const result = await api.getKeeperRecords(mode);
    if (isStructuredError(result)) throw result;
    return Array.isArray(result?.records) ? result.records : [];
  };

  const fetchFoldersForMode = async (mode) => {
    const result = await api.getKeeperFolders(mode);
    if (isStructuredError(result)) throw result;
    return Array.isArray(result?.folders) ? result.folders : [];
  };

  // Maps a Keeper action to which vault data the form actually needs.
  const computeFetchPlan = (action) => ({
    records: action === 'share-record' || action === 'record-update',
    folders:
      action === 'share-record' ||
      action === 'share-folder' ||
      action === 'record-permission' ||
      action === 'record-add',
  });

  // Single coordinator for records+folders. Owns the token, runs fetches in
  // parallel via Promise.allSettled so a single failure cannot wipe the other
  // list. Race-safe for rapid mode/action changes via the token guard.
  const refetchVaultData = async ({ mode, action }) => {
    const plan = computeFetchPlan(action);
    const shouldFetch = (issueContext?.hasConfig || isAdmin) && (plan.records || plan.folders);
    if (!shouldFetch) return;

    const token = ++vaultFetchTokenRef.current;
    if (plan.records) setLoadingRecords(true);
    if (plan.folders) setLoadingFolders(true);

    const settled = await Promise.allSettled([
      plan.records ? fetchRecordsForMode(mode) : Promise.resolve(null),
      plan.folders ? fetchFoldersForMode(mode) : Promise.resolve(null),
    ]);

    if (token !== vaultFetchTokenRef.current) return;

    const [recordsResult, foldersResult] = settled;
    let firstError = null;

    if (plan.records) {
      if (recordsResult.status === 'fulfilled') {
        setKeeperRecords(recordsResult.value || []);
      } else {
        setKeeperRecords([]);
        firstError = firstError || recordsResult.reason;
      }
    }

    if (plan.folders) {
      if (foldersResult.status === 'fulfilled') {
        setKeeperFolders(foldersResult.value || []);
      } else {
        setKeeperFolders([]);
        firstError = firstError || foldersResult.reason;
      }
    }

    if (firstError) {
      setLastResult({
        success: false,
        message: handleApiError(firstError, 'Failed to load Keeper vault data'),
      });
    }

    if (plan.records) setLoadingRecords(false);
    if (plan.folders) setLoadingFolders(false);
  };

  // Reset all selection state when switching vault mode.
  const resetVaultSelectionState = () => {
    setSelectedRecord(null);
    setSelectedFolder(null);
    setSelectedRecordForUpdate(null);
    setKeeperRecords([]);
    setKeeperFolders([]);
    setRecordSearchTerm('');
    setFolderSearchTerm('');
    setRecordForUpdateSearchTerm('');
    setRecordCurrentPage(1);
    setFolderCurrentPage(1);
    setRecordForUpdateCurrentPage(1);
    setShowRecordDropdown(false);
    setShowFolderDropdown(false);
    setShowRecordForUpdateDropdown(false);
    setRotateOnExpiration(false);
    setIsRotationEligible(false);
    lastCheckedRoeRef.current = { type: '', uid: '' };
    setFormData(prev => {
      const cleared = { ...prev };
      delete cleared.can_share;
      delete cleared.can_write;
      delete cleared.manage_records;
      delete cleared.manage_users;
      delete cleared.can_edit;
      delete cleared.role;
      delete cleared.recursive;
      return cleared;
    });
  };

  const handleNsfToggle = (next) => {
    setIsNsfMode(next);
    resetVaultSelectionState();
    // Eagerly mark loading so the spinner shows in the same render as the toggle.
    // Effect B drives the actual refetch (admin only), so guard here matches.
    const action = selectedAction?.value;
    const willFetch = isAdmin && action && !isLoadingStoredData;
    if (willFetch) {
      const plan = computeFetchPlan(action);
      if (plan.records) setLoadingRecords(true);
      if (plan.folders) setLoadingFolders(true);
    }
  };
  // Flag to track if we're preserving stored data
  const [isPreservingStoredData, setIsPreservingStoredData] = useState(false);
  const isPreservingStoredDataRef = useRef(false);
  const lastCheckedRoeRef = useRef({ type: '', uid: '' });

  // Fetch Keeper record details when needed for record-update
  const fetchKeeperRecordDetails = async (recordUid, preserveStoredData = null) => {
    setLoadingRecordDetails(true);
    try {
      const result = await api.getKeeperRecordDetails(recordUid);
      
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
          });
        }
        
        // Extract and store original complex field values for merging during updates
        // This ensures we can merge partial updates with existing values
        const complexFields = {};
        
        // Check TOP LEVEL properties first (Keeper stores name, address, etc. at top level for some record types)
        if (details.name && typeof details.name === 'object') {
          complexFields.name = { ...details.name };
        }
        if (details.address && typeof details.address === 'object') {
          complexFields.address = { ...details.address };
        }
        if (details.host && typeof details.host === 'object') {
          complexFields.host = { ...details.host };
        }
        if (details.pamHostname && typeof details.pamHostname === 'object') {
          complexFields.pamHostname = { ...details.pamHostname };
        }
        if (details.keyPair && typeof details.keyPair === 'object') {
          complexFields.keyPair = { ...details.keyPair };
        }
        
        // Check CUSTOM array (pamUser and other record types store complex fields here)
        if (details.custom && Array.isArray(details.custom)) {
          details.custom.forEach(field => {
            if (field.value && field.value.length > 0) {
              const fieldValue = field.value[0];
              if (typeof fieldValue === 'object' && fieldValue !== null) {
                // Only set if not already found at top level
                if (field.type === 'name' && !complexFields.name) {
                  complexFields.name = { ...fieldValue };
                } else if (field.type === 'address' && !complexFields.address) {
                  complexFields.address = { ...fieldValue };
                } else if (field.type === 'host' && !complexFields.host) {
                  complexFields.host = { ...fieldValue };
                } else if (field.type === 'pamHostname' && !complexFields.pamHostname) {
                  complexFields.pamHostname = { ...fieldValue };
                } else if (field.type === 'keyPair' && !complexFields.keyPair) {
                  complexFields.keyPair = { ...fieldValue };
                }
              }
            }
          });
        }
        
        // Also check fields array as fallback (some record types store data there)
        if (details.fields && Array.isArray(details.fields)) {
          details.fields.forEach(field => {
            if (field.value && field.value.length > 0) {
              const fieldValue = field.value[0];
              if (typeof fieldValue === 'object' && fieldValue !== null) {
                // Only set if not already found
                if (field.type === 'name' && !complexFields.name) {
                  complexFields.name = { ...fieldValue };
                } else if (field.type === 'address' && !complexFields.address) {
                  complexFields.address = { ...fieldValue };
                } else if (field.type === 'host' && !complexFields.host) {
                  complexFields.host = { ...fieldValue };
                } else if (field.type === 'pamHostname' && !complexFields.pamHostname) {
                  complexFields.pamHostname = { ...fieldValue };
                } else if (field.type === 'keyPair' && !complexFields.keyPair) {
                  complexFields.keyPair = { ...fieldValue };
                }
              }
            }
          });
        }
        setOriginalComplexFields(complexFields);
        
        // Ensure all standard fields have at least empty string values
        if (!existingValues.login) existingValues.login = '';
        if (!existingValues.password) existingValues.password = '';
        if (!existingValues.url) existingValues.url = '';
        if (!existingValues.email) existingValues.email = '';
        if (!existingValues.notes) existingValues.notes = '';
        
        // Create dynamic custom fields based on actual record data from fields array
        const customFields = [];
        const standardFieldTypes = ['title', 'login', 'password', 'url', 'email', 'notes', 'name', 'oneTimeCode'];
        
        if (details.fields && Array.isArray(details.fields)) {
          details.fields.forEach(field => {
            // Skip standard field types and empty fields
            if (!standardFieldTypes.includes(field.type) && field.value && field.value.length > 0) {
              // Handle field types as simple custom fields
              if (typeof field.value[0] === 'string') {
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
        
        // For record-update, don't populate custom fields with existing values
        // User should see empty fields and fill only what they want to change
        // Store custom field definitions for reference but don't set their values
        const blankCustomFields = customFields.map(field => ({
          ...field,
          value: '', // Keep field definition but clear the value
          required: false, // For update, no fields are required - only fill what you want to change
          placeholder: `Enter new ${field.displayName.toLowerCase()} (leave blank to keep current)`
        }));
        
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
          // Complex JSON fields (name, address, host, etc.) are merged at submission time
          // to prevent data loss while keeping the form fields blank for partial updates
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
          
          // Populate phone entries for contact records
          if (details.type === 'contact' && details.fields && Array.isArray(details.fields)) {
            const phoneFields = details.fields.filter(f => f.type === 'phone');
            if (phoneFields.length > 0) {
              const existingPhones = phoneFields.map((phone, idx) => {
                const phoneValue = phone.value?.[0] || {};
                const phoneNumber = phoneValue.number || '';
                return {
                  id: idx + 1,
                  region: phoneValue.region || 'US',
                  number: phoneNumber,
                  originalNumber: phoneNumber, // Store original for masking
                  ext: phoneValue.ext || '',
                  type: phoneValue.type || 'Mobile',
                  isNew: false,
                  isEdited: false
                };
              }).filter(entry => entry.number);
              
              if (existingPhones.length > 0) {
                setPhoneEntries(existingPhones);
              }
            }
          }
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
    } finally {
      setLoadingRecordDetails(false);
    }
  };

  // KJ-26-02: Fetch record types from the backend, which intersects
  // Commander's `rti --effective` output with the app's supported set.
  // Falls back to the frontend constant on any failure (no regression).
  const fetchRecordTypes = async () => {
    setLoadingRecordTypes(true);
    try {
      const result = await api.getRecordTypes();
      if (result?.recordTypes && Array.isArray(result.recordTypes) && result.recordTypes.length > 0) {
        setRecordTypes(result.recordTypes);
      } else {
        setRecordTypes(SUPPORTED_RECORD_TYPES);
      }
    } catch {
      setRecordTypes(SUPPORTED_RECORD_TYPES);
    } finally {
      setLoadingRecordTypes(false);
    }
  };

  // Static field templates for each record type
  const getStaticRecordTypeTemplate = (recordType) => {
    const templates = {
      'login': {
        fields: [
          { name: 'title', label: 'Title', type: 'text', required: true, placeholder: 'Enter record title' },
          { name: 'login', label: 'Login', type: 'text', required: false, placeholder: 'Username or email' },
          { name: 'password', label: 'Password', type: 'password', required: false, placeholder: 'Password or $GEN' },
          { name: 'url', label: 'URL', type: 'url', required: false, placeholder: 'https://example.com' },
          { name: 'notes', label: 'Notes', type: 'textarea', required: false, placeholder: 'Additional notes...' }
        ]
      },
      'contact': {
        fields: [
          { name: 'title', label: 'Title', type: 'text', required: true, placeholder: 'Contact name (e.g., John Smith)' },
          { name: 'name_first', label: 'First Name', type: 'text', required: true, placeholder: 'First name', parentType: 'name', subField: 'first' },
          { name: 'name_middle', label: 'Middle Name', type: 'text', required: false, placeholder: 'Middle name', parentType: 'name', subField: 'middle' },
          { name: 'name_last', label: 'Last Name', type: 'text', required: true, placeholder: 'Last name', parentType: 'name', subField: 'last' },
          { name: 'text.company', label: 'Company', type: 'text', required: false, placeholder: 'Company name (e.g., ABC Corporation)' },
          { name: 'email', label: 'Email', type: 'email', required: false, placeholder: 'email@example.com' },
          { name: 'phoneNumbers', label: 'Phone Number', type: 'phoneEntries', required: false },
          { name: 'notes', label: 'Notes', type: 'textarea', required: false, placeholder: 'Additional notes...' }
        ]
      },
      'databaseCredentials': {
        fields: [
          { name: 'title', label: 'Title', type: 'text', required: true, placeholder: 'Database name' },
          { name: 'text.type', label: 'Database Type', type: 'text', required: false, placeholder: 'e.g., PostgreSQL, MySQL, MongoDB' },
          { name: 'host_hostName', label: 'Host', type: 'text', required: false, placeholder: 'hostname or IP (e.g., db.company.com)', parentType: 'host', subField: 'hostName' },
          { name: 'host_port', label: 'Port', type: 'text', required: false, placeholder: 'Port number (e.g., 5432, 27017)', parentType: 'host', subField: 'port' },
          { name: 'login', label: 'Login', type: 'text', required: false, placeholder: 'Database username' },
          { name: 'password', label: 'Password', type: 'password', required: false, placeholder: 'Password or $GEN' },
          { name: 'notes', label: 'Notes', type: 'textarea', required: false, placeholder: 'Additional notes...' }
        ]
      },
      'encryptedNotes': {
        fields: [
          { name: 'title', label: 'Title', type: 'text', required: true, placeholder: 'Note title (e.g., Important Information, Recovery Codes)' },
          { name: 'note', label: 'Secured Note', type: 'secureTextarea', required: false, placeholder: 'Enter your secured/confidential note content...' },
          { name: 'date', label: 'Date', type: 'date', required: false, placeholder: 'YYYY-MM-DD' }
        ]
      },
      'membership': {
        fields: [
          { name: 'title', label: 'Title', type: 'text', required: true, placeholder: 'Membership name (e.g., Gold\'s Gym, IEEE Membership)' },
          { name: 'accountNumber', label: 'Account Number', type: 'text', required: false, placeholder: 'Membership ID (e.g., GYM123456)' },
          { name: 'name_first', label: 'First Name', type: 'text', required: false, placeholder: 'First name', parentType: 'name', subField: 'first' },
          { name: 'name_middle', label: 'Middle Name', type: 'text', required: false, placeholder: 'Middle name', parentType: 'name', subField: 'middle' },
          { name: 'name_last', label: 'Last Name', type: 'text', required: false, placeholder: 'Last name', parentType: 'name', subField: 'last' },
          { name: 'password', label: 'Password', type: 'password', required: false, placeholder: 'Password' },
          { name: 'notes', label: 'Notes', type: 'textarea', required: false, placeholder: 'Additional notes...' }
        ]
      },
      'serverCredentials': {
        fields: [
          { name: 'title', label: 'Title', type: 'text', required: true, placeholder: 'Server name (e.g., Production Web Server)' },
          { name: 'host_hostName', label: 'Host', type: 'text', required: false, placeholder: 'hostname or IP (e.g., web.company.com)', parentType: 'host', subField: 'hostName' },
          { name: 'host_port', label: 'Port', type: 'text', required: false, placeholder: 'Port number (e.g., 22)', parentType: 'host', subField: 'port' },
          { name: 'login', label: 'Username', type: 'text', required: false, placeholder: 'Server username' },
          { name: 'password', label: 'Password', type: 'password', required: false, placeholder: 'Password or $GEN' },
          { name: 'notes', label: 'Notes', type: 'textarea', required: false, placeholder: 'Additional notes...' }
        ]
      },
      'softwareLicense': {
        fields: [
          { name: 'title', label: 'Title', type: 'text', required: true, placeholder: 'Software name' },
          { name: 'licenseNumber', label: 'License Key', type: 'secureText', required: false, placeholder: 'License key or serial number' },
          { name: 'expirationDate', label: 'Expiration Date', type: 'date', required: false, placeholder: 'YYYY-MM-DD' },
          { name: 'date.dateActive', label: 'Activation Date', type: 'date', required: false, placeholder: 'YYYY-MM-DD' },
          { name: 'notes', label: 'Notes', type: 'textarea', required: false, placeholder: 'Additional notes...' }
        ]
      },
      'sshKeys': {
        fields: [
          { name: 'title', label: 'Title', type: 'text', required: true, placeholder: 'SSH key name' },
          { name: 'login', label: 'Login', type: 'text', required: false, placeholder: 'SSH username' },
          { name: 'keyPair_privateKey', label: 'Private Key', type: 'secureTextareaPrivateKey', required: false, placeholder: 'Paste private key here...', parentType: 'keyPair', subField: 'privateKey' },
          { name: 'keyPair_publicKey', label: 'Public Key', type: 'secureTextareaPublicKey', required: false, placeholder: 'Paste public key here...', parentType: 'keyPair', subField: 'publicKey' },
          { name: 'passphrase', label: 'Passphrase', type: 'password', required: false, placeholder: 'Key passphrase' },
          { name: 'host_hostName', label: 'Host', type: 'text', required: false, placeholder: 'hostname or IP', parentType: 'host', subField: 'hostName' },
          { name: 'host_port', label: 'Port', type: 'text', required: false, placeholder: 'Port (default: 22)', parentType: 'host', subField: 'port' },
          { name: 'notes', label: 'Notes', type: 'textarea', required: false, placeholder: 'Additional notes...' }
        ]
      },
      'bankAccount': {
        fields: [
          { name: 'title', label: 'Title', type: 'text', required: true, placeholder: 'Account name (e.g., Chase Checking)' },
          { name: 'name_first', label: 'First Name', type: 'text', required: false, placeholder: 'Account holder first name', parentType: 'name', subField: 'first' },
          { name: 'name_last', label: 'Last Name', type: 'text', required: false, placeholder: 'Account holder last name', parentType: 'name', subField: 'last' },
          { name: 'login', label: 'Login', type: 'text', required: false, placeholder: 'Online banking username' },
          { name: 'password', label: 'Password', type: 'password', required: false, placeholder: 'Online banking password' },
          { name: 'url', label: 'URL', type: 'url', required: false, placeholder: 'https://bank.com' },
          { name: 'notes', label: 'Notes', type: 'textarea', required: false, placeholder: 'Additional notes...' }
        ]
      },
      'bankCard': {
        fields: [
          { name: 'title', label: 'Title', type: 'text', required: true, placeholder: 'Card name (e.g., Chase Sapphire)' },
          { name: 'text.cardholderName', label: 'Cardholder Name', type: 'text', required: false, placeholder: 'Name on card' },
          { name: 'pinCode', label: 'PIN', type: 'password', required: false, placeholder: 'Card PIN' },
          { name: 'login', label: 'Login', type: 'text', required: false, placeholder: 'Online account username' },
          { name: 'password', label: 'Password', type: 'password', required: false, placeholder: 'Online account password' },
          { name: 'notes', label: 'Notes', type: 'textarea', required: false, placeholder: 'Additional notes...' }
        ]
      },
      'address': {
        fields: [
          { name: 'title', label: 'Title', type: 'text', required: true, placeholder: 'Address name (e.g., Home Address)' },
          { name: 'notes', label: 'Notes', type: 'textarea', required: false, placeholder: 'Additional notes...' }
        ]
      },
      'wifiCredentials': {
        fields: [
          { name: 'title', label: 'Title', type: 'text', required: true, placeholder: 'Network name (e.g., Home WiFi)' },
          { name: 'text.ssid', label: 'SSID', type: 'text', required: false, placeholder: 'Network SSID' },
          { name: 'password', label: 'Password', type: 'password', required: false, placeholder: 'WiFi password' },
          { name: 'notes', label: 'Notes', type: 'textarea', required: false, placeholder: 'Additional notes...' }
        ]
      },
      'driverLicense': {
        fields: [
          { name: 'title', label: 'Title', type: 'text', required: true, placeholder: 'License description' },
          { name: 'accountNumber', label: 'License Number', type: 'text', required: false, placeholder: 'Driver license number' },
          { name: 'name_first', label: 'First Name', type: 'text', required: false, placeholder: 'First name', parentType: 'name', subField: 'first' },
          { name: 'name_last', label: 'Last Name', type: 'text', required: false, placeholder: 'Last name', parentType: 'name', subField: 'last' },
          { name: 'birthDate', label: 'Birth Date', type: 'date', required: false, placeholder: 'YYYY-MM-DD' },
          { name: 'expirationDate', label: 'Expiration Date', type: 'date', required: false, placeholder: 'YYYY-MM-DD' },
          { name: 'notes', label: 'Notes', type: 'textarea', required: false, placeholder: 'Additional notes...' }
        ]
      },
      'passport': {
        fields: [
          { name: 'title', label: 'Title', type: 'text', required: true, placeholder: 'Passport description (e.g., US Passport)' },
          { name: 'accountNumber', label: 'Passport Number', type: 'text', required: false, placeholder: 'Passport number' },
          { name: 'name_first', label: 'First Name', type: 'text', required: false, placeholder: 'First name', parentType: 'name', subField: 'first' },
          { name: 'name_last', label: 'Last Name', type: 'text', required: false, placeholder: 'Last name', parentType: 'name', subField: 'last' },
          { name: 'birthDate', label: 'Birth Date', type: 'date', required: false, placeholder: 'YYYY-MM-DD' },
          { name: 'expirationDate', label: 'Expiration Date', type: 'date', required: false, placeholder: 'YYYY-MM-DD' },
          { name: 'date', label: 'Issue Date', type: 'date', required: false, placeholder: 'YYYY-MM-DD' },
          { name: 'notes', label: 'Notes', type: 'textarea', required: false, placeholder: 'Additional notes...' }
        ]
      },
      'healthInsurance': {
        fields: [
          { name: 'title', label: 'Title', type: 'text', required: true, placeholder: 'Insurance name (e.g., Blue Cross)' },
          { name: 'accountNumber', label: 'Member ID', type: 'text', required: false, placeholder: 'Member/Policy number' },
          { name: 'name_first', label: 'First Name', type: 'text', required: false, placeholder: 'First name', parentType: 'name', subField: 'first' },
          { name: 'name_last', label: 'Last Name', type: 'text', required: false, placeholder: 'Last name', parentType: 'name', subField: 'last' },
          { name: 'login', label: 'Login', type: 'text', required: false, placeholder: 'Portal username' },
          { name: 'password', label: 'Password', type: 'password', required: false, placeholder: 'Portal password' },
          { name: 'url', label: 'URL', type: 'url', required: false, placeholder: 'https://insurance.com' },
          { name: 'notes', label: 'Notes', type: 'textarea', required: false, placeholder: 'Additional notes...' }
        ]
      },
      'birthCertificate': {
        fields: [
          { name: 'title', label: 'Title', type: 'text', required: true, placeholder: 'Birth certificate description' },
          { name: 'name_first', label: 'First Name', type: 'text', required: false, placeholder: 'First name', parentType: 'name', subField: 'first' },
          { name: 'name_middle', label: 'Middle Name', type: 'text', required: false, placeholder: 'Middle name', parentType: 'name', subField: 'middle' },
          { name: 'name_last', label: 'Last Name', type: 'text', required: false, placeholder: 'Last name', parentType: 'name', subField: 'last' },
          { name: 'birthDate', label: 'Birth Date', type: 'date', required: false, placeholder: 'YYYY-MM-DD' },
          { name: 'notes', label: 'Notes', type: 'textarea', required: false, placeholder: 'Additional notes...' }
        ]
      },
      'ssnCard': {
        fields: [
          { name: 'title', label: 'Title', type: 'text', required: true, placeholder: 'SSN Card description' },
          { name: 'accountNumber', label: 'SSN', type: 'secureText', required: false, placeholder: 'Social Security Number' },
          { name: 'name_first', label: 'First Name', type: 'text', required: false, placeholder: 'First name', parentType: 'name', subField: 'first' },
          { name: 'name_middle', label: 'Middle Name', type: 'text', required: false, placeholder: 'Middle name', parentType: 'name', subField: 'middle' },
          { name: 'name_last', label: 'Last Name', type: 'text', required: false, placeholder: 'Last name', parentType: 'name', subField: 'last' },
          { name: 'notes', label: 'Notes', type: 'textarea', required: false, placeholder: 'Additional notes...' }
        ]
      },
      'photo': {
        fields: [
          { name: 'title', label: 'Title', type: 'text', required: true, placeholder: 'Photo description' },
          { name: 'notes', label: 'Notes', type: 'textarea', required: false, placeholder: 'Additional notes...' }
        ]
      },
      'file': {
        fields: [
          { name: 'title', label: 'Title', type: 'text', required: true, placeholder: 'File description' },
          { name: 'notes', label: 'Notes', type: 'textarea', required: false, placeholder: 'Additional notes...' }
        ]
      },
      'pamDatabase': {
        fields: [
          { name: 'title', label: 'Title', type: 'text', required: true, placeholder: 'Database name (e.g., Production Oracle DB)' },
          { name: 'pamHostname_hostName', label: 'Host', type: 'text', required: false, placeholder: 'hostname or IP', parentType: 'pamHostname', subField: 'hostName' },
          { name: 'pamHostname_port', label: 'Port', type: 'text', required: false, placeholder: 'Port number (e.g., 1521)', parentType: 'pamHostname', subField: 'port' },
          { name: 'login', label: 'Login', type: 'text', required: false, placeholder: 'Database username' },
          { name: 'password', label: 'Password', type: 'password', required: false, placeholder: 'Database password' },
          { name: 'text.database', label: 'Database', type: 'text', required: false, placeholder: 'Database name/SID' },
          { name: 'notes', label: 'Notes', type: 'textarea', required: false, placeholder: 'Additional notes...' }
        ]
      },
      'pamDirectory': {
        fields: [
          { name: 'title', label: 'Title', type: 'text', required: true, placeholder: 'Directory name (e.g., Corporate AD)' },
          { name: 'pamHostname_hostName', label: 'Host', type: 'text', required: false, placeholder: 'hostname or IP', parentType: 'pamHostname', subField: 'hostName' },
          { name: 'pamHostname_port', label: 'Port', type: 'text', required: false, placeholder: 'Port number (e.g., 389)', parentType: 'pamHostname', subField: 'port' },
          { name: 'login', label: 'Login', type: 'text', required: false, placeholder: 'Admin username' },
          { name: 'password', label: 'Password', type: 'password', required: false, placeholder: 'Admin password' },
          { name: 'notes', label: 'Notes', type: 'textarea', required: false, placeholder: 'Additional notes...' }
        ]
      },
      'pamMachine': {
        fields: [
          { name: 'title', label: 'Title', type: 'text', required: true, placeholder: 'Machine name (e.g., Production Web Server)' },
          { name: 'pamHostname_hostName', label: 'Host', type: 'text', required: false, placeholder: 'hostname or IP', parentType: 'pamHostname', subField: 'hostName' },
          { name: 'pamHostname_port', label: 'Port', type: 'text', required: false, placeholder: 'Port number (e.g., 22)', parentType: 'pamHostname', subField: 'port' },
          { name: 'login', label: 'Login', type: 'text', required: false, placeholder: 'Username' },
          { name: 'password', label: 'Password', type: 'password', required: false, placeholder: 'Password' },
          { name: 'notes', label: 'Notes', type: 'textarea', required: false, placeholder: 'Additional notes...' }
        ]
      },
      'pamUser': {
        fields: [
          { name: 'title', label: 'Title', type: 'text', required: true, placeholder: 'User description (e.g., Database Admin User)' },
          { name: 'login', label: 'Login', type: 'text', required: false, placeholder: 'Username' },
          { name: 'password', label: 'Password', type: 'password', required: false, placeholder: 'Password' },
          { name: 'name_first', label: 'First Name', type: 'text', required: false, placeholder: 'First name', parentType: 'name', subField: 'first' },
          { name: 'name_middle', label: 'Middle Name', type: 'text', required: false, placeholder: 'Middle name', parentType: 'name', subField: 'middle' },
          { name: 'name_last', label: 'Last Name', type: 'text', required: false, placeholder: 'Last name', parentType: 'name', subField: 'last' },
          { name: 'notes', label: 'Notes', type: 'textarea', required: false, placeholder: 'Additional notes...' }
        ]
      },
      'pamRemoteBrowser': {
        fields: [
          { name: 'title', label: 'Title', type: 'text', required: true, placeholder: 'Session name (e.g., Salesforce Admin)' },
          { name: 'url', label: 'URL', type: 'url', required: false, placeholder: 'https://app.example.com' },
          { name: 'login', label: 'Login', type: 'text', required: false, placeholder: 'Username' },
          { name: 'password', label: 'Password', type: 'password', required: false, placeholder: 'Password' },
          { name: 'notes', label: 'Notes', type: 'textarea', required: false, placeholder: 'Additional notes...' }
        ]
      },
      'general': {
        fields: [
          { name: 'title', label: 'Title', type: 'text', required: true, placeholder: 'Record title' },
          { name: 'login', label: 'Login', type: 'text', required: false, placeholder: 'Username or identifier' },
          { name: 'password', label: 'Password', type: 'password', required: false, placeholder: 'Password' },
          { name: 'url', label: 'URL', type: 'url', required: false, placeholder: 'https://example.com' },
          { name: 'notes', label: 'Notes', type: 'textarea', required: false, placeholder: 'Additional notes...' }
        ]
      },
      'pamAwsConfiguration': {
        fields: [
          { name: 'title', label: 'Title', type: 'text', required: true, placeholder: 'AWS Configuration name' },
          { name: 'text.awsId', label: 'AWS ID', type: 'text', required: true, placeholder: 'AWS Account ID' },
          { name: 'secret.accessKeyId', label: 'Access Key ID', type: 'secureText', required: false, placeholder: 'AWS Access Key ID' },
          { name: 'multiline.regionNames', label: 'Region Names', type: 'textarea', required: false, placeholder: 'AWS Regions (one per line)' },
          { name: 'notes', label: 'Notes', type: 'textarea', required: false, placeholder: 'Additional notes...' }
        ]
      },
      'pamAzureConfiguration': {
        fields: [
          { name: 'title', label: 'Title', type: 'text', required: true, placeholder: 'Azure Configuration name' },
          { name: 'text.azureId', label: 'Azure ID', type: 'text', required: true, placeholder: 'Azure Account ID' },
          { name: 'secret.clientId', label: 'Client ID', type: 'secureText', required: true, placeholder: 'Azure Client/Application ID' },
          { name: 'multiline.resourceGroups', label: 'Resource Groups', type: 'textarea', required: false, placeholder: 'Resource groups (one per line)' },
          { name: 'notes', label: 'Notes', type: 'textarea', required: false, placeholder: 'Additional notes...' }
        ]
      },
      'pamLocalConfiguration': {
        fields: [
          { name: 'title', label: 'Title', type: 'text', required: true, placeholder: 'Local Configuration name' },
          { name: 'text.localId', label: 'Local ID', type: 'text', required: true, placeholder: 'Local identifier' },
          { name: 'multiline.portMapping', label: 'Port Mapping', type: 'textarea', required: false, placeholder: 'Port mappings (one per line)' },
          { name: 'notes', label: 'Notes', type: 'textarea', required: false, placeholder: 'Additional notes...' }
        ]
      },
      'pamNetworkConfiguration': {
        fields: [
          { name: 'title', label: 'Title', type: 'text', required: true, placeholder: 'Network Configuration name' },
          { name: 'text.networkId', label: 'Network ID', type: 'text', required: false, placeholder: 'Network identifier' },
          { name: 'multiline.portMapping', label: 'Port Mapping', type: 'textarea', required: false, placeholder: 'Port mappings (one per line)' },
          { name: 'notes', label: 'Notes', type: 'textarea', required: false, placeholder: 'Additional notes...' }
        ]
      },
      'pamDomainConfiguration': {
        fields: [
          { name: 'title', label: 'Title', type: 'text', required: true, placeholder: 'Domain Configuration name' },
          { name: 'pamHostname_hostName', label: 'Host', type: 'text', required: false, placeholder: 'Domain controller hostname', parentType: 'pamHostname', subField: 'hostName' },
          { name: 'pamHostname_port', label: 'Port', type: 'text', required: false, placeholder: 'Port number (e.g., 389)', parentType: 'pamHostname', subField: 'port' },
          { name: 'text.pamDomainId', label: 'Domain ID', type: 'text', required: false, placeholder: 'Domain identifier' },
          { name: 'multiline.portMapping', label: 'Port Mapping', type: 'textarea', required: false, placeholder: 'Port mappings (one per line)' },
          { name: 'notes', label: 'Notes', type: 'textarea', required: false, placeholder: 'Additional notes...' }
        ]
      }
    };
    
    return templates[recordType] || { fields: [] };
  };

  // Restore a stored request snapshot into component state (shared by admin and non-admin paths).
  const restoreStoredData = (data) => {
    setStoredRequestData(data);
    setHasStoredData(true);
    setSelectedAction(data.selectedAction);
    setFormData(data.formData || {});
    setRotateOnExpiration(data.rotateOnExpiration === true);
    setIsRotationEligible(data.isRotationEligible === true);

    const nsfEnabled = data.isNsfMode !== undefined ? data.isNsfMode !== false : true;
    setIsNsfMode(nsfEnabled);

    if (data.formData?.addressRef?.startsWith('temp_addr_')) {
      const uid = data.formData.addressRef;
      const addrData = data.tempAddressData?.[uid];
      if (addrData) {
        setResolvedAddresses(prev => ({ ...prev, [uid]: addrData }));
      }
    }

    setTimeout(() => {
      const restoredMode = nsfEnabled ? 'nsf' : 'classic';
      const restoredAction = data.selectedAction?.value;
      if (restoredAction === 'record-update' && data.selectedRecordForUpdate) {
        setSelectedRecordForUpdate(data.selectedRecordForUpdate);
        refetchVaultData({ mode: restoredMode, action: restoredAction });
        fetchKeeperRecordDetails(data.selectedRecordForUpdate.record_uid, data);
        fetchRecordTypes();
      } else if (restoredAction === 'record-add' && data.formData?.recordType) {
        fetchRecordTypeTemplateWithFormMapping(data.formData.recordType, data.formData);
        fetchRecordTypes();
      }
      if (data.selectedRecord) setSelectedRecord(data.selectedRecord);
      if (data.selectedFolder) setSelectedFolder(data.selectedFolder);
    }, 200);
  };

  // Check user role and load stored data
  const checkUserRoleAndLoadData = async (context = issueContext) => {
    try {
      if (!context || !context.issueKey) {
        setIsAdmin(false);
        return;
      }
      
      setIsLoadingStoredData(true);
      
      const userRole = await api.getUserRole(context.issueKey);
      setIsAdmin(userRole.isAdmin || false);
      
      const storedData = await api.getStoredRequestData(context.issueKey);
      if (storedData && storedData.data) {
        restoreStoredData(storedData.data);
      }
    } catch (error) {
      setIsAdmin(false);
    } finally {
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
    
    // Save directly for all users - backend will auto-assign to random project admin only on first save (not on updates)
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
      
      const now = new Date();
      const requestData = {
        selectedAction,
        formData,
        selectedRecord,
        selectedRecordForUpdate,
        selectedFolder,
        tempAddressData,
        rotateOnExpiration,
        isRotationEligible,
        isNsfMode,
        timestamp: now.toISOString()
      };
      
      // Format the same timestamp for the JIRA comment (same format used in UI)
      const formattedTimestamp = now.toLocaleString('en-US', {
        month: '2-digit',
        day: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false
      });
      
      const result = await api.storeRequestData(
        issueContext.issueKey,
        requestData,
        formattedTimestamp
      );
      
      // Check for structured error response (new pattern)
      if (checkResultError(result)) {
        const errorMessage = handleApiError(result, "Failed to save request data. Please try again.");
        setSaveRequestMessage({ 
          type: 'error', 
          message: errorMessage,
          showTimestamp: false
        });
        setTimeout(() => setSaveRequestMessage(null), 5000);
        return;
      }
      
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


  // Clear stored data from backend
  const clearStoredData = async () => {
    try {
      // Check if issueContext is available
      if (!issueContext || !issueContext.issueKey) {
        throw new Error('Issue context not available. Please refresh the page.');
      }
      
      // Pass issueKey to the backend
      const result = await api.clearStoredRequestData(issueContext.issueKey);
      
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
      // Clear stored request data states
      setStoredRequestData(null);
      setHasStoredData(false);
      setShowStoredRequestMessage(true); // Reset for next time data is saved
      
      // Reset record-update specific states
      setRecordDetails({});
      setRecordTypeTemplate({});
      setTemplateFields([]);
      
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


  // Fetch record type template when record type is changed
  // Now using static templates instead of API call
  const fetchRecordTypeTemplate = (recordType, recordDetailsForMapping = null) => {
    
    // Clear custom fields and error immediately when template processing starts
    setTemplateError(null);
    
    if (!recordType) {
      setRecordTypeTemplate({});
      setTemplateFields([]);
      return;
    }

    setLoadingTemplate(true);
    
    // Use static template instead of API call
    const staticTemplate = getStaticRecordTypeTemplate(recordType);
    
    if (staticTemplate && staticTemplate.fields && staticTemplate.fields.length > 0) {
      setRecordTypeTemplate(staticTemplate);
      
      // Process static fields directly - they're already in the correct format
      const processedFields = staticTemplate.fields.map(field => ({
        ...field,
        templateField: true
      }));
        
        setTemplateFields(processedFields);
      setTemplateError(null);
      
      // Map existing record values to template fields if provided
      if (recordDetailsForMapping && Object.keys(recordDetailsForMapping).length > 0) {
        mapExistingValuesToTemplateWithClearedData(processedFields, { ...formData }, recordDetailsForMapping);
      }
      } else {
        setRecordTypeTemplate({});
        setTemplateFields([]);
      setTemplateError(`No template found for record type: ${recordType}`);
    }
    
    setLoadingTemplate(false);
  };

  // Enhanced template fetching function that preserves and maps current form data
  // Now using static templates instead of API call
  const fetchRecordTypeTemplateWithFormMapping = (recordType, currentFormData) => {
    
    // Clear custom fields and error immediately when template processing starts
    setTemplateError(null);
    
    if (!recordType) {
      setRecordTypeTemplate({});
      setTemplateFields([]);
      return;
    }

    setLoadingTemplate(true);
    
    // Use static template instead of API call
    const staticTemplate = getStaticRecordTypeTemplate(recordType);
    
    if (staticTemplate && staticTemplate.fields && staticTemplate.fields.length > 0) {
      setRecordTypeTemplate(staticTemplate);
      
      // Process static fields directly - they're already in the correct format
      const processedFields = staticTemplate.fields.map(field => ({
        ...field,
        templateField: true
      }));
          
          setTemplateFields(processedFields);
      setTemplateError(null);
          
          // Map current form data to new template fields
          mapCurrentFormDataToTemplate(processedFields, currentFormData, recordType);
        } else {
          setRecordTypeTemplate({});
          setTemplateFields([]);
      setTemplateError(`No template found for record type: ${recordType}`);
      }
    
    setLoadingTemplate(false);
  };

  // Simplified field mapping for update record action
  const mapCurrentFormDataToTemplate = (templateFields, currentFormData, currentRecordType = null) => {
    
    const selectedRecordType = currentFormData.recordType;
    const actualOriginalRecordType = originalRecordType; // Always use the true original record type
    const isReturningToOriginalType = selectedRecordType === actualOriginalRecordType;
    const isRecordUpdateAction = selectedAction?.value === 'record-update';
    
    
    const templateFieldNames = templateFields.map(f => f.name);
    
    // SIMPLE LOGIC: Handle the three main scenarios
    if (isReturningToOriginalType) {
      // For record-update action: keep fields blank when returning to original type
      // User should only fill in fields they want to update
      if (isRecordUpdateAction) {
        const blankFormData = {
          record: currentFormData.record,
          recordType: selectedRecordType
        };
        
        if (!isPreservingStoredDataRef.current) {
          setFormData(blankFormData);
        }
        return;
      }
      
      // Scenario 3: Returning to original record type - reset completely (for non-update actions)
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
    
    // For record-update action: keep fields blank when switching record types
    // User should only fill in fields they want to update
    if (isRecordUpdateAction) {
      const blankFormData = {
        record: currentFormData.record,
        recordType: selectedRecordType
      };
      
      if (!isPreservingStoredDataRef.current) {
        setFormData(blankFormData);
      }
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
    
    const fieldsWithValues = Object.keys(allFieldsWithValues).filter(key => 
      allFieldsWithValues[key] && allFieldsWithValues[key] !== '' && 
      !['record', 'recordType', 'title'].includes(key) &&
      !key.startsWith('_lastAddressUpdate') && !key.startsWith('_addressRefresh') // Exclude artificial UI fields
    );
    
    // Map ALL fields with values to new template fields
    Object.keys(allFieldsWithValues).forEach(fieldName => {
      const fieldValue = allFieldsWithValues[fieldName];
      
        // Skip core fields, empty values, and ARTIFICIAL UI FIELDS
        const isArtificialField = fieldName.startsWith('_lastAddressUpdate') || fieldName.startsWith('_addressRefresh');
        
        if (['record', 'recordType', 'title'].includes(fieldName) || 
            !fieldValue || fieldValue === '' || 
            isArtificialField) {
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
      
      // Check for partial matches (e.g., fieldName -> parentType_fieldName)
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
    // NOTE: Only preserve unmatched fields for record-update action
    // This prevents fields like name_first, name_last from being sent when switching from Contact to Server
    // For record-add and any other action, unmatched fields should be discarded
    const shouldPreserveUnmatchedFields = selectedAction?.value === 'record-update';
    
    if (unmatchedFields.length > 0 && shouldPreserveUnmatchedFields) {
      // Only preserve unmatched fields explicitly for record-update action
      const customFields = unmatchedFields.map((field, index) => {
        // Clean the field name by removing prefixes (e.g., parentType_fieldName -> fieldName)
        let cleanFieldName = field.originalFieldName;
        
        // Extract base field name from prefixed names
        if (cleanFieldName.includes('_')) {
          const parts = cleanFieldName.split('_');
          if (parts.length === 2) {
            // For patterns like parentType_fieldName
            cleanFieldName = parts[1]; // Take the last part
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
      case 'datetime-local':
        return 'datetime-local';
      case 'login':
      case 'username':
      case 'title':
      case 'name':
      case 'company':
      case 'text':
      case 'passkey':
      case 'oneTimeCode':
      case 'otp':
      case 'host':
        return 'text';
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
    
    // Populate phone entries if template has phoneEntries field (for contact records)
    const hasPhoneEntriesField = templateFields.find(tf => tf.type === 'phoneEntries');
    if (hasPhoneEntriesField && detailsToUse?.fields && !isPreservingStoredDataRef.current) {
      const phoneFields = detailsToUse.fields.filter(f => f.type === 'phone');
      if (phoneFields.length > 0) {
        const existingPhoneEntries = phoneFields.map((phone, idx) => {
          const phoneValue = phone.value?.[0] || {};
          return {
            id: idx + 1,
            region: phoneValue.region || 'US',
            number: phoneValue.number || '',
            ext: phoneValue.ext || '',
            type: phoneValue.type || 'Mobile'
          };
        }).filter(entry => entry.number); // Only include entries with numbers
        
        if (existingPhoneEntries.length > 0) {
          setPhoneEntries(existingPhoneEntries);
        } else {
          // No phones - keep empty (user can add via + button)
          setPhoneEntries([]);
        }
      }
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
            // For patterns like parentType_fieldName
            cleanFieldName = parts[1]; // Take the last part
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
    
    // Populate phone entries if template has phoneEntries field (for contact records)
    const hasPhoneEntriesFieldLegacy = templateFields.find(tf => tf.type === 'phoneEntries');
    if (hasPhoneEntriesFieldLegacy && recordDetails?.fields && !isPreservingStoredDataRef.current) {
      const phoneFieldsLegacy = recordDetails.fields.filter(f => f.type === 'phone');
      if (phoneFieldsLegacy.length > 0) {
        const existingPhoneEntriesLegacy = phoneFieldsLegacy.map((phone, idx) => {
          const phoneValue = phone.value?.[0] || {};
          return {
            id: idx + 1,
            region: phoneValue.region || 'US',
            number: phoneValue.number || '',
            ext: phoneValue.ext || '',
            type: phoneValue.type || 'Mobile'
          };
        }).filter(entry => entry.number);
        
        if (existingPhoneEntriesLegacy.length > 0) {
          setPhoneEntries(existingPhoneEntriesLegacy);
        } else {
          // No phones - keep empty (user can add via + button)
          setPhoneEntries([]);
        }
      }
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
            // For patterns like parentType_fieldName
            cleanFieldName = parts[1]; // Take the last part
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

  // Validate email addresses (supports comma-separated multiple emails)
  const validateEmails = (emailString) => {
    if (!emailString || emailString.trim() === '') {
      return { isValid: false, errors: ['Email is required'] };
    }

    // Split by comma and trim each email
    const emails = emailString.split(',').map(email => email.trim());
    const emailRegex = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
    const invalidEmails = [];

    emails.forEach(email => {
      if (!emailRegex.test(email)) {
        invalidEmails.push(email);
      }
    });

    if (invalidEmails.length > 0) {
      return {
        isValid: false,
        errors: [`Invalid email format: ${invalidEmails.join(', ')}`]
      };
    }

    return {
      isValid: true,
      errors: []
    };
  };

  // Render grouped template fields with sophisticated UI like Keeper vault
  const renderGroupedTemplateFields = (templateFields) => {
    if (!templateFields || templateFields.length === 0) {
      return null;
    }

    const renderElements = [];
    const renderedGroups = new Set(); // Track which groups have been rendered

    // Render fields in order, grouping related fields when encountered
    templateFields.forEach((field, index) => {
      if (field.parentType) {
        // This is a complex field component - check if we've already rendered this group
        if (renderedGroups.has(field.parentType)) {
          return; // Skip - already rendered as part of group
        }
        
        // Mark group as rendered
        renderedGroups.add(field.parentType);
        
        // Get all fields for this group
        const groupFields = templateFields.filter(f => f.parentType === field.parentType);
        const groupType = field.parentType;
      const groupLabel = groupType === 'name' ? 'Name' : 
                        groupType === 'phone' ? 'Phone Number' : 
                          null; // Don't show header for host and other groups

      if (groupType === 'name') {
        // Render Name group with First/Middle/Last layout
        const firstField = groupFields.find(f => f.subField === 'first');
        const middleField = groupFields.find(f => f.subField === 'middle');
        const lastField = groupFields.find(f => f.subField === 'last');

        renderElements.push(
          <div key={`group-${groupType}`} className="field-group">
              {groupLabel && <div className="field-group-header">{groupLabel}</div>}
            
            {/* First and Middle Name Row */}
            <div className="field-row">
              {firstField && (
                <div className="field-col">
                  <label className="form-label">
                    {firstField.label} {firstField.required && selectedAction.value !== 'record-update' && <span className="text-required">*</span>}
                  </label>
                  {renderFormInput(firstField)}
                </div>
              )}
              {middleField && (
                <div className="field-col">
                  <label className="form-label">
                    {middleField.label}
                  </label>
                  {renderFormInput(middleField)}
                </div>
              )}
            </div>
            
            {/* Last Name Row */}
            {lastField && (
              <FormField
                label={lastField.label}
                required={lastField.required && selectedAction.value !== 'record-update'}
                labelClass="form-label"
              >
                {renderFormInput(lastField)}
              </FormField>
            )}
          </div>
        );
      } else if (groupType === 'phone') {
        // Render Phone group with Number/Extension/Type layout
        const numberField = groupFields.find(f => f.subField === 'number');
        const extField = groupFields.find(f => f.subField === 'ext');
        const typeField = groupFields.find(f => f.subField === 'type');

        renderElements.push(
          <div key={`group-${groupType}`} className="field-group">
              {groupLabel && <div className="field-group-header">{groupLabel}</div>}
            
            {/* Phone Number */}
            {numberField && (
              <FormField
                label={numberField.label}
                required={numberField.required && selectedAction.value !== 'record-update'}
                labelClass="form-label"
              >
                {renderFormInput(numberField)}
              </FormField>
            )}
            
            {/* Extension and Type Row */}
            <div className="field-row">
              {extField && (
                <div className="field-col">
                  <label className="form-label">
                    {extField.label}
                  </label>
                  {renderFormInput(extField)}
                </div>
              )}
              {typeField && (
                <div className="field-col">
                  <label className="form-label">
                    {typeField.label}
                  </label>
                  {renderFormInput(typeField)}
                </div>
              )}
            </div>
          </div>
        );
        } else if (groupType === 'host') {
          // Render Host group without header - just Host and Port fields inline
          const hostNameField = groupFields.find(f => f.subField === 'hostName');
          const portField = groupFields.find(f => f.subField === 'port');

        renderElements.push(
          <div key={`group-${groupType}`} className="field-group">
            <div className="field-row">
                {hostNameField && (
                  <div className="field-col field-col-flex-2">
                  <label className="form-label">
                      {hostNameField.label} {hostNameField.required && selectedAction.value !== 'record-update' && <span className="text-required">*</span>}
                  </label>
                    {renderFormInput(hostNameField)}
                </div>
              )}
                {portField && (
                  <div className="field-col field-col-flex-1">
                  <label className="form-label">
                      {portField.label}
                  </label>
                    {renderFormInput(portField)}
                </div>
              )}
            </div>
          </div>
        );
      } else {
          // Render other complex field groups without header
        renderElements.push(
          <div key={`group-${groupType}`} className="field-group">
              {groupFields.map((gField) => (
                <FormField
                  key={gField.name}
                  label={gField.label}
                  required={gField.required && selectedAction.value !== 'record-update'}
                  labelClass="form-label"
                >
                  {renderFormInput(gField)}
                </FormField>
              ))}
          </div>
        );
      }
      } else {
        // This is an individual field - render it directly
      renderElements.push(
        <div key={field.name} className="mb-16">
          {/* Don't show label for phoneEntries type - it has its own header */}
          {field.type !== 'phoneEntries' && (
            <label className="form-label">
                {field.label} {field.required && selectedAction.value !== 'record-update' && <span className="text-required">*</span>}
            </label>
          )}
          {renderFormInput(field)}
        </div>
      );
      }
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
      setRecordTypeTemplate({});
      setTemplateFields([]);
      setLoadingTemplate(false);
      
      // Clear email validation error
      setEmailValidationError(null);
    }
    
    // Update previous action
    setPreviousAction(selectedAction);
    
    // Auto-populate email field for non-admin users when share-record or share-folder is selected
    // BUT don't overwrite if email already exists (from stored data or previous input)
    if (selectedAction && (selectedAction.value === 'share-record' || selectedAction.value === 'share-folder') && 
        !isAdmin && issueContext?.currentUserEmail && actionActuallyChanged && !isLoadingStoredData && !hasStoredData) {
      setFormData(prev => ({
        ...prev,
        user: prev.user || issueContext.currentUserEmail  // Only set if user field is empty
      }));
    }
    
    // Effect A: fires when action/context changes (all users who need vault data).
    if (!selectedAction || isLoadingStoredData) return;
    refetchVaultData({ mode: activeVaultMode, action: selectedAction.value });
    // Record types only needed for admin-only actions (record-add/record-update).
    const shouldFetchData = issueContext?.hasConfig || isAdmin;
    if ((selectedAction.value === 'record-add' || selectedAction.value === 'record-update') && shouldFetchData) {
      fetchRecordTypes();
    }
  }, [selectedAction, isLoadingStoredData, isAdmin, issueContext]);

  // Effect B: fires when vault mode toggles — admin only.
  // Non-admins don't see inline vault pickers, so toggling Classic must not trigger API calls.
  useEffect(() => {
    if (!isAdmin || !selectedAction || isLoadingStoredData) return;
    const mode = isNsfMode ? 'nsf' : 'classic';
    refetchVaultData({ mode, action: selectedAction.value });
  }, [isNsfMode]);

  // Check rotation eligibility only when expiration is selected (lazy — avoids
  // API calls while the user is still browsing records/folders). Caches the
  // last-checked UID so switching between expire-in and expire-at for the same
  // record/folder skips the redundant call.
  useEffect(() => {
    const action = selectedAction?.value;
    const hasExpiration = formData.expiration_type && formData.expiration_type !== 'none';

    if (!isAdmin || !hasExpiration ||
        (action !== 'share-record' && action !== 'share-folder')) {
      setIsRotationEligible(false);
      setRotateOnExpiration(false);
      return;
    }

    let type, uid;
    if (action === 'share-record' && selectedRecord) {
      type = 'record';
      uid = selectedRecord.record_uid;
    } else if (action === 'share-folder' && selectedFolder) {
      type = 'folder';
      uid = selectedFolder.folder_uid || selectedFolder.uid;
    }

    if (!type || !uid) {
      setIsRotationEligible(false);
      setRotateOnExpiration(false);
      return;
    }

    // Skip API call if we already checked this exact record/folder.
    if (lastCheckedRoeRef.current.type === type &&
        lastCheckedRoeRef.current.uid === uid) {
      return;
    }

    let cancelled = false;
    setCheckingRotationEligibility(true);
    api.checkRotationEligibility(type, uid)
      .then(res => {
        if (cancelled) return;
        lastCheckedRoeRef.current = { type, uid };
        setIsRotationEligible(res?.eligible === true);
        if (!res?.eligible) setRotateOnExpiration(false);
      })
      .catch(() => {
        if (!cancelled) {
          lastCheckedRoeRef.current = { type, uid };
          setIsRotationEligible(false);
          setRotateOnExpiration(false);
        }
      })
      .finally(() => { if (!cancelled) setCheckingRotationEligibility(false); });

    return () => { cancelled = true; };
  }, [selectedRecord, selectedFolder, selectedAction, isAdmin, formData.expiration_type]);

  // Auto-dismiss workflow info dialog after 5 seconds
  useEffect(() => {
    if (showWorkflowInfo && (issueContext?.hasConfig || !isAdmin) && !isLoading && !isLoadingStoredData) {
      const timer = setTimeout(() => {
        setShowWorkflowInfo(false);
      }, 5000); // 5 seconds
      
      return () => clearTimeout(timer);
    }
  }, [showWorkflowInfo, issueContext, isLoading, isLoadingStoredData]);

  // Handle form input changes
  const handleInputChange = (fieldName, value) => {
    // Validate email field for admin users
    if (fieldName === 'user' && isAdmin && (selectedAction?.value === 'share-record' || selectedAction?.value === 'share-folder')) {
      const validation = validateEmails(value);
      if (!validation.isValid) {
        setEmailValidationError(validation.errors[0]);
      } else {
        setEmailValidationError(null);
      }
    }
    
    // Special handling for share-record action: mutual exclusivity between record and sharedFolder
    if (selectedAction?.value === 'share-record') {
      if (fieldName === 'record' && value) {
        // When record is selected, clear sharedFolder and disable recursive
        setFormData(prev => ({
          ...prev,
          [fieldName]: value,
          sharedFolder: null,
          recursive: false
        }));
        setSelectedFolder(null);
        return;
      }
      
      if (fieldName === 'sharedFolder' && value) {
        // When sharedFolder is selected, clear record
        setFormData(prev => ({
          ...prev,
          [fieldName]: value,
          record: null
        }));
        setSelectedRecord(null);
        return;
      }
    }
    
    // Special handling for share-record and share-folder actions: show modal when expiration changes to non-none
    if ((selectedAction?.value === 'share-record' || selectedAction?.value === 'share-folder') && fieldName === 'expiration_type') {
      if (value && value !== 'none') {
        // Store the pending value and show the warning modal
        setPendingExpirationValue(value);
        setShowExpirationWarningModal(true);
        return; // Don't update formData yet - wait for user confirmation
      }
    }
    
    // Clear rotate-on-expiration when expiration is removed.
    if (fieldName === 'expiration_type' && (!value || value === 'none')) {
      setRotateOnExpiration(false);
    }

    setFormData(prev => {
      const newData = {
        ...prev,
        [fieldName]: value
      };
      
      // Clear can_share when expiration is set for share-record action
      if (selectedAction?.value === 'share-record' && fieldName === 'expiration_type') {
        if (value && value !== 'none') {
          newData.can_share = false;
        }
      }
      
      // Clear manage_users when expiration is set for share-folder action
      if (selectedAction?.value === 'share-folder' && fieldName === 'expiration_type') {
        if (value && value !== 'none') {
          newData.manage_users = false;
        }
      }
      
      return newData;
    });
    
    // Special handling for addressRef fields - trigger address resolution
    if (fieldName === 'addressRef' && value) {
      resolveAndCacheAddress(value, true); // Force resolution to ensure UI updates
    }
  };

  // Handle expiration warning modal confirmation
  const handleExpirationWarningConfirm = () => {
    if (pendingExpirationValue) {
      setFormData(prev => {
        const newData = {
          ...prev,
          expiration_type: pendingExpirationValue
        };
        
        // Clear can_share for share-record action
        if (selectedAction?.value === 'share-record') {
          newData.can_share = false;
        }
        
        // Clear manage_users for share-folder action
        if (selectedAction?.value === 'share-folder') {
          newData.manage_users = false;
        }
        
        return newData;
      });
    }
    setShowExpirationWarningModal(false);
    setPendingExpirationValue(null);
  };

  // Handle expiration warning modal cancellation
  const handleExpirationWarningCancel = () => {
    setShowExpirationWarningModal(false);
    setPendingExpirationValue(null);
    // Keep the expiration_type at its current value (don't change it)
  };

  // Add manual custom field
  // Validate required fields
  const validateForm = () => {
    if (!selectedAction?.fields) return true;
    
    // Special handling for share-record action
    if (selectedAction.value === 'share-record') {
      // For non-admin users, requirements and action fields are mandatory
      if (!isAdmin) {
        if (!formData['requirements'] || formData['requirements'].trim() === '') {
          return false;
        }
        if (!formData['action'] || formData['action'].trim() === '') {
          return false;
        }
        return true;
      }
      
      // For admin users, check required fields
      // Check if action is selected
      if (!formData['action'] || formData['action'].trim() === '') {
        return false;
      }
      
      // Check if user/email is entered and valid
      if (!formData['user'] || formData['user'].trim() === '') {
        return false;
      }
      
      // Validate email format (single or comma-separated)
      const emailValidation = validateEmails(formData['user']);
      if (!emailValidation.isValid) {
        return false;
      }
      
      // For "cancel" action, email and action are required, plus either record OR folder
      if (formData['action'] === 'cancel') {
        // Must have either record or folder selected
        if (!selectedRecord && !selectedFolder) {
          return false;
        }
        return true;
      }
      
      // For other actions (grant, revoke, owner), check if record or folder is selected
      if (!selectedRecord && !selectedFolder) {
        return false;
      }
      
      // Rotation requires a valid expiration window.
      if (rotateOnExpiration) {
        if (!formData.expiration_type || formData.expiration_type === 'none') return false;
        if (formData.expiration_type === 'expire-at' && !formData.expire_at) return false;
        if (formData.expiration_type === 'expire-in' && !formData.expire_in) return false;
      }

      return true;
    }
    
    // Special handling for record-update action
    if (selectedAction.value === 'record-update') {
      // Check if record is selected for update
      if (!selectedRecordForUpdate) {
        return false;
      }
      
      // For record-update, at least one field must be provided to update
      // Check standard fields (excluding 'record' which is just the identifier and 'force' which is a modifier)
      const standardUpdateFields = ['title', 'login', 'password', 'url', 'email', 'notes', 'recordType'];
      const hasStandardFieldValue = standardUpdateFields.some(fieldName => {
        const value = formData[fieldName];
        return value !== undefined && value !== null && value !== '' && String(value).trim() !== '';
      });
      
      // Check template fields for any values
      const hasTemplateFieldValue = templateFields.some(field => {
        const value = formData[field.name];
        return value !== undefined && value !== null && value !== '' && String(value).trim() !== '';
      });
      
      // At least one update field must have a value
      if (!hasStandardFieldValue && !hasTemplateFieldValue) {
        return false;
      }
      
      return true;
    }
    
    // Special handling for share-folder action
    if (selectedAction.value === 'share-folder') {
      // For non-admin users, requirements and action fields are mandatory
      if (!isAdmin) {
        if (!formData['requirements'] || formData['requirements'].trim() === '') {
          return false;
        }
        if (!formData['action'] || formData['action'].trim() === '') {
          return false;
        }
        return true;
      }
      
      // For admin users, check required fields
      // Check if folder is selected
      if (!selectedFolder) {
        return false;
      }
      
      // Check if action is selected
      if (!formData['action'] || formData['action'].trim() === '') {
        return false;
      }
      
      // Check if user/email is entered and valid
      if (!formData['user'] || formData['user'].trim() === '') {
        return false;
      }
      
      // Validate email format (single or comma-separated)
      const emailValidation = validateEmails(formData['user']);
      if (!emailValidation.isValid) {
        return false;
      }
      
      if (rotateOnExpiration) {
        if (!formData.expiration_type || formData.expiration_type === 'none') return false;
        if (formData.expiration_type === 'expire-at' && !formData.expire_at) return false;
        if (formData.expiration_type === 'expire-in' && !formData.expire_in) return false;
      }

      return true;
    }
    
    // Special handling for record-permission action
    if (selectedAction.value === 'record-permission') {
      // For non-admin users, requirements field is mandatory
      if (!isAdmin) {
        if (!formData['requirements'] || formData['requirements'].trim() === '') {
          return false;
        }
        return true;
      }
      
      // For admin users, check required fields
      // Check if folder is selected
      if (!selectedFolder) {
        return false;
      }
      
      // Action field is required
      if (!formData.action || formData.action === '') {
        return false;
      }
      
      // Classic: require at least one of can_edit/can_share. NSF uses --role instead.
      if (!isNsfMode &&
          (formData.action === 'grant' || formData.action === 'revoke')) {
        const hasPermissionFlags = formData.can_share || formData.can_edit;
        if (!hasPermissionFlags) {
          return false;
        }
      }
      
      return true;
    }
    
    // Special handling for record-add action
    if (selectedAction.value === 'record-add') {
      // Get dynamic action with updated record type options
      const dynamicAction = actionOptions.find(action => action.value === 'record-add');
      
      // Validate standard fields (including recordType)
      for (let field of (dynamicAction?.fields || [])) {
        if (field.type === 'folder-select') {
          continue;
        }
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

    // NSF: role is required on grant for share/permission actions.
    if (isNsfMode &&
        ['share-record', 'share-folder', 'record-permission'].includes(selectedAction.value) &&
        formData.action === 'grant' &&
        (!formData.role || String(formData.role).trim() === '')) {
      return false;
    }

    return true;
  };

  const renderClassicModeCheckbox = () => {
    // Members never see record/folder lists, so vault loading must not lock
    // the checkbox for them. Admins still get the lock to prevent rapid-toggle
    // races while their lists are actively fetching.
    const isFetchingVisibleLists = isAdmin && (loadingRecords || loadingFolders);
    const isCheckboxDisabled = isFormDisabled || isExecuting || isModeLocked || isFetchingVisibleLists;
    return (
      <div className="classic-mode-toggle">
        <label className={`classic-mode-label ${isCheckboxDisabled ? 'classic-mode-label-disabled' : ''}`}>
          <input
            type="checkbox"
            className="classic-mode-input"
            checked={!isNsfMode}
            disabled={isCheckboxDisabled}
            onChange={(e) => handleNsfToggle(!e.target.checked)}
          />
          <span className="classic-mode-text">Use classic permission model</span>
        </label>
        <p className="classic-mode-description">
          {isFetchingVisibleLists
            ? 'Loading vault contents...'
            : isModeLocked
              ? `Locked to ${isNsfMode ? 'New Shared Folder' : 'Classic'} per the saved request.`
              : 'Limit sharing to basic access levels. Recommended only for compatibility with older workflows.'}
        </p>
      </div>
    );
  };

  // Render form input based on field type
  const renderFormInput = (field) => {
    let value = formData[field.name] || '';
    
    // Default expiration_type to 'none' if not set
    if (field.name === 'expiration_type' && !value) {
      value = 'none';
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
    
    // Don't show required error for non-admin users in share-record, share-folder, record-permission
    // EXCEPT for the action field which is now required
    const isNonAdminInSpecialActions = !isAdmin && 
      (selectedAction?.value === 'share-record' || 
       selectedAction?.value === 'share-folder' || 
       selectedAction?.value === 'record-permission');
    
    const isActionFieldRequired = field.name === 'action' && 
      !isAdmin && 
      (selectedAction?.value === 'share-record' || selectedAction?.value === 'share-folder');
    
    const hasRequiredError = field.required && !value && 
      selectedAction?.value !== 'record-update' && 
      (!isNonAdminInSpecialActions || isActionFieldRequired);
    
    // Generate className for input fields based on state
    const getInputClassName = (additionalClasses = '') => {
      const classes = ['input-field'];
      if (isFormDisabled) classes.push('disabled');
      if (hasCurrentValue) classes.push('has-value');
      if (hasRequiredError) classes.push('required-error');
      if (additionalClasses) classes.push(additionalClasses);
      return classes.join(' ');
    };


    switch (field.type) {
      case 'record-select':
        // Possibly dead — share-record uses admin dropdowns. Kept for constants compatibility.
        // Render record dropdown for share-record action
        const isCancelSelected = selectedAction?.value === 'share-record' && formData.action === 'cancel';
        const isRecordFieldDisabled = isFormDisabled || formData.sharedFolder || selectedFolder || isCancelSelected;
        return (
          <div className="relative">
            <input
              type="text"
              value={selectedRecord ? selectedRecord.title : ''}
              placeholder={isRecordFieldDisabled ? 'Disabled (folder selected)' : field.placeholder}
              disabled={isRecordFieldDisabled}
              readOnly
              onClick={() => {
                if (!isRecordFieldDisabled) {
                  setShowRecordDropdown(!showRecordDropdown);
                }
              }}
              className={`input-field pointer ${isRecordFieldDisabled ? 'disabled opacity-60' : 'opacity-100'} ${selectedRecord ? 'has-value' : ''}`}
            />
            {!isRecordFieldDisabled && (
              <div className="dropdown-arrow">
                ▼
              </div>
            )}
            {showRecordDropdown && !isRecordFieldDisabled && keeperRecords.length > 0 && (
              <>
                <div
                  className="dropdown-overlay"
                  onClick={() => setShowRecordDropdown(false)}
                />
                <div className="dropdown-container">
                  {keeperRecords.map((record, index) => (
                    <div
                      key={index}
                      className="dropdown-item"
                      onClick={() => {
                        setSelectedRecord(record);
                        handleInputChange(field.name, record.record_uid);
                        setShowRecordDropdown(false);
                      }}
                    >
                      <div className="font-medium text-md text-primary">{record.title}</div>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        );
      
      case 'folder-select':
        // Render folder dropdown for share-record action with search and pagination
        const isCancelSelectedForFolder = selectedAction?.value === 'share-record' && formData.action === 'cancel';
        // For cancel action, only enable folder dropdown for admin users
        // For other actions, disable if record is selected
        const isRecordAddFolderField = selectedAction?.value === 'record-add';
        const isFolderFieldDisabled = isFormDisabled ||
          (!isRecordAddFolderField && (formData.record || selectedRecord)) ||
          (isCancelSelectedForFolder && !isAdmin);
        const usableFoldersForPicker = foldersForActiveMode.filter(
          (folder) => folder.folder_uid || folder.folderUid || folder.uid
        );
        const showNsfFolderEmptyMessage =
          isNsfMode &&
          selectedAction?.value === 'record-add' &&
          !loadingFolders &&
          usableFoldersForPicker.length === 0;
        return (
          <div className="relative">
            <input
              type="text"
              value={
                selectedFolder
                  ? (selectedFolder.path || selectedFolder.name || selectedFolder.folderPath)
                  : ''
              }
              placeholder={
                isFolderFieldDisabled 
                  ? (isCancelSelectedForFolder && !isAdmin 
                      ? 'Folder selection available for admin users only' 
                      : 'Disabled (record selected)') 
                  : field.placeholder
              }
              disabled={isFolderFieldDisabled}
              readOnly
              onClick={() => {
                if (!isFolderFieldDisabled) {
                  setShowFolderDropdown(!showFolderDropdown);
                  if (!showFolderDropdown) {
                    setFolderSearchTerm('');
                    setFolderCurrentPage(1);
                  }
                }
              }}
              className={`input-field pointer ${isFolderFieldDisabled ? 'disabled opacity-60' : 'opacity-100'} ${selectedFolder ? 'has-value' : ''}`}
            />
            {!isFolderFieldDisabled && (
              <div className="dropdown-arrow">
                ▼
              </div>
            )}
            {loadingFolders && (
              <LoadingPlaceholder
                text={isNsfMode ? 'Loading shared folders...' : 'Loading folders...'}
                className="loading-indicator"
              />
            )}
            {showNsfFolderEmptyMessage && (
              <div className="error-text">
                No shared folders found. Create folders and ensure your account has access.
              </div>
            )}
            {showFolderDropdown && !isFolderFieldDisabled && usableFoldersForPicker.length > 0 && (() => {
              // For share-record, show only sharable folders.
              const sharedFolders = selectedAction?.value === 'share-record'
                ? usableFoldersForPicker.filter(isSharableFolder)
                : usableFoldersForPicker;
              
              // Apply search filter (search by name/path or UID)
              const searchFiltered = filterByTitleOrUid(sharedFolders, folderSearchTerm, ['name', 'folderPath'], ['folder_uid', 'folderUid']);
              
              // Pagination
              const totalPages = Math.ceil(searchFiltered.length / foldersPerPage);
              const startIdx = (folderCurrentPage - 1) * foldersPerPage;
              const paginatedItems = searchFiltered.slice(startIdx, startIdx + foldersPerPage);
              
              return (
                <>
                  <div
                    className="dropdown-overlay"
                    onClick={() => {
                      setShowFolderDropdown(false);
                      setFolderSearchTerm('');
                      setFolderCurrentPage(1);
                    }}
                  />
                  <div className="folder-dropdown-menu">
                    {/* Search Input */}
                    <input
                      type="text"
                      value={folderSearchTerm}
                      onChange={(e) => {
                        setFolderSearchTerm(e.target.value);
                        setFolderCurrentPage(1);
                      }}
                      placeholder="Search folders..."
                      autoFocus
                      className="folder-search-input"
                      onClick={(e) => e.stopPropagation()}
                    />
                    
                    {/* Folder List */}
                    <div className="overflow-y-auto flex-1">
                      {paginatedItems.length === 0 ? (
                        <div className="dropdown-no-results">
                          {sharedFolders.length === 0 ? 'No shared folders found' : 'No matching folders'}
                        </div>
                      ) : (
                        paginatedItems.map((folder, index) => (
                          <div
                            key={index}
                            className="dropdown-item"
                            onClick={() => {
                              setSelectedFolder(folder);
                              handleInputChange(field.name, folder.folderUid || folder.folder_uid);
                              setShowFolderDropdown(false);
                              setFolderSearchTerm('');
                              setFolderCurrentPage(1);
                            }}
                          >
                            <div className="font-medium text-md text-primary">
                              {folder.name || folder.folderPath}
                              {renderSourceBadge(folder)}
                            </div>
                            {renderFolderPath(folder)}
                          </div>
                        ))
                      )}
                    </div>
                    
                    <PaginationFooter
                      currentPage={folderCurrentPage}
                      totalPages={totalPages}
                      onPrev={() => setFolderCurrentPage(prev => prev - 1)}
                      onNext={() => setFolderCurrentPage(prev => prev + 1)}
                      variant="container"
                      stopPropagation
                    />
                  </div>
                </>
              );
            })()}
          </div>
        );
      
      case 'select':
        if (field.name === 'recordType') {
        }
        
        // Filter options for share-record action dropdown for non-admin users
        let filteredOptions = field.options || [];
        if (selectedAction?.value === 'share-record' && field.name === 'action' && !isAdmin) {
          // Remove 'cancel' and 'revoke' options for non-admin users
          filteredOptions = filteredOptions.filter(option => {
            const optionValue = typeof option === 'string' ? option : option.value;
            return optionValue !== 'cancel' && optionValue !== 'revoke';
          });
        }
        
        // Disable expiration_type dropdown when cancel, owner, or revoke action is selected for share-record
        const isExpirationDisabledForCancel = selectedAction?.value === 'share-record' && 
                                               field.name === 'expiration_type' && 
                                               (formData.action === 'cancel' || formData.action === 'owner' || formData.action === 'revoke');
        
        // Disable expiration_type dropdown when remove action is selected for share-folder
        const isExpirationDisabledForRemove = selectedAction?.value === 'share-folder' && 
                                               field.name === 'expiration_type' && 
                                               formData.action === 'remove';
        
        return (
          <select
            value={value}
            disabled={isFormDisabled || isExpirationDisabledForCancel || isExpirationDisabledForRemove}
            onChange={(e) => {
              const newValue = e.target.value;
              handleInputChange(field.name, newValue);
              
              // Special handling for recordType field
              if (field.name === 'recordType') {
                
                // Preserve current form data before switching templates
                const currentFormData = { ...formData, recordType: newValue };
                
                // Clear existing template fields first
                setTemplateFields([]);
                if (newValue && newValue !== '') {
                  fetchRecordTypeTemplateWithFormMapping(newValue, currentFormData);
                } else {
                  setRecordTypeTemplate({});
                  setTemplateFields([]);
                }
              }
              
              // Special handling for share-record action field when "cancel" is selected
              if (selectedAction?.value === 'share-record' && field.name === 'action' && newValue === 'cancel') {
                setRotateOnExpiration(false);
                setFormData(prev => ({
                  ...prev,
                  action: newValue,
                  can_share: false,
                  can_write: false,
                  recursive: false,
                  expiration_type: 'none',
                  expire_at: '',
                  expire_in: ''
                }));
              }
              
              // Special handling for share-record action field when "owner" is selected
              if (selectedAction?.value === 'share-record' && field.name === 'action' && newValue === 'owner') {
                setRotateOnExpiration(false);
                setFormData(prev => ({
                  ...prev,
                  action: newValue,
                  can_share: false,
                  can_write: false,
                  recursive: false,
                  expiration_type: 'none',
                  expire_at: '',
                  expire_in: ''
                }));
              }
              
              // Special handling for share-record action field when "revoke" is selected
              if (selectedAction?.value === 'share-record' && field.name === 'action' && newValue === 'revoke') {
                setRotateOnExpiration(false);
                setFormData(prev => ({
                  ...prev,
                  action: newValue,
                  expiration_type: 'none',
                  expire_at: '',
                  expire_in: ''
                }));
              }
              
              // Special handling for share-folder action field when "remove" is selected
              if (selectedAction?.value === 'share-folder' && field.name === 'action' && newValue === 'remove') {
                setRotateOnExpiration(false);
                setFormData(prev => ({
                  ...prev,
                  action: newValue,
                  can_edit: false,
                  can_share: false,
                  manage_users: false,
                  manage_records: false,
                  expiration_type: 'none',
                  expire_at: '',
                  expire_in: ''
                }));
              }
            }}
            className={getInputClassName()}
          >
            {/* Don't show placeholder option for expiration_type field */}
            {field.name !== 'expiration_type' && <option value="">{field.placeholder}</option>}
            {filteredOptions.map(option => {
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
      case 'role': {
        // NSF role select with description beneath the dropdown.
        const roleOptions = field.options || [];
        const selectedRole = roleOptions.find(r => r && r.value === value);
        return (
          <div>
            <select
              value={value || ''}
              disabled={isFormDisabled}
              onChange={(e) => handleInputChange(field.name, e.target.value)}
              className={getInputClassName()}
            >
              <option value="">{field.placeholder || 'Select role'}</option>
              {roleOptions.map(option => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
            {selectedRole && selectedRole.description && (
              <div className="form-description">{selectedRole.description}</div>
            )}
          </div>
        );
      }
      case 'textarea':
        return (
          <textarea
            value={value}
            disabled={isFormDisabled}
            onChange={(e) => handleInputChange(field.name, e.target.value)}
            placeholder={field.placeholder}
            rows={3}
            className={getInputClassName()}
          />
        );
      case 'secureTextarea':
        // Secure textarea with mask/unmask toggle - JIRA UI style
        return (
          <div className="secure-field-container">
            <textarea
              value={value}
              disabled={isFormDisabled}
              onChange={(e) => handleInputChange(field.name, e.target.value)}
              placeholder={field.placeholder}
              rows={4}
              className={`${getInputClassName()} ${showSecureNote ? 'secure-field-textarea' : 'secure-field-textarea-masked'}`}
            />
            <button
              type="button"
              onClick={() => setShowSecureNote(!showSecureNote)}
              disabled={isFormDisabled}
              title={showSecureNote ? 'Hide note content' : 'Show note content'}
              className="secure-toggle-btn"
            >
              {showSecureNote ? (
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/>
                  <line x1="1" y1="1" x2="23" y2="23"/>
                </svg>
              ) : (
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
                  <circle cx="12" cy="12" r="3"/>
                </svg>
              )}
            </button>
          </div>
        );
      case 'secureTextareaPrivateKey':
        // Secure textarea for SSH Private Key with mask/unmask toggle
        return (
          <div className="secure-field-container">
            <textarea
              value={value}
              disabled={isFormDisabled}
              onChange={(e) => handleInputChange(field.name, e.target.value)}
              placeholder={field.placeholder}
              rows={4}
              className={`${getInputClassName()} ${showPrivateKey ? 'secure-field-textarea-monospace' : 'secure-field-textarea-monospace-masked'}`}
            />
            <button
              type="button"
              onClick={() => setShowPrivateKey(!showPrivateKey)}
              disabled={isFormDisabled}
              title={showPrivateKey ? 'Hide private key' : 'Show private key'}
              className="secure-toggle-btn"
            >
              {showPrivateKey ? (
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/>
                  <line x1="1" y1="1" x2="23" y2="23"/>
                </svg>
              ) : (
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
                  <circle cx="12" cy="12" r="3"/>
                </svg>
              )}
            </button>
          </div>
        );
      case 'secureTextareaPublicKey':
        // Secure textarea for SSH Public Key with mask/unmask toggle
        return (
          <div className="secure-field-container">
            <textarea
              value={value}
              disabled={isFormDisabled}
              onChange={(e) => handleInputChange(field.name, e.target.value)}
              placeholder={field.placeholder}
              rows={3}
              className={`${getInputClassName()} ${showPublicKey ? 'secure-field-textarea-monospace' : 'secure-field-textarea-monospace-masked'}`}
            />
            <button
              type="button"
              onClick={() => setShowPublicKey(!showPublicKey)}
              disabled={isFormDisabled}
              title={showPublicKey ? 'Hide public key' : 'Show public key'}
              className="secure-toggle-btn"
            >
              {showPublicKey ? (
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/>
                  <line x1="1" y1="1" x2="23" y2="23"/>
                </svg>
              ) : (
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
                  <circle cx="12" cy="12" r="3"/>
                </svg>
              )}
            </button>
          </div>
        );
      case 'secureText':
        // Secure single-line text input with mask/unmask toggle - JIRA UI style
        return (
          <div className="secure-field-container">
            <input
              type={showLicenseKey ? 'text' : 'password'}
              value={value}
              disabled={isFormDisabled}
              onChange={(e) => handleInputChange(field.name, e.target.value)}
              placeholder={field.placeholder}
              className={`${getInputClassName()} secure-field-input`}
            />
            <button
              type="button"
              onClick={() => setShowLicenseKey(!showLicenseKey)}
              disabled={isFormDisabled}
              title={showLicenseKey ? 'Hide content' : 'Show content'}
              className="secure-toggle-btn-center"
            >
              {showLicenseKey ? (
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/>
                  <line x1="1" y1="1" x2="23" y2="23"/>
                </svg>
              ) : (
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
                  <circle cx="12" cy="12" r="3"/>
                </svg>
              )}
            </button>
          </div>
        );
      case 'number':
        return (
          <input
            type="number"
            value={value}
            disabled={isFormDisabled}
            onChange={(e) => handleInputChange(field.name, e.target.value)}
            placeholder={field.placeholder}
            className={getInputClassName()}
          />
        );
      case 'dateMMDDYYYY':
        // Date picker with MM/DD/YYYY format display - JIRA UI style
        return (
          <div className="secure-field-container">
            <input
              type="date"
              value={value}
              disabled={isFormDisabled}
              onChange={(e) => {
                const dateValue = e.target.value;
                handleInputChange(field.name, dateValue);
              }}
              placeholder={field.placeholder}
              className={`${getInputClassName()} date-field-input`}
            />
            {value && (
              <div className="date-field-hint">
                {(() => {
                  try {
                    const [year, month, day] = value.split('-');
                    return `Format: ${month}/${day}/${year}`;
                  } catch {
                    return '';
                  }
                })()}
              </div>
            )}
          </div>
        );
      case 'checkbox':
        // Special handling for recursive checkbox in share-record action
        const isRecursiveDisabled = !isNsfMode &&
                                     selectedAction?.value === 'share-record' && 
                                     field.name === 'recursive' && 
                                     (formData.record || !formData.sharedFolder);
        
        // Special handling for can_share checkbox in share-record action
        const isCanShareDisabled = selectedAction?.value === 'share-record' && 
                                     field.name === 'can_share' && 
                                     formData.expiration_type && 
                                     formData.expiration_type !== 'none';
        
        // Special handling for manage_users checkbox in share-folder action
        const isManageUsersDisabled = selectedAction?.value === 'share-folder' && 
                                       field.name === 'manage_users' && 
                                       formData.expiration_type && 
                                       formData.expiration_type !== 'none';
        
        // Disable all checkboxes when "cancel" action is selected for share-record
        const isCancelActionDisabled = selectedAction?.value === 'share-record' && 
                                        formData.action === 'cancel' &&
                                        (field.name === 'can_share' || field.name === 'can_write' || field.name === 'recursive');
        
        // Disable all checkboxes when "owner" action is selected for share-record (owner doesn't support permissions)
        const isOwnerActionDisabled = selectedAction?.value === 'share-record' && 
                                        formData.action === 'owner' &&
                                        (field.name === 'can_share' || field.name === 'can_write' || field.name === 'recursive');
        
        // Note: For share-record revoke action, checkboxes ARE needed to specify what permissions to revoke
        // Per Keeper docs: -s (share), -w (write), -R (recursive) are valid flags for revoke action
        
        // Disable all checkboxes when "remove" action is selected for share-folder (remove doesn't support permissions or expiration)
        const isRemoveActionDisabled = selectedAction?.value === 'share-folder' && 
                                        formData.action === 'remove' &&
                                        (field.name === 'can_edit' || field.name === 'can_share' || field.name === 'manage_users' || field.name === 'manage_records');
        
        const isExpirationDisabled = isCanShareDisabled || isManageUsersDisabled;
        const checkboxDisabled = isFormDisabled || isExpirationDisabled || isRecursiveDisabled || isCancelActionDisabled || isOwnerActionDisabled || isRemoveActionDisabled;
        
        return (
          <div className={`checkbox-container ${(checkboxDisabled || isExpirationDisabled) ? 'disabled' : ''}`}>
            <input
              type="checkbox"
              checked={value === true || value === 'true'}
              disabled={checkboxDisabled}
              onChange={(e) => handleInputChange(field.name, e.target.checked)}
              className="checkbox-input"
            />
            <div className="checkbox-content">
              <div className={`checkbox-label ${checkboxDisabled ? 'disabled' : ''}`}>
                {field.label}
                {(isCanShareDisabled || isManageUsersDisabled) && (
                  <span className="checkbox-disabled-msg">
                    (Disabled due to expiration)
                  </span>
                )}
                {isRecursiveDisabled && (
                  <span className="checkbox-disabled-msg">
                    (Only for shared folder)
                  </span>
                )}
                {isOwnerActionDisabled && (
                  <span className="checkbox-disabled-msg">
                    (Not supported for Owner action)
                  </span>
                )}
                {isRemoveActionDisabled && (
                  <span className="checkbox-disabled-msg">
                    (Not supported for Remove action)
                  </span>
                )}
              </div>
              {field.description && (
                <div className={`field-description ${checkboxDisabled ? 'disabled' : ''}`}>
                  {field.description}
                </div>
              )}
            </div>
          </div>
        );
      case 'phoneEntries':
        // Dynamic phone number entries component - Complete country list from Keeper
        const countryOptions = [
          { code: 'AC', label: 'AC (+247)' }, { code: 'AD', label: 'AD (+376)' }, { code: 'AE', label: 'AE (+971)' },
          { code: 'AF', label: 'AF (+93)' }, { code: 'AG', label: 'AG (+1)' }, { code: 'AI', label: 'AI (+1)' },
          { code: 'AL', label: 'AL (+355)' }, { code: 'AM', label: 'AM (+374)' }, { code: 'AO', label: 'AO (+244)' },
          { code: 'AR', label: 'AR (+54)' }, { code: 'AS', label: 'AS (+1)' }, { code: 'AT', label: 'AT (+43)' },
          { code: 'AU', label: 'AU (+61)' }, { code: 'AW', label: 'AW (+297)' }, { code: 'AX', label: 'AX (+358)' },
          { code: 'AZ', label: 'AZ (+994)' }, { code: 'BA', label: 'BA (+387)' }, { code: 'BB', label: 'BB (+1)' },
          { code: 'BD', label: 'BD (+880)' }, { code: 'BE', label: 'BE (+32)' }, { code: 'BF', label: 'BF (+226)' },
          { code: 'BG', label: 'BG (+359)' }, { code: 'BH', label: 'BH (+973)' }, { code: 'BI', label: 'BI (+257)' },
          { code: 'BJ', label: 'BJ (+229)' }, { code: 'BL', label: 'BL (+590)' }, { code: 'BM', label: 'BM (+1)' },
          { code: 'BN', label: 'BN (+673)' }, { code: 'BO', label: 'BO (+591)' }, { code: 'BQ', label: 'BQ (+599)' },
          { code: 'BR', label: 'BR (+55)' }, { code: 'BS', label: 'BS (+1)' }, { code: 'BT', label: 'BT (+975)' },
          { code: 'BW', label: 'BW (+267)' }, { code: 'BY', label: 'BY (+375)' }, { code: 'BZ', label: 'BZ (+501)' },
          { code: 'CA', label: 'CA (+1)' }, { code: 'CC', label: 'CC (+61)' }, { code: 'CD', label: 'CD (+243)' },
          { code: 'CF', label: 'CF (+236)' }, { code: 'CG', label: 'CG (+242)' }, { code: 'CH', label: 'CH (+41)' },
          { code: 'CI', label: 'CI (+225)' }, { code: 'CK', label: 'CK (+682)' }, { code: 'CL', label: 'CL (+56)' },
          { code: 'CM', label: 'CM (+237)' }, { code: 'CN', label: 'CN (+86)' }, { code: 'CO', label: 'CO (+57)' },
          { code: 'CR', label: 'CR (+506)' }, { code: 'CU', label: 'CU (+53)' }, { code: 'CV', label: 'CV (+238)' },
          { code: 'CW', label: 'CW (+599)' }, { code: 'CX', label: 'CX (+61)' }, { code: 'CY', label: 'CY (+357)' },
          { code: 'CZ', label: 'CZ (+420)' }, { code: 'DE', label: 'DE (+49)' }, { code: 'DJ', label: 'DJ (+253)' },
          { code: 'DK', label: 'DK (+45)' }, { code: 'DM', label: 'DM (+1)' }, { code: 'DO', label: 'DO (+1)' },
          { code: 'DZ', label: 'DZ (+213)' }, { code: 'EC', label: 'EC (+593)' }, { code: 'EE', label: 'EE (+372)' },
          { code: 'EG', label: 'EG (+20)' }, { code: 'EH', label: 'EH (+212)' }, { code: 'ER', label: 'ER (+291)' },
          { code: 'ES', label: 'ES (+34)' }, { code: 'ET', label: 'ET (+251)' }, { code: 'FI', label: 'FI (+358)' },
          { code: 'FJ', label: 'FJ (+679)' }, { code: 'FK', label: 'FK (+500)' }, { code: 'FM', label: 'FM (+691)' },
          { code: 'FO', label: 'FO (+298)' }, { code: 'FR', label: 'FR (+33)' }, { code: 'GA', label: 'GA (+241)' },
          { code: 'GB', label: 'GB (+44)' }, { code: 'GD', label: 'GD (+1)' }, { code: 'GE', label: 'GE (+995)' },
          { code: 'GF', label: 'GF (+594)' }, { code: 'GG', label: 'GG (+44)' }, { code: 'GH', label: 'GH (+233)' },
          { code: 'GI', label: 'GI (+350)' }, { code: 'GL', label: 'GL (+299)' }, { code: 'GM', label: 'GM (+220)' },
          { code: 'GN', label: 'GN (+224)' }, { code: 'GP', label: 'GP (+590)' }, { code: 'GQ', label: 'GQ (+240)' },
          { code: 'GR', label: 'GR (+30)' }, { code: 'GT', label: 'GT (+502)' }, { code: 'GU', label: 'GU (+1)' },
          { code: 'GW', label: 'GW (+245)' }, { code: 'GY', label: 'GY (+592)' }, { code: 'HK', label: 'HK (+852)' },
          { code: 'HN', label: 'HN (+504)' }, { code: 'HR', label: 'HR (+385)' }, { code: 'HT', label: 'HT (+509)' },
          { code: 'HU', label: 'HU (+36)' }, { code: 'ID', label: 'ID (+62)' }, { code: 'IE', label: 'IE (+353)' },
          { code: 'IL', label: 'IL (+972)' }, { code: 'IM', label: 'IM (+44)' }, { code: 'IN', label: 'IN (+91)' },
          { code: 'IO', label: 'IO (+246)' }, { code: 'IQ', label: 'IQ (+964)' }, { code: 'IR', label: 'IR (+98)' },
          { code: 'IS', label: 'IS (+354)' }, { code: 'IT', label: 'IT (+39)' }, { code: 'JE', label: 'JE (+44)' },
          { code: 'JM', label: 'JM (+1)' }, { code: 'JO', label: 'JO (+962)' }, { code: 'JP', label: 'JP (+81)' },
          { code: 'KE', label: 'KE (+254)' }, { code: 'KG', label: 'KG (+996)' }, { code: 'KH', label: 'KH (+855)' },
          { code: 'KI', label: 'KI (+686)' }, { code: 'KM', label: 'KM (+269)' }, { code: 'KN', label: 'KN (+1)' },
          { code: 'KP', label: 'KP (+850)' }, { code: 'KR', label: 'KR (+82)' }, { code: 'KW', label: 'KW (+965)' },
          { code: 'KY', label: 'KY (+1)' }, { code: 'KZ', label: 'KZ (+7)' }, { code: 'LA', label: 'LA (+856)' },
          { code: 'LB', label: 'LB (+961)' }, { code: 'LC', label: 'LC (+1)' }, { code: 'LI', label: 'LI (+423)' },
          { code: 'LK', label: 'LK (+94)' }, { code: 'LR', label: 'LR (+231)' }, { code: 'LS', label: 'LS (+266)' },
          { code: 'LT', label: 'LT (+370)' }, { code: 'LU', label: 'LU (+352)' }, { code: 'LV', label: 'LV (+371)' },
          { code: 'LY', label: 'LY (+218)' }, { code: 'MA', label: 'MA (+212)' }, { code: 'MC', label: 'MC (+377)' },
          { code: 'MD', label: 'MD (+373)' }, { code: 'ME', label: 'ME (+382)' }, { code: 'MF', label: 'MF (+590)' },
          { code: 'MG', label: 'MG (+261)' }, { code: 'MH', label: 'MH (+692)' }, { code: 'MK', label: 'MK (+389)' },
          { code: 'ML', label: 'ML (+223)' }, { code: 'MM', label: 'MM (+95)' }, { code: 'MN', label: 'MN (+976)' },
          { code: 'MO', label: 'MO (+853)' }, { code: 'MP', label: 'MP (+1)' }, { code: 'MQ', label: 'MQ (+596)' },
          { code: 'MR', label: 'MR (+222)' }, { code: 'MS', label: 'MS (+1)' }, { code: 'MT', label: 'MT (+356)' },
          { code: 'MU', label: 'MU (+230)' }, { code: 'MV', label: 'MV (+960)' }, { code: 'MW', label: 'MW (+265)' },
          { code: 'MX', label: 'MX (+52)' }, { code: 'MY', label: 'MY (+60)' }, { code: 'MZ', label: 'MZ (+258)' },
          { code: 'NA', label: 'NA (+264)' }, { code: 'NC', label: 'NC (+687)' }, { code: 'NE', label: 'NE (+227)' },
          { code: 'NF', label: 'NF (+672)' }, { code: 'NG', label: 'NG (+234)' }, { code: 'NI', label: 'NI (+505)' },
          { code: 'NL', label: 'NL (+31)' }, { code: 'NO', label: 'NO (+47)' }, { code: 'NP', label: 'NP (+977)' },
          { code: 'NR', label: 'NR (+674)' }, { code: 'NU', label: 'NU (+683)' }, { code: 'NZ', label: 'NZ (+64)' },
          { code: 'OM', label: 'OM (+968)' }, { code: 'PA', label: 'PA (+507)' }, { code: 'PE', label: 'PE (+51)' },
          { code: 'PF', label: 'PF (+689)' }, { code: 'PG', label: 'PG (+675)' }, { code: 'PH', label: 'PH (+63)' },
          { code: 'PK', label: 'PK (+92)' }, { code: 'PL', label: 'PL (+48)' }, { code: 'PM', label: 'PM (+508)' },
          { code: 'PR', label: 'PR (+1)' }, { code: 'PS', label: 'PS (+970)' }, { code: 'PT', label: 'PT (+351)' },
          { code: 'PW', label: 'PW (+680)' }, { code: 'PY', label: 'PY (+595)' }, { code: 'QA', label: 'QA (+974)' },
          { code: 'RE', label: 'RE (+262)' }, { code: 'RO', label: 'RO (+40)' }, { code: 'RS', label: 'RS (+381)' },
          { code: 'RU', label: 'RU (+7)' }, { code: 'RW', label: 'RW (+250)' }, { code: 'SA', label: 'SA (+966)' },
          { code: 'SB', label: 'SB (+677)' }, { code: 'SC', label: 'SC (+248)' }, { code: 'SD', label: 'SD (+249)' },
          { code: 'SE', label: 'SE (+46)' }, { code: 'SG', label: 'SG (+65)' }, { code: 'SH', label: 'SH (+290)' },
          { code: 'SI', label: 'SI (+386)' }, { code: 'SJ', label: 'SJ (+47)' }, { code: 'SK', label: 'SK (+421)' },
          { code: 'SL', label: 'SL (+232)' }, { code: 'SM', label: 'SM (+378)' }, { code: 'SN', label: 'SN (+221)' },
          { code: 'SO', label: 'SO (+252)' }, { code: 'SR', label: 'SR (+597)' }, { code: 'SS', label: 'SS (+211)' },
          { code: 'ST', label: 'ST (+239)' }, { code: 'SV', label: 'SV (+503)' }, { code: 'SX', label: 'SX (+1)' },
          { code: 'SY', label: 'SY (+963)' }, { code: 'SZ', label: 'SZ (+268)' }, { code: 'TA', label: 'TA (+290)' },
          { code: 'TC', label: 'TC (+1)' }, { code: 'TD', label: 'TD (+235)' }, { code: 'TG', label: 'TG (+228)' },
          { code: 'TH', label: 'TH (+66)' }, { code: 'TJ', label: 'TJ (+992)' }, { code: 'TK', label: 'TK (+690)' },
          { code: 'TL', label: 'TL (+670)' }, { code: 'TM', label: 'TM (+993)' }, { code: 'TN', label: 'TN (+216)' },
          { code: 'TO', label: 'TO (+676)' }, { code: 'TR', label: 'TR (+90)' }, { code: 'TT', label: 'TT (+1)' },
          { code: 'TV', label: 'TV (+688)' }, { code: 'TW', label: 'TW (+886)' }, { code: 'TZ', label: 'TZ (+255)' },
          { code: 'UA', label: 'UA (+380)' }, { code: 'UG', label: 'UG (+256)' }, { code: 'US', label: 'US (+1)' },
          { code: 'UY', label: 'UY (+598)' }, { code: 'UZ', label: 'UZ (+998)' }, { code: 'VA', label: 'VA (+39)' },
          { code: 'VC', label: 'VC (+1)' }, { code: 'VE', label: 'VE (+58)' }, { code: 'VG', label: 'VG (+1)' },
          { code: 'VI', label: 'VI (+1)' }, { code: 'VN', label: 'VN (+84)' }, { code: 'VU', label: 'VU (+678)' },
          { code: 'WF', label: 'WF (+681)' }, { code: 'WS', label: 'WS (+685)' }, { code: 'YE', label: 'YE (+967)' },
          { code: 'YT', label: 'YT (+262)' }, { code: 'ZA', label: 'ZA (+27)' }, { code: 'ZM', label: 'ZM (+260)' },
          { code: 'ZW', label: 'ZW (+263)' }
        ];
        const phoneTypeOptions = ['Mobile', 'Work', 'Home'];
        
        const addPhoneEntry = () => {
          const newId = Math.max(...phoneEntries.map(e => e.id), 0) + 1;
          setPhoneEntries([...phoneEntries, { id: newId, region: 'US', number: '', ext: '', type: 'Mobile', isNew: true }]);
        };
        
        const removePhoneEntry = (id) => {
          const updatedEntries = phoneEntries.filter(e => e.id !== id);
          setPhoneEntries(updatedEntries);
        };
        
        const updatePhoneEntry = (id, fieldName, fieldValue) => {
          setPhoneEntries(phoneEntries.map(entry => {
            if (entry.id === id) {
              // Mark as edited when number field is changed
              const isEdited = fieldName === 'number' ? true : entry.isEdited;
              return { ...entry, [fieldName]: fieldValue, isEdited };
            }
            return entry;
          }));
        };
        
        // Mask phone number - show last 4 digits only
        const maskPhoneNumber = (number) => {
          if (!number || number.length <= 4) return '••••••••';
          return '••••••' + number.slice(-4);
        };
        
        // Show all phone entries (existing from record + newly added)
        const visiblePhoneEntries = phoneEntries;
        
        const renderPhoneRow = (entry) => {
          // For existing entries that haven't been edited, show masked number
          const isExistingUnedited = !entry.isNew && !entry.isEdited && entry.number;
          const displayNumber = isExistingUnedited ? maskPhoneNumber(entry.originalNumber || entry.number) : entry.number;
          
          return (
          <div key={entry.id} className="phone-entry-row">
            <div className="phone-entry-fields">
              <div className="phone-field-group">
                <label className="phone-field-label">Country</label>
                <select
                  value={entry.region}
                  onChange={(e) => updatePhoneEntry(entry.id, 'region', e.target.value)}
                  disabled={isFormDisabled}
                  className="phone-country-select"
                >
                  {countryOptions.map(opt => (
                    <option key={opt.code} value={opt.code}>{opt.label}</option>
                  ))}
                </select>
              </div>
              
              <div className="phone-field-group phone-number-field">
                <label className="phone-field-label">Phone Number</label>
                <input
                  type="tel"
                  value={isExistingUnedited ? '' : entry.number}
                  onChange={(e) => updatePhoneEntry(entry.id, 'number', e.target.value.replace(/[^0-9-() ]/g, ''))}
                  disabled={isFormDisabled}
                  placeholder={isExistingUnedited ? displayNumber : '555-555-5555'}
                  className="phone-number-input"
                />
              </div>
              
              <div className="phone-field-group phone-ext-field">
                <label className="phone-field-label">Ext.</label>
                <input
                  type="text"
                  value={entry.ext}
                  onChange={(e) => updatePhoneEntry(entry.id, 'ext', e.target.value)}
                  disabled={isFormDisabled}
                  placeholder="Ext."
                  className="phone-ext-input"
                />
              </div>
              
              <div className="phone-field-group">
                <label className="phone-field-label">Type</label>
                <select
                  value={entry.type}
                  onChange={(e) => updatePhoneEntry(entry.id, 'type', e.target.value)}
                  disabled={isFormDisabled}
                  className="phone-type-select"
                >
                  {phoneTypeOptions.map(type => (
                    <option key={type} value={type}>{type}</option>
                  ))}
                </select>
              </div>
            </div>
            
            <button
              type="button"
              onClick={() => removePhoneEntry(entry.id)}
              disabled={isFormDisabled}
              className="phone-delete-btn"
              title="Remove phone number"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <polyline points="3 6 5 6 21 6"/>
                <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
              </svg>
            </button>
          </div>
        )};
        
        // Only allow one phone entry for contact records
        const hasPhoneEntry = visiblePhoneEntries.length > 0;
        
        return (
          <div className="phone-entries-container">
            {/* Show phone entry OR "+ Phone Number" button (only one phone allowed) */}
            {hasPhoneEntry ? (
              // Show existing/added phone entry (only first one)
              visiblePhoneEntries.slice(0, 1).map(renderPhoneRow)
            ) : (
              // Show "+ Phone Number" button only if no phone exists
              <div className="phone-entries-header">
                <button
                  type="button"
                  onClick={addPhoneEntry}
                  disabled={isFormDisabled}
                  className="phone-add-btn"
                  title="Add Phone Number"
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <circle cx="12" cy="12" r="10"/>
                    <line x1="12" y1="8" x2="12" y2="16"/>
                    <line x1="8" y1="12" x2="16" y2="12"/>
                  </svg>
                  <span>{field.label || 'Phone Number'}</span>
                </button>
              </div>
            )}
          </div>
        );
      case 'password':
        // Special handling for PIN code fields with show/hide toggle
        if (field.name === 'pinCode') {
          return (
            <div className="relative">
              <input
                type={showPinCode ? 'text' : 'password'}
                value={value}
                disabled={isFormDisabled}
                onChange={(e) => handleInputChange(field.name, e.target.value)}
                placeholder={field.placeholder}
                className={getInputClassName('input-with-button')}
              />
              <button
                type="button"
                onClick={() => setShowPinCode(!showPinCode)}
                className="toggle-password-btn"
                title={showPinCode ? 'Hide PIN' : 'Show PIN'}
              >
                {showPinCode ? 'Hide' : 'Show'}
              </button>
            </div>
          );
        }
        // Regular password field with hide/show toggle
        const passwordValidation = validatePassword(value);
        const hasValidationErrors = !passwordValidation.isValid && value && value !== '$GEN';
        
        return (
          <div>
            <div className="secure-field-container">
              <input
                type={showPassword ? 'text' : 'password'}
                value={value}
                disabled={isFormDisabled}
                onChange={(e) => handleInputChange(field.name, e.target.value)}
                placeholder={field.placeholder || "Password or $GEN"}
                className={`${getInputClassName()} secure-field-input ${hasValidationErrors ? 'required-error' : ''}`}
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                disabled={isFormDisabled}
                title={showPassword ? 'Hide password' : 'Show password'}
                className="secure-toggle-btn-center"
              >
                {showPassword ? (
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/>
                    <line x1="1" y1="1" x2="23" y2="23"/>
                  </svg>
                ) : (
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
                    <circle cx="12" cy="12" r="3"/>
                  </svg>
                )}
              </button>
            </div>
            <div className="password-hint">
              Enter your own password or type <strong>$GEN</strong> for automatic password generation
            </div>
            {hasValidationErrors && (
              <div className="validation-errors">
                Password requirements:
                <ul>
                  {passwordValidation.errors.map((error, index) => (
                    <li key={index}>{error}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        );
      default:
        // Use getInputTypeForField to map field types to proper HTML input types
        const inputType = getInputTypeForField(field.type);
        
        // Special handling for password-like fields to show the $GEN note with hide/show toggle
        if (inputType === 'password') {
          const passwordValidation2 = validatePassword(value);
          const hasValidationErrors2 = !passwordValidation2.isValid && value && value !== '$GEN';
          
          return (
            <div>
              <div className="secure-field-container">
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={value}
                  disabled={isFormDisabled}
                  onChange={(e) => handleInputChange(field.name, e.target.value)}
                  placeholder={field.placeholder || "Password or $GEN"}
                  className={`${getInputClassName()} secure-field-input ${hasValidationErrors2 ? 'required-error' : ''}`}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  disabled={isFormDisabled}
                  title={showPassword ? 'Hide password' : 'Show password'}
                  className="secure-toggle-btn-center"
                >
                  {showPassword ? (
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/>
                      <line x1="1" y1="1" x2="23" y2="23"/>
                    </svg>
                  ) : (
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
                      <circle cx="12" cy="12" r="3"/>
                    </svg>
                  )}
                </button>
              </div>
              <div className="password-hint">
                Enter your own password or type <strong>$GEN</strong> for automatic password generation
              </div>
              {hasValidationErrors2 && (
                <div className="validation-errors">
                  Password requirements:
                  <ul>
                    {passwordValidation2.errors.map((error, index) => (
                      <li key={index}>{error}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          );
        }
        
        // Check if this is the user/email field in share-record or share-folder for non-admin users
        const isUserFieldForNonAdmin = !isAdmin && 
                                       field.name === 'user' && 
                                       (selectedAction?.value === 'share-record' || selectedAction?.value === 'share-folder');
        
        // Check if this is a port field (only allow numbers)
        const isPortField = field.name === 'host_port' || field.name.includes('_port') || field.subField === 'port';
        
        // Check if this is a phone number field (only allow numbers and +)
        const isPhoneField = field.type === 'tel' || field.name === 'phone_number' || field.name.includes('phone_number');
        
        // Check if this is a phone extension field (only allow numbers)
        const isPhoneExtField = field.name === 'phone_ext' || field.name.includes('phone_ext') || field.subField === 'ext';
        
        // Handler for port field - only allow numbers
        const handlePortChange = (e) => {
          const newValue = e.target.value.replace(/[^0-9]/g, '');
          handleInputChange(field.name, newValue);
        };
        
        // Handler for phone field - only allow numbers and + (for international codes)
        const handlePhoneChange = (e) => {
          const newValue = e.target.value.replace(/[^0-9+]/g, '');
          handleInputChange(field.name, newValue);
        };
        
        // Handler for phone extension - only allow numbers
        const handlePhoneExtChange = (e) => {
          const newValue = e.target.value.replace(/[^0-9]/g, '');
          handleInputChange(field.name, newValue);
        };
        
        // Determine the onChange handler based on field type
        const getChangeHandler = () => {
          if (isPortField) return handlePortChange;
          if (isPhoneField) return handlePhoneChange;
          if (isPhoneExtField) return handlePhoneExtChange;
          return (e) => handleInputChange(field.name, e.target.value);
        };
        
        return (
          <input
            type={inputType}
            value={value}
            disabled={isFormDisabled}
            readOnly={isUserFieldForNonAdmin}
            onChange={getChangeHandler()}
            placeholder={field.placeholder}
            className={`${getInputClassName()} ${isUserFieldForNonAdmin ? 'readonly-field' : ''}`}
            title={isUserFieldForNonAdmin ? 'This field is auto-populated with your email address' : ''}
          />
        );
    }
  };

  useEffect(() => {
    // Load issue context
    setIsLoading(true);
    api.getIssueContext()
      .then((context) => {
        setIssueContext(context);
        
        // The companion JIRA ITSM Forge app prefixes the audit_event with "ITSM_"
        // when adding it as a Jira label. Detect each ITSM-driven workflow we
        // know how to render so we can route to the right admin panel below.
        const labels = context.labels || [];
        const isItsmApproval = labels.includes('ITSM_approval_request_created');
        const isItsmDeviceApproval = labels.includes('ITSM_device_admin_approval_requested');
        setIsItsmApprovalTicket(isItsmApproval);
        setIsItsmDeviceApprovalTicket(isItsmDeviceApproval);
        
        // Clear any previous stored data to ensure fresh start for new ticket
        setStoredRequestData(null);
        setHasStoredData(false);
        
        // Activate Keeper panel for all users on this issue
        if (context.issueKey) {
          api.activateKeeperPanel(context.issueKey)
            .then((result) => {
            })
            .catch((error) => {
              // Log error but don't show to user as this is not critical
              const errorMessage = handleApiError(error, "Failed to activate Keeper panel");
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

    // Reject if selected items don't match the active vault mode.
    const expectedLabel = isNsfMode ? 'New Shared Folder' : 'Classic';
    const sourceMismatch =
      (selectedRecord && (selectedRecord.source || 'classic') !== activeVaultMode) ||
      (selectedRecordForUpdate && (selectedRecordForUpdate.source || 'classic') !== activeVaultMode) ||
      (selectedFolder && (selectedFolder.source || 'classic') !== activeVaultMode);
    if (sourceMismatch) {
      setLastResult({
        success: false,
        message: `Selected record or folder type does not match the current mode (${expectedLabel}). Please reselect from the picker.`
      });
      return;
    }

    setIsExecuting(true);
    setLastResult(null);

    try {
      // Format timestamp with user's local time (same as save/reject requests)
      const formattedTimestamp = new Date().toLocaleString('en-US', {
        month: '2-digit',
        day: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false
      });
      
      // Prepare final parameters for special actions
      let finalParameters = { ...formData };
      
      // Add phoneEntries for contact record type
      if (selectedAction.value === 'record-add' && formData.recordType === 'contact') {
        // Filter out empty phone entries and add to parameters
        const validPhoneEntries = phoneEntries.filter(entry => entry.number && entry.number.trim());
        if (validPhoneEntries.length > 0) {
          finalParameters.phoneEntries = validPhoneEntries;
        }
      }

      if (selectedAction.value === 'record-add' && selectedFolder) {
        finalParameters.folder =
          selectedFolder.folder_uid || selectedFolder.folderUid || selectedFolder.uid;
      }
      
      if (selectedAction.value === 'share-record' && selectedRecord) {
        // Ensure record field is populated with selected record UID
        finalParameters.record = selectedRecord.record_uid;
        // Include record title for comment message
        finalParameters.recordTitle = selectedRecord.title;
        // User/email and action fields are already in formData from manual input
        
      }

      // NSF: share all records in a folder via nsf-share-record <folderUid>.
      if (
        selectedAction.value === 'share-record' &&
        isNsfMode &&
        !selectedRecord &&
        selectedFolder
      ) {
        finalParameters.sharedFolder =
          selectedFolder.folder_uid ||
          selectedFolder.uid ||
          selectedFolder.path ||
          selectedFolder.name;
      }
      
      if (selectedAction.value === 'record-update' && selectedRecordForUpdate) {
        // Ensure record field is populated with selected record UID for update
        finalParameters.record = selectedRecordForUpdate.record_uid;
        // All other fields from formData contain the updated values
        
        // Special handling for password field - don't send masked password
        if (finalParameters.password === '••••••••') {
          delete finalParameters.password; // Don't send masked password back
        }

        // KJ-26-06: Record type is immutable on update. The form still shows
        // the record type for context, but we never submit it — the backend
        // will reject the request if recordType is present.
        delete finalParameters.recordType;
        
        // IMPORTANT: Merge existing values for complex JSON fields to prevent data loss
        // When sending partial updates for fields like name, address, host, etc.,
        // we need to include existing values to prevent overwriting
        // Using originalComplexFields which is reliably stored when record is loaded
        
        if (originalComplexFields && Object.keys(originalComplexFields).length > 0) {
          
          // Merge name fields - preserve existing values if not provided in form
          if (originalComplexFields.name) {
            const existingName = originalComplexFields.name;
            // Check if any name field is being updated
            const hasNameUpdate = finalParameters.name_first || finalParameters.name_middle || finalParameters.name_last;
            if (hasNameUpdate) {
              // Merge: use form value if provided, otherwise use existing value
              if (!finalParameters.name_first && existingName.first) {
                finalParameters.name_first = existingName.first;
              }
              if (!finalParameters.name_middle && existingName.middle) {
                finalParameters.name_middle = existingName.middle;
              }
              if (!finalParameters.name_last && existingName.last) {
                finalParameters.name_last = existingName.last;
              }
            }
          }
          
          // Merge address fields - preserve existing values if not provided in form
          if (originalComplexFields.address) {
            const existingAddr = originalComplexFields.address;
            const hasAddressUpdate = finalParameters.address_street1 || finalParameters.address_street2 || 
              finalParameters.address_city || finalParameters.address_state || 
              finalParameters.address_zip || finalParameters.address_country;
            if (hasAddressUpdate) {
              if (!finalParameters.address_street1 && existingAddr.street1) {
                finalParameters.address_street1 = existingAddr.street1;
              }
              if (!finalParameters.address_street2 && existingAddr.street2) {
                finalParameters.address_street2 = existingAddr.street2;
              }
              if (!finalParameters.address_city && existingAddr.city) {
                finalParameters.address_city = existingAddr.city;
              }
              if (!finalParameters.address_state && existingAddr.state) {
                finalParameters.address_state = existingAddr.state;
              }
              if (!finalParameters.address_zip && existingAddr.zip) {
                finalParameters.address_zip = existingAddr.zip;
              }
              if (!finalParameters.address_country && existingAddr.country) {
                finalParameters.address_country = existingAddr.country;
              }
            }
          }
          
          // Merge host fields - preserve existing values if not provided in form
          if (originalComplexFields.host) {
            const existingHost = originalComplexFields.host;
            const hasHostUpdate = finalParameters.host_hostName || finalParameters.host_port;
            if (hasHostUpdate) {
              if (!finalParameters.host_hostName && existingHost.hostName) {
                finalParameters.host_hostName = existingHost.hostName;
              }
              if (!finalParameters.host_port && existingHost.port) {
                finalParameters.host_port = existingHost.port;
              }
            }
          }
          
          // Merge pamHostname fields - preserve existing values if not provided in form
          if (originalComplexFields.pamHostname) {
            const existingPamHost = originalComplexFields.pamHostname;
            const hasPamHostUpdate = finalParameters.pamHostname_hostName || finalParameters.pamHostname_port;
            if (hasPamHostUpdate) {
              if (!finalParameters.pamHostname_hostName && existingPamHost.hostName) {
                finalParameters.pamHostname_hostName = existingPamHost.hostName;
              }
              if (!finalParameters.pamHostname_port && existingPamHost.port) {
                finalParameters.pamHostname_port = existingPamHost.port;
              }
            }
          }
          
          // Merge keyPair fields - preserve existing values if not provided in form
          if (originalComplexFields.keyPair) {
            const existingKeyPair = originalComplexFields.keyPair;
            const hasKeyPairUpdate = finalParameters.keyPair_privateKey || finalParameters.keyPair_publicKey;
            if (hasKeyPairUpdate) {
              if (!finalParameters.keyPair_privateKey && existingKeyPair.privateKey) {
                finalParameters.keyPair_privateKey = existingKeyPair.privateKey;
              }
              if (!finalParameters.keyPair_publicKey && existingKeyPair.publicKey) {
                finalParameters.keyPair_publicKey = existingKeyPair.publicKey;
              }
            }
          }
        }
        
        // Add phone entries only if modified (new or edited)
        if (formData.recordType === 'contact') {
          const modifiedPhoneEntries = phoneEntries.filter(entry => 
            (entry.isNew || entry.isEdited) && entry.number && entry.number.trim()
          );
          if (modifiedPhoneEntries.length > 0) {
            finalParameters.phoneEntries = modifiedPhoneEntries;
          }
        }
      }
      
      if (selectedAction.value === 'share-folder' && selectedFolder) {
        finalParameters.folder = selectedFolder.uid || selectedFolder.path || selectedFolder.name;
        finalParameters.folderTitle = selectedFolder.name;
      }

      // Pass rotation flag when the checkbox is checked.
      if (rotateOnExpiration &&
          (selectedAction.value === 'share-record' || selectedAction.value === 'share-folder')) {
        finalParameters.rotate_on_expiration = true;
      }
      
      if (selectedAction.value === 'record-permission' && selectedFolder) {
        const folderUid =
          selectedFolder.folder_uid ||
          selectedFolder.uid ||
          selectedFolder.path ||
          selectedFolder.name;

        if (isNsfMode) {
          // NSF: pass structured params; backend builds nsf-record-permission.
          finalParameters = {
            ...finalParameters,
            folder: folderUid
          };
        } else {
          // Classic record-permission: build cliCommand with -d/-s/-R/--force flags.
          let commandParts = ['record-permission', folderUid];

          if (finalParameters.action) {
            commandParts.push('-a', finalParameters.action);
          }
          if (finalParameters.can_edit) commandParts.push('-d');
          if (finalParameters.can_share) commandParts.push('-s');
          if (finalParameters.recursive) commandParts.push('-R');
          if (finalParameters.action === 'grant' || finalParameters.action === 'revoke') {
            commandParts.push('--force');
          }

          finalParameters = {
            cliCommand: commandParts.join(' ')
          };
        }
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

            // Address records are always created as Classic (no NSF folder in this sub-flow).
            const addressResult = await api.executeKeeperAction(
              issueContext.issueKey,
              "record-add",
              "Create address record",
              {
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
              },
              null,
              'classic'
            );

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
      }
      
      const result = await api.executeKeeperAction(
        issueContext.issueKey,
        selectedAction.value,
        selectedAction.description,
        finalParameters,
        formattedTimestamp,
        activeVaultMode
      );

      // Check for structured error response (new pattern)
      if (checkResultError(result)) {
        const errorMessage = handleApiError(result, "An error occurred");
        setLastResult({ 
          success: false, 
          message: errorMessage
        });
        setIsExecuting(false);
        return;
      }
      
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
      // Format timestamp with user's local time
      const formattedTimestamp = new Date().toLocaleString('en-US', {
        month: '2-digit',
        day: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false
      });
      
      // Update the JIRA ticket with rejection comment
      const result = await api.rejectKeeperRequest(issueContext.issueKey, rejectionReason.trim());

      // Check for structured error response (new pattern)
      if (checkResultError(result)) {
        const errorMessage = handleApiError(result, "An error occurred while rejecting the request.");
        setRejectionResult({ 
          success: false, 
          message: errorMessage
        });
        return;
      }

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
      <div className="loading-container-centered">
        <Spinner size="medium" />
        <p className="loading-text">Loading...</p>
      </div>
    );
  }

  if (!issueContext) {
    return (
      <div className="error-container">
        <SectionMessage appearance="error" title="Error">
          Failed to load issue context. Please refresh the page.
        </SectionMessage>
      </div>
    );
  }

 // Restrict access for ITSM-driven approval tickets (EPM + device admin).
  // Only admins can act on these; everyone else gets the same locked-out
  // message regardless of which specific ITSM workflow created the ticket.
  const isItsmRestrictedTicket = isItsmApprovalTicket || isItsmDeviceApprovalTicket;
  if (isItsmRestrictedTicket && !isAdmin) {
    const restrictedSubject = isItsmDeviceApprovalTicket
      ? 'a device admin approval request'
      : 'an Endpoint Privilege Manager approval request';
    return (
      <div className="issue-panel-container">
        <div className="panel-header">
          <div className="header-icon-wrapper">
            <LockIcon size="medium" />
          </div>
          <div className="header-content">
            <h1 className="panel-title">Keeper Security Integration</h1>
            <p className="panel-subtitle">Access Restricted</p>
          </div>
        </div>

        <div className="panel-body">
          <SectionMessage appearance="warning" title="Administrator Access Required">
            <p>
              This ticket was created by the Keeper Security ITSM integration for {restrictedSubject}.
              Access to the Keeper integration panel for these tickets is restricted to Jira Administrators and Project Administrators only.
            </p>
            <p style={{ marginTop: '12px' }}>
              If you need to perform actions on this request, please contact your Jira administrator.
            </p>
          </SectionMessage>
        </div>
      </div>
    );
  }

  // Admin-facing routing: dispatch to the dedicated panel for each ITSM
  // workflow we recognise via labels.
  if (isItsmApprovalTicket && isAdmin) {
    return <EpmApprovalPanel issueContext={issueContext} />;
  }
  if (isItsmDeviceApprovalTicket && isAdmin) {
    return <DeviceApprovalPanel issueContext={issueContext} />;
  }

  const rootClassName = `app-root ${
    (showDropdown || showRecordDropdown || showFolderDropdown || showRecordForUpdateDropdown) 
      ? 'app-root-expanded'
      : selectedAction 
        ? 'app-root-viewport'
        : 'app-root-auto'
  }`;

  const cardClassName = `app-card ${
    (showDropdown || showRecordDropdown || showFolderDropdown || showRecordForUpdateDropdown)
      ? 'app-card-expanded'
      : ''
  }`;

  return (
    <div className={rootClassName}>
      <div className={cardClassName}>
        {/* Header */}
        <div className="app-header">
          <LockIcon size="medium" primaryColor="#FFD700" />
          <h3 className="app-title">
            Keeper Integration Hub
          </h3>
        </div>

        {/* Configuration Status - Only show warning for admins */}
        {!issueContext.hasConfig && isAdmin && (
          <SectionMessage appearance="warning" title="Configuration Required">
            Keeper integration hub is not configured. Please go to the Keeper global
            page to set up the integration hub.
          </SectionMessage>
        )}

        {/* Action Selection and Approval - Allow non-admin users even without config since they only submit requests */}
        {(issueContext.hasConfig || !isAdmin) && !isLoadingStoredData && (
          <>
            <ActionSelector
              selectedAction={selectedAction}
              onActionSelect={(option) => {
                setSelectedAction(option);
                setShowDropdown(false);
                setSearchTerm("");
                setFormData({});
                setPhoneEntries([]);
                setRecordDetails({});
                setOriginalComplexFields({});
                setTemplateFields([]);
                setSelectedRecordForUpdate(null);
                setSelectedRecord(null);
                setSelectedFolder(null);
                setOriginalFormData({});
                setStoredRequestData(null);
                setHasStoredData(false);
                setCustomFields([]);
                setRotateOnExpiration(false);
                setIsRotationEligible(false);
                lastCheckedRoeRef.current = { type: '', uid: '' };
              }}
              disabled={isFormDisabled}
              searchTerm={searchTerm}
              onSearchChange={(val) => { setSearchTerm(val); setShowDropdown(true); }}
              showDropdown={showDropdown}
              onToggleDropdown={() => setShowDropdown(!showDropdown)}
              onCloseDropdown={() => setShowDropdown(false)}
              onFocusInput={() => { setSearchTerm(""); setShowDropdown(true); }}
              paginatedOptions={paginatedOptions}
              filteredCount={filteredOptions.length}
              currentPage={currentPage}
              totalPages={totalPages}
              onPrevPage={() => setCurrentPage(prev => prev - 1)}
              onNextPage={() => setCurrentPage(prev => prev + 1)}
            />

              {/* Dynamic Form Fields */}
              {selectedAction && actionOptions.find(action => action.value === selectedAction.value)?.fields && actionOptions.find(action => action.value === selectedAction.value)?.fields.length > 0 && (
                <div className="form-container">
                  <div className="form-section-heading">
                    Required Information:
                  </div>

                  {selectedAction.value === 'record-update' && renderClassicModeCheckbox()}

                  {/* Records Selector for record-update action only */}
                  {selectedAction.value === 'record-update' && (
                    <div className="mb-16">
                      {isAdmin && (
                        <>
                          <label className="label-block">
                            Step 1: Select Record to Update <span className="text-error">*</span>
                          </label>
                          
                          {/* Info about the record update process */}
                      {!selectedRecordForUpdate && (
                        <div className="info-msg-success italic">
                          Select a record to update.
                        </div>
                      )}
                      
                      {/* Records Dropdown Container for Update */}
                      <div className="relative z-1000">
                        {loadingRecords ? (
                          <LoadingPlaceholder text="Loading records..." />
                        ) : (
                          <>
                            {/* Records Search Input for Update */}
                            <input
                              id="keeper-records-update-input"
                              type="text"
                              disabled={isFormDisabled}
                              placeholder={
                                isFormDisabled ? "Form disabled..." :
                                showRecordForUpdateDropdown ? "Type to search records by title or UID..." : 
                                (selectedRecordForUpdate ? formatWithUid(selectedRecordForUpdate.title, selectedRecordForUpdate.record_uid) : "Click to select record to update...")
                              }
                              value={showRecordForUpdateDropdown ? recordForUpdateSearchTerm : (selectedRecordForUpdate ? formatWithUid(selectedRecordForUpdate.title, selectedRecordForUpdate.record_uid) : "")}
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
                              className={`action-select-input ${isFormDisabled ? 'action-select-input-disabled' : (showRecordForUpdateDropdown ? 'action-select-input-focused' : 'action-select-input-default')}`}
                            />
                            
                            {/* Records Dropdown Arrow for Update */}
                            <div
                              onClick={() => {
                                if (!isFormDisabled) {
                                  setShowRecordForUpdateDropdown(!showRecordForUpdateDropdown);
                                }
                              }}
                              className={`dropdown-arrow-pos ${isFormDisabled ? 'dropdown-arrow-pos-disabled' : 'dropdown-arrow-pos-enabled'}`}
                            >
                              ▼
                            </div>

                            {/* Records Dropdown Menu for Update */}
                            {showRecordForUpdateDropdown && !isFormDisabled && (
                              <div className="record-update-dropdown">
                                {/* Records Search Hint for Update */}
                                {!recordForUpdateSearchTerm && (
                                  <SearchHint text="Tip: Type in the field above to search records by title or UID" />
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
                                          // Clear previous record data immediately
                                          setRecordDetails({});
                                          setOriginalComplexFields({});
                                          // For record-update, keep the record identifier but clear other fields
                                          setFormData({
                                            record: record.record_uid || record.title // Keep record identifier
                                          });
                                          setRecordTypeTemplate({});
                                          setTemplateFields([]);
                                          setOriginalRecordType(null);
                                          setOriginalFormData({});
                                          // Fetch record details but preserve stored data if it exists
                                          const currentStoredData = hasStoredData && storedRequestData ? storedRequestData : null;
                                          fetchKeeperRecordDetails(record.record_uid, currentStoredData);
                                        }}
                                        className={`record-dropdown-item ${selectedRecordForUpdate?.record_uid === record.record_uid ? 'selected' : ''}`}
                                      >
                                        <div className="dropdown-option-title">
                                          {record.title}
                                          {renderSourceBadge(record)}
                                        </div>
                                        {record.record_uid && (
                                          <div className="dropdown-option-uid">
                                            UID: {record.record_uid}
                                          </div>
                                        )}
                                      </div>
                                    ))}
                                    
                                    <PaginationFooter
                                      currentPage={recordForUpdateCurrentPage}
                                      totalPages={totalRecordForUpdatePages}
                                      onPrev={() => setRecordForUpdateCurrentPage(prev => prev - 1)}
                                      onNext={() => setRecordForUpdateCurrentPage(prev => prev + 1)}
                                      itemCount={filteredRecordsForUpdate.length}
                                      itemLabel="records"
                                      variant="compact"
                                    />
                                  </>
                                ) : (
                                  <div className="no-results-msg">
                                    No records found matching "{recordForUpdateSearchTerm}"
                                  </div>
                                )}
                              </div>
                            )}

                            {/* Click outside to close records dropdown for update */}
                            {showRecordForUpdateDropdown && (
                              <div
                                className="click-overlay z-998"
                                onClick={() => setShowRecordForUpdateDropdown(false)}
                              />
                            )}
                          </>
                        )}
                      </div>
                      
                      {/* Selected record for update info */}
                      {selectedRecordForUpdate && (
                        <SelectedItemChip
                          variant="box"
                          title={selectedRecordForUpdate.title}
                          uid={selectedRecordForUpdate.record_uid}
                        >
                          {loadingRecordDetails && (
                            <div className="text-italic-sm">Loading...</div>
                          )}
                        </SelectedItemChip>
                      )}

                          {keeperRecords.length > 0 && (
                            <div className="item-count">
                              {keeperRecords.length} total records available for update
                            </div>
                          )}
                        </>
                      )}

                    </div>
                  )}

                  {/* Records Selector for share-record action only */}
                  {selectedAction.value === 'share-record' && isAdmin && (
                    <div className="share-record-selector">
                      <label className="share-record-label">
                        Select Record {formData.action === 'cancel' ? '(Required - Record or Folder):' : ':'}
                      </label>
                      
                      {/* Records Dropdown Container */}
                      <div className="relative z-1000">
                        {loadingRecords ? (
                          <LoadingPlaceholder text="Loading records..." />
                        ) : (
                          <>
                            {/* Records Search Input */}
                            <input
                              id="keeper-records-input"
                              type="text"
                              disabled={isFormDisabled || selectedFolder}
                              placeholder={
                                (isFormDisabled || selectedFolder) ? 
                                  (selectedFolder ? "Disabled (folder selected)" : "Form disabled...") :
                                showRecordDropdown ? "Type to search records by title or UID..." : 
                                (selectedRecord ? formatWithUid(selectedRecord.title, selectedRecord.record_uid) : "Click to select record...")
                              }
                              value={showRecordDropdown ? recordSearchTerm : (selectedRecord ? formatWithUid(selectedRecord.title, selectedRecord.record_uid) : "")}
                              onChange={(e) => {
                                if (!isFormDisabled && !selectedFolder) {
                                  setRecordSearchTerm(e.target.value);
                                  setShowRecordDropdown(true);
                                }
                              }}
                              onClick={() => {
                                if (!isFormDisabled && !selectedFolder) {
                                  setShowRecordDropdown(!showRecordDropdown);
                                }
                              }}
                              onFocus={(e) => {
                                if (!isFormDisabled && !selectedFolder) {
                                  setRecordSearchTerm("");
                                  setShowRecordDropdown(true);
                                }
                              }}
                              className={`action-select-input ${(isFormDisabled || selectedFolder) ? 'action-select-input-disabled' : (showRecordDropdown ? 'action-select-input-focused' : 'action-select-input-default')}`}
                            />
                            
                            {/* Records Dropdown Arrow */}
                            {!isFormDisabled && !selectedFolder && (
                              <div
                                onClick={() => {
                                  if (!isFormDisabled && !selectedFolder) {
                                    setShowRecordDropdown(!showRecordDropdown);
                                  }
                                }}
                                className="dropdown-arrow-pos dropdown-arrow-pos-enabled"
                              >
                                ▼
                              </div>
                            )}

                            {/* Records Dropdown Menu */}
                            {showRecordDropdown && !isFormDisabled && !selectedFolder && (
                              <div className="record-update-dropdown">

                                {/* Records Search Hint */}
                                {!recordSearchTerm && (
                                  <SearchHint text="Tip: Type in the field above to search records by title or UID" />
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
                                          // Auto-populate the Email field with current user's email only if not already set
                                          // This prevents overwriting the non-admin user's email when admin is viewing saved request
                                          if (issueContext?.currentUserEmail && !formData.user) {
                                            handleInputChange('user', issueContext.currentUserEmail);
                                          }
                                        }}
                                        className={`dropdown-item ${selectedRecord?.record_uid === record.record_uid ? 'selected' : ''}`}
                                      >
                                        <div className="dropdown-option-title">
                                          {record.title}
                                          {renderSourceBadge(record)}
                                        </div>
                                        {record.record_uid && (
                                          <div className="dropdown-option-uid">
                                            UID: {record.record_uid}
                                          </div>
                                        )}
                                      </div>
                                    ))}
                                    
                                    <PaginationFooter
                                      currentPage={recordCurrentPage}
                                      totalPages={totalRecordPages}
                                      onPrev={() => setRecordCurrentPage(prev => prev - 1)}
                                      onNext={() => setRecordCurrentPage(prev => prev + 1)}
                                      itemCount={filteredRecords.length}
                                      itemLabel="records"
                                      variant="container"
                                    />
                                  </>
                                ) : (
                                  <div className="dropdown-no-results">
                                    No records found matching "{recordSearchTerm}"
                                  </div>
                                )}
                              </div>
                            )}

                            {/* Click outside to close records dropdown */}
                            {showRecordDropdown && (
                              <div
                                className="click-overlay z-998"
                                onClick={() => setShowRecordDropdown(false)}
                              />
                            )}
                          </>
                        )}
                      </div>
                      
                      {/* Selected record info */}
                      {selectedRecord && (
                        <SelectedItemChip
                          title={selectedRecord.title}
                          uid={selectedRecord.record_uid}
                          disabled={isFormDisabled}
                          onClear={() => {
                            setSelectedRecord(null);
                            setFormData(prev => ({ ...prev, record: '' }));
                          }}
                        />
                      )}

                      {keeperRecords.length > 0 && (
                        <div className="share-record-count">
                          {keeperRecords.length} total records available
                        </div>
                      )}
                    </div>
                  )}

                  {/* Folder Selector for share-record action (dropdowns for admin only, text areas for all) */}
                  {selectedAction.value === 'share-record' && (
                    <div className="share-record-selector">
                      {isAdmin && (
                        <>
                          <label className="share-record-label">
                            Select Folder {formData.action === 'cancel' ? '(Required - Record or Folder):' : ':'}
                          </label>
                          
                          {/* Info message when folder is selected */}
                          {selectedFolder && (
                            <SelectedItemChip
                              title={selectedFolder.name || selectedFolder.folderPath}
                              uid={selectedFolder.folder_uid || selectedFolder.folderUid}
                              disabled={isFormDisabled}
                              onClear={() => {
                                setSelectedFolder(null);
                                setFormData(prev => ({ ...prev, sharedFolder: '' }));
                              }}
                            />
                          )}

                          {/* Folders Dropdown Container with search and pagination */}
                          <div className="relative z-997">
                        {loadingFolders ? (
                          <LoadingPlaceholder text="Loading folders..." />
                        ) : (
                          <>
                            {/* Folder Search Input */}
                            <input
                              type="text"
                              disabled={isFormDisabled || selectedRecord || (formData.action === 'cancel' && !isAdmin)}
                              placeholder={
                                (isFormDisabled || selectedRecord || (formData.action === 'cancel' && !isAdmin)) ? 
                                  ((formData.action === 'cancel' && !isAdmin) ? "Folder selection available for admin users only" : "Disabled (record selected)") :
                                showFolderDropdown ? "Type to search folders by name or UID..." : 
                                (selectedFolder ? formatWithUid(selectedFolder.name || selectedFolder.folderPath, selectedFolder.folder_uid || selectedFolder.folderUid) : "Click to select folder...")
                              }
                              value={showFolderDropdown ? folderSearchTerm : (selectedFolder ? formatWithUid(selectedFolder.name || selectedFolder.folderPath, selectedFolder.folder_uid || selectedFolder.folderUid) : "")}
                              onChange={(e) => {
                                if (!isFormDisabled && !selectedRecord && !(formData.action === 'cancel' && !isAdmin)) {
                                  setFolderSearchTerm(e.target.value);
                                  setFolderCurrentPage(1);
                                  setShowFolderDropdown(true);
                                }
                              }}
                              onClick={() => {
                                if (!isFormDisabled && !selectedRecord && !(formData.action === 'cancel' && !isAdmin)) {
                                  setShowFolderDropdown(!showFolderDropdown);
                                  if (!showFolderDropdown) {
                                    setFolderSearchTerm("");
                                    setFolderCurrentPage(1);
                                  }
                                }
                              }}
                              onFocus={(e) => {
                                if (!isFormDisabled && !selectedRecord && !(formData.action === 'cancel' && !isAdmin)) {
                                  setFolderSearchTerm("");
                                  setShowFolderDropdown(true);
                                }
                              }}
                              className={`folder-select-input ${
                                (isFormDisabled || selectedRecord || (formData.action === 'cancel' && !isAdmin)) ? 'folder-select-input-disabled' : 
                                showFolderDropdown ? 'folder-select-input-focused' :
                                selectedFolder ? 'folder-select-input-selected' :
                                'folder-select-input-default'
                              }`}
                            />
                            
                            {/* Dropdown arrow icon */}
                            {!isFormDisabled && !selectedRecord && !(formData.action === 'cancel' && !isAdmin) && (
                              <div className="dropdown-arrow-positioned">
                                ▼
                              </div>
                            )}
                            
                            {/* Folder Dropdown with search results */}
                            {showFolderDropdown && !isFormDisabled && !selectedRecord && !(formData.action === 'cancel' && !isAdmin) && (() => {
                              // Filter shared folders
                              const sharedFolders = keeperFolders.filter(folder => folder.shared || (folder.flags && folder.flags.includes('S')));
                              
                              // Apply search filter (search by name/path or UID)
                              const searchFiltered = filterByTitleOrUid(sharedFolders, folderSearchTerm, ['name', 'folderPath'], ['folder_uid', 'folderUid']);
                              
                              // Pagination
                              const totalPages = Math.ceil(searchFiltered.length / foldersPerPage);
                              const startIdx = (folderCurrentPage - 1) * foldersPerPage;
                              const paginatedItems = searchFiltered.slice(startIdx, startIdx + foldersPerPage);
                              
                              return (
                                <>
                                  {/* Fixed overlay to close dropdown */}
                                  <div
                                    className="click-overlay z-996"
                                    onClick={() => {
                                      setShowFolderDropdown(false);
                                      setFolderSearchTerm("");
                                      setFolderCurrentPage(1);
                                    }}
                                  />
                                  
                                  {/* Dropdown container */}
                                  <div className="dropdown-container z-997">
                                    {paginatedItems.length === 0 ? (
                                      <div className="dropdown-no-results">
                                        {sharedFolders.length === 0 ? 'No shared folders found' : 'No matching folders'}
                                      </div>
                                    ) : (
                                      paginatedItems.map((folder, index) => (
                                        <div
                                          key={index}
                                          className={`dropdown-item ${selectedFolder?.folder_uid === folder.folder_uid ? 'selected' : ''}`}
                                          onClick={() => {
                                            setSelectedFolder(folder);
                                            handleInputChange('sharedFolder', folder.folderUid || folder.folder_uid);
                                            setShowFolderDropdown(false);
                                            setFolderSearchTerm("");
                                            setFolderCurrentPage(1);
                                          }}
                                        >
                                          <div className="font-semibold text-base text-primary">
                                            {folder.name || folder.folderPath}
                                            {renderSourceBadge(folder)}
                                          </div>
                                          {renderFolderPath(folder)}
                                          {(folder.folder_uid || folder.folderUid) && (
                                            <div className="dropdown-option-uid">
                                              UID: {folder.folder_uid || folder.folderUid}
                                            </div>
                                          )}
                                        </div>
                                      ))
                                    )}
                                    
                                    <PaginationFooter
                                      currentPage={folderCurrentPage}
                                      totalPages={totalPages}
                                      onPrev={() => setFolderCurrentPage(prev => prev - 1)}
                                      onNext={() => setFolderCurrentPage(prev => prev + 1)}
                                      variant="container"
                                      stopPropagation
                                    />
                                  </div>
                                </>
                              );
                            })()}
                          </>
                        )}
                      </div>

                          {(() => {
                            const sharedFolders = keeperFolders.filter(folder => folder.shared || (folder.flags && folder.flags.includes('S')));
                            return sharedFolders.length > 0 && (
                              <div className="share-record-count">
                                {sharedFolders.length} shared folders available
                              </div>
                            );
                          })()}
                        </>
                      )}

                      {/* Info message and requirement text area */}
                      {/* Hide Requirements and Justification when admin selects cancel action */}
                      {!(isAdmin && formData.action === 'cancel') && (
                        <RequirementsBlock
                          showInfoMessage={formData.action !== 'cancel'}
                          infoMessage={isAdmin
                            ? 'Select record or shared folder. If you are not sure about the record or folder, provide your requirement in the following text area.'
                            : 'Provide your requirement and justification for this request. An admin will review and process it.'}
                          requirementsRequired={!isAdmin}
                          requirementsValue={formData.requirements}
                          onRequirementsChange={(e) => handleInputChange('requirements', e.target.value)}
                          requirementsPlaceholder="Describe your requirements if you're not sure which record or folder to select..."
                          justificationValue={formData.justification}
                          onJustificationChange={(e) => handleInputChange('justification', e.target.value)}
                          justificationPlaceholder="Explain why you need access to this record or folder..."
                          disabled={isFormDisabled}
                        />
                      )}
                    </div>
                  )}

                  {/* Folders Selector for record-permission and share-folder actions */}
                  {(selectedAction.value === 'record-permission' || selectedAction.value === 'share-folder') && (
                    <div className="share-record-selector">
                      {isAdmin && (
                        <>
                          <label className="share-record-label">
                            Select Folder: <span className="text-error">*</span>
                          </label>

                          {/* Folders Dropdown Container */}
                          <div className="relative z-997">
                        {loadingFolders ? (
                          <LoadingPlaceholder text="Loading folders..." />
                        ) : (
                          <>
                            {/* Folders Search Input */}
                            <input
                              type="text"
                              disabled={isFormDisabled}
                              placeholder={
                                isFormDisabled ? "Form disabled..." :
                                showFolderDropdown ? "Type to search folders by name or UID..." : 
                                (selectedFolder ? formatWithUid(selectedFolder.name || selectedFolder.title, selectedFolder.folder_uid) : "Click to select folder...")
                              }
                              value={showFolderDropdown ? folderSearchTerm : (selectedFolder ? formatWithUid(selectedFolder.name || selectedFolder.title, selectedFolder.folder_uid) : "")}
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
                              className={`action-select-input ${isFormDisabled ? 'action-select-input-disabled' : (showFolderDropdown ? 'action-select-input-focused' : 'action-select-input-default')}`}
                            />
                            
                            {/* Folders Dropdown Arrow */}
                            {!isFormDisabled && (
                              <div
                                onClick={() => {
                                  if (!isFormDisabled) {
                                    setShowFolderDropdown(!showFolderDropdown);
                                  }
                                }}
                                className="dropdown-arrow-pos dropdown-arrow-pos-enabled"
                              >
                                ▼
                              </div>
                            )}

                            {/* Folders Dropdown Menu */}
                            {showFolderDropdown && !isFormDisabled && (
                              <div className="record-update-dropdown">

                                {/* Folders Search Hint */}
                                {!folderSearchTerm && (
                                  <SearchHint text="Tip: Type in the field above to search folders by name or UID" />
                                )}

                                {/* Folders Options */}
                                {filteredFolders.length > 0 ? (
                                  <>
                                    {paginatedFolders.map((folder) => (
                                      <div
                                        key={folder.folder_uid}
                                        onClick={() => {
                                          setSelectedFolder(folder);
                                          setShowFolderDropdown(false);
                                          setFolderSearchTerm("");
                                          // Set different field name based on action type
                                          const fieldName = selectedAction.value === 'record-permission' ? 'sharedFolder' : 'folder';
                                          handleInputChange(fieldName, folder.folder_uid);
                                        }}
                                        className={`dropdown-item ${selectedFolder?.folder_uid === folder.folder_uid ? 'selected' : ''}`}
                                      >
                                        <div className="dropdown-option-title">
                                          {folder.name || folder.title}
                                          {renderSourceBadge(folder)}
                                        </div>
                                        {renderFolderPath(folder)}
                                        {folder.folder_uid && (
                                          <div className="dropdown-option-uid">
                                            UID: {folder.folder_uid}
                                          </div>
                                        )}
                                      </div>
                                    ))}
                                    
                                    <PaginationFooter
                                      currentPage={folderCurrentPage}
                                      totalPages={totalFolderPages}
                                      onPrev={() => setFolderCurrentPage(prev => prev - 1)}
                                      onNext={() => setFolderCurrentPage(prev => prev + 1)}
                                      itemCount={filteredFolders.length}
                                      itemLabel="folders"
                                      variant="container"
                                    />
                                  </>
                                ) : (
                                  <div className="dropdown-no-results">
                                    No folders found matching "{folderSearchTerm}"
                                  </div>
                                )}
                              </div>
                            )}

                            {/* Click outside to close folders dropdown */}
                            {showFolderDropdown && (
                              <div
                                className="click-overlay z-998"
                                onClick={() => setShowFolderDropdown(false)}
                              />
                            )}
                          </>
                        )}
                      </div>
                      
                      {/* Selected folder info */}
                      {selectedFolder && (
                        <SelectedItemChip
                          title={selectedFolder.name || selectedFolder.title}
                          uid={selectedFolder.folder_uid}
                          disabled={isFormDisabled}
                          onClear={() => {
                            setSelectedFolder(null);
                            setFormData(prev => ({ ...prev, folder: '' }));
                          }}
                        />
                      )}

                          {getFilteredFolders().length > 0 && (
                            <div className="share-record-count">
                              {getFilteredFolders().length} shared folders available
                            </div>
                          )}
                        </>
                      )}

                      {/* Info message and requirement text area for share-folder and record-permission actions */}
                      <RequirementsBlock
                        infoMessage={isAdmin
                          ? 'Select a shared folder. If you are not sure about the folder, provide your requirement in the following text area.'
                          : (selectedAction.value === 'record-permission'
                            ? 'Provide your requirement and justification for changing folder permissions. An admin will review and process it.'
                            : 'Provide your requirement and justification for accessing a folder. An admin will review and process it.')}
                        requirementsRequired={!isAdmin}
                        requirementsValue={formData.requirements}
                        onRequirementsChange={(e) => handleInputChange('requirements', e.target.value)}
                        requirementsPlaceholder="Describe your requirements if you're not sure which folder to select..."
                        justificationValue={formData.justification}
                        onJustificationChange={(e) => handleInputChange('justification', e.target.value)}
                        justificationPlaceholder={selectedAction.value === 'record-permission'
                          ? 'Explain why you need to change permissions for this folder...'
                          : 'Explain why you need access to this folder...'}
                        disabled={isFormDisabled}
                      />
                    </div>
                  )}

                  
                  {/* Step 2: Dynamic Form Fields for record-update (only show after record selection) */}
                  {selectedAction.value === 'record-update' && selectedRecordForUpdate && Object.keys(recordDetails).length > 0 && !loadingRecordDetails && (
                    <div className="mb-16 mt-24">
                      <div className="section-header">
                        Step 2: Update Record Fields
                      </div>
                      
                      {/* Show original record type as read-only info */}
                      {originalRecordType && (
                        <div className="mb-16">
                          <label className="label-sm">
                            Record Type
                          </label>
                          <div className="readonly-field-display">
                            {recordTypes.find(rt => rt.value === originalRecordType)?.label || originalRecordType}
                          </div>
                          <div className="helper-text-sm">
                            Original record type (cannot be changed during update)
                          </div>
                        </div>
                      )}
                      
                      {/* Loading indicator when template is being fetched */}
                      {selectedAction.value === 'record-update' && loadingTemplate && (
                        <div className="loading-state-box-no-mt">
                          <div className="loading-state-title">
                            Loading template fields for {recordTypes.find(rt => rt.value === originalRecordType)?.label || originalRecordType}...
                          </div>
                          <div className="loading-state-subtitle">
                            Please wait while we fetch the appropriate form fields
                          </div>
                        </div>
                      )}
                      
                      {/* Dynamic Template Fields for record-update only */}
                      {selectedAction.value === 'record-update' && templateFields.length > 0 && !loadingTemplate && (
                        <div>
                          <div className="template-fields-header">
                            {recordTypes.find(rt => rt.value === originalRecordType)?.label || originalRecordType || 'Template'} Fields: ({templateFields.length} fields)
                          </div>
                          
                          {/* Render Template Fields Dynamically with Grouping */}
                          {renderGroupedTemplateFields(templateFields)}
                        </div>
                      )}
                      
                      
                      {/* Fallback Standard Fields for record-update when no template */}
                      {selectedAction.value === 'record-update' && templateFields.length === 0 && !loadingTemplate && (
                        <div>
                          <div className="template-fields-header">
                            Standard Fields:
                          </div>
                          
                          <FormField label="Title" labelClass="label-sm">
                            <input
                              type="text"
                              value={formData.title || ''}
                              disabled={isFormDisabled}
                              onChange={(e) => handleInputChange('title', e.target.value)}
                              placeholder="Title"
                              className={`input-field ${isFormDisabled ? 'disabled' : ''} ${formData.title ? 'has-value' : ''}`}
                            />
                          </FormField>

                          <FormField label="Name (Full Name)" labelClass="label-sm">
                            <input
                              type="text"
                              value={formData.name || ''}
                              disabled={isFormDisabled}
                              onChange={(e) => handleInputChange('name', e.target.value)}
                              placeholder="Full Name"
                              className={`input-field ${isFormDisabled ? 'disabled' : ''} ${formData.name ? 'has-value' : ''}`}
                            />
                          </FormField>

                          <FormField label="Login/Username" labelClass="label-sm">
                            <input
                              type="text"
                              value={formData.login || ''}
                              disabled={isFormDisabled}
                              onChange={(e) => handleInputChange('login', e.target.value)}
                              placeholder="Username"
                              className={`input-field ${isFormDisabled ? 'disabled' : ''} ${formData.login ? 'has-value' : ''}`}
                            />
                          </FormField>

                          <FormField label="Password" labelClass="label-sm">
                            <input
                              type="password"
                              value={formData.password || ''}
                              disabled={isFormDisabled}
                              onChange={(e) => handleInputChange('password', e.target.value)}
                              placeholder="Password or $GEN"
                              className={`input-field ${isFormDisabled ? 'disabled' : ''} ${formData.password && formData.password !== '••••••••' ? 'has-value' : ''}`}
                            />
                          </FormField>

                          <FormField label="URL" labelClass="label-sm">
                            <input
                              type="url"
                              value={formData.url || ''}
                              disabled={isFormDisabled}
                              onChange={(e) => handleInputChange('url', e.target.value)}
                              placeholder="URL"
                              className={`input-field ${isFormDisabled ? 'disabled' : ''} ${formData.url ? 'has-value' : ''}`}
                            />
                          </FormField>

                          <FormField label="Email" labelClass="label-sm">
                            <input
                              type="email"
                              value={formData.email || ''}
                              disabled={isFormDisabled}
                              onChange={(e) => handleInputChange('email', e.target.value)}
                              placeholder="Email"
                              className={`input-field ${isFormDisabled ? 'disabled' : ''} ${formData.email ? 'has-value' : ''}`}
                            />
                          </FormField>

                          <FormField label="Notes" labelClass="label-sm">
                            <textarea
                              value={formData.notes || ''}
                              disabled={isFormDisabled}
                              onChange={(e) => handleInputChange('notes', e.target.value)}
                              placeholder="Notes"
                              rows={3}
                              className={`input-field ${isFormDisabled ? 'disabled' : ''} ${formData.notes && formData.notes !== recordDetails.notes ? 'has-value' : ''}`}
                            />
                            <div className="checkbox-option-container">
                              <input
                                type="checkbox"
                                id="appendNotes"
                                checked={formData.appendNotes === true || formData.appendNotes === 'true'}
                                disabled={isFormDisabled}
                                onChange={(e) => handleInputChange('appendNotes', e.target.checked)}
                                className={`checkbox-option-input ${isFormDisabled ? 'disabled' : ''}`}
                              />
                              <label htmlFor="appendNotes" className="checkbox-option-label">
                                <strong>Append to existing notes</strong> (if checked, adds to current notes instead of replacing)
                              </label>
                            </div>
                          </FormField>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Record Add Section - Step by Step Flow */}
                  {selectedAction.value === 'record-add' && (
                    <div>
                      {renderClassicModeCheckbox()}
                      {(() => {
                        const recordAddAction = actionOptions.find((action) => action.value === 'record-add');
                        const folderFields = (recordAddAction?.fields || []).filter((field) => field.type === 'folder-select');
                        if (folderFields.length === 0) return null;
                        return (
                          <>
                            <div className="section-header">
                              Step 1: Select Folder (optional)
                            </div>
                            {folderFields.map((field) => (
                              <div key={field.name} className="mb-16">
                                <label className="label-md-8">
                                  {field.label}
                                  {field.required && <span className="text-error"> *</span>}
                                </label>
                                {renderFormInput(field)}
                                <div className="helper-text-muted">
                                  Leave empty to create the record at the vault root.
                                </div>
                              </div>
                            ))}
                          </>
                        );
                      })()}

                      <div className="section-header">
                        Step 2: Select Record Type
                      </div>
                      
                      <div className="mb-16">
                        <label className="label-md-8">
                          Record Type <span className="text-error">*</span>
                        </label>
                        <select
                          value={formData.recordType || ''}
                          disabled={isFormDisabled}
                          onChange={(e) => {
                            const newRecordType = e.target.value;
                            handleInputChange('recordType', newRecordType);
                            
                            // Clear existing template fields first
                            setTemplateFields([]);
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
                            }
                          }}
                          className={[
                            'input-field',
                            isFormDisabled && 'disabled',
                            formData.recordType && 'has-value'
                          ].filter(Boolean).join(' ')}
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
                          <div className="helper-text-link">
                            {loadingRecordTypes ? "Loading record types..." : "Loading template..."}
                          </div>
                        )}
                        <div className="helper-text-muted">
                          Choose the type of record you want to create
                        </div>
                      </div>

                      {/* Step 2: Show template fields after record type is selected */}
                      {formData.recordType && (
                        <div>
                          <div className="section-header-bordered">
                            Step 3: Configure {recordTypes.find(rt => rt.value === formData.recordType)?.label || formData.recordType} Fields
                          </div>
                          
                          {/* Loading indicator when template is being fetched */}
                          {loadingTemplate && (
                            <div className="loading-state-box-no-mt">
                              <div className="loading-state-title">
                                Loading template fields for {recordTypes.find(rt => rt.value === formData.recordType)?.label || formData.recordType}...
                              </div>
                              <div className="loading-state-subtitle">
                                Please wait while we fetch the appropriate form fields
                              </div>
                            </div>
                          )}
                          
                          {/* Dynamic Template Fields */}
                          {templateFields.length > 0 && !loadingTemplate && (
                            <div>
                              <div className="subsection-header">
                                {recordTypeTemplate.$id ? `${recordTypeTemplate.$id} Fields:` : recordTypeTemplate.type ? `${recordTypeTemplate.type} Fields:` : 'Template Fields:'} ({templateFields.length} fields)
                              </div>
                              
                              {/* Render Template Fields Dynamically with Grouping */}
                              {renderGroupedTemplateFields(templateFields)}
                            </div>
                          )}
                          
                          {/* Error message when template loading fails */}
                          {templateError && !loadingTemplate && (
                            <div style={{
                              backgroundColor: '#FEF2F2',
                              border: '1px solid #FCA5A5',
                              borderRadius: '8px',
                              padding: '16px',
                              marginBottom: '16px'
                            }}>
                              <div style={{
                                color: '#DC2626',
                                fontWeight: '600',
                                fontSize: '14px',
                                marginBottom: '8px',
                                display: 'flex',
                                alignItems: 'center',
                                gap: '8px'
                              }}>
                                Keeper API Connection Error
                              </div>
                              <div style={{
                                color: '#7F1D1D',
                                fontSize: '13px',
                                whiteSpace: 'pre-wrap',
                                lineHeight: '1.5'
                              }}>
                                {templateError}
                              </div>
                              <div style={{
                                marginTop: '12px',
                                paddingTop: '12px',
                                borderTop: '1px solid #FCA5A5',
                                color: '#991B1B',
                                fontSize: '12px'
                              }}>
                                💡 Go to the <strong>App Configuration</strong> page to verify and update the Keeper API settings.
                              </div>
                            </div>
                          )}
                          
                          {/* Fallback message when no template fields (but no error) */}
                          {templateFields.length === 0 && !loadingTemplate && !templateError && (
                            <div className="warning-message-box">
                              <div className="warning-message-title">
                                No template fields available for {recordTypes.find(rt => rt.value === formData.recordType)?.label || formData.recordType}
                              </div>
                              <div className="warning-message-subtitle">
                                You can still create the record. Standard fields will be available.
                              </div>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  )}

                  {/* Regular fields for other actions (not record-update and not record-add) */}
                  {selectedAction.value !== 'record-update' && selectedAction.value !== 'record-add' && actionOptions.find(action => action.value === selectedAction.value)?.fields
                    .filter((field) => {
                      // Remove record field from UI when share-record is selected
                      // Remove folder field from UI when share-folder is selected  
                      // Remove sharedFolder field from UI when record-permission or share-record is selected
                      // Keep user/email fields visible for manual input
                      const shouldRemoveRecordField = selectedAction.value === 'share-record' && field.name === 'record';
                      const shouldRemoveFolderField = selectedAction.value === 'share-folder' && field.name === 'folder';
                      const shouldRemoveSharedFolderField = (selectedAction.value === 'record-permission' || selectedAction.value === 'share-record') && field.name === 'sharedFolder';
                      
                      // Handle conditional field visibility
                      if (field.conditionalOn && field.conditionalValue) {
                        const conditionalFieldValue = formData[field.conditionalOn];
                        if (conditionalFieldValue !== field.conditionalValue) {
                          return false; // Hide field if condition not met
                        }
                      }
                      
                      return !shouldRemoveRecordField && !shouldRemoveFolderField && !shouldRemoveSharedFolderField && field.type !== 'checkbox';
                    })
                    .map((field) => {
                      const exemptNonAdminRequired = (!isAdmin) && (
                        selectedAction.value === 'share-record'
                        || selectedAction.value === 'share-folder'
                        || selectedAction.value === 'record-permission'
                      );
                      // Role is contextually required for NSF grant; field.required stays false for revoke.
                      const isRoleRequired = field.name === 'role' && isNsfMode && formData.action === 'grant';
                      const showRequiredMarker = (field.required || isRoleRequired)
                        && selectedAction.value !== 'record-update'
                        && (!exemptNonAdminRequired || (field.name === 'action' && !isAdmin && (
                          selectedAction.value === 'share-record' || selectedAction.value === 'share-folder'
                        )));
                      const showRequiredError = showRequiredMarker && !formData[field.name];
                      const emailHint = field.name === 'user' && isAdmin && (
                        selectedAction.value === 'share-record' || selectedAction.value === 'share-folder'
                      )
                        ? 'Tip: You can enter multiple email addresses separated by commas (e.g., user1@example.com, user2@example.com)'
                        : null;
                      const fieldError = field.name === 'user' && isAdmin && emailValidationError
                        ? emailValidationError
                        : (showRequiredError ? 'This field is required' : null);

                      return (
                        <React.Fragment key={field.name}>
                          {field.name === 'action' && renderClassicModeCheckbox()}
                          <FormField
                            hideLabel={field.type === 'phoneEntries'}
                            label={field.label}
                            labelClass="label-record-add"
                            required={showRequiredMarker}
                            hint={emailHint}
                            error={fieldError}
                          >
                            {renderFormInput(field)}
                          </FormField>
                        </React.Fragment>
                      );
                    })}

                  {/* Rotate password upon expiration — visible when expiration is active and record is pamUser or folder is ROE-eligible */}
                  {(selectedAction.value === 'share-record' || selectedAction.value === 'share-folder') &&
                   isRotationEligible &&
                   formData.expiration_type && formData.expiration_type !== 'none' && (
                    <div className="mb-12">
                      <label className="checkbox-label" style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <input
                          type="checkbox"
                          checked={rotateOnExpiration}
                          disabled={isFormDisabled || checkingRotationEligibility}
                          onChange={(e) => setRotateOnExpiration(e.target.checked)}
                        />
                        <span>Rotate password upon expiration</span>
                      </label>
                      <div className="field-hint-text" style={{ marginTop: '4px', fontSize: '11px' }}>
                        When enabled, the password will automatically rotate once access expires
                      </div>
                    </div>
                  )}

                  {/* Checkbox fields for share-folder, share-record, and record-permission actions */}
                  {(selectedAction.value === 'share-folder' || selectedAction.value === 'share-record' || selectedAction.value === 'record-permission') && actionOptions.find(action => action.value === selectedAction.value)?.fields
                    .filter((field) => {
                      // Only render checkbox fields
                      return field.type === 'checkbox';
                    })
                    .map((field) => (
                      <div
                        key={field.name}
                        className="mb-12"
                      >
                        {renderFormInput(field)}
                      </div>
                    ))}

                  {/* Classic: require at least one of can_edit/can_share for record-permission. */}
                  {selectedAction.value === 'record-permission' &&
                   !isNsfMode &&
                   isAdmin &&
                   (formData.action === 'grant' || formData.action === 'revoke') &&
                   !formData.can_share && !formData.can_edit && (
                    <div className="field-error-text">
                      Select at least one of Can Share Records or Can Edit Records.
                    </div>
                  )}

                  {/* Custom fields for record-update action handled on backend */}
                  
                  {selectedAction.value !== 'record-update' && selectedAction.value !== 'record-add' && (
                    <div className="field-hint-text-mt-8">
                      * Required fields must be completed before approval
                    </div>
                  )}
                </div>
              )}

            {/* Action Buttons - Different for Admin vs Regular Users */}
            <div className="mb-16">
              
              {/* Show stored data status */}
              {hasStoredData && storedRequestData && showStoredRequestMessage && (
                <div className={`message-box-dynamic ${isAdmin ? 'message-box-admin' : 'message-box-user'}`}>
                  {/* Close button */}
                  <button
                    onClick={() => setShowStoredRequestMessage(false)}
                    className="close-button-absolute"
                    title="Dismiss"
                  >
                    <CrossIcon size="small" label="Close" primaryColor={isAdmin ? "#1E40AF" : "#166534"} />
                  </button>
                  
                  <div className={isAdmin ? 'message-box-title-admin' : 'message-box-title-user'}>
                    {isAdmin ? "Info Message" : "Success Message"}
                  </div>
                  <div className={storedRequestData.timestamp ? 'message-box-text-with-margin' : 'message-box-text'}>
                    {isAdmin 
                      ? `A user has submitted a '${storedRequestData.selectedAction?.label}' request for review.`
                      : `Your ${storedRequestData.selectedAction?.label} request has been saved and is awaiting admin approval.`
                    }
                  </div>
                  {storedRequestData.timestamp && (
                    <div className="message-box-timestamp">
                      Saved: {new Date(storedRequestData.timestamp).toLocaleString('en-US', {
                        month: '2-digit',
                        day: '2-digit',
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
                <div className="flex-gap-12">
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
                  
                  {/* Execute Button - show when there's NO stored data (admin executing directly) */}
                  {!hasStoredData && (
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
                        marginTop: "8px",
                        border: "none",
                        cursor: isFormDisabled || loadingTemplate || loadingRecordTypes || (!selectedAction || !validateForm() || isExecuting) ? "not-allowed" : "pointer",
                        boxShadow: (selectedAction && validateForm() && !isExecuting) ? "0 2px 4px rgba(0,0,0,0.1)" : "none",
                        transition: "all 0.2s ease"
                      }}
                    >
                      {isFormDisabled ? "Form Disabled (Re-enabling...)" :
                       isExecuting ? "Executing..." :
                       loadingTemplate ? "Loading Template Fields..." :
                       loadingRecordTypes ? "Loading Record Types..." :
                       !selectedAction ? "Select Action to Enable" :
                       !validateForm() ? "Complete Required Fields" :
                       "Execute"}
                    </Button>
                  )}
                  
                  {/* Reject Button - show when there's stored data to reject (not for admin-only actions) */}
                  {hasStoredData && selectedAction?.value !== 'record-add' && selectedAction?.value !== 'record-update' && (
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
                  <div className="rejection-form-container">
                    <div className="mb-12">
                      <h4 className="rejection-form-title">
                        Reject Keeper Request
                      </h4>
                      <p className="rejection-form-description">
                        This will reject the request and add a comment to the JIRA ticket with your reason.
                      </p>
                    </div>
                    
                    <FormField label="Rejection Reason" required labelClass="label-sm-6">
                      <textarea
                        value={rejectionReason}
                        onChange={(e) => setRejectionReason(e.target.value)}
                        placeholder="Please provide a clear reason for rejecting this request..."
                        rows={3}
                        disabled={isRejecting}
                        className={`input-field textarea-border-override ${isRejecting ? 'disabled' : ''}`}
                      />
                    </FormField>
                    
                    <div className="button-group">
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
                  <div className={rejectionResult.success ? 'rejection-result-success' : 'rejection-result-error'}>
                    {/* Close button */}
                    <button
                      onClick={() => setRejectionResult(null)}
                      className="close-button-absolute"
                      title="Dismiss"
                    >
                      <CrossIcon size="small" label="Close" primaryColor={rejectionResult.success ? "#006644" : "#BF2600"} />
                    </button>
                    
                    <div className={rejectionResult.success ? 'rejection-result-title-success' : 'rejection-result-title-error'}>
                      {rejectionResult.success ? "Request Rejected" : "Rejection Failed"}
                    </div>
                    <div className="rejection-result-message">
                      {rejectionResult.message}
                    </div>
                  </div>
                )}
                </>
              ) : !isLoading && !isLoadingStoredData && !loadingTemplate && !loadingRecordTypes && !loadingRecordDetails ? (
                // Regular User View - Show buttons with flex layout
                <div className="flex-gap-12">
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
                  
                  {/* Clear Stored Data Button for Non-Admin Users */}
                  {hasStoredData && (
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
                        boxShadow: "0 2px 4px rgba(0,0,0,0.1)",
                        transition: "all 0.2s ease"
                      }}
                    >
                      Clear Data
                    </Button>
                  )}
                </div>
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
                const messageType = saveRequestMessage.type || 'info';
                
                return (
                  <div className={`message-box-base message-box-${messageType}`}>
                    {/* Close button */}
                    <button
                      onClick={() => setSaveRequestMessage(null)}
                      className="close-button-absolute"
                      title="Dismiss"
                    >
                      <CrossIcon size="small" label="Close" primaryColor={style.iconColor} />
                    </button>
                    
                    <div className={`result-message-title message-title-${messageType}`}>
                      {style.title}
                    </div>
                    <div style={{ 
                      fontSize: "14px", 
                      color: "#6B7280",
                      marginBottom: saveRequestMessage.showTimestamp ? "6px" : "0",
                      lineHeight: "1.4"
                    }}>
                      {saveRequestMessage.message}
                    </div>
                    {saveRequestMessage.showTimestamp && saveRequestMessage.timestamp && (
                      <div style={{ 
                        fontSize: "13px", 
                        color: "#9CA3AF",
                        marginTop: "6px",
                        borderTop: "1px solid #E5E7EB",
                        paddingTop: "6px"
                      }}>
                        Saved: {new Date(saveRequestMessage.timestamp).toLocaleString('en-US', {
                          month: '2-digit',
                          day: '2-digit',
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
              
            </div>
          </>
        )}

        {/* Result Display */}
        {lastResult && (() => {
          const messageStyles = {
            success: {
              background: "#F0FDF4",
              border: "2px solid #86EFAC",
              titleColor: "#166534",
              iconColor: "#166534",
              title: "Success Message"
            },
            error: {
              background: "#FFF0F0",
              border: "2px solid #FCA5A5",
              titleColor: "#B91C1C",
              iconColor: "#B91C1C",
              title: "Error Message"
            }
          };
          const currentStyle = lastResult.success ? messageStyles.success : messageStyles.error;
          
          return (
            <div style={{
              marginTop: "20px",
              padding: "16px",
              borderRadius: "8px",
              backgroundColor: currentStyle.background,
              border: currentStyle.border,
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
                <CrossIcon size="small" label="Close" primaryColor={currentStyle.iconColor} />
              </button>
              
              <div style={{
                fontWeight: "600",
                fontSize: "16px",
                color: currentStyle.titleColor,
                marginBottom: "6px",
                paddingRight: "28px",
                display: "flex",
                alignItems: "center",
                gap: "8px"
              }}>
                {lastResult.success ? (
                  <SuccessIcon primaryColor={currentStyle.iconColor} size="medium" label="Success" />
                ) : (
                  <ErrorIcon primaryColor={currentStyle.iconColor} size="medium" label="Error" />
                )}
                <span>{lastResult.success ? "Success Message" : "Error Message"}</span>
              </div>
              <div style={{ 
                fontSize: "14px", 
                color: "#6B7280",
                lineHeight: "1.4",
                whiteSpace: "pre-wrap"
              }}>
                {lastResult.message}
              </div>
            </div>
          );
        })()}

        {/* Workflow info - Show for non-admin users even without config */}
        {(issueContext.hasConfig || !isAdmin) && !isLoading && !isLoadingStoredData && showWorkflowInfo && (
          <div style={{
            marginTop: "16px",
            padding: "10px 14px",
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
              <CrossIcon size="small" label="Close" primaryColor="#1E40AF" />
            </button>
            
            <div style={{
              fontWeight: "600",
              fontSize: "16px",
              color: "#1E40AF",
              marginBottom: "6px",
              paddingRight: "28px"
            }}>
              {isAdmin ? "Admin Review Mode" : "Request Submission Mode"}
            </div>
            <div style={{ 
              fontSize: "14px", 
              color: "#6B7280",
              lineHeight: "1.4"
            }}>
              {isAdmin 
                ? "Review user requests and use 'Approve & Execute' to run approved actions via ngrok API, or 'Reject Request' to decline with feedback."
                : "Fill out the form and use 'Save Request' to submit your Keeper action for admin review and approval."
              }
            </div>
          </div>
        )}

        {/* Expiration Warning Modal for share-record */}
        {showExpirationWarningModal && (
          <div className="warning-modal-overlay">
            <div className="warning-modal-content">
              <div className="warning-modal-body">
                <div className="warning-icon-container">
                  <span className="warning-icon">!</span>
                </div>
                <div className="warning-content">
                  <h3 className="warning-title">
                    {selectedAction?.value === 'share-folder' ? 'User Management Restriction' : 'Sharing Restriction'}
                  </h3>
                  <p className="warning-description">
                    {selectedAction?.value === 'share-folder' 
                      ? 'The ability to manage users is restricted for users with time-limited access and will be removed when setting access expiration.'
                      : 'Sharing is restricted for users with time-limited access. Setting access expiration will remove sharing permissions.'}
                  </p>
                </div>
              </div>

              <div className="modal-footer">
                <button
                  onClick={handleExpirationWarningCancel}
                  className="btn-secondary"
                >
                  Cancel
                </button>
                <button
                  onClick={handleExpirationWarningConfirm}
                  className="btn-primary-solid"
                >
                  Continue
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default IssuePanel;
