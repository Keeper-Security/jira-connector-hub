import React, { useState, useEffect } from "react";
import { invoke } from "@forge/bridge";

import TextField from "@atlaskit/textfield";
import Button from "@atlaskit/button";
import Form, { Field, FormFooter } from "@atlaskit/form";
import SectionMessage from "@atlaskit/section-message";

// Icons
import SettingsIcon from "@atlaskit/icon/glyph/settings";
import InfoIcon from "@atlaskit/icon/glyph/info";
import BookIcon from "@atlaskit/icon/glyph/book";

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

  const tabs = [
    { key: "config", label: "Configuration", icon: <SettingsIcon size="medium" label="" /> },
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
                      Only administrators can access the configuration page. 
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
                This Jira integration leverages <a href="https://docs.keeper.io/en/keeperpam/commander-cli/overview" target="_blank" rel="noopener noreferrer" style={{ color: "#0052CC", textDecoration: "none", fontWeight: "500" }}>Keeper Commander CLI</a> running in Service Mode to provide a REST API interface for vault operations. The following guide covers both Jira-side and Keeper-side requirements to enable seamless communication between Jira Cloud and your Keeper vault.
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
                  Reference: <a href="https://support.atlassian.com/jira-cloud-administration/docs/manage-project-permissions/" target="_blank" rel="noopener noreferrer" style={{ color: "#5E6C84", textDecoration: "underline" }}>Jira Cloud Project Permissions</a> | <a href="https://developer.atlassian.com/platform/forge/manifest-reference/permissions/" target="_blank" rel="noopener noreferrer" style={{ color: "#5E6C84", textDecoration: "underline" }}>Forge App Permissions</a>
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
                  The recommended installation method is via Docker, which provides a containerized environment with all necessary dependencies pre-configured. Alternatively, you can install Commander CLI using Python for environments where Docker is not available. Visit the <a href="https://docs.keeper.io/en/keeperpam/commander-cli/installation-and-setup" target="_blank" rel="noopener noreferrer" style={{ color: "#0052CC", textDecoration: "none", fontWeight: "500" }}>Installation and Setup documentation</a> for detailed installation instructions for your platform.
                </p>
                <p style={{ color: "#5E6C84", fontSize: "13px", lineHeight: "20px", fontStyle: "italic", margin: "0" }}>
                  Reference: <a href="https://docs.keeper.io/en/keeperpam/commander-cli/overview" target="_blank" rel="noopener noreferrer" style={{ color: "#5E6C84", textDecoration: "underline" }}>Keeper Commander Overview</a>
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
                  <strong style={{ fontWeight: "600", color: "#172B4D" }}>Ngrok</strong> is a popular tunneling solution offering both free and paid plans. It provides instant public URLs with automatic HTTPS encryption. The free tier is suitable for development and testing, while paid plans offer additional features like custom domains and increased bandwidth. Visit <a href="https://ngrok.com/" target="_blank" rel="noopener noreferrer" style={{ color: "#0052CC", textDecoration: "none", fontWeight: "500" }}>ngrok.com</a> to get started and obtain your authentication token.
                </p>
                <p style={{ color: "#42526E", fontSize: "14px", lineHeight: "22px", marginBottom: "12px" }}>
                  <strong style={{ fontWeight: "600", color: "#172B4D" }}>Cloudflare Tunnel</strong> is an enterprise-grade alternative that provides secure, reliable tunneling through Cloudflare's global network. It offers enhanced security features and is particularly well-suited for production deployments. Learn more at <a href="https://www.cloudflare.com/products/tunnel/" target="_blank" rel="noopener noreferrer" style={{ color: "#0052CC", textDecoration: "none", fontWeight: "500" }}>Cloudflare Tunnel documentation</a> to obtain your tunnel token.
                </p>
                <p style={{ color: "#42526E", fontSize: "14px", lineHeight: "22px", marginBottom: "0" }}>
                  Once your tunnel is established, you'll receive a public URL (e.g., <code style={{ backgroundColor: "#F4F5F7", padding: "2px 6px", borderRadius: "3px", fontSize: "13px" }}>https://xxxxx.ngrok-free.app</code>). Enter only the base tunnel URL in the Configuration tab—the integration will automatically append the required <code style={{ backgroundColor: "#F4F5F7", padding: "2px 6px", borderRadius: "3px", fontSize: "13px" }}>/api/v1/executecommand</code> endpoint path.
                </p>
                <p style={{ color: "#5E6C84", fontSize: "13px", lineHeight: "20px", fontStyle: "italic", marginTop: "12px", marginBottom: "0" }}>
                  Reference: <a href="https://docs.keeper.io/en/keeperpam/commander-cli/service-mode-rest-api#create-service-mode-using-tunneling" target="_blank" rel="noopener noreferrer" style={{ color: "#5E6C84", textDecoration: "underline" }}>Creating Service Mode with Tunneling</a>
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
                          <code style={{ backgroundColor: "#FFFFFF", padding: "2px 6px", borderRadius: "3px", fontSize: "12px", wordBreak: "break-all" }}>record-add, list, ls, get, record-type-info, record-update, share-record, share-folder, rti, record-permission, pam, service-status</code>
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
                  Reference: <a href="https://docs.keeper.io/en/keeperpam/commander-cli/service-mode-rest-api" target="_blank" rel="noopener noreferrer" style={{ color: "#5E6C84", textDecoration: "underline" }}>Service Mode REST API Documentation</a>
                </p>
              </div>

              <div style={{ marginBottom: "24px" }}>
                <h3 style={{ fontWeight: "600", fontSize: "16px", marginTop: "0", marginBottom: "12px", color: "#172B4D" }}>
                  5. Integration Capabilities
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

                <div style={{ marginBottom: "0", padding: "12px 14px", backgroundColor: "#F4F5F7", borderRadius: "3px" }}>
                  <p style={{ margin: 0, marginBottom: "6px", fontSize: "14px", color: "#172B4D", fontWeight: "600" }}>
                    Share Folder
                  </p>
                  <p style={{ margin: 0, fontSize: "13px", color: "#42526E", lineHeight: "20px" }}>
                    Manage folder-level access and permissions for users or teams using the <code style={{ backgroundColor: "#FFFFFF", padding: "2px 4px", borderRadius: "3px", fontSize: "12px" }}>share-folder</code> command. Control permissions for managing records, managing users, sharing capabilities, and editing rights. Supports expiration settings for temporary project access or contractor engagements.
                  </p>
                </div>

                <p style={{ color: "#5E6C84", fontSize: "13px", lineHeight: "20px", fontStyle: "italic", marginTop: "16px", marginBottom: "0" }}>
                  Reference: <a href="https://docs.keeper.io/en/keeperpam/commander-cli/command-reference" target="_blank" rel="noopener noreferrer" style={{ color: "#5E6C84", textDecoration: "underline" }}>Commander CLI Command Reference</a>
                </p>
              </div>

              <div style={{ marginTop: "32px", padding: "14px 16px", backgroundColor: "#E3FCEF", borderLeft: "4px solid #00875A", borderRadius: "3px" }}>
                <p style={{ margin: 0, fontSize: "14px", color: "#006644", lineHeight: "22px" }}>
                  <strong style={{ fontWeight: "600" }}>Need Additional Help?</strong> For comprehensive setup instructions, troubleshooting guides, and advanced configuration options, visit the official Keeper documentation at <a href="https://docs.keeper.io/en/keeperpam/commander-cli/overview" target="_blank" rel="noopener noreferrer" style={{ color: "#006644", textDecoration: "underline", fontWeight: "500" }}>docs.keeper.io</a>. For technical support, contact <a href="mailto:commander@keepersecurity.com" style={{ color: "#006644", textDecoration: "underline", fontWeight: "500" }}>commander@keepersecurity.com</a>.
                </p>
              </div>
            </>
          )}

          {activeTab === "about" && (
            <>
              <h2 style={{ fontWeight: "600", fontSize: "20px", marginBottom: "8px", color: "#172B4D" }}>
                About
              </h2>
              <p style={{ color: "#42526E", fontSize: "14px", lineHeight: "20px", marginBottom: "12px", marginTop: "16px" }}>
                This app integrates Jira with Keeper Security to automate record creation, credential rotation, and more.
              </p>
              <p style={{ color: "#5E6C84", fontSize: "14px", lineHeight: "20px" }}>
                Built with Atlassian Forge Custom UI + Atlaskit components.
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  );
};

export default App;
