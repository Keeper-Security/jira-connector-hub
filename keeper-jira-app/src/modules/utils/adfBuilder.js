/**
 * ADF (Atlassian Document Format) Builder Utilities
 * Builds rich formatted descriptions for Jira tickets
 * 
 * Security: Applies sensitive data redaction to prevent information disclosure
 * to users with "Browse Projects" permission (Issue #10)
 */

import {
  redactUsername,
  redactCommand,
  redactFilePath,
  truncateJustification,
  redactSensitiveObject
} from './sensitiveDataRedactor.js';

/**
 * Build enriched ticket description from PEDM approval details
 * Applies redaction to sensitive data (Issue #10)
 */
export function buildEnrichedTicketDescription(approvalDetails, payload) {
  const accountInfo = approvalDetails.account_info || {};
  const appInfo = approvalDetails.application_info || {};
  
  // Apply redaction to sensitive fields
  const redactedUsername = redactUsername(accountInfo.Username) || 'N/A';
  const redactedJustification = truncateJustification(approvalDetails.justification) || 'N/A';
  const redactedCommand = appInfo.CommandLine ? redactCommand(appInfo.CommandLine) : null;
  const redactedFilePath = appInfo.FilePath ? redactFilePath(appInfo.FilePath) : null;
  
  const content = [
    { type: 'heading', attrs: { level: 3 }, content: [{ type: 'text', text: 'KEPM Approval Request' }] },
    { type: 'heading', attrs: { level: 4 }, content: [{ type: 'text', text: 'Request Details' }] },
    {
      type: 'bulletList',
      content: [
        { type: 'listItem', content: [{ type: 'paragraph', content: [
          { type: 'text', text: 'Request UID: ', marks: [{ type: 'strong' }] },
          { type: 'text', text: approvalDetails.approval_uid || 'N/A' }
        ]}] },
        { type: 'listItem', content: [{ type: 'paragraph', content: [
          { type: 'text', text: 'Status: ', marks: [{ type: 'strong' }] },
          { type: 'text', text: approvalDetails.status || 'Pending' }
        ]}] },
        { type: 'listItem', content: [{ type: 'paragraph', content: [
          { type: 'text', text: 'Approval Type: ', marks: [{ type: 'strong' }] },
          { type: 'text', text: approvalDetails.approval_type || 'N/A' }
        ]}] },
        { type: 'listItem', content: [{ type: 'paragraph', content: [
          { type: 'text', text: 'Username: ', marks: [{ type: 'strong' }] },
          { type: 'text', text: redactedUsername }
        ]}] },
        { type: 'listItem', content: [{ type: 'paragraph', content: [
          { type: 'text', text: 'Justification: ', marks: [{ type: 'strong' }] },
          { type: 'text', text: redactedJustification }
        ]}] },
        { type: 'listItem', content: [{ type: 'paragraph', content: [
          { type: 'text', text: 'Created: ', marks: [{ type: 'strong' }] },
          { type: 'text', text: approvalDetails.created || 'N/A' }
        ]}] },
        { type: 'listItem', content: [{ type: 'paragraph', content: [
          { type: 'text', text: 'Expires In: ', marks: [{ type: 'strong' }] },
          { type: 'text', text: `${approvalDetails.expire_in || 0} minutes` }
        ]}] }
      ]
    }
  ];

  // Add application details if available (with redacted sensitive data)
  if (appInfo.FileName || appInfo.CommandLine) {
    content.push({ type: 'heading', attrs: { level: 4 }, content: [{ type: 'text', text: 'Application Details' }] });
    const appDetails = [];
    
    if (appInfo.FileName) {
      appDetails.push({ type: 'listItem', content: [{ type: 'paragraph', content: [
        { type: 'text', text: 'File Name: ', marks: [{ type: 'strong' }] },
        { type: 'text', text: appInfo.FileName }
      ]}] });
    }
    if (redactedFilePath) {
      appDetails.push({ type: 'listItem', content: [{ type: 'paragraph', content: [
        { type: 'text', text: 'File: ', marks: [{ type: 'strong' }] },
        { type: 'text', text: redactedFilePath }
      ]}] });
    }
    if (redactedCommand) {
      appDetails.push({ type: 'listItem', content: [{ type: 'paragraph', content: [
        { type: 'text', text: 'Command: ', marks: [{ type: 'strong' }] },
        { type: 'text', text: redactedCommand, marks: [{ type: 'code' }] }
      ]}] });
    }
    if (appInfo.Description) {
      appDetails.push({ type: 'listItem', content: [{ type: 'paragraph', content: [
        { type: 'text', text: 'Description: ', marks: [{ type: 'strong' }] },
        { type: 'text', text: truncateJustification(appInfo.Description, 150) }
      ]}] });
    }
    
    if (appDetails.length > 0) {
      content.push({ type: 'bulletList', content: appDetails });
    }
  }

  // Add redacted API response (for admin reference, with sensitive data redacted)
  content.push({ type: 'heading', attrs: { level: 4 }, content: [{ type: 'text', text: 'API Response (Redacted)' }] });
  content.push({ 
    type: 'codeBlock', 
    attrs: { language: 'json' }, 
    content: [{ type: 'text', text: JSON.stringify(redactSensitiveObject(approvalDetails), null, 2) }] 
  });

  return { type: 'doc', version: 1, content };
}

/**
 * Build basic ticket description from webhook payload (fallback)
 * Applies redaction to sensitive data (Issue #10)
 */
export function buildBasicTicketDescription(payload) {
  // Apply redaction to description
  const redactedDescription = truncateJustification(
    payload.description || payload.message || 'Security alert from Keeper.',
    200
  );
  
  const content = [
    { type: 'heading', attrs: { level: 3 }, content: [{ type: 'text', text: 'Keeper Security Alert' }] },
    { type: 'paragraph', content: [{ type: 'text', text: redactedDescription }] },
    { type: 'heading', attrs: { level: 4 }, content: [{ type: 'text', text: 'Alert Details' }] }
  ];

  // Define fields with redaction functions
  const fields = [
    { key: 'alert_name', label: 'Alert Name', redact: null },
    { key: 'audit_event', label: 'Audit Event', redact: null },
    { key: 'category', label: 'Category', redact: null },
    { key: 'username', label: 'Username', redact: redactUsername },
    { key: 'remote_address', label: 'Source', redact: () => '[REDACTED]' },
    { key: 'timestamp', label: 'Timestamp', redact: null },
    { key: 'agent_uid', label: 'Agent UID', redact: null },
    { key: 'request_uid', label: 'Request UID', redact: null }
  ];

  const alertDetails = [];
  
  fields.forEach(field => {
    if (payload[field.key]) {
      // Apply redaction if defined, otherwise use raw value
      const value = field.redact 
        ? field.redact(String(payload[field.key]))
        : String(payload[field.key]);
      
      alertDetails.push({
        type: 'listItem',
        content: [{ type: 'paragraph', content: [
          { type: 'text', text: `${field.label}: `, marks: [{ type: 'strong' }] },
          { type: 'text', text: value }
        ]}]
      });
    }
  });

  if (alertDetails.length > 0) {
    content.push({ type: 'bulletList', content: alertDetails });
  }

  // Add redacted payload (for admin reference)
  content.push({ type: 'heading', attrs: { level: 4 }, content: [{ type: 'text', text: 'Payload (Redacted)' }] });
  content.push({ 
    type: 'codeBlock', 
    attrs: { language: 'json' }, 
    content: [{ type: 'text', text: JSON.stringify(redactSensitiveObject(payload), null, 2) }] 
  });

  return { type: 'doc', version: 1, content };
}

