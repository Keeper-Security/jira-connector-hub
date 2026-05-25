import React from 'react';

// Prev/Next + page label used by every searchable picker.
const PaginationFooter = ({
  currentPage,
  totalPages,
  onPrev,
  onNext,
  itemCount,
  itemLabel,
  variant = 'compact',
  stopPropagation = false,
}) => {
  if (totalPages <= 1) return null;

  const isCompact = variant === 'compact';
  const wrapperClass = isCompact ? 'dropdown-pagination' : 'pagination-container';
  const btnClass = (disabled) => isCompact
    ? `pagination-btn ${disabled ? 'pagination-btn-disabled' : 'pagination-btn-active'}`
    : 'pagination-button';
  const textClass = isCompact ? 'pagination-text' : 'pagination-info';

  const handlePrev = (e) => {
    if (stopPropagation) e.stopPropagation();
    onPrev();
  };
  const handleNext = (e) => {
    if (stopPropagation) e.stopPropagation();
    onNext();
  };

  const label = itemCount != null && itemLabel
    ? `Page ${currentPage} of ${totalPages} (${itemCount} ${itemLabel})`
    : `Page ${currentPage} of ${totalPages}`;

  return (
    <div className={wrapperClass}>
      <button
        disabled={currentPage === 1}
        onClick={handlePrev}
        className={btnClass(currentPage === 1)}
      >
        Previous
      </button>
      <span className={textClass}>{label}</span>
      <button
        disabled={currentPage >= totalPages}
        onClick={handleNext}
        className={btnClass(currentPage >= totalPages)}
      >
        Next
      </button>
    </div>
  );
};

export default PaginationFooter;
