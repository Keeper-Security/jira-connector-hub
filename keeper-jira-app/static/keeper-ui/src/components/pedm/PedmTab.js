/**
 * PEDM Tab Component - Fully self-contained
 * Displays PEDM (Privileged Enterprise Data Management) requests with search, filtering, and approval functionality
 */
import React, { useState, useEffect } from 'react';
import TextField from "@atlaskit/textfield";
import Button from "@atlaskit/button";
import Spinner from "@atlaskit/spinner";
import SectionMessage from "@atlaskit/section-message";
import RefreshIcon from "@atlaskit/icon/glyph/refresh";
import CrossCircleIcon from "@atlaskit/icon/glyph/cross-circle";
import EditorDoneIcon from "@atlaskit/icon/glyph/editor/done";

import * as api from '../../services/api';
import { handleApiError } from '../../utils/errorHandler';
import { formatDate, formatTimeRemaining, isExpired } from '../../utils/formatters';
import { MESSAGE_TYPES } from '../../constants';
import StatusMessage from '../common/StatusMessage';
import '../../styles/PedmTab.css';

const PedmTab = ({ isAdmin, isCheckingAdmin, activeTab }) => {
  // PEDM state
  const [isPedmLoading, setIsPedmLoading] = useState(false);
  const [pedmData, setPedmData] = useState(null);
  const [pedmMessage, setPedmMessage] = useState(null);
  const [pedmApprovals, setPedmApprovals] = useState([]);
  const [pedmSearchTerm, setPedmSearchTerm] = useState('');
  const [pedmCurrentPage, setPedmCurrentPage] = useState(1);
  const [pedmItemsPerPage] = useState(10);
  const [showExpiredOnly, setShowExpiredOnly] = useState(false);
  const [currentTime, setCurrentTime] = useState(new Date());
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [selectedApproval, setSelectedApproval] = useState(null);

  // Load PEDM data when tab becomes active
  useEffect(() => {
    if (activeTab === "pedm" && isAdmin && !isCheckingAdmin) {
      handleQuickSync();
    }
  }, [activeTab, isAdmin, isCheckingAdmin]);

  // Timer to update current time every second for live countdown
  useEffect(() => {
    if (activeTab === "pedm" && pedmApprovals.length > 0) {
      const timer = setInterval(() => {
        setCurrentTime(new Date());
      }, 1000);

      return () => clearInterval(timer);
    }
  }, [activeTab, pedmApprovals.length]);

  // Generate consistent color for user avatar based on username
  const getUserColor = (username) => {
    const colors = [
      "#DE350B", "#0052CC", "#00875A", "#6554C0", "#FF5630", "#36B37E",
      "#FF991F", "#00B8D9", "#403294", "#172B4D", "#5243AA", "#008DA6",
    ];
    
    let hash = 0;
    for (let i = 0; i < username.length; i++) {
      hash = username.charCodeAt(i) + ((hash << 5) - hash);
    }
    
    const index = Math.abs(hash) % colors.length;
    return colors[index];
  };

  // Load/refresh PEDM data
  const handleQuickSync = async () => {
    if (!isAdmin) return;

    setIsPedmLoading(true);
    setPedmMessage(null);
    setPedmData(null);
    
    try {
      // Load saved configuration from storage (not form values)
      const savedConfig = await api.loadConfig();
      
      // Check if saved configuration exists
      if (!savedConfig || !savedConfig.apiUrl || !savedConfig.apiKey) {
        setPedmMessage({
          type: MESSAGE_TYPES.WARNING,
          title: 'Configuration Required',
          message: 'Please configure and save the API URL and API Key in the Configuration tab before accessing PEDM requests.'
        });
        setTimeout(() => setPedmMessage(null), 8000);
        setIsPedmLoading(false);
        return;
      }

      // Test the connection using SAVED configuration (not form values)
      const connectionResult = await api.testConnection(
        savedConfig.apiUrl,
        savedConfig.apiKey
      );

      // Check if connection test was successful
      if (!connectionResult || !connectionResult.isServiceRunning) {
        setPedmMessage({
          type: MESSAGE_TYPES.ERROR,
          title: 'Connection Failed',
          message: connectionResult?.message || 'Connection test failed. Please ensure the Keeper Commander service is running and accessible.'
        });
        setTimeout(() => setPedmMessage(null), 8000);
        setIsPedmLoading(false);
        return;
      }

      // Connection successful, now call the PEDM sync-down API
      const syncDownResult = await api.executeKeeperCommand("pedm sync-down");

      // Check if sync-down was successful
      if (!syncDownResult || !syncDownResult.success) {
        setPedmMessage({
          type: MESSAGE_TYPES.ERROR,
          title: 'PEDM Sync Failed',
          message: 'Failed to sync PEDM data. Please try again.'
        });
        setTimeout(() => setPedmMessage(null), 8000);
        setIsPedmLoading(false);
        return;
      }

      // Sync-down successful, now get the pending approval list
      const approvalListResult = await api.executeKeeperCommand("pedm approval list --type pending --format=json");

      setPedmData(approvalListResult);
      
      // Extract approvals array from the nested response
      const approvalsArray = approvalListResult?.data?.data || [];
      setPedmApprovals(approvalsArray);
      setPedmCurrentPage(1); // Reset to first page
      
      setPedmMessage({
        type: MESSAGE_TYPES.SUCCESS,
        title: 'PEDM Data Loaded Successfully!',
        message: 'Successfully synced PEDM requests from Keeper Commander.'
      });
      // Clear success message after 5 seconds
      setTimeout(() => setPedmMessage(null), 5000);
    } catch (error) {
      const errorMessage = handleApiError(error, "Failed to load PEDM data. Please check your configuration and connection.");
      setPedmMessage({
        type: MESSAGE_TYPES.ERROR,
        title: 'Failed to Load PEDM Data',
        message: errorMessage
      });
      // Clear error message after 8 seconds
      setTimeout(() => setPedmMessage(null), 8000);
    } finally {
      setIsPedmLoading(false);
    }
  };

  const handleRowClick = (approval) => {
    setSelectedApproval(approval);
    setIsModalOpen(true);
  };

  const handleApproveRequest = async (approvalUid) => {
    try {
      setPedmMessage({
        type: MESSAGE_TYPES.INFO,
        title: 'Processing Request',
        message: 'Approving PEDM request...'
      });

      const result = await api.approvePedmRequest(approvalUid);

      if (result && result.success) {
        setPedmMessage({
          type: MESSAGE_TYPES.SUCCESS,
          title: 'Request Approved',
          message: 'PEDM request has been approved successfully.'
        });
        setTimeout(() => setPedmMessage(null), 3000);
        // Refresh the list
        handleQuickSync();
      } else {
        setPedmMessage({
          type: MESSAGE_TYPES.ERROR,
          title: 'Approval Failed',
          message: result?.message || 'Failed to approve the request.'
        });
        setTimeout(() => setPedmMessage(null), 5000);
      }
    } catch (error) {
      const errorMessage = handleApiError(error, "Failed to approve PEDM request.");
      setPedmMessage({
        type: MESSAGE_TYPES.ERROR,
        title: 'Approval Failed',
        message: errorMessage
      });
      setTimeout(() => setPedmMessage(null), 5000);
    }
  };

  const handleDenyRequest = async (approvalUid) => {
    try {
      setPedmMessage({
        type: MESSAGE_TYPES.INFO,
        title: 'Processing Request',
        message: 'Denying PEDM request...'
      });

      const result = await api.denyPedmRequest(approvalUid);

      if (result && result.success) {
        setPedmMessage({
          type: MESSAGE_TYPES.SUCCESS,
          title: 'Request Denied',
          message: 'PEDM request has been denied successfully.'
        });
        setTimeout(() => setPedmMessage(null), 3000);
        // Refresh the list
        handleQuickSync();
      } else {
        setPedmMessage({
          type: MESSAGE_TYPES.ERROR,
          title: 'Deny Failed',
          message: result?.message || 'Failed to deny the request.'
        });
        setTimeout(() => setPedmMessage(null), 5000);
      }
    } catch (error) {
      const errorMessage = handleApiError(error, "Failed to deny PEDM request.");
      setPedmMessage({
        type: MESSAGE_TYPES.ERROR,
        title: 'Deny Failed',
        message: errorMessage
      });
      setTimeout(() => setPedmMessage(null), 5000);
    }
  };

  const handleCloseModal = () => {
    setIsModalOpen(false);
    setSelectedApproval(null);
  };

  // Helper function to check if approval is expired
  const isApprovalExpired = (approval) => {
    if (approval.created && approval.expire_in) {
      const createdTime = new Date(approval.created);
      const expirationTime = new Date(createdTime.getTime() + approval.expire_in * 60000);
      return currentTime > expirationTime;
    }
    return approval.status && approval.status !== 'Pending';
  };

  // Filter approvals based on expired status and search term
  const filteredApprovals = pedmApprovals.filter(approval => {
    // First filter by expired status
    const isExpired = isApprovalExpired(approval);
    if (showExpiredOnly) {
      if (!isExpired) return false;
    } else {
      if (isExpired) return false;
    }
    
    // Then filter by search term
    if (!pedmSearchTerm) return true;
    const searchLower = pedmSearchTerm.toLowerCase();
    return (
      approval.approval_uid?.toLowerCase().includes(searchLower) ||
      approval.approval_type?.toLowerCase().includes(searchLower) ||
      approval.status?.toLowerCase().includes(searchLower) ||
      approval.justification?.toLowerCase().includes(searchLower) ||
      approval.account_info?.some(info => info.toLowerCase().includes(searchLower)) ||
      approval.application_info?.some(info => info.toLowerCase().includes(searchLower))
    );
  });

  // Calculate pagination
  const totalPages = Math.ceil(filteredApprovals.length / pedmItemsPerPage);
  const startIndex = (pedmCurrentPage - 1) * pedmItemsPerPage;
  const endIndex = startIndex + pedmItemsPerPage;
  const currentApprovals = filteredApprovals.slice(startIndex, endIndex);

  return (
    <>
      {/* Header with Quick Sync button */}
      <div className="pedm-header">
        <div>
          <h2 className="pedm-header-title">
            PEDM Requests
          </h2>
          <p className="pedm-header-subtitle">
            Manage and view Privileged Enterprise Data Management (PEDM) requests here.
          </p>
        </div>
        {isAdmin && !isCheckingAdmin && (
          <div
            onClick={isPedmLoading ? undefined : handleQuickSync}
            className={`pedm-quick-sync ${isPedmLoading ? 'disabled' : ''}`}
          >
            {isPedmLoading ? (
              <Spinner size="medium" />
            ) : (
              <RefreshIcon label="Sync" size="medium" />
            )}
            <span>Quick Sync</span>
          </div>
        )}
      </div>

      {/* Status message */}
      <StatusMessage message={pedmMessage} />

      {/* Main content */}
      {isCheckingAdmin ? (
        <div className="pedm-checking-permissions">
          <p>Checking admin permissions...</p>
        </div>
      ) : !isAdmin ? (
        <div className="pedm-access-restricted-wrapper">
          <SectionMessage appearance="warning" title="Access Restricted">
            <p className="pedm-access-restricted-text">
              Only Jira Administrators or Project Administrators can access the PEDM Requests page. 
              Please contact your Jira administrator if you need to view or manage PEDM requests.
            </p>
          </SectionMessage>
        </div>
      ) : isPedmLoading ? (
        <div className="pedm-loading-state">
          <div className="pedm-loading-spinner-wrapper">
            <Spinner size="large" />
          </div>
          <div className="pedm-loading-title">
            Loading PEDM data...
          </div>
          <p className="pedm-loading-subtitle">
            Testing connection, syncing PEDM data, and fetching pending approvals
          </p>
        </div>
      ) : (
        <>
          {/* Data display - Table with search and pagination */}
          {pedmData && (
          <div className="pedm-search-section">
          <div className="pedm-search-controls">
            <div className="pedm-search-wrapper">
              <TextField
                placeholder="Search approvals..."
                value={pedmSearchTerm}
                onChange={(e) => {
                  setPedmSearchTerm(e.target.value);
                  setPedmCurrentPage(1);
                }}
                width="100%"
              />
            </div>
            <button
              onClick={() => {
                setShowExpiredOnly(!showExpiredOnly);
                setPedmCurrentPage(1);
              }}
              className={`pedm-toggle-button ${showExpiredOnly ? 'active' : ''}`}
            >
              {showExpiredOnly ? "Show Active" : "Show Expired"}
            </button>
          </div>

          {/* Results table */}
          {filteredApprovals.length > 0 ? (
            <>
              <div className="pedm-table-wrapper">
                <table className="pedm-table">
                  <thead>
                    <tr>
                      <th>User</th>
                      <th>Application</th>
                      <th>Justification Message</th>
                      <th>Request Timeout</th>
                    </tr>
                  </thead>
                  <tbody>
                    {currentApprovals.map((approval, index) => {
                      // Extract username from account_info (format: "Username=bisalranjanpadhan")
                      const username = approval.account_info && approval.account_info.length > 0 
                        ? approval.account_info[0].replace(/^Username=/i, '')
                        : 'Unknown';
                      
                      // Get initials for avatar
                      const initials = username.substring(0, 2).toUpperCase();
                      
                      // Extract application display from application_info
                      let applicationDisplay = '-';
                      if (approval.application_info && approval.application_info.length > 0) {
                        // Try to find Description field first
                        const descField = approval.application_info.find(info => info.startsWith('Description='));
                        if (descField) {
                          applicationDisplay = descField.replace(/^Description=/i, '');
                        } else {
                          // Fallback to first item
                          applicationDisplay = approval.application_info[0];
                        }
                      }
                      
                      // Calculate if expired based on created time + expire_in minutes
                      let isExpired = false;
                      let timeoutText = 'Pending';
                      
                      if (approval.created && approval.expire_in) {
                        const createdTime = new Date(approval.created);
                        const expirationTime = new Date(createdTime.getTime() + approval.expire_in * 60000);
                        
                        if (currentTime > expirationTime) {
                          // Expired
                          isExpired = true;
                          timeoutText = 'Expired';
                        } else {
                          // Calculate remaining time
                          const remainingMs = expirationTime - currentTime;
                          const remainingMinutes = Math.floor(remainingMs / 60000);
                          const remainingSeconds = Math.floor((remainingMs % 60000) / 1000);
                          
                          if (remainingMinutes > 0) {
                            timeoutText = `${remainingMinutes}m ${remainingSeconds}s remaining`;
                          } else {
                            timeoutText = `${remainingSeconds}s remaining`;
                          }
                          isExpired = false;
                        }
                      } else if (approval.status && approval.status !== 'Pending') {
                        // Fallback: check status
                        isExpired = true;
                        timeoutText = 'Expired';
                      }
                      
                      return (
                        <tr 
                          key={approval.approval_uid || index}
                          onClick={() => handleRowClick(approval)}
                          className="pedm-table-row"
                        >
                          {/* User column with avatar */}
                          <td className="pedm-user-cell">
                            <div className="pedm-avatar" style={{ backgroundColor: getUserColor(username) }}>
                              {initials}
                            </div>
                            <div className="pedm-user-details">
                              <div className="pedm-username">
                                {username}
                              </div>
                              {approval.approval_type && (
                                <div className="pedm-approval-type">
                                  {approval.approval_type}
                                </div>
                              )}
                            </div>
                          </td>
                          
                          {/* Application column */}
                          <td className="pedm-text-cell">
                            {applicationDisplay}
                          </td>
                          
                          {/* Justification Message column */}
                          <td className="pedm-text-cell">
                            {approval.justification || '-'}
                          </td>
                          
                          {/* Request Timeout column */}
                          <td className={`pedm-timeout-cell ${isExpired ? 'expired' : 'active'}`}>
                            {timeoutText}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {/* Pagination */}
              {totalPages > 1 && (
                <div className="pedm-pagination">
                  <div className="pedm-pagination-info">
                    Showing {startIndex + 1} to {Math.min(endIndex, filteredApprovals.length)} of {filteredApprovals.length} approvals
                  </div>
                  <div className="pedm-pagination-controls">
                    <Button
                      appearance="default"
                      isDisabled={pedmCurrentPage === 1}
                      onClick={() => setPedmCurrentPage(prev => Math.max(1, prev - 1))}
                    >
                      Previous
                    </Button>
                    <div className="pedm-page-indicator">
                      Page {pedmCurrentPage} of {totalPages}
                    </div>
                    <Button
                      appearance="default"
                      isDisabled={pedmCurrentPage === totalPages}
                      onClick={() => setPedmCurrentPage(prev => Math.min(totalPages, prev + 1))}
                    >
                      Next
                    </Button>
                  </div>
                </div>
              )}
            </>
          ) : (
            <div className="pedm-empty-state">
              <div className="pedm-empty-title">
                {pedmSearchTerm 
                  ? "No matching approvals found" 
                  : showExpiredOnly 
                    ? "No expired approvals" 
                    : "No active approvals"}
              </div>
              <p className="pedm-empty-subtitle">
                {pedmSearchTerm 
                  ? "Try adjusting your search criteria" 
                  : showExpiredOnly
                    ? "There are no expired PEDM approval requests"
                    : "All PEDM approval requests have been processed"}
              </p>
            </div>
          )}
          </div>
          )}
        </>
      )}

      {/* Modal for approval details */}
      {isModalOpen && selectedApproval && (
        <div className="pedm-modal-overlay" onClick={handleCloseModal}>
          <div className="pedm-modal" onClick={(e) => e.stopPropagation()}>
            {/* Modal Header */}
            <div className="pedm-modal-header">
              <h2 className="pedm-modal-title">
                Request Details
              </h2>
            </div>

            {/* Modal Body */}
            <div className="pedm-modal-body">
              {/* User with Approve/Deny buttons */}
              <div className="pedm-modal-user-section">
                <div className="pedm-modal-user-info">
                  <div 
                    className="pedm-avatar"
                    style={{ backgroundColor: getUserColor(
                      selectedApproval.account_info && selectedApproval.account_info.length > 0 
                        ? selectedApproval.account_info[0].replace(/^Username=/i, '')
                        : 'Unknown'
                    ) }}
                  >
                    {(() => {
                      const username = selectedApproval.account_info && selectedApproval.account_info.length > 0 
                        ? selectedApproval.account_info[0].replace(/^Username=/i, '')
                        : 'Unknown';
                      return username.substring(0, 2).toUpperCase();
                    })()}
                  </div>
                  <div className="pedm-user-details">
                    <div className="pedm-username">
                      {selectedApproval.account_info && selectedApproval.account_info.length > 0 
                        ? selectedApproval.account_info[0].replace(/^Username=/i, '')
                        : 'Unknown'}
                    </div>
                    {selectedApproval.approval_type && (
                      <div className="pedm-approval-type">
                        {selectedApproval.approval_type}
                      </div>
                    )}
                  </div>
                </div>
                
                {/* Approve and Deny buttons - only show for non-expired requests */}
                {(() => {
                  // Check if the selected approval is expired
                  let isExpired = false;
                  if (selectedApproval.created && selectedApproval.expire_in) {
                    const createdTime = new Date(selectedApproval.created);
                    const expirationTime = new Date(createdTime.getTime() + selectedApproval.expire_in * 60000);
                    isExpired = currentTime > expirationTime;
                  } else if (selectedApproval.status && selectedApproval.status !== 'Pending') {
                    isExpired = true;
                  }
                  
                  if (!isExpired) {
                    return (
                      <div className="pedm-modal-actions">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleDenyRequest(selectedApproval.approval_uid);
                            handleCloseModal();
                          }}
                          className="pedm-action-btn deny"
                        >
                          <CrossCircleIcon label="Deny" size="small" />
                          Deny
                        </button>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleApproveRequest(selectedApproval.approval_uid);
                            handleCloseModal();
                          }}
                          className="pedm-action-btn approve"
                        >
                          <EditorDoneIcon label="Approve" size="small" />
                          Approve
                        </button>
                      </div>
                    );
                  }
                  return null;
                })()}
              </div>

              {/* Application */}
              <div className="pedm-modal-field">
                <div className="pedm-modal-label">
                  Application
                </div>
                <div className="pedm-modal-value">
                  {(() => {
                    if (selectedApproval.application_info && selectedApproval.application_info.length > 0) {
                      const descField = selectedApproval.application_info.find(info => info.startsWith('Description='));
                      return descField ? descField.replace(/^Description=/i, '') : selectedApproval.application_info[0];
                    }
                    return '-';
                  })()}
                </div>
              </div>

              {/* Time Requested */}
              <div className="pedm-modal-field">
                <div className="pedm-modal-label">
                  Time Requested
                </div>
                <div className="pedm-modal-value">
                  {selectedApproval.expire_in ? `${selectedApproval.expire_in} minutes` : '-'}
                </div>
              </div>

              {/* Justification Message */}
              <div className="pedm-modal-field">
                <div className="pedm-modal-label">
                  Justification Message
                </div>
                <div className="pedm-modal-justification">
                  {selectedApproval.justification || '-'}
                </div>
              </div>

              {/* Request Timeout */}
              <div className="pedm-modal-field">
                <div className="pedm-modal-label">
                  Request Timeout
                </div>
                <div className="pedm-modal-value">
                  {(() => {
                    if (selectedApproval.created && selectedApproval.expire_in) {
                      const createdTime = new Date(selectedApproval.created);
                      const expirationTime = new Date(createdTime.getTime() + selectedApproval.expire_in * 60000);
                      
                      if (currentTime > expirationTime) {
                        return <span className="pedm-timeout-expired">Expired</span>;
                      } else {
                        const remainingMs = expirationTime - currentTime;
                        const remainingMinutes = Math.floor(remainingMs / 60000);
                        const remainingSeconds = Math.floor((remainingMs % 60000) / 1000);
                        const hours = Math.floor(remainingMinutes / 60);
                        const mins = remainingMinutes % 60;
                        
                        if (hours > 0) {
                          return <span className="pedm-timeout-active">{`${hours.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}:${remainingSeconds.toString().padStart(2, '0')} remaining`}</span>;
                        } else {
                          return <span className="pedm-timeout-active">{`${mins.toString().padStart(2, '0')}:${remainingSeconds.toString().padStart(2, '0')} remaining`}</span>;
                        }
                      }
                    }
                    return '-';
                  })()}
                </div>
              </div>

              {/* Requested On */}
              <div className="pedm-modal-field">
                <div className="pedm-modal-label">
                  Requested on
                </div>
                <div className="pedm-modal-value">
                  {selectedApproval.created ? new Date(selectedApproval.created).toLocaleString('en-US', {
                    year: 'numeric',
                    month: 'long',
                    day: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit',
                    second: '2-digit',
                    timeZoneName: 'short'
                  }) : '-'}
                </div>
              </div>

              {/* Operating System and Machine Name in a row */}
              <div className="pedm-modal-row">
                {/* Operating System */}
                <div className="pedm-modal-field">
                  <div className="pedm-modal-label">
                    Operating System
                  </div>
                  <div className="pedm-modal-value">
                    {(() => {
                      if (selectedApproval.application_info && selectedApproval.application_info.length > 0) {
                        const osField = selectedApproval.application_info.find(info => info.startsWith('Operating System='));
                        return osField ? osField.replace(/^Operating System=/i, '') : '-';
                      }
                      return '-';
                    })()}
                  </div>
                </div>

                {/* Machine Name */}
                <div className="pedm-modal-field">
                  <div className="pedm-modal-label">
                    Machine Name
                  </div>
                  <div className="pedm-modal-value">
                    {(() => {
                      if (selectedApproval.application_info && selectedApproval.application_info.length > 0) {
                        const machineField = selectedApproval.application_info.find(info => info.startsWith('Hostname='));
                        return machineField ? machineField.replace(/^Hostname=/i, '') : '-';
                      }
                      return '-';
                    })()}
                  </div>
                </div>
              </div>
            </div>

            {/* Modal Footer */}
            <div className="pedm-modal-footer">
              <button
                onClick={handleCloseModal}
                className="pedm-modal-close-btn"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};

export default PedmTab;
