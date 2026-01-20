/**
 * Label Builder Utilities
 * Generates appropriate labels for Jira tickets
 */

/**
 * Build ticket labels from webhook payload only
 * Uses only the data from the webhook, not from API response
 */
export function buildTicketLabels(payload, approvalDetails = null) {
  const labels = ['keeper-webhook'];
  
  // Add category label (e.g., endpoint-privilege-manager)
  if (payload.category) {
    labels.push(payload.category.toLowerCase().replace(/_/g, '-'));
  }
  
  // Add audit event label (e.g., approval-request-created)
  if (payload.audit_event) {
    labels.push(payload.audit_event.toLowerCase().replace(/_/g, '-'));
  }

  // Note: approvalDetails parameter kept for compatibility but not used
  // Labels are kept minimal - only category and audit event

  return labels;
}

