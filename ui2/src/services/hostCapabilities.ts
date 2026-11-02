/** One host capability vocabulary for transports and module requirements. */
export interface HostCapabilities {
  nativePaths: boolean;
  remoteMounts: boolean;
  externalProcesses: boolean;
  localNifti3D: boolean;
  scalarOverlays: boolean;
  linkedSlices: boolean;
  labels: boolean;
  timeSeries: boolean;
  surfaces: boolean;
  surfaceScalarOverlays: boolean;
  surfaceLabels: boolean;
}
export type HostCapability = keyof HostCapabilities;

export const desktopCapabilities: Readonly<HostCapabilities> = Object.freeze({
  nativePaths: true, remoteMounts: true, externalProcesses: true,
  localNifti3D: true, scalarOverlays: true, linkedSlices: true,
  labels: true, timeSeries: true, surfaces: true, surfaceScalarOverlays: true, surfaceLabels: true,
});
export const browserCapabilities: Readonly<HostCapabilities> = Object.freeze({
  ...desktopCapabilities, nativePaths: false, remoteMounts: false, externalProcesses: false,
});
