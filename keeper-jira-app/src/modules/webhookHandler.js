/**
 * Webhook Handler Module
 * Handles incoming webhooks from Keeper Security and creates Jira tickets
 *
 * Pre-publication review: See PR #3 for security findings (Issues #2, #4, #7, #9, #10)
 */

import { storage, asApp, route } from '@forge/api';
import { fetchPedmApprovalDetails } from './keeperApi.js';
import { buildEnrichedTicketDescription, buildBasicTicketDescription } from './utils/adfBuilder.js';
import { buildTicketLabels } from './utils/labelBuilder.js';

/**
 * Web trigger handler - receives Keeper Security alerts and creates Jira issues
 * @param {Object} request - Incoming webhook request
 * @returns {Promise<Object>} - HTTP response
 */
export async function webTriggerHandler(request) {
  // TODO: PR #3 Issue #2 - No Webhook Authentication
  // Web trigger accepts any POST request without authentication. Atlassian Forge web triggers
  // have no built-in auth (https://developer.atlassian.com/platform/forge/manifest-reference/modules/web-trigger/).
  // Need to implement token validation (query param: ?token=<secret> or Authorization header).
  // See PR #3 Issue #2 for layered implementation approach.

  // TODO: PR #3 Issue #4 - No Rate Limiting
  // No limits on webhook submissions. Attacker could spam 1000s of requests.
  // Need per-source rate limiting (50/hour) to prevent ticket spam and Jira API exhaustion.

  try {
    // Get the web trigger configuration
    const config = await storage.get('webTriggerConfig');
    
    if (!config || !config.projectKey || !config.issueType) {
      return {
        statusCode: 400,
        body: JSON.stringify({
          success: false,
          error: 'Web trigger not configured. Please configure project and issue type in the Keeper app settings.'
        })
      };
    }
    
    // Parse the incoming request body
    const payload = request.body ? JSON.parse(request.body) : {};
    
    // Validate that this is an endpoint privilege manager approval request
    if (payload.category !== 'endpoint_privilege_manager' || payload.audit_event !== 'approval_request_created') {
      return {
        statusCode: 200,
        body: JSON.stringify({
          success: true,
          message: 'Webhook received but skipped - only endpoint_privilege_manager approval_request_created events create tickets',
          category: payload.category,
          audit_event: payload.audit_event
        })
      };
    }
    
    // Extract request_uid
    const requestUid = payload.request_uid || payload.requestUid || new Date().toISOString();
    
    // Check if a ticket already exists for this request_uid (prevent duplicates)
    // Using storage for atomic check-and-set to prevent race conditions
    const sanitizedUid = requestUid.replace(/[^a-zA-Z0-9_-]/g, '-');
    const uidLabel = `request-${sanitizedUid}`;
    const storageKey = `webhook-processed-${sanitizedUid}`;
    
    // First check storage (faster and atomic)
    // TODO: PR #3 Issue #7 - Storage API Retry Logic
    // Storage calls can fail with HTTP 429 rate limit errors under load.
    // Need retry wrapper with exponential backoff (1s, 2s, 4s) + jitter per Forge best practices.
    // Reference: https://developer.atlassian.com/platform/forge/storage-api-limit-handling/
    const existingTicket = await storage.get(storageKey);
    if (existingTicket) {
      return {
        statusCode: 200,
        body: JSON.stringify({
          success: true,
          message: 'Duplicate webhook - ticket already exists',
          issueKey: existingTicket.issueKey,
          issueId: existingTicket.issueId,
          duplicate: true
        })
      };
    }
    
    // Also check Jira in case storage was cleared but ticket exists
    // TODO: PR #3 Issue #9 - 2026 Rate Limit Compliance
    // No retry logic for 429 responses. Starting March 2, 2026, Jira API enforces point-based
    // rate limits. Need retry wrapper with exponential backoff + respect Retry-After header.
    // Reference: https://community.developer.atlassian.com/t/2026-point-based-rate-limits/97828
    const searchResponse = await asApp().requestJira(
      route`/rest/api/3/search?jql=${encodeURIComponent(`labels = "${uidLabel}"`)}`
    );
    
    if (searchResponse.ok) {
      const searchResults = await searchResponse.json();
      if (searchResults.issues && searchResults.issues.length > 0) {
        const existingIssue = searchResults.issues[0];
        
        // Store for future checks
        await storage.set(storageKey, {
          issueKey: existingIssue.key,
          issueId: existingIssue.id,
          created: new Date().toISOString()
        });
        
        return {
          statusCode: 200,
          body: JSON.stringify({
            success: true,
            message: 'Duplicate webhook - ticket already exists',
            issueKey: existingIssue.key,
            issueId: existingIssue.id,
            duplicate: true
          })
        };
      }
    }
    
    // Mark as processing immediately (claim this request_uid)
    await storage.set(storageKey, {
      issueKey: 'processing',
      issueId: 'processing',
      created: new Date().toISOString()
    });
    
    // Fetch detailed PEDM approval data from Keeper API
    const approvalDetails = await fetchPedmApprovalDetails(requestUid);
    
    // Build ticket summary and description based on available data
    let summary;
    let adfDescription;
    
    if (approvalDetails) {
      const approvalType = approvalDetails.approval_type || 'Unknown';
      summary = `KEPM ${approvalType} Request - ${requestUid}`;
      // TODO: PR #3 Issue #10 - Sensitive Data in Jira Comments (Suggested Improvement)
      // buildEnrichedTicketDescription includes full approval details (usernames, commands,
      // internal hostnames, justifications) visible to all users with "Browse Projects" permission.
      // Consider redacting sensitive fields: email domains (user@***), FQDNs (host.***),
      // commands ([REDACTED]), and truncating justifications if information disclosure is a concern.
      adfDescription = buildEnrichedTicketDescription(approvalDetails, payload);
    } else {
      summary = `KeeperSecurity Alert - ${requestUid}`;
      adfDescription = buildBasicTicketDescription(payload);
    }
    
    // Build labels from both sources
    const labels = buildTicketLabels(payload, approvalDetails);
    
    // Add unique request_uid label for duplicate detection
    labels.push(uidLabel);
    
    // Create the Jira issue
    const response = await asApp().requestJira(
      route`/rest/api/3/issue`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fields: {
            project: { key: config.projectKey },
            summary: summary,
            description: adfDescription,
            issuetype: { name: config.issueType },
            labels: labels
          }
        })
      }
    );
    
    if (!response.ok) {
      const errorText = await response.text();
      // Clean up the processing lock on failure so it can be retried
      await storage.delete(storageKey);
      return {
        statusCode: response.status,
        body: JSON.stringify({
          success: false,
          error: `Failed to create issue: ${errorText}`
        })
      };
    }
    
    const issue = await response.json();
    
    // Update storage with the actual ticket info
    await storage.set(storageKey, {
      issueKey: issue.key,
      issueId: issue.id,
      created: new Date().toISOString()
    });
    
    // For PEDM approval requests, assign to a project admin
    if (payload.category === 'endpoint_privilege_manager' && payload.audit_event === 'approval_request_created') {
      try {
        await assignToProjectAdmin(config.projectKey, issue.key);
      } catch (assignError) {
        // Don't fail the entire webhook if assignment fails
      }
    }
    
    return {
      statusCode: 200,
      body: JSON.stringify({
        success: true,
        message: 'Issue created successfully',
        issueKey: issue.key,
        issueId: issue.id
      })
    };
    
  } catch (error) {
    // Try to clean up storage lock if it was set
    try {
      const payload = request.body ? JSON.parse(request.body) : {};
      const requestUid = payload.request_uid || payload.requestUid;
      if (requestUid) {
        const sanitizedUid = requestUid.replace(/[^a-zA-Z0-9_-]/g, '-');
        const storageKey = `webhook-processed-${sanitizedUid}`;
        const existing = await storage.get(storageKey);
        if (existing && existing.issueKey === 'processing') {
          await storage.delete(storageKey);
        }
      }
    } catch (cleanupError) {
      // Silent cleanup failure
    }
    
    return {
      statusCode: 500,
      body: JSON.stringify({
        success: false,
        error: error.message || 'Internal server error'
      })
    };
  }
}

