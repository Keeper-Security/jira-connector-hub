/**
 * Configuration form component
 */
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

