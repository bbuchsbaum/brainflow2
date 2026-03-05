import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useMountListener } from '../useMountListener';

const {
  listeners,
  mockMountDirectory,
  mockLoadFile,
  mockSafeListen,
  mockSafeUnlisten,
  unlistenFns,
  storeState,
} = vi.hoisted(() => {
  type ListenerEvent = { payload?: { path?: string } };
  const listenerMap: Record<string, (event: ListenerEvent) => Promise<void> | void> = {};
  const unlistenA = vi.fn();
  const unlistenB = vi.fn();
  const mockMountDirectoryFn = vi.fn().mockResolvedValue(undefined);
  const mockLoadFileFn = vi.fn().mockResolvedValue(undefined);
  const safeListenFn = vi
    .fn()
    .mockImplementation(async (event: string, handler: (event: ListenerEvent) => void) => {
      listenerMap[event] = handler;
      return event === 'mount-directory-event' ? unlistenA : unlistenB;
    });
  const safeUnlistenFn = vi.fn().mockResolvedValue(undefined);

  return {
    listeners: listenerMap,
    mockMountDirectory: mockMountDirectoryFn,
    mockLoadFile: mockLoadFileFn,
    mockSafeListen: safeListenFn,
    mockSafeUnlisten: safeUnlistenFn,
    unlistenFns: [unlistenA, unlistenB],
    storeState: {
      entries: [] as Array<{ path: string; name: string }>,
      rootPath: '',
      currentPath: '',
      loading: false,
      error: null as string | null,
      mountDirectory: mockMountDirectoryFn,
    },
  };
});

vi.mock('@/utils/eventUtils', () => ({
  safeListen: mockSafeListen,
  safeUnlisten: mockSafeUnlisten,
}));

vi.mock('@/services/FileLoadingService', () => ({
  getFileLoadingService: () => ({
    loadFile: mockLoadFile,
  }),
}));

vi.mock('@/stores/fileBrowserStore', () => {
  const useFileBrowserStore = Object.assign(vi.fn(), {
    getState: () => storeState,
  });

  return { useFileBrowserStore };
});

describe('useMountListener', () => {
  beforeEach(() => {
    Object.keys(listeners).forEach((key) => delete listeners[key]);
    mockSafeListen.mockClear();
    mockSafeUnlisten.mockClear();
    mockMountDirectory.mockClear();
    mockLoadFile.mockClear();
    unlistenFns.forEach((fn) => fn.mockClear());
    storeState.entries = [];
    storeState.rootPath = '';
    storeState.currentPath = '';
    storeState.loading = false;
    storeState.error = null;
  });

  it('registers mount and open-file listeners', async () => {
    renderHook(() => useMountListener());

    await waitFor(() => {
      expect(mockSafeListen).toHaveBeenCalledTimes(2);
    });

    expect(listeners['mount-directory-event']).toBeTypeOf('function');
    expect(listeners['open-file-event']).toBeTypeOf('function');
  });

  it('handles mount-directory-event by mounting selected directory', async () => {
    renderHook(() => useMountListener());

    await waitFor(() => {
      expect(listeners['mount-directory-event']).toBeTypeOf('function');
    });

    await act(async () => {
      await listeners['mount-directory-event']({ payload: { path: '/tmp/dataset' } });
    });

    expect(mockMountDirectory).toHaveBeenCalledTimes(1);
    expect(mockMountDirectory).toHaveBeenCalledWith('/tmp/dataset');
  });

  it('handles open-file-event by loading file with file-dialog ingress', async () => {
    renderHook(() => useMountListener());

    await waitFor(() => {
      expect(listeners['open-file-event']).toBeTypeOf('function');
    });

    await act(async () => {
      await listeners['open-file-event']({ payload: { path: '/tmp/brain.nii.gz' } });
    });

    expect(mockLoadFile).toHaveBeenCalledTimes(1);
    expect(mockLoadFile).toHaveBeenCalledWith('/tmp/brain.nii.gz', 'file-dialog');
  });

  it('ignores open-file-event when path is empty', async () => {
    renderHook(() => useMountListener());

    await waitFor(() => {
      expect(listeners['open-file-event']).toBeTypeOf('function');
    });

    await act(async () => {
      await listeners['open-file-event']({ payload: { path: '   ' } });
    });

    expect(mockLoadFile).not.toHaveBeenCalled();
  });

  it('cleans up both listeners on unmount', async () => {
    const { unmount } = renderHook(() => useMountListener());

    await waitFor(() => {
      expect(mockSafeListen).toHaveBeenCalledTimes(2);
    });

    unmount();

    await waitFor(() => {
      expect(mockSafeUnlisten).toHaveBeenCalledTimes(2);
    });

    expect(mockSafeUnlisten).toHaveBeenCalledWith(unlistenFns[0]);
    expect(mockSafeUnlisten).toHaveBeenCalledWith(unlistenFns[1]);
  });
});
