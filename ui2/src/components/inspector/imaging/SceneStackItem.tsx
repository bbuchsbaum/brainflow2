import React, { forwardRef, useId } from "react";
import { useViewStateStore } from "@/stores/viewStateStore";
import { useSurfaceValueAtCrosshair } from "@/hooks/useSurfaceValueAtCrosshair";
import { EMPTY_VALUE, formatLayerValue } from "@/utils/valueFormat";
import type { SceneItem, SceneItemKind } from "@/types/sceneItem";
import { SelectableRow, type RovingItemProps } from "@/components/ui/bf";
import { LayerReadoutValue } from "./LayerReadoutValue";
import { useReadoutPoint } from "@/hooks/useReadoutPoint";

/** A surface overlay's value at its vertex nearest the crosshair (within 3 mm). */
function SurfaceRowReadout({
  surfaceId,
  surfaceLayerId,
  id,
}: {
  surfaceId: string;
  surfaceLayerId: string;
  id: string;
}) {
  const reading = useSurfaceValueAtCrosshair(surfaceId, surfaceLayerId);
  return (
    <span
      id={id}
      className="max-w-[14ch] shrink-0 truncate text-right font-mono text-bf-xs tabular-nums text-bf-text-secondary"
      title={
        reading
          ? `Vertex ${reading.vertex}, ${reading.distanceMm.toFixed(1)} mm from the crosshair`
          : "No vertex within 3 mm of the crosshair"
      }
      data-testid={`surface-readout-${surfaceLayerId}`}
    >
      {reading ? formatLayerValue(reading.value) : EMPTY_VALUE}
    </span>
  );
}

function VolumeRowReadout({ layerId, id }: { layerId: string; id: string }) {
  const point = useReadoutPoint();
  // Shown only while the layer is drawn: a hidden layer says so instead of
  // reading a value the views do not show.
  const drawn = useViewStateStore((s) => {
    const layer = s.viewState.layers.find((l) => l.id === layerId);
    return !!layer && layer.visible && layer.opacity > 0;
  });
  if (!drawn) {
    return (
      <span id={id} className="shrink-0 text-bf-xs text-bf-text-muted" data-testid={`layer-readout-${layerId}`}>
        hidden
      </span>
    );
  }
  return <LayerReadoutValue layerId={layerId} point={point} id={id} />;
}

interface SceneStackItemProps {
  item: SceneItem;
  selected: boolean;
  onSelect: () => void;
  /**
   * Optional drag handle, rendered before the kind glyph. Provided by the
   * sortable wrapper for reorderable groups; omitted for static groups. The
   * row is a grid `row` (not a `<button>`) so this nested handle button sits
   * in its own gridcell as valid markup.
   */
  dragHandle?: React.ReactNode;
  /** Roving-focus wiring from the scene list (`useRovingFocus`). */
  roving?: RovingItemProps;
}

const GLYPH_PROPS = {
  width: 14,
  height: 14,
  viewBox: "0 0 16 16",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.3,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  "aria-hidden": true,
};

/** Three stacked slices — a volume. */
function VolumeGlyph({ overlay = false }: { overlay?: boolean }) {
  return (
    <svg {...GLYPH_PROPS}>
      <path
        d="M2 5.5l6-3 6 3-6 3z"
        fill={overlay ? "currentColor" : "none"}
        fillOpacity={overlay ? 0.35 : undefined}
      />
      <path d="M2 8.5l6 3 6-3" />
      <path d="M2 11.5l6 3 6-3" />
    </svg>
  );
}

/** A 2×2 parcellation grid — a label atlas. */
function AtlasGlyph() {
  return (
    <svg {...GLYPH_PROPS}>
      <rect x="2.5" y="2.5" width="4.5" height="4.5" />
      <rect x="9" y="2.5" width="4.5" height="4.5" />
      <rect x="2.5" y="9" width="4.5" height="4.5" />
      <rect x="9" y="9" width="4.5" height="4.5" />
    </svg>
  );
}

