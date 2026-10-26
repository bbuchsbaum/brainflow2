import { AtlasRoiPicker } from "@/components/atlas/AtlasRoiPicker";
import React, { useEffect, useRef, useState } from "react";
import { useLayerStore } from "@/stores/layerStore";
import { useViewStateStore } from "@/stores/viewStateStore";
import { useSurfaceStore } from "@/stores/surfaceStore";
import { ColormapPicker } from "@/components/ui/ColormapPicker";
import { formatLayerValue, formatLayerValueAscii } from "@/utils/valueFormat";
import { asciiCopyHandler, parseNumericText } from "@/utils/numericInput";
import {
  HIDDEN_BAND_BACKGROUND,
  isThresholdActive,
  thresholdWording,
} from "@/components/views/viewportFrame/frameFormat";
import { useDisplayOptionsStore } from "@/stores/displayOptionsStore";
import type { SceneItem } from "@/types/sceneItem";
import { InspectorSection, FieldRow } from "../InspectorSection";
import { sampleLayerAtWorld } from "@/services/SamplingService";
import { AtlasPaletteService } from "@/services/AtlasPaletteService";
import {
  ATLAS_PALETTE_OPTIONS,
  type AtlasPaletteKind,
} from "@/types/atlasPalette";
import { getEventBus } from "@/events/EventBus";

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
    <InspectorSection label="Render" icon={<RenderIcon />} defaultOpen>
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
    </InspectorSection>
  );
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
  const crosshairWorld = useViewStateStore(
    (s) => s.viewState.crosshair.world_mm,
  );
  const [paletteApplying, setPaletteApplying] = useState(false);
  const showColorbar = useDisplayOptionsStore((s) =>
    layerId ? s.options.get(layerId)?.showColorbar !== false : true,
  );
  // Ruler domain frozen for the duration of a slider interaction (pointer
  // down → up, or keyboard focus → blur): the union of the data range and
  // the window AT INTERACTION START. Recomputing it from the live window
  // would move the scale under the thumb (the low thumb pinned while its
  // value ran) and ratchet the domain inward so Home could not return.
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
  const dataMin = dataRange?.min ?? viewLayer.intensity[0];
  const dataMax = dataRange?.max ?? viewLayer.intensity[1];
  const intensity = viewLayer.intensity;
  const threshold = viewLayer.threshold;
  // One ruler for Intensity, Threshold and the colormap strip: the union of
  // the data range and the window. The thumbs, the strip's gradient span and
  // both hidden-band cut-outs then sit at the same x for the same value; the
  // data range is a faint band on the tracks (see `inspectorRuler`).
  const liveRuler = inspectorRuler([dataMin, dataMax], intensity, threshold);
  const ruler = frozenDomain
    ? inspectorRuler([dataMin, dataMax], intensity, threshold, frozenDomain)
    : liveRuler;
  const opacity = viewLayer.opacity ?? 1;
  const colormap = viewLayer.colormap ?? "";
  const blendMode = viewLayer.blendMode ?? "alpha";
  const layerMode = viewLayer.layerMode ?? "scalar";
  const interpolation = viewLayer.interpolation ?? "linear";
  const outline = viewLayer.outline ?? DEFAULT_OUTLINE;

  const setLayerField = <K extends keyof typeof viewLayer>(
    field: K,
    value: (typeof viewLayer)[K],
  ) => {
    setViewState((draft) => {
      const target = draft.layers.find((l) => l.id === layerId);
      if (!target) return;
      (target as unknown as Record<string, unknown>)[field as string] = value as unknown;
    });
  };

  return (
    <>
      <FieldRow label="Visible">
        <Toggle
          label="Visible"
          checked={viewLayer.visible}
          onChange={(v) => {
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
        <Slider
          label="Opacity"
          valueText={`${Math.round(opacity * 100)}%`}
          value={opacity}
          min={0}
          max={1}
          step={0.01}
          onChange={(v) => setLayerField("opacity", v)}
        />
        <Pct value={opacity} />
      </FieldRow>

      <RangeBlock
        label="Intensity"
        low={intensity[0]}
        high={intensity[1]}
        dataMin={ruler.min}
        dataMax={ruler.max}
        dataSpan={ruler.dataSpan}
        onInteraction={handleInteraction}
        onChange={(low, high) => setLayerField("intensity", [low, high])}
      />

      {kind === "overlay" ? (
        <RangeBlock
          label="Threshold"
          mode="hidden"
          low={threshold[0]}
          high={threshold[1]}
          dataMin={ruler.min}
          dataMax={ruler.max}
          dataSpan={ruler.dataSpan}
          onInteraction={handleInteraction}
          onChange={(low, high) => setLayerField("threshold", [low, high])}
        />
      ) : null}

      {/* Label atlases are colored by a discrete per-label palette generated by the
          neuroatlas color engine, so the continuous colormap picker does not apply.
          Expose the palette algorithm instead; changing it re-computes + re-registers
          the categorical colormap on the backend (takes a few seconds). */}
      {layerMode === "label" ? (
        <FieldRow label="Palette">
          <div className="flex items-center gap-2">
            <select
              aria-label="Palette"
              value={viewLayer.atlasPaletteKind ?? ""}
              disabled={!viewLayer.atlasConfig || paletteApplying}
              onChange={(e) => {
                const kind = e.target.value as AtlasPaletteKind;
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
              className="bf-select text-bf-xs capitalize"
            >
              {viewLayer.atlasPaletteKind ? null : (
                <option value="" disabled>
                  Discrete (atlas)
                </option>
              )}
              {ATLAS_PALETTE_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
            {paletteApplying ? (
              <span className="text-bf-2xs text-muted-foreground">
                applying…
              </span>
            ) : null}
          </div>
        </FieldRow>
      ) : (
        <ColormapBlock
          value={colormap}
          windowSpan={ruler.windowSpan}
          hiddenBand={kind === "overlay" ? ruler.hiddenSpan : null}
          onChange={(next) => setLayerField("colormap", next)}
        />
      )}

      {kind === "overlay" && layerMode === "scalar" ? (
        <FieldRow label="Colorbar on view">
          <Toggle
            label="Colorbar on view"
            checked={showColorbar}
            onChange={(v) =>
              useDisplayOptionsStore
                .getState()
                .setOptions(layerId, { showColorbar: v })
            }
          />
        </FieldRow>
      ) : null}

      {kind === "overlay" ? (
        <FieldRow label="Blend mode">
          <select
            aria-label="Blend mode"
            value={blendMode}
            onChange={(e) =>
              setLayerField("blendMode", e.target.value as typeof blendMode)
            }
            className="bf-select text-bf-xs capitalize"
          >
            {BLEND_MODES.map((mode) => (
              <option key={mode} value={mode}>
                {mode}
              </option>
            ))}
          </select>
        </FieldRow>
      ) : null}

      {/* Texture sampling. Hidden for label/mask layers — categorical data must
          stay nearest (interpolating label ids is meaningless), which the
          backend enforces anyway. Linear smooths lower-res overlays shown over
          a higher-res underlay. (Cubic is not yet implemented in the shader.) */}
      {layerMode === "scalar" ? (
        <FieldRow label="Interpolation">
          <select
            aria-label="Interpolation"
            value={interpolation}
            onChange={(e) =>
              setLayerField(
                "interpolation",
                e.target.value as typeof interpolation,
              )
            }
            className="bf-select text-bf-xs capitalize"
          >
            <option value="linear">Linear</option>
            <option value="nearest">Nearest</option>
          </select>
        </FieldRow>
      ) : null}

      {layerMode === "label" ? (
        <LabelOutlineBlock
          outline={outline}
          layerId={layerId}
          crosshairWorld={crosshairWorld}
          onChange={(next) => setLayerField("outline", next)}
        />
      ) : null}

      {layer.volumeType === "TimeSeries4D" && layer.timeSeriesInfo ? (
        <FieldRow label="Time frame">
          <span
            className="font-mono text-bf-sm tabular-nums text-foreground"
            style={{ fontVariantNumeric: "tabular-nums" }}
          >
            {layer.currentTimepoint ?? 0} /{" "}
            {layer.timeSeriesInfo.num_timepoints}
          </span>
        </FieldRow>
      ) : null}
    </>
  );
}

const DEFAULT_OUTLINE = {
  enabled: false,
  selectedLabelId: 0,
  color: [1, 1, 0, 1] as [number, number, number, number],
  thicknessPx: 1,
};

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

function LabelOutlineBlock({
  outline,
  layerId,
  crosshairWorld,
  onChange,
}: {
  outline: typeof DEFAULT_OUTLINE;
  layerId: string;
  crosshairWorld: [number, number, number];
  onChange: (next: typeof DEFAULT_OUTLINE) => void;
}) {
  const [sampling, setSampling] = useState(false);

  const update = (patch: Partial<typeof DEFAULT_OUTLINE>) => {
    onChange({
      ...outline,
      ...patch,
      color: patch.color ?? outline.color,
    });
  };

  const useCrosshairLabel = async () => {
    if (sampling) return;
    setSampling(true);
    try {
      const result = await sampleLayerAtWorld({
        layerId,
        world: crosshairWorld,
      });
      if (result.value !== null) {
        update({
          selectedLabelId: Math.max(0, Math.round(result.value)),
          enabled: true,
        });
      }
    } finally {
      setSampling(false);
    }
  };

  return (
    <>
      <FieldRow label="Outline">
        <Toggle
          label="Outline"
          checked={outline.enabled}
          onChange={(enabled) => update({ enabled })}
        />
      </FieldRow>

      <AtlasRoiPicker
        key={layerId}
        layerId={layerId}
        selectedId={outline.selectedLabelId}
        onSelect={(id) => update({ selectedLabelId: id, enabled: id !== 0 })}
      />
      <FieldRow label="Pick from view">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={useCrosshairLabel}
            disabled={sampling}
            className="rounded-sm border border-border px-2 py-0.5 text-bf-xs text-foreground transition-colors hover:bg-accent/40 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {sampling ? 'Sampling…' : 'Use crosshair ROI'}
          </button>
        </div>
      </FieldRow>

      <FieldRow label="Thickness">
        <Slider
          label="Outline thickness"
          valueText={`${Math.round(outline.thicknessPx)} px`}
          value={outline.thicknessPx}
          min={1}
          max={8}
          step={1}
          onChange={(thicknessPx) => update({ thicknessPx })}
        />
        <span className="font-mono text-bf-xs tabular-nums text-muted-foreground">
          {Math.round(outline.thicknessPx)} px
        </span>
      </FieldRow>

      <FieldRow label="Color">
        <input
          type="color"
          value={rgbaToHex(outline.color)}
          onChange={(e) =>
            update({ color: hexToRgbaTuple(e.target.value, outline.color[3]) })
          }
          className="h-5 w-8 cursor-pointer rounded-sm border border-border bg-transparent p-0"
          aria-label="Outline color"
        />
      </FieldRow>
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
        <Toggle
          label="Visible"
          checked={surface.visible}
          onChange={(v) => setSurfaceVisibility?.(surface.handle, v)}
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
            <Toggle label="Visible" checked={layer.visible !== false} onChange={(v) => update('visible', v)} />
          </FieldRow>
          <FieldRow label="Opacity">
            <Slider
              label="Opacity"
              valueText={`${Math.round(layer.opacity * 100)}%`}
              value={layer.opacity}
              min={0}
              max={1}
              step={0.01}
              onChange={(v) => update('opacity', v)}
            />
            <Pct value={layer.opacity} />
          </FieldRow>
          <RangeBlock
            label="Intensity"
            low={layer.range[0]}
            high={layer.range[1]}
            dataMin={Math.min(layer.dataRange[0], layer.range[0])}
            dataMax={Math.max(layer.dataRange[1], layer.range[1])}
            onChange={(low, high) => update('range', [low, high])}
          />
          <ColormapBlock value={layer.colormap} onChange={(v) => update('colormap', v)} />
          <RangeBlock
            label="Threshold"
            low={layer.threshold?.[0] ?? 0}
            high={layer.threshold?.[1] ?? 0}
            dataMin={Math.min(0, layer.dataRange[0])}
            dataMax={Math.max(0, layer.dataRange[1])}
            onChange={(low, high) => update('threshold', [low, high])}
          />
          <button type="button" className="text-bf-xs text-foreground underline underline-offset-2 decoration-[var(--bf-border-strong)] hover:decoration-current focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background" onClick={() => update('threshold', [0, 0])}>
            Clear threshold
          </button>
        </>
      );
    return (
      <>
        <FieldRow label="Visible">
          <span className="text-bf-sm text-muted-foreground">
            {layer.visible === false ? "hidden" : "visible"}
          </span>
        </FieldRow>
        <FieldRow label="Opacity">
          <span
            className="font-mono text-bf-sm tabular-nums text-foreground"
            style={{ fontVariantNumeric: "tabular-nums" }}
          >
            {Math.round((layer.opacity ?? 1) * 100)}%
          </span>
        </FieldRow>
        <FieldRow label="Colormap">
          <span className="text-bf-sm text-foreground">{layer.colormap}</span>
        </FieldRow>
      </>
    );
  }

  return null;
}

// ── controls ────────────────────────────────────────────────────────────────

function Toggle({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-4 w-7 items-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background ${
        checked ? "bg-primary" : "bg-border"
      }`}
    >
      <span
        aria-hidden
        className={`inline-block h-3 w-3 transform rounded-full bg-background transition-transform ${
          checked ? "translate-x-3.5" : "translate-x-0.5"
        }`}
      />
    </button>
  );
}

function Slider({
  value,
  min,
  max,
  step,
  onChange,
  label,
  valueText,
}: {
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
  label: string;
  valueText?: string;
}) {
  return (
    <input
      type="range"
      aria-label={label}
      aria-valuetext={valueText}
      value={value}
      min={min}
      max={max}
      step={step}
      onChange={(e) => onChange(Number.parseFloat(e.target.value))}
      className={`h-1 w-28 cursor-pointer appearance-none rounded-full bg-border accent-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring`}
    />
  );
}

function Pct({ value }: { value: number }) {
  return (
    <span
      className="font-mono text-bf-xs tabular-nums text-muted-foreground"
      style={{ fontVariantNumeric: "tabular-nums" }}
    >
      {Math.round(value * 100)}%
    </span>
  );
}

// ── range block (Intensity / Threshold) ─────────────────────────────────────

/**
 * Compact dual-range editor.
 *
 *   Intensity                       [0.00] – [600.00]   ← click chip → input
 *               ●━━━━━━━━━━━━━━━━━━━━━━━━━●            ← visible track + circle thumbs
 *
 * - Header row: label on the left, two click-to-edit value chips on the right
 *   joined by an em-dash. Click a chip → text becomes a focused number input;
 *   Enter/blur commits (clamped to low ≤ high and within [dataMin, dataMax]),
 *   Escape reverts.
 * - Slider row: shared visible track in `hsl(var(--border)/0.7)` with an
 *   active band tinted with the accent between handles. Two stacked native range inputs
 *   styled as small filled circles via Tailwind arbitrary thumb selectors.
 *   Data-min / data-max anchors deliberately omitted — they're already shown
 *   in the Data section as `Range: <min> — <max>`.
 */
function RangeBlock({
  label,
  low,
  high,
  dataMin,
  dataMax,
  dataSpan = null,
  onChange,
  mode = "shown",
  onInteraction,
}: {
  /**
   * Slider interaction start (true) / end (false), with the track's domain at
   * that moment, to freeze a shared ruler.
   */
  onInteraction?: (active: boolean, domain: readonly [number, number]) => void;
  /** Data range as fractions of the track, drawn as a faint band. */
  dataSpan?: readonly [number, number] | null;
  label: string;
  /**
   * "shown": the range between the handles is what is displayed (Intensity),
   * filled. "hidden": the range is what the threshold hides (lo ≤ v ≤ hi,
   * inclusive), drawn as the colorbar's hatched cut-out and captioned with
   * the colorbar's wording ("|value| ≤ 2.3 hidden").
   */
  mode?: "shown" | "hidden";
  low: number;
  high: number;
  dataMin: number;
  dataMax: number;
  onChange: (low: number, high: number) => void;
}) {
  const span = dataMax - dataMin;
  const step = span > 0 ? span / 200 : 0.01;
  const clamp = (n: number) => Math.min(Math.max(n, dataMin), dataMax);
  const handleLow = (next: number) => {
    const c = Math.min(clamp(next), high);
    if (c !== low) onChange(c, high);
  };
  const handleHigh = (next: number) => {
    const c = Math.max(clamp(next), low);
    if (c !== high) onChange(low, c);
  };
  const caption = mode === "hidden" ? thresholdWording([low, high]) : null;

  return (
    <div className="py-1.5 text-bf-sm">
      <div className="flex items-center justify-between gap-3">
        <span className="text-muted-foreground">{label}</span>
        <span className="flex items-center gap-1.5" onCopy={asciiCopyHandler}>
          <EditableNumber value={low} onCommit={handleLow} label={`${label} low`} />
          {/* "to", not a dash: between two U+2212 numbers a dash reads as subtraction. */}
          <span className="text-bf-xs text-muted-foreground">to</span>
          <EditableNumber value={high} onCommit={handleHigh} label={`${label} high`} />
        </span>
      </div>
      <DualRangeTrack
        label={label}
        low={low}
        high={high}
        dataMin={dataMin}
        dataMax={dataMax}
        step={step}
        onLow={handleLow}
        onHigh={handleHigh}
        mode={mode}
        dataSpan={dataSpan}
        onInteraction={onInteraction}
      />
      {caption ? (
        <div
          data-testid="threshold-caption"
          className="mt-1 px-1 text-right font-mono text-bf-2xs tabular-nums text-muted-foreground"
        >
          {caption}
        </div>
      ) : null}
    </div>
  );
}

/**
 * Click-to-edit numeric chip. Default mode renders a button with the formatted
 * value; clicking flips to a focused number input. Enter or blur commits;
 * Escape reverts. No spinner chrome — just bare text that becomes editable.
 */
function EditableNumber({
  value,
  onCommit,
  label,
}: {
  value: number;
  onCommit: (next: number) => void;
  label: string;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(() => formatLayerValueAscii(value));
  // The browser could not parse what was typed (`validity.badInput`), or the
  // draft is not a whole number: shown invalid, never committed as another value.
  const [invalid, setInvalid] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Sync draft when external value changes (e.g. from slider drag) and we're not editing.
  useEffect(() => {
    if (!editing) setDraft(formatLayerValueAscii(value));
  }, [value, editing]);

  // Autofocus the input when entering edit mode.
  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editing]);

  const parseDraft = (): number | null => {
    if (inputRef.current?.validity?.badInput) return null;
    return parseNumericText(draft);
  };

  /** Enter: commit a valid number; an invalid one keeps the editor open, marked invalid. */
  const commit = (): boolean => {
    const parsed = parseDraft();
    if (parsed === null) {
      if (draft.trim() === "" && !inputRef.current?.validity?.badInput) {
        cancel();
        return true;
      }
      setInvalid(true);
      return false;
    }
    if (parsed !== value) onCommit(parsed);
    else setDraft(formatLayerValueAscii(value));
    setInvalid(false);
    setEditing(false);
    return true;
  };

  const cancel = () => {
    setDraft(formatLayerValueAscii(value));
    setInvalid(false);
    setEditing(false);
  };

  if (editing) {
    return (
      <input
        ref={inputRef}
        type="number"
        value={draft}
        step="any"
        onChange={(e) => {
          setDraft(e.target.value);
          setInvalid(e.target.validity?.badInput === true);
        }}
        // Blur commits a valid number and otherwise reverts (focus has moved
        // on; an unparseable draft is never applied as some other value).
        onBlur={() => {
          if (!commit()) cancel();
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            commit();
          } else if (e.key === "Escape") {
            e.preventDefault();
            cancel();
          }
        }}
        aria-label={label}
        aria-invalid={invalid || undefined}
        title={invalid ? "Not a number" : undefined}
        className={`w-14 rounded-sm bg-background px-1 text-right font-mono text-bf-xs tabular-nums text-foreground outline-none ring-2 ${invalid ? "ring-bf-danger" : "ring-ring"}`}
        style={{ fontVariantNumeric: "tabular-nums" }}
      />
    );
  }

  return (
    <button
      type="button"
      onClick={() => setEditing(true)}
      title={`${formatChip(value)} — click to edit`}
      aria-label={`${label}: ${formatChip(value)}, click to edit`}
      className="w-14 rounded-sm px-1 text-right font-mono text-bf-xs tabular-nums text-foreground transition-colors hover:bg-accent/40 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      style={{ fontVariantNumeric: "tabular-nums" }}
    >
      {formatChip(value)}
    </button>
  );
}

/**
 * Shared visible track + two stacked range inputs styled as small circle
 * thumbs. The track and active band are rendered as separate DOM nodes
 * underneath the inputs so we don't depend on inline gradient strings.
 */
function DualRangeTrack({
  label,
  low,
  high,
  dataMin,
  dataMax,
  step,
  onLow,
  onHigh,
  mode = "shown",
  dataSpan = null,
  onInteraction,
}: {
  onInteraction?: (active: boolean, domain: readonly [number, number]) => void;
  label: string;
  low: number;
  high: number;
  dataMin: number;
  dataMax: number;
  dataSpan?: readonly [number, number] | null;
  step: number;
  onLow: (n: number) => void;
  onHigh: (n: number) => void;
  mode?: "shown" | "hidden";
}) {
  const hiddenActive = mode === "hidden" && isThresholdActive([low, high]);
  const span = dataMax - dataMin;
  const lowPct =
    span > 0 ? Math.max(0, Math.min(100, ((low - dataMin) / span) * 100)) : 0;
  const highPct =
    span > 0
      ? Math.max(0, Math.min(100, ((high - dataMin) / span) * 100))
      : 100;

  // Circle thumb styling lives in a real CSS rule (`bf-thumb-circle` in
  // theme.css) rather than Tailwind arbitrary variants, because the thumb
  // pseudo-elements need `-webkit-appearance: none` paired with size +
  // background, and Tailwind's JIT can't reliably emit that pair through
  // arbitrary variants on a `<input type=range>`. Both inputs sit absolutely
  // positioned over the same track; the thumb pseudo gets pointer-events:
  // auto so each handle stays grabbable even when they overlap.
  const thumbClass = "bf-thumb-circle absolute inset-0 h-3 w-full";

  // Interaction tracking for the frozen ruler: active while a thumb is held
  // (pointer down until pointerup / cancel anywhere) or has keyboard focus.
  const pointerHeld = useRef(false);
  const focused = useRef(false);
  const activeRef = useRef(false);
  const notify = () => {
    const next = pointerHeld.current || focused.current;
    if (next === activeRef.current) return;
    activeRef.current = next;
    onInteraction?.(next, [dataMin, dataMax]);
  };
  const latest = useRef({ onInteraction, dataMin, dataMax });
  useEffect(() => {
    latest.current = { onInteraction, dataMin, dataMax };
  });
  useEffect(
    () => () => {
      const { onInteraction: cb, dataMin: lo, dataMax: hi } = latest.current;
      if (activeRef.current) cb?.(false, [lo, hi]);
    },
    [],
  );
  const handlePointerDown = () => {
    pointerHeld.current = true;
    notify();
    const release = () => {
      window.removeEventListener("pointerup", release, true);
      window.removeEventListener("pointercancel", release, true);
      pointerHeld.current = false;
      notify();
    };
    window.addEventListener("pointerup", release, true);
    window.addEventListener("pointercancel", release, true);
  };
  const interactionProps = {
    onPointerDown: handlePointerDown,
    onFocus: () => {
      focused.current = true;
      notify();
    },
    onBlur: () => {
      focused.current = false;
      notify();
    },
  };
  // Keyboard stepping is done here, and the inputs use step="any": a native
  // range input snaps its value to `min + k·step`, so a value off that grid
  // (a typed chip value, `max`, a clamp to the other thumb) would draw the
  // thumb up to half a step away from it, and End could stop one step short
  // of `max`. Home / End reach the ruler's exact ends.
  const stepKeys =
    (current: number, set: (n: number) => void) =>
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      const big = step * 10;
      const delta: Record<string, number> = {
        ArrowRight: step,
        ArrowUp: step,
        ArrowLeft: -step,
        ArrowDown: -step,
        PageUp: big,
        PageDown: -big,
      };
      let next: number | null = null;
      if (e.key === "Home") next = dataMin;
      else if (e.key === "End") next = dataMax;
      else if (e.key in delta) next = current + delta[e.key];
      if (next === null) return;
      e.preventDefault();
      set(Math.min(dataMax, Math.max(dataMin, next)));
    };

  return (
    <div className="mt-2 px-1">
      <div className="relative h-3">
        {/* Inactive track */}
        <div
          aria-hidden
          className="absolute left-0 right-0 top-1/2 h-[3px] -translate-y-1/2 rounded-full"
          style={{ backgroundColor: dataSpan ? "hsl(var(--border) / 0.35)" : "hsl(var(--border) / 0.7)" }}
        />
        {/* Data range on the shared ruler: a faint band (the track beyond it
            is window-only extent, where no voxel values lie). */}
        {dataSpan ? (
          <div
            aria-hidden
            data-testid="range-data-band"
            className="absolute top-1/2 h-[3px] -translate-y-1/2 rounded-full"
            style={{
              left: `${dataSpan[0] * 100}%`,
              width: `${Math.max(0, dataSpan[1] - dataSpan[0]) * 100}%`,
              backgroundColor: "hsl(var(--border) / 0.7)",
            }}
          />
        ) : null}
        {/* Band between thumbs: the shown range filled (Intensity), or the
            hidden range as the colorbar's hatched cut-out (Threshold). A
            threshold that hides nothing ([0, 0]) draws no band. */}
        {mode === "shown" ? (
          <div
            aria-hidden
            className="absolute top-1/2 h-[3px] -translate-y-1/2 rounded-full bg-primary/60"
            style={{
              left: `${lowPct}%`,
              width: `${Math.max(0, highPct - lowPct)}%`,
            }}
          />
        ) : hiddenActive ? (
          <div
            aria-hidden
            data-testid="threshold-hidden-band"
            className="absolute top-1/2 h-[7px] -translate-y-1/2 outline outline-1 outline-[var(--bf-border-strong)]"
            style={{
              left: `${lowPct}%`,
              width: `${Math.max(0, highPct - lowPct)}%`,
              background: HIDDEN_BAND_BACKGROUND,
            }}
          />
        ) : null}
        {/* Low handle */}
        <input
          type="range"
          min={dataMin}
          max={dataMax}
          step="any"
          value={low}
          onChange={(e) => onLow(Number.parseFloat(e.target.value))}
          onKeyDown={stepKeys(low, onLow)}
          {...interactionProps}
          aria-label={`${label} low`}
          aria-valuetext={formatLayerValueAscii(low)}
          className={thumbClass}
        />
        {/* High handle */}
        <input
          type="range"
          min={dataMin}
          max={dataMax}
          step="any"
          value={high}
          onChange={(e) => onHigh(Number.parseFloat(e.target.value))}
          onKeyDown={stepKeys(high, onHigh)}
          {...interactionProps}
          aria-label={`${label} high`}
          aria-valuetext={formatLayerValueAscii(high)}
          className={thumbClass}
        />
      </div>
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
  return (
    <div className="py-1.5">
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
): InspectorRuler {
  const finite = [
    data[0],
    data[1],
    window[0],
    window[1],
    ...(frozen ? [frozen[0], frozen[1]] : []),
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

// ── format helpers ──────────────────────────────────────────────────────────

const formatChip = formatLayerValue;

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
