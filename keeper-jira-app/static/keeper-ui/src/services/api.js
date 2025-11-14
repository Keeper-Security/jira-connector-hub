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

