/**
 * The module boundary rules (eslint.boundaries.js): module code imports only the
 * module API, ui/bf, @brainflow/api and its own folder (statically or
 * dynamically, with no `..` escapes); core code never imports a module's
 * folder; the module API entry stays free of runtime dependencies; manifests
 * import only the module API; framework files import no module internals.
 */
import { resolve } from 'node:path';
import { ESLint } from 'eslint';
import { describe, expect, it } from 'vitest';

const UI2 = resolve(__dirname, '../../..');
const eslint = new ESLint({ cwd: UI2 });

const BOUNDARY_RULES = new Set([
  'no-restricted-imports',
  '@typescript-eslint/no-restricted-imports',
  'bf-boundaries/dynamic-imports',
]);

/** Boundary messages for `code` linted as `file`. */
async function violations(file: string, code: string): Promise<string[]> {
  const [result] = await eslint.lintText(code, { filePath: resolve(UI2, file) });
  const fatal = result.messages.filter((m) => m.fatal);
  expect(fatal, JSON.stringify(fatal)).toEqual([]);
  return result.messages.filter((m) => m.ruleId && BOUNDARY_RULES.has(m.ruleId)).map((m) => m.message);
}

/** Each line linted on its own: how many lines break a boundary. */
async function countViolations(file: string, lines: string[]): Promise<boolean[]> {
  return Promise.all(lines.map(async (line) => (await violations(file, line)).length > 0));
}

const T = 30_000;

describe('module import boundaries', () => {
  const inModule = 'src/modules/analysis/services/Probe.ts';

  it('lets a module import the module API, ui/bf, @brainflow/api, packages and its own folder', async () => {
    const ok = [
      "import { defineModule } from '@/modules/api'; export { defineModule };",
      "import { bridgeClient } from '@/modules/api/host'; export { bridgeClient };",
      "import { Button } from '@/components/ui/bf'; export { Button };",
      "import type { AnalysisDescriptor } from '@brainflow/api'; export type { AnalysisDescriptor };",
      "import { create } from 'zustand'; export { create };",
      "import { useAnalysisStore } from '@/modules/analysis/stores/analysisStore'; export { useAnalysisStore };",
      "import { x } from './sibling'; export { x };",
      "export const load = () => import('./components/X');",
      "export const load = () => import('@/modules/analysis/components/X');",
      "export const load = () => import('@/modules/api/host');",
    ];
    expect(await countViolations(inModule, ok)).toEqual(ok.map(() => false));
  }, T);

  it('rejects core, other modules, Tauri and every `..` escape, static or dynamic', async () => {
    const bad = [
      "import { getTransport } from '@/services/transport'; export { getTransport };",
      "import { useLayerStore } from '@/stores/layerStore'; export { useLayerStore };",
      "import { a } from '../stores/analysisStore'; export { a };",
      "import { a } from './../../../services/transport'; export { a };",
      "import { a } from '@/modules/analysis/../../services/transport'; export { a };",
      "import { a } from '@/modules/api/../../stores/layerStore'; export { a };",
      "import { invoke } from '@tauri-apps/api/core'; export { invoke };",
      "import { b } from '@/modules/segmentation/x'; export { b };",
      "import { moduleRegistry } from '@/modules/registry'; export { moduleRegistry };",
      "export const load = () => import('@/services/transport');",
      "export const load = () => import('./../../../services/transport');",
      "export const load = () => import('@tauri-apps/api/core');",
      "export const load = () => import('@/modules/segmentation/x');",
      "export const load = (p: string) => import(p);",
    ];
    expect(await countViolations(inModule, bad)).toEqual(bad.map(() => true));
  }, T);

  it('rejects core code importing a module folder, statically, dynamically or via ..', async () => {
    const core = 'src/components/Probe.tsx';
    const ok = [
      "import { moduleRegistry } from '@/modules/registry'; export { moduleRegistry };",
      "import { useModuleSettingsStore } from '@/modules/settingsStore'; export { useModuleSettingsStore };",
      "import type { ModuleManifest } from '@/modules/api'; export type { ModuleManifest };",
      "export const load = () => import('@/modules/registry');",
    ];
    const bad = [
      "import { useAnalysisStore } from '@/modules/analysis/stores/analysisStore'; export { useAnalysisStore };",
      "import manifest from '@/modules/analysis/module'; export { manifest };",
      "import manifest from '@/modules/registry/../analysis/module'; export { manifest };",
      "export const load = () => import('@/modules/analysis/module');",
      "import { x } from '../modules/analysis/module'; export { x };",
    ];
    expect(await countViolations(core, ok)).toEqual(ok.map(() => false));
    expect(await countViolations(core, bad)).toEqual(bad.map(() => true));
  }, T);
});

