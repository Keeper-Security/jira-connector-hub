import React from 'react';

// "Required information" header + requirements/justification textarea pair for share actions.
const RequirementsBlock = ({
  infoMessage,
  showInfoMessage = true,
  requirementsRequired,
  requirementsValue,
  onRequirementsChange,
  requirementsPlaceholder,
  justificationValue,
  onJustificationChange,
  justificationPlaceholder,
  disabled,
}) => (
  <div className="share-record-textarea-wrapper">
    {showInfoMessage && infoMessage && (
      <div className="share-record-info-message">{infoMessage}</div>
    )}

    <div>
      <label className="share-record-label">
        Requirements {requirementsRequired && <span className="text-error">*</span>}:
      </label>
      <textarea
        value={requirementsValue || ''}
        onChange={onRequirementsChange}
        placeholder={requirementsPlaceholder}
        disabled={disabled}
        className="share-record-textarea"
      />
    </div>

    <div className="share-record-textarea-wrapper">
      <label className="share-record-label">
        Justification for this Request:
      </label>
      <textarea
        value={justificationValue || ''}
        onChange={onJustificationChange}
        placeholder={justificationPlaceholder}
        disabled={disabled}
        className="share-record-textarea"
      />
    </div>
  </div>
);

export default RequirementsBlock;
