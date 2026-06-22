import React from 'react';

// "Tip: Type in the field above..." hint shown when no search term entered.
const SearchHint = ({ text = 'Tip: Type in the field above to search options', size = 'sm' }) => (
  <div className={size === 'lg' ? 'search-hint' : 'search-hint-sm'}>{text}</div>
);

export default SearchHint;
