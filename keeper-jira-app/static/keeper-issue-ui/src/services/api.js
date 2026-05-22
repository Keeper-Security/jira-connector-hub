import { invoke } from "@forge/bridge";

// Get issue context
export const getIssueContext = async () => {
  return await invoke("getIssueContext");
};

// Activate keeper panel
export const activateKeeperPanel = async (issueKey) => {
  return await invoke("activateKeeperPanel", { issueKey });
};

// Get keeper records.
// `mode` selects the vault type: 'classic' uses Commander `list`, 'kd' uses
// `kd-list --records` (Keeper Drive). Defaults to 'classic' for backward
// compatibility with any caller that doesn't pass a mode.
export const getKeeperRecords = async (mode = 'classic') => {
  return await invoke("getKeeperRecords", { mode });
};

// Get keeper folders.
// `mode` selects the vault type: 'classic' uses Commander `ls -f`, 'kd' uses
// `kd-list --folders` (Keeper Drive). Defaults to 'classic'.
export const getKeeperFolders = async (mode = 'classic') => {
  return await invoke("getKeeperFolders", { mode });
};

// Get keeper record details
export const getKeeperRecordDetails = async (recordUid) => {
  return await invoke("getKeeperRecordDetails", { recordUid });
};

// Get user role
export const getUserRole = async (issueKey) => {
  return await invoke("getUserRole", { issueKey });
};

// Get stored request data
export const getStoredRequestData = async (issueKey) => {
  return await invoke("getStoredRequestData", { issueKey });
};

// Store request data (backend handles auto-assignment to project admin)
export const storeRequestData = async (issueKey, requestData, formattedTimestamp = null) => {
  const payload = {
    issueKey, 
    requestData
  };
  
  if (formattedTimestamp) {
    payload.formattedTimestamp = formattedTimestamp;
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

// Execute keeper action.
// `mode` ('classic' | 'kd') controls whether the resolver/commandBuilder routes
// `record-add` and `record-update` to their Keeper Drive variants
// (`kd-record-add`, `kd-record-update`). Defaults to 'classic' for backward
// compatibility.
export const executeKeeperAction = async (issueKey, command, commandDescription, parameters, formattedTimestamp = null, mode = 'classic') => {
  const payload = {
    issueKey,
    command,
    commandDescription,
    parameters,
    mode
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

// Fetch payload data + labels for an ITSM-created ticket. The companion
// JIRA ITSM Forge app embeds the original Keeper alert as a JSON code block
// inside the issue description; the panel uses this to render context for the
// Approve/Deny workflow.
export const getItsmTicketData = async (issueKey) => {
  return await invoke("getItsmTicketData", { issueKey });
};

export const getEpmApprovalDetails = async (requestUid) => {
  return await invoke("getEpmApprovalDetails", { requestUid });
};

export const addEpmExpiredComment = async (issueKey, formattedTimestamp) => {
  return await invoke("addEpmExpiredComment", { issueKey, formattedTimestamp });
};

export const checkEpmExpired = async (issueKey) => {
  return await invoke("checkEpmExpired", { issueKey });
};

export const checkEpmActionTaken = async (issueKey) => {
  return await invoke("checkEpmActionTaken", { issueKey });
};

// Check if a device admin approval action has already been taken on this ticket.
// Used by DeviceApprovalPanel to short-circuit and show the already-actioned state
// without re-running the device-approve / device-deny Commander command.
export const checkDeviceActionTaken = async (issueKey) => {
  return await invoke("checkDeviceActionTaken", { issueKey });
};

// Pre-flight check: ask the backend to verify the user/device on this ticket
// is still in Keeper's pending device-approval list (`device-approve --reload
// `request-already-processed-outside-jira` label + audit comment, and the
// panel hides the Approve/Deny buttons.
export const checkDevicePendingStatus = async (issueKey) => {
  return await invoke("checkDevicePendingStatus", { issueKey });
};

