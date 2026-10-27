/**
 * PlotHost — Phase 4a of the integrated workspace refactor.
 *
 * Generic host shell for the bottom workbench Plot pane. The host owns:
 *   - the plot-mode selector (segmented pills for ≤4 modes, dropdown otherwise);
 *   - the toolbar slot (mode-contributed actions on the right);
 *   - sizing via ResizeObserver, passed to mode contexts;
 *   - the loading / error / empty-state machine (no-layer, unsupported-layer,
 *     no-crosshair, no-modes);
 *   - the framing chrome (header, body region, theme tokens).
 *
 * The host owns NOTHING specific to histograms, time series, or any other
 * concrete plot kind. Concrete plots are registered as `PlotMode` objects
 * (see `./plotHost.types.ts`) and supplied via `props.modes`. This boundary
 * is the contract Phase 4b (HistogramPlot) and Phase 4c
 * (CrosshairTimeSeriesPlot) plug into.
 */

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';

import { EmptyPane, SegmentedControl, Select } from '@/components/ui/bf';

import type { PlotHostProps, PlotMode, PlotModeContext, PlotModeSupport } from './plotHost.types';

const HOST_HEADER_HEIGHT = 28;

interface ResolvedMode {
  mode: PlotMode | undefined;
  support: PlotModeSupport | undefined;
}

function resolveMode(
  modes: readonly PlotMode[],
  modeId: string,
  ctx: PlotModeContext,
): ResolvedMode {
  const mode = modes.find((m) => m.id === modeId);
  if (!mode) return { mode: undefined, support: undefined };
  return { mode, support: mode.supports(ctx) };
}

interface EmptyStateProps {
  title: string;
  detail?: string;
  testid: string;
}

/**
 * The empty dock (P3.11): the plot frame with empty axes and one line, not
 * a second "No volume" message (the panes already say that).
 */
function EmptyAxes({ testid }: { testid: string }) {
  return (
    <div data-testid={testid} style={{ position: 'absolute', inset: 0 }}>
      <EmptyPane
        title="Load a volume to see its histogram"
        hint="The selected layer's histogram appears here."
        backdrop={
          // Axes: the loaded histogram's frame (same margins), empty.
          <div
            className="absolute border-b border-l border-bf-border"
            style={{ left: 12, right: 12, top: 28, bottom: 22 }}
          />
        }
      />
    </div>
  );
}

function EmptyState({ title, detail, testid }: EmptyStateProps) {
  return (
    <div
      data-testid={testid}
      style={{
        position: 'absolute',
        inset: 0,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: '4px',
        color: 'var(--bf-text-muted)',
        textAlign: 'center',
        padding: '12px',
        userSelect: 'none',
      }}
    >
      <span className="text-bf-sm font-medium" style={{ color: 'var(--bf-text-secondary)' }}>
        {title}
      </span>
      {detail ? (
        <span className="text-bf-xs" style={{ color: 'var(--bf-text-muted)', maxWidth: '36ch' }}>
          {detail}
        </span>
      ) : null}
    </div>
  );
}

interface ModeSelectorProps {
  modes: readonly PlotMode[];
  activeId: string;
  onChange: (id: string) => void;
}

/**
 * Plot modes: a bf Select (one form for any number of modes, round 3 S4). A
 * single mode still shows its name, so the pane says which plot it holds.
 */
/** The empty dock keeps the loaded chrome: the Histogram tab, disabled. */
const EMPTY_MODE_OPTIONS = [{ value: 'histogram', label: 'Histogram' }] as const;

function ModeSelector({ modes, activeId, onChange }: ModeSelectorProps) {
  const options = useMemo(() => modes.map((m) => ({ value: m.id, label: m.label })), [modes]);
  // Nothing to plot yet: the same chrome as a loaded dock, the default mode
  // named but inert (P3.11).
  if (modes.length === 0) {
    return (
      <SegmentedControl
        aria-label="Plot mode"
        data-testid="plot-host-mode-empty"
        options={EMPTY_MODE_OPTIONS}
        value="histogram"
        onValueChange={() => undefined}
        disabled
        hideWhenSingle={false}
      />
    );
  }

  // One mode: its name as plain text (the pane says which plot it holds).
  if (modes.length === 1) {
    return (
      <SegmentedControl
        aria-label="Plot mode"
        data-testid="plot-host-mode-tabs"
        options={options}
        value={activeId}
        onValueChange={onChange}
        singleLabel
      />
    );
  }

  // One form whatever the number of modes (round 3 S4: tabs with two modes
  // and a dropdown with five read as two different controls).
  return (
    <Select
      aria-label="Plot mode"
      data-testid="plot-host-mode-select"
      className="w-auto"
      value={activeId}
      options={options}
      onValueChange={onChange}
    />
  );
}

