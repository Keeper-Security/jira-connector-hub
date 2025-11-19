import { invoke } from "@forge/bridge";

// Get issue context
export const getIssueContext = async () => {
  return await invoke("getIssueContext");
};

// Activate keeper panel
export const activateKeeperPanel = async (issueKey) => {
  return await invoke("activateKeeperPanel", { issueKey });
};

// Get keeper records
export const getKeeperRecords = async () => {
  return await invoke("getKeeperRecords");
};

// Get keeper folders
export const getKeeperFolders = async () => {
  return await invoke("getKeeperFolders");
};

// Get keeper record details
export const getKeeperRecordDetails = async (recordUid) => {
  return await invoke("getKeeperRecordDetails", { recordUid });
};

// Get record types
export const getRecordTypes = async () => {
  return await invoke("getRecordTypes");
};

// Get record type template
export const getRecordTypeTemplate = async (recordType) => {
  return await invoke("getRecordTypeTemplate", { recordType });
};

// Get user role
export const getUserRole = async (issueKey) => {
  return await invoke("getUserRole", { issueKey });
};

// Get stored request data
export const getStoredRequestData = async (issueKey) => {
  return await invoke("getStoredRequestData", { issueKey });
};

// Store request data
export const storeRequestData = async (issueKey, requestData, formattedTimestamp = null, assigneeAccountId = null) => {
  const payload = {
    issueKey, 
    requestData
  };
  
  if (formattedTimestamp) {
    payload.formattedTimestamp = formattedTimestamp;
  }
  
  if (assigneeAccountId) {
    payload.assigneeAccountId = assigneeAccountId;
  }
  
  return await invoke("storeRequestData", payload);
};

// Clear stored request data
export const clearStoredRequestData = async (issueKey) => {
  return await invoke("clearStoredRequestData", { issueKey });
};

// Get project admins
export const getProjectAdmins = async (projectKey, issueKey) => {
  return await invoke("getProjectAdmins", { 
    projectKey, 
    issueKey 
  });
};

// Execute keeper action
export const executeKeeperAction = async (issueKey, command, commandDescription, parameters, formattedTimestamp = null) => {
  const payload = {
    issueKey,
    command,
    commandDescription,
    parameters
  };
  
  if (formattedTimestamp) {
    payload.formattedTimestamp = formattedTimestamp;
  }
  
  return await invoke("executeKeeperAction", payload);
};

// Reject keeper request
export const rejectKeeperRequest = async (issueKey, rejectionReason) => {
  return await invoke("rejectKeeperRequest", {
    issueKey,
    rejectionReason
  });
};


