/**
 * StatusBarService - Manages status bar updates without causing render loops
 * Uses a singleton pattern to avoid hook dependency issues
 */

import { throttle, debounce } from "lodash";
import { getEventBus } from "@/events/EventBus";
import { useViewStateStore } from "@/stores/viewStateStore";
import { useStatusBarStore } from "@/stores/statusBarStore";
import { useMouseCoordinateStore } from "@/stores/mouseCoordinateStore";
import { useLayerStore } from "@/stores/layerStore";
import { formatWorldMm } from "@/utils/valueFormat";
import { activeVolumeLayerId, resolveActiveLayerName } from "@/utils/activeLayer";
import { useInspectorSelectionStore } from "@/stores/inspectorSelectionStore";
import { useStatusReadoutStore } from "@/stores/statusReadoutStore";
import {
  resolveAtlasRegionAtWorld,
  regionReadoutText,
  findActiveAtlasLayer,
} from "@/services/atlasRegionLookup";
import { resolveLayerVoxelGrid, sameVoxel } from "@/utils/voxelSnap";
import type { AtlasStats } from "@/types/atlas";

/**
 * Format coordinates for display
 */
const formatCoord = (coord: [number, number, number]): string => {
  return `(${formatWorldMm(coord[0])}, ${formatWorldMm(coord[1])}, ${formatWorldMm(coord[2])})`;
};

/** Layer slot: selected layer, else top visible (shared with the viewport header). */
const setLayerSlot = (setValue: (id: string, value: string) => void) => {
  const name = resolveActiveLayerName(
    useViewStateStore.getState().viewState.layers,
    useLayerStore.getState().selectedLayerId,
  );
  setValue("layer", name ?? "None");
};

/**
 * The layer the Layer/Value slots report (StatusBar's `resolveStatusLayer`:
 * a Compare pane's claim, else the active-layer rule). Region reads the same
 * layer when it is an atlas, so the three slots never mix atlases.
 */
const statusLayerId = (): string | null =>
  useStatusReadoutStore.getState().override?.layerId ??
  activeVolumeLayerId(useViewStateStore.getState().viewState.layers);

type AtlasSeverity = "warning" | "critical" | "recovered" | undefined;

const formatAtlasSummary = (
  stats: AtlasStats,
  severity: AtlasSeverity = undefined,
): string => {
  const base = stats.is3D
    ? `3D atlas ${stats.usedLayers > 0 ? "occupied" : "idle"}`
    : `Atlas ${stats.usedLayers}/${stats.totalLayers}`;
  const free = stats.is3D ? null : `${stats.freeLayers} free`;
  const events = stats.fullEvents > 0 ? `full x${stats.fullEvents}` : null;

  let status: string | null = null;
  if (severity === "critical") {
    status = "CRITICAL";
  } else if (severity === "warning") {
    status = "Warning";
  } else if (severity === "recovered") {
    status = "Recovered";
  }

  return [base, free, events, status].filter(Boolean).join(" · ");
};

export class StatusBarService {
  private static instance: StatusBarService;
  private unsubscribers: (() => void)[] = [];
  private isInitialized = false;
  private initializationId: symbol | null = null;

  // Throttled update methods
  private updateMousePosition: any;
  private updateFPS: any;
  private updateCrosshair: any;
  private updateRegion: any;
  private regionRequest = 0;
  private updatePointerRegion: ReturnType<typeof throttle<(worldMm: [number, number, number]) => void>>;
  private pointerRegionRequest = 0;

