import React, { useState, useEffect } from "react";
import { router } from "@forge/bridge";

// Modular components
import { TabBar, ConfigTab, WebTriggerConfig } from "./components";
import SectionMessage from "@atlaskit/section-message";
import StatusMessage from "./components/common/StatusMessage";

// Hooks
import { useConfig } from "./hooks/useConfig";

// Services
import * as api from "./services/api";

// Styles
import "./styles/App.css";
import "./styles/SetupTab.css";
import "./styles/AboutTab.css";

const App = () => {
  const [activeTab, setActiveTab] = useState("config");
  const [isAdmin, setIsAdmin] = useState(false);
  const [isCheckingAdmin, setIsCheckingAdmin] = useState(true);
  const [pedmStatusMessage, setPedmStatusMessage] = useState(null);
  
  // Use custom hook for configuration management
  const configHook = useConfig();

  // Check admin permissions on mount
  useEffect(() => {
    const checkPermissions = async () => {
      try {
        const result = await api.checkAdminPermissions();
        // getGlobalUserRole returns { isAdmin: boolean, ... }
        setIsAdmin(result?.isAdmin === true);
      } catch (error) {
        console.error("Failed to check admin permissions:", error);
        setIsAdmin(false);
      } finally {
        setIsCheckingAdmin(false);
      }
    };

    checkPermissions();
  }, []);

  return (
    <div className="app-container">
      <div className="app-content-wrapper">
        {/* Tab Navigation - Using modular TabBar component */}
        <TabBar
          activeTab={activeTab}
          onTabChange={setActiveTab}
          isAdmin={isAdmin}
        />

        {/* Tab Content */}
        <div className="app-tab-content">
          {/* Config Tab - Using modular ConfigTab component */}
          {activeTab === "config" && (
            <ConfigTab
              isCheckingAdmin={isCheckingAdmin}
              isAdmin={isAdmin}
              isLoading={configHook.isLoading}
              statusMessage={configHook.statusMessage}
              setStatusMessage={configHook.setStatusMessage}
              formValues={configHook.formValues}
              setFormValues={configHook.setFormValues}
              formKey={configHook.formKey}
              isApiKeyMasked={configHook.isApiKeyMasked}
              setIsApiKeyMasked={configHook.setIsApiKeyMasked}
              showCopiedMessage={configHook.showCopiedMessage}
              isTestingConnection={configHook.isTestingConnection}
              hasFormChanges={configHook.hasFormChanges}
              connectionTested={configHook.connectionTested}
              handleSubmit={configHook.handleSubmit}
              handleTestConnection={configHook.handleTestConnection}
              handleClearForm={configHook.handleClearForm}
              copyApiKey={configHook.copyApiKey}
            />
          )}

          {/* Endpoint Privilege Manager Tab - Web Trigger Configuration */}
          {activeTab === "pedm" && (
            <>
              <h2 className="config-tab-title">
                Endpoint Privilege Manager
              </h2>
              <p className="config-tab-subtitle">
                Configure web trigger settings for Keeper Security alerts and ITSM project integration.
              </p>
              
              {isCheckingAdmin ? (
                <div style={{ padding: '20px', textAlign: 'center', color: '#5E6C84' }}>
                  <p>Checking admin permissions...</p>
                </div>
              ) : !isAdmin ? (
                <div className="config-tab-admin-check">
                  <SectionMessage appearance="warning" title="Access Restricted">
                    <p className="config-tab-section-message">
                      Only Jira Administrators or Project Administrators can access this configuration page. 
                      Please contact your Jira administrator if you need to modify these settings.
                    </p>
                  </SectionMessage>
                </div>
              ) : (
                <>
                  <StatusMessage 
                    message={pedmStatusMessage} 
                    onDismiss={() => setPedmStatusMessage(null)} 
                  />
                  <WebTriggerConfig
                    statusMessage={pedmStatusMessage}
                    setStatusMessage={setPedmStatusMessage}
                  />
                </>
              )}
            </>
          )}

          {/* Setup/Prerequisites Tab */}
          {activeTab === "prereq" && (
            <>
              <h2 className="setup-page-title">
                Prerequisites Setup Guide
              </h2>
              
              <p className="setup-intro-text">
                This Jira integration leverages <span onClick={() => router.open("https://docs.keeper.io/en/keeperpam/commander-cli/overview")} className="setup-link">Keeper Commander CLI</span> running in Service Mode to provide a REST API interface for vault operations. The following guide covers both Jira-side and Keeper-side requirements to enable seamless communication between Jira Cloud and your Keeper vault.
              </p>

              <div className="setup-section">
                <h3 className="setup-section-title">
                  1. Jira Cloud Requirements
                </h3>
                
                <p className="setup-subsection-title">
                  Administrator Setup
                </p>
                <p className="setup-text">
                  To install and configure this Forge app, Jira administrators must have appropriate permissions within their Atlassian organization. The administrator responsible for installation needs <strong className="setup-strong">Manage apps</strong> permission in Jira settings, which allows them to install, configure, and manage Forge applications. Additionally, they should have access to organization settings for billing and app approval workflows if organizational policies require app approval before installation.
                </p>
                <p className="setup-text-spacing">
                  Once installed, administrators must configure the app through the global configuration page (accessed via Jira Settings → Apps → Keeper Integration). This includes providing the Keeper Commander REST API URL, API key, and testing the connection to ensure proper communication between Jira and Keeper services. Administrators can also manage request approvals and assign specific users as approvers for Keeper requests within issues.
                </p>

                <p className="setup-subsection-title">
                  End User Permissions
                </p>
                <p className="setup-text">
                  For end users to access and utilize the Keeper integration panel within Jira issues, specific issue-level permissions are required. Users must have <strong className="setup-strong">Edit Issues</strong> permission for the projects where they want to use Keeper functionality. This permission is essential because the Forge app's issue panel only appears to users who can modify issues, ensuring that only authorized team members can request or execute vault operations.
                </p>
                <p className="setup-text">
                  Additionally, users should have <strong className="setup-strong">Add Comments</strong> permission, as the app automatically adds structured comments to issues when Keeper actions are requested, approved, or executed. These comments provide an audit trail and keep all stakeholders informed of vault operation status. Users without this permission may encounter issues with the request approval workflow.
                </p>
                <p className="setup-text-spacing">
                  Users submitting requests that require admin approval should also have <strong className="setup-strong">Assign Issues</strong> permission if the workflow involves automatic assignment to designated approvers. While not strictly required for basic functionality, this permission enables a smoother approval process where issues are automatically routed to the appropriate administrator for review.
                </p>

                <p className="setup-subsection-title">
                  Project Configuration
                </p>
                <p className="setup-text-last">
                  The integration works across all Jira Cloud projects where users have appropriate permissions. No special project configuration or custom fields are required. However, administrators may want to consider creating dedicated issue types for Keeper requests (such as "Access Request" or "Credential Request") to better organize and track vault operations within their project workflows. The app integrates seamlessly with existing issue workflows, priorities, and custom fields without requiring modifications to your current Jira configuration.
                </p>
                
                <p className="setup-reference">
                  Reference: <span onClick={() => router.open("https://support.atlassian.com/jira-cloud-administration/docs/manage-project-permissions/")} className="setup-link-subtle">Jira Cloud Project Permissions</span> | <span onClick={() => router.open("https://developer.atlassian.com/platform/forge/manifest-reference/permissions/")} className="setup-link-subtle">Forge App Permissions</span>
                </p>
              </div>

              <div className="setup-section">
                <h3 className="setup-section-title">
                  2. Keeper Commander CLI Installation
                </h3>
                <p className="setup-text">
                  Keeper Commander is a powerful command-line and SDK interface to the Keeper Security platform. It provides comprehensive access to your vault, administrative functions, and privileged access management capabilities. Before proceeding, ensure you have a valid Keeper account with appropriate permissions to create, modify, and share records and folders within your vault.
                </p>
                <p className="setup-text">
                  The recommended installation method is via Docker, which provides a containerized environment with all necessary dependencies pre-configured. Alternatively, you can install Commander CLI using Python for environments where Docker is not available. Visit the <span onClick={() => router.open("https://docs.keeper.io/en/keeperpam/commander-cli/installation-and-setup")} className="setup-link">Installation and Setup documentation</span> for detailed installation instructions for your platform.
                </p>
                <p className="setup-reference-simple">
                  Reference: <span onClick={() => router.open("https://docs.keeper.io/en/keeperpam/commander-cli/overview")} className="setup-link-subtle">Keeper Commander Overview</span>
                </p>
              </div>

              <div className="setup-section">
                <h3 className="setup-section-title">
                  3. Tunneling & Network Configuration
                </h3>
                <p className="setup-text">
                  Since Keeper Commander Service Mode runs in your local environment, you need a tunneling solution to expose the REST API endpoints to Jira Cloud. A tunnel creates a secure bridge between your local service and the public internet, enabling Jira to communicate with your Keeper Commander instance without complex firewall or network configuration.
                </p>
                <p className="setup-text">
                  <strong className="setup-strong">Ngrok</strong> is a popular tunneling solution offering both free and paid plans. It provides instant public URLs with automatic HTTPS encryption. The free tier is suitable for development and testing, while paid plans offer additional features like custom domains and increased bandwidth. Visit <span onClick={() => router.open("https://ngrok.com/")} className="setup-link">ngrok.com</span> to get started and obtain your authentication token.
                </p>
                <p className="setup-text">
                  <strong className="setup-strong">Cloudflare Tunnel</strong> is an enterprise-grade alternative that provides secure, reliable tunneling through Cloudflare's global network. It offers enhanced security features and is particularly well-suited for production deployments. Learn more at <span onClick={() => router.open("https://www.cloudflare.com/products/tunnel/")} className="setup-link">Cloudflare Tunnel documentation</span> to obtain your tunnel token.
                </p>
                <p className="setup-text-last">
                  Once your tunnel is established, you'll receive a public URL. Enter the <strong>complete API v2 URL</strong> in the Configuration tab including the <code className="setup-code">/api/v2</code> path (e.g., <code className="setup-code">https://your-tunnel-domain.ngrok.io/api/v2</code>). This integration uses API v2 async queue mode which requires Commander 17.1.7 or later.
                </p>
                <p className="setup-reference">
                  Reference: <span onClick={() => router.open("https://docs.keeper.io/en/keeperpam/commander-cli/service-mode-rest-api#create-service-mode-using-tunneling")} className="setup-link-subtle">Creating Service Mode with Tunneling</span>
                </p>
              </div>

              <div className="setup-section">
                <h3 className="setup-section-title">
                  4. Service Mode REST API Configuration & Deployment
                </h3>
                <p className="setup-text">
                  Service Mode transforms Keeper Commander into a REST API server that can process commands via HTTP endpoints. This mode is specifically designed for integration scenarios where external applications need programmatic access to vault operations. The service automatically generates a secure API key upon startup and exposes the <code className="setup-code">/api/v2/executecommand-async</code> endpoint for asynchronous command execution with queue support.
                </p>
                <p className="setup-text-spacing">
                  For this integration to function correctly, your Service Mode instance must be configured with specific parameters. The commands list defines which CLI operations are permitted via the API, the run mode determines whether the service operates in the foreground or background, and the queue system setting controls asynchronous request handling. Additionally, enabling persistent login ensures uninterrupted authentication without repeated login prompts, which is critical for continuous operation.
                </p>

                <div className="setup-config-box">
                  <p className="setup-config-title">
                    Required Service Configuration
                  </p>
                  <table className="setup-config-table">
                    <tbody>
                      <tr>
                        <td>Commands List:</td>
                        <td>
                          <code className="setup-code-white">record-add, list, ls, get, record-type-info, record-update, share-record, share-folder, rti, record-permission, pedm, service-status</code>
                        </td>
                      </tr>
                      <tr>
                        <td>Run Mode:</td>
                        <td>
                          <code className="setup-code-small">-rm foreground</code> <span className="setup-color-grey">(Default)</span>
                        </td>
                      </tr>
                      <tr>
                        <td>Queue System:</td>
                        <td>
                          <code className="setup-code-small">-q y</code> <span className="setup-color-grey">(Required for API v2 async mode)</span>
                        </td>
                      </tr>
                      <tr>
                        <td>Authentication:</td>
                        <td>KSM Token, User/Password, or Config File</td>
                      </tr>
                      <tr>
                        <td>Persistent Login:</td>
                        <td>
                          <code className="setup-code-small">this-device persistent-login on</code>
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>

                <div className="setup-docker-box">
                  <p className="setup-docker-title">
                    Example Docker Deployment Commands
                  </p>
                  
                  <p className="setup-docker-subtitle">
                    Basic Deployment:
                  </p>
                  <code className="setup-docker-code">
                    docker run -d -p 9009:9009 keeper-commander service-create -p 9009 -c 'record-add,list,ls,get,record-type-info,record-update,share-record,share-folder,rti,record-permission,pedm,service-status' -f json -rm foreground -q y --user your@email.com --password yourpassword
                  </code>
                  
                  <p className="setup-docker-subtitle-spacing">
                    With Ngrok Tunneling:
                  </p>
                  <code className="setup-docker-code">
                    docker run -d -p 9009:9009 keeper-commander service-create -p 9009 -c 'record-add,list,ls,get,record-type-info,record-update,share-record,share-folder,rti,record-permission,pedm,service-status' -f json -rm foreground -q y -ng &lt;ngrok-auth-token&gt; -cd &lt;custom-domain&gt; --user your@email.com --password yourpassword
                  </code>
                  
                  <p className="setup-docker-subtitle-spacing">
                    With Cloudflare Tunneling:
                  </p>
                  <code className="setup-docker-code">
                    docker run -d -p 9009:9009 keeper-commander service-create -p 9009 -c 'record-add,list,ls,get,record-type-info,record-update,share-record,share-folder,rti,record-permission,pedm,service-status' -f json -rm foreground -q y -cf &lt;cloudflare-tunnel-token&gt; -cfd &lt;cloudflare-custom-domain&gt; --user your@email.com --password yourpassword
                  </code>
                  
                  <p className="setup-docker-note">
                    <strong>Parameters:</strong> <code className="setup-code-tiny">-ng</code> Ngrok auth token, 
                    <code className="setup-code-tiny">-cd</code> Ngrok custom domain (subdomain portion only), 
                    <code className="setup-code-tiny">-cf</code> Cloudflare tunnel token, 
                    <code className="setup-code-tiny">-cfd</code> Cloudflare custom domain
                  </p>
                </div>

                <div className="setup-cli-box">
                  <p className="setup-cli-title">
                    Keeper Commander CLI Deployment (Without Docker)
                  </p>
                  
                  <p className="setup-cli-subtitle">
                    First, install Keeper Commander CLI and configure persistent login:
                  </p>
                  <code className="setup-cli-code">
                    {`pip install keepercommander
keeper shell
login your@email.com
this-device persistent-login on
this-device register
this-device timeout 30d`}
                  </code>
                  
                  <p className="setup-cli-subtitle-bold">
                    Basic Service Creation:
                  </p>
                  <code className="setup-cli-code">
                    keeper service-create -p=9009 -c="record-add,list,ls,get,record-type-info,record-update,share-record,share-folder,rti,record-permission,pedm,service-status" -rm="foreground" -q=y -f=json
                  </code>
                  
                  <p className="setup-cli-subtitle-bold">
                    With Ngrok Tunneling:
                  </p>
                  <code className="setup-cli-code">
                    keeper service-create -p=9009 -c="record-add,list,ls,get,record-type-info,record-update,share-record,share-folder,rti,record-permission,pedm,service-status" -rm="foreground" -q=y -ng="&lt;ngrok-auth-token&gt;" -cd="&lt;custom-domain&gt;" -f=json
                  </code>
                  
                  <p className="setup-cli-subtitle-bold">
                    With Cloudflare Tunneling:
                  </p>
                  <code className="setup-cli-code">
                    keeper service-create -p=9009 -c="record-add,list,ls,get,record-type-info,record-update,share-record,share-folder,rti,record-permission,pedm,service-status" -rm="foreground" -q=y -cf="&lt;cloudflare-tunnel-token&gt;" -cfd="&lt;cloudflare-custom-domain&gt;" -f=json
                  </code>
                  
                  <p className="setup-cli-note">
                    <strong>Note:</strong> After service creation, the API key will be displayed in the console output. Make sure to copy and store it securely.
                  </p>
                </div>

                <p className="setup-text-bottom">
                  After successful deployment, the service will generate a unique API key displayed in the console output or container logs. This API key must be securely stored and configured in the Jira integration settings. All configuration files are automatically encrypted using your private key to protect sensitive data including API keys, tokens, and security settings.
                </p>
                <p className="setup-reference">
                  Reference: <span onClick={() => router.open("https://docs.keeper.io/en/keeperpam/commander-cli/service-mode-rest-api")} className="setup-link-subtle">Service Mode REST API Documentation</span>
                </p>
              </div>

              <div className="setup-help-box">
                <p className="setup-help-text">
                  <strong className="about-strong">Need Additional Help?</strong> For comprehensive setup instructions, troubleshooting guides, and advanced configuration options, visit the official Keeper documentation at <span onClick={() => router.open("https://docs.keeper.io/en/keeperpam/commander-cli/overview")} className="setup-help-link">docs.keeper.io</span>. For technical support, contact <span onClick={() => router.open("mailto:commander@keepersecurity.com")} className="setup-help-link">commander@keepersecurity.com</span>.
                </p>
              </div>
            </>
          )}

          {/* About Tab */}
          {activeTab === "about" && (
            <>
              <h2 className="about-page-title">
                About
              </h2>
              <p className="about-intro-text">
                The Keeper-Jira Integration is a powerful Atlassian Forge application that bridges Jira Cloud with Keeper Security's vault management platform. This integration enables seamless credential management, secure secret storage, and privileged access workflows directly from within your Jira issues, eliminating context switching and improving security team productivity.
              </p>

              <div className="setup-section">
                <h3 className="setup-section-title">
                  Key Features
                </h3>
                
                <div className="about-feature-block">
                  <p className="about-feature-title">
                    Vault Operations from Jira Issues
                  </p>
                  <p className="about-feature-text">
                    Create new secrets, update existing records, manage permissions, and share credentials directly from Jira issue panels. All operations are executed through Keeper Commander CLI's REST API, ensuring secure and auditable vault management without leaving your project workflow.
                  </p>
                </div>

                <div className="about-feature-block">
                  <p className="about-feature-title">
                    Endpoint Privilege Management (Administrator Only)
                  </p>
                  <p className="about-feature-text">
                    The Endpoint Privilege Manager tab provides administrators with the ability to configure automated ticket creation for Keeper Security KEPM (Keeper Endpoint Privilege Manager) alerts through webhooks. This feature enables real-time monitoring and approval workflows for privileged access requests across your organization.
                  </p>
                </div>

                <div className="about-feature-block">
                  <p className="about-feature-title">
                    Centralized Configuration Management
                  </p>
                  <p className="about-feature-text">
                    Configure Keeper Commander REST API endpoints, manage authentication tokens, and test connectivity from a unified global settings page. Administrators can easily set up and maintain the integration with built-in connection verification and status monitoring.
                  </p>
                </div>

                <div className="about-feature-block-last">
                  <p className="about-feature-title">
                    Native Jira Experience
                  </p>
                  <p className="about-feature-text">
                    Built with Atlassian Forge Custom UI and Atlaskit design system components for a seamless, native Jira Cloud experience. The integration respects Jira's permissions model and follows platform best practices for security, performance, and user experience.
                  </p>
                </div>
              </div>

              <div className="setup-section">
                <h3 className="setup-section-title">
                  Architecture Overview
                </h3>
                
                <p className="setup-text-spacing">
                  The integration operates through a three-tier architecture: Jira Cloud hosts the Forge app frontend, Keeper Commander CLI runs in Service Mode to provide REST API access to vault operations, and a tunneling solution (Ngrok or Cloudflare Tunnel) bridges the local service with cloud-hosted Jira. This architecture ensures secure communication while maintaining the flexibility of on-premises credential storage.
                </p>

                <p className="setup-text-spacing">
                  All API communications are authenticated using secure tokens, encrypted in transit via HTTPS, and logged for audit compliance. The Forge app operates within Jira's sandboxed environment, ensuring proper isolation and adherence to Atlassian's security requirements.
                </p>

                <div className="about-tech-box">
                  <p className="about-tech-text">
                    <strong className="about-strong">Technology Stack:</strong> Atlassian Forge Platform, React 18, Atlaskit UI Components, Keeper Commander CLI, REST API Integration, Docker (optional deployment)
                  </p>
                </div>
              </div>

              <div className="setup-section">
                <h3 className="setup-section-title">
                  Integration Capabilities
                </h3>
                <p className="setup-text-spacing">
                  Once configured, this integration provides comprehensive capabilities for managing Keeper vault operations directly from Jira issues. Each action corresponds to specific Commander CLI commands and enables different vault management scenarios. Some features are available to all users, while advanced operations require administrator permissions.
                </p>

                <div className="about-capability-box">
                  <p className="about-capability-title">
                    Record Permission
                  </p>
                  <p className="about-capability-text">
                    Manage granular permissions for records within shared folders using the <code className="about-code">record-permission</code> command. Control which users or teams can view, edit, or reshare specific records. Essential for implementing least-privilege access controls and compliance requirements.
                  </p>
                </div>

                <div className="about-capability-box">
                  <p className="about-capability-title">
                    Share Record
                  </p>
                  <p className="about-capability-text">
                    Grant or revoke user access to individual records with configurable permissions and optional expiration dates. Utilizes the <code className="setup-code-small">share-record</code> command to enable time-bound access for contractors, temporary access for incident response, or permanent sharing with team members.
                  </p>
                </div>

                <div className="about-capability-box">
                  <p className="about-capability-title">
                    Share Folder
                  </p>
                  <p className="about-capability-text">
                    Manage folder-level access and permissions for users or teams using the <code className="about-code">share-folder</code> command. Control permissions for managing records, managing users, sharing capabilities, and editing rights. Supports expiration settings for temporary project access or contractor engagements.
                  </p>
                </div>

                <div className="about-capability-box-last" style={{marginBottom: '16px'}}>
                  <p className="about-capability-title">
                    Create New Secret (Administrator Only)
                  </p>
                  <p className="about-capability-text">
                    Add new records to your Keeper vault with customizable fields and record types. Uses the <code className="about-code">record-add</code> command to create login credentials, secure notes, payment cards, and other record types. Ideal for onboarding workflows where new accounts need to be provisioned and credentials stored securely.
                  </p>
                </div>

                <div className="about-capability-box-last" style={{marginBottom: '16px'}}>
                  <p className="about-capability-title">
                    Update Record (Administrator Only)
                  </p>
                  <p className="about-capability-text">
                    Modify existing record fields including passwords, usernames, URLs, and custom fields. Leverages the <code className="about-code">record-update</code> command to keep credentials current and accurate. Perfect for password rotation workflows and credential lifecycle management.
                  </p>
                </div>

                <div className="about-capability-box-last">
                  <p className="about-capability-title">
                    Endpoint Privilege Management (Administrator Only)
                  </p>
                  <p className="about-capability-text">
                    For Global Jira Administrators or Project Administrators, the integration provides advanced Endpoint Privilege Management capabilities through the dedicated tab. Monitor and manage privileged access requests across your organization with real-time approval workflows.
                  </p>
                  <p className="about-capability-text">
                    <strong className="about-strong">How it works:</strong> Approval requests automatically create Jira tickets via webhooks. Each ticket includes Approve/Deny action buttons with live countdown timers, user details, application context, and justification messages. Commands used: <code className="about-code">pedm approval view</code> to fetch enriched request details, and <code className="about-code">pedm approval action --approve/--deny</code> to process approval decisions directly from Jira.
                  </p>
                </div>

                <p className="about-reference">
                  Reference: <span onClick={() => router.open("https://docs.keeper.io/en/keeperpam/commander-cli/command-reference")} className="setup-link-subtle">Commander CLI Command Reference</span> | <span onClick={() => router.open("https://docs.keeper.io/en/keeperpam/commander-cli/command-reference/endpoint-privilege-manager-commands")} className="setup-link-subtle">Endpoint Privilege Management Commands</span>
                </p>
              </div>

              <div className="about-docs-box">
                <p className="setup-config-title">
                  Documentation & Support
                </p>
                <div className="about-docs-content">
                  <p className="about-docs-item">
                    <strong>Keeper Documentation:</strong>{" "}
                    <span 
                      onClick={() => router.open("https://docs.keeper.io/en/keeperpam/commander-cli/overview")}
                      className="about-docs-link"
                    >
                      docs.keeper.io
                    </span>
                  </p>
                  <p className="about-docs-item">
                    <strong>Forge Platform:</strong>{" "}
                    <span 
                      onClick={() => router.open("https://developer.atlassian.com/platform/forge/")}
                      className="about-docs-link"
                    >
                      developer.atlassian.com/platform/forge
                    </span>
                  </p>
                  <p className="about-docs-item-last">
                    <strong>Technical Support:</strong>{" "}
                    <span 
                      onClick={() => router.open("mailto:commander@keepersecurity.com")}
                      className="about-docs-link"
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
