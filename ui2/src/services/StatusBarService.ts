/**
 * StatusBarService - Manages status bar updates without causing render loops
 * Uses a singleton pattern to avoid hook dependency issues
 */

import { throttle, debounce } from 'lodash';
import { getEventBus } from '@/events/EventBus';
import { useViewStateStore } from '@/stores/viewStateStore';
import { useStatusBarStore } from '@/stores/statusBarStore';
import { useMouseCoordinateStore } from '@/stores/mouseCoordinateStore';
import type { AtlasStats } from '@/types/atlas';

/**
 * Format coordinates for display
 */
const formatCoord = (coord: [number, number, number]): string => {
  return `(${coord[0].toFixed(1)}, ${coord[1].toFixed(1)}, ${coord[2].toFixed(1)})`;
};

type AtlasSeverity = 'warning' | 'critical' | 'recovered' | undefined;

const formatAtlasSummary = (stats: AtlasStats, severity: AtlasSeverity = undefined): string => {
  const base = `Atlas ${stats.usedLayers}/${stats.totalLayers}`;
  const free = `${stats.freeLayers} free`;
  const events = stats.fullEvents > 0 ? `full x${stats.fullEvents}` : null;

  let status: string | null = null;
  if (severity === 'critical') {
    status = 'CRITICAL';
  } else if (severity === 'warning') {
    status = 'Warning';
  } else if (severity === 'recovered') {
    status = 'Recovered';
  }

  return [base, free, events, status].filter(Boolean).join(' · ');
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

  private constructor() {
    // Get the store methods
    const { setValue } = useStatusBarStore.getState();
    
    // Initialize throttled/debounced methods
    this.updateMousePosition = throttle((worldMm: [number, number, number]) => {
      if (this.isInitialized) {
        setValue('mouse', formatCoord(worldMm));
      }
    }, 50); // Update at most every 50ms
    
    this.updateFPS = throttle((fps: number) => {
      if (this.isInitialized) {
        setValue('fps', `${fps.toFixed(1)} fps`);
      }
    }, 250); // Update FPS every 250ms
    
    this.updateCrosshair = debounce((worldMm: [number, number, number]) => {
      if (this.isInitialized) {
        setValue('crosshair', formatCoord(worldMm));
      }
    }, 10); // Debounce crosshair updates by 10ms
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
      console.log('[StatusBarService] Already initialized, skipping');
      return;
    }

    // Create a unique ID for this initialization
    const currentInitId = this.initializationId = Symbol('init');
    this.isInitialized = true;

    console.log('[StatusBarService] Initializing service');
    
    // Set up subscriptions with initialization check
    this.setupSubscriptions(currentInitId);
  }
  
  private setupSubscriptions(initId: symbol) {
    // Helper to check if this is still the current initialization
    const isCurrentInit = () => this.initializationId === initId;
    const { setValue } = useStatusBarStore.getState();

    // Subscribe with a full-state listener to avoid selector identity pitfalls.
    const unsubscribeViewState = useViewStateStore.subscribe((state, prevState) => {
      if (!isCurrentInit()) {
        return;
      }

      const worldMm = state.viewState.crosshair.world_mm;
      const prevWorldMm = prevState?.viewState.crosshair.world_mm;
      const crosshairChanged = !prevWorldMm ||
        prevWorldMm[0] !== worldMm[0] ||
        prevWorldMm[1] !== worldMm[1] ||
        prevWorldMm[2] !== worldMm[2];
      if (crosshairChanged) {
        this.updateCrosshair(worldMm);
      }

      const layers = state.viewState.layers;
      const prevLayers = prevState?.viewState.layers;
      if (layers !== prevLayers) {
        const activeLayer = layers.find(l => l.visible);
        if (activeLayer) {
          setValue('layer', activeLayer.name || activeLayer.id);
        } else {
          setValue('layer', 'None');
        }
      }
    });
    this.unsubscribers.push(unsubscribeViewState);

    // Set initial crosshair value immediately
    const initialCrosshair = useViewStateStore.getState().viewState.crosshair;
    if (isCurrentInit()) {
      setValue('crosshair', formatCoord(initialCrosshair.world_mm));
    }
    const initialLayers = useViewStateStore.getState().viewState.layers;
    if (isCurrentInit()) {
      const activeLayer = initialLayers.find(l => l.visible);
      if (activeLayer) {
        setValue('layer', activeLayer.name || activeLayer.id);
      } else {
        setValue('layer', 'None');
      }
    }

    // Subscribe to mouse coordinate changes from Zustand store
    const unsubscribeMouseCoord = useMouseCoordinateStore.subscribe(
      state => state.worldCoordinates,
      worldCoordinates => {
        if (isCurrentInit()) {
          if (worldCoordinates) {
            this.updateMousePosition(worldCoordinates);
          } else {
            setValue('mouse', '--');
          }
        }
      }
    );
    this.unsubscribers.push(unsubscribeMouseCoord);
    
    // Note: We still need EventBus for legacy events, but mouse coordinates now use Zustand
    const eventBus = getEventBus();
    let atlasSeverity: AtlasSeverity = undefined;

    const updateAtlasSlot = (stats: AtlasStats, severity: AtlasSeverity = atlasSeverity) => {
      atlasSeverity = severity;
      setValue('atlas', formatAtlasSummary(stats, severity));
    };

    const unsubscribeAtlasMetrics = eventBus.on('atlas.metrics', ({ stats }) => {
      if (isCurrentInit()) {
        updateAtlasSlot(stats);
      }
    });
    this.unsubscribers.push(unsubscribeAtlasMetrics);

    const unsubscribeAtlasPressure = eventBus.on('atlas.pressure', ({ stats, level }) => {
      if (isCurrentInit()) {
        updateAtlasSlot(stats, level);
      }
    });
    this.unsubscribers.push(unsubscribeAtlasPressure);

    const unsubscribeAtlasEviction = eventBus.on('atlas.eviction', ({ stats }) => {
      if (isCurrentInit() && stats) {
        updateAtlasSlot(stats, 'warning');
      }
    });
    this.unsubscribers.push(unsubscribeAtlasEviction);

    // Subscribe to FPS updates with throttling
    const unsubscribeFps = eventBus.on('render.fps', (data: any) => {
      if (data.fps !== undefined && isCurrentInit()) {
        this.updateFPS(data.fps);
      }
    });
    this.unsubscribers.push(unsubscribeFps);

    // Subscribe to GPU status
    const unsubscribeGpu = eventBus.on('gpu.status', (data: any) => {
      if (data.status && isCurrentInit()) {
        setValue('gpu', data.status);
      }
    });
    this.unsubscribers.push(unsubscribeGpu);

    console.log('[StatusBarService] Initialized with', this.unsubscribers.length, 'subscriptions');
  }

  /**
   * Cleanup all subscriptions
   */
  cleanup() {
    // Cancel any pending throttled/debounced calls
    this.updateMousePosition?.cancel?.();
    this.updateFPS?.cancel?.();
    this.updateCrosshair?.cancel?.();
    
    this.unsubscribers.forEach(unsubscribe => {
      try {
        unsubscribe();
      } catch (error) {
        console.error('[StatusBarService] Error during cleanup:', error);
      }
    });
    this.unsubscribers = [];
    this.isInitialized = false;
    this.initializationId = null;
    console.log('[StatusBarService] Cleaned up');
  }

  /**
   * Check if service is initialized
   */
  isReady(): boolean {
    return this.isInitialized;
  }
}

export const getStatusBarService = () => StatusBarService.getInstance();
