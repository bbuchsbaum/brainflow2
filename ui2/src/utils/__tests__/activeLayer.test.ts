import { beforeEach, describe, expect, it } from 'vitest';
import {
  inspectorVolumeLayerId,
  resolveActiveLayer,
  resolveActiveLayerName,
  type ActiveLayerSelection,
} from '../activeLayer';
import { useLayerStore, type LayerInfo } from '@/stores/layerStore';
import { useInspectorSelectionStore } from '@/stores/inspectorSelectionStore';
import { resolveStatusLayer } from '@/components/ui/StatusBar';
import { chooseColorbarLayerId } from '@/components/views/viewportFrame/useOverlayColorbar';

describe('resolveActiveLayer', () => {
  const layers = [
    { id: 'base', name: 'MNI152_T1_2mm_brain.nii.gz', visible: true },
    { id: 'stat', name: 'Motor zstat1', visible: true },
    { id: 'hidden', name: 'Hidden', visible: false },
  ];

  it('prefers the Inspector volume item, then the layer-store selection', () => {
    expect(
      resolveActiveLayer(layers, { inspectorLayerId: 'stat', selectedLayerId: 'base' })?.id,
    ).toBe('stat');
    expect(
      resolveActiveLayer(layers, { inspectorLayerId: null, selectedLayerId: 'base' })?.id,
    ).toBe('base');
    expect(resolveActiveLayerName(layers, 'base')).toBe('MNI152_T1_2mm_brain.nii.gz');
  });

  it('falls back to the topmost visible layer (last visible in composite order)', () => {
    expect(resolveActiveLayer(layers, null)?.id).toBe('stat');
    expect(resolveActiveLayer(layers, 'not-in-view')?.id).toBe('stat');
    expect(
      resolveActiveLayer(layers, { inspectorLayerId: 'elsewhere', selectedLayerId: null })?.id,
    ).toBe('stat');
    expect(resolveActiveLayer([], null)).toBeNull();
  });

  it('treats only volume scene items as Inspector layers', () => {
    expect(inspectorVolumeLayerId('stat', 'volume-overlay')).toBe('stat');
    expect(inspectorVolumeLayerId('lh', 'surface-geometry')).toBeNull();
    expect(inspectorVolumeLayerId(null, null)).toBeNull();
  });
});

/**
 * Header, status Layer, status Value (sampled layer) and colorbar all derive
 * from one selection. These tests drive the real stores through the code
 * paths that previously let them diverge.
 */
describe('one active layer across header, status bar and colorbar', () => {
  const mk = (id: string, name: string): LayerInfo =>
    ({ id, name, type: 'volume', volumeId: id, visible: true }) as unknown as LayerInfo;
  const viewLayers = [
    { id: 'vol-1', name: 'MNI152_T1_2mm_brain.nii.gz', visible: true, layerMode: 'scalar' },
    { id: 'vol-2', name: 'Motor zstat1', visible: true, layerMode: 'scalar' },
  ];

  const selection = (): ActiveLayerSelection => {
    const { activeItemId, activeItemKind } = useInspectorSelectionStore.getState();
    return {
      inspectorLayerId: inspectorVolumeLayerId(activeItemId, activeItemKind),
      selectedLayerId: useLayerStore.getState().selectedLayerId,
    };
  };
  const readouts = () => {
    const sel = selection();
    const header = resolveActiveLayerName(viewLayers, sel);
    const status = resolveStatusLayer(viewLayers, sel, null);
    const colorbar = chooseColorbarLayerId(
      useLayerStore.getState().layers,
      viewLayers as never,
      resolveActiveLayer(viewLayers, sel)?.id ?? null,
    );
    return { header, statusName: status?.name, sampledId: status?.id, colorbar };
  };

  beforeEach(() => {
    useInspectorSelectionStore.getState().clear();
    useLayerStore.getState().clearLayers();
    useLayerStore.getState().selectLayer(null);
  });

  it('auto-select of the first loaded layer: header and status name it, Inspector stays empty', () => {
    useLayerStore.getState().addLayer(mk('vol-1', 'MNI152_T1_2mm_brain.nii.gz'));
    useLayerStore.getState().addLayer(mk('vol-2', 'Motor zstat1'));
    expect(useLayerStore.getState().selectedLayerId).toBe('vol-1');
    expect(useInspectorSelectionStore.getState().activeItemId).toBeNull();
    const r = readouts();
    expect(r.header).toBe('MNI152_T1_2mm_brain.nii.gz');
    expect(r.statusName).toBe(r.header);
    expect(r.sampledId).toBe('vol-1');
    // The base is not an overlay: the colorbar shows the topmost overlay.
    expect(r.colorbar).toBe('vol-2');
  });

  it('direct base selection through the layer store while the Inspector shows the overlay', () => {
    useLayerStore.getState().addLayer(mk('vol-1', 'MNI152_T1_2mm_brain.nii.gz'));
    useLayerStore.getState().addLayer(mk('vol-2', 'Motor zstat1'));
    // A Scene-row click on the overlay.
    useInspectorSelectionStore.getState().setActive({
      id: 'vol-2',
      kind: 'volume-overlay',
      group: 'volume',
      name: 'Motor zstat1',
      subtitle: '',
      visible: true,
      opacity: 1,
      ref: { type: 'volume', layerId: 'vol-2' },
    });
    expect(readouts().sampledId).toBe('vol-2');

    // Studio "show" / "Open in dock" select the base without the Inspector.
    useLayerStore.getState().selectLayer('vol-1');
    expect(useInspectorSelectionStore.getState().activeItemId).toBe('vol-1');
    expect(useInspectorSelectionStore.getState().activeItemKind).toBe('volume-base');
    const r = readouts();
    expect(r.header).toBe('MNI152_T1_2mm_brain.nii.gz');
    expect(r.statusName).toBe(r.header);
    expect(r.sampledId).toBe('vol-1');

    // Clearing the layer selection clears the volume Inspector item.
    useLayerStore.getState().selectLayer(null);
    expect(useInspectorSelectionStore.getState().activeItemId).toBeNull();
    const cleared = readouts();
    expect(cleared.header).toBe('Motor zstat1');
    expect(cleared.statusName).toBe(cleared.header);
  });

  it('nothing selected (Compare start): every consumer falls back to the topmost visible layer', () => {
    useLayerStore.getState().addLayer(mk('vol-1', 'MNI152_T1_2mm_brain.nii.gz'));
    useLayerStore.getState().addLayer(mk('vol-2', 'Motor zstat1'));
    useLayerStore.getState().selectLayer(null);
    const r = readouts();
    expect(r.header).toBe('Motor zstat1');
    expect(r.statusName).toBe('Motor zstat1');
    expect(r.sampledId).toBe('vol-2');
    expect(r.colorbar).toBe('vol-2');
  });

  it('a surface Inspector item does not override the volume rule', () => {
    useLayerStore.getState().addLayer(mk('vol-1', 'MNI152_T1_2mm_brain.nii.gz'));
    useInspectorSelectionStore.setState({ activeItemId: 'lh', activeItemKind: 'surface-geometry' });
    useLayerStore.getState().selectLayer('vol-1');
    expect(useInspectorSelectionStore.getState().activeItemId).toBe('lh');
    expect(readouts().sampledId).toBe('vol-1');
  });
});
