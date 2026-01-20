/**
 * StatusMessage component for displaying notifications
 * Simple text box with title and message - with optional close button
 */
import React from 'react';
import { MESSAGE_STYLES } from '../../constants';
import '../../styles/StatusMessage.css';

const StatusMessage = ({ message, onDismiss }) => {
  if (!message) return null;

  const style = MESSAGE_STYLES[message.type] || MESSAGE_STYLES.info;

  return (
    <div className="status-message-wrapper">
      <div className={`status-message ${message.type}`}>
        {onDismiss && (
          <button 
            onClick={onDismiss}
            className="status-message-close"
            aria-label="Dismiss"
          >
            ×
          </button>
        )}
        <div className="status-message-title">
          {message.title || style.title}
        </div>
        <div className="status-message-text">
          {message.message}
        </div>
      </div>
    </div>
  );
};

export default StatusMessage;

