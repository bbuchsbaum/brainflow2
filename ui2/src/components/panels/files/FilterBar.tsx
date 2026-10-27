import React from 'react';
import './FilterBar.css';
import { VscChevronUp, VscChevronDown, VscClose } from 'react-icons/vsc';
import { IconButton, Select, TextField } from '@/components/ui/bf';
import type { FileBrowserState } from '@/types/filesystem';

const SORT_OPTIONS = [
  { value: 'name', label: 'Name' },
  { value: 'modified', label: 'Modified' },
  { value: 'size', label: 'Size' },
  { value: 'type', label: 'Type' },
] as const;

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
            aria-hidden
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
          <TextField
            type="text"
            placeholder="Search"
            value={searchInput}
            onChange={onSearchChange}
            className="fb-search-input pl-7 pr-7"
            aria-label="Search files"
          />
          {searchQuery && (
            <IconButton
              size="xs"
              variant="ghost"
              className="fb-search-clear absolute right-0 top-1/2 -translate-y-1/2"
              onClick={onClearSearch}
              aria-label="Clear search"
              icon={<VscClose />}
            />
          )}
        </div>

        <div className="fb-sort">
          <Select
            value={sortBy}
            onValueChange={(v) => onSortByChange(v as FileBrowserState['sortBy'])}
            className="fb-sort-select"
            aria-label="Sort by"
            options={SORT_OPTIONS}
          />
          <IconButton
            size="xs"
            variant="ghost"
            className="fb-sort-order"
            onClick={onToggleSortOrder}
            title={sortOrder === 'asc' ? 'Sort ascending' : 'Sort descending'}
            aria-label={sortOrder === 'asc' ? 'Sort ascending' : 'Sort descending'}
            icon={sortOrder === 'asc' ? <VscChevronUp /> : <VscChevronDown />}
          />
        </div>
      </div>
    </div>
  );
};
