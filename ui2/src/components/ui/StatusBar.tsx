/**
 * StatusBar Component
 * Optimized component that renders individual status bar slots
 * Uses StatusBarSlot for performance - only affected slots re-render
 */

import React from "react";
import { useStatusBarStore } from "@/stores/statusBarStore";
import { useLayerStore } from "@/stores/layerStore";
import { useCrosshairSettingsStore } from "@/stores/crosshairSettingsStore";
import { Popover, PopoverContent, PopoverTrigger } from "./shadcn/popover";
import { StatusBarProgress } from "./StatusBarProgress";
import { NotificationToast } from "./NotificationToast";
import { TimeSlider } from "./TimeSlider";
import { useViewStateStore } from "@/stores/viewStateStore";
import {
  resolveActiveLayer,
  useActiveLayerSelection,
  type ActiveLayerSelection,
} from "@/utils/activeLayer";
import { useStatusReadoutStore } from "@/stores/statusReadoutStore";
import { EMPTY_VALUE, formatLayerValue } from "@/utils/valueFormat";
import { asciiCopyHandler } from "@/utils/numericInput";
import { useLayerValueAtWorld } from "@/hooks/useLayerValueAtWorld";
import { Button, KeyValue } from "@/components/ui/bf";
import { statisticSignAssumed, statisticUnits } from "@/utils/statistic";
import { hasRegionSource } from "@/services/atlasRegionLookup";
import { useActiveRenderContextStore } from "@/stores/activeRenderContextStore";
import { useSurfaceStore } from "@/stores/surfaceStore";
import { parseSurfaceViewContextId } from "@/utils/surfaceViewContext";
import { surfaceColorbarLayer } from "@/components/views/surfaceFrame/surfaceColorbar";
import { overlayMapName } from "@/utils/hemisphereOverlays";
import { useSurfaceNearestVertex, useSurfaceValueAtCrosshair } from "@/hooks/useSurfaceValueAtCrosshair";
import { transformWorldToVoxelColumnMajor } from "@/utils/voxelTransform";
import { useMouseCoordinateStore } from "@/stores/mouseCoordinateStore";
import { formatWorldMm } from "@/utils/valueFormat";
import { StatSymbol } from "./StatSymbol";
import {
  formatVoxelIndex,
  resolveVoxelGridReference,
  voxelIndexInBounds,
  worldToVoxelIndex,
} from "@/utils/voxelSnap";

interface StatusBarProps {
  className?: string;
  /** Which slots to show inline. Telemetry (atlas/FPS/GPU) is always in the
   *  Diagnostics popover, never inline. */
  slots?: string[];
  /** Additional right-side content */
  rightContent?: React.ReactNode;
  /** Called when the crosshair slot is clicked */
  onCrosshairClick?: () => void;
}

// Slot labels and width budgets. Widths are `[basis, min]`: the readouts that
// must stay legible (coordinates) are fixed; free-text slots (layer, region)
// shrink to their minimum and truncate with an ellipsis + title, so nothing
// clips at 1280px.
const LABELS: Record<string, string> = {
  coordSys: "Coordinate system",
  crosshair: "Crosshair",
  voxel: "ijk",
  mouse: "Mouse",
  layer: "Layer",
  value: "Value",
  region: "Region",
  vertex: "Vertex",
  atlas: "Atlas",
  fps: "FPS",
  gpu: "GPU",
};

/**
 * Every readout is content-sized and never truncates (v3 critics: a fixed
 * Value width cut "t(24) …" and the Mouse ijk). Only the free-text Layer
 * name gives way under pressure (min 8ch, then ellipsis); the Region keeps
 * its content width up to a cap.
 */
const WIDTHS: Record<string, [string, string]> = {
  layer: ["auto", "8ch"],
};

/** Content-sized slots stop growing here (a long file name). */
const MAX_WIDTHS: Record<string, string> = { layer: "40ch", region: "32ch", vertex: "44ch" };

/** Only the layer name shrinks. */
const SHRINK: Record<string, number> = { layer: 1 };

