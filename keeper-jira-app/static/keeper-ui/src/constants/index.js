/**
 * Application constants
 */

// Message types for status messages
export const MESSAGE_TYPES = {
  SUCCESS: 'success',
  ERROR: 'error',
  WARNING: 'warning',
  INFO: 'info'
};

// Tab names
export const TABS = {
  CONFIG: 'config',
  EPM: 'epm',
  PREREQ: 'prereq',
  ABOUT: 'about'
};

// Message styles configuration
export const MESSAGE_STYLES = {
  success: {
    background: "#F0FDF4",
    border: "2px solid #86EFAC",
    titleColor: "#166534",
    title: "Success Message"
  },
  error: {
    background: "#FEF2F2",
    border: "2px solid #FCA5A5",
    titleColor: "#991B1B",
    title: "Error Message"
  },
  warning: {
    background: "#FFFBEB",
    border: "2px solid #FCD34D",
    titleColor: "#92400E",
    title: "Warning Message"
  },
  info: {
    background: "#EFF6FF",
    border: "2px solid #93C5FD",
    titleColor: "#1E40AF",
    title: "Info Message"
  }
};

// Copy message timeout
export const COPY_MESSAGE_TIMEOUT = 2000;

