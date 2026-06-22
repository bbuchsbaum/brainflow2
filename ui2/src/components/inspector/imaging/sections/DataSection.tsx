import React from "react";
import { useLayerStore } from "@/stores/layerStore";
import { useLayoutSettingsStore } from "@/stores/layoutSettingsStore";
import { useSurfaceStore } from "@/stores/surfaceStore";
import type { SceneItem } from "@/types/sceneItem";
import { InspectorSection, FactGrid } from "../InspectorSection";
import { InlineHistogramPreview } from "./InlineHistogramPreview";

interface DataSectionProps {
  item: SceneItem;
}

/**
 * Shared handler for the DATA-section plot affordances (inline preview + the
 * "Open in dock" link): target the inspected layer so the dock plots it, then
 * reveal the dock. Mode (histogram vs. time-series) is resolved by the dock's
 * auto policy.
 */
function useOpenLayerInDock() {
  const setPlotDockOpen = useLayoutSettingsStore((s) => s.setPlotDockOpen);
  const selectLayer = useLayerStore((s) => s.selectLayer);
  return React.useCallback(
    (item: SceneItem) => {
      if (item.ref.type === "volume") {
        selectLayer(item.ref.layerId);
      }
      setPlotDockOpen(true);
    },
    [setPlotDockOpen, selectLayer],
  );
}

/**
 * Compact, read-only fact grid. Full charts (histogram, time-series) live in
 * the bottom Plot dock per Design.md §1.5. The inline sparkline is a glance;
 * clicking it (or "Open in dock") reveals the full plot in the dock.
 */
export function DataSection({ item }: DataSectionProps) {
  const openInDock = useOpenLayerInDock();
  const handleOpen = React.useCallback(
    () => openInDock(item),
    [openInDock, item],
  );

  // Inline preview is histogram-based, so it's only meaningful for scalar
  // volumes — not atlases (label ids) or surfaces.
  const previewLayerId =
    item.ref.type === "volume" && item.kind !== "volume-overlay-atlas"
      ? item.ref.layerId
      : null;

  return (
    <InspectorSection label="Data" icon={<DataIcon />} defaultOpen>
      {(() => {
        switch (item.kind) {
          case "volume-base":
          case "volume-overlay":
          case "volume-overlay-atlas":
            return <VolumeFacts item={item} />;
          case "surface-geometry":
          case "surface-overlay":
            return <SurfaceFacts item={item} />;
          default:
            return null;
        }
      })()}
      {previewLayerId && (
        <InlineHistogramPreview layerId={previewLayerId} onOpen={handleOpen} />
      )}
      <OpenInDockLink item={item} onOpen={handleOpen} />
    </InspectorSection>
  );
}

function VolumeFacts({ item }: { item: SceneItem }) {
  const layerId = item.ref.type === "volume" ? item.ref.layerId : null;
  const layer = useLayerStore((s) =>
    layerId ? (s.layers.find((l) => l.id === layerId) ?? null) : null,
  );
  const metadata = useLayerStore((s) =>
    layerId ? (s.layerMetadata.get(layerId) ?? null) : null,
  );

  if (!layer) return null;

  const facts: Array<{ label: string; value: string }> = [];
  const dim = metadata?.dimensions;
  const ts = layer.timeSeriesInfo;
  if (dim) {
    const shape = ts
      ? `${dim[0]}×${dim[1]}×${dim[2]}×${ts.num_timepoints}`
      : `${dim[0]}×${dim[1]}×${dim[2]}`;
    facts.push({ label: "Shape", value: shape });
  }
  if (metadata?.dataRange) {
    const { min, max } = metadata.dataRange;
    facts.push({
      label: "Range",
      value: `${formatNum(min)} — ${formatNum(max)}`,
    });
  }
  if (metadata?.spacing) {
    const [sx, sy, sz] = metadata.spacing;
    facts.push({
      label: "Voxel size",
      value: `${formatNum(sx)}×${formatNum(sy)}×${formatNum(sz)} mm`,
    });
  }
  if (ts?.tr != null) {
    facts.push({ label: "TR", value: `${ts.tr.toFixed(1)} s` });
  }
  if (layer.atlasMetadata?.space) {
    facts.push({ label: "Space", value: layer.atlasMetadata.space });
  } else if (metadata?.orientation) {
    facts.push({ label: "Space", value: metadata.orientation });
  }

  return facts.length > 0 ? <FactGrid facts={facts} /> : <EmptyFacts />;
}

function SurfaceFacts({ item }: { item: SceneItem }) {
  const surfaces = useSurfaceStore((s) => s.surfaces);
  const surfaceId =
    item.ref.type === "surface-geometry" || item.ref.type === "surface-overlay"
      ? item.ref.surfaceId
      : null;
  const surface = surfaceId ? surfaces.get(surfaceId) : null;
  if (!surface) return null;

  const facts: Array<{ label: string; value: string }> = [];
  if (surface.metadata.vertexCount) {
    facts.push({
      label: "Vertices",
      value: surface.metadata.vertexCount.toLocaleString(),
    });
  }
  if (surface.metadata.faceCount) {
    facts.push({
      label: "Faces",
      value: surface.metadata.faceCount.toLocaleString(),
    });
  }
  if (surface.metadata.hemisphere) {
    facts.push({ label: "Hemisphere", value: surface.metadata.hemisphere });
  }
  if (surface.metadata.surfaceType) {
    facts.push({ label: "Type", value: surface.metadata.surfaceType });
  }
  return facts.length > 0 ? <FactGrid facts={facts} /> : <EmptyFacts />;
}

function OpenInDockLink({
  item,
  onOpen,
}: {
  item: SceneItem;
  onOpen: () => void;
}) {
  const kind = item.kind;
  const showsPlot =
    kind === "volume-base" ||
    kind === "volume-overlay" ||
    kind === "surface-overlay";
  if (!showsPlot) return null;

  return (
    <div className="mt-2 flex items-center justify-between border-t border-border/40 pt-2 text-[11px]">
      <span className="text-muted-foreground">Full plot</span>
      <button
        type="button"
        onClick={onOpen}
        data-testid="open-in-dock"
        className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-sky-600 transition-colors hover:bg-accent/40 dark:text-sky-300"
        title="Open this layer's plot in the bottom dock"
      >
        <span>Open in dock</span>
        <svg
          viewBox="0 0 16 16"
          className="h-3 w-3"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          aria-hidden
        >
          <path
            d="M5 8h6M8 5l3 3-3 3"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>
    </div>
  );
}

function EmptyFacts() {
  return (
    <div className="rounded-md border border-dashed border-border/60 bg-card/30 px-3 py-2 text-[11px] text-muted-foreground/70">
      No metadata yet.
    </div>
  );
}

function formatNum(value: number): string {
  if (!Number.isFinite(value)) return "—";
  const abs = Math.abs(value);
  if (abs === 0) return "0";
  if (abs >= 1000 || abs < 0.01) return value.toExponential(2);
  return value.toFixed(2);
}

function DataIcon() {
  return (
    <svg
      viewBox="0 0 16 16"
      className="h-3.5 w-3.5"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      aria-hidden
    >
      <rect x="2.5" y="2.5" width="11" height="11" rx="1" />
      <path d="M2.5 6.5h11M6 13.5v-7" />
    </svg>
  );
}
