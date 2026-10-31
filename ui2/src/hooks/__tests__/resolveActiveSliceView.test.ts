import { afterEach, describe, expect, it } from 'vitest';
import { resolveActiveSliceView } from '../useKeyboardShortcuts';
import { useWorkspaceStore } from '@/stores/workspaceStore';
import { useActiveRenderContextStore } from '@/stores/activeRenderContextStore';
import { setMosaicAxis } from '@/utils/mosaicAxis';

describe('slice keys target (QA 2026-10-31: ↑ in a Mosaic tab stepped x)', () => {
  const original = useWorkspaceStore.getState();
  afterEach(() => {
    useWorkspaceStore.setState({ activeWorkspaceId: original.activeWorkspaceId, getWorkspace: original.getWorkspace });
  });

  const front = (type: string) =>
    useWorkspaceStore.setState({
      activeWorkspaceId: 'ws-front',
      getWorkspace: (id: string) => (id === 'ws-front' ? ({ id, type } as never) : null),
    });

  it('a Mosaic tab in front steps its own axis, whatever view was active before', () => {
    useActiveRenderContextStore.getState().setActive('sagittal');
    front('mosaic');
    expect(resolveActiveSliceView()).toBe('axial');
    const release = setMosaicAxis('ws-front', 'coronal');
    expect(resolveActiveSliceView()).toBe('coronal');
    release();
  });

  it('an orthogonal tab keeps the active view', () => {
    useActiveRenderContextStore.getState().setActive('sagittal');
    front('orthogonal-locked');
    expect(resolveActiveSliceView()).toBe('sagittal');
  });
});
