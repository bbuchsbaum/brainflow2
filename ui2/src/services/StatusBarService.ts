/**
 * StatusBarService - Manages status bar updates without causing render loops
 * Uses a singleton pattern to avoid hook dependency issues
 */

import { throttle, debounce } from 'lodash';
import { getEventBus } from '@/events/EventBus';
import { useViewStateStore } from '@/stores/viewStateStore';
import { useStatusBarStore } from '@/stores/statusBarStore';

/**
 * Format coordinates for display
 */
const formatCoord = (coord: [number, number, number]): string => {
  return `(${coord[0].toFixed(1)}, ${coord[1].toFixed(1)}, ${coord[2].toFixed(1)})`;
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
    
    // Subscribe to crosshair position changes with debouncing
    const unsubscribeCrosshair = useViewStateStore.subscribe(
      state => state.viewState.crosshair,
      crosshair => {
        if (isCurrentInit()) {
          this.updateCrosshair(crosshair.world_mm);
        }
      }
    );
    this.unsubscribers.push(unsubscribeCrosshair);

    // Set initial crosshair value immediately
    const initialCrosshair = useViewStateStore.getState().viewState.crosshair;
    if (isCurrentInit()) {
      setValue('crosshair', formatCoord(initialCrosshair.world_mm));
    }

    // Subscribe to layer changes
    const unsubscribeLayers = useViewStateStore.subscribe(
      state => state.viewState.layers,
      layers => {
        if (isCurrentInit()) {
          const activeLayer = layers.find(l => l.visible);
          if (activeLayer) {
            setValue('layer', activeLayer.name || activeLayer.id);
          } else {
            setValue('layer', 'None');
          }
        }
      }
    );
    this.unsubscribers.push(unsubscribeLayers);

    // Subscribe to mouse events
    const eventBus = getEventBus();
    
    const unsubscribeMouseCoord = eventBus.on('mouse.worldCoordinate', (data) => {
      if (isCurrentInit()) {
        this.updateMousePosition(data.world_mm);
      }
    });
    this.unsubscribers.push(unsubscribeMouseCoord);

    const unsubscribeMouseLeave = eventBus.on('mouse.leave', () => {
      if (isCurrentInit()) {
        setValue('mouse', '--');
      }
    });
    this.unsubscribers.push(unsubscribeMouseLeave);

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