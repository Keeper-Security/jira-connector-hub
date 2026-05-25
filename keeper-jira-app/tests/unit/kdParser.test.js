/**
 * Unit tests for Keeper Drive list parsing (Commander 18.x display keys).
 */

const {
  normalizeKdFolderRow,
  buildKdFolderPaths,
  parseKdFoldersFromRaw
} = require('../../src/modules/utils/kdParser');

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
    Title: 'Test Keeper Drive',
    'Parent/Folder': 'AAAAAAAAAAAAAAAAAUOiQA'
  }
];

describe('kdParser', () => {
  describe('normalizeKdFolderRow', () => {
    test('maps Commander display keys to internal fields', () => {
      const row = normalizeKdFolderRow(SAMPLE_COMMANDER_FOLDERS[0]);
      expect(row).toMatchObject({
        uid: 'gzYQEEtwtyXjdID5SHCBZw',
        folder_uid: 'gzYQEEtwtyXjdID5SHCBZw',
        name: 'Test 1',
        parent_uid: 'i-fQiSv_d9mRigR5jQJULw'
      });
    });

    test('returns null for non-folder rows', () => {
      expect(normalizeKdFolderRow({ 'Item Type': 'Record', UID: 'x', Title: 'y' })).toBeNull();
    });
  });

  describe('buildKdFolderPaths', () => {
    test('builds nested path for child folder', () => {
      const normalized = SAMPLE_COMMANDER_FOLDERS.map(normalizeKdFolderRow).filter(Boolean);
      const folders = buildKdFolderPaths(normalized);

      const root = folders.find((f) => f.uid === 'i-fQiSv_d9mRigR5jQJULw');
      const child = folders.find((f) => f.uid === 'gzYQEEtwtyXjdID5SHCBZw');

      expect(root.path).toBe('Test Keeper Drive');
      expect(child.path).toBe('Test Keeper Drive / Test 1');
      expect(child.source).toBe('kd');
      expect(child.shared).toBe(true);
    });
  });

  describe('parseKdFoldersFromRaw', () => {
    test('parses full Commander sample', () => {
      const folders = parseKdFoldersFromRaw(SAMPLE_COMMANDER_FOLDERS);
      expect(folders).toHaveLength(2);
      expect(folders.every((f) => f.folder_uid && f.name)).toBe(true);
    });
  });
});
