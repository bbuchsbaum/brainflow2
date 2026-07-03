/**
 * @brainflow/api v0.1.1 - Core TypeScript Interfaces
 */
// The generated api-bridge command list is a runtime value, so it needs a value
// re-export (`export type *` above only carries type-level exports).
export { apiBridgeCommands } from './generated/apiBridgeCommands.js';
export * from './helpers.js';
export * from './renderClient.js';
// Note: Error types are replaced by BridgeError from generated types
// Note: VolumeSendable is not exposed to TypeScript as it contains raw volume data
// Instead, we use VolumeHandleInfo which contains the metadata needed by the frontend
// Note: VolumeLayerGPU is replaced by VolumeLayerGpuInfo from generated types
