/**
 * StatusMessage component for displaying success/error messages
 */
import React from 'react';
import SectionMessage from "@atlaskit/section-message";
import SuccessIcon from "@atlaskit/icon/glyph/check-circle";
import ErrorIcon from "@atlaskit/icon/glyph/error";
import '../../styles/StatusMessage.css';

const StatusMessage = ({ type, title, message, onDismiss }) => {
  if (!message) return null;

  const appearance = type === 'success' ? 'confirmation' : 
                     type === 'error' ? 'error' : 
                     type === 'warning' ? 'warning' : 'information';

  const Icon = type === 'success' ? SuccessIcon : ErrorIcon;

  return (
    <div className="status-message-wrapper">
      <SectionMessage
        appearance={appearance}
        title={title}
      >
        <div className="status-message-content">
          {message}
        </div>
      </SectionMessage>
    </div>
  );
};

export default StatusMessage;