/** Below this bar width an empty ("No time axis") time slot is hidden. */
const HIDE_EMPTY_TIME_BELOW_PX = 1440;

/** Developer telemetry lives behind the Diagnostics button, not in the bar. */
export const DIAGNOSTIC_SLOT_IDS = ["atlas", "fps", "gpu"] as const;

const VALUE_CLASS: Record<string, string> = {
  coordSys: "status-value--coordinate-system",
  crosshair: "status-value--crosshair",
  mouse: "status-value--mouse",
  voxel: "status-value--ijk",
  fps: "status-value--fps",
  gpu: "status-value--gpu",
};

interface SlotFrameProps {
  id: string;
  value: React.ReactNode;
  title?: string;
  onClick?: () => void;
  valueStyle?: React.CSSProperties;
  /** Extra class on the value (e.g. the warning state of a fractional ijk). */
  valueClassName?: string;
}

const SlotFrame = ({ id, value, title, onClick, valueStyle, valueClassName }: SlotFrameProps) => {
  const [basis, min] = WIDTHS[id] ?? ["auto", "auto"];
  const isClickable = !!onClick;
  return (
    <div
      className={`status-slot${isClickable ? " cursor-pointer hover:text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring" : ""}`}
      style={{
        width: basis === "auto" ? undefined : basis,
        minWidth: min === "auto" ? undefined : min,
        maxWidth: MAX_WIDTHS[id],
        flex: `0 ${SHRINK[id] ?? 0} ${basis}`,
      }}
      data-slot={id}
      onClick={onClick}
      role={isClickable ? "button" : undefined}
      tabIndex={isClickable ? 0 : undefined}
      onKeyDown={
        isClickable
          ? (event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                onClick?.();
              }
            }
          : undefined
      }
      title={isClickable ? "Click to navigate to coordinate" : undefined}
    >
      <span className="status-label">{LABELS[id] || id}</span>
      <span
        className={`status-value ${VALUE_CLASS[id] ?? ""}${valueClassName ? ` ${valueClassName}` : ""}${isClickable ? " hover:underline" : ""}`}
        style={valueStyle}
        title={title}
      >
        {value}
      </span>
    </div>
  );
};

// Individual slot component that subscribes to Zustand store
const StatusBarSlot = React.memo(
  ({ id, onClick }: { id: string; onClick?: () => void }) => {
    const value = useStatusBarStore((state) => state.values[id]);
    // The crosshair readout wears the crosshair's own colour (user-selectable),
    // never the chrome accent.
    const crosshairColor = useCrosshairSettingsStore((state) =>
      id === "crosshair" ? state.settings.activeColor : undefined,
    );

    if (value === undefined || value === null) return null;

    return (
      <SlotFrame
        id={id}
        value={typeof value === "string" ? displayStatusText(value) : value}
        title={typeof value === "string" ? displayStatusText(value) : undefined}
        onClick={onClick}
        valueStyle={
          crosshairColor
            ? ({
                "--status-crosshair-color": crosshairColor,
              } as React.CSSProperties)
            : undefined
        }
      />
    );
  },
);

StatusBarSlot.displayName = "StatusBarSlot";

/**
 * Producers write the legacy "--" placeholder; the bar shows the one empty
 * glyph every readout uses ("—", as in Value).
 */
export function displayStatusText(value: string): string {
  return value.trim() === "--" ? EMPTY_VALUE : value;
}

/**
 * The status bar's layer: the single active-layer rule (`resolveActiveLayer`,
 * shared with the viewport header and the colorbar), unless a Compare panel
 * has claimed the readout (pointer over it, or last focused): then that
 * panel's layer, so the status bar and the pane never disagree.
 */
export function resolveStatusLayer<T extends { id: string; name?: string; visible: boolean }>(
  viewLayers: ReadonlyArray<T>,
  selection: ActiveLayerSelection,
  override: { layerId: string; name: string } | null,
): { id: string; name: string } | null {
  if (override) return { id: override.layerId, name: override.name };
  const layer = resolveActiveLayer(viewLayers, selection);
  return layer ? { id: layer.id, name: layer.name || layer.id } : null;
}

