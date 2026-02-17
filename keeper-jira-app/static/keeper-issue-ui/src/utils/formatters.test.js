import { formatWithUid, filterByTitleOrUid } from './formatters';

// ---------------------------------------------------------------------------
// formatWithUid
// ---------------------------------------------------------------------------
describe('formatWithUid', () => {
  it('appends UID in parentheses when uid is provided', () => {
    expect(formatWithUid('My Record', 'abc123')).toBe('My Record (abc123)');
  });

  it('returns name only when uid is undefined', () => {
    expect(formatWithUid('My Record', undefined)).toBe('My Record');
  });

  it('returns name only when uid is empty string', () => {
    expect(formatWithUid('My Record', '')).toBe('My Record');
  });

  it('returns name only when uid is null', () => {
    expect(formatWithUid('My Record', null)).toBe('My Record');
  });
});

// ---------------------------------------------------------------------------
// filterByTitleOrUid
// ---------------------------------------------------------------------------
describe('filterByTitleOrUid', () => {
  const records = [
    { title: 'Production DB',   record_uid: 'uid-001' },
    { title: 'Staging DB',      record_uid: 'uid-002' },
    { title: 'Dev Environment', record_uid: 'uid-003' },
    { title: 'CI Pipeline',     record_uid: 'uid-100' },
  ];

  const folders = [
    { name: 'Shared',  folder_uid: 'fld-aaa', folderUid: 'fld-aaa' },
    { name: 'Private', folder_uid: 'fld-bbb', folderUid: 'fld-bbb' },
    { title: 'Team',   folder_uid: 'fld-ccc' },
  ];

  // --- Search by title ---
  it('matches records by title (case-insensitive)', () => {
    const result = filterByTitleOrUid(records, 'production', 'title', 'record_uid');
    expect(result).toEqual([{ title: 'Production DB', record_uid: 'uid-001' }]);
  });

  it('matches records by partial title', () => {
    const result = filterByTitleOrUid(records, 'DB', 'title', 'record_uid');
    expect(result).toHaveLength(2);
    expect(result.map(r => r.title)).toEqual(['Production DB', 'Staging DB']);
  });

  // --- Search by UID ---
  it('matches records by exact UID', () => {
    const result = filterByTitleOrUid(records, 'uid-002', 'title', 'record_uid');
    expect(result).toEqual([{ title: 'Staging DB', record_uid: 'uid-002' }]);
  });

  it('matches records by partial UID', () => {
    const result = filterByTitleOrUid(records, 'uid-00', 'title', 'record_uid');
    expect(result).toHaveLength(3);
    expect(result.map(r => r.record_uid)).toEqual(['uid-001', 'uid-002', 'uid-003']);
  });

  // --- No match ---
  it('returns empty array when nothing matches', () => {
    const result = filterByTitleOrUid(records, 'nonexistent', 'title', 'record_uid');
    expect(result).toEqual([]);
  });

  // --- Empty / missing search term ---
  it('returns all items when search term is empty string', () => {
    const result = filterByTitleOrUid(records, '', 'title', 'record_uid');
    expect(result).toEqual(records);
  });

  it('returns all items when search term is undefined', () => {
    const result = filterByTitleOrUid(records, undefined, 'title', 'record_uid');
    expect(result).toEqual(records);
  });

  // --- Fallback keys (arrays) ---
  it('resolves name from first available key in nameKeys array', () => {
    const result = filterByTitleOrUid(folders, 'Team', ['name', 'title'], ['folder_uid', 'folderUid']);
    expect(result).toEqual([{ title: 'Team', folder_uid: 'fld-ccc' }]);
  });

  it('resolves uid from fallback key in uidKeys array', () => {
    const result = filterByTitleOrUid(folders, 'fld-bbb', ['name', 'title'], ['folder_uid', 'folderUid']);
    expect(result).toEqual([{ name: 'Private', folder_uid: 'fld-bbb', folderUid: 'fld-bbb' }]);
  });

  // --- Items with missing fields ---
  it('handles items with missing name/uid fields gracefully', () => {
    const sparse = [
      { title: 'Has Title' },
      { record_uid: 'uid-only' },
      {},
    ];
    const result = filterByTitleOrUid(sparse, 'uid-only', 'title', 'record_uid');
    expect(result).toEqual([{ record_uid: 'uid-only' }]);
  });
});
