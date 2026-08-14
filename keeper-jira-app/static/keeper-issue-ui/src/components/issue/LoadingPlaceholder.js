import React from 'react';

// Inline loading message used inside picker menus and form sections.
const LoadingPlaceholder = ({ text = 'Loading...', className = 'loading-container' }) => (
  <div className={className}>{text}</div>
);

export default LoadingPlaceholder;
