import React, { useEffect, useRef, useState } from "react";
import { useLayerStore } from "@/stores/layerStore";
import { useViewStateStore } from "@/stores/viewStateStore";
import { useSurfaceStore } from "@/stores/surfaceStore";
import { ColormapPicker } from "@/components/ui/ColormapPicker";
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

  if (!layer || !layerId || !viewLayer) return null;

  const dataRange = metadata?.dataRange ?? null;
  const dataMin = dataRange?.min ?? viewLayer.intensity[0];
  const dataMax = dataRange?.max ?? viewLayer.intensity[1];
  const intensity = viewLayer.intensity;
  const threshold = viewLayer.threshold;
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
        dataMin={dataMin}
        dataMax={dataMax}
        onChange={(low, high) => setLayerField("intensity", [low, high])}
      />

      {kind === "overlay" ? (
        <RangeBlock
          label="Threshold"
          low={threshold[0]}
          high={threshold[1]}
          dataMin={dataMin}
          dataMax={dataMax}
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
              className="bf-select text-[11px] capitalize"
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
              <span className="text-[10px] text-muted-foreground">
                applying…
              </span>
            ) : null}
          </div>
        </FieldRow>
      ) : (
        <ColormapBlock
          value={colormap}
          onChange={(next) => setLayerField("colormap", next)}
        />
      )}

      {kind === "overlay" ? (
        <FieldRow label="Blend mode">
          <select
            value={blendMode}
            onChange={(e) =>
              setLayerField("blendMode", e.target.value as typeof blendMode)
            }
            className="bf-select text-[11px] capitalize"
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
            value={interpolation}
            onChange={(e) =>
              setLayerField(
                "interpolation",
                e.target.value as typeof interpolation,
              )
            }
            className="bf-select text-[11px] capitalize"
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
            className="font-mono text-[12px] tabular-nums text-foreground"
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
          checked={outline.enabled}
          onChange={(enabled) => update({ enabled })}
        />
      </FieldRow>

      <FieldRow label="Label ID">
        <div className="flex items-center gap-2">
          <input
            type="number"
            min={0}
            step={1}
            value={outline.selectedLabelId}
            onChange={(e) =>
              update({
                selectedLabelId: Math.max(
                  0,
                  Math.round(Number(e.target.value) || 0),
                ),
              })
            }
            className="w-16 rounded-sm bg-background px-1 text-right font-mono text-[11px] tabular-nums text-foreground outline-none ring-1 ring-border focus:ring-sky-500"
            style={{ fontVariantNumeric: "tabular-nums" }}
          />
          <button
            type="button"
            onClick={useCrosshairLabel}
            disabled={sampling}
            className="rounded-sm border border-border px-2 py-0.5 text-[11px] text-foreground transition-colors hover:bg-accent/40 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {sampling ? "Sampling" : "Crosshair"}
          </button>
        </div>
      </FieldRow>

      <FieldRow label="Thickness">
        <Slider
          value={outline.thicknessPx}
          min={1}
          max={8}
          step={1}
          onChange={(thicknessPx) => update({ thicknessPx })}
        />
        <span className="font-mono text-[11px] tabular-nums text-muted-foreground">
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
          aria-label="outline color"
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
    return (
      <>
        <FieldRow label="Visible">
          <span className="text-[12px] text-muted-foreground">
            {layer.visible === false ? "hidden" : "visible"}
          </span>
        </FieldRow>
        <FieldRow label="Opacity">
          <span
            className="font-mono text-[12px] tabular-nums text-foreground"
            style={{ fontVariantNumeric: "tabular-nums" }}
          >
            {Math.round((layer.opacity ?? 1) * 100)}%
          </span>
        </FieldRow>
        <FieldRow label="Colormap">
          <span className="text-[12px] text-foreground">{layer.colormap}</span>
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
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-4 w-7 items-center rounded-full transition-colors ${
        checked ? "bg-sky-500" : "bg-border"
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
}: {
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
}) {
  return (
    <input
      type="range"
      value={value}
      min={min}
      max={max}
      step={step}
      onChange={(e) => onChange(Number.parseFloat(e.target.value))}
      className={`h-1 w-28 cursor-pointer appearance-none rounded-full bg-border accent-sky-500`}
    />
  );
}

function Pct({ value }: { value: number }) {
  return (
    <span
      className="font-mono text-[11px] tabular-nums text-muted-foreground"
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
 *   active band tinted sky between handles. Two stacked native range inputs
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
  onChange,
}: {
  label: string;
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

  return (
    <div className="py-1.5 text-[12px]">
      <div className="flex items-center justify-between gap-3">
        <span className="text-muted-foreground">{label}</span>
        <span className="flex items-center gap-1.5">
          <EditableNumber value={low} onCommit={handleLow} />
          <span className="text-[11px] text-muted-foreground/70">–</span>
          <EditableNumber value={high} onCommit={handleHigh} />
        </span>
      </div>
      <DualRangeTrack
        low={low}
        high={high}
        dataMin={dataMin}
        dataMax={dataMax}
        step={step}
        onLow={handleLow}
        onHigh={handleHigh}
      />
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
}: {
  value: number;
  onCommit: (next: number) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(() => formatChip(value));
  const inputRef = useRef<HTMLInputElement>(null);

  // Sync draft when external value changes (e.g. from slider drag) and we're not editing.
  useEffect(() => {
    if (!editing) setDraft(formatChip(value));
  }, [value, editing]);

  // Autofocus the input when entering edit mode.
  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editing]);

  const commit = () => {
    const parsed = Number.parseFloat(draft);
    if (Number.isFinite(parsed) && parsed !== value) {
      onCommit(parsed);
    } else {
      setDraft(formatChip(value));
    }
    setEditing(false);
  };

  const cancel = () => {
    setDraft(formatChip(value));
    setEditing(false);
  };

  if (editing) {
    return (
      <input
        ref={inputRef}
        type="number"
        value={draft}
        step="any"
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            commit();
          } else if (e.key === "Escape") {
            e.preventDefault();
            cancel();
          }
        }}
        aria-label="value"
        className="w-14 rounded-sm bg-background px-1 text-right font-mono text-[11px] tabular-nums text-foreground outline-none ring-1 ring-sky-500"
        style={{ fontVariantNumeric: "tabular-nums" }}
      />
    );
  }

  return (
    <button
      type="button"
      onClick={() => setEditing(true)}
      title={`${value} — click to edit`}
      className="w-14 rounded-sm px-1 text-right font-mono text-[11px] tabular-nums text-foreground transition-colors hover:bg-accent/40 hover:underline focus:outline-none focus-visible:ring-1 focus-visible:ring-sky-500"
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
  low,
  high,
  dataMin,
  dataMax,
  step,
  onLow,
  onHigh,
}: {
  low: number;
  high: number;
  dataMin: number;
  dataMax: number;
  step: number;
  onLow: (n: number) => void;
  onHigh: (n: number) => void;
}) {
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

  return (
    <div className="mt-2 px-1">
      <div className="relative h-3">
        {/* Inactive track */}
        <div
          aria-hidden
          className="absolute left-0 right-0 top-1/2 h-[3px] -translate-y-1/2 rounded-full"
          style={{ backgroundColor: "hsl(var(--border) / 0.7)" }}
        />
        {/* Active band between thumbs */}
        <div
          aria-hidden
          className="absolute top-1/2 h-[3px] -translate-y-1/2 rounded-full bg-sky-500/60"
          style={{
            left: `${lowPct}%`,
            width: `${Math.max(0, highPct - lowPct)}%`,
          }}
        />
        {/* Low handle */}
        <input
          type="range"
          min={dataMin}
          max={dataMax}
          step={step}
          value={low}
          onChange={(e) => onLow(Number.parseFloat(e.target.value))}
          aria-label="range low"
          className={thumbClass}
        />
        {/* High handle */}
        <input
          type="range"
          min={dataMin}
          max={dataMax}
          step={step}
          value={high}
          onChange={(e) => onHigh(Number.parseFloat(e.target.value))}
          aria-label="range high"
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
}: {
  value: string;
  onChange: (next: string) => void;
}) {
  return (
    <div className="py-1.5">
      <ColormapPicker value={value} onChange={onChange} variant="enhanced" />
    </div>
  );
}

// ── format helpers ──────────────────────────────────────────────────────────

function formatChip(value: number): string {
  if (!Number.isFinite(value)) return "—";
  const abs = Math.abs(value);
  if (abs === 0) return "0";
  if (abs >= 10000 || (abs > 0 && abs < 0.01)) return value.toExponential(1);
  // Strip trailing zeros from fixed-2 (e.g. 100.00 → 100, 3.13 → 3.13).
  const fixed = value.toFixed(2);
  return fixed.replace(/\.?0+$/, "");
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
