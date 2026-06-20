/**
 * LayerInspectorContent — Phase 6b of the integrated workspace refactor.
 *
 * Plugs into the Inspector|Annotate shell's `inspector-content-placeholder`
 * region. Dispatches over the active layer's `kind` and renders a
 * kind-specific content section.
 *
 * Acceptance contract (from mote bd-01KQJSPY4AHCQPKZRPRS994PCJ):
 *   1. Volume layers expose volume-specific controls (opacity, colormap,
 *      threshold, blend mode, display options).
 *   2. Surface layers expose surface-specific geometry controls.
 *   3. Atlas layers expose atlas-specific controls (palette, opacity,
 *      region count, citation).
 *   4. NO intensity-range slider or histogram is rendered here — those live
 *      in the Plot pane (PlotHost / HistogramPlot).
 *   5. NO top-level Surface|Volume|Atlas tabs (already satisfied by 6a).
 *
 * Files this content section purposely does NOT modify:
 *   - InspectorAnnotatePanel.tsx shell (only the placeholder body is replaced).
 *   - LayerPropertiesManager / VolumePanel (existing right-sidebar IA stays
 *     intact for the legacy workspace).
 */

import React from "react";
import {
  Activity,
  BarChart3,
  Brain,
  Database,
  ExternalLink,
  Layers,
  Palette,
  Settings,
} from "lucide-react";

import type { LoadedSurface, SurfaceDataLayer } from "@/stores/surfaceStore";
import { useSurfaceStore } from "@/stores/surfaceStore";
import {
  useLayerStore,
  type LayerInfo,
  type VolumeMetadata,
} from "@/stores/layerStore";
import { useViewStateStore } from "@/stores/viewStateStore";
import { CollapsibleSection } from "../ui/CollapsibleSection";
import { PropertyBox, PropertyRow } from "../ui/PropertyRow";
import { SingleSlider } from "../ui/SingleSlider";
import { ProSlider } from "../ui/ProSlider";
import { AlphaModulationControl } from "./AlphaModulationControl";
import { EnhancedColormapSelector } from "./EnhancedColormapSelector";
import {
  ATLAS_PALETTE_OPTIONS,
  type AtlasPaletteKind,
} from "@/types/atlasPalette";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/shadcn/select";
import { AtlasPaletteService } from "@/services/AtlasPaletteService";

import {
  type ActiveLayerSummary,
  useLayerRenderUpdater,
  useOpenInPlot,
  useVolumeLayerStats,
} from "./inspectorAnnotatePanel.helpers";

const containerStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "12px",
};

interface LayerInspectorContentProps {
  layer: ActiveLayerSummary;
}

// ---------------------------------------------------------------------------
// Volume controls (3D + 4D)
// ---------------------------------------------------------------------------

interface VolumeInspectorSectionProps {
  layerId: string;
  fourD: boolean;
}

const InterpolationToggle: React.FC<{
  value: "nearest" | "linear";
  onChange: (next: "nearest" | "linear") => void;
  disabled?: boolean;
}> = ({ value, onChange, disabled }) => (
  <div className="flex items-center justify-between gap-4">
    <label className="bf-role-section text-muted-foreground shrink-0">
      Blend Mode
    </label>
    <div className="flex gap-0 shrink-0">
      <button
        type="button"
        data-testid="layer-inspector-blend-nearest"
        aria-pressed={value === "nearest"}
        className={`px-3 py-1 bf-role-section min-h-control-md border border-r-0 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
          value === "nearest"
            ? "bg-primary text-primary-foreground border-primary"
            : "bg-transparent hover:bg-muted/50 border-border text-muted-foreground"
        }`}
        style={{ borderRadius: "1px 0 0 1px" }}
        onClick={() => onChange("nearest")}
        disabled={disabled}
      >
        Nearest
      </button>
      <button
        type="button"
        data-testid="layer-inspector-blend-linear"
        aria-pressed={value === "linear"}
        className={`px-3 py-1 bf-role-section min-h-control-md border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
          value === "linear"
            ? "bg-primary text-primary-foreground border-primary"
            : "bg-transparent hover:bg-muted/50 border-border text-muted-foreground"
        }`}
        style={{ borderRadius: "0 1px 1px 0" }}
        onClick={() => onChange("linear")}
        disabled={disabled}
      >
        Linear
      </button>
    </div>
  </div>
);

function precisionFor(min: number, max: number): number {
  const range = Math.abs(max - min);
  if (range < 1) return 3;
  if (range < 10) return 2;
  if (range < 100) return 1;
  return 0;
}

