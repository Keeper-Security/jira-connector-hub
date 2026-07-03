const { isFolderRoeEligibleFromListSfRows } = require('../../src/modules/utils/roeEligibility');

describe('isFolderRoeEligibleFromListSfRows', () => {
  test('returns true when shared_folder_uid matches queried uid', () => {
    expect(isFolderRoeEligibleFromListSfRows(
      [{ shared_folder_uid: 'FOLDER_UID' }],
      'FOLDER_UID'
    )).toBe(true);
  });

  test('returns false when no row matches queried uid', () => {
    expect(isFolderRoeEligibleFromListSfRows(
      [{ shared_folder_uid: 'OTHER_UID' }],
      'FOLDER_UID'
    )).toBe(false);
  });

  test('returns false for empty or non-array rows', () => {
    expect(isFolderRoeEligibleFromListSfRows([], 'FOLDER_UID')).toBe(false);
    expect(isFolderRoeEligibleFromListSfRows(null, 'FOLDER_UID')).toBe(false);
  });
});
