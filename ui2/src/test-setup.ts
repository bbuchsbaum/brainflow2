import '@testing-library/jest-dom';
import { MockTransport, setTransport } from '@/services/transport';
import { ApiService, setApiService } from '@/services/apiService';

// Setup mock transport for all tests
beforeEach(() => {
  const mockTransport = new MockTransport();
  setTransport(mockTransport);
  setApiService(new ApiService(mockTransport));
});

// Mock Tauri API
vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}));

// Mock ImageData for tests
global.ImageData = class ImageData {
  data: Uint8ClampedArray;
  width: number;
  height: number;
  constructor(dataOrWidth: Uint8ClampedArray | number, widthOrHeight?: number, height?: number) {
    if (dataOrWidth instanceof Uint8ClampedArray) {
      this.data = dataOrWidth;
      this.width = widthOrHeight!;
      this.height = height!;
    } else {
      this.width = dataOrWidth;
      this.height = widthOrHeight!;
      this.data = new Uint8ClampedArray(dataOrWidth * widthOrHeight! * 4);
    }
  }
} as any;

// Mock ImageBitmap for tests
global.ImageBitmap = class ImageBitmap {
  width: number;
  height: number;
  constructor() {
    this.width = 256;
    this.height = 256;
  }
  close() {}
} as any;

global.createImageBitmap = vi.fn().mockResolvedValue(new global.ImageBitmap());

// Mock OffscreenCanvas for tests
global.OffscreenCanvas = vi.fn().mockImplementation((width, height) => ({
  width,
  height,
  getContext: vi.fn(() => ({
    fillRect: vi.fn(),
    clearRect: vi.fn(),
    fillStyle: '',
    fillText: vi.fn(),
    textAlign: '',
    font: '',
    drawImage: vi.fn(),
    getImageData: vi.fn(() => ({
      data: new Uint8ClampedArray(width * height * 4),
      width,
      height,
    })),
  })),
})) as any;

// Mock canvas for coordinate transform tests
Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', {
  value: vi.fn(() => ({
    fillRect: vi.fn(),
    clearRect: vi.fn(),
    getImageData: vi.fn(() => ({ data: new Array(4) })),
    putImageData: vi.fn(),
    createImageData: vi.fn(() => ({ data: new Array(4) })),
    setTransform: vi.fn(),
    drawImage: vi.fn(),
    save: vi.fn(),
    fillText: vi.fn(),
    restore: vi.fn(),
    beginPath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    closePath: vi.fn(),
    stroke: vi.fn(),
    translate: vi.fn(),
    scale: vi.fn(),
    rotate: vi.fn(),
    arc: vi.fn(),
    fill: vi.fn(),
    measureText: vi.fn(() => ({ width: 0 })),
    transform: vi.fn(),
    rect: vi.fn(),
    clip: vi.fn(),
    setLineDash: vi.fn(), // Add missing method for crosshair rendering
    getLineDash: vi.fn(() => []),
    lineDashOffset: 0,
  })),
});

// Global test utilities
export function createMockViewState() {
  return {
    crosshair: {
      world_mm: [0, 0, 0] as [number, number, number],
      visible: true,
    },
    views: {
      axial: {
        origin_mm: [0, 0, 0] as [number, number, number],
        u_mm: [1, 0, 0] as [number, number, number],
        v_mm: [0, 1, 0] as [number, number, number],
        dim_px: [512, 512] as [number, number],
      },
      sagittal: {
        origin_mm: [0, 0, 0] as [number, number, number],
        u_mm: [0, 1, 0] as [number, number, number],
        v_mm: [0, 0, -1] as [number, number, number],
        dim_px: [512, 512] as [number, number],
      },
      coronal: {
        origin_mm: [0, 0, 0] as [number, number, number],
        u_mm: [1, 0, 0] as [number, number, number],
        v_mm: [0, 0, -1] as [number, number, number],
        dim_px: [512, 512] as [number, number],
      },
    },
    layers: [],
  };
}

export function createMockViewStateStore() {
  const viewState = createMockViewState();
  const storeApi = {
    viewState,
    resizeInFlight: { axial: null, sagittal: null, coronal: null, mosaic: null, surface: null },
    setViewState: vi.fn(),
    setCrosshair: vi.fn().mockResolvedValue(undefined),
    setCrosshairVisible: vi.fn(),
    updateView: vi.fn(),
    updateViewDimensions: vi.fn().mockResolvedValue(undefined),
    updateDimensionsAndPreserveScale: vi.fn().mockResolvedValue(undefined),
    getView: vi.fn((viewType: string) => viewState.views[viewType as keyof typeof viewState.views]),
    getViews: vi.fn(() => viewState.views),
    undo: vi.fn(),
    redo: vi.fn(),
    canUndo: vi.fn(() => false),
    canRedo: vi.fn(() => false),
    resetToDefaults: vi.fn(),
  };

  // Create a Zustand-like hook that also has getState() method
  const mockHook = Object.assign(
    () => storeApi,
    {
      getState: () => storeApi,
      setState: vi.fn(),
      subscribe: vi.fn(() => vi.fn()),
      destroy: vi.fn(),
    }
  );

  return mockHook;
}

export function createMockLayer(overrides?: Partial<any>) {
  return {
    id: 'test-layer',
    volumeId: 'test-volume',
    name: 'Test Volume',
    type: 'volume' as const,
    visible: true,
    opacity: 1,
    colormap: 'gray',
    intensity: [0, 100] as [number, number],
    threshold: [0, 100] as [number, number],
    source: { type: 'file' as const, path: '/test/volume.nii' },
    ...overrides,
  };
}