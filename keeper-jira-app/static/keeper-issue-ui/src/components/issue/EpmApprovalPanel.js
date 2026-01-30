import React, { useState, useEffect, useRef } from "react";
import Button from "@atlaskit/button";
import SectionMessage from "@atlaskit/section-message";
import Spinner from "@atlaskit/spinner";
import LockIcon from "@atlaskit/icon/glyph/lock";
import CrossIcon from "@atlaskit/icon/glyph/cross";

import * as api from "../../services/api";

const EpmApprovalPanel = ({ issueContext }) => {
  const [loading, setLoading] = useState(true);
  const [webhookPayload, setWebhookPayload] = useState(null);
  const [error, setError] = useState(null);
  const [actionInProgress, setActionInProgress] = useState(null); // 'approve', 'deny', or null
  const [actionResult, setActionResult] = useState(null);
  const [isExpired, setIsExpired] = useState(false);
  const [timeRemaining, setTimeRemaining] = useState(null);
  const [expiredCommentAdded, setExpiredCommentAdded] = useState(false);
  const expiredCommentInProgress = useRef(false); // Synchronous lock for preventing race conditions

  useEffect(() => {
    loadWebhookPayload();
  }, [issueContext]);

  // Update timer every second
  useEffect(() => {
    if (!webhookPayload || isExpired || actionResult) return;

    const updateTimer = () => {
      const timestamp = webhookPayload.created || webhookPayload.timestamp;
      if (!timestamp) return;

      const requestTime = new Date(timestamp);
      const expirationTime = new Date(requestTime.getTime() + 30 * 60 * 1000); // 30 minutes from request
      const currentTime = new Date();
      const diffInMs = expirationTime - currentTime;

      if (diffInMs <= 0) {
        setIsExpired(true);
        setTimeRemaining(null);
        // Add expired comment if not already added
        if (!expiredCommentAdded) {
          addExpiredComment();
        }
      } else {
        const minutes = Math.floor(diffInMs / (1000 * 60));
        const seconds = Math.floor((diffInMs % (1000 * 60)) / 1000);
        setTimeRemaining({ minutes, seconds });
      }
    };

    updateTimer(); // Initial update
    const interval = setInterval(updateTimer, 1000); // Update every second

    return () => clearInterval(interval);
  }, [webhookPayload, isExpired, actionResult, expiredCommentAdded]);

  const addExpiredComment = async () => {
    // Synchronous check to prevent race conditions at frontend level
    if (!issueContext?.issueKey || expiredCommentAdded || expiredCommentInProgress.current) {
      return;
    }
    
    // Set synchronous lock immediately
    expiredCommentInProgress.current = true;
    setExpiredCommentAdded(true);
    
    try {
      const formattedTimestamp = new Date().toLocaleString('en-US', {
        month: '2-digit',
        day: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false
      });
      
      await api.addEpmExpiredComment(issueContext.issueKey, formattedTimestamp);
    } catch (err) {
      console.error("Failed to add expired comment:", err);
      // Don't reset the lock even on error to prevent retry loops
    }
  };

  const loadWebhookPayload = async () => {
    if (!issueContext?.issueKey) {
      setError("Issue context not available");
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      
      // First, check if any action was already taken (comment already exists)
      const actionCheck = await api.checkEpmActionTaken(issueContext.issueKey);
      if (actionCheck.success && actionCheck.actionTaken) {
        // Action already taken - set appropriate state based on action type
        if (actionCheck.action === 'approved') {
          setActionResult({ 
            success: true, 
            message: "Approval request has been approved successfully" 
          });
        } else if (actionCheck.action === 'denied') {
          setActionResult({ 
            success: true, 
            message: "Approval request has been denied successfully" 
          });
        } else if (actionCheck.action === 'expired') {
          setIsExpired(true);
          setExpiredCommentAdded(true);
          expiredCommentInProgress.current = true; // Set lock
        }
        
        // Still load payload for display, but don't show buttons
        const result = await api.getWebhookPayload(issueContext.issueKey);
        if (result.success && result.payload) {
          setWebhookPayload(result.payload);
        }
        setLoading(false);
        return;
      }
      
      // Check if the request is already marked as expired in backend
      const expiredCheck = await api.checkEpmExpired(issueContext.issueKey);
      if (expiredCheck.success && expiredCheck.isExpired) {
        setIsExpired(true);
        setExpiredCommentAdded(true);
        expiredCommentInProgress.current = true; // Set lock
      }
      
      const result = await api.getWebhookPayload(issueContext.issueKey);
      
      if (result.success && result.payload) {
        setWebhookPayload(result.payload);
        setError(null);
        
        // If not already marked as expired, check timestamp
        if (!expiredCheck.isExpired) {
          if (result.payload.created || result.payload.timestamp) {
            const requestTime = new Date(result.payload.created || result.payload.timestamp);
            const currentTime = new Date();
            const diffInMinutes = (currentTime - requestTime) / (1000 * 60);
            
            if (diffInMinutes > 30) {
              setIsExpired(true);
              // Add expired comment if not already added
              if (!expiredCommentAdded) {
                addExpiredComment();
              }
            } else {
              setIsExpired(false);
            }
          } else {
            // If no timestamp, assume not expired
            setIsExpired(false);
          }
        }
      } else {
        setError("No webhook payload found in this ticket");
      }
    } catch (err) {
      console.error("Failed to load webhook payload:", err);
      setError("Failed to load approval request data");
    } finally {
      setLoading(false);
    }
  };

  const handleApprove = async () => {
    // Check both fields because:
    // - Tickets created with webhook payload fallback have: request_uid
    // - Tickets created with Keeper API enriched data have: approval_uid
    const requestUid = webhookPayload?.request_uid || webhookPayload?.approval_uid;
    
    if (!requestUid) {
      setActionResult({ success: false, message: "Request UID not found" });
      return;
    }

    setActionInProgress('approve');
    setActionResult(null);

    try {
      const command = `epm approval action --approve ${requestUid}`;
      const result = await api.executeKeeperAction(
        issueContext.issueKey,
        command,
        `EPM Approval: Approved request ${requestUid}`,
        { cliCommand: command },
        new Date().toLocaleString('en-US', {
          month: '2-digit',
          day: '2-digit',
          year: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
          hour12: false
        })
      );

      setActionResult({
        success: result.success,
        message: result.success 
          ? "Approval request has been approved successfully" 
          : result.message || "Failed to approve request"
      });
    } catch (err) {
      console.error("Failed to approve request:", err);
      setActionResult({
        success: false,
        message: err.message || "An error occurred while approving the request"
      });
    } finally {
      setActionInProgress(null);
    }
  };

  const handleDeny = async () => {
    // Check both fields because:
    // - Tickets created with webhook payload fallback have: request_uid
    // - Tickets created with Keeper API enriched data have: approval_uid
    const requestUid = webhookPayload?.request_uid || webhookPayload?.approval_uid;
    
    if (!requestUid) {
      setActionResult({ success: false, message: "Request UID not found" });
      return;
    }

    setActionInProgress('deny');
    setActionResult(null);

    try {
      const command = `epm approval action --deny ${requestUid}`;
      const result = await api.executeKeeperAction(
        issueContext.issueKey,
        command,
        `EPM Approval: Denied request ${requestUid}`,
        { cliCommand: command },
        new Date().toLocaleString('en-US', {
          month: '2-digit',
          day: '2-digit',
          year: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
          hour12: false
        })
      );

      setActionResult({
        success: result.success,
        message: result.success 
          ? "Approval request has been denied successfully" 
          : result.message || "Failed to deny request"
      });
    } catch (err) {
      console.error("Failed to deny request:", err);
      setActionResult({
        success: false,
        message: err.message || "An error occurred while denying the request"
      });
    } finally {
      setActionInProgress(null);
    }
  };

  if (loading) {
    return (
      <div className="loading-container-centered">
        <Spinner size="medium" />
        <p className="loading-text">Loading...</p>
      </div>
    );
  }

  if (error || !webhookPayload) {
    return (
      <div className="app-root app-root-auto">
        <div className="app-card">
          <div className="app-header">
            <LockIcon size="medium" primaryColor="#FFD700" />
            <h3 className="app-title">Endpoint Privilege Management</h3>
          </div>
          <div className="app-body">
            <SectionMessage appearance="error" title="Error">
              <p>{error || "No webhook payload found in this ticket."}</p>
            </SectionMessage>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="app-root app-root-auto">
      <div className="app-card">
        {/* Header */}
        <div className="app-header">
          <LockIcon size="medium" primaryColor="#FFD700" />
          <h3 className="app-title">Endpoint Privilege Management</h3>
        </div>

        {/* Success Message - No close button for successful actions */}
        {actionResult && actionResult.success && (
          <div className="message-box-dynamic message-box-user">
            <div className="message-box-title-user">Success Message</div>
            <div className="message-box-text">{actionResult.message}</div>
          </div>
        )}

        {/* Error Message */}
        {actionResult && !actionResult.success && (
          <div className="message-box-dynamic message-box-error">
            <button
              onClick={() => setActionResult(null)}
              className="close-button-absolute"
              title="Dismiss"
            >
              <CrossIcon size="small" label="Close" primaryColor="#BF2600" />
            </button>
            <div className="message-box-title-error">Error Message</div>
            <div className="message-box-text">{actionResult.message}</div>
          </div>
        )}

        {/* Expired Message */}
        {!actionResult && isExpired && (
          <div className="message-box-dynamic message-box-warning">
            <div className="message-box-title-warning">Request Expired</div>
            <div className="message-box-text">
              This approval request has expired. Requests are only valid for 30 minutes from the time they were created.
            </div>
          </div>
        )}

        {/* Info Message */}
        {!actionResult && !isExpired && (
          <div className="message-box-dynamic message-box-admin">
            <div className="message-box-title-admin">Info Message</div>
            <div className="message-box-text">
              Review the approval request details in the ticket description above, then choose an action below.
            </div>
            {timeRemaining && (
              <div className="epm-timer">
                Time to expire: <strong>{timeRemaining.minutes}m {timeRemaining.seconds}s</strong>
              </div>
            )}
          </div>
        )}

        {/* Action Buttons - Only show if not expired and no action result */}
        {!isExpired && !actionResult && (
          <div className="flex-gap-12">
            <button
              onClick={handleApprove}
              disabled={actionInProgress !== null}
              className={`epm-approve-btn ${actionInProgress === 'approve' ? 'epm-btn-loading' : ''}`}
            >
              {actionInProgress === 'approve' ? 'Processing...' : 'Approve Request'}
            </button>
            <button
              onClick={handleDeny}
              disabled={actionInProgress !== null}
              className="epm-reject-btn"
            >
              {actionInProgress === 'deny' ? 'Processing...' : 'Deny Request'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

export default EpmApprovalPanel;

