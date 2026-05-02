/**
 * ActivityPanel — fills the bottom dock's `activity` slot.
 *
 * Shows the current loading queue (active loads, queued items, recent
 * completions / errors) sourced from `useLoadingQueueStore`. The store
 * already tracks lifecycle, progress, and a bounded completed history,
 * so this component is purely a presentation layer.
 *
 * Conforms to mockup-7 / Design.md §11.2 (`Activity` = jobs, loads,
 * network, errors). Edits to a load belong to the load orchestrators
 * (LayerService / SurfaceLoadingService); this panel is read-only with
 * a clear-completed action.
 */

import React, { useMemo } from 'react';
import { CheckCircle2, AlertCircle, Loader2, Hourglass, XCircle, Trash2 } from 'lucide-react';

import {
  useLoadingQueueStore,
  type LoadingQueueItem,
  type LoadingStatus,
} from '@/stores/loadingQueueStore';
import { PanelErrorBoundary } from '../common/PanelErrorBoundary';

const containerStyle: React.CSSProperties = {
  height: '100%',
  width: '100%',
  display: 'flex',
  flexDirection: 'column',
  background: 'var(--app-surface-panel-raised)',
  color: 'var(--app-text-primary)',
};

const HEADER_HEIGHT = 24;

const TOOLBAR_STYLE: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  height: `${HEADER_HEIGHT}px`,
  minHeight: `${HEADER_HEIGHT}px`,
  padding: '0 8px',
  borderBottom: '1px solid var(--app-border-subtle)',
  flex: '0 0 auto',
};

const SECTION_TITLE_STYLE: React.CSSProperties = {
  fontSize: 'var(--app-role-section-size)',
  letterSpacing: 'var(--app-role-section-tracking)',
  textTransform: 'uppercase',
  color: 'var(--app-text-muted)',
  padding: '6px 8px 2px',
};

const ROW_STYLE: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: '14px 1fr auto',
  gap: '6px',
  alignItems: 'center',
  padding: '4px 8px',
  borderRadius: '2px',
  fontSize: 'var(--app-role-body-size)',
  color: 'var(--app-text-primary)',
};

const META_STYLE: React.CSSProperties = {
  fontSize: 'var(--app-role-section-size)',
  color: 'var(--app-text-muted)',
  fontFamily: 'var(--app-font-mono, monospace)',
};

const PROGRESS_TRACK_STYLE: React.CSSProperties = {
  width: '100%',
  height: '2px',
  background: 'var(--app-border-subtle)',
  borderRadius: '1px',
  overflow: 'hidden',
  marginTop: '2px',
};

function formatDuration(item: LoadingQueueItem): string {
  if (item.startTime && item.endTime) {
    const ms = item.endTime - item.startTime;
    if (ms < 1000) return `${ms} ms`;
    return `${(ms / 1000).toFixed(1)} s`;
  }
  if (item.startTime && !item.endTime) {
    const ms = Date.now() - item.startTime;
    if (ms < 1000) return `${ms} ms`;
    return `${(ms / 1000).toFixed(0)} s`;
  }
  return '';
}

function StatusIcon({ status }: { status: LoadingStatus }) {
  const common = { width: 14, height: 14, 'aria-hidden': true } as const;
  switch (status) {
    case 'queued':
      return <Hourglass {...common} style={{ color: 'var(--app-text-muted)' }} />;
    case 'loading':
      return <Loader2 {...common} style={{ color: 'var(--app-accent, #2f80ff)' }} />;
    case 'complete':
      return <CheckCircle2 {...common} style={{ color: 'var(--app-success, #35d36b)' }} />;
    case 'error':
      return <AlertCircle {...common} style={{ color: 'var(--app-danger, #ef4444)' }} />;
    case 'cancelled':
      return <XCircle {...common} style={{ color: 'var(--app-text-faint, #566579)' }} />;
    default:
      return null;
  }
}

interface ActivityRowProps {
  item: LoadingQueueItem;
  testid: string;
}

