/**
 * ADF (Atlassian Document Format) Builder Utilities
 * Builds rich formatted descriptions for Jira tickets
 */

/**
 * Build enriched ticket description from PEDM approval details
 */
export function buildEnrichedTicketDescription(approvalDetails, payload) {
  const accountInfo = approvalDetails.account_info || {};
  const appInfo = approvalDetails.application_info || {};
  
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
          { type: 'text', text: accountInfo.Username || 'N/A' }
        ]}] },
        { type: 'listItem', content: [{ type: 'paragraph', content: [
          { type: 'text', text: 'Justification: ', marks: [{ type: 'strong' }] },
          { type: 'text', text: approvalDetails.justification || 'N/A' }
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

  // Add application details if available
  if (appInfo.FileName || appInfo.CommandLine) {
    content.push({ type: 'heading', attrs: { level: 4 }, content: [{ type: 'text', text: 'Application Details' }] });
    const appDetails = [];
    
    if (appInfo.FileName) {
      appDetails.push({ type: 'listItem', content: [{ type: 'paragraph', content: [
        { type: 'text', text: 'File Name: ', marks: [{ type: 'strong' }] },
        { type: 'text', text: appInfo.FileName }
      ]}] });
    }
    if (appInfo.FilePath) {
      appDetails.push({ type: 'listItem', content: [{ type: 'paragraph', content: [
        { type: 'text', text: 'File Path: ', marks: [{ type: 'strong' }] },
        { type: 'text', text: appInfo.FilePath }
      ]}] });
    }
    if (appInfo.CommandLine) {
      appDetails.push({ type: 'listItem', content: [{ type: 'paragraph', content: [
        { type: 'text', text: 'Command: ', marks: [{ type: 'strong' }] },
        { type: 'text', text: appInfo.CommandLine, marks: [{ type: 'code' }] }
      ]}] });
    }
    if (appInfo.Description) {
      appDetails.push({ type: 'listItem', content: [{ type: 'paragraph', content: [
        { type: 'text', text: 'Description: ', marks: [{ type: 'strong' }] },
        { type: 'text', text: appInfo.Description }
      ]}] });
    }
    
    if (appDetails.length > 0) {
      content.push({ type: 'bulletList', content: appDetails });
    }
  }

  // Add full API response
  content.push({ type: 'heading', attrs: { level: 4 }, content: [{ type: 'text', text: 'Full API Response' }] });
  content.push({ 
    type: 'codeBlock', 
    attrs: { language: 'json' }, 
    content: [{ type: 'text', text: JSON.stringify(approvalDetails, null, 2) }] 
  });

  return { type: 'doc', version: 1, content };
}

/**
 * Build basic ticket description from webhook payload (fallback)
 */
export function buildBasicTicketDescription(payload) {
  const content = [
    { type: 'heading', attrs: { level: 3 }, content: [{ type: 'text', text: 'Keeper Security Alert' }] },
    { type: 'paragraph', content: [{ type: 'text', text: payload.description || payload.message || 'Security alert from Keeper.' }] },
    { type: 'heading', attrs: { level: 4 }, content: [{ type: 'text', text: 'Alert Details' }] }
  ];

  const alertDetails = [];
  const fields = [
    { key: 'alert_name', label: 'Alert Name' },
    { key: 'audit_event', label: 'Audit Event' },
    { key: 'category', label: 'Category' },
    { key: 'username', label: 'Username' },
    { key: 'remote_address', label: 'Remote Address' },
    { key: 'timestamp', label: 'Timestamp' },
    { key: 'agent_uid', label: 'Agent UID' },
    { key: 'request_uid', label: 'Request UID' }
  ];

  fields.forEach(field => {
    if (payload[field.key]) {
      alertDetails.push({
        type: 'listItem',
        content: [{ type: 'paragraph', content: [
          { type: 'text', text: `${field.label}: `, marks: [{ type: 'strong' }] },
          { type: 'text', text: String(payload[field.key]) }
        ]}]
      });
    }
  });

  if (alertDetails.length > 0) {
    content.push({ type: 'bulletList', content: alertDetails });
  }

  // Add full payload
  content.push({ type: 'heading', attrs: { level: 4 }, content: [{ type: 'text', text: 'Full Payload' }] });
  content.push({ 
    type: 'codeBlock', 
    attrs: { language: 'json' }, 
    content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }] 
  });

  return { type: 'doc', version: 1, content };
}

