/**
 * Dropdown component - searchable dropdown with pagination
 */
import React from 'react';
import Spinner from "@atlaskit/spinner";
import '../../styles/Dropdown.css';

const Dropdown = ({ 
  items, 
  isOpen, 
  onClose, 
  onSelect, 
  searchTerm, 
  onSearchChange,
  loading,
  currentPage,
  itemsPerPage,
  onNextPage,
  onPrevPage,
  renderItem,
  emptyMessage = "No items found",
  placeholder = "Search..."
}) => {
  if (!isOpen) return null;

  const filteredItems = items.filter(item => 
    item.title?.toLowerCase().includes(searchTerm.toLowerCase()) ||
    item.name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
    item.label?.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const totalPages = Math.ceil(filteredItems.length / itemsPerPage);
  const startIndex = (currentPage - 1) * itemsPerPage;
  const paginatedItems = filteredItems.slice(startIndex, startIndex + itemsPerPage);

  return (
    <>
      {/* Click outside to close */}
      <div className="dropdown-backdrop" onClick={onClose} />
      
      <div className="dropdown-container">
        <input
          type="text"
          className="dropdown-search"
          placeholder={placeholder}
          value={searchTerm}
          onChange={(e) => onSearchChange(e.target.value)}
          autoFocus
        />

        {loading ? (
          <div className="dropdown-loading">
            <Spinner size="medium" />
          </div>
        ) : paginatedItems.length === 0 ? (
          <div className="dropdown-empty">{emptyMessage}</div>
        ) : (
          <>
            <div className="dropdown-items">
              {paginatedItems.map((item, index) => (
                <div
                  key={index}
                  className="dropdown-item"
                  onClick={() => onSelect(item)}
                >
                  {renderItem ? renderItem(item) : item.title || item.name || item.label}
                </div>
              ))}
            </div>

            {totalPages > 1 && (
              <div className="dropdown-pagination">
                <button
                  className="dropdown-pagination-button"
                  onClick={onPrevPage}
                  disabled={currentPage === 1}
                >
                  Previous
                </button>
                <span className="dropdown-pagination-info">
                  Page {currentPage} of {totalPages}
                </span>
                <button
                  className="dropdown-pagination-button"
                  onClick={onNextPage}
                  disabled={currentPage === totalPages}
                >
                  Next
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </>
  );
};

export default Dropdown;


