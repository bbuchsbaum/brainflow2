/**
 * @brainflow/api v0.1.1 - Core TypeScript Interfaces
 */
// Import and re-export generated types
export * from './generated';
// Note: Error types are replaced by BridgeError from generated types
// Note: VolumeSendable is not exposed to TypeScript as it contains raw volume data
// Instead, we use VolumeHandleInfo which contains the metadata needed by the frontend
// Note: VolumeLayerGPU is replaced by VolumeLayerGpuInfo from generated types