function useStatusLayer(): { id: string; name: string } | null {
  const viewLayers = useViewStateStore((state) => state.viewState.layers);
  const selection = useActiveLayerSelection();
  const override = useStatusReadoutStore((state) => state.override);
  return React.useMemo(
    () => resolveStatusLayer(viewLayers, selection, override),
    [viewLayers, selection, override],
  );
}

/** "Layer" slot: the active layer (see `resolveStatusLayer`). */
const StatusLayerSlot = React.memo(() => {
  const fallback = useStatusBarStore((state) => state.values.layer);
  const layer = useStatusLayer();
  const name =
    layer?.name ??
    (typeof fallback === "string" ? fallback : fallback == null ? null : String(fallback));
  if (name === null) return null;
  return <SlotFrame id="layer" value={name} title={name} />;
});

StatusLayerSlot.displayName = "StatusLayerSlot";

/**
 * "Value" slot: the Layer slot's layer sampled at the crosshair (nearest
 * voxel, existing `sample_layer_value_at_world`), formatted like the
 * Inspector and colorbar numbers. "—" outside the volume or when not finite.
 */
const StatusValueSlot = React.memo(() => {
  const crosshair = useViewStateStore((state) => state.viewState.crosshair.world_mm);
  const layer = useStatusLayer();
  const layerId = layer?.id ?? null;
  const reading = useLayerValueAtWorld(layerId, crosshair);
  const statistic = useLayerStore((state) =>
    layerId ? state.layers.find((l) => l.id === layerId)?.statistic : undefined,
  );
  const dataRange = useLayerStore((state) =>
    layerId ? state.layerMetadata.get(layerId)?.dataRange : undefined,
  );
  if (!layerId || !layer) return null;
  // Statistic maps read "z 5.97" / "t(24) 6.76": the symbol (italic
  // variable, muted) before the number, so numbers stay in one column.
  const units = statisticUnits(statistic, dataRange);
  const number =
    reading && reading.value !== null ? formatLayerValue(reading.value) : EMPTY_VALUE;
  const value = units ? (
    <>
      <StatSymbol label={units} className="status-value__symbol" /> {number}
    </>
  ) : (
    number
  );
  const title = `Nearest-voxel value of ${layer.name}${units ? ` (${units}${statisticSignAssumed(statistic, dataRange) ? ", sign convention assumed" : ""})` : ""}`;
  return <SlotFrame id="value" value={value} title={title} />;
});

StatusValueSlot.displayName = "StatusValueSlot";

/**
 * "ijk" slot: the crosshair's nearest voxel index (`floor(v + 0.5)`, the
 * backend's nearest-voxel rule) on the voxel-grid reference layer, the same
 * grid snapping and the Go-to dialog use (utils/voxelSnap.ts). "—" without
 * a volume or outside the grid.
 */
