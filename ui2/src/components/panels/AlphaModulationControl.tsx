import React, { useMemo } from "react";
import { SingleSlider } from "@/components/ui/SingleSlider";
import type { AlphaModConfig, AlphaModMode } from "@/types/viewState";

/**
 * Inspector control for intensity-modulated overlay alpha ("transparent
 * thresholding"). Mirrors the shader contract: opacity rises with the two-sided
 * magnitude |value - center|, ramped from the threshold up to the top of the
 * intensity window, shaped linearly or by a gamma exponent.
 *
 * The sparkline plots that exact curve over the live window so the user sees how
 * it adapts to the current intensity range and threshold.
 */

const MODES: { value: AlphaModMode; label: string }[] = [
  { value: "off", label: "Off" },
  { value: "linear", label: "Linear" },
  { value: "gamma", label: "Gamma" },
];

export interface AlphaModulationControlProps {
  value?: AlphaModConfig;
  /** Visible intensity window [min, max] in data units. */
  intensity: [number, number];
  /** Threshold [low, high] in data units. */
  threshold: [number, number];
  onChange: (next: AlphaModConfig) => void;
  disabled?: boolean;
  /** Tooltip shown when the control is disabled (e.g. under Max/Min blend). */
  disabledReason?: string;
}

const DEFAULT_ALPHA_MOD: AlphaModConfig = { mode: "off", gamma: 1, center: 0 };

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

export function computeAlphaModFactor(
  sampleValue: number,
  mode: AlphaModMode,
  gamma: number,
  intensity: [number, number],
  threshold: [number, number],
  center = 0,
): number {
  if (mode === "off") return 1;

  const hi = Math.max(
    Math.abs(intensity[1] - center),
    Math.abs(intensity[0] - center),
    1e-9,
  );
  const low = Math.min(threshold[0], threshold[1]);
  const high = Math.max(threshold[0], threshold[1]);

  if (sampleValue >= low && sampleValue <= high) return 0;

  const boundary = sampleValue < low ? low : high;
  const floor = clamp(Math.abs(boundary - center), 0, hi);
  const mag = Math.abs(sampleValue - center);
  let t = clamp((mag - floor) / Math.max(hi - floor, 1e-9), 0, 1);
  if (mode === "gamma") t = Math.pow(t, Math.max(gamma, 1e-3));
  return t;
}

function alphaCurvePath(
  value: AlphaModConfig,
  intensity: [number, number],
  threshold: [number, number],
  width: number,
  height: number,
  samples = 48,
): string {
  const windowMin = Math.min(intensity[0], intensity[1]);
  const windowMax = Math.max(intensity[0], intensity[1]);
  const span = Math.max(windowMax - windowMin, 1e-9);
  const pts: string[] = [];
  for (let i = 0; i <= samples; i++) {
    const pct = i / samples;
    const sampleValue = windowMin + pct * span;
    const t = computeAlphaModFactor(
      sampleValue,
      value.mode,
      value.gamma,
      intensity,
      threshold,
      value.center ?? 0,
    );
    const x = pct * width;
    const y = height - t * height;
    pts.push(`${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`);
  }
  return pts.join(" ");
}

const AlphaCurveSparkline: React.FC<{
  value: AlphaModConfig;
  intensity: [number, number];
  threshold: [number, number];
}> = ({ value, intensity, threshold }) => {
  const width = 200;
  const height = 44;
  const windowMin = Math.min(intensity[0], intensity[1]);
  const windowMax = Math.max(intensity[0], intensity[1]);
  const span = Math.max(windowMax - windowMin, 1e-9);
  const thresholdMarkers = [threshold[0], threshold[1]].filter(
    (marker, index, markers) =>
      marker >= windowMin &&
      marker <= windowMax &&
      (index === 0 || Math.abs(marker - markers[0]) > 1e-9),
  );
  const path = useMemo(
    () => alphaCurvePath(value, intensity, threshold, width, height),
    [
      value.mode,
      value.gamma,
      value.center,
      intensity[0],
      intensity[1],
      threshold[0],
      threshold[1],
    ],
  );

  return (
    <svg
      width="100%"
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      className="block rounded-sm border border-border bg-muted/30"
      data-testid="alpha-mod-sparkline"
      role="img"
      aria-label="Alpha modulation curve"
    >
      {thresholdMarkers.map((marker) => (
        <line
          key={marker}
          data-testid="alpha-mod-threshold-marker"
          x1={((marker - windowMin) / span) * width}
          y1={0}
          x2={((marker - windowMin) / span) * width}
          y2={height}
          stroke="currentColor"
          strokeWidth={1}
          className="text-muted-foreground/50"
          strokeDasharray="2 2"
        />
      ))}
      <path
        d={path}
        fill="none"
        stroke="currentColor"
        strokeWidth={1.5}
        className="text-primary"
      />
    </svg>
  );
};

export const AlphaModulationControl: React.FC<AlphaModulationControlProps> = ({
  value,
  intensity,
  threshold,
  onChange,
  disabled,
  disabledReason,
}) => {
  const current = value ?? DEFAULT_ALPHA_MOD;
  const mode = current.mode;

  const setMode = (next: AlphaModMode) => {
    onChange({
      mode: next,
      gamma: current.gamma ?? 1,
      center: current.center ?? 0,
    });
  };

  return (
    <div
      className="space-y-2"
      data-testid="alpha-mod-control"
      title={disabled ? disabledReason : undefined}
    >
      <div className="flex items-center justify-between gap-4">
        <label className="bf-role-section text-muted-foreground shrink-0">
          Alpha mod
        </label>
        <div className="flex gap-0 shrink-0">
          {MODES.map((m, idx) => (
            <button
              key={m.value}
              type="button"
              data-testid={`alpha-mod-${m.value}`}
              aria-pressed={mode === m.value}
              className={`px-3 py-1 bf-role-section min-h-control-md border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                idx > 0 ? "border-l-0" : ""
              } ${
                mode === m.value
                  ? "bg-primary text-primary-foreground border-primary"
                  : "bg-transparent hover:bg-muted/50 border-border text-muted-foreground"
              }`}
              style={{
                borderRadius:
                  idx === 0
                    ? "1px 0 0 1px"
                    : idx === MODES.length - 1
                      ? "0 1px 1px 0"
                      : "0",
              }}
              onClick={() => setMode(m.value)}
              disabled={disabled}
            >
              {m.label}
            </button>
          ))}
        </div>
      </div>

      {mode !== "off" ? (
        <AlphaCurveSparkline
          value={current}
          intensity={intensity}
          threshold={threshold}
        />
      ) : null}

      {mode === "gamma" ? (
        <SingleSlider
          label="Gamma"
          min={0.2}
          max={5}
          value={current.gamma ?? 1}
          onChange={(gamma) => onChange({ ...current, mode: "gamma", gamma })}
          formatValue={(v) => v.toFixed(2)}
          disabled={disabled}
          layout="strip"
          compact
          highContrast
        />
      ) : null}
    </div>
  );
};
