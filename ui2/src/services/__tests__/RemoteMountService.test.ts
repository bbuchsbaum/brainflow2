import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setTransport } from '@/services/transport';
import { useFileBrowserStore } from '@/stores/fileBrowserStore';
import {
  buildRemoteMountMountOptions,
  mountConnectedRemoteDirectory,
  mountRemoteFromStartupSpec,
  type ConnectedRemoteMount,
} from '../RemoteMountService';

interface BackendTransportLike {
  invoke: (cmd: string, args?: unknown) => Promise<unknown>;
}

const CONNECTED_MOUNT: ConnectedRemoteMount = {
  mount_id: 'mount-remote-1',
  local_path: '/tmp/brainflow/mounts/mount-remote-1',
  display_name: 'brad@trillium.alliance.can.ca:/scratch/brad',
  origin: {
    label: 'brad@trillium.alliance.can.ca:/scratch/brad',
    host: 'trillium.alliance.can.ca',
    port: 22,
    user: 'brad',
    remote_path: '/scratch/brad',
  },
};

describe('RemoteMountService', () => {
  const originalMountDirectory = useFileBrowserStore.getState().mountDirectory;
  let mountDirectoryMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mountDirectoryMock = vi.fn().mockResolvedValue(undefined);
    useFileBrowserStore.setState((state) => ({
      ...state,
      mountDirectory: mountDirectoryMock,
    }));
  });

  afterEach(() => {
    useFileBrowserStore.setState((state) => ({
      ...state,
      mountDirectory: originalMountDirectory,
    }));
  });

  it('builds remote mount metadata for the file browser store', () => {
    expect(buildRemoteMountMountOptions(CONNECTED_MOUNT)).toEqual({
      displayName: 'brad@trillium.alliance.can.ca:/scratch/brad',
      mountSource: {
        kind: 'remote',
        label: 'brad@trillium.alliance.can.ca:/scratch/brad',
        mountId: 'mount-remote-1',
        host: 'trillium.alliance.can.ca',
        port: 22,
        user: 'brad',
        remotePath: '/scratch/brad',
      },
    });
  });

  it('mounts a connected remote folder into the file browser store', async () => {
    await mountConnectedRemoteDirectory(CONNECTED_MOUNT);

    expect(mountDirectoryMock).toHaveBeenCalledTimes(1);
    expect(mountDirectoryMock).toHaveBeenCalledWith(
      '/tmp/brainflow/mounts/mount-remote-1',
      buildRemoteMountMountOptions(CONNECTED_MOUNT)
    );
  });

  it('connects a direct startup remote mount and mounts the result', async () => {
    const invokeMock = vi.fn().mockImplementation((cmd: string, args?: any) => {
      if (cmd === 'remote_mount_connect') {
        expect(args).toEqual({
          request: {
            host: 'trillium.alliance.can.ca',
            user: 'brad',
            remote_path: '/scratch/brad',
            save_profile: false,
            remember_password: false,
          },
        });
        return Promise.resolve({
          status: 'connected',
          mount: CONNECTED_MOUNT,
        });
      }
      return Promise.reject(new Error(`Unhandled command: ${cmd}`));
    });

    setTransport({ invoke: invokeMock } as BackendTransportLike);

    await mountRemoteFromStartupSpec({
      kind: 'direct',
      user: 'brad',
      host: 'trillium.alliance.can.ca',
      remotePath: '/scratch/brad',
    });

    expect(invokeMock).toHaveBeenCalledTimes(1);
    expect(mountDirectoryMock).toHaveBeenCalledTimes(1);
  });

  it('resolves a startup profile by name before connecting', async () => {
    const invokeMock = vi.fn().mockImplementation((cmd: string, args?: any) => {
      if (cmd === 'list_remote_mount_profiles') {
        return Promise.resolve([
          {
            id: 'brad@trillium.alliance.can.ca:22:/scratch/brad',
            name: 'trillium',
            host: 'trillium.alliance.can.ca',
            port: 22,
            user: 'brad',
            remote_path: '/scratch/brad',
            auth_method: 'agent',
            verify_host_key: true,
            accept_unknown_host_keys: false,
            known_hosts_path: null,
            has_password: false,
            updated_at_ms: 1,
          },
        ]);
      }

      if (cmd === 'remote_mount_connect') {
        expect(args).toEqual({
          request: {
            host: 'trillium.alliance.can.ca',
            port: 22,
            user: 'brad',
            remote_path: '/scratch/brad',
            auth_method: 'agent',
            verify_host_key: true,
            accept_unknown_host_keys: false,
            known_hosts_path: undefined,
            remember_password: false,
            save_profile: false,
            profile_name: 'trillium',
          },
        });
        return Promise.resolve({
          status: 'connected',
          mount: CONNECTED_MOUNT,
        });
      }

      return Promise.reject(new Error(`Unhandled command: ${cmd}`));
    });

    setTransport({ invoke: invokeMock } as BackendTransportLike);

    await mountRemoteFromStartupSpec({
      kind: 'profile',
      profile: 'trillium',
    });

    expect(invokeMock).toHaveBeenCalledWith('list_remote_mount_profiles');
    expect(mountDirectoryMock).toHaveBeenCalledTimes(1);
  });

  it('fails cleanly when startup remote mount becomes interactive', async () => {
    const invokeMock = vi.fn().mockImplementation((cmd: string) => {
      if (cmd === 'remote_mount_connect') {
        return Promise.resolve({
          status: 'need_host_key',
          challenge: {
            challenge_id: 'abc',
            host: 'trillium.alliance.can.ca',
            port: 22,
            algorithm: 'ssh-ed25519',
            sha256_fingerprint: 'SHA256:xyz',
            disposition: 'unknown',
          },
        });
      }
      return Promise.reject(new Error(`Unhandled command: ${cmd}`));
    });

    setTransport({ invoke: invokeMock } as BackendTransportLike);

    await expect(
      mountRemoteFromStartupSpec({
        kind: 'direct',
        user: 'brad',
        host: 'trillium.alliance.can.ca',
        remotePath: '/scratch/brad',
      })
    ).rejects.toThrow(
      "Startup remote mount 'brad@trillium.alliance.can.ca:/scratch/brad' requires interactive SSH confirmation. Use Mount Remote (SSH)… to complete the connection."
    );

    expect(mountDirectoryMock).not.toHaveBeenCalled();
  });
});
