// Formatter utility functions

// Format date to readable string
export const formatDate = (timestamp) => {
  if (!timestamp) return '';
  try {
    const date = new Date(timestamp);
    return date.toLocaleString();
  } catch (error) {
    return timestamp;
  }
};

// Format record title for display
export const formatRecordTitle = (record) => {
  if (!record) return '';
  return record.title || record.recordUid || 'Untitled Record';
};

// Format folder path for display
export const formatFolderPath = (folder) => {
  if (!folder) return '';
  return folder.folderPath || folder.path || folder.name || 'Unnamed Folder';
};