const StatusVoxelSlot = React.memo(() => {
  const crosshair = useViewStateStore((state) => state.viewState.crosshair.world_mm);
  const snapToVoxel = useCrosshairSettingsStore((state) => state.settings.snapToVoxel);
  const layers = useLayerStore((state) => state.layers);
  const layerMetadata = useLayerStore((state) => state.layerMetadata);
  const reference = React.useMemo(
    () => resolveVoxelGridReference(layers, layerMetadata),
    [layers, layerMetadata],
  );
  const selectedLayerId = useLayerStore((state) => state.selectedLayerId);
  if (!reference) return null;
  // The active layer on another grid (a 4 mm BOLD over the 2 mm T1): say whose
  // grid the index is on (round 3 C9).
  const active = selectedLayerId ? layerMetadata.get(selectedLayerId) : undefined;
  const otherGrid =
    !!active?.voxelToWorld &&
    selectedLayerId !== reference.layerId &&
    (JSON.stringify(active.dimensions ?? null) !== JSON.stringify(reference.dims) ||
      active.voxelToWorld.some((v, i) => Math.abs(v - reference.voxelToWorld[i]) > 1e-4));
  const spacing = [0, 1, 2].map((c) => Math.hypot(reference.voxelToWorld[c * 4], reference.voxelToWorld[c * 4 + 1], reference.voxelToWorld[c * 4 + 2]));
  const gridLabel = otherGrid
    ? ` · ref ${spacing.every((v) => Math.abs(v - spacing[0]) < 1e-3) ? `${Number(spacing[0].toFixed(2))} mm` : reference.name}`
    : "";
  const world: [number, number, number] = [crosshair[0], crosshair[1], crosshair[2]];
  const index = worldToVoxelIndex(world, reference);
  const inside = index.every(Number.isFinite) && voxelIndexInBounds(index, reference.dims);
  // Snapped (or exactly on a centre): integers, which are themselves the
  // snapping indicator. Off and between centres: one decimal in the warning
  // token.
  const continuous = transformWorldToVoxelColumnMajor(reference.worldToVoxel, world);
  const between = continuous.some((v, axis) => Math.abs(v - index[axis]) > 1e-3);
  const fractional = !snapToVoxel && between;
  const text = !inside
    ? EMPTY_VALUE
    : (fractional ? formatVoxelIndex(continuous, 1) : formatVoxelIndex(index)) + gridLabel;
  return (
    <SlotFrame
      id="voxel"
      value={text}
      valueClassName={inside && fractional ? "status-value--warning" : undefined}
      title={
        fractional
          ? `Voxel coordinate (i j k) of ${reference.name}, the reference grid: between voxel centres (snapping off)`
          : `Voxel index (i j k) of ${reference.name}, the reference grid`
      }
    />
  );
});

StatusVoxelSlot.displayName = "StatusVoxelSlot";

/**
 * "Mouse" slot (P3.6): the pointer's position while it is over a slice, mm
 * then the voxel index on the reference grid ("(−37.5, −17.5, 50.5) 29 57
 * 64"), compact. Per-layer values live in the Inspector Scene rows.
 */
const StatusMouseSlot = React.memo(() => {
  const pointer = useMouseCoordinateStore((state) => state.worldCoordinates);
  const layers = useLayerStore((state) => state.layers);
  const layerMetadata = useLayerStore((state) => state.layerMetadata);
  const reference = React.useMemo(
    () => resolveVoxelGridReference(layers, layerMetadata),
    [layers, layerMetadata],
  );
  if (!pointer) return <SlotFrame id="mouse" value={EMPTY_VALUE} />;
  const mm = `(${pointer.map((v) => formatWorldMm(v)).join(", ")})`;
  const index = reference ? worldToVoxelIndex([pointer[0], pointer[1], pointer[2]], reference) : null;
  const ijk = index && voxelIndexInBounds(index, reference?.dims) ? formatVoxelIndex(index) : null;
  return (
    <SlotFrame
      id="mouse"
      value={
        <>
          {mm}
          {ijk ? <span className="status-value__ijk"> {ijk}</span> : null}
        </>
      }
      title={`Pointer${ijk && reference ? `, voxel (i j k) of ${reference.name}` : ""}`}
    />
  );
});

StatusMouseSlot.displayName = "StatusMouseSlot";

/**
 * "Region" slot: the atlas/label region at the crosshair (StatusBarService
 * writes the name and its LUT colour), with a small swatch in that colour.
 * Hidden while no atlas or label layer with a legend is loaded, instead of a
 * permanent "—".
 */
const StatusRegionSlot = React.memo(() => {
  const hasAtlas = useLayerStore((state) => hasRegionSource(state.layers));
  const value = useStatusBarStore((state) => state.values.region);
  const color = useStatusBarStore((state) => state.values.regionColor);
  if (!hasAtlas) return null;
  const text =
    typeof value === "string" ? displayStatusText(value) : value == null ? EMPTY_VALUE : value;
  const swatch = typeof color === "string" && typeof text === "string" && text !== EMPTY_VALUE;
  return (
    <SlotFrame
      id="region"
      title={typeof text === "string" ? text : undefined}
      value={
        swatch ? (
          <>
            <span
              aria-hidden
              data-testid="status-region-swatch"
              className="status-region-swatch"
              style={{ background: color as string }}
            />
            {text}
          </>
        ) : (
          text
        )
      }
    />
  );
});

