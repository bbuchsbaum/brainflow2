/**
 * App services for a module's lazily loaded code (components, services,
 * stores). This is the module's only way into the app besides
 * `activate(ctx)`: modules never import core stores, services or Tauri
 * directly (eslint.config.js). Add a facade here when a module needs one;
 * keep each a thin, documented pass-through.
 *
 * Not imported by manifests: it loads app services, which `@/modules/api`
 * must not.
 */

import type { BridgeModuleCommand, BridgeModuleId } from '@brainflow/api';
import { getTransport } from '@/services/transport';
import { getFileLoadingService } from '@/services/FileLoadingService';
import { getSurfaceLoadingService } from '@/services/SurfaceLoadingService';

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

/** Load a volume (or any loadable file) from a path as a new layer. */
export async function openFileAsLayer(path: string): Promise<void> {
  await getFileLoadingService().loadFile(path, 'programmatic', 'add-layer');
}

/** Load a surface file from a path. */
export async function openSurfaceFile(options: { path: string; displayName?: string }): Promise<void> {
  await getSurfaceLoadingService().loadSurfaceFile(options);
}
