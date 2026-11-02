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
import { resolveStatusLayer } from "@/utils/activeLayer";
import { EMPTY_VALUE, formatReadoutValue } from "@/utils/valueFormat";
import { asciiCopyHandler } from "@/utils/numericInput";
import { isInsideVolume, useLayerValueAtWorld } from "@/hooks/useLayerValueAtWorld";
import { useHoverSettingsStore, selectShowInStatusBar } from "@/stores/hoverSettingsStore";
import { useIjkSuffix, useReadoutGrid, useStatusLayer } from "@/hooks/useReadoutGrid";
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
  formatIjkReadout,
  formatVoxelIndex,
  resolveLayerVoxelGrid,
  sameVoxel,
  voxelIndexInBounds,
  worldToVoxelIndex,
} from "@/utils/voxelSnap";

export { resolveStatusLayer };

interface StatusBarProps {
  className?: string;
  /** Which slots to show inline: "coordSys", "layer", and the two groups
   *  "crosshair" (mm, ijk, value, region) and "pointer" (mm, value, region).
   *  Telemetry (atlas/FPS/GPU) is always in the Diagnostics popover. */
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
  layer: "Layer",
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
  // The ijk grid name and the region names give way on a narrow bar.
  voxel: ["auto", "16ch"],
  region: ["auto", "6ch"],
  pointerRegion: ["auto", "6ch"],
  // Pointer value: a reserved width, so the bar does not jitter while a new
  // reading is pending (blank, never the previous voxel's value).
  pointerValue: ["auto", "6ch"],
};

/** Content-sized slots stop growing here (a long file name). */
const MAX_WIDTHS: Record<string, string> = {
  layer: "40ch",
  voxel: "40ch",
  region: "32ch",
  pointerRegion: "24ch",
  vertex: "44ch",
};

/** Free text shrinks: layer and grid names, regions. */
const SHRINK: Record<string, number> = { layer: 1, voxel: 1, region: 2, pointerRegion: 3 };

/** Below this bar width the constant coordinate-system slot is hidden. */
const HIDE_COORD_SYS_BELOW_PX = 1280;

/** Below this bar width an empty ("No time axis") time slot is hidden. */
const HIDE_EMPTY_TIME_BELOW_PX = 1440;

/** Developer telemetry lives behind the Diagnostics button, not in the bar. */
export const DIAGNOSTIC_SLOT_IDS = ["atlas", "fps", "gpu"] as const;

const VALUE_CLASS: Record<string, string> = {
  coordSys: "status-value--coordinate-system",
  crosshair: "status-value--crosshair",
  pointerValue: "status-value--pointer",
  mouse: "status-value--mouse",
  voxel: "status-value--ijk",
  fps: "status-value--fps",
  gpu: "status-value--gpu",
};

interface SlotFrameProps {
  id: string;
  /** Visible label; null inside a labelled group (the group names it). */
  label?: string | null;
  value: React.ReactNode;
  title?: string;
  onClick?: () => void;
  valueStyle?: React.CSSProperties;
  /** Extra class on the value (e.g. the warning state of a fractional ijk). */
  valueClassName?: string;
}

