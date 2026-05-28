/**
 * Custom hook for managing configuration state and operations.
 *
 * KJ-26-07: We track an `isApiKeyDirty` flag internally so we know whether
 * the user actually typed a new value. When dirty=false on save / test, we
 * pass through the masked value and the backend reuses the stored key.
 */
import { useState, useEffect } from 'react';
import * as api from '../services/api';
import { handleApiError, getConnectionErrorContext, isStructuredError } from '../utils/errorHandler';
import { MESSAGE_TYPES } from '../constants';

export const useConfig = () => {
  const [formValues, setFormValues] = useState({ apiUrl: "", apiKey: "" });
  const [originalFormValues, setOriginalFormValues] = useState({ apiUrl: "", apiKey: "" });
  const [hasExistingConfig, setHasExistingConfig] = useState(false);
  const [isApiKeyDirty, setIsApiKeyDirty] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [formKey, setFormKey] = useState(0);
  const [isApiKeyMasked, setIsApiKeyMasked] = useState(true);
  const [isTestingConnection, setIsTestingConnection] = useState(false);
  const [hasFormChanges, setHasFormChanges] = useState(false);
  const [connectionTested, setConnectionTested] = useState(false);
  const [statusMessage, setStatusMessage] = useState(null);

  // Wrapper for setFormValues that flips `isApiKeyDirty` when the apiKey
  // field is changed by the user. Use this from inputs instead of setFormValues
  // directly so we can distinguish "user typed a new key" from "we hydrated
  // the masked placeholder from the backend".
  const updateFormValue = (field, value) => {
    if (field === 'apiKey') setIsApiKeyDirty(true);
    setFormValues((prev) => ({ ...prev, [field]: value }));
  };

  // Load configuration on mount
  useEffect(() => {
    const loadConfiguration = async () => {
      try {
        const config = await api.loadConfig();
        if (config && config.apiUrl) {
          setFormValues({
            apiUrl: config.apiUrl || "",
            apiKey: config.apiKey || "",
          });
          setOriginalFormValues({
            apiUrl: config.apiUrl || "",
            apiKey: config.apiKey || "",
          });
          setHasExistingConfig(true);
          setIsApiKeyDirty(false);
          setConnectionTested(false); // Require connection test even for existing config
        }
      } catch (error) {
        console.error("Failed to load config:", error);
      } finally {
        setIsLoading(false);
      }
    };

    loadConfiguration();
  }, []);

  // Track form changes — apiKey diff is by `isApiKeyDirty`, not raw string
  // comparison, so the masked placeholder doesn't register as a change.
  useEffect(() => {
    const hasChanges =
      formValues.apiUrl !== originalFormValues.apiUrl ||
      isApiKeyDirty;

    setHasFormChanges(hasChanges);

    if (hasChanges) {
      setConnectionTested(false);
    }
  }, [formValues, originalFormValues, isApiKeyDirty]);

  // Handle form submission
  const handleSubmit = async (data) => {
    try {
      // KJ-26-07: When user didn't change the apiKey, send the masked
      // placeholder; the backend recognises it and keeps the stored secret.
      const payload = {
        ...data,
        apiKey: isApiKeyDirty ? data.apiKey : (formValues.apiKey || ''),
      };
      const result = await api.saveConfig(payload);
      
      // Check for structured error response (new pattern)
      if (isStructuredError(result)) {
        const errorMessage = handleApiError(result, "Failed to save configuration. Please try again.");
        setStatusMessage({
          type: MESSAGE_TYPES.ERROR,
          title: 'Save Failed',
          message: errorMessage
        });
        setTimeout(() => setStatusMessage(null), 8000);
        return;
      }
      
      // Re-load config so we display the masked apiKey returned by the backend
      // instead of whatever the user typed (or the masked sentinel).
      const refreshed = await api.loadConfig();
      setFormValues({
        apiUrl: refreshed?.apiUrl || data.apiUrl || "",
        apiKey: refreshed?.apiKey || "",
      });
      setOriginalFormValues({
        apiUrl: refreshed?.apiUrl || data.apiUrl || "",
        apiKey: refreshed?.apiKey || "",
      });
      setIsApiKeyDirty(false);
      
      setFormKey(prev => prev + 1);
      setHasExistingConfig(true);
      setConnectionTested(true);
      
      // Build success message, including any warnings from the server
      let successMessage = `Keeper configuration ${hasExistingConfig ? 'updated' : 'saved'} successfully.`;
      
      // Check for warnings returned from the API (e.g., free-tier URL warnings)
      if (result && result.warnings && result.warnings.length > 0) {
        successMessage += '\n\nWarning: ' + result.warnings.join('\nWarning: ');
        setStatusMessage({
          type: MESSAGE_TYPES.WARNING,
          title: 'Configuration Saved with Warnings',
          message: successMessage
        });
        setTimeout(() => setStatusMessage(null), 10000); // Longer timeout for warnings
      } else {
        setStatusMessage({
          type: MESSAGE_TYPES.SUCCESS,
          title: 'Configuration Saved!',
          message: successMessage
        });
        setTimeout(() => setStatusMessage(null), 5000);
      }
    } catch (error) {
      const errorMessage = handleApiError(error, "Failed to save configuration. Please try again.");
      setStatusMessage({
        type: MESSAGE_TYPES.ERROR,
        title: 'Save Failed',
        message: errorMessage
      });
      setTimeout(() => setStatusMessage(null), 8000);
    }
  };

  // Test connection
  const handleTestConnection = async () => {
    const currentApiUrl = formValues.apiUrl.trim();
    const currentApiKey = formValues.apiKey.trim();

    if (!currentApiUrl || !currentApiKey) {
      setStatusMessage({
        type: MESSAGE_TYPES.WARNING,
        title: 'Missing Information',
        message: 'Please enter both API URL and API Key before testing connection'
      });
      setTimeout(() => setStatusMessage(null), 5000);
      return;
    }

    // KJ-26-07: Sending the masked placeholder is fine — the backend swaps in
    // the stored apiKey. Block the test only when there's no key at all.
    setIsTestingConnection(true);
    setStatusMessage(null);

    try {
      const result = await api.testConnection(currentApiUrl, currentApiKey);
      
      // Check for structured error response (new pattern)
      if (isStructuredError(result)) {
        let errorMessage = handleApiError(result, 'Connection test failed');
        errorMessage = getConnectionErrorContext(errorMessage, result);
        
        setStatusMessage({
          type: MESSAGE_TYPES.ERROR,
          title: 'Connection Failed',
          message: errorMessage
        });
        setConnectionTested(false);
        setTimeout(() => setStatusMessage(null), 8000);
        return;
      }
      
      let successMessage = '';
      if (result.isServiceRunning) {
        successMessage = 'Connection test successful! Keeper Commander Service is running properly.';
      } else if (result.serviceStatus) {
        successMessage = `Connection test successful! Service status: ${result.serviceStatus}`;
      } else {
        successMessage = result.message || 'Connection test successful!';
      }
      
      setStatusMessage({
        type: MESSAGE_TYPES.SUCCESS,
        title: 'Connection Successful!',
        message: successMessage
      });
      setConnectionTested(true);
      setTimeout(() => setStatusMessage(null), 5000);
    } catch (error) {
      let errorMessage = handleApiError(error, 'Connection test failed');
      errorMessage = getConnectionErrorContext(errorMessage, error);
      
      setStatusMessage({
        type: MESSAGE_TYPES.ERROR,
        title: 'Connection Failed',
        message: errorMessage
      });
      setConnectionTested(false);
      setTimeout(() => setStatusMessage(null), 8000);
    } finally {
      setIsTestingConnection(false);
    }
  };

  // The "Copy" button was removed because the apiKey we hold in state is the masked placeholder, not a usable secret. The Forge sandbox also blocks clipboard.writeText reliably across the issue panel iframe.

  // Clear form
  const handleClearForm = () => {
    setFormValues({ apiUrl: "", apiKey: "" });
    setIsApiKeyDirty(true);
    setConnectionTested(false);
  };

  return {
    formValues,
    updateFormValue,
    isLoading,
    formKey,
    isApiKeyMasked,
    setIsApiKeyMasked,
    isTestingConnection,
    hasFormChanges,
    connectionTested,
    statusMessage,
    setStatusMessage,
    handleSubmit,
    handleTestConnection,
    handleClearForm,
  };
};

