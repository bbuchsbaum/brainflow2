import { beforeEach, describe, expect, it } from 'vitest';
import { otherVolumeLoadsPending, trackSingleLoad } from '../loadSelection';
import { useLoadingQueueStore } from '@/stores/loadingQueueStore';

const enqueue = (path: string, type: 'volume-load' | 'template' | 'surface-load' = 'volume-load') =>
  useLoadingQueueStore.getState().enqueue({ type, path, displayName: path });

describe('auto-select only single user loads (review minor)', () => {
  beforeEach(() => {
    useLoadingQueueStore.setState({ queue: [], activeLoads: new Map() });
  });

  it('a lone load may select its layer', () => {
    const id = enqueue('/a.nii');
    const single = trackSingleLoad(id);
    expect(single.autoSelect()).toBe(true);
    single.dispose();
  });

  it('files loaded together are a batch, even after the others finish', () => {
    const a = enqueue('/a.nii');
    const single = trackSingleLoad(a);
    const b = enqueue('/b.nii');
    expect(single.autoSelect()).toBe(false);
    useLoadingQueueStore.getState().cancel(b);
    expect(otherVolumeLoadsPending(a)).toBe(false);
    expect(single.autoSelect()).toBe(false);
    single.dispose();
  });

  it('ignores loads that do not make volumes', () => {
    const a = enqueue('/a.nii');
    enqueue('/lh.pial', 'surface-load');
    expect(otherVolumeLoadsPending(a)).toBe(false);
    enqueue('template:MNI', 'template');
    expect(otherVolumeLoadsPending(a)).toBe(true);
  });
});
