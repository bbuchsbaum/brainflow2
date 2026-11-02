import React, { useEffect } from 'react';
import { useBidsShortcuts } from '@/hooks/useBidsShortcuts';
import { useBidsStore } from '@/stores/bidsStore';
import { useFileBrowserStore } from '@/stores/fileBrowserStore';
import { useLayoutSettingsStore } from '@/stores/layoutSettingsStore';
import { useWorkspaceStore } from '@/stores/workspaceStore';
import { DEFAULT_DOCK_TAB } from '@/components/layout/bottomWorkbenchDock.constants';
import { BidsEmptyState } from './BidsEmptyState';
import { BidsCoverage } from './BidsCoverage';
import { BidsActionHost } from './BidsActionHost';
import { BidsSummary } from './BidsSummary';
import { BidsUndoStrip } from './BidsUndoStrip';
import { BidsViewBar } from './BidsViewBar';
import { BIDS_RUNS_TAB } from './bidsDock';
import { Button, Notice } from '@/components/ui/bf';

// ---------------------------------------------------------------------------
// Scanning state
// ---------------------------------------------------------------------------

function BidsScanningState() {
  return (
    <div
      className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-background"
      role="status"
      aria-live="polite"
    >
      {/* Minimal spinner — no library dependency */}
      <svg
        className="animate-spin"
        width="16"
        height="16"
        viewBox="0 0 16 16"
        fill="none"
        aria-hidden="true"
      >
        <circle
          cx="8"
          cy="8"
          r="6"
          stroke="currentColor"
          strokeWidth="2"
          className="text-border"
        />
        <path
          d="M8 2a6 6 0 0 1 6 6"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          className="text-primary"
        />
      </svg>
      <span className="bf-role-body text-muted-foreground">Scanning BIDS dataset&hellip;</span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Error state
// ---------------------------------------------------------------------------

interface BidsErrorStateProps {
  message: string;
  datasetPath: string | null;
}

function BidsErrorState({ message, datasetPath }: BidsErrorStateProps) {
  const scanDataset = useBidsStore((state) => state.scanDataset);
  const reset = useBidsStore((state) => state.reset);

  function handleRetry() {
    if (datasetPath) {
      void scanDataset(datasetPath);
    } else {
      reset();
    }
  }

  return (
    <div
      className="absolute inset-0 flex items-center justify-center bg-background"
      role="alert"
    >
      <div className="w-full px-8" style={{ maxWidth: '720px' }}>
        <h2 className="bf-role-title text-foreground">Scan failed</h2>

        <Notice severity="danger" role={undefined} className="mt-4">
          {message}
        </Notice>

        <p className="mt-2 text-bf-sm text-muted-foreground">
          {datasetPath
            ? 'Verify the path is a valid BIDS dataset, then retry.'
            : 'No dataset path is set. Open a dataset to begin.'}
        </p>

        <div className="mt-5 flex gap-2">
          <Button variant="primary" size="sm" onClick={handleRetry}>
            {datasetPath ? 'Retry' : 'Open dataset'}
          </Button>
          {datasetPath && (
            <Button variant="secondary" size="sm" onClick={reset}>
              Clear
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Ready state: summary, view bar, the view, undo strip; key hints sit below the dock
// ---------------------------------------------------------------------------

function BidsScanProgressBar() {
  const fraction = useBidsStore((state) => {
    const progress = state.scanProgress;
    return progress && progress.subjects_total > 0 ? progress.subjects_done / progress.subjects_total : null;
  });
  if (fraction === null) return null;
  return (
    <div
      role="progressbar"
      aria-label="Scan progress"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(fraction * 100)}
      className="h-0.5 shrink-0 bg-bf-border-subtle"
    >
      <div className="h-full bg-bf-text-secondary" style={{ width: `${fraction * 100}%` }} />
    </div>
  );
}

function BidsImagesPlaceholder() {
  return (
    <div
      className="absolute inset-0 flex flex-col items-center justify-center gap-1 text-center"
      data-testid="bids-images-placeholder"
    >
      <p className="m-0 text-bf-sm text-bf-text-secondary">The contact sheet is not built yet.</p>
      <p className="m-0 text-bf-xs text-bf-text-faint">
        It will show one slice per subject and session. Press 1 for Coverage.
      </p>
    </div>
  );
}

function BidsReadyLayout() {
  const activeView = useBidsStore((state) => state.activeView);
  const scanError = useBidsStore((state) => state.scanError);
  return (
    <div className="absolute inset-0 flex flex-col overflow-hidden" data-testid="bids-ready">
      <BidsSummary />
      <BidsScanProgressBar />
      <BidsViewBar />
      {scanError && (
        <Notice severity="danger" className="shrink-0">
          Scan stopped: {scanError}
        </Notice>
      )}
      <div className="relative min-h-0 flex-1">
        {activeView === 'coverage' ? <BidsCoverage /> : <BidsImagesPlaceholder />}
      </div>
      <BidsUndoStrip />
      <BidsActionHost />
    </div>
  );
}

// ---------------------------------------------------------------------------
// A finished scan with nothing to show
// ---------------------------------------------------------------------------

function BidsNoRunsState() {
  const complete = useBidsStore((state) => state.index?.complete ?? false);
  const datasetPath = useBidsStore((state) => state.datasetPath);
  const scanDataset = useBidsStore((state) => state.scanDataset);
  return (
    <div className="absolute inset-0 flex items-center justify-center bg-background" role="status">
      <div className="w-full px-8" style={{ maxWidth: '720px' }}>
        <h2 className="bf-role-title text-foreground">
          {complete ? 'No images in this dataset' : 'Scan paused before any participant was read'}
        </h2>
        <p className="mt-2 text-bf-sm text-muted-foreground">
          {complete
            ? 'The scan finished and found no NIfTI images in the raw tree.'
            : 'Nothing has been read yet. Resume to continue.'}
        </p>
        {datasetPath && (
          <div className="mt-5">
            <Button variant="secondary" size="sm" onClick={() => void scanDataset(datasetPath)}>
              {complete ? 'Scan again' : 'Resume'}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Workspace root
// ---------------------------------------------------------------------------

interface BidsExplorerWorkspaceProps {
  workspaceId: string;
}

export function BidsExplorerWorkspace({ workspaceId }: BidsExplorerWorkspaceProps) {
  const scanStatus = useBidsStore((state) => state.scanStatus);
  const scanError = useBidsStore((state) => state.scanError);
  const datasetPath = useBidsStore((state) => state.datasetPath);
  const hasRows = useBidsStore((state) => (state.index?.runs.length ?? 0) > 0);
  const inFront = useWorkspaceStore((state) => state.activeWorkspaceId === workspaceId);

  useBidsShortcuts();

  // The dock shows the runs here; the viewer gets its own tab back on leaving.
  useEffect(() => {
    if (!inFront || !hasRows) return;
    const settings = useLayoutSettingsStore.getState();
    const previous = settings.bottomDockActiveTab;
    settings.setBottomDockActiveTab(BIDS_RUNS_TAB);
    return () => {
      const current = useLayoutSettingsStore.getState();
      if (current.bottomDockActiveTab === BIDS_RUNS_TAB) {
        current.setBottomDockActiveTab(
          previous && previous !== BIDS_RUNS_TAB ? previous : DEFAULT_DOCK_TAB,
        );
      }
    };
  }, [inFront, hasRows]);

  // Files shows the dataset here and follows the selection; it goes back on leaving.
  useEffect(() => {
    if (!inFront || !hasRows) return;
    const files = useFileBrowserStore.getState();
    const mounted = files.entries.some((entry) => entry.path === datasetPath);
    if (!mounted || files.viewMode === 'bids') return;
    const previous = files.viewMode;
    files.setViewMode('bids');
    return () => useFileBrowserStore.getState().setViewMode(previous);
  }, [inFront, hasRows, datasetPath]);

  // A scan never blocks the workspace once rows exist.
  if (hasRows) return <BidsReadyLayout />;
  if (scanStatus === 'ready') return <BidsNoRunsState />;

  switch (scanStatus) {
    case 'scanning':
      return <BidsScanningState />;

    case 'error':
      return (
        <BidsErrorState
          message={scanError ?? 'An unknown error occurred while scanning the dataset.'}
          datasetPath={datasetPath}
        />
      );

    default:
      return <BidsEmptyState />;
  }
}
