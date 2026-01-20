/**
 * Configuration tab component
 */
import React from 'react';
import SectionMessage from "@atlaskit/section-message";
import Loading from '../common/Loading';
import StatusMessage from '../common/StatusMessage';
import ConfigForm from './ConfigForm';
import '../../styles/ConfigTab.css';

const ConfigTab = ({
  isCheckingAdmin,
  isAdmin,
  isLoading,
  statusMessage,
  setStatusMessage,
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
  handleClearForm,
  copyApiKey
}) => {
  return (
    <>
      <h2 className="config-tab-title">
        Configuration
      </h2>
      <p className="config-tab-subtitle">
        Configure Keeper integration details. All fields are required. The integration will work with any Jira project.
      </p>
      
      {isCheckingAdmin ? (
        <Loading message="Checking admin permissions..." />
      ) : !isAdmin ? (
        <div className="config-tab-admin-check">
          <SectionMessage appearance="warning" title="Access Restricted">
            <p className="config-tab-section-message">
              Only Jira Administrators or Project Administrators can access the configuration page. 
              Please contact your Jira administrator if you need to modify Keeper settings.
            </p>
          </SectionMessage>
        </div>
      ) : (
        <>
          <StatusMessage 
            message={statusMessage} 
            onDismiss={() => setStatusMessage(null)} 
          />

          {isLoading ? (
            <Loading message="Loading configuration..." />
          ) : (
            <ConfigForm
              formValues={formValues}
              setFormValues={setFormValues}
              formKey={formKey}
              isApiKeyMasked={isApiKeyMasked}
              setIsApiKeyMasked={setIsApiKeyMasked}
              showCopiedMessage={showCopiedMessage}
              isTestingConnection={isTestingConnection}
              hasFormChanges={hasFormChanges}
              connectionTested={connectionTested}
              handleSubmit={handleSubmit}
              handleTestConnection={handleTestConnection}
              handleClearForm={handleClearForm}
              copyApiKey={copyApiKey}
            />
          )}
        </>
      )}
    </>
  );
};

export default ConfigTab;

