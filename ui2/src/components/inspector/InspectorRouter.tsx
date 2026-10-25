import React, { useState } from 'react';
import { getTransport } from '@/services/transport';
import { getEventBus } from '@/events/EventBus';
import { AtlasPicker, ProjectionPicker } from './imaging/InspectorLoadDialogs';
import { useDisplayMode } from '@/hooks/useDisplayMode';
import { useSceneStack } from '@/hooks/useSceneStack';
import { useInspectorSelectionStore } from '@/stores/inspectorSelectionStore';
import { StudioInspectorPanel } from '@/components/studio/StudioInspectorPanel';
import { LoadSheet } from './imaging/LoadSheet';
import { BidsInspector } from './bids/BidsInspector';
import { AnalysisInspector } from './analysis/AnalysisInspector';
import { ImagingInspector } from './imaging/ImagingInspector';

/**
 * Right-rail Inspector shell. Owns the chrome:
 *   - a thin context toolbar (`+ Load` action + `Annotate` mode toggle)
 *   - the scrollable body (Inspector or Annotate)
 *   - the footer (`N scene items` / `M selected`)
 *
 * The dock tab itself carries the word "INSPECTOR" — we deliberately do
 * NOT repeat it inside the panel. Active workspace context (Compare,
 * Mosaic, Studio, …) is conveyed by the workspace tab in the center
 * stack and the eventual left mode rail; surfacing it here too would be
 * the same redundancy.
 *
 * The body dispatches on the active workspace's display mode:
 *   - imaging modes (orthogonal / integrated / mosaic / compare) → `<ImagingInspector />`
 *   - set-studio → existing `<StudioInspectorPanel />`, unchanged
 *   - bids → `<BidsInspector />` placeholder
 *   - analysis → `<AnalysisInspector />` placeholder
 */
export function InspectorRouter() {
  const [topLevelMode, setTopLevelMode] = useState<'inspector' | 'annotate'>('inspector');
  const [loadOpen, setLoadOpen] = useState(false);

  return (
    <section
      className="flex h-full min-h-0 flex-col overflow-hidden bg-background text-foreground"
      aria-label="Inspector"
    >
      <ContextToolbar
        topLevelMode={topLevelMode}
        onSelectMode={setTopLevelMode}
        onOpenLoad={() => setLoadOpen((p) => !p)}
        loadOpen={loadOpen}
        onCloseLoad={() => setLoadOpen(false)}
      />

      <div className="min-h-0 flex-1 overflow-y-auto">
        {topLevelMode === 'inspector' ? <InspectorBody /> : <AnnotateBody />}
      </div>

      <InspectorFooter />
    </section>
  );
}

function ContextToolbar({
  topLevelMode,
  onSelectMode,
  onOpenLoad,
  loadOpen,
  onCloseLoad,
}: {
  topLevelMode: 'inspector' | 'annotate';
  onSelectMode: (mode: 'inspector' | 'annotate') => void;
  onOpenLoad: () => void;
  loadOpen: boolean;
  onCloseLoad: () => void;
}) {
  const annotateActive = topLevelMode === 'annotate';
  const [dialog, setDialog] = useState<'atlas' | 'projection' | null>(null);
  const openFile = () => {
    void getTransport().invoke('open_file_dialog').catch((error: unknown) => {
      getEventBus().emit('ui.notification', { type: 'error', message: `Unable to open file dialog: ${String(error)}` });
    });
  };

  return (
    <header className="relative flex items-center justify-end gap-1.5 border-b border-border/60 bg-card/40 px-3 py-2">
      <button
        type="button"
        onClick={onOpenLoad}
        className="inline-flex h-6 items-center gap-1 rounded-sm border border-border bg-card px-2 text-bf-xs font-medium text-foreground transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background"
        aria-label="Load"
        title="Load"
        aria-haspopup="menu"
        aria-expanded={loadOpen}
      >
        <span aria-hidden>+</span>
        <span>Load</span>
      </button>
      <button
        type="button"
        onClick={() => onSelectMode(annotateActive ? 'inspector' : 'annotate')}
        aria-pressed={annotateActive}
        className={`inline-flex h-6 items-center rounded-sm border px-2 text-bf-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background ${
          annotateActive
            ? 'border-border bg-bf-bg-active text-foreground shadow-[inset_0_-2px_0_var(--bf-text-muted)]'
            : 'border-border bg-card text-foreground hover:bg-accent hover:text-accent-foreground'
        }`}
        title="Toggle annotate mode"
      >
        Annotate
      </button>

      <LoadSheet
        open={loadOpen}
        onClose={onCloseLoad}
        onLoadVolume={openFile}
        onLoadSurface={openFile}
        onLoadAtlas={() => setDialog('atlas')}
        onProjectVolumeToSurface={() => setDialog('projection')}
      />
      {dialog === 'atlas' && <AtlasPicker onClose={() => setDialog(null)} />}
      {dialog === 'projection' && <ProjectionPicker onClose={() => setDialog(null)} />}
    </header>
  );
}

function InspectorBody() {
  const { mode } = useDisplayMode();

  switch (mode) {
    case 'set-studio':
      return <StudioInspectorPanel />;
    case 'bids':
      return <BidsInspector />;
    case 'analysis':
      return <AnalysisInspector />;
    case 'orthogonal':
    case 'integrated':
    case 'mosaic':
    case 'compare':
    case 'surface':
      return <ImagingInspector />;
    case 'unknown':
    default:
      return (
        <div className="px-3 py-6 text-center text-bf-sm text-muted-foreground">
          No active workspace.
        </div>
      );
  }
}

function AnnotateBody() {
  return (
    <div className="px-3 py-6 text-center text-bf-sm text-muted-foreground">
      Annotate mode is not yet enabled in this Inspector shell.
    </div>
  );
}

function InspectorFooter() {
  const totalCount = useSceneStack().totalCount;
  const activeId = useInspectorSelectionStore((state) => state.activeItemId);

  return (
    <footer className="flex items-center justify-between border-t border-border bg-card/40 px-3 py-1.5 text-bf-xs text-muted-foreground">
      <span
        className="tabular-nums"
        style={{ fontVariantNumeric: 'tabular-nums' }}
      >
        {totalCount} scene item{totalCount === 1 ? '' : 's'}
      </span>
      <span
        className={
          activeId
            ? 'tabular-nums text-primary'
            : 'tabular-nums text-muted-foreground'
        }
        style={{ fontVariantNumeric: 'tabular-nums' }}
      >
        {activeId ? '1 selected' : 'none selected'}
      </span>
    </footer>
  );
}
