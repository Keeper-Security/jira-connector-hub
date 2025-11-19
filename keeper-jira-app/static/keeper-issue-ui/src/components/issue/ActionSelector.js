/**
 * ActionSelector component - dropdown for selecting Keeper actions
 */
import React, { useState } from 'react';
import { KEEPER_ACTION_OPTIONS } from '../../constants';
import '../../styles/ActionSelector.css';

const ActionSelector = ({ selectedAction, onActionSelect, disabled = false }) => {
  const [searchTerm, setSearchTerm] = useState("");
  const [showDropdown, setShowDropdown] = useState(false);

  const filteredActions = KEEPER_ACTION_OPTIONS.filter(action =>
    action.label.toLowerCase().includes(searchTerm.toLowerCase()) ||
    action.description.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const handleActionClick = (action) => {
    onActionSelect(action);
    setShowDropdown(false);
    setSearchTerm("");
  };

  return (
    <div className="action-selector-wrapper">
      <label className="action-selector-label">
        Select Keeper Action <span className="required-mark">*</span>
      </label>
      
      <div className="dropdown-wrapper">
        <button
          className="action-selector-button"
          onClick={() => !disabled && setShowDropdown(!showDropdown)}
          disabled={disabled}
        >
          {selectedAction ? selectedAction.label : "Choose an action..."}
          <span className="action-selector-arrow">{showDropdown ? "▲" : "▼"}</span>
        </button>

        {showDropdown && (
          <>
            <div
              className="dropdown-backdrop"
              onClick={() => setShowDropdown(false)}
            />
            
            <div className="action-selector-dropdown">
              <input
                type="text"
                className="action-selector-search"
                placeholder="Search actions..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                autoFocus
              />

              <div className="action-selector-items">
                {filteredActions.length === 0 ? (
                  <div className="action-selector-empty">No actions found</div>
                ) : (
                  filteredActions.map((action) => (
                    <div
                      key={action.value}
                      className={`action-selector-item ${selectedAction?.value === action.value ? 'selected' : ''}`}
                      onClick={() => handleActionClick(action)}
                    >
                      <div className="action-selector-item-title">{action.label}</div>
                      <div className="action-selector-item-description">{action.description}</div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </>
        )}
      </div>

      {selectedAction && (
        <div className="action-selector-info">
          <div className="action-selector-info-title">Selected Action:</div>
          <div className="action-selector-info-description">{selectedAction.description}</div>
        </div>
      )}
    </div>
  );
};

export default ActionSelector;


