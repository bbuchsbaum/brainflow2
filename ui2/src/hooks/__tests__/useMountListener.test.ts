import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useMountListener } from '../useMountListener';
import { useLoadingQueueStore } from '@/stores/loadingQueueStore';
import { getEventBus } from '@/events/EventBus';

const {
  listeners,
  mockMountDirectory,
  mockLoadFile,
  mockMountRemoteFromStartupSpec,
  mockInvoke,
  mockSafeListen,
  mockSafeUnlisten,
  servicesReadyState,
  unlistenFns,
  storeState,
} = vi.hoisted(() => {
  type ListenerEvent = {
    payload?: {
      path?: string;
      intent?: string;
      spec?: unknown;
      mount_id?: string;
      origin_label?: string;
      attempt?: number;
      reason?: string;
      bytes_downloaded?: number;
      total_bytes?: number;
    };
  };
  const listenerMap: Record<string, (event: ListenerEvent) => Promise<void> | void> = {};
  const unlistenA = vi.fn();
  const unlistenB = vi.fn();
  const unlistenC = vi.fn();
  const unlistenD = vi.fn();
  const unlistenE = vi.fn();
  const mockMountDirectoryFn = vi.fn().mockResolvedValue(undefined);
  const mockLoadFileFn = vi.fn().mockResolvedValue(undefined);
  const mockMountRemoteFromStartupSpecFn = vi.fn().mockResolvedValue(undefined);
  const mockInvokeFn = vi.fn().mockResolvedValue(0);
  const safeListenFn = vi
    .fn()
    .mockImplementation(async (event: string, handler: (event: ListenerEvent) => void) => {
      listenerMap[event] = handler;
      if (event === 'mount-directory-event') {
        return unlistenA;
      }
      if (event === 'open-file-event') {
        return unlistenB;
      }
      if (event === 'mount-remote-event') {
        return unlistenC;
      }
      if (event === 'remote-file-progress') return unlistenE;
      return unlistenD;
    });
  const safeUnlistenFn = vi.fn().mockResolvedValue(undefined);

  return {
    listeners: listenerMap,
    mockMountDirectory: mockMountDirectoryFn,
    mockLoadFile: mockLoadFileFn,
    mockMountRemoteFromStartupSpec: mockMountRemoteFromStartupSpecFn,
    mockInvoke: mockInvokeFn,
    mockSafeListen: safeListenFn,
    mockSafeUnlisten: safeUnlistenFn,
    servicesReadyState: { value: true },
    unlistenFns: [unlistenA, unlistenB, unlistenC, unlistenD, unlistenE],
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

vi.mock('@/services/RemoteMountService', () => ({
  mountRemoteFromStartupSpec: mockMountRemoteFromStartupSpec,
}));

vi.mock('../useServicesInit', () => ({
  areServicesInitialized: () => servicesReadyState.value,
}));

vi.mock('@/services/transport', () => ({
  getTransport: () => ({
    invoke: mockInvoke,
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
    getEventBus().off();
    Object.keys(listeners).forEach((key) => delete listeners[key]);
    servicesReadyState.value = true;
    mockInvoke.mockClear();
    mockSafeListen.mockClear();
    mockSafeUnlisten.mockClear();
    mockMountDirectory.mockClear();
    mockLoadFile.mockClear();
    mockMountRemoteFromStartupSpec.mockClear();
    unlistenFns.forEach((fn) => fn.mockClear());
    storeState.entries = [];
    storeState.rootPath = '';
    storeState.currentPath = '';
    storeState.loading = false;
    storeState.error = null;

    Object.defineProperty(window, '__TAURI__', {
      configurable: true,
      value: {},
    });
  });

  it('registers startup mount, open-file, and remote-mount listeners', async () => {
    renderHook(() => useMountListener());

    await waitFor(() => {
      expect(mockSafeListen).toHaveBeenCalledTimes(5);
    });

    expect(listeners['mount-directory-event']).toBeTypeOf('function');
    expect(listeners['open-file-event']).toBeTypeOf('function');
    expect(listeners['mount-remote-event']).toBeTypeOf('function');
    expect(listeners['remote-mount-recovery']).toBeTypeOf('function');
    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith('flush_startup_actions');
    });
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
    expect(mockLoadFile).toHaveBeenCalledWith('/tmp/brain.nii.gz', 'file-dialog', 'default');
  });

  it('passes explicit open intents through open-file-event', async () => {
    renderHook(() => useMountListener());

    await waitFor(() => {
      expect(listeners['open-file-event']).toBeTypeOf('function');
    });

    await act(async () => {
      await listeners['open-file-event']({
        payload: { path: '/tmp/brain.nii.gz', intent: 'comparison' },
      });
    });

    expect(mockLoadFile).toHaveBeenCalledTimes(1);
    expect(mockLoadFile).toHaveBeenCalledWith('/tmp/brain.nii.gz', 'file-dialog', 'comparison');
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

  it('handles mount-remote-event through the remote mount startup service', async () => {
    renderHook(() => useMountListener());

    await waitFor(() => {
      expect(listeners['mount-remote-event']).toBeTypeOf('function');
    });

    await act(async () => {
      await listeners['mount-remote-event']({
        payload: {
          spec: {
            kind: 'profile',
            profile: 'trillium',
          },
        },
      });
    });

    expect(mockMountRemoteFromStartupSpec).toHaveBeenCalledTimes(1);
    expect(mockMountRemoteFromStartupSpec).toHaveBeenCalledWith({
      kind: 'profile',
      profile: 'trillium',
    });
  });

  it('emits an error notification when startup remote mount fails', async () => {
    const emitSpy = vi.spyOn(getEventBus(), 'emit');
    mockMountRemoteFromStartupSpec.mockRejectedValueOnce(
      new Error('Startup remote mount requires interactive SSH confirmation.')
    );

    renderHook(() => useMountListener());

    await waitFor(() => {
      expect(listeners['mount-remote-event']).toBeTypeOf('function');
    });

    await act(async () => {
      await listeners['mount-remote-event']({
        payload: {
          spec: {
            kind: 'profile',
            profile: 'trillium',
          },
        },
      });
    });

    expect(emitSpy).toHaveBeenCalledWith('ui.notification', {
      type: 'error',
      message: 'Startup remote mount requires interactive SSH confirmation.',
    });

    emitSpy.mockRestore();
  });

  it('emits a warning notification when a remote mount recovers after retry', async () => {
    const emitSpy = vi.spyOn(getEventBus(), 'emit');

    renderHook(() => useMountListener());

    await waitFor(() => {
      expect(listeners['remote-mount-recovery']).toBeTypeOf('function');
    });

    await act(async () => {
      await listeners['remote-mount-recovery']({
        payload: {
          mount_id: 'mount-remote-1',
          origin_label: 'alice@login.example.org:/data',
          attempt: 1,
          reason: 'connection reset by peer',
        },
      });
    });

    expect(emitSpy).toHaveBeenCalledWith('ui.notification', {
      type: 'warning',
      message:
        'Remote mount recovered (alice@login.example.org:/data, retry): connection reset by peer',
    });

    emitSpy.mockRestore();
  });

  it('cleans up startup listeners on unmount', async () => {
    const { unmount } = renderHook(() => useMountListener());

    await waitFor(() => {
      expect(mockSafeListen).toHaveBeenCalledTimes(5);
    });

    unmount();

    await waitFor(() => {
      expect(mockSafeUnlisten).toHaveBeenCalledTimes(5);
    });

    expect(mockSafeUnlisten).toHaveBeenCalledWith(unlistenFns[0]);
    expect(mockSafeUnlisten).toHaveBeenCalledWith(unlistenFns[1]);
    expect(mockSafeUnlisten).toHaveBeenCalledWith(unlistenFns[2]);
    expect(mockSafeUnlisten).toHaveBeenCalledWith(unlistenFns[3]);
  });

  it('waits for services initialization before flushing startup actions', async () => {
    servicesReadyState.value = false;

    renderHook(() => useMountListener());

    await waitFor(() => {
      expect(mockSafeListen).toHaveBeenCalledTimes(5);
    });

    expect(mockInvoke).not.toHaveBeenCalled();

    act(() => {
      servicesReadyState.value = true;
      getEventBus().emit('services.allInitialized', { success: true });
    });

    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith('flush_startup_actions');
    });
  });
  it('reports actual remote bytes in the active loading stage', async () => {
    const store = useLoadingQueueStore.getState();
    const id = store.enqueue({ type: 'volume-load', path: '/cache/progress.nii', displayName: 'Progress' });
    store.startLoading(id);
    renderHook(() => useMountListener());
    await waitFor(() => expect(listeners['remote-file-progress']).toBeTypeOf('function'));
    await act(async () => {
      await listeners['remote-file-progress']({ payload: { path: '/cache/progress.nii', bytes_downloaded: 1048576, total_bytes: 2097152 } });
    });
    expect(useLoadingQueueStore.getState().activeLoads.get(id)).toMatchObject({ progress: 50, remoteTransfer: true, stage: 'Downloading 1.0 / 2.0 MiB' });
    store.markComplete(id);
  });
});
