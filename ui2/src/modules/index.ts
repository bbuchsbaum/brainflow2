/**
 * The first-party modules, in registration (and menu) order. Each entry is a
 * static manifest from `./<id>/module.ts`; `registry.ts` registers them when
 * it is imported. Add a module here and in the bridge's `REGISTERED_MODULES`
 * when it has a bridge section (see ./AGENTS.md).
 */

import type { ModuleManifest } from './api';

export const FIRST_PARTY_MODULES: readonly ModuleManifest[] = [];
