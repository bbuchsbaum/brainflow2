import { act, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { LayerKindContribution, ModuleManifest } from '../api';
import { ModuleRegistry, moduleRegistry } from '../registry';
import { useModuleSettingsStore } from '../settingsStore';
import { layerRenderMode, requireLayerKind } from '../layerKinds';
import { placementBand, categoricalTypeFromData, planLayerPlacement } from '@/services/layerPlacement';
import { volumeSceneItemKind } from '@/utils/sceneItemKind';
import { buildSceneStack } from '@/hooks/useSceneStack';
import type { LayerInfo } from '@/stores/layerStore';
import { ModuleLayerSections } from '@/components/modules/ModuleLayerSections';

const kind: LayerKindContribution = {
  id: 'kind-fixture.roi', title: 'Editable ROI', baseRenderMode: 'label', stackingBand: 4, icon: 'labels',
  capabilities: { thresholdable: false, colormappable: false, editable: true, outline: true },
  inspectorSections: [{ id: 'kind-fixture.editor', title: 'Editor', component: async () => ({ default: ({ layerId }) => <span>Editing {layerId}</span> }) }],
};
const activate = vi.fn();
const manifest: ModuleManifest = {
  id: 'kind-fixture', title: 'Layer fixture', description: 'A fixture kind.', version: '1', stage: 'preview', hosts: ['desktop'],
  contributes: { layerKinds: [kind] }, activate: async () => ({ activate }),
};
moduleRegistry.register(manifest);
const fresh = () => new ModuleRegistry({ overrides: () => ({}), subscribeOverrides: () => () => {}, host: () => 'desktop', capabilities: () => ({}), bridgeModules: {} });

afterEach(() => { act(() => useModuleSettingsStore.setState({ enabled: {} })); moduleRegistry.connectShell(null); });

describe('module layer kinds', () => {
  it('validates mode, band, capabilities, and namespaced section identities', () => {
    const registry = fresh();
    expect(() => registry.register({ ...manifest, contributes: { layerKinds: [{ ...kind, baseRenderMode: 'new-shader' as never }] } })).toThrow(/core render mode/);
    expect(() => registry.register({ ...manifest, contributes: { layerKinds: [{ ...kind, stackingBand: 8 as never }] } })).toThrow(/stacking band/);
    expect(() => registry.register({ ...manifest, contributes: { layerKinds: [{ ...kind, capabilities: {} as never }] } })).toThrow(/must declare/);
    expect(() => registry.register({ ...manifest, contributes: { layerKinds: [{ ...kind, inspectorSections: [{ id: 'bad', title: 'Bad', component: async () => ({ default: () => null }) }] }] } })).toThrow(/namespaced/);
    registry.register(manifest);
    expect(registry.getLayerKind(kind.id)?.moduleId).toBe(manifest.id);
  });

  it('uses the declaration ahead of filename and voxel heuristics', () => {
    const layer = { id: 'roi', type: 'anatomical' as const, layerKind: kind.id, name: 'zstat1', visible: true };
    expect(layerRenderMode(layer)).toBe('label');
    expect(placementBand(layer)).toBe(4);
    const scene = buildSceneStack([{ ...layer, volumeId: 'v', order: 0 } as LayerInfo], new Map(), null);
    expect(scene.volumes[0]).toMatchObject({ kind: 'volume-overlay-atlas', layerKind: kind.id });
    expect(volumeSceneItemKind([layer], 'roi')).toBe('volume-overlay-atlas');
    expect(categoricalTypeFromData(layer, { isBinaryLike: true })).toBeNull();
    expect(planLayerPlacement([{ id: 't1', type: 'anatomical' }], layer)).toEqual({ index: 1, opacity: 0.35 });
  });

  it('draws a mask-typed layer as a flat mask only when its data are not known to be continuous', () => {
    const mask = { type: 'mask' as const };
    expect(layerRenderMode(mask)).toBe('mask');
    expect(layerRenderMode(mask, false, true)).toBe('mask');
    expect(layerRenderMode(mask, false, false)).toBe('scalar');
    expect(layerRenderMode({ type: 'label' as const }, false, false)).toBe('label');
    expect(layerRenderMode({ type: 'anatomical' as const }, true, false)).toBe('label');
  });

  it('falls back to the saved core type after disable, and refuses new unavailable kinds', () => {
    act(() => useModuleSettingsStore.getState().setModuleEnabled(manifest.id, false));
    const layer = { type: 'label' as const, layerKind: kind.id };
    expect(moduleRegistry.getLayerKind(kind.id)).toBeUndefined();
    expect(layerRenderMode(layer)).toBe('label');
    expect(() => requireLayerKind(layer)).toThrow(/unavailable/);
    expect(() => requireLayerKind({ layerKind: 'missing.kind' })).toThrow(/unavailable/);
    expect(() => requireLayerKind({})).not.toThrow();
  });

  it('mounts a lazy Inspector section only after activation and tears it down on disable', async () => {
    let release!: () => void;
    const ready = new Promise<void>((resolve) => { release = resolve; });
    moduleRegistry.deactivate(manifest.id);
    moduleRegistry.connectShell({ openWorkspace: async () => null, activeWorkspaceType: () => null, beforeActivate: () => ready });
    render(<ModuleLayerSections kindId={kind.id} layerId="live-label" />);
    expect(screen.queryByText('Editing live-label')).toBeNull();
    await act(async () => release());
    expect(await screen.findByText('Editing live-label')).toBeInTheDocument();
    act(() => useModuleSettingsStore.getState().setModuleEnabled(manifest.id, false));
    expect(screen.queryByText('Editing live-label')).toBeNull();
  });
});
