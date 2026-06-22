/**
 * Normalize Nested Shared Folders (NSF) list output from Commander 18.x CLI.
 * `nsf-list --folders` / `--records` return display-key JSON:
 *   UID, Title, Parent/Folder, Item Type
 */

/**
 * @param {unknown} raw
 * @returns {string}
 */
function pickString(raw, ...keys) {
  if (!raw || typeof raw !== 'object') return '';
  for (const key of keys) {
    const value = raw[key];
    if (value !== undefined && value !== null && String(value).trim() !== '') {
      return String(value).trim();
    }
  }
  return '';
}

/**
 * Map one raw `nsf-list --folders` row to normalized fields.
 * Returns null if the row is not a folder.
 *
 * @param {object} raw
 * @returns {object|null}
 */
function normalizeNsfFolderRow(raw) {
  if (!raw || typeof raw !== 'object') return null;

  const itemType = pickString(raw, 'Item Type', 'item_type', 'itemType', 'type');
  if (itemType && itemType.toLowerCase() !== 'folder') {
    return null;
  }

  const uid = pickString(raw, 'UID', 'uid', 'folder_uid', 'folderUid');
  if (!uid) return null;

  const title = pickString(raw, 'Title', 'title', 'name');
  const parentUid = pickString(
    raw,
    'Parent/Folder',
    'Parent',
    'parent_uid',
    'parentUid',
    'parent'
  );

  const cleanName = title.replace(/\[?\d+m/g, '');

  return {
    uid,
    folder_uid: uid,
    name: cleanName,
    title: cleanName,
    parent_uid: parentUid,
    raw_data: raw
  };
}

/**
 * Build nested display paths from parent_uid links.
 *
 * @param {Array<{ uid: string, name: string, parent_uid?: string }>} folders
 * @returns {Array<object>}
 */
function buildNsfFolderPaths(folders) {
  const byUid = new Map();
  for (const folder of folders) {
    if (folder && folder.uid) {
      byUid.set(folder.uid, folder);
    }
  }

  const pathCache = new Map();

  const resolvePath = (uid, visiting = new Set()) => {
    if (!uid) return '';
    if (pathCache.has(uid)) return pathCache.get(uid);
    if (visiting.has(uid)) return byUid.get(uid)?.name || '';

    const folder = byUid.get(uid);
    if (!folder) return '';

    visiting.add(uid);

    const name = folder.name || folder.title || '';
    const parentUid = folder.parent_uid || '';

    let path = name;
    if (parentUid && byUid.has(parentUid)) {
      const parentPath = resolvePath(parentUid, visiting);
      path = parentPath ? `${parentPath} / ${name}` : name;
    }

    visiting.delete(uid);
    pathCache.set(uid, path);
    return path;
  };

  return folders.map((folder, index) => {
    const path = resolvePath(folder.uid) || folder.name || '';
    return {
      number: index + 1,
      folder_uid: folder.uid,
      uid: folder.uid,
      name: folder.name,
      title: folder.title,
      path,
      folderPath: path,
      flags: '',
      parent_uid: folder.parent_uid || '',
      shared: true,
      source: 'nsf',
      raw_data: folder.raw_data
    };
  });
}

/**
 * Parse raw Commander folder array into UI-ready folder list.
 *
 * @param {Array<object>} rawFolders
 * @returns {Array<object>}
 */
function parseNsfFoldersFromRaw(rawFolders) {
  const normalized = (rawFolders || [])
    .map(normalizeNsfFolderRow)
    .filter(Boolean);
  return buildNsfFolderPaths(normalized);
}

/**
 * Map one raw `nsf-list --records` row to normalized fields.
 *
 * @param {object} raw
 * @returns {object|null}
 */
function normalizeNsfRecordRow(raw) {
  if (!raw || typeof raw !== 'object') return null;

  const itemType = pickString(raw, 'Item Type', 'item_type', 'itemType', 'type');
  if (itemType && itemType.toLowerCase() === 'folder') {
    return null;
  }

  const uid = pickString(raw, 'UID', 'uid', 'record_uid', 'recordUid');
  if (!uid) return null;

  const title = pickString(raw, 'Title', 'title', 'name', 'record_title');
  const parentUid = pickString(
    raw,
    'Parent/Folder',
    'Parent',
    'parent_uid',
    'parentUid',
    'folder_uid',
    'folderUid'
  );

  return {
    ...raw,
    uid,
    record_uid: uid,
    title: title.replace(/\[?\d+m/g, ''),
    name: title.replace(/\[?\d+m/g, ''),
    parent_uid: parentUid,
    folder_uid: parentUid
  };
}

/**
 * @param {Array<object>} rawRecords
 * @returns {Array<object>}
 */
function parseNsfRecordsFromRaw(rawRecords) {
  return (rawRecords || [])
    .map(normalizeNsfRecordRow)
    .filter(Boolean);
}

module.exports = {
  normalizeNsfFolderRow,
  buildNsfFolderPaths,
  parseNsfFoldersFromRaw,
  normalizeNsfRecordRow,
  parseNsfRecordsFromRaw
};
