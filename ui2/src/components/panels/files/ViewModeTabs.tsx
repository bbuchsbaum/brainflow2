import React from 'react';
import type { FilesViewMode } from '@/stores/fileBrowserStore';
import './ViewModeTabs.css';

interface ViewModeTabsProps {
  value: FilesViewMode;
  onChange: (mode: FilesViewMode) => void;
}

interface TabSpec {
  id: FilesViewMode;
  label: string;
  letter: string;
  title: string;
}

const TABS: readonly TabSpec[] = [
  { id: 'tree', label: 'Tree', letter: 'T', title: 'Folder tree' },
  { id: 'bids', label: 'BIDS', letter: 'B', title: 'BIDS dataset view' },
  { id: 'images', label: 'Images', letter: 'I', title: 'Flat list of imaging files' },
  { id: 'loaded', label: 'Loaded', letter: 'L', title: 'Currently loaded layers' },
];

export const ViewModeTabs: React.FC<ViewModeTabsProps> = ({ value, onChange }) => {
  return (
    <div className="fb-view-mode-tabs" role="tablist" aria-label="File view mode">
      {TABS.map((tab) => {
        const active = tab.id === value;
        return (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={active}
            className={`fb-view-mode-tab${active ? ' is-active' : ''}`}
            onClick={() => onChange(tab.id)}
            title={tab.title}
          >
            <span className="fb-view-mode-tab-letter" aria-hidden="true">
              {tab.letter}
            </span>
            <span className="fb-view-mode-tab-label">{tab.label}</span>
          </button>
        );
      })}
    </div>
  );
};
