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
import UnlockIcon from "@atlaskit/icon/glyph/unlock";
import LockIcon from "@atlaskit/icon/glyph/lock";
import CopyIcon from "@atlaskit/icon/glyph/copy";

const App = () => {
  const [activeTab, setActiveTab] = useState("config");
  const [formValues, setFormValues] = useState({
    apiUrl: "",
    apiKey: "",
  });
  const [saved, setSaved] = useState(false);
  const [hasExistingConfig, setHasExistingConfig] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [formKey, setFormKey] = useState(0);
  const [isApiKeyMasked, setIsApiKeyMasked] = useState(true);
  const [showCopiedMessage, setShowCopiedMessage] = useState(false);
  const [isTestingConnection, setIsTestingConnection] = useState(false);
  const [connectionTestResult, setConnectionTestResult] = useState(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [isCheckingAdmin, setIsCheckingAdmin] = useState(true);
  const [showExistingConfigMessage, setShowExistingConfigMessage] = useState(false);
  
  // New states for connection testing workflow
  const [originalFormValues, setOriginalFormValues] = useState({ apiUrl: "", apiKey: "" });
  const [hasFormChanges, setHasFormChanges] = useState(false);
  const [connectionTested, setConnectionTested] = useState(false);

  useEffect(() => {
    // Check admin status first
    setIsCheckingAdmin(true);
    invoke("getGlobalUserRole").then((userRole) => {
      setIsAdmin(userRole.isAdmin || false);
      setIsCheckingAdmin(false);
    }).catch((error) => {
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
        // Show the existing configuration message for 3 seconds
        setShowExistingConfigMessage(true);
        setTimeout(() => setShowExistingConfigMessage(false), 3000);
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
      setConnectionTestResult(null);
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
      
      setSaved(true);
      setHasExistingConfig(true);
      setConnectionTested(true); // Mark as tested since we just saved successfully
      setTimeout(() => setSaved(false), 3000);
    } catch (error) {
      // Show user-friendly error
      alert("Failed to save configuration. Please try again.");
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
      setConnectionTestResult({
        success: false,
        message: 'Please enter both API URL and API Key before testing connection'
      });
      return;
    }

    setIsTestingConnection(true);
    setConnectionTestResult(null);

    try {
      const result = await invoke("testConnection", { 
        payload: {
          apiUrl: currentApiUrl,
          apiKey: currentApiKey
        }
      });
      
      setConnectionTestResult({
        success: true,
        message: result.message,
        serviceStatus: result.serviceStatus,
        isServiceRunning: result.isServiceRunning
      });
      setConnectionTested(true); // Mark connection as tested and successful
      
      // Clear the result after 5 seconds
      setTimeout(() => setConnectionTestResult(null), 5000);
      
    } catch (error) {
      
      // Extract more detailed error information
      let errorMessage = 'Connection test failed';
      
      if (error.message) {
        errorMessage = error.message;
      } else if (error.error) {
        errorMessage = error.error;
      } else if (typeof error === 'string') {
        errorMessage = error;
      }
      
      // Add more context for common error scenarios
      if (errorMessage.includes('ERR_NGROK_3200') || errorMessage.includes('ngrok') || errorMessage.includes('offline')) {
        errorMessage = `Ngrok tunnel is offline: ${errorMessage}. Please start your ngrok tunnel and ensure the Keeper Commander service is running.`;
      } else if (errorMessage.includes('fetch')) {
        errorMessage = `Network error: ${errorMessage}. Please check your API URL and ensure the Keeper Commander service is running.`;
      } else if (errorMessage.includes('401') || errorMessage.includes('403')) {
        errorMessage = `Authentication error: ${errorMessage}. Please verify your API key is correct.`;
      } else if (errorMessage.includes('404')) {
        errorMessage = `Service not found: ${errorMessage}. Please check your API URL and ensure the Keeper Commander service is accessible.`;
      } else if (errorMessage.includes('timeout')) {
        errorMessage = `Connection timeout: ${errorMessage}. The service may be slow to respond or unavailable.`;
      } else if (errorMessage.includes('<!DOCTYPE html>') || errorMessage.includes('<html')) {
        errorMessage = `Received HTML response instead of JSON. This usually means the service is not running or the URL is incorrect. Please check your API URL and ensure the Keeper Commander service is running.`;
      }
      
      setConnectionTestResult({
        success: false,
        message: errorMessage
      });
      setConnectionTested(false); // Mark connection test as failed
      
      // Clear the result after 8 seconds for errors (longer than success messages)
      setTimeout(() => setConnectionTestResult(null), 8000);
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
              
              {/* Admin Status Indicator */}
              {!isCheckingAdmin && (
                <div style={{ 
                  marginBottom: "16px", 
                  padding: "12px 16px", 
                  backgroundColor: isAdmin ? "#E3FCEF" : "#DEEBFF",
                  borderRadius: "3px",
                  border: isAdmin ? "1px solid #ABF5D1" : "1px solid #4C9AFF",
                  fontSize: "14px"
                }}>
                  <span style={{ 
                    fontWeight: "600",
                    color: isAdmin ? "#006644" : "#0747A6"
                  }}>
                    {isAdmin ? "✓ Admin Access Granted" : "⚠ Limited Access"}
                  </span>
                </div>
              )}

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
                  {showExistingConfigMessage && (
                    <SectionMessage appearance="information" title="Existing Configuration Loaded">
                      Your previously saved settings are displayed below. You can modify them and click "Update Settings" to save changes.
                    </SectionMessage>
                  )}

                  {saved && (
                    <SectionMessage appearance="confirmation" title="Saved!">
                      Keeper configuration {hasExistingConfig ? 'updated' : 'saved'} successfully.
                    </SectionMessage>
                  )}

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
                      >
                        {isTestingConnection ? "Testing..." : "Test Connection"}
                      </Button>
                    </div>

                    {/* Connection Test Result */}
                    {connectionTestResult && (
                      <div style={{ marginBottom: "20px" }}>
                        <SectionMessage 
                          appearance={connectionTestResult.success ? "confirmation" : "error"}
                          title={connectionTestResult.success ? "Connection Successful!" : "Connection Failed"}
                        >
                          <div>
                            {/* Display the main message */}
                            <p style={{ 
                              fontSize: "14px", 
                              color: connectionTestResult.success ? "#00875A" : "#DE350B", 
                              margin: "4px 0",
                              fontWeight: "500"
                            }}>
                              {connectionTestResult.message}
                            </p>
                            
                            {/* Display additional service status for successful connections */}
                            {connectionTestResult.success && connectionTestResult.isServiceRunning && (
                              <p style={{ fontSize: "12px", color: "#00875A", margin: "4px 0" }}>
                                ✓ Keeper Commander Service is running properly
                              </p>
                            )}
                            
                            {/* Display service status for successful connections that might have warnings */}
                            {connectionTestResult.success && connectionTestResult.serviceStatus && !connectionTestResult.isServiceRunning && (
                              <p style={{ fontSize: "12px", color: "#FF8B00", margin: "4px 0" }}>
                                ⚠ {connectionTestResult.serviceStatus}
                              </p>
                            )}
                          </div>
                        </SectionMessage>
                      </div>
                    )}

                    {/* Only show save/update button if connection is tested successfully */}
                    {connectionTested && (
                      <FormFooter>
                        <Button
                          appearance="primary"
                          type="submit"
                          isLoading={submitting}
                        >
                          {submitting 
                            ? "Saving..." 
                            : hasExistingConfig 
                              ? "Update Settings" 
                              : "Save Settings"
                          }
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
                          ⚠️ Please test the connection first before saving settings.
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
              <h2 style={{ fontWeight: "600", fontSize: "20px", marginBottom: "8px", color: "#172B4D" }}>
                Prerequisites
              </h2>
              <ul style={{ paddingLeft: "20px", color: "#42526E", fontSize: "14px", lineHeight: "20px", marginTop: "16px" }}>
                <li style={{ marginBottom: "12px" }}>
                  Ensure Keeper Commander REST API is running and accessible via your Ngrok tunnel.
                </li>
                <li style={{ marginBottom: "12px" }}>
                  Verify Jira workflow includes the transition "APPROVED".
                </li>
                <li style={{ marginBottom: "12px" }}>
                  <strong style={{ fontWeight: "600", color: "#172B4D" }}>API URL Format:</strong> Enter base URL only (e.g., <code style={{ backgroundColor: "#F4F5F7", padding: "2px 6px", borderRadius: "3px", fontSize: "13px" }}>https://xxxxx.ngrok-free.app</code>). The endpoint <code style={{ backgroundColor: "#F4F5F7", padding: "2px 6px", borderRadius: "3px", fontSize: "13px" }}>/api/v1/executecommand</code> will be automatically appended.
                </li>
              </ul>
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
