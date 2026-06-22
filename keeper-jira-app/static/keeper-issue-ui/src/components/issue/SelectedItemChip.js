import React from 'react';

// "Selected: <title> (UID: <uid>)" block with optional clear button.
const SelectedItemChip = ({
  title,
  uid,
  onClear,
  disabled,
  variant = 'share',
  children,
}) => {
  const uidSpan = uid ? (
    <span className="selected-item-uid"> (UID: {uid})</span>
  ) : null;

  if (variant === 'box') {
    return (
      <div className="selected-item-box mt-8">
        <div>
          Selected: <strong>{title}</strong>{uidSpan}
        </div>
        {children}
      </div>
    );
  }

  return (
    <div className="share-record-selected-box">
      <div className="share-record-selected-content">
        <span>
          Selected: <span className="share-record-selected-text">{title}</span>{uidSpan}
        </span>
        {onClear && (
          <button
            type="button"
            onClick={onClear}
            disabled={disabled}
            className="share-record-clear-btn"
            title="Clear selection"
          >
            ✕
          </button>
        )}
      </div>
    </div>
  );
};

export default SelectedItemChip;
