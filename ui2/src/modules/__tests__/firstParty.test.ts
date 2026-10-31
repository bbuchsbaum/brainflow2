/**
 * The first-party module list against the bridge (a first step towards
 * `pnpm check:modules`, docs/plans/module-architecture.md): every bridge
 * module has a UI manifest of the same id, stage and version, every module
 * folder is registered and has an AGENTS.md.
 */
import { existsSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { BRIDGE_MODULES } from '@brainflow/api';
import { FIRST_PARTY_MODULES } from '@/modules/index';
import { moduleRegistry } from '@/modules/registry';

const MODULES_DIR = resolve(__dirname, '..');

describe('first-party modules', () => {
  it('every bridge module has a UI module with the same id, stage and version', () => {
    for (const [id, bridge] of Object.entries(BRIDGE_MODULES)) {
      const manifest = FIRST_PARTY_MODULES.find((m) => m.id === id);
      expect(manifest, `bridge module "${id}" has no UI manifest`).toBeDefined();
      expect(manifest!.stage).toBe(bridge.stage);
      expect(manifest!.version).toBe(bridge.version);
    }
  });

  it('every module folder is registered and documented', () => {
    const folders = readdirSync(MODULES_DIR, { withFileTypes: true })
      .filter((e) => e.isDirectory() && e.name !== 'api' && e.name !== '__tests__')
      .map((e) => e.name);
    expect(folders.sort()).toEqual(FIRST_PARTY_MODULES.map((m) => m.id).sort());
    for (const id of folders) {
      expect(existsSync(resolve(MODULES_DIR, id, 'AGENTS.md')), `${id}/AGENTS.md`).toBe(true);
      expect(existsSync(resolve(MODULES_DIR, id, 'module.ts')), `${id}/module.ts`).toBe(true);
    }
    expect(moduleRegistry.getModules().map((m) => m.id)).toEqual(FIRST_PARTY_MODULES.map((m) => m.id));
  });
});
