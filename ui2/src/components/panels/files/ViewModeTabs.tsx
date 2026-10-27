import React from 'react';
import type { FilesViewMode } from '@/stores/fileBrowserStore';
import { Tabs, tabIds } from '@/components/ui/bf';
import './ViewModeTabs.css';

interface ViewModeTabsProps {
  value: FilesViewMode;
  onChange: (mode: FilesViewMode) => void;
}

/** Base for the tab / panel ids; panels use {@link filesViewPanelProps}. */
export const FILES_VIEW_ID_BASE = 'fb-view';

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

const ITEMS = TABS.map((tab) => ({
  value: tab.id,
  title: tab.title,
  label: (
    <>
      <span className="fb-view-mode-tab-letter" aria-hidden="true">
        {tab.letter}
      </span>
      <span className="fb-view-mode-tab-label">{tab.label}</span>
    </>
  ),
}));

/** `role="tabpanel"` wiring for the view shown under a Files view tab. */
export function filesViewPanelProps(mode: FilesViewMode) {
  const ids = tabIds(FILES_VIEW_ID_BASE, mode);
  return { role: 'tabpanel' as const, id: ids.panel, 'aria-labelledby': ids.tab };
}

/** Files view switcher: bf flat Tabs (fill), neutral active edge. */
export const ViewModeTabs: React.FC<ViewModeTabsProps> = ({ value, onChange }) => (
  <Tabs
    fill
    density="compact"
    idBase={FILES_VIEW_ID_BASE}
    items={ITEMS}
    value={value}
    onValueChange={(next) => onChange(next as FilesViewMode)}
    aria-label="File view mode"
    className="fb-view-mode-tabs"
  />
);
