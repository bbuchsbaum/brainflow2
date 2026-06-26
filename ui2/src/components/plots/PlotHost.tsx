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
        gap: '6px',
        color: 'var(--app-text-muted)',
        textAlign: 'center',
        padding: '12px',
        userSelect: 'none',
      }}
    >
      <span
        className="bf-role-section"
        style={{
          color: 'var(--app-text-muted)',
          letterSpacing: 'var(--app-role-section-tracking)',
          textTransform: 'uppercase',
        }}
      >
        {title}
      </span>
      {detail ? (
        <span
          className="bf-role-body"
          style={{ color: 'var(--app-text-disabled)', maxWidth: '32ch' }}
        >
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
        value={activeId}
        onChange={(e) => onChange(e.target.value)}
        style={{
          appearance: 'none',
          WebkitAppearance: 'none',
          MozAppearance: 'none',
          height: '20px',
          padding: '0 18px 0 6px',
          background: 'transparent',
          backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='8' height='6'%3E%3Cpath d='M1 1l3 3 3-3' fill='none' stroke='%238a93a3' stroke-width='1.4' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E")`,
          backgroundRepeat: 'no-repeat',
          backgroundPosition: 'right 6px center',
          color: 'var(--app-text-primary)',
          border: '1px solid var(--app-border)',
          borderRadius: 'var(--app-radius-sm)',
          fontSize: 'var(--app-role-section-size)',
          cursor: 'pointer',
          outline: 'none',
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
      style={{ display: 'inline-flex', gap: '2px' }}
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
            className="bf-role-section"
            style={{
              appearance: 'none',
              padding: '2px 8px',
              height: '20px',
              border: '1px solid var(--app-border)',
              borderColor: active ? 'var(--app-border-active)' : 'var(--app-border)',
              background: active ? 'var(--app-bg-active)' : 'transparent',
              color: active ? 'var(--app-text-primary)' : 'var(--app-text-muted)',
              cursor: 'pointer',
              borderRadius: 'var(--app-radius-sm)',
              fontSize: 'var(--app-role-section-size)',
              letterSpacing: 'var(--app-role-section-tracking)',
              textTransform: 'uppercase',
            }}
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
        title="No plot modes"
        detail="Register a plot mode to display data here."
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
    bodyState = 'no-mode';
    body = (
      <EmptyState
        title="Unknown plot mode"
        detail={`No registered mode with id "${activeId}".`}
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
        background: 'var(--app-surface-panel-raised)',
        color: 'var(--app-text-primary)',
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
          borderBottom: '1px solid var(--app-border-subtle)',
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
        }}
      >
        {body}
      </div>
    </div>
  );
}

export default PlotHost;
