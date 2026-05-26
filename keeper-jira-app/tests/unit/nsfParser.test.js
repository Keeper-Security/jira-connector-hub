/**
 * Unit tests for Nested Shared Folder list parsing (Commander 18.x display keys).
 */

const {
  normalizeNsfFolderRow,
  buildNsfFolderPaths,
  parseNsfFoldersFromRaw
} = require('../../src/modules/utils/nsfParser');

const SAMPLE_COMMANDER_FOLDERS = [
  {
    'Item Type': 'Folder',
    UID: 'gzYQEEtwtyXjdID5SHCBZw',
    Title: 'Test 1',
    'Parent/Folder': 'i-fQiSv_d9mRigR5jQJULw'
  },
  {
    'Item Type': 'Folder',
    UID: 'i-fQiSv_d9mRigR5jQJULw',
    Title: 'Test Shared Folder',
    'Parent/Folder': 'AAAAAAAAAAAAAAAAAUOiQA'
  }
];

describe('nsfParser', () => {
  describe('normalizeNsfFolderRow', () => {
    test('maps Commander display keys to internal fields', () => {
      const row = normalizeNsfFolderRow(SAMPLE_COMMANDER_FOLDERS[0]);
      expect(row).toMatchObject({
        uid: 'gzYQEEtwtyXjdID5SHCBZw',
        folder_uid: 'gzYQEEtwtyXjdID5SHCBZw',
        name: 'Test 1',
        parent_uid: 'i-fQiSv_d9mRigR5jQJULw'
      });
    });

    test('returns null for non-folder rows', () => {
      expect(normalizeNsfFolderRow({ 'Item Type': 'Record', UID: 'x', Title: 'y' })).toBeNull();
    });
  });

  describe('buildNsfFolderPaths', () => {
    test('builds nested path for child folder', () => {
      const normalized = SAMPLE_COMMANDER_FOLDERS.map(normalizeNsfFolderRow).filter(Boolean);
      const folders = buildNsfFolderPaths(normalized);

      const root = folders.find((f) => f.uid === 'i-fQiSv_d9mRigR5jQJULw');
      const child = folders.find((f) => f.uid === 'gzYQEEtwtyXjdID5SHCBZw');

      expect(root.path).toBe('Test Shared Folder');
      expect(child.path).toBe('Test Shared Folder / Test 1');
      expect(child.source).toBe('nsf');
      expect(child.shared).toBe(true);
    });
  });

  describe('parseNsfFoldersFromRaw', () => {
    test('parses full Commander sample', () => {
      const folders = parseNsfFoldersFromRaw(SAMPLE_COMMANDER_FOLDERS);
      expect(folders).toHaveLength(2);
      expect(folders.every((f) => f.folder_uid && f.name)).toBe(true);
    });
  });
});
