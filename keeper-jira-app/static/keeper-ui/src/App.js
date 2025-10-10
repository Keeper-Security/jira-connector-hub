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
        fontFamily: "Inter, Arial, sans-serif",
        fontWeight: 500,
        fontSize: "14px",
        color: "#4B4B4B",
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

  const inputStyle = {
    width: "60%",
    padding: "12px",
    marginTop: "6px",
    marginBottom: "24px",
    borderRadius: "8px",
    border: "1px solid #E0E0E0",
    outline: "none",
    fontSize: "14px",
    color: "#1A1A1A",
    transition: "border-color 0.3s",
  };

    const buttonWrapperStyle = {
      display: "flex",
      justifyContent: "center",
      alignItems: "center",
      width: "100%",
      marginTop: "20px",
    };

  return (
    <div
      style={{
        fontFamily: "Inter, Arial, sans-serif",
        backgroundColor: "#F7F7FA",
        minHeight: "100vh",
        padding: "40px",
      }}
    >
      <div
        style={{
          borderRadius: "16px",
          backgroundColor: "#FFFFFF",
          boxShadow: "0 4px 20px rgba(0,0,0,0.08)",
          overflow: "hidden",
        }}
      >
        {/* Horizontal Tabs */}
        <div
          style={{
            display: "flex",
            borderBottom: "2px solid #E0E0E0",
            backgroundColor: "#F9F9FB",
          }}
        >
          {tabs.map((tab) => (
            <div
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              style={{
                flex: 1,
                textAlign: "center",
                padding: "14px 0",
                cursor: "pointer",
                fontWeight: activeTab === tab.key ? 600 : 400,
                color: activeTab === tab.key ? "#FFD700" : "#4B4B4B",
                borderBottom:
                  activeTab === tab.key ? "3px solid #FFD700" : "3px solid transparent",
                transition: "all 0.3s",
                display: "flex",
                justifyContent: "center",
                alignItems: "center",
                gap: "6px",
                backgroundColor: activeTab === tab.key ? "#FFFFFF" : "transparent",
              }}
            >
              {tab.icon}
              <span>{tab.label}</span>
            </div>
          ))}
        </div>

        {/* Tab Panel */}
        <div style={{ padding: "30px" }}>
          {activeTab === "config" && (
            <>
              <h2 style={{ fontWeight: "700", marginBottom: "12px", color: "#1A1A1A" }}>
                Configuration
              </h2>
              <p style={{ color: "#4B4B4B", marginBottom: "24px" }}>
                Configure Keeper integration details. All fields are required. The integration will work with any Jira project.
              </p>
              
              {/* Admin Status Indicator */}
              {!isCheckingAdmin && (
                <div style={{ 
                  marginBottom: "16px", 
                  padding: "8px 12px", 
                  backgroundColor: isAdmin ? "#E3FCEF" : "#F0F8FF",
                  borderRadius: "4px",
                  border: isAdmin ? "1px solid #ABF5D1" : "1px solid #B3D8FF"
                }}>
                  <span style={{ 
                    fontSize: "12px", 
                    fontWeight: "600",
                    color: isAdmin ? "#006644" : "#0066CC"
                  }}>
                    {isAdmin ? "✓ Admin Access Granted" : "⚠ Limited Access"}
                  </span>
                </div>
              )}

              {isCheckingAdmin ? (
                <div style={{ textAlign: "center", padding: "20px" }}>
                  <p>Checking admin permissions...</p>
                </div>
              ) : !isAdmin ? (
                <div style={{ textAlign: "center", padding: "20px" }}>
                  <SectionMessage appearance="warning" title="Access Restricted">
                    <p style={{ margin: "8px 0", color: "#4B4B4B" }}>
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
                <div style={{ textAlign: "center", padding: "20px" }}>
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
                    <div style={{ marginTop: "20px", marginBottom: "20px" }}>
                      <Button
                        onClick={testConnection}
                        isLoading={isTestingConnection}
                        appearance="default"
                        style={{
                          padding: "12px 24px",
                          borderRadius: "8px",
                          backgroundColor: "#F4F5F7",
                          color: "#1A1A1A",
                          fontSize: "14px",
                          fontWeight: "500",
                          border: "1px solid #E0E0E0",
                          transition: "all 0.3s",
                        }}
                        onMouseEnter={(e) => {
                          if (!isTestingConnection) {
                            e.target.style.backgroundColor = "#E8E9EB";
                            e.target.style.borderColor = "#C1C7D0";
                          }
                        }}
                        onMouseLeave={(e) => {
                          if (!isTestingConnection) {
                            e.target.style.backgroundColor = "#F4F5F7";
                            e.target.style.borderColor = "#E0E0E0";
                          }
                        }}
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
                        <div style={buttonWrapperStyle}>
                          <Button
                            appearance="primary"
                            type="submit"
                            isLoading={submitting}
                            style={{
                              width: "30%",
                              padding: "14px",
                              borderRadius: "8px",
                              backgroundColor: submitting ? "#FFC700" : "#FFD700",
                              color: "#1A1A1A",
                              fontSize: "16px",
                              fontWeight: "600",
                              transition: "background-color 0.3s",
                            }}
                            onMouseEnter={(e) => {
                              if (!submitting) e.target.style.backgroundColor = "#FFC700";
                            }}
                            onMouseLeave={(e) => {
                              if (!submitting) e.target.style.backgroundColor = "#FFD700";
                            }}
                          >
                            {submitting 
                              ? "Saving..." 
                              : hasExistingConfig 
                                ? "Update Settings" 
                                : "Save Settings"
                            }
                          </Button>
                        </div>
                      </FormFooter>
                    )}
                    
                    {/* Show instructions when form is empty or connection test is required */}
                    {(!formValues.apiUrl.trim() || !formValues.apiKey.trim()) && (
                      <div style={{ 
                        marginTop: "20px", 
                        padding: "16px", 
                        backgroundColor: "#E3F2FD", 
                        border: "1px solid #2196F3", 
                        borderRadius: "6px",
                        textAlign: "center"
                      }}>
                        <div style={{ 
                          fontSize: "14px", 
                          color: "#1976D2",
                          fontWeight: "500",
                          marginBottom: "8px"
                        }}>
                          📋 Setup Instructions:
                        </div>
                        <div style={{ 
                          fontSize: "13px", 
                          color: "#1565C0",
                          lineHeight: "1.4"
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
                        marginTop: "20px", 
                        padding: "12px", 
                        backgroundColor: "#FFF4E5", 
                        border: "1px solid #FFD700", 
                        borderRadius: "6px",
                        textAlign: "center"
                      }}>
                        <span style={{ 
                          fontSize: "14px", 
                          color: "#B8860B",
                          fontWeight: "500"
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
              <h2 style={{ fontWeight: "700", marginBottom: "16px", color: "#1A1A1A" }}>
                Prerequisites
              </h2>
              <ul style={{ paddingLeft: "20px", color: "#4B4B4B" }}>
                <li>
                  • Ensure Keeper Commander REST API is running and accessible via your Ngrok tunnel.
                </li>
                <li>
                  • Verify Jira workflow includes the transition "APPROVED".
                </li>
                <li>
                  <strong>API URL Format:</strong> Enter base URL only (e.g., <code>https://xxxxx.ngrok-free.app</code>). The endpoint <code>/api/v1/executecommand</code> will be automatically appended.
                </li>
              </ul>
            </>
          )}

          {activeTab === "about" && (
            <>
              <h2 style={{ fontWeight: "700", marginBottom: "16px", color: "#1A1A1A" }}>
                About
              </h2>
              <p style={{ color: "#4B4B4B", marginBottom: "8px" }}>
                This app integrates Jira with Keeper Security to automate record creation, credential rotation, and more.
              </p>
              <p style={{ color: "#6B778C" }}>
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