StatusRegionSlot.displayName = "StatusRegionSlot";

/**
 * "Vertex" slot (phase 4, D1): while a surface pane is the active view, the
 * vertex nearest the crosshair and the shown overlay's value there, read on
 * the anatomical mesh (an inflated mesh alone has none: "—" says what to
 * load). Hidden for volume panes.
 */
const StatusVertexSlot = React.memo(() => {
  const activeId = useActiveRenderContextStore((state) => state.activeId);
  const context = parseSurfaceViewContextId(activeId);
  const surfaceId = useSurfaceStore((state) =>
    context
      ? ([...state.surfaces.keys()].find((handle) => handle.toLowerCase() === context.surfaceHandle) ?? null)
      : null,
  );
  const overlayId = useSurfaceStore((state) => {
    const surface = surfaceId ? state.surfaces.get(surfaceId) : undefined;
    return surface ? (surfaceColorbarLayer(surface)?.layerId ?? null) : null;
  });
  const overlayName = useSurfaceStore((state) => {
    const surface = surfaceId ? state.surfaces.get(surfaceId) : undefined;
    return surface ? (surfaceColorbarLayer(surface)?.name ?? null) : null;
  });
  if (!surfaceId) return null;
  return <StatusVertexReadout surfaceId={surfaceId} overlayId={overlayId} overlayName={overlayName} />;
});

StatusVertexSlot.displayName = "StatusVertexSlot";

function StatusVertexReadout({
  surfaceId,
  overlayId,
  overlayName,
}: {
  surfaceId: string;
  overlayId: string | null;
  overlayName: string | null;
}) {
  const { reading, anatomical } = useSurfaceValueAtCrosshair(surfaceId, overlayId ?? "");
  const nearest = useSurfaceNearestVertex(surfaceId);
  // The value is labelled with its overlay (v1 function 9): "32,116 · sensorimotor.func 59,391".
  const map = overlayName ? overlayMapName(overlayName) : null;
  const value = reading ? formatLayerValue(reading.value) : null;
  const title = !anatomical
    ? "Load the matching pial or white surface for an anatomical readout"
    : nearest
      ? `Vertex ${nearest.vertex}, ${nearest.distanceMm.toFixed(1)} mm from the crosshair` +
        (value !== null && overlayName ? `; ${overlayName} = ${value}` : "")
      : "No vertex within 3 mm of the crosshair";
  return (
    <SlotFrame
      id="vertex"
      title={title}
      value={
        anatomical && nearest ? (
          <span
            data-testid="status-vertex"
            aria-label={
              `Vertex ${nearest.vertex}` + (value !== null && map ? `, ${map} ${value}` : "")
            }
          >
            {nearest.vertex.toLocaleString("en-US")}
            {value !== null ? (
              <>
                {map ? <span className="status-value__symbol"> · {map}</span> : null}
                <span className="status-value__ijk"> {value}</span>
              </>
            ) : null}
          </span>
        ) : (
          <span data-testid="status-vertex">{EMPTY_VALUE}</span>
        )
      }
    />
  );
}

/**
 * Compact "Diagnostics" button: developer telemetry (atlas pressure, FPS, GPU)
 * in a popover so it never competes with the location readouts for width.
 * Radix Popover gives keyboard access, focus return and Escape-to-close. A
 * warning/critical atlas state adds a semantic status dot to the button so
 * pressure is still noticeable while the popover is closed.
 */
