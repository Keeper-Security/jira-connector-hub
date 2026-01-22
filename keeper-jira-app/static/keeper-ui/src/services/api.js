/**
 * API service for communicating with the backend
 */
import { invoke } from "@forge/bridge";

/**
 * Test connection to Keeper Commander API
 * @param {string} apiUrl - API URL
 * @param {string} apiKey - API Key
 * @returns {Promise<Object>} - Response object
 */
export const testConnection = async (apiUrl, apiKey) => {
  return await invoke("testConnection", { apiUrl, apiKey });
};

/**
 * Save configuration
 * @param {Object} config - Configuration object
 * @returns {Promise<Object>} - Response object
 */
export const saveConfig = async (config) => {
  return await invoke("setConfig", { payload: config });
};

/**
 * Load configuration
 * @returns {Promise<Object>} - Configuration object
 */
export const loadConfig = async () => {
  return await invoke("getConfig");
};

/**
 * Check if user is admin
 * @returns {Promise<boolean>} - True if user is admin
 */
export const checkAdminPermissions = async () => {
  return await invoke("getGlobalUserRole");
};

/**
 * Execute Keeper Commander command
 * @param {string} command - Keeper Commander command
 * @returns {Promise<Object>} - Response object
 */
export const executeKeeperCommand = async (command) => {
  return await invoke("executeKeeperCommand", {
    payload: {
      command: command
    }
  });
};

/**
 * Approve PEDM request
 * @param {string} approvalUid - Approval UID
 * @returns {Promise<Object>} - Response object
 */
export const approvePedmRequest = async (approvalUid) => {
  return await invoke("executeKeeperCommand", {
    payload: {
      command: `pedm approval action --approve ${approvalUid}`
    }
  });
};

/**
 * Deny PEDM request
 * @param {string} approvalUid - Approval UID
 * @returns {Promise<Object>} - Response object
 */
export const denyPedmRequest = async (approvalUid) => {
  return await invoke("executeKeeperCommand", {
    payload: {
      command: `pedm approval action --deny ${approvalUid}`
    }
  });
};

/**
 * Get web trigger URL
 * @returns {Promise<Object>} - Response object with URL
 */
export const getWebTriggerUrl = async () => {
  return await invoke("getWebTriggerUrl");
};

/**
 * Get web trigger configuration
 * @returns {Promise<Object>} - Web trigger configuration
 */
export const getWebTriggerConfig = async () => {
  return await invoke("getWebTriggerConfig");
};

/**
 * Save web trigger configuration
 * @param {Object} config - Configuration object
 * @returns {Promise<Object>} - Response object
 */
export const saveWebTriggerConfig = async (config) => {
  return await invoke("setWebTriggerConfig", { payload: config });
};

/**
 * Get all Jira projects
 * @returns {Promise<Object>} - Response object with projects
 */
export const getJiraProjects = async () => {
  return await invoke("getJiraProjects");
};

/**
 * Get issue types for a project
 * @param {string} projectKey - Project key
 * @returns {Promise<Object>} - Response object with issue types
 */
export const getProjectIssueTypes = async (projectKey) => {
  return await invoke("getProjectIssueTypes", { payload: { projectKey } });
};

/**
 * Test web trigger by creating a test issue
 * @param {string} projectKey - Project key
 * @param {string} issueType - Issue type name
 * @returns {Promise<Object>} - Response object
 */
export const testWebTrigger = async (projectKey, issueType) => {
  return await invoke("testWebTrigger", { payload: { projectKey, issueType } });
};

/**
 * Test web trigger with full payload (simulating actual webhook call)
 * @param {Object} payload - Test payload data
 * @returns {Promise<Object>} - Response object
 */
export const testWebTriggerWithPayload = async (payload) => {
  return await invoke("testWebTriggerWithPayload", { payload });
};

/**
 * Get tickets created by webhook
 * @returns {Promise<Object>} - Response object with tickets array
 */
export const getWebhookTickets = async () => {
  return await invoke("getWebhookTickets");
};

/**
 * Generate or regenerate webhook authentication token
 * @returns {Promise<Object>} - Response object with new webhook URL
 */
export const generateWebhookToken = async () => {
  return await invoke("generateWebhookToken");
};

/**
 * Revoke webhook authentication token
 * WARNING: Disables token authentication
 * @returns {Promise<Object>} - Response object
 */
export const revokeWebhookToken = async () => {
  return await invoke("revokeWebhookToken");
};

/**
 * Get webhook audit logs
 * @returns {Promise<Object>} - Response object with logs array
 */
export const getWebhookAuditLogs = async () => {
  return await invoke("getWebhookAuditLogs");
};

/**
 * Clear webhook audit logs
 * @returns {Promise<Object>} - Response object
 */
export const clearWebhookAuditLogs = async () => {
  return await invoke("clearWebhookAuditLogs");
};

