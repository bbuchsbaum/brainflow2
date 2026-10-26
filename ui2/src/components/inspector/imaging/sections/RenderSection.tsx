import { useWorkspaceStore } from "@/stores/workspaceStore";
import { ThresholdText } from "@/components/ui/ThresholdText";
import { AtlasRoiPicker } from "@/components/atlas/AtlasRoiPicker";
import { statisticUnits, statisticVariable } from "@/utils/statistic";
import { DEFAULT_LABEL_OUTLINE, labelDisplayOf, type LabelDisplay } from "@/utils/labelDisplay";
import React, { useEffect, useId, useState } from "react";
import { useLayerStore } from "@/stores/layerStore";
import { useViewStateStore } from "@/stores/viewStateStore";
import { useSurfaceStore } from "@/stores/surfaceStore";
import { ColormapPicker } from "@/components/ui/ColormapPicker";
import {
  isThresholdActive,
  thresholdWording,
} from "@/components/views/viewportFrame/frameFormat";
import { useDisplayOptionsStore } from "@/stores/displayOptionsStore";
import type { SceneItem } from "@/types/sceneItem";
import {
  Button,
  ColorInput,
  FieldRow,
  KeyValue,
  RangeSlider,
  Section,
  SegmentedControl,
  Select,
  Slider as BfSlider,
  Switch,
  SLIDER_THUMB_INSET_PX,
  ValueChip,
  ValueChipError,
} from "@/components/ui/bf";
import { AtlasPaletteService } from "@/services/AtlasPaletteService";
import {
  ATLAS_PALETTE_OPTIONS,
  type AtlasPaletteKind,
} from "@/types/atlasPalette";
import { getEventBus } from "@/events/EventBus";
import { useComparisonStore } from "@/stores/comparisonStore";
import {
  isFieldLinked,
  useCompareEditTarget,
  type CompareEditTarget,
} from "@/utils/compareDisplay";
import type { PanelOverrideField } from "@/types/comparison";

interface RenderSectionProps {
  item: SceneItem;
}

const BLEND_MODES = ["alpha", "additive", "max", "min"] as const;

/**
 * Render section. Per item kind:
 *   - volume-base                 → visible · opacity · intensity · colormap · time
 *   - volume-overlay              → visible · opacity · intensity · threshold · colormap · blend · time
 *   - volume-overlay-atlas        → same as overlay (atlases gate label range too)
 *   - surface-geometry            → visible
 *   - surface-overlay             → visible · opacity · colormap (read-only)
 */
export function RenderSection({ item }: RenderSectionProps) {
  return (
    // keepMounted: a value chip mid-edit survives collapse / expand.
    <Section title="Render" icon={<RenderIcon />} defaultOpen keepMounted>
      {(() => {
        switch (item.kind) {
          case "volume-base":
            return <VolumeRenderRows item={item} kind="base" />;
          case "volume-overlay":
          case "volume-overlay-atlas":
            return <VolumeRenderRows item={item} kind="overlay" />;
          case "surface-geometry":
          case "surface-overlay":
            return <SurfaceRenderRows item={item} />;
          default:
            return null;
        }
      })()}
    </Section>
  );
}

/** Opacity as the old native range stored it: snapped to the 0.01 grid. */
const toPercentStep = (v: number) => Math.round(v * 100) / 100;
const formatPercent = (v: number) => `${Math.round(v * 100)}%`;
const formatPx = (v: number) => `${Math.round(v)} px`;

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

// ── volume rows ──────────────────────────────────────────────────────────────