const SlotFrame = ({ id, label, value, title, onClick, valueStyle, valueClassName }: SlotFrameProps) => {
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
      {label === null ? null : <span className="status-label">{label ?? (LABELS[id] || id)}</span>}
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
  ({ id, label, onClick }: { id: string; label?: string | null; onClick?: () => void }) => {
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
        label={label}
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
 * The status layer's value at a world point (nearest voxel, existing
 * `sample_layer_value_at_world`), formatted like the Inspector and colorbar
 * numbers: "z 5.97" / "t(24) 6.76" for statistic maps. "—" outside the
 * volume or when not finite.
 *
 * `fresh` (Pointer): a reading is shown only while it belongs to the voxel
 * under `world`; a pending reading for a new voxel shows blank, never the
 * previous voxel's value.
 */
function StatusValueReadout({
  id,
  world,
  fresh = false,
  delayMs,
}: {
  id: string;
  world: readonly [number, number, number] | null;
  fresh?: boolean;
  delayMs?: number;
}) {
  const layer = useStatusLayer();
  const layerId = layer?.id ?? null;
  const reading = useLayerValueAtWorld(layerId, world, delayMs);
  const statistic = useLayerStore((state) =>
    layerId ? state.layers.find((l) => l.id === layerId)?.statistic : undefined,
  );
  const dataRange = useLayerStore((state) =>
    layerId ? state.layerMetadata.get(layerId)?.dataRange : undefined,
  );
  const timepoint = useLayerStore((state) =>
    layerId ? (state.layers.find((l) => l.id === layerId)?.currentTimepoint ?? 0) : 0,
  );
  const layers = useLayerStore((state) => state.layers);
  const layerMetadata = useLayerStore((state) => state.layerMetadata);
  const grid = React.useMemo(
    () => (fresh ? resolveLayerVoxelGrid(layerId, layers, layerMetadata) : null),
    [fresh, layerId, layers, layerMetadata],
  );
  if (!layerId || !layer) return null;
  if (!world) return <SlotFrame id={id} label={null} value={EMPTY_VALUE} />;
  // Fresh = taken in the voxel under `world` AND at the layer's current
  // timepoint (scrubbing time must not show the previous frame's value).
  const current =
    reading &&
    (!fresh ||
      (reading.world &&
        sameVoxel(reading.world, world, grid) &&
        (reading.timepoint ?? 0) === timepoint))
      ? reading
      : null;
  if (fresh && !current) {
    return <SlotFrame id={id} label={null} value="" title={`Reading ${layer.name}…`} />;
  }
  const units = statisticUnits(statistic, dataRange);
  const number =
    current && current.value !== null ? formatReadoutValue(current.value) : EMPTY_VALUE;
  const value = units ? (
    <>
      <StatSymbol label={units} className="status-value__symbol" /> {number}
    </>
  ) : (
    number
  );
  const title = `Nearest-voxel value of ${layer.name}${units ? ` (${units}${statisticSignAssumed(statistic, dataRange) ? ", sign convention assumed" : ""})` : ""}`;
  return <SlotFrame id={id} label={null} value={value} title={title} />;
}

/** Crosshair value of the status layer. */
const StatusValueSlot = React.memo(() => {
  const crosshair = useViewStateStore((state) => state.viewState.crosshair.world_mm);
  const world = React.useMemo(
    () => [crosshair[0], crosshair[1], crosshair[2]] as [number, number, number],
    [crosshair],
  );
  return <StatusValueReadout id="value" world={world} />;
});

StatusValueSlot.displayName = "StatusValueSlot";

/**
 * "ijk 23, 41, 30 (zstat1)": the crosshair's nearest voxel index
 * (`floor(v + 0.5)`, the backend's nearest-voxel rule) on the status layer's
 * own grid, named, so it agrees with that layer's cluster table and with the
 * voxel its Value is read from. Falls back to the reference grid (named)
 * when the layer has no affine. Outside the grid: "ijk — (zstat1)".
 */
const StatusVoxelSlot = React.memo(() => {
  const crosshair = useViewStateStore((state) => state.viewState.crosshair.world_mm);
  const snapToVoxel = useCrosshairSettingsStore((state) => state.settings.snapToVoxel);
  const grid = useReadoutGrid();
  const layer = useStatusLayer();
  const suffix = useIjkSuffix(grid);
  if (!grid) {
    // A reported layer without any grid (no affine anywhere): still named.
    return suffix ? (
      <SlotFrame
        id="voxel"
        label={null}
        value={formatIjkReadout(null, suffix)}
        title={`No voxel grid for ${layer?.name ?? suffix}`}
      />
    ) : null;
  }
  const world: [number, number, number] = [crosshair[0], crosshair[1], crosshair[2]];
  const index = worldToVoxelIndex(world, grid);
  const inside = index.every(Number.isFinite) && voxelIndexInBounds(index, grid.dims);
  // Snapping places the crosshair on reference-grid centres, so integers
  // there are themselves the snapping indicator; off and between centres the
  // reference index reads with one decimal in the warning token. Another
  // layer's grid is not snapped to: its index is the nearest voxel, the one
  // the Value is sampled from.
  const continuous = transformWorldToVoxelColumnMajor(grid.worldToVoxel, world);
  const between = continuous.some((v, axis) => Math.abs(v - index[axis]) > 1e-3);
  const fractional = grid.isReference && !snapToVoxel && between;
  const text = formatIjkReadout(
    !inside ? null : fractional ? formatVoxelIndex(continuous, 1) : formatVoxelIndex(index),
    suffix ?? grid.label,
  );
  return (
    <SlotFrame
      id="voxel"
      label={null}
      value={text}
      valueClassName={inside && fractional ? "status-value--warning" : undefined}
      title={
        fractional
          ? `Voxel coordinate (i, j, k) on the grid of ${grid.name}: between voxel centres (snapping off)`
          : `Nearest voxel (i, j, k) on the grid of ${grid.name}` +
            (layer && grid.layerId !== layer.id ? ` (${layer.name} has no voxel-to-world transform)` : "")
      }
    />
  );
});

StatusVoxelSlot.displayName = "StatusVoxelSlot";

/** Pointer position in mm while it is over a slice; "—" otherwise. */
const StatusMouseSlot = React.memo(() => {
  const pointer = useMouseCoordinateStore((state) => state.worldCoordinates);
  if (!pointer) return <SlotFrame id="mouse" label={null} value={EMPTY_VALUE} />;
  const mm = `(${pointer.map((v) => formatWorldMm(v)).join(", ")})`;
  return <SlotFrame id="mouse" label={null} value={mm} title="Pointer position (world mm)" />;
});

StatusMouseSlot.displayName = "StatusMouseSlot";

/**
 * Region slots: the atlas/label region at the crosshair ("region") or the
 * pointer ("pointerRegion"); StatusBarService writes the name and its LUT
 * colour, with a small swatch in that colour. Hidden while no atlas or label
 * layer with a legend is loaded, instead of a permanent "—". The pointer
 * region is blank while its lookup for a new voxel is pending.
 */
const StatusRegionSlot = React.memo(({ id = "region" }: { id?: "region" | "pointerRegion" }) => {
  const hasAtlas = useLayerStore((state) => hasRegionSource(state.layers));
  const value = useStatusBarStore((state) => state.values[id]);
  const color = useStatusBarStore((state) => state.values[`${id}Color`]);
  if (!hasAtlas) return null;
  const text =
    typeof value === "string"
      ? displayStatusText(value)
      : value == null
        ? id === "pointerRegion"
          ? ""
          : EMPTY_VALUE
        : value;
  const swatch =
    typeof color === "string" && typeof text === "string" && text !== EMPTY_VALUE && text !== "";
  return (
    <SlotFrame
      id={id}
      label={null}
      title={typeof text === "string" && text ? `Region: ${text}` : undefined}
      value={
        swatch ? (
          <>
            <span
              aria-hidden
              data-testid={id === "region" ? "status-region-swatch" : "status-pointer-region-swatch"}
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
 * Crosshair group: mm (click: Go to coordinate), ijk on the status layer's
 * grid, its value and region, plus the surface vertex in a surface pane.
 */
function CrosshairGroup({ onCrosshairClick }: { onCrosshairClick?: () => void }) {
  return (
    <div className="status-group" data-group="crosshair" role="group" aria-label="Crosshair">
      <span className="status-group__label">Crosshair</span>
      <StatusBarSlot id="crosshair" label={null} onClick={onCrosshairClick} />
      <StatusVoxelSlot />
      <StatusValueSlot />
      <StatusRegionSlot id="region" />
      <StatusVertexSlot />
    </div>
  );
}

/**
 * Pointer group: mm, the status layer's value and region under the pointer.
 * Greyed and blank when the pointer is not over an image; hidden by the
 * view menu's pointer-readout toggle (`hoverSettingsStore.showInStatusBar`).
 */
function PointerGroup() {
  const show = useHoverSettingsStore(selectShowInStatusBar);
  const pointer = useMouseCoordinateStore((state) => state.worldCoordinates);
  const layers = useLayerStore((state) => state.layers);
  const layerMetadata = useLayerStore((state) => state.layerMetadata);
  const world = React.useMemo(
    () => (pointer ? ([pointer[0], pointer[1], pointer[2]] as [number, number, number]) : null),
    [pointer],
  );
  if (!show) return null;
  // Over an image = over a slice and inside SOME loaded volume. Outside the
  // reported layer only (a partial-coverage stat map over anatomy), the group
  // stays live and the value alone reads "—" (the value hook's bounds test).
  const overImage =
    !!world &&
    layers.some((l) => {
      if (!l.volumeId) return false;
      const meta = layerMetadata.get(l.id);
      return !meta || isInsideVolume(world, meta);
    });
  return (
    <div
      className="status-group"
      data-group="pointer"
      data-inactive={overImage ? undefined : ""}
      role="group"
      aria-label="Pointer"
    >
      <span className="status-group__label">Pointer</span>
      <StatusMouseSlot />
      <StatusValueReadout id="pointerValue" world={overImage ? world : null} fresh delayMs={30} />
      {overImage ? <StatusRegionSlot id="pointerRegion" /> : null}
    </div>
  );
}

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
  const crosshairNearest = useSurfaceNearestVertex(surfaceId);
  // A vertex clicked on this surface (any mesh, inflated too: native check
  // item 9) while the crosshair is still where the click put it. The
  // crosshair → vertex lookup through a pial / white mesh stays for a
  // crosshair moved in a volume.
  const picked = useSurfaceStore((state) => state.pickedVertex);
  const crosshair = useViewStateStore((state) => state.viewState.crosshair.world_mm);
  const pickedHere =
    picked && picked.surfaceId === surfaceId && picked.world.every((v, i) => Math.abs(v - crosshair[i]) < 1e-3)
      ? picked
      : null;
  const pickedValue = useSurfaceStore((state) => {
    if (!pickedHere || !overlayId) return null;
    const v = state.surfaces.get(surfaceId)?.layers.get(overlayId)?.values?.[pickedHere.vertex];
    return typeof v === "number" && Number.isFinite(v) ? v : null;
  });
  const fromPick = !!pickedHere && !(anatomical && crosshairNearest);
  const nearest = fromPick ? { vertex: pickedHere!.vertex, distanceMm: 0 } : crosshairNearest;
  // The value is labelled with its overlay (v1 function 9): "32,116 · sensorimotor.func 59,391".
  const map = overlayName ? overlayMapName(overlayName) : null;
  const value = fromPick
    ? pickedValue !== null
      ? formatReadoutValue(pickedValue)
      : null
    : reading
      ? formatReadoutValue(reading.value)
      : null;
  const title = fromPick
    ? `Vertex ${nearest!.vertex}, clicked on the surface` + (value !== null && overlayName ? `; ${overlayName} = ${value}` : "")
    : !anatomical
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
        (anatomical || fromPick) && nearest ? (
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
  slots = ["coordSys", "crosshair", "pointer"],
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
  // A workspace with its own status line (BIDS) replaces the imaging readouts;
  // they keep updating underneath and need no restoring.
  const workspaceStatus = useStatusBarStore((state) => state.values.workspaceStatus ?? null);
  const workspaceStatusRight = useStatusBarStore((state) => state.values.workspaceStatusRight ?? null);
  const showTime =
    has4DVolume || barWidth === null || barWidth === 0 || barWidth >= HIDE_EMPTY_TIME_BELOW_PX;
  // "RAS" never changes: the first slot to go on a narrow bar.
  const showCoordSys = barWidth === null || barWidth === 0 || barWidth >= HIDE_COORD_SYS_BELOW_PX;

  return (
    // Copying a readout puts ASCII minus on the clipboard.
    <div
      ref={barRef}
      className={`status-bar ${className}`}
      onCopy={asciiCopyHandler}
      role="contentinfo"
      aria-label="Status"
    >
      {workspaceStatus ? (
        <div className="status-group min-w-0" data-testid="workspace-status">
          {workspaceStatus}
        </div>
      ) : null}
      {(workspaceStatus ? [] : slots)
        .filter(
          (id) =>
            !(DIAGNOSTIC_SLOT_IDS as readonly string[]).includes(id) &&
            !(id === "coordSys" && showCoordSys === false),
        )
        .map((id) =>
          id === "layer" ? (
            <StatusLayerSlot key={id} />
          ) : id === "crosshair" ? (
            <CrosshairGroup key={id} onCrosshairClick={onCrosshairClick} />
          ) : id === "pointer" ? (
            <PointerGroup key={id} />
          ) : (
            <StatusBarSlot key={id} id={id} />
          ),
        )}

      {/* Time slider: disabled without a 4D volume, and hidden then on a
          narrow bar (the readouts keep their room). */}
      {showTime && !workspaceStatus ? (
        <TimeSlider className="flex-1 max-w-sm" disabled={!has4DVolume} />
      ) : null}

      {/* Messages ("Loaded …", errors) in the bar's free space: never over a panel. */}
      <NotificationToast />

      {/* Progress indicator */}
      <StatusBarProgress />

      <div className="status-bar__right">
        {workspaceStatusRight ? (
          <span data-testid="workspace-status-right">{workspaceStatusRight}</span>
        ) : null}
        {rightContent}
        <DiagnosticsButton />
      </div>
    </div>
  );
}
