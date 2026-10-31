/**
 * The first-party modules, in registration (and menu) order. Each entry is a
 * static manifest from `./<id>/module.ts`; `registry.ts` registers them when
 * it is imported. A module with a bridge section has the same id as its
 * bridge module (`BRIDGE_MODULES`; see ./AGENTS.md).
 */

import type { ModuleManifest } from './api';
import analysis from './analysis/module';

export const FIRST_PARTY_MODULES: readonly ModuleManifest[] = [analysis];