/**
 * Assign ticket to a project admin
 * @param {string} projectKey - Project key
 * @param {string} issueKey - Issue key
 */
async function assignToProjectAdmin(projectKey, issueKey) {
  // Get project roles
  const rolesResponse = await asApp().requestJira(route`/rest/api/3/project/${projectKey}/role`);
  const roles = await rolesResponse.json();
  
  // Find admin role
  let adminRoleUrl = null;
  const possibleAdminRoleNames = ['Administrators', 'Administrator', 'Admins', 'Project Administrators', 'administrators'];
  
  for (const roleName of possibleAdminRoleNames) {
    if (roles && roles[roleName]) {
      adminRoleUrl = roles[roleName];
      break;
    }
  }
  
  if (adminRoleUrl) {
    // Extract role ID
    const roleIdMatch = adminRoleUrl.match(/role\/(\d+)/);
    if (roleIdMatch) {
      const roleId = roleIdMatch[1];
      
      // Get role details with actors
      const roleDetailsResponse = await asApp().requestJira(route`/rest/api/3/project/${projectKey}/role/${roleId}`);
      const roleDetails = await roleDetailsResponse.json();
      
      // Find first active admin user
      if (roleDetails && roleDetails.actors && roleDetails.actors.length > 0) {
        let assigneeAccountId = null;
        
        for (const actor of roleDetails.actors) {
          if (actor.actorUser && actor.actorUser.accountId) {
            assigneeAccountId = actor.actorUser.accountId;
            break;
          } else if (actor.id) {
            assigneeAccountId = actor.id;
            break;
          } else if (actor.accountId) {
            assigneeAccountId = actor.accountId;
            break;
          }
        }
        
        // Assign ticket to admin
        if (assigneeAccountId) {
          await asApp().requestJira(
            route`/rest/api/3/issue/${issueKey}`,
            {
              method: 'PUT',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                fields: {
                  assignee: { accountId: assigneeAccountId }
                }
              })
            }
          );
        }
      }
    }
  }
}

