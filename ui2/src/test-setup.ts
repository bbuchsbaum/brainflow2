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
        fov_mm: [200, 200] as [number, number],
      },
      sagittal: {
        origin_mm: [0, 0, 0] as [number, number, number],
        u_mm: [0, 1, 0] as [number, number, number],
        v_mm: [0, 0, -1] as [number, number, number],
        fov_mm: [200, 200] as [number, number],
      },
      coronal: {
        origin_mm: [0, 0, 0] as [number, number, number],
        u_mm: [1, 0, 0] as [number, number, number],
        v_mm: [0, 0, -1] as [number, number, number],
        fov_mm: [200, 200] as [number, number],
      },
    },
    layers: [],
  };
}