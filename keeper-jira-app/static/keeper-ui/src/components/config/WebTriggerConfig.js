/**
 * Web Trigger Configuration Component
 */
import React, { useState, useEffect } from 'react';
import Button from "@atlaskit/button";
import Select from "@atlaskit/select";
import Spinner from "@atlaskit/spinner";
import * as api from '../../services/api';
import { handleApiError } from '../../utils/errorHandler';
import { MESSAGE_TYPES } from '../../constants';
import WebhookTicketsTable from './WebhookTicketsTable';
import '../../styles/WebTriggerConfig.css';

const WebTriggerConfig = ({ statusMessage, setStatusMessage }) => {
  const [webTriggerUrl, setWebTriggerUrl] = useState('');
  const [isLoadingUrl, setIsLoadingUrl] = useState(true);
  const [projects, setProjects] = useState([]);
  const [issueTypes, setIssueTypes] = useState([]);
  const [selectedProject, setSelectedProject] = useState(null);
  const [selectedIssueType, setSelectedIssueType] = useState(null);
  const [isLoadingProjects, setIsLoadingProjects] = useState(false);
  const [isLoadingIssueTypes, setIsLoadingIssueTypes] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isTesting, setIsTesting] = useState(false);
  const [showCopiedMessage, setShowCopiedMessage] = useState(false);
  const [showTicketsTable, setShowTicketsTable] = useState(false);
  
  // Token management state
  const [webhookToken, setWebhookToken] = useState('');
  const [isTokenEnabled, setIsTokenEnabled] = useState(false);
  const [isGeneratingToken, setIsGeneratingToken] = useState(false);
  const [isRevokingToken, setIsRevokingToken] = useState(false);
  const [showToken, setShowToken] = useState(false);
  const [showTokenCopied, setShowTokenCopied] = useState(false);

  // Load web trigger URL and configuration on mount
  useEffect(() => {
    const loadData = async () => {
      let projectOptions = [];
      
      try {
        // Load web trigger URL
        const urlResult = await api.getWebTriggerUrl();
        if (urlResult && urlResult.success && urlResult.url) {
          setWebTriggerUrl(urlResult.url);
        }

        // Load projects
        setIsLoadingProjects(true);
        const projectsResult = await api.getJiraProjects();
        if (projectsResult && projectsResult.success && projectsResult.projects) {
          projectOptions = projectsResult.projects.map(p => ({
            label: `${p.name} (${p.key})`,
            value: p.key,
            key: p.key
          }));
          setProjects(projectOptions);
        }

        // Load saved configuration
        const configResult = await api.getWebTriggerConfig();
        if (configResult && configResult.projectKey && projectOptions.length > 0) {
          // Set selected project
          const savedProject = projectOptions.find(p => p.value === configResult.projectKey);
          if (savedProject) {
            setSelectedProject(savedProject);
            
            // Load issue types for saved project
            await loadIssueTypes(configResult.projectKey, configResult.issueType);
          }
        }
        
        // Check if token is enabled (token exists in config)
        if (configResult && configResult.hasWebhookToken) {
          setIsTokenEnabled(true);
          // Token value is not returned for security - only status
        }
      } catch (error) {
        console.error('Failed to load web trigger data:', error);
        setStatusMessage({
          type: MESSAGE_TYPES.ERROR,
          title: 'Load Failed',
          message: handleApiError(error, 'Failed to load web trigger configuration')
        });
        setTimeout(() => setStatusMessage(null), 8000);
      } finally {
        setIsLoadingUrl(false);
        setIsLoadingProjects(false);
      }
    };

    loadData();
  }, []);

  // Load issue types when project changes
  const loadIssueTypes = async (projectKey, savedIssueType = null) => {
    try {
      setIsLoadingIssueTypes(true);
      const result = await api.getProjectIssueTypes(projectKey);
      if (result && result.success && result.issueTypes) {
        const issueTypeOptions = result.issueTypes.map(it => ({
          label: it.name,
          value: it.name,
          id: it.id
        }));
        setIssueTypes(issueTypeOptions);
        
        // Set saved issue type if provided
        if (savedIssueType) {
          const savedIssueTypeOption = issueTypeOptions.find(it => it.value === savedIssueType);
          if (savedIssueTypeOption) {
            setSelectedIssueType(savedIssueTypeOption);
          }
        }
      }
    } catch (error) {
      console.error('Failed to load issue types:', error);
    } finally {
      setIsLoadingIssueTypes(false);
    }
  };

  // Handle project change
  const handleProjectChange = (option) => {
    setSelectedProject(option);
    setSelectedIssueType(null);
    setIssueTypes([]);
    if (option && option.value) {
      loadIssueTypes(option.value);
    }
  };

  // Handle issue type change
  const handleIssueTypeChange = (option) => {
    setSelectedIssueType(option);
  };

  // Copy URL to clipboard
  const copyUrl = async () => {
    try {
      await navigator.clipboard.writeText(webTriggerUrl);
      setShowCopiedMessage(true);
      setTimeout(() => setShowCopiedMessage(false), 2000);
    } catch (err) {
      console.error('Failed to copy URL:', err);
    }
  };

  // Test web trigger
  const handleTestWebTrigger = async () => {
    if (!selectedProject || !selectedIssueType) {
      setStatusMessage({
        type: MESSAGE_TYPES.WARNING,
        title: 'Missing Information',
        message: 'Please select both project and issue type before testing'
      });
      setTimeout(() => setStatusMessage(null), 5000);
      return;
    }

    setIsTesting(true);
    setStatusMessage({
      type: MESSAGE_TYPES.INFO,
      title: 'Testing Web Trigger...',
      message: 'Sending test alert to create Jira ticket via webhook'
    });

    try {
      // Create test payload similar to what Keeper Security would send
      const testPayload = {
        alert_name: 'Test EPM Approval Request',
        description: `Test approval request created from Keeper Security ITSM admin interface at ${new Date().toLocaleString()}`,
        audit_event: 'approval_request_created',
        remote_address: '192.168.1.100',
        timestamp: new Date().toISOString(),
        category: 'endpoint_privilege_manager',
        client_version: 'Server.0.0.0',
        username: 'EPM Test Agent',
        agent_uid: `test_agent_${Date.now()}`,
        request_uid: `test_req_${Date.now()}`,
        severity: 'medium',
        details: {
          test: true,
          configured_project: selectedProject.value,
          configured_issue_type: selectedIssueType.value,
          test_timestamp: new Date().toISOString()
        }
      };

      const result = await api.testWebTriggerWithPayload(testPayload);
      
      if (result && result.success) {
        setStatusMessage({
          type: MESSAGE_TYPES.SUCCESS,
          title: 'Web Trigger Test Successful!',
          message: `Test ticket created successfully! Issue Key: ${result.issueKey || 'Check your Jira project'}. The ticket has been labeled with "keeper-webhook-test" for easy identification.`
        });
        setTimeout(() => setStatusMessage(null), 8000);
      } else {
        setStatusMessage({
          type: MESSAGE_TYPES.ERROR,
          title: 'Web Trigger Test Failed',
          message: result?.error || 'Unknown error occurred during test'
        });
        setTimeout(() => setStatusMessage(null), 8000);
      }
    } catch (error) {
      console.error('Test web trigger error:', error);
      const errorMessage = handleApiError(error, 'Failed to test web trigger');
      setStatusMessage({
        type: MESSAGE_TYPES.ERROR,
        title: 'Test Failed',
        message: errorMessage
      });
      setTimeout(() => setStatusMessage(null), 8000);
    } finally {
      setIsTesting(false);
    }
  };

  // Generate webhook token
  const handleGenerateToken = async () => {
    setIsGeneratingToken(true);
    try {
      const result = await api.generateWebhookToken();
      if (result && result.success) {
        setWebhookToken(result.bearerToken);
        setIsTokenEnabled(true);
        setShowToken(true); // Show token immediately after generation
        setStatusMessage({
          type: MESSAGE_TYPES.SUCCESS,
          title: 'Token Generated!',
          message: 'Webhook authentication token generated. Copy this token now - it will only be shown once. Use it in the Authorization header: Bearer <token>'
        });
        setTimeout(() => setStatusMessage(null), 10000);
      } else {
        setStatusMessage({
          type: MESSAGE_TYPES.ERROR,
          title: 'Token Generation Failed',
          message: result?.error || 'Failed to generate webhook token'
        });
        setTimeout(() => setStatusMessage(null), 8000);
      }
    } catch (error) {
      const errorMessage = handleApiError(error, 'Failed to generate token');
      setStatusMessage({
        type: MESSAGE_TYPES.ERROR,
        title: 'Token Generation Failed',
        message: errorMessage
      });
      setTimeout(() => setStatusMessage(null), 8000);
    } finally {
      setIsGeneratingToken(false);
    }
  };

  // Revoke webhook token
  const handleRevokeToken = async () => {
    if (!window.confirm('Are you sure you want to revoke the webhook token? This will disable token authentication and require generating a new token.')) {
      return;
    }
    
    setIsRevokingToken(true);
    try {
      const result = await api.revokeWebhookToken();
      if (result && result.success) {
        setWebhookToken('');
        setIsTokenEnabled(false);
        setShowToken(false);
        setStatusMessage({
          type: MESSAGE_TYPES.SUCCESS,
          title: 'Token Revoked',
          message: 'Webhook authentication token has been revoked. Token authentication is now disabled.'
        });
        setTimeout(() => setStatusMessage(null), 5000);
      } else {
        setStatusMessage({
          type: MESSAGE_TYPES.ERROR,
          title: 'Revoke Failed',
          message: result?.error || 'Failed to revoke webhook token'
        });
        setTimeout(() => setStatusMessage(null), 8000);
      }
    } catch (error) {
      const errorMessage = handleApiError(error, 'Failed to revoke token');
      setStatusMessage({
        type: MESSAGE_TYPES.ERROR,
        title: 'Revoke Failed',
        message: errorMessage
      });
      setTimeout(() => setStatusMessage(null), 8000);
    } finally {
      setIsRevokingToken(false);
    }
  };

  // Copy token to clipboard
  const copyToken = async () => {
    if (!webhookToken) return;
    try {
      await navigator.clipboard.writeText(webhookToken);
      setShowTokenCopied(true);
      setTimeout(() => setShowTokenCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy token:', err);
    }
  };

  // Save configuration
  const handleSaveConfiguration = async () => {
    if (!selectedProject || !selectedIssueType) {
      setStatusMessage({
        type: MESSAGE_TYPES.WARNING,
        title: 'Missing Information',
        message: 'Please select both project and issue type before saving'
      });
      setTimeout(() => setStatusMessage(null), 5000);
      return;
    }

    setIsSaving(true);
    try {
      const result = await api.saveWebTriggerConfig({
        projectKey: selectedProject.value,
        issueType: selectedIssueType.value
      });

      if (result && result.success) {
        setStatusMessage({
          type: MESSAGE_TYPES.SUCCESS,
          title: 'Configuration Saved!',
          message: 'Web trigger configuration saved successfully.'
        });
        setTimeout(() => setStatusMessage(null), 5000);
      }
    } catch (error) {
      const errorMessage = handleApiError(error, 'Failed to save configuration');
      setStatusMessage({
        type: MESSAGE_TYPES.ERROR,
        title: 'Save Failed',
        message: errorMessage
      });
      setTimeout(() => setStatusMessage(null), 8000);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="web-trigger-config-container">
      <h3 className="web-trigger-section-title">
        Web Trigger Configuration
      </h3>

      {/* Web Trigger URL Section */}
      <div className="web-trigger-url-section">
        <div className="web-trigger-url-header">
          <div className="web-trigger-url-label">
            Web Trigger URL
          </div>
          <div className="web-trigger-url-description">
            Use this URL in your Keeper Security configuration to send alerts to Jira:
          </div>
        </div>

        <div className="web-trigger-url-container">
          {isLoadingUrl ? (
            <div className="web-trigger-url-loading">
              <Spinner size="medium" />
              <span>Loading URL...</span>
            </div>
          ) : (
            <>
              <div className="web-trigger-url-display">
                {webTriggerUrl || 'URL not available'}
              </div>
              <div className="web-trigger-url-actions">
                <button
                  onClick={copyUrl}
                  className={`web-trigger-url-button ${showCopiedMessage ? 'copied' : ''}`}
                  disabled={!webTriggerUrl}
                >
                  {showCopiedMessage ? 'Copied!' : 'Copy URL'}
                </button>
                <button
                  onClick={handleTestWebTrigger}
                  className="web-trigger-test-button"
                  disabled={!selectedProject || !selectedIssueType || isTesting}
                >
                  {isTesting ? 'Testing...' : 'Test Web Trigger'}
                </button>
                <button
                  onClick={() => setShowTicketsTable(true)}
                  className="web-trigger-view-tickets-button"
                  disabled={!selectedProject}
                >
                  View Created Tickets
                </button>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Webhook Authentication Token Section */}
      <div className="web-trigger-token-section">
        <div className="web-trigger-token-header">
          <div className="web-trigger-token-label">
            Webhook Authentication Token
          </div>
          <div className="web-trigger-token-description">
            Secure your webhook endpoint with Bearer token authentication. Include the token in requests using the <code>Authorization: Bearer &lt;token&gt;</code> header.
          </div>
        </div>

        <div className="web-trigger-token-container">
          <div className="web-trigger-token-status">
            <span className={`token-status-badge ${isTokenEnabled ? 'enabled' : 'disabled'}`}>
              {isTokenEnabled ? 'Token Enabled' : 'Token Not Configured'}
            </span>
          </div>

          {/* Show token value if just generated */}
          {webhookToken && (
            <div className="web-trigger-token-value-section">
              <div className="web-trigger-token-warning">
                <span className="warning-icon">Warning:</span>
                <span>Copy this token now - it won't be shown again!</span>
              </div>
              <div className="web-trigger-token-display">
                <code className="token-value">
                  {showToken ? webhookToken : '••••••••••••••••••••••••••••••••'}
                </code>
                <div className="token-actions">
                  <button
                    type="button"
                    onClick={() => setShowToken(!showToken)}
                    className="token-action-button"
                  >
                    {showToken ? 'Hide' : 'Show'}
                  </button>
                  <button
                    type="button"
                    onClick={copyToken}
                    className={`token-action-button ${showTokenCopied ? 'copied' : ''}`}
                  >
                    {showTokenCopied ? 'Copied!' : 'Copy'}
                  </button>
                </div>
              </div>
            </div>
          )}

          <div className="web-trigger-token-actions">
            <button
              onClick={handleGenerateToken}
              className="web-trigger-generate-token-button"
              disabled={isGeneratingToken}
            >
              {isGeneratingToken ? 'Generating...' : (isTokenEnabled ? 'Regenerate Token' : 'Generate Token')}
            </button>
            {isTokenEnabled && (
              <button
                onClick={handleRevokeToken}
                className="web-trigger-revoke-token-button"
                disabled={isRevokingToken}
              >
                {isRevokingToken ? 'Revoking...' : 'Revoke Token'}
              </button>
            )}
          </div>

          {!isTokenEnabled && (
            <div className="web-trigger-token-info">
              <span className="info-icon">Note:</span>
              <span>Without token authentication, any system with your webhook URL can create tickets. Generate a token for enhanced security.</span>
            </div>
          )}
        </div>
      </div>

      {/* Target Project Configuration Section */}
      <div className="web-trigger-project-section">
        <div className="web-trigger-project-header">
          <div className="web-trigger-project-label">
            Target Project Configuration
          </div>
          <div className="web-trigger-project-description">
            Select the Jira project where Keeper Security alerts will create tickets:
          </div>
        </div>

        <div className="web-trigger-form">
          {/* Project Selector */}
          <div className="web-trigger-form-field">
            <label className="web-trigger-field-label">
              Project
            </label>
            <Select
              className="web-trigger-select"
              classNamePrefix="react-select"
              options={projects}
              value={selectedProject}
              onChange={handleProjectChange}
              isLoading={isLoadingProjects}
              isDisabled={isLoadingProjects}
              placeholder="Select a project..."
              menuPortalTarget={document.body}
              styles={{ menuPortal: base => ({ ...base, zIndex: 99999 }) }}
              isSearchable={true}
              isClearable={true}
              noOptionsMessage={() => "No projects found"}
              loadingMessage={() => "Loading projects..."}
              maxMenuHeight={300}
            />
          </div>

          {/* Issue Type Selector */}
          <div className="web-trigger-form-field">
            <label className="web-trigger-field-label">
              Default Issue Type
            </label>
            <div className="web-trigger-issue-type-description">
              Select the default issue type for all Keeper alerts (Epic, Story, Task, Bug, etc.)
            </div>
            <Select
              className="web-trigger-select"
              classNamePrefix="react-select"
              options={issueTypes}
              value={selectedIssueType}
              onChange={handleIssueTypeChange}
              isLoading={isLoadingIssueTypes}
              isDisabled={!selectedProject || isLoadingIssueTypes}
              placeholder="Select an issue type..."
              menuPortalTarget={document.body}
              styles={{ menuPortal: base => ({ ...base, zIndex: 99999 }) }}
              isSearchable={true}
              isClearable={true}
              noOptionsMessage={() => "No issue types found"}
              loadingMessage={() => "Loading issue types..."}
              maxMenuHeight={300}
            />
          </div>

          {/* Save Button */}
          <div className="web-trigger-save-section">
            <Button
              appearance="primary"
              onClick={handleSaveConfiguration}
              isLoading={isSaving}
              isDisabled={!selectedProject || !selectedIssueType || isSaving}
            >
              {isSaving ? 'Saving...' : 'Save Configuration'}
            </Button>
          </div>

          {/* Configuration Display */}
          {selectedProject && selectedIssueType && (
            <div className="web-trigger-config-display">
              Configuration: <strong>{selectedProject.key}</strong> → <strong>{selectedIssueType.value}</strong>
            </div>
          )}
        </div>
      </div>

      {/* Webhook Tickets Table Modal */}
      <WebhookTicketsTable
        visible={showTicketsTable}
        onClose={() => setShowTicketsTable(false)}
      />
    </div>
  );
};

export default WebTriggerConfig;

