import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';

vi.mock('@/services/apiService', () => ({ getApiService: () => ({}) }));

import { firSet } from '@/devHarness/app/firStudy';
import { useSetStudioStore } from '@/stores/setStudioStore';
import { useWorkspaceStore } from '@/stores/workspaceStore';
import { hasSetSeries, useSeriesSource } from '../seriesSource.helpers';

function activate(type: 'set-studio' | 'orthogonal-locked') {
  const workspaces = new Map([['w', { id: 'w', type } as never]]);
  useWorkspaceStore.setState({ workspaces, activeWorkspaceId: 'w' } as never);
}

describe('Studio series are scoped to the Studio (QA F11)', () => {
  beforeEach(() => {
    useSetStudioStore.getState().bootstrapStudio({
      set: firSet('3d'),
      features: [{ id: 'fir', label: 'FIR beta', kind: 'volume' }],
      cohorts: [],
      expressions: [],
    } as never);
  });

  it('offers the dataset series in the Studio only', () => {
    activate('set-studio');
    expect(hasSetSeries()).toBe(true);
    const { result, rerender } = renderHook(() => useSeriesSource(undefined));
    expect(result.current.source).toBe('set');
    activate('orthogonal-locked');
    rerender();
    // Leaving the Studio clears its series from the Plot dock.
    expect(hasSetSeries()).toBe(false);
    expect(result.current.source).toBeNull();
    expect(result.current.available.set).toBe(false);
  });
});