  private constructor() {
    // Get the store methods
    const { setValue } = useStatusBarStore.getState();

    // Initialize throttled/debounced methods
    this.updateMousePosition = throttle((worldMm: [number, number, number]) => {
      if (this.isInitialized) {
        setValue("mouse", formatCoord(worldMm));
      }
    }, 50); // Update at most every 50ms

    this.updateFPS = throttle((fps: number) => {
      if (this.isInitialized) {
        setValue("fps", `${fps.toFixed(1)} fps`);
      }
    }, 250); // Update FPS every 250ms

    this.updateCrosshair = debounce((worldMm: [number, number, number]) => {
      if (this.isInitialized) {
        setValue("crosshair", formatCoord(worldMm));
      }
    }, 10); // Debounce crosshair updates by 10ms

    // Atlas region under the crosshair. Sampling hits the backend, so debounce
    // more aggressively than the plain crosshair coordinate readout.
    this.updateRegion = debounce((worldMm: [number, number, number]) => {
      void this.refreshRegion(worldMm);
    }, 80);

    // Region under the pointer (status bar Pointer group): throttled, so it
    // keeps up with a moving pointer.
    this.updatePointerRegion = throttle(
      (worldMm: [number, number, number]) => {
        void this.refreshPointerRegion(worldMm);
      },
      50,
      { leading: true, trailing: true },
    );
  }

  /** The atlas grid the region readouts are looked up on (null: compare exactly). */
  private atlasGrid() {
    const atlas = findActiveAtlasLayer(statusLayerId());
    const { layers, layerMetadata } = useLayerStore.getState();
    return atlas ? resolveLayerVoxelGrid(atlas.id, layers, layerMetadata) : null;
  }

  /** Blank the pointer region (pointer left, or a lookup for a new voxel is pending). */
  private clearPointerRegion() {
    const { values, setBatch } = useStatusBarStore.getState();
    if (values.pointerRegion == null && values.pointerRegionColor == null) return;
    setBatch([
      ["pointerRegion", null],
      ["pointerRegionColor", null],
    ]);
  }

  /**
   * Region under the pointer, for the reported layer's atlas. Never stale:
   * a result is written only while the pointer is still in the voxel it was
   * looked up for, and the slot is blanked as soon as the pointer leaves it.
   */
  private pointerRegionAt: [number, number, number] | null = null;
  private onPointerMove(worldMm: [number, number, number] | null) {
    if (!worldMm) {
      this.updatePointerRegion?.cancel?.();
      this.pointerRegionRequest++;
      this.pointerRegionAt = null;
      this.clearPointerRegion();
      return;
    }
    if (this.pointerRegionAt && !sameVoxel(this.pointerRegionAt, worldMm, this.atlasGrid())) {
      this.pointerRegionAt = null;
      this.clearPointerRegion();
    }
    this.updatePointerRegion(worldMm);
  }

  private async refreshPointerRegion(worldMm: [number, number, number]) {
    if (!this.isInitialized) return;
    const request = ++this.pointerRegionRequest;
    let hit: Awaited<ReturnType<typeof resolveAtlasRegionAtWorld>> = null;
    let reported: string | null | undefined;
    try {
      reported = statusLayerId();
      hit = await resolveAtlasRegionAtWorld(worldMm, reported);
    } catch (error) {
      console.warn("[StatusBarService] Pointer region lookup failed:", error);
    }
    if (request !== this.pointerRegionRequest || !this.isInitialized) return;
    const pointer = useMouseCoordinateStore.getState().worldCoordinates;
    if (!pointer || !sameVoxel(pointer, worldMm, this.atlasGrid())) return;
    this.pointerRegionAt = worldMm;
    useStatusBarStore.getState().setBatch([
      ["pointerRegion", hit ? regionReadoutText(hit, reported) : "--"],
      [
        "pointerRegionColor",
        hit ? `rgb(${hit.entry.color[0]}, ${hit.entry.color[1]}, ${hit.entry.color[2]})` : null,
      ],
    ]);
  }

  /**
   * Resolve and display the atlas region under a world coordinate in the
   * 'region' status slot. No-ops to '--' when there is no atlas layer, the
   * point is background, or the label is unmapped.
   */
  private async refreshRegion(worldMm: [number, number, number]) {
    if (!this.isInitialized) {
      return;
    }
    const { setValue } = useStatusBarStore.getState();
    const request = ++this.regionRequest;
    try {
      const reported = statusLayerId();
      const hit = await resolveAtlasRegionAtWorld(worldMm, reported);
      // A newer lookup (crosshair move, layer switch) supersedes this one.
      if (request !== this.regionRequest) return;
      if (this.isInitialized) {
        setValue("region", hit ? regionReadoutText(hit, reported) : "--");
        // LUT colour of the region, for the slot's swatch.
        setValue(
          "regionColor",
          hit ? `rgb(${hit.entry.color[0]}, ${hit.entry.color[1]}, ${hit.entry.color[2]})` : null,
        );
      }
    } catch (error) {
      console.warn("[StatusBarService] Atlas region lookup failed:", error);
      if (request === this.regionRequest && this.isInitialized) {
        setValue("region", "--");
        setValue("regionColor", null);
      }
    }
  }

