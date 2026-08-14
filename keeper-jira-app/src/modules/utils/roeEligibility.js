/**
 * Pure helpers for rotation-on-expiration (ROE) eligibility parsing.
 *
 * Commander contract (folder ROE):
 *   `list-sf "<uid>" --roe-eligible --format=json`
 * returns JSON rows where `shared_folder_uid` matches the queried folder UID
 * when that folder is ROE-eligible. If Commander renames this field, update
 * this helper and roeEligibility.test.js.
 */

/**
 * @param {unknown} rows - Parsed JSON array from list-sf --roe-eligible
 * @param {string} uid - Folder UID that was queried
 * @returns {boolean}
 */
function isFolderRoeEligibleFromListSfRows(rows, uid) {
  if (!uid || !Array.isArray(rows)) return false;
  return rows.some((row) => row && row.shared_folder_uid === uid);
}

module.exports = {
  isFolderRoeEligibleFromListSfRows
};
