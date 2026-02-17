// Formatter utility functions

// Format a name with an optional UID suffix: "Name (uid)" or just "Name"
export const formatWithUid = (name, uid) => uid ? `${name} (${uid})` : name;

// Filter items by matching a search term against name and/or UID fields.
// `nameKeys` and `uidKeys` accept a single string or an array of property names
// to try in order (first non-falsy value wins).
export const filterByTitleOrUid = (items, term, nameKeys = ['title'], uidKeys = []) => {
  if (!term) return items;
  const lowerTerm = term.toLowerCase();
  const toArray = (keys) => (Array.isArray(keys) ? keys : [keys]);
  const resolve = (item, keys) =>
    toArray(keys).reduce((val, key) => val || item[key], '') || '';

  return items.filter(item => {
    const name = resolve(item, nameKeys);
    const uid = resolve(item, uidKeys);
    return name.toLowerCase().includes(lowerTerm) ||
      (uid && uid.toLowerCase().includes(lowerTerm));
  });
};

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


