import type { AtlasPaletteLegendEntry } from '../../types/atlasPalette';
export interface BrowserVolume {
  id: string;
  name: string;
  dims: number[];
  affine: number[][];
  center: [number, number, number];
  bounds: [[number, number, number], [number, number, number]];
  range: [number, number];
  /** Total independently selectable frames; 1 for a scalar 3D image. */
  frameCount: number;
  /** The frame currently resident in the renderer. */
  currentFrame: number;
  labelIds?: number[] | null;
  legend?: AtlasPaletteLegendEntry[];
}

export interface BrowserGpuCapabilities {
  volumeSlots: number;
  sampledTextureLimit: number;
  float32Filterable: boolean;
}

export const browserCapabilities = Object.freeze({
  localNifti3D: true,
  scalarOverlays: true,
  linkedSlices: true,
  nativePaths: false,
  remoteMounts: false,
  externalProcesses: false,
  labels: true,
  timeSeries: true,
  surfaces: true,
});

export type WorkerRequest =
  | { id: number; cmd: string; args?: unknown }
  | { cancel: number }
  | { ack: number };
export interface WorkerReply {
  id: number;
  value?: unknown;
  error?: string;
}

export class UnsupportedBrowserCapability extends Error {
  readonly code = 'UNSUPPORTED_BROWSER_CAPABILITY';
  constructor(command: string) {
    super(
      `“${command}” is unavailable in the browser viewer. Use the desktop app for this operation.`,
    );
  }
}

/** Transferred arrays have a single UI/canvas owner; the worker retains no mesh. */
export interface BrowserSurface {
  id: string;
  name: string;
  vertices: Float32Array;
  faces: Uint32Array;
  hemisphere: string;
}
