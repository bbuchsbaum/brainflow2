import React from 'react';
import './FilterBar.css';
import { VscChevronUp, VscChevronDown } from 'react-icons/vsc';
import type { FileBrowserState } from '@/types/filesystem';

interface FilterBarProps {
  searchInput: string;
  searchQuery: string;
  sortBy: FileBrowserState['sortBy'];
  sortOrder: FileBrowserState['sortOrder'];
  onSearchChange: (event: React.ChangeEvent<HTMLInputElement>) => void;
  onClearSearch: () => void;
  onSortByChange: (sortBy: FileBrowserState['sortBy']) => void;
  onToggleSortOrder: () => void;
}

export const FilterBar: React.FC<FilterBarProps> = ({
  searchInput,
  searchQuery,
  sortBy,
  sortOrder,
  onSearchChange,
  onClearSearch,
  onSortByChange,
  onToggleSortOrder,
}) => {
  return (
    <div className="fb-controls">
      <div className="fb-controls-bottom">
        <div className="fb-search">
          <svg
            className="fb-search-icon"
            width="14"
            height="14"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth="2"
              d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
            />
          </svg>
          <input
            type="text"
            placeholder="Search files..."
            value={searchInput}
            onChange={onSearchChange}
            className="fb-search-input"
            aria-label="Search files"
          />
          {searchQuery && (
            <button
              type="button"
              className="fb-search-clear"
              onClick={onClearSearch}
              aria-label="Clear search"
            >
              <svg width="12" height="12" fill="currentColor" viewBox="0 0 20 20">
                <path
                  fillRule="evenodd"
                  d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z"
                  clipRule="evenodd"
                />
              </svg>
            </button>
          )}
        </div>

        <div className="fb-sort">
          <select
            value={sortBy}
            onChange={(e) => onSortByChange(e.target.value as FileBrowserState['sortBy'])}
            className="fb-sort-select"
            aria-label="Sort by"
          >
            <option value="name">Name</option>
            <option value="modified">Modified</option>
            <option value="size">Size</option>
            <option value="type">Type</option>
          </select>
          <button
            type="button"
            className="fb-sort-order"
            onClick={onToggleSortOrder}
            title={sortOrder === 'asc' ? 'Sort ascending' : 'Sort descending'}
            aria-label={sortOrder === 'asc' ? 'Sort ascending' : 'Sort descending'}
          >
            {sortOrder === 'asc' ? <VscChevronUp /> : <VscChevronDown />}
          </button>
        </div>
      </div>
    </div>
  );
};
