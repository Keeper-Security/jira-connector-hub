import React, { useState, useEffect } from "react";
import SectionMessage from "@atlaskit/section-message";
import Spinner from "@atlaskit/spinner";
import LockIcon from "@atlaskit/icon/glyph/lock";
import CrossIcon from "@atlaskit/icon/glyph/cross";

import * as api from "../../services/api";

const DetailRow = ({ label, value }) => {
  if (value === undefined || value === null || value === "") return null;

  return (
    <li>
      <strong>{label}:</strong> {String(value)}
    </li>
  );
};

const DeviceRequestDetailsBlock = ({ payload }) => {
  if (!payload) return null;

  const requester =
    payload.username ||
    payload.email ||
    payload.user?.email ||
    payload.account_info?.Username ||
    payload.account_info?.username;
  const deviceIdentifier =
    payload.device_id ||
    payload.deviceId ||
    payload.device_uid ||
    payload.encrypted_device_token ||
    payload.device_token;

  return (
    <div className="message-box-dynamic message-box-admin">
      <div className="message-box-title-admin">Request Details</div>
      <div className="message-box-text">
        <ul>
          <DetailRow label="Requester" value={requester} />
          <DetailRow label="Client Version" value={payload.client_version} />
          <DetailRow label="Remote Address" value={payload.remote_address} />
          <DetailRow label="Timestamp" value={payload.timestamp || payload.created} />
          <DetailRow label="Device Identifier" value={deviceIdentifier} />
          <DetailRow label="Device Name" value={payload.device_name} />
          <DetailRow label="Machine Name" value={payload.machine_name || payload.machineName || payload.hostname} />
        </ul>
      </div>
    </div>
  );
};

/**
 * Panel rendered for tickets that the JIRA ITSM Forge app has tagged with the
 * `ITSM_device_admin_approval_requested` label.
 *
 * Approve/Deny call Keeper Commander via `executeKeeperAction` using the
 * canonical CLI form (positional first, flag after):
 *   device-approve <user_email_or_device_id> --approve
 *   device-approve <user_email_or_device_id> --deny
 *
 * The CLI's positional parameter accepts either a user email OR a device ID
 * (partial match supported on the ID), so we prefer the username from the
 * audit_event payload and fall back to device-id-style fields. See:
 *   https://docs.keeper.io/en/keeperpam/commander-cli/command-reference/enterprise-management-commands#device-approve-command
 *
 * The backend adds a `device-approved` / `device-denied` label and an audit
 * comment on success, so the panel can detect the state on subsequent loads
 * via `checkDeviceActionTaken`.
 *
 * Unlike the EPM panel, device approvals do NOT auto-expire here — admins can
 * action them at any time until the request is approved or denied.
 */