const DiagnosticsButton = () => {
  const atlas = useStatusBarStore((state) => state.values.atlas);
  const fps = useStatusBarStore((state) => state.values.fps);
  const gpu = useStatusBarStore((state) => state.values.gpu);
  const rows: Array<[string, string]> = [
    ["Atlas", atlas == null ? EMPTY_VALUE : displayStatusText(String(atlas))],
    ["FPS", fps == null ? EMPTY_VALUE : displayStatusText(String(fps))],
    ["GPU", gpu == null ? EMPTY_VALUE : displayStatusText(String(gpu))],
  ];
  const atlasText = atlas == null ? "" : String(atlas);
  const severity = /CRITICAL/.test(atlasText)
    ? "critical"
    : /Warning/.test(atlasText)
      ? "warning"
      : null;

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="status-diagnostics-trigger data-[state=open]:bg-accent data-[state=open]:text-foreground"
          aria-label={
            severity ? `Diagnostics (atlas ${severity})` : "Diagnostics"
          }
          data-testid="status-diagnostics-trigger"
          data-severity={severity ?? undefined}
        >
          {severity && (
            <span
              aria-hidden
              className={`status-diagnostics-dot status-diagnostics-dot--${severity}`}
            />
          )}
          Diagnostics
        </Button>
      </PopoverTrigger>
      <PopoverContent
        side="top"
        align="end"
        sideOffset={6}
        className="w-auto min-w-[16rem] max-w-[28rem] p-2 focus-visible:outline-none"
        aria-label="Diagnostics"
        data-testid="status-diagnostics-popover"
      >
        <KeyValue
          layout="rows"
          className="status-diagnostics-list"
          items={rows.map(([label, value]) => ({ key: label, label, value }))}
        />
      </PopoverContent>
    </Popover>
  );
};

export function StatusBar({
  className = "",
  slots = ["coordSys", "crosshair", "voxel", "mouse", "layer", "value", "region"],
  rightContent,
  onCrosshairClick,
}: StatusBarProps) {
  // Subscribe to layer changes to properly detect 4D volumes
  const layers = useLayerStore((state) => state.layers);
  const has4DVolume = React.useMemo(() => {
    try {
      return layers.some(
        (layer) =>
          layer.volumeType === "TimeSeries4D" &&
          layer.timeSeriesInfo &&
          layer.timeSeriesInfo.num_timepoints > 1,
      );
    } catch (error) {
      console.warn("Failed to detect 4D volume:", error);
      return false;
    }
  }, [layers]);

  // An empty time axis gives its room to the readouts on a narrow bar.
  const barRef = React.useRef<HTMLDivElement>(null);
  const [barWidth, setBarWidth] = React.useState<number | null>(null);
  React.useLayoutEffect(() => {
    const el = barRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const update = () => {
      const w = Math.round(el.getBoundingClientRect().width);
      setBarWidth((prev) => (prev === w ? prev : w));
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  const showTime =
    has4DVolume || barWidth === null || barWidth === 0 || barWidth >= HIDE_EMPTY_TIME_BELOW_PX;

  return (
    // Copying a readout puts ASCII minus on the clipboard.
    <div
      ref={barRef}
      className={`status-bar ${className}`}
      onCopy={asciiCopyHandler}
      role="contentinfo"
      aria-label="Status"
    >
      {slots
        .filter(
          (id) =>
            !(DIAGNOSTIC_SLOT_IDS as readonly string[]).includes(id),
        )
        .map((id) =>
          id === "layer" ? (
            <StatusLayerSlot key={id} />
          ) : id === "value" ? (
            <StatusValueSlot key={id} />
          ) : id === "voxel" ? (
            <StatusVoxelSlot key={id} />
          ) : id === "mouse" ? (
            <StatusMouseSlot key={id} />
          ) : id === "region" ? (
            <React.Fragment key={id}>
              <StatusRegionSlot />
              <StatusVertexSlot />
            </React.Fragment>
          ) : (
            <StatusBarSlot
              key={id}
              id={id}
              onClick={id === "crosshair" ? onCrosshairClick : undefined}
            />
          ),
        )}

      {/* Time slider: disabled without a 4D volume, and hidden then on a
          narrow bar (the readouts keep their room). */}
      {showTime ? <TimeSlider className="flex-1 max-w-sm" disabled={!has4DVolume} /> : null}

      {/* Messages ("Loaded …", errors) in the bar's free space: never over a panel. */}
      <NotificationToast />

      {/* Progress indicator */}
      <StatusBarProgress />

      <div className="status-bar__right">
        {rightContent}
        <DiagnosticsButton />
      </div>
    </div>
  );
}
