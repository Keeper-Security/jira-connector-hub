/**
 * Custom hook for managing configuration state and operations
 */
import { useState, useEffect } from 'react';
import * as api from '../services/api';
import { handleApiError, getConnectionErrorContext, isStructuredError } from '../utils/errorHandler';
import { MESSAGE_TYPES, COPY_MESSAGE_TIMEOUT } from '../constants';

export const useConfig = () => {
  const [formValues, setFormValues] = useState({ apiUrl: "", apiKey: "" });
  const [originalFormValues, setOriginalFormValues] = useState({ apiUrl: "", apiKey: "" });
  const [hasExistingConfig, setHasExistingConfig] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [formKey, setFormKey] = useState(0);
  const [isApiKeyMasked, setIsApiKeyMasked] = useState(true);
  const [showCopiedMessage, setShowCopiedMessage] = useState(false);
  const [isTestingConnection, setIsTestingConnection] = useState(false);
  const [hasFormChanges, setHasFormChanges] = useState(false);
  const [connectionTested, setConnectionTested] = useState(false);
  const [statusMessage, setStatusMessage] = useState(null);

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

  // Track form changes
  useEffect(() => {
    const hasChanges = 
      formValues.apiUrl !== originalFormValues.apiUrl ||
      formValues.apiKey !== originalFormValues.apiKey;
    
    setHasFormChanges(hasChanges);
    
    if (hasChanges) {
      setConnectionTested(false);
    }
  }, [formValues, originalFormValues]);

  // Handle form submission
  const handleSubmit = async (data) => {
    try {
      const result = await api.saveConfig(data);
      
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
      
      setFormValues({
        apiUrl: data.apiUrl || "",
        apiKey: data.apiKey || "",
      });
      setOriginalFormValues({
        apiUrl: data.apiUrl || "",
        apiKey: data.apiKey || "",
      });
      
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

  // Copy API key
  const copyApiKey = async () => {
    try {
      await navigator.clipboard.writeText(formValues.apiKey);
      setShowCopiedMessage(true);
      setTimeout(() => setShowCopiedMessage(false), COPY_MESSAGE_TIMEOUT);
    } catch (err) {
      // Silently fail
    }
  };

  // Clear form
  const handleClearForm = () => {
    setFormValues({ apiUrl: "", apiKey: "" });
    setConnectionTested(false);
  };

  return {
    formValues,
    setFormValues,
    originalFormValues,
    hasExistingConfig,
    isLoading,
    formKey,
    isApiKeyMasked,
    setIsApiKeyMasked,
    showCopiedMessage,
    isTestingConnection,
    hasFormChanges,
    connectionTested,
    statusMessage,
    setStatusMessage,
    handleSubmit,
    handleTestConnection,
    copyApiKey,
    handleClearForm
  };
};