function VolumeRenderRows({
  item,
  kind,
}: {
  item: SceneItem;
  kind: "base" | "overlay";
}) {
  const layerId = item.ref.type === "volume" ? item.ref.layerId : null;
  const updateLayer = useLayerStore((s) => s.updateLayer);
  const setViewState = useViewStateStore((s) => s.setViewState);
  const layer = useLayerStore((s) =>
    layerId ? (s.layers.find((l) => l.id === layerId) ?? null) : null,
  );
  const metadata = useLayerStore((s) =>
    layerId ? (s.layerMetadata.get(layerId) ?? null) : null,
  );
  const viewLayer = useViewStateStore((s) =>
    layerId ? (s.viewState.layers.find((l) => l.id === layerId) ?? null) : null,
  );
  const [paletteApplying, setPaletteApplying] = useState(false);
  // Linked Compare (P3.9): unlinked, window / threshold / colormap edits go to
  // the active panel (its overrides) unless the scope is "Both".
  const compare = useCompareEditTarget();
  const inComparison = useWorkspaceStore((s) => {
    const ws = s.activeWorkspaceId ? s.getWorkspace(s.activeWorkspaceId) : null;
    return ws?.type === "comparison";
  });
  const showColorbar = useDisplayOptionsStore((s) =>
    layerId ? s.options.get(layerId)?.showColorbar !== false : true,
  );
  // Ruler domain frozen for the duration of a slider interaction (pointer
  // down → up, or keyboard focus → blur): the union of the data range and
  // the window AT INTERACTION START. Recomputing it from the live window
  // would move the scale under the thumb (the low thumb pinned while its
  // value ran) and ratchet the domain inward so Home could not return.
  // The sliders freeze their own ruler too; this copy keeps the OTHER range
  // and the colormap strip on the same frozen ruler.
  const [frozenDomain, setFrozenDomain] = useState<readonly [number, number] | null>(null);
  useEffect(() => setFrozenDomain(null), [layerId]);
  const handleInteraction = React.useCallback(
    (active: boolean, domain: readonly [number, number]) => {
      setFrozenDomain((cur) => (active ? (cur ?? domain) : null));
    },
    [],
  );

  if (!layer || !layerId || !viewLayer) return null;

  const dataRange = metadata?.dataRange ?? null;
  // Threshold wording names the statistic ("|z| ≤ 3.1 hidden").
  const statSymbol = statisticVariable(statisticUnits(layer?.statistic, dataRange));
  const dataMin = dataRange?.min ?? viewLayer.intensity[0];
  const dataMax = dataRange?.max ?? viewLayer.intensity[1];
  // The active panel's own value of a field this link mode leaves per panel.
  const panelOverride =
    compare?.scope === "panel" ? compare.panel.renderOverrides?.[layerId] : undefined;
  const own = <F extends PanelOverrideField>(field: F) =>
    compare && !isFieldLinked(compare.mode, field) ? panelOverride?.[field] : undefined;
  const intensity = own("intensity") ?? viewLayer.intensity;
  const threshold = own("threshold") ?? viewLayer.threshold;
  // One ruler for Intensity, Threshold and the colormap strip: the union of
  // the data range and the window. The thumbs, the strip's gradient span and
  // both hidden-band cut-outs then sit at the same x for the same value; the
  // data range is two marks under each track (see `inspectorRuler`).
  // Stable ruler between interactions: data ∪ current window ∪ the layer's
  // default window (the load-time render props) ∪ the window the Inspector
  // first saw for this layer. Narrowing the window therefore never shrinks
  // the ruler, so Home / End still reach the original window ends (−6 on the
  // overlay fixture) after the window has been narrowed and the thumb blurred.
  const anchors = layerAnchorWindows(layerId, intensity, metadata);
  const ruler = inspectorRuler(
    [dataMin, dataMax],
    intensity,
    threshold,
    frozenDomain,
    anchors,
  );
  const dataTicks: readonly [number, number] | null =
    dataRange && ruler.dataSpan ? [dataRange.min, dataRange.max] : null;
  const opacity = viewLayer.opacity ?? 1;
  const colormap = own("colormap") ?? viewLayer.colormap ?? "";
  const blendMode = viewLayer.blendMode ?? "alpha";
  const layerMode = viewLayer.layerMode ?? "scalar";
  const interpolation = viewLayer.interpolation ?? "linear";
  const outline = viewLayer.outline ?? DEFAULT_OUTLINE;

  const setLayerField = <K extends keyof typeof viewLayer>(
    field: K,
    value: (typeof viewLayer)[K],
  ) => {
    if (compare && isOverrideField(field) && !isFieldLinked(compare.mode, field)) {
      const store = useComparisonStore.getState();
      if (compare.scope === "panel") {
        store.setPanelOverride(
          compare.workspaceId,
          compare.panel.id,
          layerId,
          field,
          value as never,
        );
        return;
      }
      // "Both": the shared value, and no panel keeps its own.
      store.clearPanelOverride(compare.workspaceId, null, layerId, field);
    }
    // Compare with a shared window: two maps of the same statistic kind
    // (two z maps) share one colour range, so panels compare like with like.
    const sharedRangeIds =
      field === "intensity" && inComparison && (!compare || isFieldLinked(compare.mode, "intensity"))
        ? sameStatisticLayerIds(layerId)
        : [];
    setViewState((draft) => {
      const target = draft.layers.find((l) => l.id === layerId);
      if (!target) return;
      (target as unknown as Record<string, unknown>)[field as string] = value as unknown;
      for (const id of sharedRangeIds) {
        const other = draft.layers.find((l) => l.id === id);
        if (other) (other as unknown as Record<string, unknown>).intensity = value as unknown;
      }
    });
  };

  return (
    <>
      <FieldRow label="Visible">
        <Switch
          checked={viewLayer.visible}
          onCheckedChange={(v) => {
            // Visibility is owned by viewState — the renderer reads from
            // `viewStateStore.viewState.layers`. `layerStore.updateLayer`
            // alone writes only to the layer registry and the renderer
            // never sees the change. Mirror the pattern in
            // `LayerApiImpl.setViewLayerVisibility`: flip `visible` and
            // collapse opacity to 0 on hide so the optimized renderer's
            // `visible && opacity > 0` gate honors the toggle. The
            // `updateLayer` call keeps the layer registry in sync for any
            // surface that still reads from there.
            setViewState((draft) => {
              const target = draft.layers.find((l) => l.id === layerId);
              if (!target) return;
              target.visible = v;
              target.opacity = v ? (opacity > 0 ? opacity : 1.0) : 0.0;
            });
            updateLayer(layerId, { visible: v });
          }}
        />
      </FieldRow>

      <FieldRow label="Opacity">
        <BfSlider
          label="Opacity"
          value={opacity}
          min={0}
          max={1}
          step={0.01}
          snap={0.01}
          format={formatPercent}
          valueText={formatPercent}
          showValue
          className="flex-1"
          onValueChange={(v) => setLayerField("opacity", toPercentStep(v))}
        />
      </FieldRow>

      {/* Label volumes are categorical: colours come from the label table,
          so there is no intensity window or threshold to set. */}
      {layerMode !== "label" ? (
      <InspectorRange
        label="Intensity"
        low={intensity[0]}
        high={intensity[1]}
        min={ruler.min}
        max={ruler.max}
        dataRange={dataTicks}
        onInteraction={handleInteraction}
        onChange={(low, high) => setLayerField("intensity", [low, high])}
      />
      ) : null}
      {layerMode !== "label" ? (
        <OverrideMark compare={compare} layerId={layerId} field="intensity" label="Intensity" />
      ) : null}

      {kind === "overlay" && layerMode !== "label" ? (
        <InspectorRange
          label="Threshold"
          mode="hidden"
          symbol={statSymbol}
          low={threshold[0]}
          high={threshold[1]}
          min={ruler.min}
          max={ruler.max}
          dataRange={dataTicks}
          onInteraction={handleInteraction}
          onChange={(low, high) => setLayerField("threshold", [low, high])}
        />
      ) : null}
      {kind === "overlay" && layerMode !== "label" ? (
        <OverrideMark compare={compare} layerId={layerId} field="threshold" label="Threshold" />
      ) : null}

      {/* Label atlases are colored by a discrete per-label palette generated by the
          neuroatlas color engine, so the continuous colormap picker does not apply.
          Expose the palette algorithm instead; changing it re-computes + re-registers
          the categorical colormap on the backend (takes a few seconds). */}
      {layerMode === "label" ? (
        <FieldRow label="Palette">
          {(control) => (
            <>
              <Select
                {...control}
                value={viewLayer.atlasPaletteKind ?? ""}
                disabled={!viewLayer.atlasConfig || paletteApplying}
                onValueChange={(value) => {
                  const kind = value as AtlasPaletteKind;
                  const config = viewLayer.atlasConfig;
                  if (!config) return;
                  setPaletteApplying(true);
                  AtlasPaletteService.applyToVolumeLayer(layerId, config, {
                    kind,
                  })
                    .catch((err) => {
                      getEventBus().emit("ui.notification", {
                        type: "warning",
                        message: `Failed to apply '${kind}' palette. ${
                          err instanceof Error ? err.message : String(err)
                        }`,
                      });
                    })
                    .finally(() => setPaletteApplying(false));
                }}
                className={viewLayer.atlasPaletteKind ? "capitalize" : undefined}
              >
                {viewLayer.atlasPaletteKind ? null : (
                  <option value="" disabled>
                    {/* User label volumes take their colours from the sidecar table (LabelTableService). */}
                    {viewLayer.atlasConfig || viewLayer.colormapId === undefined
                      ? "Discrete (atlas)"
                      : "From label table"}
                  </option>
                )}
                {ATLAS_PALETTE_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </Select>
              {paletteApplying ? (
                <span className="shrink-0 text-bf-2xs text-muted-foreground">
                  applying…
                </span>
              ) : null}
            </>
          )}
        </FieldRow>
      ) : (
        <ColormapBlock
          value={colormap}
          windowSpan={ruler.windowSpan}
          hiddenBand={kind === "overlay" ? ruler.hiddenSpan : null}
          onChange={(next) => setLayerField("colormap", next)}
        />
      )}
      {layerMode !== "label" ? (
        <OverrideMark compare={compare} layerId={layerId} field="colormap" label="Colormap" />
      ) : null}

      {kind === "overlay" && layerMode === "scalar" ? (
        <FieldRow label="Colorbar on view" labelWidth="wide">
          <Switch
            checked={showColorbar}
            onCheckedChange={(v) =>
              useDisplayOptionsStore
                .getState()
                .setOptions(layerId, { showColorbar: v })
            }
          />
        </FieldRow>
      ) : null}

      {kind === "overlay" ? (
        <FieldRow label="Blend mode">
          <Select
            value={blendMode}
            onValueChange={(value) =>
              setLayerField("blendMode", value as typeof blendMode)
            }
            options={BLEND_MODES.map((mode) => ({
              value: mode,
              label: capitalize(mode),
            }))}
          />
        </FieldRow>
      ) : null}

      {/* Texture sampling. Hidden for label/mask layers — categorical data must
          stay nearest (interpolating label ids is meaningless), which the
          backend enforces anyway. Linear smooths lower-res overlays shown over
          a higher-res underlay. (Cubic is not yet implemented in the shader.) */}
      {layerMode === "scalar" ? (
        <FieldRow label="Interpolation">
          {(control) => (
            <SegmentedControl
              id={control.id}
              aria-labelledby={`${control.id}-label`}
              aria-describedby={control["aria-describedby"]}
              disabled={control.disabled}
              value={interpolation}
              onValueChange={(value) =>
                setLayerField(
                  "interpolation",
                  value as typeof interpolation,
                )
              }
              options={[
                { value: "linear", label: "Linear" },
                { value: "nearest", label: "Nearest" },
              ]}
            />
          )}
        </FieldRow>
      ) : null}

      {layerMode === "label" ? (
        <LabelOutlineBlock
          outline={outline}
          display={labelDisplayOf(viewLayer)}
          layerId={layerId}
          onChange={(next) => setLayerField("outline", next)}
          onDisplayChange={(next) => {
            setViewState((draft) => {
              const target = draft.layers.find((l) => l.id === layerId);
              if (!target) return;
              target.labelDisplay = next;
              target.outline = { ...(target.outline ?? DEFAULT_LABEL_OUTLINE), enabled: next !== "fill" };
            });
          }}
        />
      ) : null}

      {layer.volumeType === "TimeSeries4D" && layer.timeSeriesInfo ? (
        <KeyValue
          layout="rows"
          className="py-1"
          items={[
            {
              label: "Time frame",
              value: `${layer.currentTimepoint ?? 0} / ${layer.timeSeriesInfo.num_timepoints}`,
            },
          ]}
        />
      ) : null}
    </>
  );
}

/**
 * Intensity / Threshold: a stacked field row holding the shared RangeSlider
 * (data-range marks under the track, the threshold's hidden band + colorbar
 * caption) with a compact "low to high" readout of editable value chips
 * right-aligned on the label line, above the track.
 *
 * Behaviour carried over from the former RangeBlock:
 * - the value clamp and the ruler are the caller's shared ruler [min, max],
 *   frozen during an interaction (the slider's own freeze plus
 *   `onInteraction` for the other range and the colormap strip);
 * - keyboard steps are span / 200 of that ruler, never snapped (`step="any"`);
 *   Home / End reach the ruler's exact ends; low ≤ high;
 * - a change that leaves both ends as they are writes nothing.
 */
function InspectorRange({
  label,
  low,
  high,
  min,
  max,
  dataRange = null,
  mode = "shown",
  symbol = "value",
  onInteraction,
  onChange,
}: {
  label: string;
  low: number;
  high: number;
  min: number;
  max: number;
  dataRange?: readonly [number, number] | null;
  mode?: "shown" | "hidden";
  /** Variable named in the hidden-band wording ("z", default "value"). */
  symbol?: string;
  onInteraction?: (active: boolean, domain: readonly [number, number]) => void;
  onChange: (low: number, high: number) => void;
}) {
  const wording = mode === "hidden" ? thresholdWording([low, high], symbol) : null;
  // An invalid chip draft reports here; its message renders in flow UNDER
  // the slider (never floated over the track and thumbs).
  const [invalidEnds, setInvalidEnds] = useState<{ low: boolean; high: boolean }>({
    low: false,
    high: false,
  });
  const chipErrorId = `${useId().replace(/:/g, "")}-chip-error`;
  const commit = (nextLow: number, nextHigh: number) => {
    if (Object.is(nextLow, low) && Object.is(nextHigh, high)) return;
    onChange(nextLow, nextHigh);
  };
  // Compact readout on the label line, right-aligned: "33.51 to 249.35",
  // both ends editable chips (clamped to the ruler, low ≤ high). Kept off the
  // track ends so the numbers never read as the ruler's domain.
  const readout = (
    <span
      dir="ltr"
      data-testid="range-readout"
      className="flex items-baseline gap-1 [unicode-bidi:isolate]"
    >
      <ValueChip
        value={low}
        label={`${label} low`}
        min={min}
        max={max}
        align="end"
        errorId={chipErrorId}
        onInvalidChange={(bad) =>
          setInvalidEnds((prev) => (prev.low === bad ? prev : { ...prev, low: bad }))
        }
        onCommit={(v) => commit(Math.min(v, high), high)}
      />
      <span aria-hidden className="font-sans">to</span>
      <ValueChip
        value={high}
        label={`${label} high`}
        min={min}
        max={max}
        align="end"
        errorId={chipErrorId}
        onInvalidChange={(bad) =>
          setInvalidEnds((prev) => (prev.high === bad ? prev : { ...prev, high: bad }))
        }
        onCommit={(v) => commit(low, Math.max(v, low))}
      />
    </span>
  );
  return (
    <div>
    <FieldRow label={label} layout="stacked" meta={readout}>
      <RangeSlider
        label={label}
        value={[low, high]}
        min={min}
        max={max}
        mode={mode}
        // Same rule as the colorbar: [0, 0] / [0, 100] hide nothing (no hatch).
        hiddenActive={mode === "hidden" ? isThresholdActive([low, high]) : undefined}
        dataRange={dataRange}
        className="flex-1"
        caption={
          wording ? (
            <span
              data-testid="threshold-caption"
              className="block text-right"
            >
              <ThresholdText line={wording} variable={symbol ?? 'value'} />
            </span>
          ) : undefined
        }
        onInteraction={onInteraction}
        onValueChange={([nextLow, nextHigh]) => commit(nextLow, nextHigh)}
      />
    </FieldRow>
    <ValueChipError id={chipErrorId} show={invalidEnds.low || invalidEnds.high} />
    </div>
  );
}

const DEFAULT_OUTLINE = DEFAULT_LABEL_OUTLINE;

function rgbaToHex(rgba: [number, number, number, number]): string {
  const toHex = (value: number) =>
    Math.round(Math.max(0, Math.min(1, value)) * 255)
      .toString(16)
      .padStart(2, "0");
  return `#${toHex(rgba[0])}${toHex(rgba[1])}${toHex(rgba[2])}`;
}

function hexToRgbaTuple(
  hex: string,
  alpha: number,
): [number, number, number, number] {
  const clean = hex.replace("#", "");
  return [
    Number.parseInt(clean.slice(0, 2), 16) / 255,
    Number.parseInt(clean.slice(2, 4), 16) / 255,
    Number.parseInt(clean.slice(4, 6), 16) / 255,
    alpha,
  ];
}

const LABEL_DISPLAY_OPTIONS = [
  { value: "fill", label: "Fill", title: "Regions filled with their table colours" },
  { value: "outline", label: "Outline", title: "Region boundaries only" },
  { value: "both", label: "Both", title: "Filled regions with boundaries" },
] as const;

/**
 * Label-layer display: Fill / Outline / Both (utils/labelDisplay.ts), the
 * catalogue ROI search, and the outline's thickness and colour while an
 * outline is drawn. Regions are picked from the Regions legend.
 */
function LabelOutlineBlock({
  outline,
  display,
  layerId,
  onChange,
  onDisplayChange,
}: {
  outline: typeof DEFAULT_OUTLINE;
  display: LabelDisplay;
  layerId: string;
  onChange: (next: typeof DEFAULT_OUTLINE) => void;
  onDisplayChange: (next: LabelDisplay) => void;
}) {
  // ROI search (get_atlas_roi_locations) needs a catalogue atlas's parcel
  // dictionary; a user-loaded label volume (label-table sidecar) has none.
  // Same catalogue rule as ParcelValuesSection.
  const isCatalogueLayer = useLayerStore((s) => {
    const layer = s.layers.find((l) => l.id === layerId);
    return !!layer && (layer.source === "atlas" || !!layer.atlasMetadata);
  });
  const hasAtlasConfig = useViewStateStore(
    (s) => !!s.viewState.layers.find((l) => l.id === layerId)?.atlasConfig,
  );
  const isCatalogueAtlas = isCatalogueLayer || hasAtlasConfig;

  const update = (patch: Partial<typeof DEFAULT_OUTLINE>) => {
    onChange({
      ...outline,
      ...patch,
      color: patch.color ?? outline.color,
    });
  };

  return (
    <>
      <FieldRow label="Display">
        {(control) => (
          <SegmentedControl
            id={control.id}
            // A full name: "Display" alone does not say what is displayed.
            aria-label="Label display"
            value={display}
            onValueChange={(value) => onDisplayChange(value as LabelDisplay)}
            options={LABEL_DISPLAY_OPTIONS}
          />
        )}
      </FieldRow>

      {isCatalogueAtlas ? (
        <AtlasRoiPicker
          key={layerId}
          layerId={layerId}
          selectedId={outline.selectedLabelId}
          onSelect={(id) => update({ selectedLabelId: id })}
        />
      ) : null}

      {display !== "fill" ? (
        <>
          <FieldRow label="Thickness">
            <BfSlider
              label="Outline thickness"
              value={outline.thicknessPx}
              min={1}
              max={8}
              step={1}
              snap={1}
              format={formatPx}
              valueText={formatPx}
              showValue
              className="flex-1"
              onValueChange={(v) => update({ thicknessPx: Math.round(v) })}
            />
          </FieldRow>

          <FieldRow label="Outline color" controlId={`label-outline-color-${layerId}`}>
            {({ id }) => (
              <ColorInput
                id={id}
                showValue
                value={rgbaToHex(outline.color)}
                onValueChange={(v) => update({ color: hexToRgbaTuple(v, outline.color[3]) })}
                aria-label="Outline color"
              />
            )}
          </FieldRow>
        </>
      ) : null}
    </>
  );
}

// ── surface rows ─────────────────────────────────────────────────────────────

function SurfaceRenderRows({ item }: { item: SceneItem }) {
  const surfaces = useSurfaceStore((s) => s.surfaces);
  const setSurfaceVisibility = useSurfaceStore((s) => s.setSurfaceVisibility);

  if (item.ref.type === "surface-geometry") {
    const surface = surfaces.get(item.ref.surfaceId);
    if (!surface) return null;
    return (
      <FieldRow label="Visible">
        <Switch
          checked={surface.visible}
          onCheckedChange={(v) => setSurfaceVisibility?.(surface.handle, v)}
        />
      </FieldRow>
    );
  }

  if (item.ref.type === "surface-overlay") {
    const surface = surfaces.get(item.ref.surfaceId);
    const layer = surface?.layers.get(item.ref.surfaceLayerId);
    if (!surface || !layer) return null;
    const { surfaceId, surfaceLayerId } = item.ref;
    const update = (key: string, value: unknown) =>
      useSurfaceStore.getState().updateLayerProperty(surfaceId, surfaceLayerId, key, value);
    if (layer.parcelOverlay)
      return (
        <>
          <FieldRow label="Visible">
            <Switch checked={layer.visible !== false} onCheckedChange={(v) => update('visible', v)} />
          </FieldRow>
          <FieldRow label="Opacity">
            <BfSlider
              label="Opacity"
              value={layer.opacity}
              min={0}
              max={1}
              step={0.01}
              snap={0.01}
              format={formatPercent}
              valueText={formatPercent}
              showValue
              className="flex-1"
              onValueChange={(v) => update('opacity', toPercentStep(v))}
            />
          </FieldRow>
          <InspectorRange
            label="Intensity"
            low={layer.range[0]}
            high={layer.range[1]}
            min={Math.min(layer.dataRange[0], layer.range[0])}
            max={Math.max(layer.dataRange[1], layer.range[1])}
            onChange={(low, high) => update('range', [low, high])}
          />
          <ColormapBlock value={layer.colormap} onChange={(v) => update('colormap', v)} />
          <InspectorRange
            label="Threshold"
            low={layer.threshold?.[0] ?? 0}
            high={layer.threshold?.[1] ?? 0}
            min={Math.min(0, layer.dataRange[0])}
            max={Math.max(0, layer.dataRange[1])}
            onChange={(low, high) => update('threshold', [low, high])}
          />
          <Button variant="link" className="min-h-6" size="sm" onClick={() => update('threshold', [0, 0])}>
            Clear threshold
          </Button>
        </>
      );
    return (
      <KeyValue
        layout="rows"
        className="py-1"
        items={[
          { label: "Visible", value: layer.visible === false ? "hidden" : "visible", mono: false },
          { label: "Opacity", value: `${Math.round((layer.opacity ?? 1) * 100)}%` },
          { label: "Colormap", value: layer.colormap, mono: false },
        ]}
      />
    );
  }

  return null;
}

// ── linked compare ───────────────────────────────────────────────────────────

/** Other loaded layers with the same statistic kind (z with z, t with t). */
function sameStatisticLayerIds(layerId: string): string[] {
  const layers = useLayerStore.getState().layers;
  const kind = layers.find((l) => l.id === layerId)?.statistic?.kind;
  if (!kind || kind === "none" || kind === "label" || kind === "data") return [];
  return layers.filter((l) => l.id !== layerId && l.statistic?.kind === kind).map((l) => l.id);
}

const OVERRIDE_FIELDS = new Set<string>(["intensity", "threshold", "colormap"]);

function isOverrideField(field: string | number | symbol): field is PanelOverrideField {
  return typeof field === "string" && OVERRIDE_FIELDS.has(field);
}

/**
 * "A only" under a row whose value the active Compare panel sets for itself
 * (unlinked display, P3.9). Removing the tag resets the panel to the shared
 * value.
 */
function OverrideMark({
  compare,
  layerId,
  field,
  label,
}: {
  compare: CompareEditTarget | null;
  layerId: string;
  field: PanelOverrideField;
  label: string;
}) {
  if (!compare || compare.scope !== "panel" || isFieldLinked(compare.mode, field)) return null;
  if (compare.panel.renderOverrides?.[layerId]?.[field] === undefined) return null;
  // A neutral left edge marks the overridden row (amber stays for focus and
  // selection), with the way back to the shared value.
  return (
    <div
      className="-mt-0.5 mb-1 ml-1 flex items-center justify-between gap-2 border-l-2 border-bf-border-strong pl-2 text-bf-2xs text-bf-text-muted"
      data-testid={`override-${field}`}
    >
      <span title={`${label} is set for panel ${compare.letter} only; the other panels keep the shared value`}>
        Panel {compare.letter} only
      </span>
      <Button
        variant="link"
        size="sm"
        className="min-h-6"
        onClick={() => {
          useComparisonStore
            .getState()
            .clearPanelOverride(compare.workspaceId, compare.panel.id, layerId, field);
          // The button goes away: focus the field it reset, not <body>.
          requestAnimationFrame(() =>
            document
              .querySelector<HTMLElement>(`[aria-label^="${label}"]`)
              ?.focus(),
          );
        }}
        aria-label={`Reset ${label.toLowerCase()} of panel ${compare.letter} to the shared value`}
      >
        Reset to shared
      </Button>
    </div>
  );
}

// ── colormap ────────────────────────────────────────────────────────────────

/**
 * The enhanced ColormapPicker variant renders its own "COLORMAP <name>" label
 * row above a thin gradient button — fits the inspector's typography exactly.
 * Let the picker own the whole row so the chrome doesn't collide.
 */
function ColormapBlock({
  value,
  onChange,
  hiddenBand: band = null,
  windowSpan = null,
}: {
  windowSpan?: readonly [number, number] | null;
  value: string;
  onChange: (next: string) => void;
  hiddenBand?: readonly [number, number] | null;
}) {
  // The strip's gradient spans its padding box (inside a 1px border). Inset
  // the border box so that box lands on the sliders' ruler box, which is
  // inset by SLIDER_THUMB_INSET_PX: one value, one x on all three.
  // Forced colors: the strip is data colour, so its trigger (the only button
  // here; the picker's list portals out) opts out of colour forcing, or the
  // gradient is dropped and the strip renders as an empty box.
  return (
    <div
      className="py-1 [&>div]:!mb-0 [&_button]:[forced-color-adjust:none]"
      style={{
        paddingLeft: SLIDER_THUMB_INSET_PX - 1,
        paddingRight: SLIDER_THUMB_INSET_PX - 1,
      }}
    >
      <ColormapPicker
        value={value}
        onChange={onChange}
        variant="enhanced"
        hiddenBand={band}
        windowSpan={windowSpan}
      />
    </div>
  );
}

// ── shared ruler ────────────────────────────────────────────────────────────

export interface InspectorRuler {
  min: number;
  max: number;
  /** Data range as fractions of the ruler. */
  dataSpan: [number, number] | null;
  /** Intensity window as fractions of the ruler (the strip's gradient span). */
  windowSpan: [number, number] | null;
  /** Threshold-hidden interval as fractions of the ruler (clipped), or null. */
  hiddenSpan: [number, number] | null;
}

/**
 * One value→x mapping for the Inspector's Intensity track, Threshold track and
 * colormap strip: [min(data, window), max(data, window)]. Values beyond the
 * window draw in the end colours, so the strip shows its gradient over the
 * window and the clamped end colours outside it.
 */
export function inspectorRuler(
  data: readonly [number, number],
  window: readonly [number, number],
  threshold: readonly [number, number] | null | undefined,
  /** Domain frozen for an ongoing interaction; the ruler never shrinks inside it. */
  frozen?: readonly [number, number] | null,
  /**
   * Further windows the ruler must always contain (the layer's default window
   * and the window at first selection), so the domain is stable between
   * interactions and the original window ends stay reachable.
   */
  anchors?: ReadonlyArray<readonly [number, number] | null | undefined>,
): InspectorRuler {
  const finite = [
    data[0],
    data[1],
    window[0],
    window[1],
    ...(frozen ? [frozen[0], frozen[1]] : []),
    ...(anchors ?? []).flatMap((a) => (a ? [a[0], a[1]] : [])),
  ].filter(Number.isFinite);
  const min = finite.length ? Math.min(...finite) : 0;
  const max = finite.length ? Math.max(...finite) : 1;
  const span = max - min;
  const frac = (v: number) => (span > 0 ? Math.max(0, Math.min(1, (v - min) / span)) : 0);
  const pair = (a: number, b: number): [number, number] | null =>
    Number.isFinite(a) && Number.isFinite(b) ? [frac(Math.min(a, b)), frac(Math.max(a, b))] : null;
  const hidden = isThresholdActive(threshold) ? pair(threshold![0], threshold![1]) : null;
  return {
    min,
    max,
    dataSpan: span > 0 ? pair(data[0], data[1]) : null,
    windowSpan: span > 0 ? pair(window[0], window[1]) : null,
    hiddenSpan: hidden && hidden[1] > hidden[0] ? hidden : null,
  };
}

/**
 * Window the Inspector first saw per layer id (module scope: survives the
 * Inspector remounting and switching between layers; ids are never reused).
 */
const firstSeenWindows = new Map<string, readonly [number, number]>();

/** Anchor windows for {@link inspectorRuler}: default (load-time) and first-seen. */
function layerAnchorWindows(
  layerId: string,
  current: readonly [number, number],
  metadata: { renderProps?: { intensity?: readonly [number, number] } } | null,
): Array<readonly [number, number]> {
  let first = firstSeenWindows.get(layerId);
  if (!first && Number.isFinite(current[0]) && Number.isFinite(current[1])) {
    first = [current[0], current[1]];
    firstSeenWindows.set(layerId, first);
  }
  const out: Array<readonly [number, number]> = [];
  const def = metadata?.renderProps?.intensity;
  if (def && def.length === 2) out.push(def);
  if (first) out.push(first);
  return out;
}

function RenderIcon() {
  return (
    <svg
      viewBox="0 0 16 16"
      className="h-3.5 w-3.5"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      aria-hidden
    >
      <circle cx="8" cy="8" r="5" />
      <path d="M8 3v10M3 8h10" />
    </svg>
  );
}