const DeviceApprovalPanel = ({ issueContext }) => {
  const [loading, setLoading] = useState(true);
  const [itsmPayload, setItsmPayload] = useState(null);
  const [error, setError] = useState(null);
  const [actionInProgress, setActionInProgress] = useState(null); // 'approve' | 'deny' | null
  const [actionResult, setActionResult] = useState(null);
  // Set to true when the underlying Keeper request was approved/denied
  // outside Jira; we render a warning panel and hide the action buttons.
  const [processedOutsideJira, setProcessedOutsideJira] = useState(false);

  useEffect(() => {
    loadItsmPayload();
  }, [issueContext]);

  const loadItsmPayload = async () => {
    if (!issueContext?.issueKey) {
      setError("Issue context not available");
      setLoading(false);
      return;
    }

    try {
      setLoading(true);

      // 1) Was this ticket already approved/denied/processed-outside? If so,
      // render the resolved state and skip the action buttons entirely.
      const actionCheck = await api.checkDeviceActionTaken(issueContext.issueKey);
      if (actionCheck.success && actionCheck.actionTaken) {
        if (actionCheck.action === 'approved') {
          setActionResult({
            success: true,
            message: "Device approval request has been approved successfully"
          });
        } else if (actionCheck.action === 'denied') {
          setActionResult({
            success: true,
            message: "Device approval request has been denied successfully"
          });
        } else if (actionCheck.action === 'processed_outside') {
          setProcessedOutsideJira(true);
          setActionResult({
            success: true,
            message: actionCheck.message
          });
        }

        const result = await api.getItsmTicketData(issueContext.issueKey);
        if (result.success && result.payload) {
          setItsmPayload(result.payload);
        }
        setLoading(false);
        return;
      }

      // 2) Load the ITSM payload so we can render context + extract the target.
      const result = await api.getItsmTicketData(issueContext.issueKey);

      if (result.success && result.payload) {
        setItsmPayload(result.payload);
        setError(null);
      } else {
        setError("No device approval payload found in this ticket");
        setLoading(false);
        return;
      }

      // 3) Pre-flight: confirm the request is still pending in Keeper. If a
      // different admin already approved/denied it via the Keeper Admin
      // Console, tag the ticket and skip the buttons. Best-effort — if Keeper
      // is unreachable here we still show the buttons and let the actual
      // Approve/Deny call (which re-runs the same check) report the error.
      try {
        const pendingCheck = await api.checkDevicePendingStatus(issueContext.issueKey);
        if (pendingCheck.success && pendingCheck.pending === false) {
          setProcessedOutsideJira(true);
          setActionResult({
            success: true,
            message: pendingCheck.message ||
              "This device approval request was already processed outside Jira."
          });
        }
      } catch (pendingErr) {
        console.warn("Device pending pre-check failed:", pendingErr);
      }
    } catch (err) {
      console.error("Failed to load ITSM ticket data:", err);
      setError("Failed to load device approval request data");
    } finally {
      setLoading(false);
    }
  };

  // Resolve which value to pass to `device-approve <X> --approve|--deny`.
  // Keeper's CLI accepts either the user's email or a device ID, so we prefer
  // the email coming off the audit_event (most reliable, always present), and
  // fall back to device-id-style fields the webhook may include for the
  // specific device that triggered the request.
  const getDeviceTarget = () =>
    itsmPayload?.username ||
    itsmPayload?.email ||
    itsmPayload?.user?.email ||
    itsmPayload?.account_info?.Username ||
    itsmPayload?.device_id ||
    itsmPayload?.deviceId ||
    itsmPayload?.device_uid ||
    itsmPayload?.encrypted_device_token ||
    itsmPayload?.device_token ||
    null;

  const runAction = async (verb) => {
    const target = getDeviceTarget();

    if (!target) {
      setActionResult({
        success: false,
        message: "No user email or device ID found on this ticket"
      });
      return;
    }

    setActionInProgress(verb);
    setActionResult(null);

    // Canonical Keeper Commander form (positional first, then flag), per:
    //   device-approve John.Doe@gmail.com --approve
    //   device-approve 1234hgghjjhg234gh123 --deny
    const flag = verb === 'approve' ? '--approve' : '--deny';
    const cliCommand = `device-approve ${target} ${flag}`;
    const description = `Device Admin Approval: ${verb === 'approve' ? 'Approved' : 'Denied'} ${target}`;

    try {
      const result = await api.executeKeeperAction(
        issueContext.issueKey,
        cliCommand,
        description,
        { cliCommand },
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

      // Race handling: between load and click, the request may have been
      // resolved outside Jira. The backend pre-check returns this code and
      // has already tagged the ticket; reflect the resolved state in the UI.
      if (
        !result.success &&
        result.code === 'DEVICE_ALREADY_PROCESSED_OUTSIDE_JIRA'
      ) {
        setProcessedOutsideJira(true);
        setActionResult({
          success: true,
          message:
            result.message ||
            "This device approval request was already processed outside Jira."
        });
      } else {
        setActionResult({
          success: result.success,
          message: result.success
            ? `Device approval request has been ${verb === 'approve' ? 'approved' : 'denied'} successfully`
            : result.message || `Failed to ${verb} device approval request`
        });
      }
    } catch (err) {
      console.error(`Failed to ${verb} device:`, err);
      setActionResult({
        success: false,
        message: err.message || `An error occurred while ${verb === 'approve' ? 'approving' : 'denying'} the request`
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

  if (error || !itsmPayload) {
    return (
      <div className="app-root app-root-auto">
        <div className="app-card">
          <div className="app-header">
            <LockIcon size="medium" primaryColor="#FFD700" />
            <h3 className="app-title">Device Admin Approval</h3>
          </div>
          <div className="app-body">
            <SectionMessage appearance="error" title="Error">
              <p>{error || "No device approval payload found in this ticket."}</p>
            </SectionMessage>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="app-root app-root-auto">
      <div className="app-card">
        <div className="app-header">
          <LockIcon size="medium" primaryColor="#FFD700" />
          <h3 className="app-title">Device Admin Approval</h3>
        </div>

        {actionResult && actionResult.success && processedOutsideJira && (
          <div className="message-box-dynamic message-box-admin">
            <div className="message-box-title-admin">
              Already Processed Outside Jira
            </div>
            <div className="message-box-text">{actionResult.message}</div>
          </div>
        )}

        {actionResult && actionResult.success && !processedOutsideJira && (
          <div className="message-box-dynamic message-box-user">
            <div className="message-box-title-user">Success Message</div>
            <div className="message-box-text">{actionResult.message}</div>
          </div>
        )}

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

        <DeviceRequestDetailsBlock payload={itsmPayload} />

        {!actionResult && (
          <div className="message-box-dynamic message-box-admin">
            <div className="message-box-title-admin">Info Message</div>
            <div className="message-box-text">
              Review the device admin approval details in the ticket description above, then choose an action below.
              This request stays open until you approve or deny it.
            </div>
          </div>
        )}

        {!actionResult && (
          <div className="flex-gap-12">
            <button
              onClick={() => runAction('approve')}
              disabled={actionInProgress !== null}
              className={`epm-approve-btn ${actionInProgress === 'approve' ? 'epm-btn-loading' : ''}`}
            >
              {actionInProgress === 'approve' ? 'Processing...' : 'Approve Device'}
            </button>
            <button
              onClick={() => runAction('deny')}
              disabled={actionInProgress !== null}
              className="epm-reject-btn"
            >
              {actionInProgress === 'deny' ? 'Processing...' : 'Deny Device'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

export default DeviceApprovalPanel;
