/**
 * Configuration form component
 *
 * Pre-publication review: See PR #3 for security findings (Issues #5, #12)
 */
// TODO: PR #3 Issue #12 - Error Handling Pattern (Suggested Improvement)
// When invoke() calls fail in parent components (useConfig.js, api.js), errors are currently
// thrown by resolvers, resulting in "There was an error invoking the function -" prefix.
// Consider having backend return structured error objects { success: false, error: 'CODE', message: '...' }
// and updating frontend to check result.success instead of using try-catch.
// This provides better UX control over error messages.
import React from 'react';
import { router } from "@forge/bridge";
import TextField from "@atlaskit/textfield";
import Button from "@atlaskit/button";
import Form, { Field, FormFooter } from "@atlaskit/form";
import '../../styles/ConfigForm.css';

const ConfigForm = ({
  formValues,
  setFormValues,
  formKey,
  isApiKeyMasked,
  setIsApiKeyMasked,
  showCopiedMessage,
  isTestingConnection,
  hasFormChanges,
  connectionTested,
  handleSubmit,
  handleTestConnection,
  copyApiKey
}) => {
  const renderLabel = (text) => (
    <span className="config-form-label">{text}</span>
  );

  const toggleApiKeyMask = () => {
    setIsApiKeyMasked(prev => !prev);
  };

  return (
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
                  placeholder="https://your-domain.com/api/v2"
                />
                <div className="config-form-helper-text">
                  Enter the complete API v2 URL of your Keeper Commander Service including the <code>/api/v2</code> path (e.g., <code>https://your-tunnel.ngrok.io/api/v2</code> or <code>https://keeper.your-domain.com/api/v2</code>). 
                  Requires Commander 17.1.7+ with queue enabled (<code>-q y</code>).{' '}
                  <span 
                    onClick={() => router.open("https://docs.keeper.io/en/keeperpam/commander-cli/service-mode-rest-api/api-usage")} 
                    className="text-link text-link-spaced"
                  >
                    API v2 Documentation
                  </span>
                </div>
                {error && (
                  <div className="config-form-error">
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
                <div className="api-key-field-wrapper">
                  {/* TODO: PR #3 Issue #5 - API Key Exposure
                      Masking is implemented, but verify isApiKeyMasked defaults to true.
                      Also need warning message when key is visible (e.g., "WARNING: API Key visible - do not screenshot").
                      Additionally, sanitize API keys from error messages in keeperApi.js parseKeeperErrorMessage(). */}
                  <TextField
                    {...fieldProps}
                    value={formValues.apiKey}
                    onChange={(e) => setFormValues(prev => ({ ...prev, apiKey: e.target.value }))}
                    type={isApiKeyMasked ? "password" : "text"}
                    placeholder="Enter your Keeper API key"
                    className="api-key-field-input"
                  />
                  <div className="api-key-field-actions">
                    <button
                      type="button"
                      onClick={toggleApiKeyMask}
                      className="api-key-action-button"
                      title={isApiKeyMasked ? "Show API Key" : "Hide API Key"}
                    >
                      {isApiKeyMasked ? "Show" : "Hide"}
                    </button>
                    <button
                      type="button"
                      onClick={copyApiKey}
                      className={`api-key-action-button ${showCopiedMessage ? 'copied' : ''}`}
                      title={showCopiedMessage ? "Copied!" : "Copy API Key"}
                      disabled={!formValues.apiKey}
                    >
                      {showCopiedMessage ? "Copied!" : "Copy"}
                    </button>
                  </div>
                </div>
                {error && (
                  <div className="config-form-error">
                    {error}
                  </div>
                )}
              </>
            )}
          </Field>

          {/* Test Connection Button */}
          <div className="test-connection-container">
            <Button
              onClick={handleTestConnection}
              isLoading={isTestingConnection}
              appearance="default"
              className="test-connection-button"
            >
              {isTestingConnection ? "Testing..." : "Test Connection"}
            </Button>
          </div>

          {/* Save button - only show if connection is tested successfully */}
          {connectionTested && (
            <FormFooter>
              <Button
                appearance="primary"
                type="submit"
                isLoading={submitting}
                className="save-button"
              >
                {submitting ? "Saving..." : "Save Settings"}
              </Button>
            </FormFooter>
          )}
          
          {/* Setup instructions when form is empty */}
          {(!formValues.apiUrl.trim() || !formValues.apiKey.trim()) && (
            <div className="setup-instructions">
              <div className="setup-instructions-title">
                📋 Setup Instructions:
              </div>
              <div className="setup-instructions-content">
                1. Fill in the API URL and API Key fields above<br/>
                2. Click "Test Connection" to verify your settings<br/>
                3. Once successful, the Save/Update button will appear
              </div>
            </div>
          )}
          
          {/* Warning when connection test is required */}
          {hasFormChanges && !connectionTested && formValues.apiUrl.trim() && formValues.apiKey.trim() && (
            <div className="config-warning">
              <span className="config-warning-text">
                ⚠️ Please test the connection before saving settings.
              </span>
            </div>
          )}
        </form>
      )}
    </Form>
  );
};

export default ConfigForm;

