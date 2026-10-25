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

import type { PlotHostProps, PlotMode, PlotModeContext, PlotModeSupport } from './plotHost.types';

const HOST_HEADER_HEIGHT = 28;

/** Keyboard focus ring shared by the host's interactive controls. */
/** Keyboard focus: a 2px ring in the focus token with a 1px offset. */
export const PLOT_FOCUS_RING =
  'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring';

/**
 * Joined segmented group (V5 navigation kind 2): one bordered group with 1px
 * internal dividers. Active = raised neutral fill + 2px inset neutral bottom
 * edge (amber is reserved for the top-bar switcher and the focused stack's
 * tab); inactive = muted text; hover = the neutral accent fill. Focus is a
 * separate 2px ring with a 1px offset, lifted above its neighbours.
 */
const MODE_GROUP =
  'inline-flex h-5 items-stretch rounded-sm border border-bf-border';
const MODE_CHIP_BASE =
  'relative px-2 text-bf-xs transition-colors border-r border-bf-border-subtle last:border-r-0 focus-visible:z-10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background';
const MODE_CHIP_ACTIVE =
  'bg-bf-bg-active font-medium text-foreground shadow-[inset_0_-2px_0_var(--bf-text-muted)]';
const MODE_CHIP_INACTIVE =
  'bg-transparent text-muted-foreground hover:bg-accent hover:text-foreground';

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

function ModeSelector({ modes, activeId, onChange }: ModeSelectorProps) {
  if (modes.length === 0) return null;

  if (modes.length > 4) {
    return (
      <select
        aria-label="Plot mode"
        data-testid="plot-host-mode-select"
        className={`bf-select ${PLOT_FOCUS_RING}`}
        value={activeId}
        onChange={(e) => onChange(e.target.value)}
        style={{
          height: '20px',
          fontSize: 'var(--app-role-section-size)',
        }}
      >
        {modes.map((m) => (
          <option key={m.id} value={m.id}>
            {m.label}
          </option>
        ))}
      </select>
    );
  }

  return (
    <div
      role="tablist"
      aria-label="Plot mode"
      data-testid="plot-host-mode-tabs"
      className={MODE_GROUP}
    >
      {modes.map((m) => {
        const active = m.id === activeId;
        return (
          <button
            key={m.id}
            type="button"
            role="tab"
            aria-selected={active}
            data-testid={`plot-host-mode-${m.id}`}
            data-active={active ? 'true' : 'false'}
            onClick={() => onChange(m.id)}
            className={`${MODE_CHIP_BASE} ${active ? MODE_CHIP_ACTIVE : MODE_CHIP_INACTIVE}`}
            style={{ appearance: 'none', cursor: 'pointer' }}
          >
            {m.label}
          </button>
        );
      })}
    </div>
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
      width: bodySize.width,
      height: bodySize.height,
    }),
    [layerId, layerName, crosshairMm, atlasLayerId, hasCohort, bodySize.width, bodySize.height],
  );

  const { mode, support } = useMemo(
    () => resolveMode(modes, activeId, ctx),
    [modes, activeId, ctx],
  );

  let body: ReactNode;
  let bodyState: string;
  if (modes.length === 0) {
    bodyState = 'no-modes';
    body = (
      <EmptyState
        title="No plot yet"
        detail="Load a volume to see its histogram."
        testid="plot-host-empty-no-modes"
      />
    );
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
      <EmptyState
        title="No plot yet"
        detail="Load a volume to see its histogram."
        testid="plot-host-empty-no-mode"
      />
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
  } else {
    bodyState = 'active';
    body = mode.render(ctx);
  }

  const toolbarContent = mode?.toolbar?.(ctx);

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