function formatStatNumber(
  value: number | null | undefined,
  precision: number,
): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return value.toFixed(precision);
}

function formatCount(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return Math.round(value).toLocaleString();
}

interface OpenInPlotButtonProps {
  modeId: string;
  testId?: string;
  label?: string;
}

const OpenInPlotButton: React.FC<OpenInPlotButtonProps> = ({
  modeId,
  testId = "layer-inspector-open-in-plot",
  label = "Open in Plot",
}) => {
  const openInPlot = useOpenInPlot();
  return (
    <button
      type="button"
      data-testid={testId}
      data-target-mode={modeId}
      onClick={() => openInPlot(modeId)}
      className="bf-role-section flex items-center gap-1.5 px-2.5 py-1 border border-border bg-transparent hover:bg-muted/40 text-muted-foreground hover:text-foreground transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      style={{ borderRadius: "1px" }}
    >
      <ExternalLink className="h-3 w-3" aria-hidden="true" />
      <span>{label}</span>
    </button>
  );
};

interface VolumeStatsSectionProps {
  layerId: string;
  fourD: boolean;
}

const VolumeStatsSection: React.FC<VolumeStatsSectionProps> = ({
  layerId,
  fourD,
}) => {
  const stats = useVolumeLayerStats(layerId);
  const min = stats.min ?? 0;
  const max = stats.max ?? 1;
  const precision = precisionFor(min, max);
  // 4D layers should land in the time-series plot; 3D in the histogram.
  const targetMode = fourD ? "crosshair-time-series" : "histogram";

  return (
    <CollapsibleSection title="Stats" icon={Activity} defaultExpanded={!fourD}>
      <div
        data-testid="volume-inspector-stats"
        data-loading={stats.loading ? "true" : "false"}
      >
        <PropertyBox>
          <PropertyRow label="N" value={formatCount(stats.count)} mono />
          <PropertyRow
            label="Min"
            value={formatStatNumber(stats.min, precision)}
            mono
          />
          <PropertyRow
            label="Max"
            value={formatStatNumber(stats.max, precision)}
            mono
          />
          <PropertyRow
            label="Mean"
            value={formatStatNumber(stats.mean, precision)}
            mono
          />
          <PropertyRow
            label="SD"
            value={formatStatNumber(stats.std, precision)}
            mono
          />
        </PropertyBox>
        {stats.error ? (
          <p
            data-testid="volume-inspector-stats-error"
            className="bf-role-body text-muted-foreground"
            style={{ padding: "8px 4px 0", lineHeight: 1.4 }}
          >
            Stats unavailable: {stats.error.message}
          </p>
        ) : null}
        <div
          style={{
            display: "flex",
            justifyContent: "flex-end",
            paddingTop: "8px",
          }}
        >
          <OpenInPlotButton
            modeId={targetMode}
            testId="volume-inspector-open-in-plot"
            label={fourD ? "Open in Time Series" : "Open in Histogram"}
          />
        </div>
      </div>
    </CollapsibleSection>
  );
};

interface SurfaceDataStatsSectionProps {
  layer: SurfaceDataLayer;
}

const SurfaceDataStatsSection: React.FC<SurfaceDataStatsSectionProps> = ({
  layer,
}) => {
  const dataMin = layer.dataRange?.[0] ?? 0;
  const dataMax = layer.dataRange?.[1] ?? 1;
  const precision = precisionFor(dataMin, dataMax);
  const count = layer.values?.length ?? null;

  return (
    <CollapsibleSection title="Stats" icon={BarChart3} defaultExpanded>
      <div data-testid="surface-data-inspector-stats">
        <PropertyBox>
          <PropertyRow label="N" value={formatCount(count)} mono />
          <PropertyRow
            label="Min"
            value={formatStatNumber(dataMin, precision)}
            mono
          />
          <PropertyRow
            label="Max"
            value={formatStatNumber(dataMax, precision)}
            mono
          />
          <PropertyRow
            label="Mean"
            value={formatStatNumber(layer.mean ?? null, precision)}
            mono
          />
          <PropertyRow
            label="SD"
            value={formatStatNumber(layer.std ?? null, precision)}
            mono
          />
        </PropertyBox>
      </div>
    </CollapsibleSection>
  );
};

