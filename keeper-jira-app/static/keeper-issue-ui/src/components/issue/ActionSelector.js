import React from 'react';
import PaginationFooter from './PaginationFooter';
import SearchHint from './SearchHint';

// Full action dropdown with search, pagination, and description box.
const ActionSelector = ({
  selectedAction,
  onActionSelect,
  disabled,
  searchTerm,
  onSearchChange,
  showDropdown,
  onToggleDropdown,
  onCloseDropdown,
  onFocusInput,
  paginatedOptions,
  filteredCount,
  currentPage,
  totalPages,
  onPrevPage,
  onNextPage,
}) => (
  <div className="mb-12">
    <label className="label-block">Select Keeper Action:</label>

    <div className="relative z-1001">
      <input
        id="keeper-action-input"
        type="text"
        disabled={disabled}
        placeholder={
          disabled
            ? 'Form disabled after successful execution...'
            : showDropdown
              ? 'Type to search actions...'
              : (selectedAction ? selectedAction.label : 'Click to select action...')
        }
        value={showDropdown ? searchTerm : (selectedAction ? selectedAction.label : '')}
        onChange={(e) => { if (!disabled) onSearchChange(e.target.value); }}
        onClick={() => { if (!disabled) onToggleDropdown(); }}
        onFocus={() => { if (!disabled) onFocusInput(); }}
        className={`action-select-input ${disabled ? 'action-select-input-disabled' : (showDropdown ? 'action-select-input-focused' : 'action-select-input-default')}`}
      />

      <div
        onClick={() => { if (!disabled) onToggleDropdown(); }}
        className={`dropdown-arrow-pos ${disabled ? 'dropdown-arrow-pos-disabled' : 'dropdown-arrow-pos-enabled'}`}
      >
        ▼
      </div>

      {showDropdown && !disabled && (
        <div className="action-dropdown-menu">
          {!searchTerm && <SearchHint size="lg" />}

          {paginatedOptions.length > 0 ? (
            <>
              {paginatedOptions.map((option) => (
                <div
                  key={option.value}
                  onClick={() => onActionSelect(option)}
                  className={`action-option-item ${selectedAction?.value === option.value ? 'selected' : ''}`}
                >
                  <div className="dropdown-option-title">{option.label}</div>
                  <div className="dropdown-option-description">{option.description}</div>
                </div>
              ))}

              <PaginationFooter
                currentPage={currentPage}
                totalPages={totalPages}
                onPrev={onPrevPage}
                onNext={onNextPage}
                itemCount={filteredCount}
                itemLabel="items"
                variant="compact"
              />
            </>
          ) : (
            <div className="no-results-message">
              No actions found matching &quot;{searchTerm}&quot;
            </div>
          )}
        </div>
      )}

      {showDropdown && (
        <div className="fixed-overlay" onClick={onCloseDropdown} />
      )}
    </div>

    {selectedAction && (
      <div className="action-description-box">
        <strong>{selectedAction.label}:</strong> {selectedAction.description}
        {selectedAction.value === 'record-update' && (
          <div className="action-note">
            Note: Form fields will be blank. Only fill in the fields you want to update - empty fields will be ignored.
          </div>
        )}
      </div>
    )}
  </div>
);

export default ActionSelector;