  static getInstance(): StatusBarService {
    if (!StatusBarService.instance) {
      StatusBarService.instance = new StatusBarService();
    }
    return StatusBarService.instance;
  }

  /**
   * Initialize the service (no longer needs status updater)
   */
  initialize() {
    if (this.isInitialized) {
      console.log("[StatusBarService] Already initialized, skipping");
      return;
    }

    // Create a unique ID for this initialization
    const currentInitId = (this.initializationId = Symbol("init"));
    this.isInitialized = true;

    console.log("[StatusBarService] Initializing service");

    // Set up subscriptions with initialization check
    this.setupSubscriptions(currentInitId);
  }

  private setupSubscriptions(initId: symbol) {
    // Helper to check if this is still the current initialization
    const isCurrentInit = () => this.initializationId === initId;
    const { setValue } = useStatusBarStore.getState();

    // Subscribe with a full-state listener to avoid selector identity pitfalls.
    const unsubscribeViewState = useViewStateStore.subscribe(
      (state, prevState) => {
        if (!isCurrentInit()) {
          return;
        }

        const worldMm = state.viewState.crosshair.world_mm;
        const prevWorldMm = prevState?.viewState.crosshair.world_mm;
        const crosshairChanged =
          !prevWorldMm ||
          prevWorldMm[0] !== worldMm[0] ||
          prevWorldMm[1] !== worldMm[1] ||
          prevWorldMm[2] !== worldMm[2];
        if (crosshairChanged) {
          this.updateCrosshair(worldMm);
          this.updateRegion(worldMm);
        }

        const layers = state.viewState.layers;
        const prevLayers = prevState?.viewState.layers;
        if (layers !== prevLayers) {
          setLayerSlot(setValue);
        }
      },
    );
    this.unsubscribers.push(unsubscribeViewState);

    // Set initial crosshair value immediately
    const initialCrosshair = useViewStateStore.getState().viewState.crosshair;
    if (isCurrentInit()) {
      setValue("crosshair", formatCoord(initialCrosshair.world_mm));
    }
    if (isCurrentInit()) {
      setLayerSlot(setValue);
    }
    // Both region readouts follow the reported layer.
    const refreshRegionAtCrosshair = () => {
      this.updateRegion(useViewStateStore.getState().viewState.crosshair.world_mm);
      const pointer = useMouseCoordinateStore.getState().worldCoordinates;
      if (pointer) {
        this.pointerRegionAt = null;
        this.clearPointerRegion();
        this.updatePointerRegion([pointer[0], pointer[1], pointer[2]]);
      }
    };
    const unsubscribeSelection = useLayerStore.subscribe(
      (state) => state.selectedLayerId,
      () => {
        if (isCurrentInit()) {
          setLayerSlot(setValue);
          refreshRegionAtCrosshair();
        }
      },
    );
    this.unsubscribers.push(unsubscribeSelection);
    // Region follows the reported layer: re-read it when the Inspector item
    // or a Compare pane's readout claim changes which layer that is.
    let lastInspectorItem = useInspectorSelectionStore.getState().activeItemId;
    const unsubscribeInspector = useInspectorSelectionStore.subscribe((state) => {
      if (state.activeItemId === lastInspectorItem) return;
      lastInspectorItem = state.activeItemId;
      if (isCurrentInit()) refreshRegionAtCrosshair();
    });
    this.unsubscribers.push(unsubscribeInspector);
    const unsubscribeReadout = useStatusReadoutStore.subscribe((state, prev) => {
      if (state.override?.layerId === prev.override?.layerId) return;
      if (isCurrentInit()) refreshRegionAtCrosshair();
    });
    this.unsubscribers.push(unsubscribeReadout);

    // Refresh the region readout when the layer set changes (an atlas is loaded,
    // removed, or its palette legend is populated) so the slot reflects the
    // parcel under the current crosshair without waiting for the next move.
    const unsubscribeLayers = useLayerStore.subscribe(
      (state) => state.layers,
      () => {
        if (isCurrentInit()) refreshRegionAtCrosshair();
      },
    );
    this.unsubscribers.push(unsubscribeLayers);

    // Seed the region slot from the current crosshair.
    if (isCurrentInit()) {
      this.updateRegion(initialCrosshair.world_mm);
    }

    // Subscribe to mouse coordinate changes from Zustand store
    const unsubscribeMouseCoord = useMouseCoordinateStore.subscribe(
      (state) => state.worldCoordinates,
      (worldCoordinates) => {
        if (isCurrentInit()) {
          if (worldCoordinates) {
            this.updateMousePosition(worldCoordinates);
          } else {
            this.updateMousePosition.cancel?.();
            setValue("mouse", "--");
          }
          this.onPointerMove(
            worldCoordinates
              ? [worldCoordinates[0], worldCoordinates[1], worldCoordinates[2]]
              : null,
          );
        }
      },
    );
    this.unsubscribers.push(unsubscribeMouseCoord);

    // Note: We still need EventBus for legacy events, but mouse coordinates now use Zustand
    const eventBus = getEventBus();
    let atlasSeverity: AtlasSeverity = undefined;

    const updateAtlasSlot = (
      stats: AtlasStats,
      severity: AtlasSeverity = atlasSeverity,
    ) => {
      atlasSeverity = severity;
      setValue("atlas", formatAtlasSummary(stats, severity));
    };

    const unsubscribeAtlasMetrics = eventBus.on(
      "atlas.metrics",
      ({ stats }) => {
        if (isCurrentInit()) {
          updateAtlasSlot(stats);
        }
      },
    );
    this.unsubscribers.push(unsubscribeAtlasMetrics);

    const unsubscribeAtlasPressure = eventBus.on(
      "atlas.pressure",
      ({ stats, level }) => {
        if (isCurrentInit()) {
          updateAtlasSlot(stats, level);
        }
      },
    );
    this.unsubscribers.push(unsubscribeAtlasPressure);

    const unsubscribeAtlasEviction = eventBus.on(
      "atlas.eviction",
      ({ stats }) => {
        if (isCurrentInit() && stats) {
          updateAtlasSlot(stats, "warning");
        }
      },
    );
    this.unsubscribers.push(unsubscribeAtlasEviction);

    // Subscribe to FPS updates with throttling
    const unsubscribeFps = eventBus.on("render.fps", (data: any) => {
      if (data.fps !== undefined && isCurrentInit()) {
        this.updateFPS(data.fps);
      }
    });
    this.unsubscribers.push(unsubscribeFps);

    // Subscribe to GPU status
    const unsubscribeGpu = eventBus.on("gpu.status", (data: any) => {
      if (data.status && isCurrentInit()) {
        setValue("gpu", data.status);
      }
    });
    this.unsubscribers.push(unsubscribeGpu);

    console.log(
      "[StatusBarService] Initialized with",
      this.unsubscribers.length,
      "subscriptions",
    );
  }

  /**
   * Cleanup all subscriptions
   */
  cleanup() {
    // Cancel any pending throttled/debounced calls
    this.updateMousePosition?.cancel?.();
    this.updateFPS?.cancel?.();
    this.updateCrosshair?.cancel?.();
    this.updateRegion?.cancel?.();
    this.updatePointerRegion?.cancel?.();
    this.pointerRegionAt = null;

    this.unsubscribers.forEach((unsubscribe) => {
      try {
        unsubscribe();
      } catch (error) {
        console.error("[StatusBarService] Error during cleanup:", error);
      }
    });
    this.unsubscribers = [];
    this.isInitialized = false;
    this.initializationId = null;
    console.log("[StatusBarService] Cleaned up");
  }

  /**
   * Check if service is initialized
   */
  isReady(): boolean {
    return this.isInitialized;
  }
}

export const getStatusBarService = () => StatusBarService.getInstance();