const VolumeInspectorSection: React.FC<VolumeInspectorSectionProps> = ({
  layerId,
  fourD,
}) => {
  const layer = useLayerStore((s) => s.layers.find((l) => l.id === layerId)) as
    | LayerInfo
    | undefined;
  const metadata = useLayerStore((s) => s.layerMetadata.get(layerId)) as
    | VolumeMetadata
    | undefined;
  const viewStateLayer = useViewStateStore((s) =>
    s.viewState.layers.find((l) => l.id === layerId),
  );

  const onRenderUpdate = useLayerRenderUpdater(layerId);

  if (!layer) {
    return null;
  }

  const opacity = viewStateLayer?.opacity ?? 1;
  const colormap = viewStateLayer?.colormap ?? "gray";
  const threshold: [number, number] = (viewStateLayer?.threshold as
    | [number, number]
    | undefined) ?? [0, 0];
  const interpolation = (viewStateLayer?.interpolation ?? "linear") as
    | "nearest"
    | "linear";
  const dataMin = metadata?.dataRange?.min ?? 0;
  const dataMax = metadata?.dataRange?.max ?? 100;
  const precision = precisionFor(dataMin, dataMax);
  const isDisabled = !viewStateLayer;
  const intensity: [number, number] = (viewStateLayer?.intensity as
    | [number, number]
    | undefined) ?? [dataMin, dataMax];
  const blendMode = viewStateLayer?.blendMode ?? "alpha";
  const alphaMod = viewStateLayer?.alphaMod;
  const alphaModUnsupported = blendMode === "max" || blendMode === "min";

  return (
    <div
      data-testid="volume-inspector-section"
      data-four-d={fourD ? "true" : "false"}
      style={containerStyle}
    >
      <PropertyBox>
        <PropertyRow
          label="Layer"
          value={layer.name}
          truncate
          maxValueWidth="60%"
        />
        {metadata?.dimensions ? (
          <PropertyRow
            label="Dimensions"
            value={metadata.dimensions.join(" × ")}
            mono
          />
        ) : null}
        {metadata?.spacing ? (
          <PropertyRow
            label="Voxel Size"
            value={`${metadata.spacing.map((s) => s.toFixed(2)).join(" × ")} mm`}
            mono
          />
        ) : null}
        {metadata?.dataRange ? (
          <PropertyRow
            label="Data Range"
            value={`${metadata.dataRange.min.toFixed(precision)} – ${metadata.dataRange.max.toFixed(precision)}`}
            mono
          />
        ) : null}
        {fourD && layer.timeSeriesInfo ? (
          <PropertyRow
            label="Timepoints"
            value={`${layer.timeSeriesInfo.num_timepoints}`}
            mono
          />
        ) : null}
        {fourD && layer.timeSeriesInfo?.tr ? (
          <PropertyRow
            label="TR"
            value={`${layer.timeSeriesInfo.tr}${
              layer.timeSeriesInfo.temporal_unit
                ? ` ${layer.timeSeriesInfo.temporal_unit}`
                : ""
            }`}
            mono
          />
        ) : null}
      </PropertyBox>

      <CollapsibleSection title="Mapping" icon={Palette} defaultExpanded>
        <div className="space-y-3" data-testid="volume-inspector-mapping">
          <EnhancedColormapSelector
            value={colormap}
            onChange={(next) => onRenderUpdate({ colormap: next })}
            disabled={isDisabled}
          />
          <SingleSlider
            label="Opacity"
            min={0}
            max={1}
            value={opacity}
            onChange={(next) => onRenderUpdate({ opacity: next })}
            showPercentage
            disabled={isDisabled}
            layout="strip"
            compact
            highContrast
          />
          <ProSlider
            label="Threshold"
            min={dataMin}
            max={dataMax}
            value={threshold}
            onChange={(value) => onRenderUpdate({ threshold: value })}
            precision={precision}
            disabled={isDisabled}
            layout="strip"
            compact
            highContrast
          />
          <AlphaModulationControl
            value={alphaMod}
            intensity={intensity}
            threshold={threshold}
            onChange={(next) => onRenderUpdate({ alphaMod: next })}
            disabled={isDisabled || alphaModUnsupported}
            disabledReason={
              alphaModUnsupported
                ? "Alpha modulation has no visible effect under Max/Min blend modes"
                : undefined
            }
          />
        </div>
      </CollapsibleSection>

      <CollapsibleSection
        title="Display"
        icon={Settings}
        defaultExpanded={false}
      >
        <div className="space-y-3" data-testid="volume-inspector-display">
          <InterpolationToggle
            value={interpolation}
            onChange={(next) => onRenderUpdate({ interpolation: next })}
            disabled={isDisabled}
          />
        </div>
      </CollapsibleSection>

      <VolumeStatsSection layerId={layerId} fourD={fourD} />
    </div>
  );
};

// ---------------------------------------------------------------------------
// Atlas controls
// ---------------------------------------------------------------------------

