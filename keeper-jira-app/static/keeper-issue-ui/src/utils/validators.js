// Validator utility functions

// Validate email format
export const isValidEmail = (email) => {
  if (!email) return false;
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
};

// Validate URL format
export const isValidUrl = (url) => {
  if (!url) return false;
  try {
    new URL(url);
    return true;
  } catch {
    return false;
  }
};

// Validate required fields in form data
export const validateRequiredFields = (fields, formData) => {
  const missingFields = [];
  
  fields.forEach(field => {
    if (field.required) {
      const value = formData[field.name];
      
      // Check conditional fields
      if (field.conditionalOn && field.conditionalValue) {
        const conditionalValue = formData[field.conditionalOn];
        if (conditionalValue !== field.conditionalValue) {
          return; // Skip validation for conditional fields that don't match
        }
      }
      
      // Validate field value
      if (!value || (typeof value === 'string' && value.trim() === '')) {
        missingFields.push(field.label || field.name);
      }
    }
  });
  
  return missingFields;
};


