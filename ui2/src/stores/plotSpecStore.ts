/**
 * plotSpecStore — persisted, cross-React-root home for per-plot-mode sampling
 * and visual-encoding parameters. This is the backbone of step 2's generic
 * encoding/params panel.
 *
 * Two kinds of state, both keyed by plot-mode id:
 *   - Sampling/locus params (`sphereRadiusMmByMode`, `reduceByMode`) — feed the
 *     SampleProvider request; changing them re-samples.
 *   - Visual spec override (`specByMode`) — a *partial* {@link PlotSpec} (mark
 *     and/or rebound encoding channels) merged onto the frame's inferred
 *     default at render time; changing it only re-renders.
 *
 * Keyed by mode (stable, persistable) rather than by the ephemeral dataset id.
 * The override is resilient to dataset switches: `resolveSpec` drops any channel
 * bound to a column the current frame lacks (see `@/plotting/spec`).
 *
 * Mirrors {@link usePlotModeStore}: a `persist`-wrapped store promoted to a
 * `window` singleton (Golden Layout panels each have their own React root) with
 * compare-before-write setters.
 */

import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";

import type { Encoding, Mark, ReduceOp, Transform } from "@/plotting";

/** A user's partial override of the inferred plot spec for a mode. */
export interface PlotSpecOverride {
  mark?: Mark;
  encoding?: Encoding;
  transforms?: Transform[];
}

export interface PlotSpecStore {
  /** Sphere sampling radius (mm) keyed by plot-mode id. 0 == single voxel. */
  sphereRadiusMmByMode: Record<string, number>;
  /** Voxel reducer for multi-voxel loci, keyed by mode id. Defaults to 'mean'. */
  reduceByMode: Record<string, ReduceOp>;
  /** Partial visual-spec override keyed by mode id. */
  specByMode: Record<string, PlotSpecOverride>;

  /** Set the sphere radius for a mode (clamped to >= 0); no-ops when unchanged. */
  setSphereRadiusMm: (modeId: string, radiusMm: number) => void;
  /** Set the voxel reducer for a mode; no-ops when unchanged. */
  setReduce: (modeId: string, reduce: ReduceOp) => void;
  /** Set the mark for a mode; no-ops when unchanged. */
  setMark: (modeId: string, mark: Mark) => void;
  /** Bind (or, with `null`, clear) an encoding channel for a mode. */
  setEncodingChannel: (
    modeId: string,
    channel: keyof Encoding,
    columnName: string | null,
  ) => void;
  /**
   * Set (or, with `null`, clear) a `normalize` transform on `field` for a mode.
   * Replaces any existing normalize transform on that field.
   */
  setNormalize: (
    modeId: string,
    field: string,
    method: "zscore" | "percentChange" | null,
  ) => void;
  /** Drop a mode's visual override (revert to the inferred default). */
  resetMode: (modeId: string) => void;
  /** Test helper — restores the initial empty state. */
  resetPlotSpecStore: () => void;
}

declare global {
  interface Window {
    __plotSpecStore?: ReturnType<typeof createPlotSpecStore>;
  }
}

const PLOT_SPEC_PERSIST_VERSION = 2;
const PLOT_SPEC_PERSIST_NAME = "brainflow2-plot-spec";

const createPlotSpecStore = () =>
  create<PlotSpecStore>()(
    persist(
      (set) => ({
        sphereRadiusMmByMode: {},
        reduceByMode: {},
        specByMode: {},

        setSphereRadiusMm: (modeId, radiusMm) => {
          const clamped = Number.isFinite(radiusMm) ? Math.max(0, radiusMm) : 0;
          set((state) => {
            if (state.sphereRadiusMmByMode[modeId] === clamped) return state;
            return {
              sphereRadiusMmByMode: {
                ...state.sphereRadiusMmByMode,
                [modeId]: clamped,
              },
            };
          });
        },

        setReduce: (modeId, reduce) => {
          set((state) => {
            if (state.reduceByMode[modeId] === reduce) return state;
            return {
              reduceByMode: { ...state.reduceByMode, [modeId]: reduce },
            };
          });
        },

        setMark: (modeId, mark) => {
          set((state) => {
            const prev = state.specByMode[modeId];
            if (prev?.mark === mark) return state;
            return {
              specByMode: { ...state.specByMode, [modeId]: { ...prev, mark } },
            };
          });
        },

        setEncodingChannel: (modeId, channel, columnName) => {
          set((state) => {
            const prev = state.specByMode[modeId];
            // '' is the sentinel resolveSpec reads as "channel cleared".
            const nextVal = columnName ?? "";
            const prevEncoding = prev?.encoding ?? {};
            if (prevEncoding[channel] === nextVal) return state;
            return {
              specByMode: {
                ...state.specByMode,
                [modeId]: {
                  ...prev,
                  encoding: { ...prevEncoding, [channel]: nextVal },
                },
              },
            };
          });
        },

        setNormalize: (modeId, field, method) => {
          set((state) => {
            const prev = state.specByMode[modeId];
            const others = (prev?.transforms ?? []).filter(
              (t) => !(t.kind === "normalize" && t.field === field),
            );
            const next: Transform[] = method
              ? [...others, { kind: "normalize", field, method }]
              : others;
            const prevTransforms = prev?.transforms ?? [];
            // No-op when the transform set is unchanged.
            if (
              prevTransforms.length === next.length &&
              prevTransforms.every((t, i) => t === next[i])
            ) {
              return state;
            }
            return {
              specByMode: {
                ...state.specByMode,
                [modeId]: { ...prev, transforms: next },
              },
            };
          });
        },

        resetMode: (modeId) => {
          set((state) => {
            if (!(modeId in state.specByMode)) return state;
            const next = { ...state.specByMode };
            delete next[modeId];
            return { specByMode: next };
          });
        },

        resetPlotSpecStore: () => {
          set({ sphereRadiusMmByMode: {}, reduceByMode: {}, specByMode: {} });
        },
      }),
      {
        name: PLOT_SPEC_PERSIST_NAME,
        version: PLOT_SPEC_PERSIST_VERSION,
        storage: createJSONStorage(() => localStorage),
        partialize: (state) => ({
          sphereRadiusMmByMode: state.sphereRadiusMmByMode,
          reduceByMode: state.reduceByMode,
          specByMode: state.specByMode,
        }),
        // v1 persisted only sphereRadiusMmByMode; backfill the new maps.
        migrate: (persisted, version) => {
          const prev = (persisted ?? {}) as Partial<PlotSpecStore>;
          if (version < 2) {
            return {
              sphereRadiusMmByMode: prev.sphereRadiusMmByMode ?? {},
              reduceByMode: {},
              specByMode: {},
            } as PlotSpecStore;
          }
          return prev as PlotSpecStore;
        },
      },
    ),
  );

// Cross-React-root sharing — Golden Layout panels each have their own React
// root, so the store must be a process-wide singleton (same pattern as
// `usePlotModeStore` / `useLayerStore`).
export const usePlotSpecStore: ReturnType<typeof createPlotSpecStore> = (() => {
  if (typeof window !== "undefined" && window.__plotSpecStore) {
    return window.__plotSpecStore;
  }
  const store = createPlotSpecStore();
  if (typeof window !== "undefined") {
    window.__plotSpecStore = store;
  }
  return store;
})();