interface AtlasInspectorSectionProps {
  layerId: string;
}

const AtlasInspectorSection: React.FC<AtlasInspectorSectionProps> = ({
  layerId,
}) => {
  const layer = useLayerStore((s) => s.layers.find((l) => l.id === layerId)) as
    | LayerInfo
    | undefined;
  const viewStateLayer = useViewStateStore((s) =>
    s.viewState.layers.find((l) => l.id === layerId),
  );
  const onRenderUpdate = useLayerRenderUpdater(layerId);
  const [isPaletteLoading, setIsPaletteLoading] = React.useState(false);

  if (!layer) {
    return null;
  }

  const opacity = viewStateLayer?.opacity ?? 1;
  const atlasMetadata = layer.atlasMetadata;
  const atlasConfig = (viewStateLayer as { atlasConfig?: unknown } | undefined)
    ?.atlasConfig;
  const atlasPaletteKind = (
    viewStateLayer as { atlasPaletteKind?: AtlasPaletteKind } | undefined
  )?.atlasPaletteKind;

  const handlePaletteChange = async (nextKind: AtlasPaletteKind) => {
    if (!atlasConfig) return;
    setIsPaletteLoading(true);
    try {
      await AtlasPaletteService.applyToVolumeLayer(
        layerId,
        atlasConfig as never,
        {
          kind: nextKind,
        },
      );
    } finally {
      setIsPaletteLoading(false);
    }
  };

  return (
    <div data-testid="atlas-inspector-section" style={containerStyle}>
      <PropertyBox>
        <PropertyRow
          label="Layer"
          value={layer.name}
          truncate
          maxValueWidth="60%"
        />
        {atlasMetadata?.id ? (
          <PropertyRow label="Atlas" value={atlasMetadata.id} mono />
        ) : null}
        {atlasMetadata?.space ? (
          <PropertyRow label="Space" value={atlasMetadata.space} mono />
        ) : null}
        {atlasMetadata?.resolution ? (
          <PropertyRow
            label="Resolution"
            value={atlasMetadata.resolution}
            mono
          />
        ) : null}
        {typeof atlasMetadata?.n_regions === "number" ? (
          <PropertyRow
            label="Regions"
            value={`${atlasMetadata.n_regions}`}
            mono
          />
        ) : null}
      </PropertyBox>

      <CollapsibleSection title="Palette" icon={Palette} defaultExpanded>
        <div className="space-y-3" data-testid="atlas-inspector-palette">
          <div className="flex items-center justify-between gap-3">
            <span className="bf-role-section text-muted-foreground">
              Palette
            </span>
            <Select
              value={atlasPaletteKind}
              onValueChange={(v) =>
                void handlePaletteChange(v as AtlasPaletteKind)
              }
              disabled={isPaletteLoading || !atlasConfig}
            >
              <SelectTrigger
                className="h-7 w-[180px] text-role-body"
                data-testid="atlas-inspector-palette-trigger"
              >
                <SelectValue placeholder="Select palette" />
              </SelectTrigger>
              <SelectContent>
                {ATLAS_PALETTE_OPTIONS.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <SingleSlider
            label="Opacity"
            min={0}
            max={1}
            value={opacity}
            onChange={(next) => onRenderUpdate({ opacity: next })}
            showPercentage
            disabled={!viewStateLayer || isPaletteLoading}
            layout="strip"
            compact
            highContrast
          />
        </div>
      </CollapsibleSection>

      {atlasMetadata?.citation ? (
        <CollapsibleSection
          title="Citation"
          icon={Database}
          defaultExpanded={false}
        >
          <p
            data-testid="atlas-inspector-citation"
            className="bf-role-body text-muted-foreground"
            style={{ lineHeight: 1.4 }}
          >
            {atlasMetadata.citation}
          </p>
        </CollapsibleSection>
      ) : null}
    </div>
  );
};

// ---------------------------------------------------------------------------
// Surface controls
// ---------------------------------------------------------------------------

interface SurfaceInspectorSectionProps {
  surfaceId: string;
}

const SurfaceInspectorSection: React.FC<SurfaceInspectorSectionProps> = ({
  surfaceId,
}) => {
  const surface = useSurfaceStore((s) => s.surfaces.get(surfaceId)) as
    | LoadedSurface
    | undefined;

  if (!surface) {
    return null;
  }

  return (
    <div data-testid="surface-inspector-section" style={containerStyle}>
      <PropertyBox>
        <PropertyRow
          label="Surface"
          value={surface.name}
          truncate
          maxValueWidth="60%"
        />
        {surface.metadata.hemisphere ? (
          <PropertyRow
            label="Hemisphere"
            value={surface.metadata.hemisphere}
            mono
          />
        ) : null}
        {surface.metadata.surfaceType ? (
          <PropertyRow label="Type" value={surface.metadata.surfaceType} mono />
        ) : null}
        <PropertyRow
          label="Vertices"
          value={`${surface.metadata.vertexCount}`}
          mono
        />
        <PropertyRow
          label="Faces"
          value={`${surface.metadata.faceCount}`}
          mono
        />
      </PropertyBox>

      <CollapsibleSection title="Geometry" icon={Brain} defaultExpanded>
        <p
          className="bf-role-body text-muted-foreground"
          style={{ lineHeight: 1.4, padding: "0 4px" }}
        >
          Use the Surfaces sidebar to edit lighting, material, and projection
          settings. Surface association states arrive in 5c.
        </p>
      </CollapsibleSection>
    </div>
  );
};

interface SurfaceDataInspectorSectionProps {
  surfaceId: string;
  dataLayerId: string;
}

const SurfaceDataInspectorSection: React.FC<
  SurfaceDataInspectorSectionProps
> = ({ surfaceId, dataLayerId }) => {
  const surface = useSurfaceStore((s) => s.surfaces.get(surfaceId)) as
    | LoadedSurface
    | undefined;
  const layer = useSurfaceStore((s) =>
    s.surfaces.get(surfaceId)?.layers.get(dataLayerId),
  ) as SurfaceDataLayer | undefined;
  const updateLayerProperty = useSurfaceStore((s) => s.updateLayerProperty);

  if (!surface || !layer) {
    return null;
  }

  // AC#4: no intensity-range slider here. Use only the threshold + colormap
  // + opacity primitives. The intensity-range scrubber + histogram live in
  // the Plot pane.
  const dataMin = layer.dataRange?.[0] ?? 0;
  const dataMax = layer.dataRange?.[1] ?? 1;
  const precision = precisionFor(dataMin, dataMax);
  const threshold: [number, number] = Array.isArray(layer.threshold)
    ? [layer.threshold[0], layer.threshold[1]]
    : [dataMin, dataMin];

  return (
    <div data-testid="surface-data-inspector-section" style={containerStyle}>
      <PropertyBox>
        <PropertyRow
          label="Layer"
          value={layer.name}
          truncate
          maxValueWidth="60%"
        />
        <PropertyRow
          label="Surface"
          value={surface.name}
          truncate
          mono
          maxValueWidth="60%"
        />
        <PropertyRow
          label="Data Range"
          value={`${dataMin.toFixed(precision)} – ${dataMax.toFixed(precision)}`}
          mono
        />
      </PropertyBox>

      <CollapsibleSection title="Mapping" icon={Layers} defaultExpanded>
        <div className="space-y-3" data-testid="surface-data-inspector-mapping">
          <EnhancedColormapSelector
            value={layer.colormap}
            onChange={(next) =>
              updateLayerProperty(surfaceId, dataLayerId, "colormap", next)
            }
          />
          <SingleSlider
            label="Opacity"
            min={0}
            max={1}
            value={layer.opacity ?? 1}
            onChange={(next) =>
              updateLayerProperty(surfaceId, dataLayerId, "opacity", next)
            }
            showPercentage
            layout="strip"
            compact
            highContrast
          />
          <ProSlider
            label="Threshold"
            min={dataMin}
            max={dataMax}
            value={threshold}
            onChange={(value) =>
              updateLayerProperty(surfaceId, dataLayerId, "threshold", value)
            }
            precision={precision}
            layout="strip"
            compact
            highContrast
          />
        </div>
      </CollapsibleSection>

      <SurfaceDataStatsSection layer={layer} />
    </div>
  );
};

// ---------------------------------------------------------------------------
// Dispatcher
// ---------------------------------------------------------------------------

export const LayerInspectorContent: React.FC<LayerInspectorContentProps> = ({
  layer,
}) => {
  switch (layer.kind) {
    case "atlas":
      return <AtlasInspectorSection layerId={layer.id} />;
    case "volume-4d":
      return <VolumeInspectorSection layerId={layer.id} fourD />;
    case "volume-3d":
      return <VolumeInspectorSection layerId={layer.id} fourD={false} />;
    case "surface":
      return <SurfaceInspectorSection surfaceId={layer.id} />;
    case "surface-data":
      return (
        <SurfaceDataInspectorSection
          surfaceId={layer.parentId ?? layer.id}
          dataLayerId={layer.id}
        />
      );
    default:
      return null;
  }
};

export default LayerInspectorContent;