describe('framework boundaries', () => {
  it('keeps the module API entry free of runtime dependencies', async () => {
    for (const file of ['src/modules/api/index.ts', 'src/modules/api/types.ts']) {
      const ok = ["import type { ComponentType } from 'react'; export type { ComponentType };"];
      if (file.endsWith('index.ts')) {
        // types.ts is itself held to type-only imports.
        ok.push("export type * from './types';", "import type { ModuleManifest } from './types'; export type { ModuleManifest };");
      }
      const bad = [
        "import { getTransport } from '@/services/transport'; export { getTransport };",
        "import { create } from 'zustand'; export { create };",
        "export { bridgeClient } from './host';",
        "export const load = () => import('./host');",
      ];
      expect(await countViolations(file, ok)).toEqual(ok.map(() => false));
      expect(await countViolations(file, bad)).toEqual(bad.map(() => true));
    }
  }, T);

  it('lets a manifest import only the module API and load its code lazily', async () => {
    const manifest = 'src/modules/analysis/module.ts';
    const ok = [
      "import { defineModule } from '@/modules/api'; export { defineModule };",
      "import type { AnalysisDescriptor } from './types'; export type { AnalysisDescriptor };",
      "export const load = () => import('./activate');",
    ];
    const bad = [
      "import { bridgeClient } from '@/modules/api/host'; export { bridgeClient };",
      "import { useAnalysisStore } from './stores/analysisStore'; export { useAnalysisStore };",
      "import { create } from 'zustand'; export { create };",
    ];
    expect(await countViolations(manifest, ok)).toEqual(ok.map(() => false));
    expect(await countViolations(manifest, bad)).toEqual(bad.map(() => true));
  }, T);

  it('keeps module internals out of the framework files; index.ts imports only manifests', async () => {
    const bad = [
      "import { useAnalysisStore } from './analysis/stores/analysisStore'; export { useAnalysisStore };",
      "import manifest from './analysis/module'; export { manifest };",
      "import manifest from '@/modules/analysis/module'; export { manifest };",
      "export const load = () => import('./analysis/activate');",
    ];
    expect(await countViolations('src/modules/registry.ts', bad)).toEqual(bad.map(() => true));
    const index = 'src/modules/index.ts';
    expect(
      await countViolations(index, ["import analysis from './analysis/module'; export { analysis };"]),
    ).toEqual([false]);
    expect(
      await countViolations(index, [
        "import { useAnalysisStore } from './analysis/stores/analysisStore'; export { useAnalysisStore };",
        "export const load = () => import('./analysis/activate');",
      ]),
    ).toEqual([true, true]);
  }, T);

  it('the repository itself passes these rules', async () => {
    const results = await eslint.lintFiles(['src/modules', 'src/components', 'src/services', 'src/stores', 'src/hooks', 'src/App.tsx']);
    const hits = results.flatMap((r) =>
      r.messages
        .filter((m) => m.ruleId && BOUNDARY_RULES.has(m.ruleId))
        .map((m) => `${r.filePath.replace(UI2, '')}:${m.line} ${m.message}`),
    );
    expect(hits).toEqual([]);
  }, 120_000);
});
