export interface BrowserVolume {
  id: string;
  name: string;
  dims: number[];
  affine: number[][];
  center: [number, number, number];
  bounds: [[number, number, number], [number, number, number]];
  range: [number, number];
}

export const browserCapabilities = Object.freeze({
  localNifti3D: true,
  scalarOverlays: true,
  linkedSlices: true,
  nativePaths: false,
  remoteMounts: false,
  externalProcesses: false,
  labels: false,
  timeSeries: false,
  surfaces: false,
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
