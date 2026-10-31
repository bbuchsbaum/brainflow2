import { formatDataRange, formatDims, formatLayerValue, formatVoxelSize, formatWorldMm } from "@/utils/valueFormat";
import { useClusterStore } from "@/stores/clusterStore";
import { asciiCopyHandler } from "@/utils/numericInput";
import { describeStatistic, isInferredStatistic, statisticPhrase } from "@/utils/statistic";
import { StatSymbol } from "@/components/ui/StatSymbol";
import { clusterTestText, getClusterService } from "@/services/ClusterService";
import { getEventBus } from "@/events/EventBus";
import { formatTauriError } from "@/utils/formatTauriError";
import React from "react";
import { useLayerStore } from "@/stores/layerStore";
import { useLayoutSettingsStore } from "@/stores/layoutSettingsStore";
import { useSurfaceStore } from "@/stores/surfaceStore";
import type { SceneItem } from "@/types/sceneItem";
import { Button, KeyValue, Notice, Section } from "@/components/ui/bf";
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
  const setBottomDockOpen = useLayoutSettingsStore((s) => s.setBottomDockOpen);
  const setBottomDockActiveTab = useLayoutSettingsStore(
    (s) => s.setBottomDockActiveTab,
  );
  const selectLayer = useLayerStore((s) => s.selectLayer);
  return React.useCallback(
    (item: SceneItem) => {
      if (item.ref.type === "volume") {
        selectLayer(item.ref.layerId);
      }
      setBottomDockActiveTab("plot");
      setBottomDockOpen(true);
    },
    [setBottomDockOpen, setBottomDockActiveTab, selectLayer],
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
    <Section title="Data" icon={<DataIcon />} defaultOpen>
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
    </Section>
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

  const facts: Array<{ label: string; value: React.ReactNode }> = [];
  const dim = metadata?.dimensions;
  const ts = layer.timeSeriesInfo;
  if (dim) {
    const shape = formatDims(
      ts ? [dim[0], dim[1], dim[2], ts.num_timepoints] : [dim[0], dim[1], dim[2]],
    );
    facts.push({ label: "Shape", value: shape });
  }
  if (metadata?.dataRange) {
    const { min, max } = metadata.dataRange;
    facts.push({
      label: "Range",
      value: formatDataRange(min, max),
    });
  }
  // Statistic maps: "t(24)", "z score", "z score (from name)" (utils/statistic.ts).
  const phrase = layer.statistic ? statisticPhrase(layer.statistic, metadata?.dataRange) : null;
  if (layer.statistic && phrase) {
    // "z score", "t(24)" with the variable in italic; the source in the
    // tooltip ("t(24) · t-stat").
    const description = describeStatistic(layer.statistic, metadata?.dataRange);
    facts.push({
      label: "Statistic",
      value: (
        // A statistic guessed from the file name is marked "z*" (the symbol
        // says it); the tooltip spells it out, no "(from name)" repeat.
        <span
          title={
            isInferredStatistic(layer.statistic)
              ? `${description} · inferred from file name`
              : description
          }
        >
          <StatSymbol label={phrase.variable} />
          {phrase.rest}
        </span>
      ),
    });
  }
  if (metadata?.spacing) {
    const [sx, sy, sz] = metadata.spacing;
    facts.push({
      label: "Voxel size",
      value: `${formatVoxelSize([sx, sy, sz])} mm`,
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

  return facts.length > 0 ? (
    // Copying a fact puts ASCII minus on the clipboard.
    <div className="contents" onCopy={asciiCopyHandler}>
      <KeyValue boxed items={facts} />
      {phrase && layerId ? <PeakLine layerId={layerId} variable={phrase.variable} /> : null}
      {phrase && layerId ? <ExtremumLinks layerId={layerId} /> : null}
    </div>
  ) : (
    <EmptyFacts />
  );
}

/** "−40" for a whole millimetre, "−39.5" otherwise. */
const peakMm = (v: number) => formatWorldMm(v).replace(/\.0$/, "");

/**
 * Statistic layers: the strongest cluster peak at the display threshold,
 * computed on load and after threshold changes (services/autoClusters.ts).
 * Clicking it moves the crosshair there, exactly.
 */
function PeakLine({ layerId, variable }: { layerId: string; variable: string }) {
  const peak = useClusterStore((s) => s.peaks[layerId]);
  if (!peak) return null;
  // The test the clusters were formed with: |z| > t, z > t or z < −t.
  const t = formatLayerValue(peak.threshold);
  const symbol = <StatSymbol label={variable} />;
  // Two tails at different thresholds (−3.1 ≤ z ≤ 3.93 hidden; QA N6).
  const n =
    peak.sign === "both" && peak.negativeThreshold != null && peak.negativeThreshold !== peak.threshold
      ? formatLayerValue(peak.negativeThreshold)
      : null;
  const test =
    n !== null ? (
      <>
        {symbol} &gt; {t} or {symbol} &lt; {"\u2212"}
        {n}
      </>
    ) : peak.sign === "both" ? (
      <>|{symbol}| &gt; {t}</>
    ) : peak.sign === "positive" ? (
      <>{symbol} &gt; {t}</>
    ) : (
      <>{symbol} &lt; {"\u2212"}{t}</>
    );
  const testText = clusterTestText(peak, variable);
  if (peak.value === null || !peak.mm) {
    return (
      <p className="mt-1 text-bf-xs text-bf-text-muted" data-testid="layer-peak">
        No voxels with {test}
      </p>
    );
  }
  const mm = peak.mm;
  const where = `(${mm.map(peakMm).join(", ")})`;
  return (
    <div className="mt-1 text-bf-xs" data-testid="layer-peak">
      <Button
        variant="link"
        size="sm"
        title={`Move the crosshair to the peak (${peak.clusters} cluster${peak.clusters === 1 ? "" : "s"} at ${testText})`}
        onClick={() => {
          void getClusterService()
            .goToPeak(layerId)
            .catch((err) =>
              getEventBus().emit("ui.notification", {
                type: "error",
                message: `Could not move to the peak: ${formatTauriError(err)}`,
              }),
            );
        }}
      >
        <span className="font-mono tabular-nums">
          Peak <StatSymbol label={variable} /> {formatLayerValue(peak.value)} at {where}
        </span>
      </Button>
    </div>
  );
}

/**
 * Statistic layers: move the crosshair to the largest / smallest value
 * (`volume_extremum`), next to the Range the numbers come from.
 */
function ExtremumLinks({ layerId }: { layerId: string }) {
  const go = (kind: "max" | "min") => {
    void getClusterService()
      .goToExtremum(layerId, kind)
      .catch((err) =>
        getEventBus().emit("ui.notification", {
          type: "error",
          message: `Could not find the ${kind}: ${formatTauriError(err)}`,
        }),
      );
  };
  return (
    // Same control as the Clusters footer: secondary buttons (24px targets).
    <div className="mt-1 flex items-center gap-1 text-bf-xs" data-testid="extremum-links">
      <Button variant="secondary" size="sm" onClick={() => go("max")}>
        Go to max
      </Button>
      <Button variant="secondary" size="sm" onClick={() => go("min")}>
        Go to min
      </Button>
    </div>
  );
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
  return facts.length > 0 ? <KeyValue boxed items={facts} /> : <EmptyFacts />;
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
    <div className="mt-2 flex items-center justify-between border-t border-bf-border-subtle pt-2 text-bf-xs">
      <span className="text-muted-foreground">Full plot</span>
      <Button
        variant="link"
        size="sm"
        onClick={onOpen}
        data-testid="open-in-dock"
        title="Open this layer's plot in the bottom dock"
        iconPosition="right"
        icon={
          <svg
            viewBox="0 0 16 16"
            className="min-h-6 h-3 w-3"
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
        }
      >
        Open in dock
      </Button>
    </div>
  );
}

function EmptyFacts() {
  return <Notice role={undefined}>No metadata yet.</Notice>;
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
