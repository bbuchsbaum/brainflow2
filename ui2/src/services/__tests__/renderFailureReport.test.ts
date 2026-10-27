import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/services/apiService', () => ({ getApiService: () => ({}) }));

import { getEventBus } from '@/events/EventBus';
import { reportRenderFailure, resetRenderFailureReports } from '../RenderCoordinator';

describe('a refused 4D render is not a silent black view (native R2-3)', () => {
  beforeEach(() => resetRenderFailureReports());

  it('error 4103 is reported once; other render errors are not notifications', () => {
    const notes: unknown[] = [];
    const off = getEventBus().on('ui.notification', (n: unknown) => notes.push(n));
    const refused = { Input: { code: 4103, details: 'Layer v1 is 4D: the render request needs a timepoint' } };
    reportRenderFailure(refused);
    reportRenderFailure(refused);
    reportRenderFailure({ Internal: { code: 5000, details: 'other' } });
    expect(notes).toHaveLength(1);
    expect(notes[0]).toMatchObject({ type: 'error' });
    expect((notes[0] as { message: string }).message).toContain('no frame was selected');
    if (typeof off === 'function') off();
  });
});