/** A triangle mesh — a surface. */
function SurfaceGlyph({ overlay = false }: { overlay?: boolean }) {
  return (
    <svg {...GLYPH_PROPS}>
      <path d="M2 12L8 3l6 9z" />
      <path
        d="M5 12L8 7.5 11 12z"
        fill={overlay ? "currentColor" : "none"}
        fillOpacity={overlay ? 0.35 : undefined}
      />
      <path d="M8 3v4.5" />
    </svg>
  );
}

/** An arrow onto a surface — a volume-to-surface mapping. */
function MappingGlyph() {
  return (
    <svg {...GLYPH_PROPS}>
      <path d="M2.5 8h8" />
      <path d="M7.5 5l3 3-3 3" />
      <path d="M13.5 3v10" />
    </svg>
  );
}

/**
 * Kind glyphs are neutral (the row subtitle already spells the kind out), so
 * the only colour in the list is the amber selection bar.
 */
const KIND_GLYPH: Record<SceneItemKind, React.ReactNode> = {
  "volume-base": <VolumeGlyph />,
  "volume-overlay": <VolumeGlyph overlay />,
  "volume-overlay-atlas": <AtlasGlyph />,
  "surface-geometry": <SurfaceGlyph />,
  "surface-overlay": <SurfaceGlyph overlay />,
  mapping: <MappingGlyph />,
};

/**
 * One scene row: a {@link SelectableRow} (`role="row"`, selection = selected
 * fill + amber leading edge, focus = an inset ring; HYBRID rule 4). The row
 * holds its own control (the drag handle), so it is a grid row with gridcell
 * children; clicking or pressing keys on the handle never selects the row.
 */
export const SceneStackItem = forwardRef<HTMLDivElement, SceneStackItemProps>(
  function SceneStackItem({ item, selected, onSelect, dragHandle, roving }, ref) {
    const { ref: rovingRef, ...rovingProps } = roving ?? {};
    const uid = useId().replace(/:/g, "");
    const nameId = `scene-row-${uid}-name`;
    const kindId = `scene-row-${uid}-kind`;
    const valueId = `scene-row-${uid}-value`;
    return (
      <SelectableRow
        {...rovingProps}
        ref={(el) => {
          rovingRef?.(el);
          if (typeof ref === "function") ref(el);
          else if (ref) ref.current = el;
        }}
        role="row"
        selected={selected}
        onSelect={() => onSelect()}
        // Named "<layer>, <kind>, <value>" from its own cells, so the value
        // (with the statistic's long form) is read; opacity lives in Render.
        aria-labelledby={`${nameId} ${kindId} ${valueId}`}
        className="group gap-2.5 rounded-sm py-1.5"
      >
        {dragHandle ? (
          <span role="gridcell" className="flex shrink-0">
            {dragHandle}
          </span>
        ) : null}
        <span role="gridcell" className="flex min-w-0 flex-1 items-center gap-2.5">
          <span
            aria-hidden
            className="inline-flex h-4 w-4 shrink-0 items-center justify-center"
            style={{ color: "var(--bf-text-secondary)" }}
          >
            {KIND_GLYPH[item.kind]}
          </span>
          <span className="min-w-0 flex-1">
            <span id={nameId} className="block truncate text-bf-sm text-foreground">
              {item.name}
            </span>
            <span id={kindId} className="block truncate text-bf-xs text-muted-foreground">
              {item.subtitle}
            </span>
          </span>
          {/* Volume rows read their layer's value at the pointer / crosshair
              (P3.6, FSLeyes-style location readout); opacity lives in Render.
              Surface rows have no sampled value here: "—", consistently. */}
          {item.ref.type === "volume" ? (
            <VolumeRowReadout layerId={item.ref.layerId} id={valueId} />
          ) : item.ref.type === "surface-overlay" ? (
            <SurfaceRowReadout
              surfaceId={item.ref.surfaceId}
              surfaceLayerId={item.ref.surfaceLayerId}
              id={valueId}
            />
          ) : (
            <span
              id={valueId}
              className="shrink-0 font-mono text-bf-xs tabular-nums text-muted-foreground"
              aria-label="no value"
            >
              —
            </span>
          )}
        </span>
      </SelectableRow>
    );
  },
);
