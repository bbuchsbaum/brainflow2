/**
 * The module API (`@/modules/api`). Manifests import only this entry, which
 * has no runtime dependencies, so registering a manifest loads no module code.
 * Lazily loaded module code reaches app services through `@/modules/api/host`.
 */

import type { ModuleManifest } from './types';

export type * from './types';

/** Declare a module. The manifest is frozen; the registry validates it. */
export function defineModule<const M extends ModuleManifest>(manifest: M): Readonly<M> {
  return Object.freeze(manifest);
}
