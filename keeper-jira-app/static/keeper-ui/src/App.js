import React, { useState, useEffect } from "react";
import { invoke, router } from "@forge/bridge";

import TextField from "@atlaskit/textfield";
import Button from "@atlaskit/button";
import Form, { Field, FormFooter } from "@atlaskit/form";
import SectionMessage from "@atlaskit/section-message";
import Spinner from "@atlaskit/spinner";

// Icons
import SettingsIcon from "@atlaskit/icon/glyph/settings";
import InfoIcon from "@atlaskit/icon/glyph/info";
import BookIcon from "@atlaskit/icon/glyph/book";
import ListIcon from "@atlaskit/icon/glyph/list";
import RefreshIcon from "@atlaskit/icon/glyph/refresh";
import CrossCircleIcon from "@atlaskit/icon/glyph/cross-circle";
import EditorDoneIcon from "@atlaskit/icon/glyph/editor/done";

const App = () => {
  const [activeTab, setActiveTab] = useState("config");
  const [formValues, setFormValues] = useState({
    apiUrl: "",
    apiKey: "",
  });
  const [hasExistingConfig, setHasExistingConfig] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [formKey, setFormKey] = useState(0);
  const [isApiKeyMasked, setIsApiKeyMasked] = useState(true);
  const [showCopiedMessage, setShowCopiedMessage] = useState(false);
  const [isTestingConnection, setIsTestingConnection] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const [isCheckingAdmin, setIsCheckingAdmin] = useState(true);
  
  // New states for connection testing workflow
  const [originalFormValues, setOriginalFormValues] = useState({ apiUrl: "", apiKey: "" });
  const [hasFormChanges, setHasFormChanges] = useState(false);
  const [connectionTested, setConnectionTested] = useState(false);
  
  // Unified message state for all notifications
  const [statusMessage, setStatusMessage] = useState(null); // { type: 'success' | 'error' | 'info' | 'warning', message: 'text', title: 'optional title' }
  
  // PEDM tab states
  const [isPedmLoading, setIsPedmLoading] = useState(false);
  const [pedmData, setPedmData] = useState(null);
  const [pedmMessage, setPedmMessage] = useState(null); // { type: 'success' | 'error' | 'info' | 'warning', message: 'text', title: 'optional title' }
  const [pedmApprovals, setPedmApprovals] = useState([]);
  const [pedmSearchTerm, setPedmSearchTerm] = useState('');
  const [pedmCurrentPage, setPedmCurrentPage] = useState(1);
  const [pedmItemsPerPage] = useState(10);
  const [showExpiredOnly, setShowExpiredOnly] = useState(false);
  const [currentTime, setCurrentTime] = useState(new Date());
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [selectedApproval, setSelectedApproval] = useState(null);

  // Centralized error handler for API calls
  const handleApiError = (error, defaultMessage = "An error occurred") => {
    // Helper function to check if content contains HTML
    const containsHtml = (text) => {
      if (typeof text !== 'string') return false;
      return /<\/?[a-z][\s\S]*>/i.test(text);
    };
    
    // Try to extract error message from various possible locations
    let errorMessage = '';
    
    // Check error.error - skip if it contains HTML
    if (error.error && !containsHtml(error.error)) {
      errorMessage = error.error;
    }
    
    // Check error.message - skip if it contains HTML
    if (!errorMessage && error.message && !containsHtml(error.message)) {
      errorMessage = error.message;
    }
    
    // If no valid message found (or all contained HTML), use default
    if (!errorMessage || errorMessage.trim().length === 0) {
      errorMessage = defaultMessage;
    }
    
    // If message is too long (likely an error dump), use default message
    if (errorMessage.length > 500) {
      errorMessage = defaultMessage;
    }
    
    // If we have a valid error message, use it
    if (errorMessage && errorMessage !== defaultMessage && errorMessage.trim().length > 0) {
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

  useEffect(() => {
    // Check admin status first
    setIsCheckingAdmin(true);
    invoke("getGlobalUserRole").then((userRole) => {
      setIsAdmin(userRole.isAdmin || false);
      setIsCheckingAdmin(false);
    }).catch((error) => {
      // For this initial call, we can't use isAdmin state yet, so we'll default to false
      // Silently handle error as this is not critical for page load
      setIsAdmin(false);
      setIsCheckingAdmin(false);
    });

    // Fetch config
    setIsLoading(true);
    invoke("getConfig").then((config) => {
      if (config && (config.apiUrl || config.apiKey)) {
        const loadedValues = {
          apiUrl: config.apiUrl || "",
          apiKey: config.apiKey || "",
        };
        setFormValues(loadedValues);
        setOriginalFormValues(loadedValues);
        setHasExistingConfig(true);
        setConnectionTested(false); // Require connection test even for existing config
        // Show the existing configuration message for 5 seconds
        setStatusMessage({
          type: 'info',
          title: 'Existing Configuration Loaded',
          message: 'Your previously saved settings are displayed below. You can modify them and click "Update Settings" to save changes.'
        });
        setTimeout(() => setStatusMessage(null), 5000);
      } else {
        const emptyValues = {
          apiUrl: "",
          apiKey: "",
        };
        setFormValues(emptyValues);
        setOriginalFormValues(emptyValues);
        setConnectionTested(false);
      }
      // Update form key to force re-render with loaded values
      setFormKey(prev => prev + 1);
      setIsLoading(false);
    }).catch((error) => {
      const errorMessage = handleApiError(error, "Failed to load configuration");
      setStatusMessage({
        type: 'error',
        title: 'Failed to Load Configuration',
        message: errorMessage
      });
      setIsLoading(false);
    });
  }, []);

  // Track form changes
  useEffect(() => {
    // Check if form values have changed from original
    const hasChanges = formValues.apiUrl !== originalFormValues.apiUrl || 
                      formValues.apiKey !== originalFormValues.apiKey;
    
    setHasFormChanges(hasChanges);
    
    // If there are changes, reset connection test status
    if (hasChanges) {
      setConnectionTested(false);
      setStatusMessage(null); // Clear any previous status messages
    }
  }, [formValues.apiUrl, formValues.apiKey, originalFormValues]);

  // Handle PEDM tab - check config, test connection, and call API
  const loadPedmData = async () => {
    // Only proceed if PEDM tab is active, user is admin, and not currently checking admin status
    if (activeTab !== "pedm" || !isAdmin || isCheckingAdmin) {
      return;
    }

    // Check if configuration exists
    if (!formValues.apiUrl || !formValues.apiKey) {
      setPedmMessage({
        type: 'warning',
        title: 'Configuration Required',
        message: 'Please configure the API URL and API Key in the Configuration tab before accessing PEDM requests.'
      });
      // Clear warning message after 8 seconds
      setTimeout(() => setPedmMessage(null), 8000);
      return;
    }

    setIsPedmLoading(true);
    setPedmMessage(null);
    setPedmData(null);

    try {
      // First, test the connection
      const connectionResult = await invoke("testConnection", { 
        payload: {
          apiUrl: formValues.apiUrl,
          apiKey: formValues.apiKey
        }
      });

      // Check if connection test was successful
      if (!connectionResult || !connectionResult.isServiceRunning) {
        setPedmMessage({
          type: 'error',
          title: 'Connection Failed',
          message: connectionResult?.message || 'Connection test failed. Please ensure the Keeper Commander service is running and accessible.'
        });
        // Clear error message after 8 seconds
        setTimeout(() => setPedmMessage(null), 8000);
        setIsPedmLoading(false);
        return;
      }

      // Connection successful, now call the PEDM sync-down API
      const syncDownResult = await invoke("executeKeeperCommand", {
        payload: {
          command: "pedm sync-down"
        }
      });

      // Check if sync-down was successful
      if (!syncDownResult || !syncDownResult.success) {
        setPedmMessage({
          type: 'error',
          title: 'PEDM Sync Failed',
          message: 'Failed to sync PEDM data. Please try again.'
        });
        // Clear error message after 8 seconds
        setTimeout(() => setPedmMessage(null), 8000);
        setIsPedmLoading(false);
        return;
      }

      // Sync-down successful, now get the pending approval list
      const approvalListResult = await invoke("executeKeeperCommand", {
        payload: {
          command: "pedm approval list --type pending --format=json"
        }
      });

      setPedmData(approvalListResult);
      
      // Extract approvals array from the nested response
      const approvalsArray = approvalListResult?.data?.data || [];
      setPedmApprovals(approvalsArray);
      setPedmCurrentPage(1); // Reset to first page
      
      setPedmMessage({
        type: 'success',
        title: 'PEDM Data Loaded Successfully!',
        message: 'Successfully synced PEDM requests from Keeper Commander.'
      });
      // Clear success message after 5 seconds
      setTimeout(() => setPedmMessage(null), 5000);
      setIsPedmLoading(false);
    } catch (error) {
      const errorMessage = handleApiError(error, "Failed to load PEDM data. Please check your configuration and connection.");
      setPedmMessage({
        type: 'error',
        title: 'Failed to Load PEDM Data',
        message: errorMessage
      });
      // Clear error message after 8 seconds
      setTimeout(() => setPedmMessage(null), 8000);
      setIsPedmLoading(false);
    }
  };

  useEffect(() => {
    loadPedmData();
  }, [activeTab, isAdmin, isCheckingAdmin, formValues.apiUrl, formValues.apiKey]);

  // Quick Sync handler for PEDM tab
  const handleQuickSync = () => {
    loadPedmData();
  };

  // Handle opening modal with approval details
  const handleRowClick = (approval) => {
    setSelectedApproval(approval);
    setIsModalOpen(true);
  };

  // Handle closing modal
  const handleCloseModal = () => {
    setIsModalOpen(false);
    setSelectedApproval(null);
  };

  // Handle approve/deny actions for PEDM approvals
  const handleApproveRequest = async (approvalUid) => {
    try {
      setPedmMessage({
        type: 'info',
        title: 'Processing Request',
        message: 'Approving PEDM request...'
      });

      const result = await invoke("executeKeeperCommand", {
        payload: {
          command: `pedm approval action --approve ${approvalUid}`
        }
      });

      if (result && result.success) {
        setPedmMessage({
          type: 'success',
          title: 'Request Approved',
          message: 'PEDM request has been approved successfully.'
        });
        setTimeout(() => setPedmMessage(null), 3000);
        // Refresh the list
        loadPedmData();
      } else {
        setPedmMessage({
          type: 'error',
          title: 'Approval Failed',
          message: result?.message || 'Failed to approve the request.'
        });
        setTimeout(() => setPedmMessage(null), 5000);
      }
    } catch (error) {
      const errorMessage = handleApiError(error, "Failed to approve PEDM request.");
      setPedmMessage({
        type: 'error',
        title: 'Approval Failed',
        message: errorMessage
      });
      setTimeout(() => setPedmMessage(null), 5000);
    }
  };

  const handleDenyRequest = async (approvalUid) => {
    try {
      setPedmMessage({
        type: 'info',
        title: 'Processing Request',
        message: 'Denying PEDM request...'
      });

      const result = await invoke("executeKeeperCommand", {
        payload: {
          command: `pedm approval action --deny ${approvalUid}`
        }
      });

      if (result && result.success) {
        setPedmMessage({
          type: 'success',
          title: 'Request Denied',
          message: 'PEDM request has been denied successfully.'
        });
        setTimeout(() => setPedmMessage(null), 3000);
        // Refresh the list
        loadPedmData();
      } else {
        setPedmMessage({
          type: 'error',
          title: 'Deny Failed',
          message: result?.message || 'Failed to deny the request.'
        });
        setTimeout(() => setPedmMessage(null), 5000);
      }
    } catch (error) {
      const errorMessage = handleApiError(error, "Failed to deny PEDM request.");
      setPedmMessage({
        type: 'error',
        title: 'Deny Failed',
        message: errorMessage
      });
      setTimeout(() => setPedmMessage(null), 5000);
    }
  };

  // Timer to update current time every second for live countdown
  useEffect(() => {
    if (activeTab === "pedm" && pedmApprovals.length > 0) {
      const timer = setInterval(() => {
        setCurrentTime(new Date());
      }, 1000); // Update every second

      return () => clearInterval(timer); // Cleanup on unmount or tab change
    }
  }, [activeTab, pedmApprovals.length]);

  const handleSubmit = async (data) => {
    try {
      const result = await invoke("setConfig", { payload: data });
      
      // Update local state with saved data
      setFormValues({
        apiUrl: data.apiUrl || "",
        apiKey: data.apiKey || "",
      });
      setOriginalFormValues({
        apiUrl: data.apiUrl || "",
        apiKey: data.apiKey || "",
      });
      
      // Force form to re-render with new values
      setFormKey(prev => prev + 1);
      
      setHasExistingConfig(true);
      setConnectionTested(true); // Mark as tested since we just saved successfully
      
      // Show success message
      setStatusMessage({
        type: 'success',
        title: 'Configuration Saved!',
        message: `Keeper configuration ${hasExistingConfig ? 'updated' : 'saved'} successfully.`
      });
      setTimeout(() => setStatusMessage(null), 5000);
    } catch (error) {
      // Show user-friendly error with proper error handling
      const errorMessage = handleApiError(error, "Failed to save configuration. Please try again.");
      setStatusMessage({
        type: 'error',
        title: 'Save Failed',
        message: errorMessage
      });
      setTimeout(() => setStatusMessage(null), 8000);
    }
  };

  const toggleApiKeyMask = () => {
    setIsApiKeyMasked(!isApiKeyMasked);
  };

  const copyApiKey = async () => {
    try {
      await navigator.clipboard.writeText(formValues.apiKey);
      
      // Show copied message
      setShowCopiedMessage(true);
      setTimeout(() => setShowCopiedMessage(false), 2000);
    } catch (err) {
      // Silently fail - user will see the copy button doesn't work
    }
  };

  const testConnection = async () => {
    // Use current form values from state (now controlled components)
    const currentApiUrl = formValues.apiUrl.trim();
    const currentApiKey = formValues.apiKey.trim();

    if (!currentApiUrl || !currentApiKey) {
      setStatusMessage({
        type: 'warning',
        title: 'Missing Information',
        message: 'Please enter both API URL and API Key before testing connection'
      });
      setTimeout(() => setStatusMessage(null), 5000);
      return;
    }

    setIsTestingConnection(true);
    setStatusMessage(null); // Clear any previous messages

    try {
      const result = await invoke("testConnection", { 
        payload: {
          apiUrl: currentApiUrl,
          apiKey: currentApiKey
        }
      });
      
      // Build success message with service status details
      let successMessage = '';
      
      if (result.isServiceRunning) {
        successMessage = 'Connection test successful! Keeper Commander Service is running properly.';
      } else if (result.serviceStatus) {
        successMessage = `Connection test successful! Service status: ${result.serviceStatus}`;
      } else {
        successMessage = result.message || 'Connection test successful!';
      }
      
      setStatusMessage({
        type: 'success',
        title: 'Connection Successful!',
        message: successMessage
      });
      setConnectionTested(true); // Mark connection as tested and successful
      
      // Clear the result after 5 seconds
      setTimeout(() => setStatusMessage(null), 5000);
      
    } catch (error) {
      
      // Use centralized error handler first
      let errorMessage = handleApiError(error, 'Connection test failed');
      
      // Add more context for specific error scenarios (if not already handled by handleApiError)
      // These provide additional details beyond the HTTP status code messages
      if (!error.status && !error.statusCode) {
        // Only add detailed context if we don't have a status code (already handled by handleApiError)
        if (errorMessage.includes('ERR_NGROK_3200') || errorMessage.includes('ngrok') || errorMessage.includes('offline')) {
          errorMessage = `Ngrok tunnel is offline: ${errorMessage}. Please start your ngrok tunnel and ensure the Keeper Commander service is running.`;
        } else if (errorMessage.includes('fetch')) {
          errorMessage = `Network error: ${errorMessage}. Please check your API URL and ensure the Keeper Commander service is running.`;
        } else if (errorMessage.includes('404')) {
          errorMessage = `Service not found: ${errorMessage}. Please check your API URL and ensure the Keeper Commander service is accessible.`;
        } else if (errorMessage.includes('timeout')) {
          errorMessage = `Connection timeout: ${errorMessage}. The service may be slow to respond or unavailable.`;
        } else if (errorMessage.includes('<!DOCTYPE html>') || errorMessage.includes('<html')) {
          errorMessage = `Received HTML response instead of JSON. This usually means the service is not running or the URL is incorrect. Please check your API URL and ensure the Keeper Commander service is running.`;
        }
      }
      
      setStatusMessage({
        type: 'error',
        title: 'Connection Failed',
        message: errorMessage
      });
      setConnectionTested(false); // Mark connection test as failed
      
      // Clear the result after 8 seconds for errors (longer than success messages)
      setTimeout(() => setStatusMessage(null), 8000);
    } finally {
      setIsTestingConnection(false);
    }
  };

  const renderLabel = (text) => (
    <span
      style={{
        fontWeight: 600,
        fontSize: "12px",
        color: "#6B778C",
        textTransform: "uppercase",
        letterSpacing: "0.5px"
      }}
    >
      {text}
    </span>
  );

  // Generate consistent color for user avatar based on username
  const getUserColor = (username) => {
    const colors = [
      "#DE350B", // Red
      "#0052CC", // Blue
      "#00875A", // Green
      "#6554C0", // Purple
      "#FF5630", // Orange
      "#36B37E", // Teal
      "#FF991F", // Yellow-Orange
      "#00B8D9", // Cyan
      "#403294", // Deep Purple
      "#172B4D", // Dark Blue
      "#5243AA", // Violet
      "#008DA6", // Dark Cyan
    ];
    
    // Simple hash function to get consistent color for same username
    let hash = 0;
    for (let i = 0; i < username.length; i++) {
      hash = username.charCodeAt(i) + ((hash << 5) - hash);
    }
    
    const index = Math.abs(hash) % colors.length;
    return colors[index];
  };

  const tabs = [
    { key: "config", label: "Configuration", icon: <SettingsIcon size="medium" label="" /> },
    { key: "pedm", label: "PEDM Requests", icon: <ListIcon size="medium" label="" /> },
    { key: "prereq", label: "Prerequisites", icon: <BookIcon size="medium" label="" /> },
    { key: "about", label: "About", icon: <InfoIcon size="medium" label="" /> },
  ];

  return (
    <div
      style={{
        fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', 'Oxygen', 'Ubuntu', 'Fira Sans', 'Droid Sans', 'Helvetica Neue', sans-serif",
        backgroundColor: "#F4F5F7",
        minHeight: "100vh",
        padding: "24px",
      }}
    >
      <div
        style={{
          backgroundColor: "#FFFFFF",
          border: "1px solid #DFE1E6",
          borderRadius: "3px",
          overflow: "hidden",
        }}
      >
        {/* Horizontal Tabs */}
        <div
          style={{
            display: "flex",
            borderBottom: "2px solid #DFE1E6",
            backgroundColor: "#FAFBFC",
          }}
        >
          {tabs.map((tab) => (
            <div
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              style={{
                flex: 1,
                textAlign: "center",
                padding: "12px 16px",
                cursor: "pointer",
                fontWeight: activeTab === tab.key ? 600 : 400,
                fontSize: "14px",
                color: activeTab === tab.key ? "#0052CC" : "#42526E",
                borderBottom:
                  activeTab === tab.key ? "2px solid #0052CC" : "2px solid transparent",
                transition: "all 0.2s",
                display: "flex",
                justifyContent: "center",
                alignItems: "center",
                gap: "8px",
                backgroundColor: activeTab === tab.key ? "#FFFFFF" : "transparent",
              }}
            >
              <span style={{ color: activeTab === tab.key ? "#0052CC" : "#42526E" }}>{tab.icon}</span>
              <span>{tab.label}</span>
            </div>
          ))}
        </div>

        {/* Tab Panel */}
        <div style={{ padding: "24px" }}>
          {activeTab === "config" && (
            <>
              <h2 style={{ fontWeight: "600", fontSize: "20px", marginBottom: "8px", color: "#172B4D" }}>
                Configuration
              </h2>
              <p style={{ color: "#5E6C84", fontSize: "14px", marginBottom: "20px", lineHeight: "20px" }}>
                Configure Keeper integration details. All fields are required. The integration will work with any Jira project.
              </p>
              
              {isCheckingAdmin ? (
                <div style={{ textAlign: "center", padding: "20px", color: "#5E6C84" }}>
                  <p>Checking admin permissions...</p>
                </div>
              ) : !isAdmin ? (
                <div style={{ padding: "16px 0" }}>
                  <SectionMessage appearance="warning" title="Access Restricted">
                    <p style={{ margin: "8px 0", color: "#42526E", fontSize: "14px", lineHeight: "20px" }}>
                      Only Jira Administrators or Project Administrators can access the configuration page. 
                      Please contact your Jira administrator if you need to modify Keeper settings.
                    </p>
                  </SectionMessage>
                </div>
              ) : (
                <>
                  {/* Unified Status Message Display */}
                  {statusMessage && (() => {
                    const messageStyles = {
                      success: {
                        background: "#F0FDF4",
                        border: "2px solid #86EFAC",
                        titleColor: "#166534",
                        title: "Success Message"
                      },
                      error: {
                        background: "#FEF2F2",
                        border: "2px solid #FCA5A5",
                        titleColor: "#991B1B",
                        title: "Error Message"
                      },
                      warning: {
                        background: "#FFFBEB",
                        border: "2px solid #FCD34D",
                        titleColor: "#92400E",
                        title: "Warning Message"
                      },
                      info: {
                        background: "#EFF6FF",
                        border: "2px solid #93C5FD",
                        titleColor: "#1E40AF",
                        title: "Info Message"
                      }
                    };
                    
                    const style = messageStyles[statusMessage.type] || messageStyles.info;
                    
                    return (
                      <div style={{ marginBottom: "20px" }}>
                        <div style={{
                          padding: "10px 14px",
                          backgroundColor: style.background,
                          borderRadius: "8px",
                          border: style.border,
                          position: "relative"
                        }}>
                          <div style={{
                            fontWeight: "600",
                            fontSize: "16px",
                            color: style.titleColor,
                            marginBottom: "6px"
                          }}>
                            {statusMessage.title || style.title}
                          </div>
                          <div style={{ 
                            fontSize: "14px", 
                            color: "#6B7280",
                            lineHeight: "1.4"
                          }}>
                            {statusMessage.message}
                          </div>
                        </div>
                      </div>
                    );
                  })()}

                  {isLoading ? (
                <div style={{ textAlign: "center", padding: "20px", color: "#5E6C84" }}>
                  <p>Loading configuration...</p>
                </div>
              ) : (
                <Form onSubmit={handleSubmit} key={`form-${formKey}`}>
                {({ formProps, submitting }) => (
                  <form {...formProps}>
                    <Field 
                      label={renderLabel("Keeper API URL")} 
                      name="apiUrl"
                      defaultValue={formValues.apiUrl}
                      isRequired
                      validate={(value) => {
                        if (!value || value.trim() === '') {
                          return 'Keeper API URL is required';
                        }
                        if (!value.startsWith('http')) {
                          return 'Please enter a valid URL starting with http or https';
                        }
                      }}
                    >
                      {({ fieldProps, error }) => (
                        <>
                          <TextField
                            {...fieldProps}
                            value={formValues.apiUrl}
                            onChange={(e) => setFormValues(prev => ({ ...prev, apiUrl: e.target.value }))}
                            placeholder="https://xxxxx.ngrok-free.app (base URL only)"
                          />
                          {error && (
                            <div style={{ color: "#DE350B", fontSize: "12px", marginTop: "4px" }}>
                              {error}
                            </div>
                          )}
                        </>
                      )}
                    </Field>

                    <Field 
                      label={renderLabel("Keeper API Key")} 
                      name="apiKey"
                      defaultValue={formValues.apiKey}
                      isRequired
                      validate={(value) => {
                        if (!value || value.trim() === '') {
                          return 'Keeper API Key is required';
                        }
                      }}
                    >
                      {({ fieldProps, error }) => (
                        <>
                          <div style={{ position: "relative", display: "inline-block", width: "100%" }}>
                            <TextField
                              {...fieldProps}
                              value={formValues.apiKey}
                              onChange={(e) => setFormValues(prev => ({ ...prev, apiKey: e.target.value }))}
                              type={isApiKeyMasked ? "password" : "text"}
                              placeholder="Enter your Keeper API key"
                              style={{ paddingRight: "80px" }}
                            />
                            <div style={{
                              position: "absolute",
                              right: "8px",
                              top: "50%",
                              transform: "translateY(-50%)",
                              display: "flex",
                              gap: "4px",
                              alignItems: "center",
                              zIndex: 10,
                              background: "white"
                            }}>
                              <button
                                type="button"
                                onClick={toggleApiKeyMask}
                                style={{
                                  background: "#f4f5f7",
                                  border: "1px solid #ddd",
                                  cursor: "pointer",
                                  padding: "4px 8px",
                                  display: "flex",
                                  alignItems: "center",
                                  justifyContent: "center",
                                  borderRadius: "4px",
                                  fontSize: "11px",
                                  height: "28px"
                                }}
                                title={isApiKeyMasked ? "Show API Key" : "Hide API Key"}
                              >
                                {isApiKeyMasked ? "Show" : "Hide"}
                              </button>
                              <button
                                type="button"
                                onClick={copyApiKey}
                                style={{
                                  background: showCopiedMessage ? "#e8f5e8" : "#f4f5f7",
                                  border: showCopiedMessage ? "1px solid #4caf50" : "1px solid #ddd",
                                  cursor: "pointer",
                                  padding: "4px 8px",
                                  display: "flex",
                                  alignItems: "center",
                                  justifyContent: "center",
                                  borderRadius: "4px",
                                  fontSize: "11px",
                                  height: "28px",
                                  fontWeight: showCopiedMessage ? "bold" : "normal",
                                  color: showCopiedMessage ? "#4caf50" : "inherit",
                                  transition: "all 0.2s ease"
                                }}
                                title={showCopiedMessage ? "Copied!" : "Copy API Key"}
                                disabled={!formValues.apiKey}
                              >
                                {showCopiedMessage ? "Copied!" : "Copy"}
                              </button>
                            </div>
                          </div>
                          {error && (
                            <div style={{ color: "#DE350B", fontSize: "12px", marginTop: "4px" }}>
                              {error}
                            </div>
                          )}
                        </>
                      )}
                    </Field>

                    {/* Test Connection Button */}
                    <div style={{ marginTop: "16px", marginBottom: "16px" }}>
                      <Button
                        onClick={testConnection}
                        isLoading={isTestingConnection}
                        appearance="default"
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
                        {isTestingConnection ? "Testing..." : "Test Connection"}
                      </Button>
                    </div>

                    {/* Only show save/update button if connection is tested successfully */}
                    {connectionTested && (
                      <FormFooter>
                        <Button
                          appearance="primary"
                          type="submit"
                          isLoading={submitting}
                          style={{
                            backgroundColor: "#4285F4",
                            color: "#FFFFFF",
                            fontWeight: "600",
                            fontSize: "14px",
                            padding: "8px 16px",
                            borderRadius: "8px",
                            border: "none",
                            cursor: "pointer",
                            boxShadow: "0 2px 4px rgba(0,0,0,0.1)",
                            transition: "all 0.2s ease"
                          }}
                        >
                          {submitting ? "Saving..." : "Save Settings"}
                        </Button>
                      </FormFooter>
                    )}
                    
                    {/* Show instructions when form is empty or connection test is required */}
                    {(!formValues.apiUrl.trim() || !formValues.apiKey.trim()) && (
                      <div style={{ 
                        marginTop: "16px", 
                        padding: "12px 16px", 
                        backgroundColor: "#DEEBFF", 
                        border: "1px solid #4C9AFF", 
                        borderRadius: "3px"
                      }}>
                        <div style={{ 
                          fontSize: "14px", 
                          color: "#0747A6",
                          fontWeight: "600",
                          marginBottom: "8px"
                        }}>
                          📋 Setup Instructions:
                        </div>
                        <div style={{ 
                          fontSize: "14px", 
                          color: "#0747A6",
                          lineHeight: "20px"
                        }}>
                          1. Fill in the API URL and API Key fields above<br/>
                          2. Click "Test Connection" to verify your settings<br/>
                          3. Once successful, the Save/Update button will appear
                        </div>
                      </div>
                    )}
                    
                    {/* Show message when connection test is required */}
                    {hasFormChanges && !connectionTested && formValues.apiUrl.trim() && formValues.apiKey.trim() && (
                      <div style={{ 
                        marginTop: "16px", 
                        padding: "12px 16px", 
                        backgroundColor: "#FFFAE6", 
                        border: "1px solid #FF991F", 
                        borderRadius: "3px"
                      }}>
                        <span style={{ 
                          fontSize: "14px", 
                          color: "#974F0C",
                          fontWeight: "600"
                        }}>
                          ⚠️ Please test the connection before saving settings.
                        </span>
                      </div>
                    )}
                  </form>
                  )}
                </Form>
                  )}
                </>
              )}
            </>
          )}

          {activeTab === "prereq" && (
            <>
              <h2 style={{ fontWeight: "600", fontSize: "20px", marginBottom: "16px", color: "#172B4D" }}>
                Prerequisites Setup Guide
              </h2>
              
              <p style={{ color: "#42526E", fontSize: "14px", lineHeight: "22px", marginBottom: "20px" }}>
                This Jira integration leverages <span onClick={() => router.open("https://docs.keeper.io/en/keeperpam/commander-cli/overview")} style={{ color: "#0052CC", textDecoration: "underline", fontWeight: "500", cursor: "pointer" }}>Keeper Commander CLI</span> running in Service Mode to provide a REST API interface for vault operations. The following guide covers both Jira-side and Keeper-side requirements to enable seamless communication between Jira Cloud and your Keeper vault.
              </p>

              <div style={{ marginBottom: "32px", paddingBottom: "24px", borderBottom: "1px solid #DFE1E6" }}>
                <h3 style={{ fontWeight: "600", fontSize: "16px", marginTop: "0", marginBottom: "12px", color: "#172B4D" }}>
                  1. Jira Cloud Requirements
                </h3>
                
                <p style={{ color: "#42526E", fontSize: "14px", lineHeight: "22px", marginBottom: "12px", fontWeight: "600" }}>
                  Administrator Setup
                </p>
                <p style={{ color: "#42526E", fontSize: "14px", lineHeight: "22px", marginBottom: "12px" }}>
                  To install and configure this Forge app, Jira administrators must have appropriate permissions within their Atlassian organization. The administrator responsible for installation needs <strong style={{ fontWeight: "600", color: "#172B4D" }}>Manage apps</strong> permission in Jira settings, which allows them to install, configure, and manage Forge applications. Additionally, they should have access to organization settings for billing and app approval workflows if organizational policies require app approval before installation.
                </p>
                <p style={{ color: "#42526E", fontSize: "14px", lineHeight: "22px", marginBottom: "16px" }}>
                  Once installed, administrators must configure the app through the global configuration page (accessed via Jira Settings → Apps → Keeper Integration). This includes providing the Keeper Commander REST API URL, API key, and testing the connection to ensure proper communication between Jira and Keeper services. Administrators can also manage request approvals and assign specific users as approvers for Keeper requests within issues.
                </p>

                <p style={{ color: "#42526E", fontSize: "14px", lineHeight: "22px", marginBottom: "12px", fontWeight: "600" }}>
                  End User Permissions
                </p>
                <p style={{ color: "#42526E", fontSize: "14px", lineHeight: "22px", marginBottom: "12px" }}>
                  For end users to access and utilize the Keeper integration panel within Jira issues, specific issue-level permissions are required. Users must have <strong style={{ fontWeight: "600", color: "#172B4D" }}>Edit Issues</strong> permission for the projects where they want to use Keeper functionality. This permission is essential because the Forge app's issue panel only appears to users who can modify issues, ensuring that only authorized team members can request or execute vault operations.
                </p>
                <p style={{ color: "#42526E", fontSize: "14px", lineHeight: "22px", marginBottom: "12px" }}>
                  Additionally, users should have <strong style={{ fontWeight: "600", color: "#172B4D" }}>Add Comments</strong> permission, as the app automatically adds structured comments to issues when Keeper actions are requested, approved, or executed. These comments provide an audit trail and keep all stakeholders informed of vault operation status. Users without this permission may encounter issues with the request approval workflow.
                </p>
                <p style={{ color: "#42526E", fontSize: "14px", lineHeight: "22px", marginBottom: "16px" }}>
                  Users submitting requests that require admin approval should also have <strong style={{ fontWeight: "600", color: "#172B4D" }}>Assign Issues</strong> permission if the workflow involves automatic assignment to designated approvers. While not strictly required for basic functionality, this permission enables a smoother approval process where issues are automatically routed to the appropriate administrator for review.
                </p>

                <p style={{ color: "#42526E", fontSize: "14px", lineHeight: "22px", marginBottom: "12px", fontWeight: "600" }}>
                  Project Configuration
                </p>
                <p style={{ color: "#42526E", fontSize: "14px", lineHeight: "22px", marginBottom: "0" }}>
                  The integration works across all Jira Cloud projects where users have appropriate permissions. No special project configuration or custom fields are required. However, administrators may want to consider creating dedicated issue types for Keeper requests (such as "Access Request" or "Credential Request") to better organize and track vault operations within their project workflows. The app integrates seamlessly with existing issue workflows, priorities, and custom fields without requiring modifications to your current Jira configuration.
                </p>
                
                <p style={{ color: "#5E6C84", fontSize: "13px", lineHeight: "20px", fontStyle: "italic", marginTop: "12px", marginBottom: "0" }}>
                  Reference: <span onClick={() => router.open("https://support.atlassian.com/jira-cloud-administration/docs/manage-project-permissions/")} style={{ color: "#5E6C84", textDecoration: "underline", cursor: "pointer" }}>Jira Cloud Project Permissions</span> | <span onClick={() => router.open("https://developer.atlassian.com/platform/forge/manifest-reference/permissions/")} style={{ color: "#5E6C84", textDecoration: "underline", cursor: "pointer" }}>Forge App Permissions</span>
                </p>
              </div>

              <div style={{ marginBottom: "32px", paddingBottom: "24px", borderBottom: "1px solid #DFE1E6" }}>
                <h3 style={{ fontWeight: "600", fontSize: "16px", marginTop: "0", marginBottom: "12px", color: "#172B4D" }}>
                  2. Keeper Commander CLI Installation
                </h3>
                <p style={{ color: "#42526E", fontSize: "14px", lineHeight: "22px", marginBottom: "12px" }}>
                  Keeper Commander is a powerful command-line and SDK interface to the Keeper Security platform. It provides comprehensive access to your vault, administrative functions, and privileged access management capabilities. Before proceeding, ensure you have a valid Keeper account with appropriate permissions to create, modify, and share records and folders within your vault.
                </p>
                <p style={{ color: "#42526E", fontSize: "14px", lineHeight: "22px", marginBottom: "12px" }}>
                  The recommended installation method is via Docker, which provides a containerized environment with all necessary dependencies pre-configured. Alternatively, you can install Commander CLI using Python for environments where Docker is not available. Visit the <span onClick={() => router.open("https://docs.keeper.io/en/keeperpam/commander-cli/installation-and-setup")} style={{ color: "#0052CC", textDecoration: "underline", fontWeight: "500", cursor: "pointer" }}>Installation and Setup documentation</span> for detailed installation instructions for your platform.
                </p>
                <p style={{ color: "#5E6C84", fontSize: "13px", lineHeight: "20px", fontStyle: "italic", margin: "0" }}>
                  Reference: <span onClick={() => router.open("https://docs.keeper.io/en/keeperpam/commander-cli/overview")} style={{ color: "#5E6C84", textDecoration: "underline", cursor: "pointer" }}>Keeper Commander Overview</span>
                </p>
              </div>

              <div style={{ marginBottom: "32px", paddingBottom: "24px", borderBottom: "1px solid #DFE1E6" }}>
                <h3 style={{ fontWeight: "600", fontSize: "16px", marginTop: "0", marginBottom: "12px", color: "#172B4D" }}>
                  3. Tunneling & Network Configuration
                </h3>
                <p style={{ color: "#42526E", fontSize: "14px", lineHeight: "22px", marginBottom: "12px" }}>
                  Since Keeper Commander Service Mode runs in your local environment, you need a tunneling solution to expose the REST API endpoints to Jira Cloud. A tunnel creates a secure bridge between your local service and the public internet, enabling Jira to communicate with your Keeper Commander instance without complex firewall or network configuration.
                </p>
                <p style={{ color: "#42526E", fontSize: "14px", lineHeight: "22px", marginBottom: "12px" }}>
                  <strong style={{ fontWeight: "600", color: "#172B4D" }}>Ngrok</strong> is a popular tunneling solution offering both free and paid plans. It provides instant public URLs with automatic HTTPS encryption. The free tier is suitable for development and testing, while paid plans offer additional features like custom domains and increased bandwidth. Visit <span onClick={() => router.open("https://ngrok.com/")} style={{ color: "#0052CC", textDecoration: "underline", fontWeight: "500", cursor: "pointer" }}>ngrok.com</span> to get started and obtain your authentication token.
                </p>
                <p style={{ color: "#42526E", fontSize: "14px", lineHeight: "22px", marginBottom: "12px" }}>
                  <strong style={{ fontWeight: "600", color: "#172B4D" }}>Cloudflare Tunnel</strong> is an enterprise-grade alternative that provides secure, reliable tunneling through Cloudflare's global network. It offers enhanced security features and is particularly well-suited for production deployments. Learn more at <span onClick={() => router.open("https://www.cloudflare.com/products/tunnel/")} style={{ color: "#0052CC", textDecoration: "underline", fontWeight: "500", cursor: "pointer" }}>Cloudflare Tunnel documentation</span> to obtain your tunnel token.
                </p>
                <p style={{ color: "#42526E", fontSize: "14px", lineHeight: "22px", marginBottom: "0" }}>
                  Once your tunnel is established, you'll receive a public URL (e.g., <code style={{ backgroundColor: "#F4F5F7", padding: "2px 6px", borderRadius: "3px", fontSize: "13px" }}>https://xxxxx.ngrok-free.app</code>). Enter only the base tunnel URL in the Configuration tab—the integration will automatically append the required <code style={{ backgroundColor: "#F4F5F7", padding: "2px 6px", borderRadius: "3px", fontSize: "13px" }}>/api/v1/executecommand</code> endpoint path.
                </p>
                <p style={{ color: "#5E6C84", fontSize: "13px", lineHeight: "20px", fontStyle: "italic", marginTop: "12px", marginBottom: "0" }}>
                  Reference: <span onClick={() => router.open("https://docs.keeper.io/en/keeperpam/commander-cli/service-mode-rest-api#create-service-mode-using-tunneling")} style={{ color: "#5E6C84", textDecoration: "underline", cursor: "pointer" }}>Creating Service Mode with Tunneling</span>
                </p>
              </div>

              <div style={{ marginBottom: "32px", paddingBottom: "24px", borderBottom: "1px solid #DFE1E6" }}>
                <h3 style={{ fontWeight: "600", fontSize: "16px", marginTop: "0", marginBottom: "12px", color: "#172B4D" }}>
                  4. Service Mode REST API Configuration & Deployment
                </h3>
                <p style={{ color: "#42526E", fontSize: "14px", lineHeight: "22px", marginBottom: "12px" }}>
                  Service Mode transforms Keeper Commander into a REST API server that can process commands via HTTP endpoints. This mode is specifically designed for integration scenarios where external applications need programmatic access to vault operations. The service automatically generates a secure API key upon startup and exposes the <code style={{ backgroundColor: "#F4F5F7", padding: "2px 6px", borderRadius: "3px", fontSize: "13px" }}>/api/v1/executecommand</code> endpoint for command execution.
                </p>
                <p style={{ color: "#42526E", fontSize: "14px", lineHeight: "22px", marginBottom: "16px" }}>
                  For this integration to function correctly, your Service Mode instance must be configured with specific parameters. The commands list defines which CLI operations are permitted via the API, the run mode determines whether the service operates in the foreground or background, and the queue system setting controls asynchronous request handling. Additionally, enabling persistent login ensures uninterrupted authentication without repeated login prompts, which is critical for continuous operation.
                </p>

                <div style={{ marginTop: "16px", marginBottom: "16px", padding: "14px 16px", backgroundColor: "#F4F5F7", borderLeft: "4px solid #0052CC", borderRadius: "3px" }}>
                  <p style={{ margin: 0, marginBottom: "12px", fontSize: "14px", color: "#172B4D", fontWeight: "600" }}>
                    Required Service Configuration
                  </p>
                  <table style={{ width: "100%", fontSize: "13px", lineHeight: "20px", borderCollapse: "collapse" }}>
                    <tbody>
                      <tr>
                        <td style={{ padding: "6px 0", color: "#5E6C84", verticalAlign: "top", width: "140px" }}>Commands List:</td>
                        <td style={{ padding: "6px 0", color: "#172B4D" }}>
                          <code style={{ backgroundColor: "#FFFFFF", padding: "2px 6px", borderRadius: "3px", fontSize: "12px", wordBreak: "break-all" }}>record-add, list, ls, get, record-type-info, record-update, share-record, share-folder, rti, record-permission, pedm, service-status</code>
                        </td>
                      </tr>
                      <tr>
                        <td style={{ padding: "6px 0", color: "#5E6C84", verticalAlign: "top" }}>Run Mode:</td>
                        <td style={{ padding: "6px 0", color: "#172B4D" }}>
                          <code style={{ backgroundColor: "#FFFFFF", padding: "2px 6px", borderRadius: "3px", fontSize: "12px" }}>-rm foreground</code> <span style={{ color: "#5E6C84" }}>(Default)</span>
                        </td>
                      </tr>
                      <tr>
                        <td style={{ padding: "6px 0", color: "#5E6C84", verticalAlign: "top" }}>Queue System:</td>
                        <td style={{ padding: "6px 0", color: "#172B4D" }}>
                          <code style={{ backgroundColor: "#FFFFFF", padding: "2px 6px", borderRadius: "3px", fontSize: "12px" }}>-q n</code> <span style={{ color: "#5E6C84" }}>(Disabled for synchronous execution)</span>
                        </td>
                      </tr>
                      <tr>
                        <td style={{ padding: "6px 0", color: "#5E6C84", verticalAlign: "top" }}>Authentication:</td>
                        <td style={{ padding: "6px 0", color: "#172B4D" }}>KSM Token, User/Password, or Config File</td>
                      </tr>
                      <tr>
                        <td style={{ padding: "6px 0", color: "#5E6C84", verticalAlign: "top" }}>Persistent Login:</td>
                        <td style={{ padding: "6px 0", color: "#172B4D" }}>
                          <code style={{ backgroundColor: "#FFFFFF", padding: "2px 6px", borderRadius: "3px", fontSize: "12px" }}>this-device persistent-login on</code>
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>

                <div style={{ marginTop: "16px", padding: "14px 16px", backgroundColor: "#FFF7E6", borderLeft: "4px solid #FF991F", borderRadius: "3px" }}>
                  <p style={{ margin: 0, marginBottom: "8px", fontSize: "13px", color: "#974F0C", fontWeight: "600" }}>
                    Example Docker Deployment Commands
                  </p>
                  
                  <p style={{ margin: "10px 0 6px 0", fontSize: "12px", color: "#974F0C", fontWeight: "600" }}>
                    Basic Deployment:
                  </p>
                  <code style={{ display: "block", padding: "10px 12px", backgroundColor: "#FFFFFF", borderRadius: "3px", fontSize: "12px", color: "#172B4D", whiteSpace: "pre-wrap", wordBreak: "break-all", lineHeight: "18px" }}>
                    docker run -d -p 9009:9009 keeper-commander service-create -p 9009 -c 'record-add,list,ls,get,record-type-info,record-update,share-record,share-folder,rti,record-permission,pam,service-status' -f json -rm foreground -q n --user your@email.com --password yourpassword
                  </code>
                  
                  <p style={{ margin: "16px 0 6px 0", fontSize: "12px", color: "#974F0C", fontWeight: "600" }}>
                    With Ngrok Tunneling:
                  </p>
                  <code style={{ display: "block", padding: "10px 12px", backgroundColor: "#FFFFFF", borderRadius: "3px", fontSize: "12px", color: "#172B4D", whiteSpace: "pre-wrap", wordBreak: "break-all", lineHeight: "18px" }}>
                    docker run -d -p 9009:9009 keeper-commander service-create -p 9009 -c 'record-add,list,ls,get,record-type-info,record-update,share-record,share-folder,rti,record-permission,pam,service-status' -f json -rm foreground -q n -ng &lt;ngrok-auth-token&gt; -cd &lt;custom-domain&gt; --user your@email.com --password yourpassword
                  </code>
                  
                  <p style={{ margin: "16px 0 6px 0", fontSize: "12px", color: "#974F0C", fontWeight: "600" }}>
                    With Cloudflare Tunneling:
                  </p>
                  <code style={{ display: "block", padding: "10px 12px", backgroundColor: "#FFFFFF", borderRadius: "3px", fontSize: "12px", color: "#172B4D", whiteSpace: "pre-wrap", wordBreak: "break-all", lineHeight: "18px" }}>
                    docker run -d -p 9009:9009 keeper-commander service-create -p 9009 -c 'record-add,list,ls,get,record-type-info,record-update,share-record,share-folder,rti,record-permission,pam,service-status' -f json -rm foreground -q n -cf &lt;cloudflare-tunnel-token&gt; -cfd &lt;cloudflare-custom-domain&gt; --user your@email.com --password yourpassword
                  </code>
                  
                  <p style={{ margin: "16px 0 0 0", fontSize: "11px", color: "#6B778C", fontStyle: "italic", lineHeight: "16px" }}>
                    <strong>Parameters:</strong> <code style={{ backgroundColor: "#FFFFFF", padding: "1px 4px", borderRadius: "2px", fontSize: "11px" }}>-ng</code> Ngrok auth token, 
                    <code style={{ backgroundColor: "#FFFFFF", padding: "1px 4px", borderRadius: "2px", fontSize: "11px" }}>-cd</code> Ngrok custom domain (subdomain portion only), 
                    <code style={{ backgroundColor: "#FFFFFF", padding: "1px 4px", borderRadius: "2px", fontSize: "11px" }}>-cf</code> Cloudflare tunnel token, 
                    <code style={{ backgroundColor: "#FFFFFF", padding: "1px 4px", borderRadius: "2px", fontSize: "11px" }}>-cfd</code> Cloudflare custom domain
                  </p>
                </div>

                <div style={{ marginTop: "16px", padding: "14px 16px", backgroundColor: "#E3FCEF", borderLeft: "4px solid #00875A", borderRadius: "3px" }}>
                  <p style={{ margin: 0, marginBottom: "8px", fontSize: "13px", color: "#006644", fontWeight: "600" }}>
                    Keeper Commander CLI Deployment (Without Docker)
                  </p>
                  
                  <p style={{ margin: "10px 0 6px 0", fontSize: "12px", color: "#006644" }}>
                    First, install Keeper Commander CLI and configure persistent login:
                  </p>
                  <code style={{ display: "block", padding: "10px 12px", backgroundColor: "#FFFFFF", borderRadius: "3px", fontSize: "12px", color: "#172B4D", whiteSpace: "pre-wrap", wordBreak: "break-all", lineHeight: "18px" }}>
                    {`pip install keepercommander
keeper shell
login your@email.com
this-device persistent-login on
this-device register
this-device timeout 30d`}
                  </code>
                  
                  <p style={{ margin: "16px 0 6px 0", fontSize: "12px", color: "#006644", fontWeight: "600" }}>
                    Basic Service Creation:
                  </p>
                  <code style={{ display: "block", padding: "10px 12px", backgroundColor: "#FFFFFF", borderRadius: "3px", fontSize: "12px", color: "#172B4D", whiteSpace: "pre-wrap", wordBreak: "break-all", lineHeight: "18px" }}>
                    keeper service-create -p=9009 -c="record-add,list,ls,get,record-type-info,record-update,share-record,share-folder,rti,record-permission,pam,service-status" -rm="foreground" -q=n -f=json
                  </code>
                  
                  <p style={{ margin: "16px 0 6px 0", fontSize: "12px", color: "#006644", fontWeight: "600" }}>
                    With Ngrok Tunneling:
                  </p>
                  <code style={{ display: "block", padding: "10px 12px", backgroundColor: "#FFFFFF", borderRadius: "3px", fontSize: "12px", color: "#172B4D", whiteSpace: "pre-wrap", wordBreak: "break-all", lineHeight: "18px" }}>
                    keeper service-create -p=9009 -c="record-add,list,ls,get,record-type-info,record-update,share-record,share-folder,rti,record-permission,pam,service-status" -rm="foreground" -q=n -ng="&lt;ngrok-auth-token&gt;" -cd="&lt;custom-domain&gt;" -f=json
                  </code>
                  
                  <p style={{ margin: "16px 0 6px 0", fontSize: "12px", color: "#006644", fontWeight: "600" }}>
                    With Cloudflare Tunneling:
                  </p>
                  <code style={{ display: "block", padding: "10px 12px", backgroundColor: "#FFFFFF", borderRadius: "3px", fontSize: "12px", color: "#172B4D", whiteSpace: "pre-wrap", wordBreak: "break-all", lineHeight: "18px" }}>
                    keeper service-create -p=9009 -c="record-add,list,ls,get,record-type-info,record-update,share-record,share-folder,rti,record-permission,pam,service-status" -rm="foreground" -q=n -cf="&lt;cloudflare-tunnel-token&gt;" -cfd="&lt;cloudflare-custom-domain&gt;" -f=json
                  </code>
                  
                  <p style={{ margin: "16px 0 0 0", fontSize: "11px", color: "#00875A", fontStyle: "italic", lineHeight: "16px" }}>
                    <strong>Note:</strong> After service creation, the API key will be displayed in the console output. Make sure to copy and store it securely.
                  </p>
                </div>

                <p style={{ color: "#42526E", fontSize: "14px", lineHeight: "22px", marginTop: "16px", marginBottom: "0" }}>
                  After successful deployment, the service will generate a unique API key displayed in the console output or container logs. This API key must be securely stored and configured in the Jira integration settings. All configuration files are automatically encrypted using your private key to protect sensitive data including API keys, tokens, and security settings.
                </p>
                <p style={{ color: "#5E6C84", fontSize: "13px", lineHeight: "20px", fontStyle: "italic", marginTop: "12px", marginBottom: "0" }}>
                  Reference: <span onClick={() => router.open("https://docs.keeper.io/en/keeperpam/commander-cli/service-mode-rest-api")} style={{ color: "#5E6C84", textDecoration: "underline", cursor: "pointer" }}>Service Mode REST API Documentation</span>
                </p>
              </div>

              <div style={{ marginTop: "32px", padding: "14px 16px", backgroundColor: "#E3FCEF", borderLeft: "4px solid #00875A", borderRadius: "3px" }}>
                <p style={{ margin: 0, fontSize: "14px", color: "#006644", lineHeight: "22px" }}>
                  <strong style={{ fontWeight: "600" }}>Need Additional Help?</strong> For comprehensive setup instructions, troubleshooting guides, and advanced configuration options, visit the official Keeper documentation at <span onClick={() => router.open("https://docs.keeper.io/en/keeperpam/commander-cli/overview")} style={{ color: "#006644", textDecoration: "underline", fontWeight: "500", cursor: "pointer" }}>docs.keeper.io</span>. For technical support, contact <span onClick={() => router.open("mailto:commander@keepersecurity.com")} style={{ color: "#006644", textDecoration: "underline", fontWeight: "500", cursor: "pointer" }}>commander@keepersecurity.com</span>.
                </p>
              </div>
            </>
          )}

          {activeTab === "pedm" && (
            <>
              {/* Header with Quick Sync button */}
              <div style={{ 
                display: "flex", 
                justifyContent: "space-between", 
                alignItems: "flex-start",
                marginBottom: "20px"
              }}>
                <div>
                  <h2 style={{ fontWeight: "600", fontSize: "20px", marginBottom: "8px", color: "#172B4D" }}>
                    PEDM Requests
                  </h2>
                  <p style={{ color: "#5E6C84", fontSize: "14px", marginBottom: "0", lineHeight: "20px" }}>
                    Manage and view Privileged Enterprise Data Management (PEDM) requests here.
                  </p>
                </div>
                {isAdmin && !isCheckingAdmin && (
                  <div
                    onClick={isPedmLoading ? undefined : handleQuickSync}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "8px",
                      cursor: isPedmLoading ? "default" : "pointer",
                      color: "#172B4D",
                      fontWeight: "600",
                      fontSize: "14px",
                      transition: "color 0.2s ease"
                    }}
                    onMouseEnter={(e) => {
                      if (!isPedmLoading) e.currentTarget.style.color = "#0052CC";
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.color = "#172B4D";
                    }}
                  >
                    {isPedmLoading ? (
                      <Spinner size="medium" />
                    ) : (
                      <RefreshIcon label="Sync" size="medium" />
                    )}
                    <span>Quick Sync</span>
                  </div>
                )}
              </div>
              
              {isCheckingAdmin ? (
                <div style={{ textAlign: "center", padding: "20px", color: "#5E6C84" }}>
                  <p>Checking admin permissions...</p>
                </div>
              ) : !isAdmin ? (
                <div style={{ padding: "16px 0" }}>
                  <SectionMessage appearance="warning" title="Access Restricted">
                    <p style={{ margin: "8px 0", color: "#42526E", fontSize: "14px", lineHeight: "20px" }}>
                      Only Jira Administrators or Project Administrators can access the PEDM Requests page. 
                      Please contact your Jira administrator if you need to view or manage PEDM requests.
                    </p>
                  </SectionMessage>
                </div>
              ) : (
                <>
                  {/* Loading state */}
                  {isPedmLoading && (
                    <div style={{ 
                      textAlign: "center", 
                      padding: "60px 40px", 
                      backgroundColor: "#FAFBFC",
                      borderRadius: "3px",
                      border: "1px solid #DFE1E6"
                    }}>
                      <div style={{ marginBottom: "16px" }}>
                        <Spinner size="large" />
                      </div>
                      <div style={{ fontSize: "16px", fontWeight: "500", color: "#172B4D", marginBottom: "8px" }}>
                        Loading PEDM data...
                      </div>
                      <p style={{ fontSize: "14px", color: "#5E6C84", margin: "0" }}>
                        Testing connection, syncing PEDM data, and fetching pending approvals
                      </p>
                    </div>
                  )}

                  {/* Message Display - Same format as config page */}
                  {!isPedmLoading && pedmMessage && (() => {
                    const messageStyles = {
                      success: {
                        background: "#F0FDF4",
                        border: "2px solid #86EFAC",
                        titleColor: "#166534",
                        title: "Success Message"
                      },
                      error: {
                        background: "#FEF2F2",
                        border: "2px solid #FCA5A5",
                        titleColor: "#991B1B",
                        title: "Error Message"
                      },
                      warning: {
                        background: "#FFFBEB",
                        border: "2px solid #FCD34D",
                        titleColor: "#92400E",
                        title: "Warning Message"
                      },
                      info: {
                        background: "#EFF6FF",
                        border: "2px solid #93C5FD",
                        titleColor: "#1E40AF",
                        title: "Info Message"
                      }
                    };
                    
                    const style = messageStyles[pedmMessage.type] || messageStyles.info;
                    
                    return (
                      <div style={{ marginBottom: "20px", marginTop: "16px" }}>
                        <div style={{
                          padding: "10px 14px",
                          backgroundColor: style.background,
                          borderRadius: "8px",
                          border: style.border,
                          position: "relative"
                        }}>
                          <div style={{
                            fontWeight: "600",
                            fontSize: "16px",
                            color: style.titleColor,
                            marginBottom: "6px"
                          }}>
                            {pedmMessage.title || style.title}
                          </div>
                          <div style={{ 
                            fontSize: "14px", 
                            color: "#6B7280",
                            lineHeight: "1.4"
                          }}>
                            {pedmMessage.message}
                          </div>
                        </div>
                      </div>
                    );
                  })()}

                  {/* Data display - Table with search and pagination */}
                  {!isPedmLoading && pedmData && (() => {
                    // Helper function to check if approval is expired
                    const isApprovalExpired = (approval) => {
                      if (approval.created && approval.expire_in) {
                        const createdTime = new Date(approval.created);
                        const expirationTime = new Date(createdTime.getTime() + approval.expire_in * 60000);
                        return currentTime > expirationTime;
                      }
                      return approval.status && approval.status !== 'Pending';
                    };
                    
                    // Filter approvals based on expired status and search term
                    const filteredApprovals = pedmApprovals.filter(approval => {
                      // First filter by expired status
                      const isExpired = isApprovalExpired(approval);
                      if (showExpiredOnly) {
                        // Show only expired records
                        if (!isExpired) return false;
                      } else {
                        // Show only non-expired records (default)
                        if (isExpired) return false;
                      }
                      
                      // Then filter by search term
                      if (!pedmSearchTerm) return true;
                      const searchLower = pedmSearchTerm.toLowerCase();
                      return (
                        approval.approval_uid?.toLowerCase().includes(searchLower) ||
                        approval.approval_type?.toLowerCase().includes(searchLower) ||
                        approval.status?.toLowerCase().includes(searchLower) ||
                        approval.justification?.toLowerCase().includes(searchLower) ||
                        approval.account_info?.some(info => info.toLowerCase().includes(searchLower)) ||
                        approval.application_info?.some(info => info.toLowerCase().includes(searchLower))
                      );
                    });

                    // Calculate pagination
                    const totalPages = Math.ceil(filteredApprovals.length / pedmItemsPerPage);
                    const startIndex = (pedmCurrentPage - 1) * pedmItemsPerPage;
                    const endIndex = startIndex + pedmItemsPerPage;
                    const currentApprovals = filteredApprovals.slice(startIndex, endIndex);

                    return (
                      <div style={{ marginTop: "20px" }}>
                        {/* Search box and Expired button */}
                        <div style={{ marginBottom: "16px", display: "flex", gap: "12px", alignItems: "center" }}>
                          <div style={{ flex: 1 }}>
                            <TextField
                              placeholder="Search approvals..."
                              value={pedmSearchTerm}
                              onChange={(e) => {
                                setPedmSearchTerm(e.target.value);
                                setPedmCurrentPage(1); // Reset to first page on search
                              }}
                              width="100%"
                            />
                          </div>
                          <button
                            onClick={() => {
                              setShowExpiredOnly(!showExpiredOnly);
                              setPedmCurrentPage(1); // Reset to first page on toggle
                            }}
                            style={{
                              backgroundColor: showExpiredOnly ? "#DE350B" : "#FFFFFF",
                              color: showExpiredOnly ? "#FFFFFF" : "#172B4D",
                              fontWeight: "600",
                              fontSize: "14px",
                              padding: "8px 16px",
                              borderRadius: "3px",
                              border: showExpiredOnly ? "2px solid #DE350B" : "2px solid #DFE1E6",
                              cursor: "pointer",
                              boxShadow: "0 1px 2px rgba(0,0,0,0.1)",
                              transition: "all 0.2s ease",
                              whiteSpace: "nowrap"
                            }}
                            onMouseEnter={(e) => {
                              if (!showExpiredOnly) {
                                e.currentTarget.style.backgroundColor = "#F4F5F7";
                              }
                            }}
                            onMouseLeave={(e) => {
                              if (!showExpiredOnly) {
                                e.currentTarget.style.backgroundColor = "#FFFFFF";
                              }
                            }}
                          >
                            {showExpiredOnly ? "Show Active" : "Show Expired"}
                          </button>
                        </div>

                        {/* Table or empty state */}
                        {filteredApprovals.length === 0 ? (
                          <div style={{ 
                            padding: "40px", 
                            textAlign: "center", 
                            backgroundColor: "#F4F5F7", 
                            borderRadius: "3px",
                            border: "1px solid #DFE1E6"
                          }}>
                            <div style={{ fontSize: "16px", fontWeight: "500", color: "#42526E", marginBottom: "8px" }}>
                              {pedmSearchTerm 
                                ? "No matching approvals found" 
                                : showExpiredOnly 
                                  ? "No expired approvals" 
                                  : "No active approvals"}
                            </div>
                            <p style={{ fontSize: "14px", color: "#5E6C84", margin: "0" }}>
                              {pedmSearchTerm 
                                ? "Try adjusting your search criteria" 
                                : showExpiredOnly
                                  ? "There are no expired PEDM approval requests"
                                  : "There are no active PEDM approval requests at this time"}
                            </p>
                          </div>
                        ) : (
                          <>
                            {/* Table */}
                            <div style={{ 
                              overflowX: "auto", 
                              border: "1px solid #DFE1E6", 
                              borderRadius: "3px",
                              backgroundColor: "#FFFFFF"
                            }}>
                              <table style={{ 
                                width: "100%", 
                                borderCollapse: "collapse",
                                fontSize: "14px"
                              }}>
                                <thead>
                                  <tr style={{ backgroundColor: "#F4F5F7", borderBottom: "2px solid #DFE1E6" }}>
                                    <th style={{ padding: "16px", textAlign: "left", fontWeight: "600", color: "#172B4D", fontSize: "14px" }}>User</th>
                                    <th style={{ padding: "16px", textAlign: "left", fontWeight: "600", color: "#172B4D", fontSize: "14px" }}>Application</th>
                                    <th style={{ padding: "16px", textAlign: "left", fontWeight: "600", color: "#172B4D", fontSize: "14px" }}>Justification Message</th>
                                    <th style={{ padding: "16px", textAlign: "left", fontWeight: "600", color: "#172B4D", fontSize: "14px" }}>Request Timeout</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {currentApprovals.map((approval, index) => {
                                    // Extract username from account_info (format: "Username=bisalranjanpadhan")
                                    const username = approval.account_info && approval.account_info.length > 0 
                                      ? approval.account_info[0].replace(/^Username=/i, '')
                                      : 'Unknown';
                                    
                                    // Get initials for avatar
                                    const initials = username.substring(0, 2).toUpperCase();
                                    
                                    // Extract application display from application_info
                                    let applicationDisplay = '-';
                                    if (approval.application_info && approval.application_info.length > 0) {
                                      // Try to find Description field first
                                      const descField = approval.application_info.find(info => info.startsWith('Description='));
                                      if (descField) {
                                        applicationDisplay = descField.replace(/^Description=/i, '');
                                      } else {
                                        // Fallback to first item
                                        applicationDisplay = approval.application_info[0];
                                      }
                                    }
                                    
                                    // Calculate if expired based on created time + expire_in minutes
                                    let isExpired = false;
                                    let timeoutText = 'Pending';
                                    
                                    if (approval.created && approval.expire_in) {
                                      const createdTime = new Date(approval.created);
                                      const expirationTime = new Date(createdTime.getTime() + approval.expire_in * 60000); // expire_in is in minutes
                                      
                                      if (currentTime > expirationTime) {
                                        // Expired
                                        isExpired = true;
                                        timeoutText = 'Expired';
                                      } else {
                                        // Calculate remaining time
                                        const remainingMs = expirationTime - currentTime;
                                        const remainingMinutes = Math.floor(remainingMs / 60000);
                                        const remainingSeconds = Math.floor((remainingMs % 60000) / 1000);
                                        
                                        if (remainingMinutes > 0) {
                                          timeoutText = `${remainingMinutes}m ${remainingSeconds}s remaining`;
                                        } else {
                                          timeoutText = `${remainingSeconds}s remaining`;
                                        }
                                        isExpired = false;
                                      }
                                    } else if (approval.status && approval.status !== 'Pending') {
                                      // Fallback: check status
                                      isExpired = true;
                                      timeoutText = 'Expired';
                                    }
                                    
                                    return (
                                      <tr 
                                        key={approval.approval_uid || index}
                                        onClick={() => handleRowClick(approval)}
                                        style={{ 
                                          borderBottom: "1px solid #DFE1E6",
                                          cursor: "pointer",
                                          transition: "background-color 0.2s ease"
                                        }}
                                        onMouseEnter={(e) => {
                                          e.currentTarget.style.backgroundColor = "#F4F5F7";
                                        }}
                                        onMouseLeave={(e) => {
                                          e.currentTarget.style.backgroundColor = "#FFFFFF";
                                        }}
                                      >
                                        {/* User column with avatar */}
                                        <td style={{ padding: "16px" }}>
                                          <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                                            <div style={{
                                              width: "40px",
                                              height: "40px",
                                              borderRadius: "50%",
                                              backgroundColor: getUserColor(username),
                                              color: "#FFFFFF",
                                              display: "flex",
                                              alignItems: "center",
                                              justifyContent: "center",
                                              fontWeight: "600",
                                              fontSize: "14px",
                                              flexShrink: 0
                                            }}>
                                              {initials}
                                            </div>
                                            <div>
                                              <div style={{ 
                                                fontWeight: "500", 
                                                color: "#172B4D",
                                                fontSize: "14px",
                                                marginBottom: "2px"
                                              }}>
                                                {username}
                                              </div>
                                              {approval.approval_type && (
                                                <div style={{ 
                                                  color: "#00875A", 
                                                  fontSize: "12px",
                                                  fontWeight: "500"
                                                }}>
                                                  {approval.approval_type}
                                                </div>
                                              )}
                                            </div>
                                          </div>
                                        </td>
                                        
                                        {/* Application column */}
                                        <td style={{ 
                                          padding: "16px", 
                                          color: "#172B4D",
                                          fontSize: "14px"
                                        }}>
                                          {applicationDisplay}
                                        </td>
                                        
                                        {/* Justification Message column */}
                                        <td style={{ 
                                          padding: "16px", 
                                          color: "#172B4D",
                                          fontSize: "14px"
                                        }}>
                                          {approval.justification || '-'}
                                        </td>
                                        
                                        {/* Request Timeout column */}
                                        <td style={{ 
                                          padding: "16px",
                                          fontSize: "14px",
                                          fontWeight: "600",
                                          color: isExpired ? "#DE350B" : "#00875A"
                                        }}>
                                          {timeoutText}
                                        </td>
                                      </tr>
                                    );
                                  })}
                                </tbody>
                              </table>
                            </div>

                            {/* Pagination */}
                            {totalPages > 1 && (
                              <div style={{ 
                                display: "flex", 
                                justifyContent: "space-between", 
                                alignItems: "center",
                                marginTop: "16px",
                                padding: "12px 0"
                              }}>
                                <div style={{ fontSize: "14px", color: "#5E6C84" }}>
                                  Showing {startIndex + 1} to {Math.min(endIndex, filteredApprovals.length)} of {filteredApprovals.length} approvals
                                </div>
                                <div style={{ display: "flex", gap: "8px" }}>
                                  <Button
                                    appearance="default"
                                    isDisabled={pedmCurrentPage === 1}
                                    onClick={() => setPedmCurrentPage(prev => Math.max(1, prev - 1))}
                                  >
                                    Previous
                                  </Button>
                                  <div style={{ 
                                    display: "flex", 
                                    alignItems: "center", 
                                    padding: "0 12px",
                                    fontSize: "14px",
                                    color: "#172B4D"
                                  }}>
                                    Page {pedmCurrentPage} of {totalPages}
                                  </div>
                                  <Button
                                    appearance="default"
                                    isDisabled={pedmCurrentPage === totalPages}
                                    onClick={() => setPedmCurrentPage(prev => Math.min(totalPages, prev + 1))}
                                  >
                                    Next
                                  </Button>
                                </div>
                              </div>
                            )}
                          </>
                        )}
                      </div>
                    );
                  })()}
                </>
              )}

              {/* Modal for showing approval details */}
              {isModalOpen && selectedApproval && (
                <div 
                  style={{
                    position: "fixed",
                    top: 0,
                    left: 0,
                    right: 0,
                    bottom: 0,
                    backgroundColor: "rgba(9, 30, 66, 0.54)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    zIndex: 9999,
                    padding: "24px"
                  }}
                  onClick={handleCloseModal}
                >
                  <div 
                    style={{
                      backgroundColor: "#FFFFFF",
                      borderRadius: "3px",
                      maxWidth: "600px",
                      width: "100%",
                      maxHeight: "90vh",
                      display: "flex",
                      flexDirection: "column",
                      boxShadow: "0 20px 32px -8px rgba(9, 30, 66, 0.25), 0 0 1px rgba(9, 30, 66, 0.31)"
                    }}
                    onClick={(e) => e.stopPropagation()}
                  >
                    {/* Modal Header */}
                    <div style={{
                      padding: "24px 24px 20px",
                      borderBottom: "1px solid #DFE1E6",
                      flexShrink: 0
                    }}>
                      <h2 style={{
                        margin: 0,
                        fontSize: "20px",
                        fontWeight: "600",
                        color: "#172B4D"
                      }}>
                        Request Details
                      </h2>
                    </div>

                    {/* Modal Body */}
                    <div style={{ padding: "24px", overflowY: "auto", flex: 1 }}>
                      {/* User */}
                      <div style={{ marginBottom: "24px" }}>
                        <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                          <div style={{
                            width: "40px",
                            height: "40px",
                            borderRadius: "50%",
                            backgroundColor: getUserColor(
                              selectedApproval.account_info && selectedApproval.account_info.length > 0 
                                ? selectedApproval.account_info[0].replace(/^Username=/i, '')
                                : 'Unknown'
                            ),
                            color: "#FFFFFF",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            fontWeight: "600",
                            fontSize: "14px",
                            flexShrink: 0
                          }}>
                            {(() => {
                              const username = selectedApproval.account_info && selectedApproval.account_info.length > 0 
                                ? selectedApproval.account_info[0].replace(/^Username=/i, '')
                                : 'Unknown';
                              return username.substring(0, 2).toUpperCase();
                            })()}
                          </div>
                          <div style={{ flex: 1 }}>
                            <div style={{ 
                              fontWeight: "500", 
                              color: "#172B4D",
                              fontSize: "14px",
                              marginBottom: "2px"
                            }}>
                              {selectedApproval.account_info && selectedApproval.account_info.length > 0 
                                ? selectedApproval.account_info[0].replace(/^Username=/i, '')
                                : 'Unknown'}
                            </div>
                            {selectedApproval.approval_type && (
                              <div style={{ 
                                color: "#00875A", 
                                fontSize: "12px",
                                fontWeight: "500"
                              }}>
                                {selectedApproval.approval_type}
                              </div>
                            )}
                          </div>
                          
                          {/* Approve and Deny buttons - only show for non-expired requests */}
                          {(() => {
                            // Check if the selected approval is expired
                            let isExpired = false;
                            if (selectedApproval.created && selectedApproval.expire_in) {
                              const createdTime = new Date(selectedApproval.created);
                              const expirationTime = new Date(createdTime.getTime() + selectedApproval.expire_in * 60000);
                              isExpired = currentTime > expirationTime;
                            } else if (selectedApproval.status && selectedApproval.status !== 'Pending') {
                              isExpired = true;
                            }
                            
                            if (!isExpired) {
                              return (
                                <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      handleDenyRequest(selectedApproval.approval_uid);
                                      handleCloseModal();
                                    }}
                                    style={{
                                      backgroundColor: "#FFFFFF",
                                      color: "#DE350B",
                                      fontWeight: "600",
                                      fontSize: "14px",
                                      padding: "8px 16px",
                                      borderRadius: "3px",
                                      border: "2px solid #DE350B",
                                      cursor: "pointer",
                                      boxShadow: "0 1px 2px rgba(0,0,0,0.1)",
                                      transition: "all 0.2s ease",
                                      display: "inline-flex",
                                      alignItems: "center",
                                      gap: "6px",
                                      whiteSpace: "nowrap"
                                    }}
                                    onMouseEnter={(e) => {
                                      e.currentTarget.style.backgroundColor = "#FFEBE6";
                                    }}
                                    onMouseLeave={(e) => {
                                      e.currentTarget.style.backgroundColor = "#FFFFFF";
                                    }}
                                  >
                                    <CrossCircleIcon label="Deny" size="small" />
                                    Deny
                                  </button>
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      handleApproveRequest(selectedApproval.approval_uid);
                                      handleCloseModal();
                                    }}
                                    style={{
                                      backgroundColor: "#FFFFFF",
                                      color: "#00875A",
                                      fontWeight: "600",
                                      fontSize: "14px",
                                      padding: "8px 16px",
                                      borderRadius: "3px",
                                      border: "2px solid #00875A",
                                      cursor: "pointer",
                                      boxShadow: "0 1px 2px rgba(0,0,0,0.1)",
                                      transition: "all 0.2s ease",
                                      display: "inline-flex",
                                      alignItems: "center",
                                      gap: "6px",
                                      whiteSpace: "nowrap"
                                    }}
                                    onMouseEnter={(e) => {
                                      e.currentTarget.style.backgroundColor = "#E3FCEF";
                                    }}
                                    onMouseLeave={(e) => {
                                      e.currentTarget.style.backgroundColor = "#FFFFFF";
                                    }}
                                  >
                                    <EditorDoneIcon label="Approve" size="small" />
                                    Approve
                                  </button>
                                </div>
                              );
                            }
                            return null;
                          })()}
                        </div>
                      </div>

                      {/* Application */}
                      <div style={{ marginBottom: "20px" }}>
                        <div style={{ 
                          fontSize: "12px", 
                          color: "#6B778C", 
                          fontWeight: "600", 
                          marginBottom: "6px"
                        }}>
                          Application
                        </div>
                        <div style={{ fontSize: "14px", color: "#172B4D" }}>
                          {(() => {
                            if (selectedApproval.application_info && selectedApproval.application_info.length > 0) {
                              const descField = selectedApproval.application_info.find(info => info.startsWith('Description='));
                              return descField ? descField.replace(/^Description=/i, '') : selectedApproval.application_info[0];
                            }
                            return '-';
                          })()}
                        </div>
                      </div>

                      {/* Time Requested */}
                      <div style={{ marginBottom: "20px" }}>
                        <div style={{ 
                          fontSize: "12px", 
                          color: "#6B778C", 
                          fontWeight: "600", 
                          marginBottom: "6px"
                        }}>
                          Time Requested
                        </div>
                        <div style={{ fontSize: "14px", color: "#172B4D" }}>
                          {selectedApproval.expire_in ? `${selectedApproval.expire_in} minutes` : '-'}
                        </div>
                      </div>

                      {/* Justification Message */}
                      <div style={{ marginBottom: "20px" }}>
                        <div style={{ 
                          fontSize: "12px", 
                          color: "#6B778C", 
                          fontWeight: "600", 
                          marginBottom: "6px"
                        }}>
                          Justification Message
                        </div>
                        <div style={{ 
                          fontSize: "14px", 
                          color: "#172B4D", 
                          padding: "10px",
                          backgroundColor: "#F4F5F7",
                          borderRadius: "3px",
                          borderLeft: "3px solid #0052CC"
                        }}>
                          {selectedApproval.justification || '-'}
                        </div>
                      </div>

                      {/* Request Timeout */}
                      <div style={{ marginBottom: "20px" }}>
                        <div style={{ 
                          fontSize: "12px", 
                          color: "#6B778C", 
                          fontWeight: "600", 
                          marginBottom: "6px"
                        }}>
                          Request Timeout
                        </div>
                        <div style={{ fontSize: "14px", color: "#172B4D", fontWeight: "500" }}>
                          {(() => {
                            if (selectedApproval.created && selectedApproval.expire_in) {
                              const createdTime = new Date(selectedApproval.created);
                              const expirationTime = new Date(createdTime.getTime() + selectedApproval.expire_in * 60000);
                              
                              if (currentTime > expirationTime) {
                                return <span style={{ color: "#DE350B", fontWeight: "600" }}>Expired</span>;
                              } else {
                                const remainingMs = expirationTime - currentTime;
                                const remainingMinutes = Math.floor(remainingMs / 60000);
                                const remainingSeconds = Math.floor((remainingMs % 60000) / 1000);
                                const hours = Math.floor(remainingMinutes / 60);
                                const mins = remainingMinutes % 60;
                                
                                if (hours > 0) {
                                  return <span style={{ color: "#00875A", fontWeight: "600" }}>{`${hours.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}:${remainingSeconds.toString().padStart(2, '0')} remaining`}</span>;
                                } else {
                                  return <span style={{ color: "#00875A", fontWeight: "600" }}>{`${mins.toString().padStart(2, '0')}:${remainingSeconds.toString().padStart(2, '0')} remaining`}</span>;
                                }
                              }
                            }
                            return '-';
                          })()}
                        </div>
                      </div>

                      {/* Requested On */}
                      <div style={{ marginBottom: "20px" }}>
                        <div style={{ 
                          fontSize: "12px", 
                          color: "#6B778C", 
                          fontWeight: "600", 
                          marginBottom: "6px"
                        }}>
                          Requested on
                        </div>
                        <div style={{ fontSize: "14px", color: "#172B4D" }}>
                          {selectedApproval.created ? new Date(selectedApproval.created).toLocaleString('en-US', {
                            year: 'numeric',
                            month: 'long',
                            day: 'numeric',
                            hour: '2-digit',
                            minute: '2-digit',
                            second: '2-digit',
                            timeZoneName: 'short'
                          }) : '-'}
                        </div>
                      </div>

                      {/* Operating System and Machine Name in a row */}
                      <div style={{ display: "flex", gap: "24px" }}>
                        {/* Operating System */}
                        <div style={{ flex: 1 }}>
                          <div style={{ 
                            fontSize: "12px", 
                            color: "#6B778C", 
                            fontWeight: "600", 
                            marginBottom: "6px"
                          }}>
                            Operating System
                          </div>
                          <div style={{ fontSize: "14px", color: "#172B4D" }}>
                            {(() => {
                              if (selectedApproval.application_info && selectedApproval.application_info.length > 0) {
                                const osField = selectedApproval.application_info.find(info => info.startsWith('Operating System='));
                                return osField ? osField.replace(/^Operating System=/i, '') : '-';
                              }
                              return '-';
                            })()}
                          </div>
                        </div>

                        {/* Machine Name */}
                        <div style={{ flex: 1 }}>
                          <div style={{ 
                            fontSize: "12px", 
                            color: "#6B778C", 
                            fontWeight: "600", 
                            marginBottom: "6px"
                          }}>
                            Machine Name
                          </div>
                          <div style={{ fontSize: "14px", color: "#172B4D" }}>
                            {(() => {
                              if (selectedApproval.application_info && selectedApproval.application_info.length > 0) {
                                const machineField = selectedApproval.application_info.find(info => info.startsWith('Hostname='));
                                return machineField ? machineField.replace(/^Hostname=/i, '') : '-';
                              }
                              return '-';
                            })()}
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* Modal Footer */}
                    <div style={{
                      padding: "16px 24px",
                      borderTop: "1px solid #DFE1E6",
                      display: "flex",
                      justifyContent: "flex-end",
                      flexShrink: 0
                    }}>
                      <button
                        onClick={handleCloseModal}
                        style={{
                          backgroundColor: "#FFFFFF",
                          color: "#172B4D",
                          fontWeight: "600",
                          fontSize: "14px",
                          padding: "8px 16px",
                          borderRadius: "3px",
                          border: "2px solid #DFE1E6",
                          cursor: "pointer",
                          boxShadow: "0 1px 2px rgba(0,0,0,0.1)",
                          transition: "all 0.2s ease"
                        }}
                        onMouseEnter={(e) => {
                          e.currentTarget.style.backgroundColor = "#F4F5F7";
                        }}
                        onMouseLeave={(e) => {
                          e.currentTarget.style.backgroundColor = "#FFFFFF";
                        }}
                      >
                        Close
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </>
          )}

          {activeTab === "about" && (
            <>
              <h2 style={{ fontWeight: "600", fontSize: "20px", marginBottom: "8px", color: "#172B4D" }}>
                About
              </h2>
              <p style={{ color: "#42526E", fontSize: "14px", lineHeight: "22px", marginBottom: "24px", marginTop: "12px" }}>
                The Keeper-Jira Integration is a powerful Atlassian Forge application that bridges Jira Cloud with Keeper Security's vault management platform. This integration enables seamless credential management, secure secret storage, and privileged access workflows directly from within your Jira issues, eliminating context switching and improving security team productivity.
              </p>

              <div style={{ marginBottom: "32px", paddingBottom: "24px", borderBottom: "1px solid #DFE1E6" }}>
                <h3 style={{ fontWeight: "600", fontSize: "16px", marginTop: "0", marginBottom: "12px", color: "#172B4D" }}>
                  Key Features
                </h3>
                
                <div style={{ marginBottom: "16px" }}>
                  <p style={{ color: "#42526E", fontSize: "14px", lineHeight: "22px", marginBottom: "8px", fontWeight: "600" }}>
                    Vault Operations from Jira Issues
                  </p>
                  <p style={{ color: "#42526E", fontSize: "14px", lineHeight: "22px", marginBottom: "0", paddingLeft: "24px" }}>
                    Create new secrets, update existing records, manage permissions, and share credentials directly from Jira issue panels. All operations are executed through Keeper Commander CLI's REST API, ensuring secure and auditable vault management without leaving your project workflow.
                  </p>
                </div>

                <div style={{ marginBottom: "16px" }}>
                  <p style={{ color: "#42526E", fontSize: "14px", lineHeight: "22px", marginBottom: "8px", fontWeight: "600" }}>
                    PEDM (Privileged Enterprise Data Management)
                  </p>
                  <p style={{ color: "#42526E", fontSize: "14px", lineHeight: "22px", marginBottom: "0", paddingLeft: "24px" }}>
                    Monitor and manage privilege elevation requests with real-time approval workflows. View pending access requests, approve or deny privilege escalation, track approval timeouts with live countdowns, and maintain complete visibility over privileged access across your organization.
                  </p>
                </div>

                <div style={{ marginBottom: "16px" }}>
                  <p style={{ color: "#42526E", fontSize: "14px", lineHeight: "22px", marginBottom: "8px", fontWeight: "600" }}>
                    Centralized Configuration Management
                  </p>
                  <p style={{ color: "#42526E", fontSize: "14px", lineHeight: "22px", marginBottom: "0", paddingLeft: "24px" }}>
                    Configure Keeper Commander REST API endpoints, manage authentication tokens, and test connectivity from a unified global settings page. Administrators can easily set up and maintain the integration with built-in connection verification and status monitoring.
                  </p>
                </div>

                <div style={{ marginBottom: "0" }}>
                  <p style={{ color: "#42526E", fontSize: "14px", lineHeight: "22px", marginBottom: "8px", fontWeight: "600" }}>
                    Native Jira Experience
                  </p>
                  <p style={{ color: "#42526E", fontSize: "14px", lineHeight: "22px", marginBottom: "0", paddingLeft: "24px" }}>
                    Built with Atlassian Forge Custom UI and Atlaskit design system components for a seamless, native Jira Cloud experience. The integration respects Jira's permissions model and follows platform best practices for security, performance, and user experience.
                  </p>
                </div>
              </div>

              <div style={{ marginBottom: "32px", paddingBottom: "24px", borderBottom: "1px solid #DFE1E6" }}>
                <h3 style={{ fontWeight: "600", fontSize: "16px", marginTop: "0", marginBottom: "12px", color: "#172B4D" }}>
                  Architecture Overview
                </h3>
                
                <p style={{ color: "#42526E", fontSize: "14px", lineHeight: "22px", marginBottom: "16px" }}>
                  The integration operates through a three-tier architecture: Jira Cloud hosts the Forge app frontend, Keeper Commander CLI runs in Service Mode to provide REST API access to vault operations, and a tunneling solution (Ngrok or Cloudflare Tunnel) bridges the local service with cloud-hosted Jira. This architecture ensures secure communication while maintaining the flexibility of on-premises credential storage.
                </p>

                <p style={{ color: "#42526E", fontSize: "14px", lineHeight: "22px", marginBottom: "16px" }}>
                  All API communications are authenticated using secure tokens, encrypted in transit via HTTPS, and logged for audit compliance. The Forge app operates within Jira's sandboxed environment, ensuring proper isolation and adherence to Atlassian's security requirements.
                </p>

                <div style={{ padding: "14px 16px", backgroundColor: "#F4F5F7", borderLeft: "4px solid #0052CC", borderRadius: "3px" }}>
                  <p style={{ margin: 0, fontSize: "14px", color: "#172B4D", lineHeight: "22px" }}>
                    <strong style={{ fontWeight: "600" }}>Technology Stack:</strong> Atlassian Forge Platform, React 18, Atlaskit UI Components, Keeper Commander CLI, REST API Integration, Docker (optional deployment)
                  </p>
                </div>
              </div>

              <div style={{ marginBottom: "32px", paddingBottom: "24px", borderBottom: "1px solid #DFE1E6" }}>
                <h3 style={{ fontWeight: "600", fontSize: "16px", marginTop: "0", marginBottom: "12px", color: "#172B4D" }}>
                  Integration Capabilities
                </h3>
                <p style={{ color: "#42526E", fontSize: "14px", lineHeight: "22px", marginBottom: "16px" }}>
                  Once configured, this integration provides five core capabilities for managing Keeper vault operations directly from Jira issues. Each action corresponds to specific Commander CLI commands and enables different vault management scenarios.
                </p>

                <div style={{ marginBottom: "16px", padding: "12px 14px", backgroundColor: "#F4F5F7", borderRadius: "3px" }}>
                  <p style={{ margin: 0, marginBottom: "6px", fontSize: "14px", color: "#172B4D", fontWeight: "600" }}>
                    Create New Secret
                  </p>
                  <p style={{ margin: 0, fontSize: "13px", color: "#42526E", lineHeight: "20px" }}>
                    Add new records to your Keeper vault with customizable fields and record types. Uses the <code style={{ backgroundColor: "#FFFFFF", padding: "2px 4px", borderRadius: "3px", fontSize: "12px" }}>record-add</code> command to create login credentials, secure notes, payment cards, and other record types. Ideal for onboarding workflows where new accounts need to be provisioned and credentials stored securely.
                  </p>
                </div>

                <div style={{ marginBottom: "16px", padding: "12px 14px", backgroundColor: "#F4F5F7", borderRadius: "3px" }}>
                  <p style={{ margin: 0, marginBottom: "6px", fontSize: "14px", color: "#172B4D", fontWeight: "600" }}>
                    Update Record
                  </p>
                  <p style={{ margin: 0, fontSize: "13px", color: "#42526E", lineHeight: "20px" }}>
                    Modify existing record fields including passwords, usernames, URLs, and custom fields. Leverages the <code style={{ backgroundColor: "#FFFFFF", padding: "2px 4px", borderRadius: "3px", fontSize: "12px" }}>record-update</code> command to keep credentials current and accurate. Perfect for password rotation workflows and credential lifecycle management.
                  </p>
                </div>

                <div style={{ marginBottom: "16px", padding: "12px 14px", backgroundColor: "#F4F5F7", borderRadius: "3px" }}>
                  <p style={{ margin: 0, marginBottom: "6px", fontSize: "14px", color: "#172B4D", fontWeight: "600" }}>
                    Record Permission
                  </p>
                  <p style={{ margin: 0, fontSize: "13px", color: "#42526E", lineHeight: "20px" }}>
                    Manage granular permissions for records within shared folders using the <code style={{ backgroundColor: "#FFFFFF", padding: "2px 4px", borderRadius: "3px", fontSize: "12px" }}>record-permission</code> command. Control which users or teams can view, edit, or reshare specific records. Essential for implementing least-privilege access controls and compliance requirements.
                  </p>
                </div>

                <div style={{ marginBottom: "16px", padding: "12px 14px", backgroundColor: "#F4F5F7", borderRadius: "3px" }}>
                  <p style={{ margin: 0, marginBottom: "6px", fontSize: "14px", color: "#172B4D", fontWeight: "600" }}>
                    Share Record
                  </p>
                  <p style={{ margin: 0, fontSize: "13px", color: "#42526E", lineHeight: "20px" }}>
                    Grant or revoke user access to individual records with configurable permissions and optional expiration dates. Utilizes the <code style={{ backgroundColor: "#FFFFFF", padding: "2px 4px", borderRadius: "3px", fontSize: "12px" }}>share-record</code> command to enable time-bound access for contractors, temporary access for incident response, or permanent sharing with team members.
                  </p>
                </div>

                <div style={{ marginBottom: "16px", padding: "12px 14px", backgroundColor: "#F4F5F7", borderRadius: "3px" }}>
                  <p style={{ margin: 0, marginBottom: "6px", fontSize: "14px", color: "#172B4D", fontWeight: "600" }}>
                    Share Folder
                  </p>
                  <p style={{ margin: 0, fontSize: "13px", color: "#42526E", lineHeight: "20px" }}>
                    Manage folder-level access and permissions for users or teams using the <code style={{ backgroundColor: "#FFFFFF", padding: "2px 4px", borderRadius: "3px", fontSize: "12px" }}>share-folder</code> command. Control permissions for managing records, managing users, sharing capabilities, and editing rights. Supports expiration settings for temporary project access or contractor engagements.
                  </p>
                </div>

                <div style={{ marginBottom: "0", padding: "12px 14px", backgroundColor: "#E3FCEF", borderRadius: "3px", borderLeft: "4px solid #00875A" }}>
                  <p style={{ margin: 0, marginBottom: "6px", fontSize: "14px", color: "#006644", fontWeight: "600" }}>
                    PEDM Management (Administrator Only)
                  </p>
                  <p style={{ margin: 0, fontSize: "13px", color: "#00875A", lineHeight: "20px", marginBottom: "8px" }}>
                    For Global Jira Administrators or Project Administrators, the integration provides advanced Endpoint Privilege Manager capabilities through the dedicated PEDM tab. Monitor and manage privileged access requests across your organization with real-time approval workflows.
                  </p>
                  <p style={{ margin: 0, fontSize: "13px", color: "#00875A", lineHeight: "20px" }}>
                    <strong style={{ fontWeight: "600" }}>Available Commands:</strong> <code style={{ backgroundColor: "#FFFFFF", padding: "2px 4px", borderRadius: "3px", fontSize: "12px" }}>pedm approval list</code> to retrieve pending requests, <code style={{ backgroundColor: "#FFFFFF", padding: "2px 4px", borderRadius: "3px", fontSize: "12px" }}>pedm approval action --approve</code> to grant privilege elevation, and <code style={{ backgroundColor: "#FFFFFF", padding: "2px 4px", borderRadius: "3px", fontSize: "12px" }}>pedm approval action --deny</code> to reject requests. All approvals include live countdown timers, user details, application context, and justification messages for informed decision-making.
                  </p>
                </div>

                <p style={{ color: "#5E6C84", fontSize: "13px", lineHeight: "20px", fontStyle: "italic", marginTop: "16px", marginBottom: "0" }}>
                  Reference: <span onClick={() => router.open("https://docs.keeper.io/en/keeperpam/commander-cli/command-reference")} style={{ color: "#5E6C84", textDecoration: "underline", cursor: "pointer" }}>Commander CLI Command Reference</span> | <span onClick={() => router.open("https://docs.keeper.io/en/keeperpam/commander-cli/command-reference/endpoint-privilege-manager-commands")} style={{ color: "#5E6C84", textDecoration: "underline", cursor: "pointer" }}>PEDM Commands</span>
                </p>
              </div>

              <div style={{ padding: "16px", backgroundColor: "#F4F5F7", borderRadius: "3px", borderLeft: "4px solid #00875A" }}>
                <p style={{ margin: 0, marginBottom: "12px", fontSize: "14px", color: "#172B4D", fontWeight: "600" }}>
                  Documentation & Support
                </p>
                <div style={{ fontSize: "13px", color: "#42526E", lineHeight: "20px" }}>
                  <p style={{ margin: 0, marginBottom: "8px" }}>
                    <strong>Keeper Documentation:</strong>{" "}
                    <span 
                      onClick={() => router.open("https://docs.keeper.io/en/keeperpam/commander-cli/overview")}
                      style={{ color: "#0052CC", textDecoration: "underline", cursor: "pointer" }}
                    >
                      docs.keeper.io
                    </span>
                  </p>
                  <p style={{ margin: 0, marginBottom: "8px" }}>
                    <strong>Forge Platform:</strong>{" "}
                    <span 
                      onClick={() => router.open("https://developer.atlassian.com/platform/forge/")}
                      style={{ color: "#0052CC", textDecoration: "underline", cursor: "pointer" }}
                    >
                      developer.atlassian.com/platform/forge
                    </span>
                  </p>
                  <p style={{ margin: 0 }}>
                    <strong>Technical Support:</strong>{" "}
                    <span 
                      onClick={() => router.open("mailto:commander@keepersecurity.com")}
                      style={{ color: "#0052CC", textDecoration: "underline", cursor: "pointer" }}
                    >
                      commander@keepersecurity.com
                    </span>
                  </p>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
};

export default App; 
