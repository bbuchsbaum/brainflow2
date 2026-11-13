import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setTransport } from '@/services/transport';
import {
  reconnectRemoteMount,
  resetRemoteReconnectService,
} from '@/services/RemoteReconnectService';
import { useFileBrowserStore } from '@/stores/fileBrowserStore';
import {
  resetRemoteConnectionStore,
  useRemoteConnectionStore,
} from '@/stores/remoteConnectionStore';
import type { FileTreeNode } from '@/types/filesystem';
import { RemoteReconnectHost } from '../RemoteReconnectHost';

const HOST = 'trillium.alliancecan.ca';
const ROOT = '/cache/remote_mounts/cache-aaa';
const MEMBER = `${ROOT}/sub-04/same_item.nii.gz`;

const profile = {
  id: `brad@${HOST}:22:/scratch/brad`,
  name: 'trillium',
  host: HOST,
  port: 22,
  user: 'brad',
  remote_path: '/scratch/brad',
  auth_method: 'agent',
  key_path: null,
  verify_host_key: true,
  accept_unknown_host_keys: false,
  known_hosts_path: null,
  has_password: false,
  has_key_passphrase: false,
  updated_at_ms: 5,
  reconnect_on_launch: false,
};
const mount = {
  mount_id: 'new-session',
  local_path: ROOT,
  display_name: 'trillium',
  origin: { mount_id: 'new-session', label: `brad@${HOST}:/scratch/brad`, host: HOST, port: 22, user: 'brad', remote_path: '/scratch/brad' },
};

const invoke = vi.fn();

beforeEach(() => {
  resetRemoteReconnectService();
  resetRemoteConnectionStore();
  useFileBrowserStore.setState({
    entries: [
      {
        id: ROOT,
        name: 'trillium',
        path: ROOT,
        type: 'directory',
        depth: 0,
        children: [],
        mountSource: { kind: 'remote', mountId: 'old-session', host: HOST, port: 22, user: 'brad', remotePath: '/scratch/brad' },
      } as FileTreeNode,
    ],
    recents: [],
    pinned: [],
    error: null,
    errorPath: null,
  });
  invoke.mockReset();
  invoke.mockImplementation((cmd: string) => {
    if (cmd === 'list_remote_mounts') return Promise.resolve([]);
    if (cmd === 'list_remote_mount_profiles') return Promise.resolve([profile]);
    if (cmd === 'list_ssh_config_hosts') return Promise.resolve([]);
    if (cmd === 'remote_mount_connect')
      return Promise.resolve({
        status: 'need_auth',
        challenge: {
          conversation_id: 'duo-1',
          name: 'Keyboard-interactive',
          instructions: 'Duo two-factor login',
          prompts: [{ prompt: 'Passcode or option (1-1)', echo: true }],
        },
      });
    if (cmd === 'remote_mount_respond_auth') return Promise.resolve({ status: 'connected', mount });
    return Promise.reject(new Error(`Unhandled command: ${cmd}`));
  });
  setTransport({ invoke } as never);
});

afterEach(() => cleanup());

describe('RemoteReconnectHost', () => {
  it('registers itself so a reconnect can show its sign-in', () => {
    const view = render(<RemoteReconnectHost />);
    expect(useRemoteConnectionStore.getState().hosts).toBe(1);
    expect(screen.queryByRole('dialog')).toBeNull();
    view.unmount();
    expect(useRemoteConnectionStore.getState().hosts).toBe(0);
  });

  it('connects the saved profile at once, asks only what SSH asks, and resolves the reconnect', async () => {
    render(<RemoteReconnectHost />);
    let outcome: unknown = null;
    await act(async () => {
      void reconnectRemoteMount(MEMBER).then((result) => (outcome = result));
    });

    // No retyping: the saved profile was connected without a click.
    const prompt = await screen.findByLabelText('Passcode or option (1-1)');
    const request = invoke.mock.calls.find(([cmd]) => cmd === 'remote_mount_connect')?.[1] as {
      request: Record<string, unknown>;
    };
    expect(request.request).toMatchObject({
      host: HOST,
      user: 'brad',
      remote_path: '/scratch/brad',
      auth_method: 'agent',
    });
    expect(outcome).toBeNull();

    fireEvent.change(prompt, { target: { value: '1' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    });
    await waitFor(() => expect(outcome).toEqual({ status: 'connected', root: ROOT }));
    expect(invoke).toHaveBeenCalledWith('remote_mount_respond_auth', {
      conversationId: 'duo-1',
      responses: ['1'],
    });
    expect(screen.queryByLabelText('Passcode or option (1-1)')).toBeNull();
    expect(useRemoteConnectionStore.getState().activeEpoch).toEqual({ [ROOT]: 1 });
    expect(useFileBrowserStore.getState().entries[0].mountSource?.mountId).toBe('new-session');
  });

  it('reports a cancel when the sign-in is closed', async () => {
    render(<RemoteReconnectHost />);
    let outcome: unknown = null;
    await act(async () => {
      void reconnectRemoteMount(MEMBER).then((result) => (outcome = result));
    });
    await screen.findByLabelText('Passcode or option (1-1)');
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    });
    await waitFor(() => expect(outcome).toEqual({ status: 'cancelled' }));
    expect(useRemoteConnectionStore.getState().requests).toEqual([]);
    expect(useRemoteConnectionStore.getState().activeEpoch).toEqual({});
  });
});
