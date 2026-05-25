import React from 'react';

// Standard label + required-asterisk + child + optional hint/error rendering.
const FormField = ({
  label,
  required,
  hint,
  error,
  children,
  labelClass = 'label-record-add',
  requiredClassName,
  wrapperClass = 'mb-12',
  hideLabel = false,
}) => {
  const asteriskClass = requiredClassName
    || (labelClass === 'form-label' ? 'text-required' : labelClass === 'label-sm-6' ? 'text-error' : 'text-error ml-4');

  return (
  <div className={wrapperClass}>
    {!hideLabel && label != null && (
      <label className={labelClass}>
        {label}
        {required && <> <span className={asteriskClass}>*</span></>}
      </label>
    )}
    {children}
    {hint && <div className="field-hint-text">{hint}</div>}
    {error && <div className="field-error-text">{error}</div>}
  </div>
  );
};

export default FormField;
