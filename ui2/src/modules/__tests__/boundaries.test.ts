/**
 * The module boundary rules in eslint.config.js: module code imports only the
 * module API, ui/bf, @brainflow/api and its own folder; core code never
 * imports a module's folder.
 */
import { resolve } from 'node:path';
import { ESLint } from 'eslint';
import { describe, expect, it } from 'vitest';

const UI2 = resolve(__dirname, '../../..');
const eslint = new ESLint({ cwd: UI2 });

async function restricted(file: string, code: string): Promise<string[]> {
  const [result] = await eslint.lintText(code, { filePath: resolve(UI2, file) });
  return result.messages.filter((m) => m.ruleId === 'no-restricted-imports').map((m) => m.message);
}

describe('module import boundaries', () => {
  const inModule = 'src/modules/analysis/services/Probe.ts';

  it('lets a module import the module API, ui/bf, @brainflow/api, packages and its own folder', async () => {
    const code = [
      "import { defineModule } from '@/modules/api';",
      "import { bridgeClient } from '@/modules/api/host';",
      "import { Button } from '@/components/ui/bf';",
      "import type { AnalysisDescriptor } from '@brainflow/api';",
      "import { create } from 'zustand';",
      "import { useAnalysisStore } from '@/modules/analysis/stores/analysisStore';",
      "import { x } from './sibling';",
      'export { defineModule, bridgeClient, Button, create, useAnalysisStore, x };',
      'export type { AnalysisDescriptor };',
    ].join('\n');
    expect(await restricted(inModule, code)).toEqual([]);
  }, 30_000);

  it('rejects core imports, ../ paths, Tauri and other modules from module code', async () => {
    const code = [
      "import { getTransport } from '@/services/transport';",
      "import { useLayerStore } from '@/stores/layerStore';",
      "import { a } from '../stores/analysisStore';",
      "import { invoke } from '@tauri-apps/api/core';",
      "import { b } from '@/modules/segmentation/x';",
      "import { moduleRegistry } from '@/modules/registry';",
      'export { getTransport, useLayerStore, a, invoke, b, moduleRegistry };',
    ].join('\n');
    expect(await restricted(inModule, code)).toHaveLength(6);
  }, 30_000);

  it('rejects core code importing a module folder, but allows the framework files', async () => {
    const code = [
      "import { moduleRegistry } from '@/modules/registry';",
      "import { useModuleSettingsStore } from '@/modules/settingsStore';",
      "import type { ModuleManifest } from '@/modules/api';",
      "import { useAnalysisStore } from '@/modules/analysis/stores/analysisStore';",
      "import manifest from '@/modules/analysis/module';",
      'export { moduleRegistry, useModuleSettingsStore, useAnalysisStore, manifest };',
      'export type { ModuleManifest };',
    ].join('\n');
    const messages = await restricted('src/components/Probe.tsx', code);
    expect(messages).toHaveLength(2);
    expect(messages[0]).toMatch(/Core code never imports a module's folder/);
  }, 30_000);
});
