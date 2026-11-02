import { useMemo } from 'react';
import { useCrosshairSettingsStore } from '@/stores/crosshairSettingsStore';
import { buildActiveCrosshairStyle } from '@/utils/crosshairUtils';
/**
 * App services for a module's lazily loaded code (components, services,
 * stores). This is the module's only way into the app besides
 * `activate(ctx)`: modules never import core stores, services or Tauri
 * directly (eslint.boundaries.js). Add a facade here when a module needs one;
 * keep each a thin, documented pass-through.
 *
 * Not imported by manifests: it loads app services, which `@/modules/api`
 * must not.
 */

import type { BridgeModuleCommand, BridgeModuleId, VolumeHandleInfo, ViewRectMm } from '@brainflow/api';
import { getTransport } from '@/services/transport';
import { getFileLoadingService } from '@/services/FileLoadingService';
import { getSurfaceLoadingService } from '@/services/SurfaceLoadingService';
import { moduleRegistry } from '@/modules/registry';
import { useWorkspaceStore } from '@/stores/workspaceStore';
import { useLayerStore, type VolumeMetadata } from '@/stores/layerStore';
export type { WorkspaceDocumentIdentity, RetainWorkspaceDocumentOptions } from '@/services/workspaceDocuments';
import {
  retainWorkspaceDocument,
  type RetainWorkspaceDocumentOptions,
  type WorkspaceDocumentIdentity,
} from '@/services/workspaceDocuments';

/** A client for a module's own bridge commands (its `module <id>` section). */
export interface BridgeClient<M extends BridgeModuleId> {
  invoke<T>(command: BridgeModuleCommand<M>, args?: Record<string, unknown>): Promise<T>;
}

/**
 * The bridge client of module `moduleId`. While the module is switched off its
 * commands reject with `{ ModuleDisabled: { code: 12001, module } }`.
 */
export function bridgeClient<M extends BridgeModuleId>(moduleId: M): BridgeClient<M> {
  void moduleId;
  return {
    invoke: <T,>(command: BridgeModuleCommand<M>, args?: Record<string, unknown>) =>
      args === undefined ? getTransport().invoke<T>(command) : getTransport().invoke<T>(command, args),
  };
}

/** Layer selection, for modules that act on the selected layer. */
export { useSelectedLayer, useSelectedLayerId, useLayerMetadata } from '@/stores/layerStore';

/** The active visible workspace plus its incarnation; usable as an async ownership guard. */
export interface ActiveWorkspaceLease {
  workspaceId: string;
  timestamp: number;
  isCurrent(): boolean;
}

let navigationEpoch = 0;
useWorkspaceStore.subscribe((state, previous) => {
  const current = state.activeWorkspaceId ? state.workspaces.get(state.activeWorkspaceId) : undefined;
  const old = previous.activeWorkspaceId ? previous.workspaces.get(previous.activeWorkspaceId) : undefined;
  if (state.activeWorkspaceId !== previous.activeWorkspaceId || current?.timestamp !== old?.timestamp || current?.type !== old?.type || current?.viewMode !== old?.viewMode) navigationEpoch += 1;
});
export function captureActiveWorkspace(): ActiveWorkspaceLease | null {
  const state = useWorkspaceStore.getState();
  const workspaceId = state.activeWorkspaceId;
  const workspace = workspaceId ? state.workspaces.get(workspaceId) : undefined;
  if (!workspaceId || !workspace) return null;
  const timestamp = workspace.timestamp, epoch = navigationEpoch;
  return { workspaceId, timestamp, isCurrent: () => {
    const current = useWorkspaceStore.getState();
    return epoch === navigationEpoch && current.activeWorkspaceId === workspaceId && current.workspaces.get(workspaceId)?.timestamp === timestamp;
  }};
}
export const useActiveWorkspaceId = () => useWorkspaceStore((state) => state.activeWorkspaceId);
export { isLiveWorkspaceDocument as isLiveDocument, isWorkspaceEditingFrozen as isDocumentEditingFrozen } from '@/services/workspaceDocuments';

/** Retain a module document in the shell-owned close broker, not module disposables. */
export function retainDocument(
  workspaceId: string,
  options: RetainWorkspaceDocumentOptions,
): WorkspaceDocumentIdentity {
  return retainWorkspaceDocument(workspaceId, options);
}

/** Snapshot the selected loaded volume without letting a module import layerStore. */
export interface SelectedVolumeLayer {
  layerId: string;
  volumeId: string;
  name: string;
  metadata: VolumeMetadata | undefined;
}

export function selectedVolumeLayer(): SelectedVolumeLayer | null {
  const state = useLayerStore.getState();
  const layer = state.selectedLayerId
    ? state.layers.find((candidate) => candidate.id === state.selectedLayerId)
    : undefined;
  if (!layer) return null;
  return {
    layerId: layer.id,
    volumeId: layer.volumeId,
    name: layer.name,
    metadata: state.layerMetadata.get(layer.id),
  };
}

/** Native-loaded grid facts; modules may pass the result to their own bridge setup. */
export function getLoadedVolumeInfo(volumeId: string): Promise<VolumeHandleInfo> {
  return getTransport().invoke<VolumeHandleInfo>('get_volume_info', { volumeId });
}

/** The currently registered module pointer tool, resolved by the shell registry. */
export function getModuleViewportTool(id: string) {
  return moduleRegistry.getViewportTool(id);
}

/** Shared viewport primitives are re-exported so modules do not import app internals. */
export { SliceViewport } from '@/components/views/SliceViewport';
export type { ViewportTool, ViewportPointerSample, PointerCancelReason } from './types';

/** Load a volume (or any loadable file) from a path as a new layer. */
export async function openFileAsLayer(path: string): Promise<void> {
  await getFileLoadingService().loadFile(path, 'programmatic', 'add-layer');
}

/** Load a surface file from a path. */
export async function openSurfaceFile(options: { path: string; displayName?: string }): Promise<void> {
  await getSurfaceLoadingService().loadSurfaceFile(options);
}

export const useLoadedVolumeLayers = () => useLayerStore((state) => state.layers);
/** Remove module-created layers (for example a discarded document's frozen
 * frames) through the ordinary layer lifecycle, which also unloads them. */
export async function removeModuleLayers(volumeIds: readonly string[]): Promise<void> {
  const { getLayerService } = await import('@/services/LayerService');
  const layers = useLayerStore.getState().layers.filter((layer) => volumeIds.includes(layer.volumeId));
  await Promise.all(layers.map((layer) => getLayerService().removeLayer(layer.id).catch((error: unknown) => console.error('Module layer cleanup failed:', error))));
}
export function getLoadedNativePlane(volumeId: string, normalAxis: number, sliceIndex: number, dimensions: [number, number]): Promise<ViewRectMm> {
  return getTransport().invoke('get_volume_native_plane', { volumeId, normalAxis, sliceIndex, dimensions, flips: [false, false] });
}

export function useModuleCrosshairStyle() {
  const settings = useCrosshairSettingsStore((state) => state.settings);
  return useMemo(() => buildActiveCrosshairStyle(settings), [settings]);
}

export { registerWorkspaceEditHistory } from '@/services/workspaceEditHistory';

export { formatTauriError as formatModuleError } from '@/utils/formatTauriError';
