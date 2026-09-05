import { alignPlaneToCrosshair } from "./viewStateGeometry";
/**
 * ViewState Store
 *
 * Compatibility surface for the active workspace's view state, backed by
 * per-workspace snapshots. Existing selectors can keep reading `viewState`
 * and `viewStateRevisions`, while new code can access explicit workspace
 * entries when needed.
 */

import { create } from "zustand";
import { subscribeWithSelector } from "zustand/middleware";
import { immer } from "zustand/middleware/immer";
import { enablePatches, produceWithPatches } from "immer";
import type { ViewState, ViewStateRevisions } from "@/types/viewState";
import type {
  ViewType,
  ViewPlane,
  WorldCoordinates,
} from "@/types/coordinates";
import {
  coalesceUpdatesMiddleware,
  coalesceUtils,
} from "./middleware/coalesceUpdatesMiddleware";
import { getApiService } from "@/services/apiService";
import { getViewPlaneService } from "@/services/ViewPlaneService";
import { useViewLayoutStore } from "./viewLayoutStore";
import { storeLog, storeWarn, storeError, storeTrace } from "@/utils/debugLog";
import {
  applyViewStateRevisionPatches,
  areViewStatesEqual,
  cloneViewStateRevisions,
  createInitialViewStateRevisions,
} from "@/utils/viewStateTracking";
import { useWorkspaceStore } from "./workspaceStore";

enablePatches();

const DEFAULT_WORKSPACE_KEY = "__default_workspace__";

// Declare global interface for store
declare global {
  interface Window {
    __viewStateStore?: ReturnType<typeof createViewStateStore>;
  }
}

function getInitialResizeState(): Record<ViewType, Promise<void> | null> {
  return {
    axial: null,
    sagittal: null,
    coronal: null,
  };
}

// Initial view state - placeholder views until a volume is loaded
function getInitialViewState(): ViewState {
  const defaultViews: Record<ViewType, ViewPlane> = {
    axial: {
      origin_mm: [-100, 100, 0],
      u_mm: [0.390625, 0, 0],
      v_mm: [0, -0.390625, 0],
      dim_px: [512, 512] as [number, number],
    },
    sagittal: {
      origin_mm: [0, 100, 100],
      u_mm: [0, -0.390625, 0],
      v_mm: [0, 0, -0.390625],
      dim_px: [512, 512] as [number, number],
    },
    coronal: {
      origin_mm: [-100, 0, 100],
      u_mm: [0.390625, 0, 0],
      v_mm: [0, 0, -0.390625],
      dim_px: [512, 512] as [number, number],
    },
  };

  return {
    views: defaultViews,
    crosshair: {
      world_mm: [0, 0, 0],
      visible: true,
    },
    layers: [],
  };
}

function cloneValue<T>(value: T): T {
  if (typeof structuredClone === "function") {
    return structuredClone(value);
  }
  return JSON.parse(JSON.stringify(value)) as T;
}

function cloneViewState(viewState: ViewState): ViewState {
  return cloneValue(viewState);
}

function toWorkspaceKey(workspaceId?: string | null): string {
  return workspaceId ?? DEFAULT_WORKSPACE_KEY;
}

interface ViewStateStore {
  viewState: ViewState;
  viewStateRevisions: ViewStateRevisions;
  workspaceViewStates: Map<string, ViewState>;
  workspaceViewStateRevisions: Map<string, ViewStateRevisions>;
  activeWorkspaceKey: string;

  // Track pending resize operations to prevent race conditions
  resizeInFlight: Record<ViewType, Promise<void> | null>;

  // Actions
  setViewState: (updater: (state: ViewState) => ViewState | void) => void;
  setCrosshair: (
    world_mm: WorldCoordinates,
    updateViews?: boolean,
    immediate?: boolean,
    workspaceId?: string,
  ) => Promise<void>;
  setCrosshairVisible: (visible: boolean) => void;
  updateView: (viewType: ViewType, plane: ViewPlane) => void;
  updateViewDimensions: (
    viewType: ViewType,
    dimensions: [number, number],
  ) => Promise<void>;
  updateDimensionsAndPreserveScale: (
    viewType: ViewType,
    dimensions: [number, number],
  ) => Promise<void>;

