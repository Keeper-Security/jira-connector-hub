/**
 * Keeper Commander API Module
 * Handles all interactions with Keeper Security Commander API
 */

import { storage, fetch } from '@forge/api';

/**
 * Helper function to parse and clean Keeper CLI error messages
 * Extracts the meaningful user-friendly error message from verbose CLI output
 */
function parseKeeperErrorMessage(errorMessage) {
  if (!errorMessage || typeof errorMessage !== 'string') return errorMessage;
  
  let errorText = errorMessage;
  
  // Try to parse JSON response and extract error field
  try {
    const jsonError = JSON.parse(errorMessage);
    if (jsonError.error) {
      errorText = jsonError.error;
    } else if (jsonError.message) {
      errorText = jsonError.message;
    }
  } catch (e) {
    // Not JSON, use as-is
  }
  
  // Split by newlines and process each line
  const lines = errorText.split('\n').map(line => line.trim()).filter(line => line);
  
  // Skip system messages like "Bypassing master password enforcement..."
  const meaningfulLines = lines.filter(line => 
    !line.startsWith('Bypassing master password') &&
    !line.includes('running in service mode')
  );
  
  // If we have meaningful lines, process them
  if (meaningfulLines.length > 0) {
    const lastLine = meaningfulLines[meaningfulLines.length - 1];
    
    // Look for pattern: "Failed to ... : <actual error message>"
    // Extract the part after the last colon if it contains a meaningful message
    const colonIndex = lastLine.lastIndexOf(': ');
    if (colonIndex !== -1) {
      const afterColon = lastLine.substring(colonIndex + 2).trim();
      // Check if the part after colon is a meaningful message (not just a short token)
      if (afterColon.length > 20 && !afterColon.includes('Failed to')) {
        return afterColon;
      }
    }
    
    // If no colon pattern found, return the last meaningful line
    return lastLine;
  }
  
  return errorText;
}

/**
 * Fetch PEDM approval details from Keeper API with auto-sync fallback
 * @param {string} requestUid - The request UID to fetch details for
 * @returns {Promise<Object|null>} - Approval details or null if failed
 */
export async function fetchPedmApprovalDetails(requestUid) {
  try {
    const keeperConfig = await storage.get('keeperConfig');
    if (!keeperConfig || !keeperConfig.apiUrl || !keeperConfig.apiKey) {
      return null;
    }

    const { apiUrl, apiKey } = keeperConfig;
    const fullApiUrl = apiUrl.endsWith('/') ? apiUrl.slice(0, -1) : apiUrl;
    const viewCommand = `pedm approval view ${requestUid} --format=json`;

    let response = await fetch(fullApiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'api-key': apiKey },
      body: JSON.stringify({ command: viewCommand }),
    });

    // Parse response body (even for errors like 500)
    let data = await response.json();

    // Check if request doesn't exist (can be in error or message field)
    const errorText = String(data.error || data.message || '');
    const doesNotExist = errorText.toLowerCase().includes('does not exist');
    
    if (doesNotExist) {
      
      const syncResponse = await fetch(fullApiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'api-key': apiKey },
        body: JSON.stringify({ command: 'pedm sync-down' }),
      });

      const syncData = await syncResponse.json();
      
      if (syncData.status === 'error' || (syncData.success === false)) {
        return null;
      }
      
      // Wait 2 seconds for sync to propagate
      await new Promise(resolve => setTimeout(resolve, 2000));

      // Retry view command after sync
      response = await fetch(fullApiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'api-key': apiKey },
        body: JSON.stringify({ command: viewCommand }),
      });

      // Parse response even if status is not ok
      data = await response.json();
    }

    // Validate and return data (check for success regardless of HTTP status)
    if (data.status === 'success' && data.data && data.data.length > 0) {
      return data.data[0];
    }

    return null;
  } catch (error) {
    return null;
  }
}

/**
 * Execute a Keeper Commander command
 * @param {string} command - The command to execute
 * @returns {Promise<Object>} - API response
 */
export async function executeKeeperCommand(command) {
  const config = await storage.get('keeperConfig');
  if (!config) {
    throw new Error('Keeper configuration not found. Please configure the app first.');
  }

  const { apiUrl, apiKey } = config;
  const fullApiUrl = apiUrl.endsWith('/') ? apiUrl.slice(0, -1) : apiUrl;

  const response = await fetch(fullApiUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'api-key': apiKey,
    },
    body: JSON.stringify({ command }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    const cleanedError = parseKeeperErrorMessage(errorText);
    throw new Error(`Keeper API error: ${response.status} - ${cleanedError}`);
  }

  const data = await response.json();

  if (data.success === false || data.error) {
    const rawError = data.error || data.message || 'Unknown error';
    const cleanedError = parseKeeperErrorMessage(rawError);
    throw new Error(cleanedError);
  }

  return { 
    success: true, 
    data: data,
    message: data.message || 'Command executed successfully'
  };
}

/**
 * Test connection to Keeper Commander API
 * @param {string} apiUrl - API URL
 * @param {string} apiKey - API Key
 * @returns {Promise<Object>} - Test result
 */
export async function testKeeperConnection(apiUrl, apiKey) {
  const fullApiUrl = apiUrl.endsWith('/') ? apiUrl.slice(0, -1) : apiUrl;

  const response = await fetch(fullApiUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'api-key': apiKey,
    },
    body: JSON.stringify({
      command: 'service-status',
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    const cleanedError = parseKeeperErrorMessage(errorText);
    throw new Error(`Connection failed: ${response.status} - ${cleanedError}`);
  }

  const data = await response.json();

  if (data.success === false || data.error) {
    const rawError = data.error || data.message || 'Unknown error';
    const cleanedError = parseKeeperErrorMessage(rawError);
    throw new Error(`Connection test failed: ${cleanedError}`);
  }

  return {
    success: true,
    message: 'Connection successful',
    data: data
  };
}

