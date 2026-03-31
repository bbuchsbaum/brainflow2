import React from 'react';
import { useBidsStore } from '@/stores/bidsStore';
import { BidsEmptyState } from './BidsEmptyState';
import { BidsSummaryStrip } from './BidsSummaryStrip';
import { BidsDetailTabs } from './BidsDetailTabs';
import { BidsCoverageMatrix } from './BidsCoverageMatrix';

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
        <p className="bf-role-section" style={{ color: 'var(--app-error)' }}>
          SCAN FAILED
        </p>

        <p className="bf-role-body text-foreground/80 leading-relaxed" style={{ marginTop: '32px' }}>
          {message}
        </p>

        <p className="bf-role-body text-muted-foreground" style={{ marginTop: '8px' }}>
          {datasetPath
            ? 'Verify the path is a valid BIDS dataset, then retry.'
            : 'No dataset path is set. Open a dataset to begin.'}
        </p>

        <div className="flex gap-3" style={{ marginTop: '24px' }}>
          <button
            type="button"
            className="bf-control-sm rounded-appsm border border-border bg-background px-3 text-[10px] font-semibold uppercase tracking-[0.08em] text-foreground transition-colors hover:border-primary hover:text-primary"
            onClick={handleRetry}
          >
            {datasetPath ? 'Retry' : 'Open Dataset'}
          </button>
          {datasetPath && (
            <button
              type="button"
              className="bf-control-sm rounded-appsm border border-border bg-background px-3 text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground transition-colors hover:border-border hover:text-foreground"
              onClick={reset}
            >
              Clear
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Ready state — three-zone vertical layout
// ---------------------------------------------------------------------------

function BidsReadyLayout() {
  return (
    <div className="absolute inset-0 flex flex-col overflow-hidden">
      {/* Summary strip — fixed height */}
      <div className="shrink-0" style={{ height: '48px' }}>
        <BidsSummaryStrip />
      </div>

      {/* Coverage matrix — grows */}
      <div className="flex-1 overflow-auto min-h-0">
        <BidsCoverageMatrix />
      </div>

      {/* Detail tabs — fixed height */}
      <div className="shrink-0 border-t border-border" style={{ height: '280px' }}>
        <BidsDetailTabs />
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

export function BidsExplorerWorkspace({ workspaceId: _workspaceId }: BidsExplorerWorkspaceProps) {
  const scanStatus = useBidsStore((state) => state.scanStatus);
  const scanError = useBidsStore((state) => state.scanError);
  const datasetPath = useBidsStore((state) => state.datasetPath);

  switch (scanStatus) {
    case 'idle':
      return <BidsEmptyState />;

    case 'scanning':
      return <BidsScanningState />;

    case 'error':
      return (
        <BidsErrorState
          message={scanError ?? 'An unknown error occurred while scanning the dataset.'}
          datasetPath={datasetPath}
        />
      );

    case 'ready':
      return <BidsReadyLayout />;

    default:
      return <BidsEmptyState />;
  }
}
