import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getEventBus } from '@/events/EventBus';
import { useLogStore } from '@/stores/logStore';
import { bootstrapLogService, resetLogServiceForTest } from '@/services/LogService';
import { markStudioMemberLoad } from '@/services/studio/studioMemberLoads';

const PATH = '/data/fir3d/maps/sub-01_task-faces_lag-2_beta.nii.gz';

function emitLoad(sourcePath = PATH) {
  getEventBus().emit('volume.load.complete', {
    volumeId: 'volume_123',
    layerId: 'volume_123',
    source: 'file',
    sourcePath,
    displayName: 'sub-01_task-faces_lag-2_beta.nii.gz',
    duration: 12.4,
  });
}

const lastEntry = () => useLogStore.getState().entries.at(-1)!;

describe('LogService volume loads', () => {
  beforeEach(() => {
    useLogStore.getState().clear();
    bootstrapLogService();
  });
  afterEach(() => resetLogServiceForTest());

  it('names the loaded file, not the load kind or layer id', () => {
    emitLoad();
    expect(lastEntry().source).toBe('volume');
    expect(lastEntry().message).toBe('Loaded sub-01_task-faces_lag-2_beta.nii.gz (12 ms)');
  });

  it('attributes a Studio member load to the studio with the member name', () => {
    const unmark = markStudioMemberLoad(PATH, 's01_faces_l2');
    emitLoad();
    unmark();
    expect(lastEntry().source).toBe('studio');
    expect(lastEntry().message).toBe(
      'Loaded member s01_faces_l2 from sub-01_task-faces_lag-2_beta.nii.gz (12 ms)',
    );

    // Once the Studio load finishes, a user load of the same file is ordinary.
    emitLoad();
    expect(lastEntry().source).toBe('volume');
  });
});
