export type HeaderActionPriority = 'primary' | 'secondary' | 'destructive';
export type HeaderActionPlacement = 'inline' | 'overflow';

export interface PanelHeaderActionSpec {
  id: string;
  label: string;
  icon?: string;
  priority: HeaderActionPriority;
  placement: HeaderActionPlacement;
  tooltip?: string;
  shortcut?: string;
}

export interface PanelHeaderSpec {
  panelId: 'files' | 'surfaces' | 'goldenlayout';
  title: string;
  inlineLimit: number;
  actions: PanelHeaderActionSpec[];
}

// Baseline model for bd-2fs.4.1. bd-2fs.4.2 will consume this in UI rendering.
export const PANEL_HEADER_SPECS: Record<PanelHeaderSpec['panelId'], PanelHeaderSpec> = {
  files: {
    panelId: 'files',
    title: 'Files',
    inlineLimit: 3,
    actions: [
      { id: 'search', label: 'Search', icon: 'search', priority: 'primary', placement: 'inline' },
      { id: 'sortBy', label: 'Sort By', icon: 'sort', priority: 'secondary', placement: 'inline' },
      { id: 'sortOrder', label: 'Sort Direction', icon: 'arrowUpDown', priority: 'secondary', placement: 'inline' },
      { id: 'refresh', label: 'Refresh', icon: 'refreshCw', priority: 'secondary', placement: 'overflow' },
      { id: 'reveal', label: 'Reveal in Finder', icon: 'folderOpen', priority: 'secondary', placement: 'overflow' },
    ],
  },
  surfaces: {
    panelId: 'surfaces',
    title: 'Surfaces',
    inlineLimit: 1,
    actions: [
      { id: 'loadSurface', label: 'Load Surface', icon: 'plus', priority: 'primary', placement: 'inline' },
      { id: 'expandAll', label: 'Expand All', icon: 'chevronsDown', priority: 'secondary', placement: 'overflow' },
      { id: 'collapseAll', label: 'Collapse All', icon: 'chevronsUp', priority: 'secondary', placement: 'overflow' },
      { id: 'clearErrors', label: 'Clear Errors', icon: 'alertTriangle', priority: 'secondary', placement: 'overflow' },
    ],
  },
  goldenlayout: {
    panelId: 'goldenlayout',
    title: 'Panel Chrome',
    inlineLimit: 1,
    actions: [
      { id: 'close', label: 'Close Panel', icon: 'x', priority: 'primary', placement: 'inline' },
      { id: 'maximize', label: 'Maximize Panel', icon: 'square', priority: 'secondary', placement: 'overflow' },
      { id: 'popout', label: 'Pop Out Panel', icon: 'externalLink', priority: 'secondary', placement: 'overflow' },
    ],
  },
};
