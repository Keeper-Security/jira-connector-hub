import React, { useState, useEffect } from 'react';
import { router } from '@forge/bridge';
import * as api from '../../services/api';
import '../../styles/WebhookTicketsTable.css';

const WebhookTicketsTable = ({ visible, onClose }) => {
  const [tickets, setTickets] = useState([]);
  const [filteredTickets, setFilteredTickets] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage] = useState(10);

  useEffect(() => {
    if (visible) {
      loadTickets();
      setSearchQuery('');
      setCurrentPage(1);
    }
  }, [visible]);

  // Filter tickets based on search query
  useEffect(() => {
    if (!searchQuery.trim()) {
      setFilteredTickets(tickets);
    } else {
      const query = searchQuery.toLowerCase();
      const filtered = tickets.filter(ticket => 
        ticket.key.toLowerCase().includes(query) ||
        (ticket.requestUid && ticket.requestUid.toLowerCase().includes(query)) ||
        (ticket.username && ticket.username.toLowerCase().includes(query)) ||
        (ticket.status && ticket.status.toLowerCase().includes(query)) ||
        (ticket.description && ticket.description.toLowerCase().includes(query))
      );
      setFilteredTickets(filtered);
    }
    setCurrentPage(1); // Reset to first page when search changes
  }, [searchQuery, tickets]);

  const loadTickets = async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await api.getWebhookTickets();
      if (result.success) {
        setTickets(result.issues || []);
      } else {
        setError(result.message || 'Failed to load tickets');
      }
    } catch (err) {
      console.error('Error loading webhook tickets:', err);
      setError(err.message || 'Failed to load webhook tickets');
    } finally {
      setLoading(false);
    }
  };

  const formatDate = (dateString) => {
    const date = new Date(dateString);
    return date.toLocaleString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  const openIssue = async (issueKey) => {
    try {
      // Use Forge Bridge router to navigate to the issue
      await router.navigate(`/browse/${issueKey}`);
    } catch (err) {
      console.error('Error opening issue:', err);
      // Fallback: try to open in current tab if navigation fails
      window.location.href = `/browse/${issueKey}`;
    }
  };

  // Calculate pagination
  const totalPages = Math.ceil(filteredTickets.length / itemsPerPage);
  const startIndex = (currentPage - 1) * itemsPerPage;
  const endIndex = startIndex + itemsPerPage;
  const currentTickets = filteredTickets.slice(startIndex, endIndex);

  const handlePageChange = (page) => {
    if (page >= 1 && page <= totalPages) {
      setCurrentPage(page);
    }
  };

  const getPageNumbers = () => {
    const pages = [];
    const maxVisiblePages = 5;
    
    if (totalPages <= maxVisiblePages) {
      for (let i = 1; i <= totalPages; i++) {
        pages.push(i);
      }
    } else {
      if (currentPage <= 3) {
        for (let i = 1; i <= 4; i++) pages.push(i);
        pages.push('...');
        pages.push(totalPages);
      } else if (currentPage >= totalPages - 2) {
        pages.push(1);
        pages.push('...');
        for (let i = totalPages - 3; i <= totalPages; i++) pages.push(i);
      } else {
        pages.push(1);
        pages.push('...');
        for (let i = currentPage - 1; i <= currentPage + 1; i++) pages.push(i);
        pages.push('...');
        pages.push(totalPages);
      }
    }
    
    return pages;
  };

  if (!visible) {
    return null;
  }

  return (
    <div className="webhook-tickets-overlay">
      <div className="webhook-tickets-modal">
        <div className="webhook-tickets-header">
          <h3>Webhook Created Tickets</h3>
          <button className="webhook-tickets-close" onClick={onClose}>×</button>
        </div>

        <div className="webhook-tickets-content">
          {loading && (
            <div className="webhook-tickets-loading">
              <div className="spinner"></div>
              <p>Loading tickets...</p>
            </div>
          )}

          {error && (
            <div className="webhook-tickets-error">
              <p>Error: {error}</p>
              <button onClick={loadTickets}>Retry</button>
            </div>
          )}

          {!loading && !error && tickets.length === 0 && (
            <div className="webhook-tickets-empty">
              <p>No webhook tickets found. Tickets will appear here once created by the webhook.</p>
            </div>
          )}

          {!loading && !error && tickets.length > 0 && (
            <>
              {/* Search Input */}
              <div className="webhook-tickets-search">
                <input
                  type="text"
                  placeholder="Search by issue key, request UID, username, status, or description..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="webhook-tickets-search-input"
                />
                {searchQuery && (
                  <button
                    className="webhook-tickets-search-clear"
                    onClick={() => setSearchQuery('')}
                    title="Clear search"
                  >
                    ×
                  </button>
                )}
              </div>

              {/* Results Info */}
              {searchQuery && (
                <div className="webhook-tickets-results-info">
                  Found {filteredTickets.length} of {tickets.length} tickets
                </div>
              )}

              {filteredTickets.length === 0 ? (
                <div className="webhook-tickets-empty">
                  <p>No tickets match your search criteria.</p>
                </div>
              ) : (
                <div className="webhook-tickets-table-container">
                  <table className="webhook-tickets-table">
                    <thead>
                      <tr>
                        <th>Issue Key</th>
                        <th>Request UID</th>
                        <th>Status</th>
                        <th>Username</th>
                        <th>Created</th>
                        <th>Description</th>
                      </tr>
                    </thead>
                    <tbody>
                      {currentTickets.map((ticket) => (
                    <tr key={ticket.key}>
                      <td>
                        <button
                          className="issue-link-button"
                          onClick={() => openIssue(ticket.key)}
                          title={`Open ${ticket.key}`}
                        >
                          {ticket.key}
                        </button>
                      </td>
                      <td className="monospace">{ticket.requestUid || '-'}</td>
                      <td>
                        <span className={`status-badge status-${ticket.status.toLowerCase().replace(/\s+/g, '-')}`}>
                          {ticket.status}
                        </span>
                      </td>
                      <td>{ticket.username || '-'}</td>
                      <td className="date-cell">{formatDate(ticket.created)}</td>
                      <td className="description-cell" title={ticket.description}>
                        {ticket.description}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
              )}
            </>
          )}
        </div>

        <div className="webhook-tickets-footer">
          <div className="tickets-count">
            {filteredTickets.length > 0 && (
              <>
                Showing {startIndex + 1}-{Math.min(endIndex, filteredTickets.length)} of {filteredTickets.length} ticket{filteredTickets.length !== 1 ? 's' : ''}
              </>
            )}
          </div>

          {/* Pagination Controls */}
          {totalPages > 1 && (
            <div className="webhook-tickets-pagination">
              <button
                className="pagination-btn"
                onClick={() => handlePageChange(currentPage - 1)}
                disabled={currentPage === 1}
                title="Previous page"
              >
                ‹
              </button>
              
              {getPageNumbers().map((page, index) => (
                page === '...' ? (
                  <span key={`ellipsis-${index}`} className="pagination-ellipsis">...</span>
                ) : (
                  <button
                    key={page}
                    className={`pagination-btn ${currentPage === page ? 'active' : ''}`}
                    onClick={() => handlePageChange(page)}
                  >
                    {page}
                  </button>
                )
              ))}
              
              <button
                className="pagination-btn"
                onClick={() => handlePageChange(currentPage + 1)}
                disabled={currentPage === totalPages}
                title="Next page"
              >
                ›
              </button>
            </div>
          )}

          <div className="webhook-tickets-actions">
            <button className="webhook-tickets-refresh" onClick={loadTickets}>
              Refresh
            </button>
            <button className="webhook-tickets-close-btn" onClick={onClose}>
              Close
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default WebhookTicketsTable;