  // Helpers
  getView: (viewType: ViewType) => ViewPlane;
  getViews: () => Record<ViewType, ViewPlane>;
  getWorkspaceViewState: (workspaceId?: string | null) => ViewState;
  getWorkspaceViewStateRevisions: (
    workspaceId?: string | null,
  ) => ViewStateRevisions;

  // For undo/redo - currently scoped to active workspace compatibility surface
  undo: () => void;
  redo: () => void;
  canUndo: () => boolean;
  canRedo: () => boolean;

  // Reset to defaults
  resetToDefaults: () => void;
}

// Create store only once and attach to window for cross-root sharing
const createViewStateStore = () =>
  create<ViewStateStore>()(
    subscribeWithSelector(
      coalesceUpdatesMiddleware<ViewStateStore>({
        enabled: true,
        useTimeout: false,
      })(
        immer<ViewStateStore>((set, get) => {
          const crosshairRequests = new Map<string, number>();
          const resizeRequests = new Map<string, { workspaceKey: string; request: number }>();
          let nextRequest = 0;
          const getCurrentWorkspaceKey = () => get().activeWorkspaceKey;

          const applyViewStateUpdate = (
            recipe: (draft: ViewState) => ViewState | void,
            workspaceKey = getCurrentWorkspaceKey(),
          ): ViewState => {
            const currentState = get();
            if (!currentState.workspaceViewStates.has(workspaceKey)) return currentState.viewState;
            const currentViewState =
              currentState.workspaceViewStates.get(workspaceKey) ??
              currentState.viewState;
            const currentRevisions =
              currentState.workspaceViewStateRevisions.get(workspaceKey) ??
              currentState.viewStateRevisions;

            const [nextViewState, patches] = produceWithPatches(
              currentViewState,
              (draft) => {
                const updated = recipe(draft);
                if (updated) {
                  return updated;
                }
              },
            );

            if (patches.length === 0) {
              return currentViewState;
            }

            const nextRevisions = applyViewStateRevisionPatches(
              currentRevisions,
              patches,
            );

            set((state) => {
              state.workspaceViewStates.set(workspaceKey, nextViewState);
              state.workspaceViewStateRevisions.set(
                workspaceKey,
                nextRevisions,
              );
              if (state.activeWorkspaceKey === workspaceKey) {
                state.viewState = nextViewState;
                state.viewStateRevisions = nextRevisions;
              }
            });

            return nextViewState;
          };

          return {
            viewState: getInitialViewState(),
            viewStateRevisions: createInitialViewStateRevisions(),
            workspaceViewStates: new Map([
              [DEFAULT_WORKSPACE_KEY, getInitialViewState()],
            ]),
            workspaceViewStateRevisions: new Map([
              [DEFAULT_WORKSPACE_KEY, createInitialViewStateRevisions()],
            ]),
            activeWorkspaceKey: DEFAULT_WORKSPACE_KEY,
            resizeInFlight: getInitialResizeState(),

            setViewState: (updater) => {
              const timestamp = performance.now();
              const oldState = get().viewState;
              storeLog(
                "viewStateStore",
                `${timestamp.toFixed(0)}ms setViewState called`,
              );
              storeLog(
                "viewStateStore",
                `  - Current layers: ${oldState.layers.length}`,
              );
              storeLog(
                "viewStateStore",
                `  - Layer ids:`,
                oldState.layers.map((l) => l.id),
              );

              const stack = new Error().stack;
              const caller =
                typeof stack === "string"
                  ? stack.split("\n")[3]?.trim() || "unknown"
                  : "unknown";
              storeLog("viewStateStore", `  - Called from: ${caller}`);

              if (
                oldState.layers.some(
                  (layer) =>
                    layer.intensity &&
                    layer.intensity[0] > 1969 &&
                    layer.intensity[0] < 1970,
                )
              ) {
                storeWarn("viewStateStore", "Stack trace for 20-80% update:");
                storeTrace("viewStateStore", "");
              }

              const nextState = applyViewStateUpdate((draft) => updater(draft));
              if (nextState !== oldState) {
                storeLog(
                  "viewStateStore",
                  `${(performance.now() - timestamp).toFixed(2)}ms State updated:`,
                );
                storeLog(
                  "viewStateStore",
                  `  - New layers: ${nextState.layers.length}`,
                );
                storeLog(
                  "viewStateStore",
                  `  - Layer ids:`,
                  nextState.layers.map((l) => l.id),
                );

                nextState.layers.forEach((layer) => {
                  if (layer.intensity) {
                    storeLog(
                      "viewStateStore",
                      `  - Layer ${layer.id} intensity: [${layer.intensity[0].toFixed(2)}, ${layer.intensity[1].toFixed(2)}]`,
                    );

                    if (
                      layer.intensity[0] > 1969 &&
                      layer.intensity[0] < 1970 &&
                      layer.intensity[1] > 7878 &&
                      layer.intensity[1] < 7879
                    ) {
                      storeError(
                        "viewStateStore",
                        `WARNING: 20-80% default intensity detected for layer ${layer.id}!`,
                      );
                      storeError(
                        "viewStateStore",
                        `This update is resetting user's intensity values!`,
                      );
                      storeError("viewStateStore", "Update details:", {
                        layerId: layer.id,
                        intensity: layer.intensity,
                        caller,
                        timestamp,
                      });
                      storeTrace(
                        "viewStateStore",
                        "Stack trace for problematic intensity update:",
                      );
                    }
                  }
                });
              } else {
                storeLog(
                  "viewStateStore",
                  `${(performance.now() - timestamp).toFixed(2)}ms No state update (updater returned void)`,
                );
              }
            },

            setCrosshairVisible: (visible) => {
              applyViewStateUpdate((state) => {
                state.crosshair.visible = visible;
              });
            },

            setCrosshair: async (
              position,
              updateViews = false,
              immediate = false,
              workspaceId,
            ) => {
              storeLog("viewStateStore", "setCrosshair called with:", {
                position,
                updateViews,
                immediate,
                positionType: Array.isArray(position)
                  ? "array"
                  : typeof position,
              });

              if (!Array.isArray(position) || position.length !== 3 || !position.every(Number.isFinite)) {
                throw new Error(
                  `setCrosshair expects position as [x, y, z] array, got: ${JSON.stringify(position)}`,
                );
              }

              const currentState = get();
              const workspaceKey = workspaceId && currentState.workspaceViewStates.has(workspaceId)
                ? workspaceId : currentState.activeWorkspaceKey;
              const request = ++nextRequest;
              for (const key of crosshairRequests.keys()) {
                if (!currentState.workspaceViewStates.has(key)) crosshairRequests.delete(key);
              }
              crosshairRequests.set(workspaceKey, request);
              const resizePromises = Object.values(
                currentState.resizeInFlight,
              ).filter((p) => p !== null);

              if (resizePromises.length > 0) {
                storeLog(
                  "viewStateStore",
                  `Waiting for ${resizePromises.length} pending resize(s) before updating crosshair`,
                );
                try {
                  await Promise.all(resizePromises);
                  storeLog(
                    "viewStateStore",
                    "All resizes complete, proceeding with crosshair update",
                  );
                } catch (error) {
                  storeWarn(
                    "viewStateStore",
                    "Resize failed, but continuing with crosshair update:",
                    error,
                  );
                }
              }

              if (crosshairRequests.get(workspaceKey) !== request) return;
              applyViewStateUpdate((state) => {
                try {
                  const [x, y, z] = position;
                  storeLog(
                    "viewStateStore",
                    `Setting crosshair via normal path to: [${x}, ${y}, ${z}]`,
                  );

                  if (!state.crosshair.world_mm.every((value, axis) => value === position[axis])) {
                    state.crosshair.world_mm = [x, y, z];
                  }
                  state.crosshair.visible = true;

                  if (updateViews) {
                    const views = state.views;

                    for (const view of Object.values(views)) alignPlaneToCrosshair(view, position);

                    storeLog(
                      "viewStateStore",
                      `Updated slice positions for crosshair at [${x.toFixed(1)}, ${y.toFixed(1)}, ${z.toFixed(1)}]`,
                    );
                  }
                } catch (error) {
                  storeError("viewStateStore", "Error in setCrosshair:", error);
                  throw error;
                }
              }, workspaceKey);

              if (immediate && get().activeWorkspaceKey === workspaceKey) {
                storeLog(
                  "viewStateStore",
                  "Immediate update requested - forcing flush",
                );
                coalesceUtils.flush(true);
              }
            },

            updateView: (viewType, plane) => {
              applyViewStateUpdate((state) => {
                state.views[viewType] = plane;
              });
            },

            updateViewDimensions: async (viewType, dimensions) => {
              storeWarn(
                "viewStateStore",
                "updateViewDimensions is deprecated. Use updateDimensionsAndPreserveScale instead.",
              );

              const [newWidth, newHeight] = dimensions;
              if (newWidth <= 0 || newHeight <= 0) {
                storeWarn(
                  "viewStateStore",
                  `Invalid dimensions for ${viewType}: ${newWidth}x${newHeight}, skipping update`,
                );
                return;
              }

              applyViewStateUpdate((state) => {
                state.views[viewType].dim_px = dimensions;
              });
            },

            updateDimensionsAndPreserveScale: async (viewType, dimensions) => {
              const [newWidth, newHeight] = dimensions;
              storeLog(
                "viewStateStore",
                `updateDimensionsAndPreserveScale called for ${viewType}:`,
                {
                  requested: { width: newWidth, height: newHeight },
                  timestamp: performance.now(),
                },
              );

              if (newWidth <= 0 || newHeight <= 0) {
                storeWarn(
                  "viewStateStore",
                  `Invalid dimensions for ${viewType}: ${newWidth}x${newHeight}, skipping update`,
                );
                return;
              }

              const currentState = get();
              const workspaceKey = currentState.activeWorkspaceKey;
              const resizeKey = `${workspaceKey}:${useViewLayoutStore.getState().isLocked() ? 'all' : viewType}`;
              const request = ++nextRequest;
              for (const [key, pending] of resizeRequests) {
                if (!currentState.workspaceViewStates.has(pending.workspaceKey)) resizeRequests.delete(key);
              }
              resizeRequests.set(resizeKey, { workspaceKey, request });
              const applyResizeUpdate = (recipe: (draft: ViewState) => void) => {
                if (resizeRequests.get(resizeKey)?.request !== request) return;
                applyViewStateUpdate(state => {
                  recipe(state);
                  for (const plane of Object.values(state.views)) alignPlaneToCrosshair(plane, state.crosshair.world_mm);
                }, workspaceKey);
              };
              const view = currentState.viewState.views[viewType];
              const [oldWidth, oldHeight] = view.dim_px;

              storeLog(
                "viewStateStore",
                `Current view state for ${viewType}:`,
                {
                  dimensions: { width: oldWidth, height: oldHeight },
                  origin_mm: view.origin_mm,
                  u_mm: view.u_mm,
                  v_mm: view.v_mm,
                },
              );

              if (oldWidth === newWidth && oldHeight === newHeight) {
                storeLog(
                  "viewStateStore",
                  `Dimensions unchanged for ${viewType}, skipping update`,
                );
                return;
              }

              const layers = currentState.viewState.layers;
              if (layers.length === 0) {
                storeLog(
                  "viewStateStore",
                  "No layers loaded, updating dimensions only",
                );
                applyResizeUpdate((state) => {
                  state.views[viewType].dim_px = dimensions;
                });
                return;
              }

              const visibleLayer = layers.find(
                (l) => l.visible && l.opacity > 0,
              );
              if (!visibleLayer || !visibleLayer.volumeId) {
                storeWarn(
                  "viewStateStore",
                  "No visible layer with volume ID found, layers:",
                  layers,
                );
                applyResizeUpdate((state) => {
                  state.views[viewType].dim_px = dimensions;
                });
                return;
              }

              storeLog(
                "viewStateStore",
                `Using volume ${visibleLayer.volumeId} for recalculation`,
              );

              try {
                const layoutStoreState = useViewLayoutStore.getState();
                const isLockedLayout = layoutStoreState.isLocked();
                const apiService = getApiService();

                if (isLockedLayout) {
                  storeLog(
                    "viewStateStore",
                    "Layout locked - recalculating all views atomically",
                  );

                  const currentViews = currentState.viewState.views;
                  const widthScale = oldWidth > 0 ? newWidth / oldWidth : 1;
                  const heightScale = oldHeight > 0 ? newHeight / oldHeight : 1;

                  const dimsByView: Record<ViewType, [number, number]> = {
                    axial: [...currentViews.axial.dim_px],
                    sagittal: [...currentViews.sagittal.dim_px],
                    coronal: [...currentViews.coronal.dim_px],
                  };

                  dimsByView[viewType] = [newWidth, newHeight];

                  (["axial", "sagittal", "coronal"] as ViewType[]).forEach(
                    (vt) => {
                      if (vt === viewType) {
                        return;
                      }
                      const currentDims = currentViews[vt].dim_px;
                      dimsByView[vt] = [
                        Math.max(1, Math.round(currentDims[0] * widthScale)),
                        Math.max(1, Math.round(currentDims[1] * heightScale)),
                      ];
                    },
                  );

                  const backendViews = await apiService.recalculateAllViews(
                    visibleLayer.volumeId,
                    dimsByView,
                    currentState.viewState.crosshair.world_mm as [
                      number,
                      number,
                      number,
                    ],
                  );

                  storeLog(
                    "viewStateStore",
                    "Backend response for locked layout:",
                    backendViews,
                  );

                  applyResizeUpdate((state) => {
                    (["axial", "sagittal", "coronal"] as ViewType[]).forEach(
                      (vt) => {
                        const backendView = backendViews[vt];
                        if (backendView) {
                          state.views[vt] = backendView;
                        } else {
                          state.views[vt].dim_px = dimsByView[vt];
                        }
                      },
                    );
                  });

                  return;
                }

                storeLog(
                  "viewStateStore",
                  `Attempting backend recalculation for ${viewType}...`,
                );

                const newView = await apiService.recalculateViewForDimensions(
                  visibleLayer.volumeId,
                  viewType,
                  [newWidth, newHeight],
                  currentState.viewState.crosshair.world_mm,
                );

                storeLog(
                  "viewStateStore",
                  `Backend response for ${viewType}:`,
                  {
                    requestedDims: [newWidth, newHeight],
                    returnedView: newView,
                  },
                );

                applyResizeUpdate((state) => {
                  storeLog(
                    "viewStateStore",
                    `Updating view state for ${viewType} with backend values`,
                  );
                  state.views[viewType] = newView;
                });
              } catch (error) {
                storeError(
                  "viewStateStore",
                  "Backend recalculation failed, using frontend fallback:",
                  error,
                );

                try {
                  const apiService = getApiService();
                  const bounds = await apiService.getVolumeBounds(
                    visibleLayer.volumeId,
                  );
                  storeLog("viewStateStore", "Got volume bounds:", bounds);

                  let widthMm: number;
                  let heightMm: number;
                  const crosshair = currentState.viewState.crosshair.world_mm;

                  switch (viewType) {
                    case "axial":
                      widthMm = bounds.max[0] - bounds.min[0];
                      heightMm = bounds.max[1] - bounds.min[1];
                      break;
                    case "sagittal":
                      widthMm = bounds.max[1] - bounds.min[1];
                      heightMm = bounds.max[2] - bounds.min[2];
                      break;
                    case "coronal":
                      widthMm = bounds.max[0] - bounds.min[0];
                      heightMm = bounds.max[2] - bounds.min[2];
                      break;
                  }

                  const viewPlaneService = getViewPlaneService();
                  const pixelSize = viewPlaneService.calculatePixelSize(
                    widthMm,
                    heightMm,
                    newWidth,
                    newHeight,
                  );

                  storeLog("viewStateStore", "Frontend calculation:", {
                    extentMm: { width: widthMm, height: heightMm },
                    newDimensions: { width: newWidth, height: newHeight },
                    pixelSize,
                  });

                  let newOrigin: [number, number, number];
                  let newU: [number, number, number];
                  let newV: [number, number, number];
                  const currentView = currentState.viewState.views[viewType];

                  const signed = (
                    value: number,
                    fallbackSign: 1 | -1,
                  ): 1 | -1 => {
                    if (value > 0) return 1;
                    if (value < 0) return -1;
                    return fallbackSign;
                  };

                  switch (viewType) {
                    case "axial": {
                      const xSign = signed(currentView.u_mm[0], 1);
                      const ySign = signed(currentView.v_mm[1], -1);
                      newOrigin = [
                        xSign > 0 ? bounds.min[0] : bounds.max[0],
                        ySign > 0 ? bounds.min[1] : bounds.max[1],
                        crosshair[2],
                      ];
                      newU = [xSign * pixelSize, 0, 0];
                      newV = [0, ySign * pixelSize, 0];
                      break;
                    }
                    case "sagittal": {
                      const ySign = signed(currentView.u_mm[1], -1);
                      const zSign = signed(currentView.v_mm[2], -1);
                      newOrigin = [
                        crosshair[0],
                        ySign > 0 ? bounds.min[1] : bounds.max[1],
                        zSign > 0 ? bounds.min[2] : bounds.max[2],
                      ];
                      newU = [0, ySign * pixelSize, 0];
                      newV = [0, 0, zSign * pixelSize];
                      break;
                    }
                    case "coronal": {
                      const xSign = signed(currentView.u_mm[0], 1);
                      const zSign = signed(currentView.v_mm[2], -1);
                      newOrigin = [
                        xSign > 0 ? bounds.min[0] : bounds.max[0],
                        crosshair[1],
                        zSign > 0 ? bounds.min[2] : bounds.max[2],
                      ];
                      newU = [xSign * pixelSize, 0, 0];
                      newV = [0, 0, zSign * pixelSize];
                      break;
                    }
                  }

                  // Size the frame to the volume's bounding box (like the
                  // backend `ViewRectMm::full_extent` success path), NOT the
                  // measured canvas. The renderer letterbox-centers this tight
                  // image inside the (larger) canvas via `drawScaledImage`. Using
                  // the measured size here with a corner origin renders the
                  // volume flush-left in an oversized image, which the canvas
                  // then draws 1:1 — left-anchored. This is what broke orthogonal
                  // centering when a resize forced this fallback path.
                  const fallbackDimPx: [number, number] = [
                    Math.max(1, Math.ceil(widthMm / pixelSize)),
                    Math.max(1, Math.ceil(heightMm / pixelSize)),
                  ];

                  applyResizeUpdate((state) => {
                    storeLog(
                      "viewStateStore",
                      `Updating view state for ${viewType} with frontend calculation`,
                    );
                    state.views[viewType] = {
                      origin_mm: newOrigin,
                      u_mm: newU,
                      v_mm: newV,
                      dim_px: fallbackDimPx,
                    };
                  });
                } catch (boundsError) {
                  storeError(
                    "viewStateStore",
                    "Failed to get volume bounds:",
                    boundsError,
                  );
                  applyResizeUpdate((state) => {
                    state.views[viewType].dim_px = dimensions;
                  });
                }
              }
            },

            resetToDefaults: () => {
              const workspaceKey = getCurrentWorkspaceKey();
              crosshairRequests.delete(workspaceKey);
              for (const [key, pending] of resizeRequests) {
                if (pending.workspaceKey === workspaceKey) resizeRequests.delete(key);
              }
              const defaultState = getInitialViewState();
              if (areViewStatesEqual(get().viewState, defaultState)) {
                return;
              }

              applyViewStateUpdate(() => defaultState);
            },

            getView: (viewType) => get().viewState.views[viewType],
            getViews: () => get().viewState.views,
            getWorkspaceViewState: (workspaceId) => {
              const workspaceKey = toWorkspaceKey(
                workspaceId ?? get().activeWorkspaceKey,
              );
              return (
                get().workspaceViewStates.get(workspaceKey) ?? get().viewState
              );
            },
            getWorkspaceViewStateRevisions: (workspaceId) => {
              const workspaceKey = toWorkspaceKey(
                workspaceId ?? get().activeWorkspaceKey,
              );
              return (
                get().workspaceViewStateRevisions.get(workspaceKey) ??
                get().viewStateRevisions
              );
            },

            undo: () => {},
            redo: () => {},
            canUndo: () => false,
            canRedo: () => false,
          };
        }),
      ),
    ),
  );

