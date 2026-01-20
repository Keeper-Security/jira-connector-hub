/**
 * Modal component - reusable modal with overlay
 */
import React from 'react';
import CrossIcon from "@atlaskit/icon/glyph/cross";
import '../../styles/Modal.css';

const Modal = ({ isOpen, onClose, title, children, maxWidth = '600px' }) => {
  if (!isOpen) return null;

  return (
    <div className="modal-overlay">
      <div className="modal-container" style={{ maxWidth }}>
        <div className="modal-header">
          <h3 className="modal-title">{title}</h3>
          {onClose && (
            <button className="modal-close-button" onClick={onClose} aria-label="Close">
              <CrossIcon size="medium" />
            </button>
          )}
        </div>
        <div className="modal-content">
          {children}
        </div>
      </div>
    </div>
  );
};

export default Modal;