export function PlotHost({
  modes,
  modeId,
  defaultModeId,
  onModeChange,
  layerId,
  layerName,
  crosshairMm,
  atlasLayerId,
  hasCohort,
  hasPopulation,
  loading = false,
  error = null,
  className,
}: PlotHostProps) {
  const bodyRef = useRef<HTMLDivElement>(null);
  const [bodySize, setBodySize] = useState<{ width: number; height: number }>({
    width: 0,
    height: 0,
  });
  const [internalModeId, setInternalModeId] = useState<string>(
    () => defaultModeId ?? modes[0]?.id ?? '',
  );

  const isControlled = modeId !== undefined;
  const activeId = isControlled ? modeId : internalModeId;

  // Keep the internal selection valid when the registered mode set changes.
  useEffect(() => {
    if (isControlled) return;
    if (modes.length === 0) {
      if (internalModeId !== '') setInternalModeId('');
      return;
    }
    if (!modes.some((m) => m.id === internalModeId)) {
      setInternalModeId(modes[0].id);
    }
  }, [modes, internalModeId, isControlled]);

  const handleModeChange = useCallback(
    (next: string) => {
      if (!isControlled) setInternalModeId(next);
      onModeChange?.(next);
    },
    [isControlled, onModeChange],
  );

  // Track body size for plot modes that need explicit width/height.
  useEffect(() => {
    const el = bodyRef.current;
    if (!el) return;
    const update = () => {
      const rect = el.getBoundingClientRect();
      setBodySize((prev) => {
        const w = Math.max(0, rect.width);
        const h = Math.max(0, rect.height);
        if (prev.width === w && prev.height === h) return prev;
        return { width: w, height: h };
      });
    };
    update();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const ctx: PlotModeContext = useMemo(
    () => ({
      layerId,
      layerName,
      crosshairMm,
      atlasLayerId,
      hasCohort,
      hasPopulation,
      width: bodySize.width,
      height: bodySize.height,
    }),
    [layerId, layerName, crosshairMm, atlasLayerId, hasCohort, hasPopulation, bodySize.width, bodySize.height],
  );

  const { mode, support } = useMemo(
    () => resolveMode(modes, activeId, ctx),
    [modes, activeId, ctx],
  );

  let body: ReactNode = null;
  let bodyState = 'unresolved';
  if (modes.length === 0) {
    bodyState = 'no-modes';
    body = <EmptyAxes testid="plot-host-empty-no-modes" />;
  } else if (loading) {
    bodyState = 'loading';
    body = <EmptyState title="Loading…" testid="plot-host-loading" />;
  } else if (error) {
    bodyState = 'error';
    body = <EmptyState title="Plot error" detail={error.message} testid="plot-host-error" />;
  } else if (!mode) {
    // The requested mode is not among the modes on offer. PlotPanel passes
    // only modes whose `supports()` currently passes, so the auto default
    // ("histogram") is absent until a layer is selected. Treat this as an
    // ordinary empty state; never surface a registry id to the user.
    bodyState = 'no-mode';
    body = layerId ? (
      <EmptyState
        title="Plot not available"
        detail="This plot does not apply to the selected layer. Choose another plot above."
        testid="plot-host-empty-no-mode"
      />
    ) : (
      <EmptyAxes testid="plot-host-empty-no-mode" />
    );
  } else if (support && support.supported === false) {
    bodyState = support.reason;
    if (support.reason === 'no-layer') {
      body = (
        <EmptyState
          title="No layer selected"
          detail={support.message ?? 'Select a layer to plot.'}
          testid="plot-host-empty-no-layer"
        />
      );
    } else if (support.reason === 'unsupported-layer') {
      body = (
        <EmptyState
          title="Unsupported layer"
          detail={support.message ?? `${mode.label} cannot render this layer.`}
          testid="plot-host-empty-unsupported-layer"
        />
      );
    } else {
      body = (
        <EmptyState
          title="No crosshair"
          detail={support.message ?? 'Place the crosshair in the volume to plot here.'}
          testid="plot-host-empty-no-crosshair"
        />
      );
    }
  }

  const toolbarContent = mode?.toolbar?.(ctx);
  // A mode that lays out its own toolbar takes the host chrome inline.
  const inline = bodyState === 'unresolved' && !!mode?.inlineChrome;
  if (bodyState === 'unresolved' && mode) {
    bodyState = 'active';
    body = mode.render(
      inline
        ? {
            ...ctx,
            chrome: (
              <>
                <ModeSelector modes={modes} activeId={activeId} onChange={handleModeChange} />
                {toolbarContent}
              </>
            ),
          }
        : ctx,
    );
  }

  return (
    <div
      className={className ? `bf-plot-host ${className}` : 'bf-plot-host'}
      data-testid="plot-host"
      data-mode={activeId || ''}
      data-state={bodyState}
      style={{
        position: 'relative',
        height: '100%',
        width: '100%',
        display: 'flex',
        flexDirection: 'column',
        background: 'var(--bf-bg-panel)',
        color: 'var(--bf-text-primary)',
        overflow: 'hidden',
      }}
    >
      {inline ? null : (
      <div
        data-testid="plot-host-toolbar"
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '8px',
          padding: '0 8px',
          height: `${HOST_HEADER_HEIGHT}px`,
          minHeight: `${HOST_HEADER_HEIGHT}px`,
          borderBottom: '1px solid var(--bf-border-subtle)',
          flex: '0 0 auto',
        }}
      >
        <ModeSelector modes={modes} activeId={activeId} onChange={handleModeChange} />
        <div
          data-testid="plot-host-toolbar-slot"
          style={{ display: 'flex', alignItems: 'center', gap: '6px' }}
        >
          {toolbarContent}
        </div>
      </div>
      )}
      <div
        ref={bodyRef}
        data-testid="plot-host-body"
        style={{
          position: 'relative',
          flex: '1 1 auto',
          minHeight: 0,
          overflow: 'hidden',
          // The drawing area sits one step below the panel ground.
          background: 'var(--bf-bg-app)',
        }}
      >
        {body}
      </div>
    </div>
  );
}

export default PlotHost;