// Export store with global instance sharing
export const useViewStateStore: ReturnType<typeof createViewStateStore> =
  (() => {
    if (typeof window !== "undefined" && window.__viewStateStore) {
      return window.__viewStateStore;
    }

    const store = createViewStateStore();

    const syncWithWorkspaceStore = (
      activeWorkspaceId: string | null,
      workspaceIds: Set<string>,
    ) => {
      coalesceUtils.discardPending();

      const nextActiveKey = toWorkspaceKey(activeWorkspaceId);
      const currentState = store.getState();
      const nextWorkspaceViewStates = new Map(currentState.workspaceViewStates);
      const nextWorkspaceViewStateRevisions = new Map(
        currentState.workspaceViewStateRevisions,
      );

      for (const key of Array.from(nextWorkspaceViewStates.keys())) {
        if (key !== DEFAULT_WORKSPACE_KEY && !workspaceIds.has(key)) {
          nextWorkspaceViewStates.delete(key);
          nextWorkspaceViewStateRevisions.delete(key);
        }
      }

      if (!nextWorkspaceViewStates.has(nextActiveKey)) {
        const seedState =
          currentState.activeWorkspaceKey === DEFAULT_WORKSPACE_KEY &&
          nextActiveKey !== DEFAULT_WORKSPACE_KEY
            ? cloneViewState(currentState.viewState)
            : getInitialViewState();
        const seedRevisions =
          currentState.activeWorkspaceKey === DEFAULT_WORKSPACE_KEY &&
          nextActiveKey !== DEFAULT_WORKSPACE_KEY
            ? cloneViewStateRevisions(currentState.viewStateRevisions)
            : createInitialViewStateRevisions();
        nextWorkspaceViewStates.set(nextActiveKey, seedState);
        nextWorkspaceViewStateRevisions.set(nextActiveKey, seedRevisions);
      }

      let nextViewState =
        nextWorkspaceViewStates.get(nextActiveKey) ?? getInitialViewState();
      let nextViewStateRevisions =
        nextWorkspaceViewStateRevisions.get(nextActiveKey) ??
        createInitialViewStateRevisions();

      // Layer data is global today (`layerStore` is not workspace-scoped), while
      // view geometry is now stored per workspace. If an existing/new workspace
      // snapshot is empty but the current compatibility surface already has
      // layers, seed the active workspace from that current state. Otherwise a
      // workspace activation can leave visible canvases with retained images but
      // `viewState.layers = []`, causing all crosshair/slice renders to be
      // skipped as "no layers".
      if (
        nextViewState.layers.length === 0 &&
        currentState.viewState.layers.length > 0 &&
        nextActiveKey !== currentState.activeWorkspaceKey
      ) {
        nextViewState = cloneViewState(currentState.viewState);
        nextViewStateRevisions = cloneViewStateRevisions(
          currentState.viewStateRevisions,
        );
        nextWorkspaceViewStates.set(nextActiveKey, nextViewState);
        nextWorkspaceViewStateRevisions.set(
          nextActiveKey,
          nextViewStateRevisions,
        );
      }

      store.setState({
        workspaceViewStates: nextWorkspaceViewStates,
        workspaceViewStateRevisions: nextWorkspaceViewStateRevisions,
        activeWorkspaceKey: nextActiveKey,
        viewState: nextViewState,
        viewStateRevisions: nextViewStateRevisions,
        resizeInFlight: getInitialResizeState(),
      });
    };

    let lastActiveWorkspaceId = useWorkspaceStore.getState().activeWorkspaceId;
    let lastWorkspaceIds = new Set(
      useWorkspaceStore.getState().workspaces.keys(),
    );

    syncWithWorkspaceStore(lastActiveWorkspaceId, lastWorkspaceIds);

    useWorkspaceStore.subscribe((workspaceState) => {
      const nextActiveWorkspaceId = workspaceState.activeWorkspaceId;
      const nextWorkspaceIds = new Set(workspaceState.workspaces.keys());

      const activeChanged = nextActiveWorkspaceId !== lastActiveWorkspaceId;
      const workspaceSetChanged =
        nextWorkspaceIds.size !== lastWorkspaceIds.size ||
        Array.from(nextWorkspaceIds).some((id) => !lastWorkspaceIds.has(id));

      if (!activeChanged && !workspaceSetChanged) {
        return;
      }

      lastActiveWorkspaceId = nextActiveWorkspaceId;
      lastWorkspaceIds = nextWorkspaceIds;
      syncWithWorkspaceStore(nextActiveWorkspaceId, nextWorkspaceIds);
    });

    if (typeof window !== "undefined") {
      window.__viewStateStore = store;
    }

    return store;
  })();
