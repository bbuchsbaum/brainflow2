import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getEventBus } from '@/events/EventBus';
import { addLogEntry, useLogStore } from '@/stores/logStore';
import { useLayerStore } from '@/stores/layerStore';
import { bootstrapLogService, resetLogServiceForTest } from '@/services/LogService';
import { layerFileLabel } from '@/services/layerRemoval';
import { errorText, isCatalogSource, sanitizeLogMessage, sourceLabel } from '@/utils/logLabels';

const lastEntry = () => useLogStore.getState().entries.at(-1)!;

describe('Log names, not internal ids (QA 2026-10-30 F40)', () => {
  beforeEach(() => {
    useLogStore.getState().clear();
    bootstrapLogService();
  });
  afterEach(() => resetLogServiceForTest());

  it('a catalogue atlas or template load is logged by its display name', () => {
    getEventBus().emit('volume.load.complete', {
      volumeId: 'v1',
      layerId: 'v1',
      source: 'atlas',
      sourcePath: 'atlas:freesurfer_aseg',
      displayName: 'FreeSurfer ASEG',
      duration: 30,
    });
    expect(lastEntry().message).toBe('Loaded FreeSurfer ASEG (30 ms)');
    getEventBus().emit('volume.load.complete', {
      volumeId: 'v2',
      layerId: 'v2',
      source: 'template',
      sourcePath: 'template:MNIColin27_T1w_native',
      duration: 30,
    } as never);
    expect(lastEntry().message).toBe('Loaded MNIColin27_T1w_native (30 ms)');
  });

  it('removal names an atlas layer by its name', () => {
    expect(layerFileLabel({ id: 'l1', name: 'Olsen MTL', sourcePath: 'atlas:olsen_mtl' })).toBe('Olsen MTL');
    expect(layerFileLabel({ id: 'l1', name: 'x', sourcePath: '/data/T1w.nii.gz' })).toBe('T1w.nii.gz');
    expect(layerFileLabel({ id: 'l1' })).toBe('l1');
  });

  it('a layer error names the layer and never logs "undefined"', () => {
    useLayerStore.setState({
      layers: [{ id: 'volume_c', name: 'sub-03_beta', sourcePath: '/d/sub-03_beta.nii.gz' }],
    } as never);
    getEventBus().emit('layer.error', { layerId: 'volume_c', error: new Error(undefined as never) } as never);
    expect(lastEntry().message).toBe('Layer sub-03_beta.nii.gz error: unknown error');
    getEventBus().emit('layer.error', { layerId: 'gone', error: undefined } as never);
    expect(lastEntry().message).toBe('Layer gone error: unknown error');
    useLayerStore.setState({ layers: [] } as never);
  });

  it('a load failure notification is logged under its source; one already logged is not repeated', () => {
    getEventBus().emit('ui.notification', { type: 'error', message: 'Could not load x.nii: truncated', logSource: 'volume' });
    expect(lastEntry().source).toBe('volume');
    const before = useLogStore.getState().entries.length;
    getEventBus().emit('ui.notification', { type: 'error', message: 'Could not load surface y', logSource: false });
    expect(useLogStore.getState().entries.length).toBe(before);
    getEventBus().emit('ui.notification', { type: 'warning', message: 'Plain warning' });
    expect(lastEntry().source).toBe('ui');
  });

  it('the log store guards every message', () => {
    addLogEntry({ level: 'error', source: 'layer', message: 'Layer a error: undefined' });
    expect(lastEntry().message).toBe('Layer a error: unknown error');
    addLogEntry({ level: 'error', source: 'layer', message: undefined as never });
    expect(lastEntry().message).toBe('unknown error');
    addLogEntry({ level: 'error', source: 'layer', message: 'undefined' });
    expect(lastEntry().message).toBe('Unknown error');
  });
});

describe('logLabels', () => {
  it('tells catalogue ids from paths', () => {
    expect(isCatalogSource('atlas:olsen_mtl')).toBe(true);
    expect(isCatalogSource('template:MNI152')).toBe(true);
    expect(isCatalogSource('C:\\data\\a.nii')).toBe(false);
    expect(isCatalogSource('sftp://host/a.nii')).toBe(false);
    expect(isCatalogSource('/data/a.nii')).toBe(false);
    expect(sourceLabel('atlas:olsen_mtl', null)).toBe('olsen_mtl');
  });

  it('errorText and sanitizeLogMessage never return undefined', () => {
    expect(errorText(new Error('boom'))).toBe('boom');
    expect(errorText({ message: undefined })).toBe('unknown error');
    expect(errorText(null)).toBe('unknown error');
    expect(sanitizeLogMessage('x: null')).toBe('x: unknown error');
    expect(sanitizeLogMessage('fine')).toBe('fine');
  });
});