const ActivityRow: React.FC<ActivityRowProps> = ({ item, testid }) => {
  const showProgress = item.status === 'loading' && typeof item.progress === 'number';
  const duration = item.endTime ? formatDuration(item) : '';

  return (
    <div
      data-testid={testid}
      data-status={item.status}
      data-type={item.type}
      style={ROW_STYLE}
    >
      <StatusIcon status={item.status} />
      <div style={{ minWidth: 0 }}>
        <div
          style={{
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            color:
              item.status === 'error'
                ? 'var(--app-danger, #ef4444)'
                : 'var(--app-text-primary)',
          }}
          title={item.path}
        >
          {item.displayName || item.path}
        </div>
        {item.error ? (
          <div
            style={{
              ...META_STYLE,
              color: 'var(--app-danger, #ef4444)',
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}
            title={item.error.message}
          >
            {item.error.message}
          </div>
        ) : null}
        {showProgress ? (
          <div style={PROGRESS_TRACK_STYLE} aria-hidden="true">
            <div
              data-testid={`${testid}-progress`}
              style={{
                width: `${Math.min(100, Math.max(0, item.progress ?? 0))}%`,
                height: '100%',
                background: 'var(--app-accent, #2f80ff)',
                transition: 'width 120ms linear',
              }}
            />
          </div>
        ) : null}
      </div>
      <span style={META_STYLE}>
        {item.status === 'loading' && typeof item.progress === 'number'
          ? `${Math.round(item.progress)}%`
          : duration}
      </span>
    </div>
  );
};

interface ActivitySectionProps {
  title: string;
  items: readonly LoadingQueueItem[];
  emptyLabel: string;
  testidPrefix: string;
}

const ActivitySection: React.FC<ActivitySectionProps> = ({
  title,
  items,
  emptyLabel,
  testidPrefix,
}) => {
  return (
    <div data-testid={`${testidPrefix}-section`}>
      <div style={SECTION_TITLE_STYLE}>
        {title}
        <span data-testid={`${testidPrefix}-count`} style={{ marginLeft: 6, opacity: 0.7 }}>
          {items.length}
        </span>
      </div>
      {items.length === 0 ? (
        <div
          data-testid={`${testidPrefix}-empty`}
          style={{ ...META_STYLE, padding: '2px 12px 6px' }}
        >
          {emptyLabel}
        </div>
      ) : (
        <div role="list">
          {items.map((item) => (
            <ActivityRow
              key={item.id}
              item={item}
              testid={`${testidPrefix}-item-${item.id}`}
            />
          ))}
        </div>
      )}
    </div>
  );
};

const ActivityPanelContent: React.FC = () => {
  const queue = useLoadingQueueStore((s) => s.queue);
  const activeLoads = useLoadingQueueStore((s) => s.activeLoads);
  const completed = useLoadingQueueStore((s) => s.completed);
  const clearCompleted = useLoadingQueueStore((s) => s.clearCompleted);

  const active = useMemo(() => Array.from(activeLoads.values()), [activeLoads]);
  // Newest first; cap at 20 to keep the panel light without losing recency.
  const recent = useMemo(() => completed.slice(-20).reverse(), [completed]);

  const hasNothing = active.length === 0 && queue.length === 0 && recent.length === 0;

  return (
    <div data-testid="activity-panel" style={containerStyle}>
      <div style={TOOLBAR_STYLE}>
        <span
          className="bf-role-section"
          style={{
            fontSize: 'var(--app-role-section-size)',
            letterSpacing: 'var(--app-role-section-tracking)',
            color: 'var(--app-text-muted)',
            textTransform: 'uppercase',
          }}
        >
          {active.length} active · {queue.length} queued · {recent.length} recent
        </span>
        <button
          type="button"
          data-testid="activity-panel-clear"
          aria-label="Clear completed activity"
          onClick={clearCompleted}
          disabled={recent.length === 0}
          style={{
            appearance: 'none',
            background: 'transparent',
            border: 'none',
            padding: '0 4px',
            cursor: recent.length === 0 ? 'not-allowed' : 'pointer',
            color: recent.length === 0 ? 'var(--app-text-disabled)' : 'var(--app-text-muted)',
            display: 'inline-flex',
            alignItems: 'center',
            gap: '4px',
            fontSize: 'var(--app-role-section-size)',
            textTransform: 'uppercase',
            letterSpacing: 'var(--app-role-section-tracking)',
          }}
        >
          <Trash2 width={12} height={12} aria-hidden="true" />
          Clear
        </button>
      </div>

      <div style={{ flex: '1 1 auto', minHeight: 0, overflow: 'auto', padding: '4px 0 8px' }}>
        {hasNothing ? (
          <div
            data-testid="activity-panel-empty"
            style={{
              ...META_STYLE,
              textAlign: 'center',
              padding: '16px 12px',
              color: 'var(--app-text-disabled)',
            }}
          >
            No activity. File loads, surface mounts, and atlas requests appear here.
          </div>
        ) : (
          <>
            <ActivitySection
              title="Active"
              items={active}
              emptyLabel="No active loads."
              testidPrefix="activity-active"
            />
            <ActivitySection
              title="Queued"
              items={queue}
              emptyLabel="Queue empty."
              testidPrefix="activity-queued"
            />
            <ActivitySection
              title="Recent"
              items={recent}
              emptyLabel="No recent completions."
              testidPrefix="activity-recent"
            />
          </>
        )}
      </div>
    </div>
  );
};

export const ActivityPanel: React.FC = () => (
  <PanelErrorBoundary panelName="ActivityPanel">
    <ActivityPanelContent />
  </PanelErrorBoundary>
);

export default ActivityPanel;
