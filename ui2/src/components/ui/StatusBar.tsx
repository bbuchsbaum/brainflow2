/**
 * StatusBar Component
 * Optimized component that renders individual status bar slots
 * Uses StatusBarSlot for performance - only affected slots re-render
 */

import React from "react";
import { useStatusBarStore } from "@/stores/statusBarStore";
import { useLayerStore } from "@/stores/layerStore";
import { useCrosshairSettingsStore } from "@/stores/crosshairSettingsStore";
import { useInspectorSelectionStore } from "@/stores/inspectorSelectionStore";
import { useSceneStack } from "@/hooks/useSceneStack";
import { Popover, PopoverContent, PopoverTrigger } from "./shadcn/popover";
import { StatusBarProgress } from "./StatusBarProgress";
import { TimeSlider } from "./TimeSlider";

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
  mouse: "Mouse",
  layer: "Layer",
  region: "Region",
  atlas: "Atlas",
  fps: "FPS",
  gpu: "GPU",
};

const WIDTHS: Record<string, [string, string]> = {
  coordSys: ["22ch", "22ch"],
  crosshair: ["32ch", "32ch"],
  mouse: ["32ch", "12ch"],
  layer: ["40ch", "16ch"],
  region: ["30ch", "12ch"],
};

/** Shrink order when the bar is narrow: the mouse readout (often "--") gives
 *  way first, then region, and the selected layer name last. */
const SHRINK: Record<string, number> = { mouse: 4, region: 2, layer: 1 };

/** Developer telemetry lives behind the Diagnostics button, not in the bar. */
export const DIAGNOSTIC_SLOT_IDS = ["atlas", "fps", "gpu"] as const;

const VALUE_CLASS: Record<string, string> = {
  coordSys: "status-value--coordinate-system",
  crosshair: "status-value--crosshair",
  mouse: "status-value--mouse",
  fps: "status-value--fps",
  gpu: "status-value--gpu",
};

interface SlotFrameProps {
  id: string;
  value: React.ReactNode;
  title?: string;
  onClick?: () => void;
  valueStyle?: React.CSSProperties;
}

const SlotFrame = ({ id, value, title, onClick, valueStyle }: SlotFrameProps) => {
  const [basis, min] = WIDTHS[id] ?? ["22ch", "12ch"];
  const isClickable = !!onClick;
  return (
    <div
      className={`status-slot${isClickable ? " cursor-pointer hover:text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring" : ""}`}
      style={{
        width: basis,
        minWidth: min,
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
        className={`status-value ${VALUE_CLASS[id] ?? ""}${isClickable ? " hover:underline" : ""}`}
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
        value={value}
        title={typeof value === "string" ? value : undefined}
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
 * Resolve the name shown in the "Layer" slot: the Inspector's selected scene
 * item, else the selected volume layer, else the service-provided value (the
 * base / first visible layer).
 */
export function resolveStatusLayerName(
  activeItemId: string | null,
  sceneItems: ReadonlyArray<{ id: string; name: string }>,
  selectedLayerId: string | null,
  layers: ReadonlyArray<{ id: string; name?: string }>,
  fallback: string | null | undefined,
): string | null {
  if (activeItemId) {
    const item = sceneItems.find((candidate) => candidate.id === activeItemId);
    if (item?.name) return item.name;
  }
  if (selectedLayerId) {
    const layer = layers.find((candidate) => candidate.id === selectedLayerId);
    if (layer) return layer.name || layer.id;
  }
  return fallback ?? null;
}

/** "Layer" slot: follows the selection the Inspector uses. */
const StatusLayerSlot = React.memo(() => {
  const fallback = useStatusBarStore((state) => state.values.layer);
  const activeItemId = useInspectorSelectionStore((state) => state.activeItemId);
  const selectedLayerId = useLayerStore((state) => state.selectedLayerId);
  const layers = useLayerStore((state) => state.layers);
  const sceneStack = useSceneStack();
  const sceneItems = React.useMemo(
    () => [...sceneStack.volumes, ...sceneStack.surfaces, ...sceneStack.mappings],
    [sceneStack],
  );
  const name = resolveStatusLayerName(
    activeItemId,
    sceneItems,
    selectedLayerId,
    layers,
    typeof fallback === "string" ? fallback : fallback == null ? null : String(fallback),
  );
  if (name === null) return null;
  return <SlotFrame id="layer" value={name} title={name} />;
});

StatusLayerSlot.displayName = "StatusLayerSlot";

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
    ["Atlas", atlas == null ? "--" : String(atlas)],
    ["FPS", fps == null ? "--" : String(fps)],
    ["GPU", gpu == null ? "--" : String(gpu)],
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
        <button
          type="button"
          className="status-diagnostics-trigger focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background"
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
        </button>
      </PopoverTrigger>
      <PopoverContent
        side="top"
        align="end"
        sideOffset={6}
        className="w-auto min-w-[16rem] max-w-[28rem] p-2 focus-visible:outline-none"
        aria-label="Diagnostics"
        data-testid="status-diagnostics-popover"
      >
        <dl className="status-diagnostics-list">
          {rows.map(([label, value]) => (
            <div key={label} className="status-diagnostics-row">
              <dt>{label}</dt>
              <dd title={value}>{value}</dd>
            </div>
          ))}
        </dl>
      </PopoverContent>
    </Popover>
  );
};

export function StatusBar({
  className = "",
  slots = ["coordSys", "crosshair", "mouse", "layer", "region"],
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

  return (
    <div className={`status-bar ${className}`}>
      {slots
        .filter(
          (id) =>
            !(DIAGNOSTIC_SLOT_IDS as readonly string[]).includes(id),
        )
        .map((id) =>
          id === "layer" ? (
            <StatusLayerSlot key={id} />
          ) : (
            <StatusBarSlot
              key={id}
              id={id}
              onClick={id === "crosshair" ? onCrosshairClick : undefined}
            />
          ),
        )}

      {/* Time slider always visible; disabled when no 4D */}
      <TimeSlider className="flex-1 max-w-sm" disabled={!has4DVolume} />

      {/* Progress indicator */}
      <StatusBarProgress />

      <div className="status-bar__right">
        {rightContent}
        <DiagnosticsButton />
      </div>
    </div>
  );
}
