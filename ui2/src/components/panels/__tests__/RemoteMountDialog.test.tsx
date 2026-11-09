import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { RemoteMountDialog } from '../RemoteMountDialog';

const { invokeMock } = vi.hoisted(() => ({
  invokeMock: vi.fn(),
}));

vi.mock('@/services/transport', () => ({
  getTransport: () => ({
    invoke: invokeMock,
  }),
}));

type InvokeArgs = Record<string, unknown> | undefined;

function setupDialog() {
  const onClose = vi.fn();
  const onMounted = vi.fn().mockResolvedValue(undefined);

  render(<RemoteMountDialog isOpen={true} onClose={onClose} onMounted={onMounted} />);

  return { onClose, onMounted };
}

function fillPasswordForm() {
  fireEvent.change(screen.getByLabelText('Host'), { target: { value: 'login.example.org' } });
  fireEvent.change(screen.getByLabelText('Port'), { target: { value: '2222' } });
  fireEvent.change(screen.getByLabelText('User'), { target: { value: 'alice' } });
  fireEvent.change(screen.getByLabelText('Remote folder'), { target: { value: '/data' } });
  fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'secret' } });
}

describe('RemoteMountDialog', () => {
  beforeEach(() => {
    invokeMock.mockReset();
    invokeMock.mockImplementation((cmd: string, _args?: InvokeArgs) => {
      if (cmd === 'list_remote_mount_profiles') {
        return Promise.resolve([]);
      }
      return Promise.reject(new Error(`Unhandled command: ${cmd}`));
    });
  });

  it('prefills form from the most recently updated saved profile on open', async () => {
    invokeMock.mockImplementation((cmd: string, _args?: InvokeArgs) => {
      if (cmd === 'list_remote_mount_profiles') {
        return Promise.resolve([
          {
            id: 'older',
            name: 'older profile',
            host: 'old.example.org',
            port: 22,
            user: 'olduser',
            remote_path: '/old',
            auth_method: 'agent',
            has_password: false,
            has_key_passphrase: false,
            key_path: null,
            updated_at_ms: 10,
          },
          {
            id: 'newer',
            name: 'newer profile',
            host: 'new.example.org',
            port: 2222,
            user: 'newuser',
            remote_path: '/new',
            auth_method: 'key_file',
            key_path: '~/.ssh/id_new',
            has_password: false,
            has_key_passphrase: true,
            updated_at_ms: 20,
          },
        ]);
      }
      return Promise.reject(new Error(`Unhandled command: ${cmd}`));
    });

    setupDialog();

    await waitFor(() => {
      expect(screen.getByLabelText('Saved profile')).toHaveValue('newer');
      expect(screen.getByLabelText('Host')).toHaveValue('new.example.org');
      expect(screen.getByLabelText('Port')).toHaveValue('2222');
      expect(screen.getByLabelText('User')).toHaveValue('newuser');
      expect(screen.getByLabelText('Remote folder')).toHaveValue('/new');
      expect(screen.getByLabelText('Auth method')).toHaveValue('key_file');
      expect(screen.getByLabelText('SSH key file (optional)')).toHaveValue('~/.ssh/id_new');
    });
  });

  it('resets to default fields when switching from a profile to new connection', async () => {
    invokeMock.mockImplementation((cmd: string, _args?: InvokeArgs) => {
      if (cmd === 'list_remote_mount_profiles') {
        return Promise.resolve([
          {
            id: 'profile-1',
            name: 'profile 1',
            host: 'login.example.org',
            port: 22,
            user: 'alice',
            remote_path: '/data',
            auth_method: 'agent',
            has_password: false,
            updated_at_ms: 1,
          },
        ]);
      }
      return Promise.reject(new Error(`Unhandled command: ${cmd}`));
    });

    setupDialog();

    await waitFor(() => {
      expect(screen.getByLabelText('Saved profile')).toHaveValue('profile-1');
    });

    fireEvent.change(screen.getByLabelText('Saved profile'), { target: { value: '' } });

    await waitFor(() => {
      expect(screen.getByLabelText('Host')).toHaveValue('');
      expect(screen.getByLabelText('Port')).toHaveValue('22');
      expect(screen.getByLabelText('User')).toHaveValue('');
      expect(screen.getByLabelText('Remote folder')).toHaveValue('/');
      expect(screen.getByLabelText('Auth method')).toHaveValue('password');
    });
  });

  it('closes on Escape when idle', async () => {
    const { onClose } = setupDialog();

    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith('list_remote_mount_profiles');
    });

    fireEvent.keyDown(document, { key: 'Escape' });

    await waitFor(() => {
      expect(onClose).toHaveBeenCalledTimes(1);
    });
  });

  it('does not close on Escape while a connection is pending', async () => {
    let resolveConnect: ((value: unknown) => void) | null = null;
    const connectPromise = new Promise((resolve) => {
      resolveConnect = resolve;
    });

    invokeMock.mockImplementation((cmd: string, _args?: InvokeArgs) => {
      if (cmd === 'list_remote_mount_profiles') {
        return Promise.resolve([]);
      }
      if (cmd === 'remote_mount_connect') {
        return connectPromise;
      }
      return Promise.reject(new Error(`Unhandled command: ${cmd}`));
    });

    const { onClose } = setupDialog();

    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith('list_remote_mount_profiles');
    });

    fillPasswordForm();
    fireEvent.click(screen.getByRole('button', { name: 'Connect' }));

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Connecting…' })).toBeDisabled();
      expect(screen.getByRole('button', { name: 'Close modal' })).toBeDisabled();
    });

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).not.toHaveBeenCalled();

    resolveConnect?.({
      status: 'connected',
      mount: {
        mount_id: 'mount-pending',
        local_path: '/tmp/brainflow/mounts/mount-pending',
        display_name: 'alice@login.example.org:/data',
        origin: {
          label: 'alice@login.example.org:/data',
          host: 'login.example.org',
          port: 2222,
          user: 'alice',
          remote_path: '/data',
        },
      },
    });

    await waitFor(() => {
      expect(onClose).toHaveBeenCalledTimes(1);
    });
  });

  it('connects directly when backend returns connected', async () => {
    const mount = {
      mount_id: 'mount-1',
      local_path: '/tmp/brainflow/mounts/mount-1',
      display_name: 'alice@login.example.org:/data',
      origin: {
        label: 'alice@login.example.org:/data',
        host: 'login.example.org',
        port: 2222,
        user: 'alice',
        remote_path: '/data',
      },
    };

    invokeMock.mockImplementation((cmd: string, args?: InvokeArgs) => {
      if (cmd === 'list_remote_mount_profiles') {
        return Promise.resolve([]);
      }
      if (cmd === 'remote_mount_connect') {
        expect(args).toEqual({
          request: {
            host: 'login.example.org',
            port: 2222,
            user: 'alice',
            remote_path: '/data',
            auth_method: 'password',
            password: 'secret',
            key_path: undefined,
            key_passphrase: undefined,
            remember_password: true,
            save_profile: true,
            profile_name: undefined,
            reconnect_on_launch: false,
          },
        });
        return Promise.resolve({
          status: 'connected',
          mount,
        });
      }
      return Promise.reject(new Error(`Unhandled command: ${cmd}`));
    });

    const { onClose, onMounted } = setupDialog();

    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith('list_remote_mount_profiles');
    });

    fillPasswordForm();
    fireEvent.click(screen.getByRole('button', { name: 'Connect' }));

    await waitFor(() => {
      expect(onMounted).toHaveBeenCalledWith(mount);
      expect(onClose).toHaveBeenCalledTimes(1);
    });
  });

  it('handles host-key challenge and resumes to connected', async () => {
    const mount = {
      mount_id: 'mount-2',
      local_path: '/tmp/brainflow/mounts/mount-2',
      display_name: 'alice@login.example.org:/data',
      origin: {
        label: 'alice@login.example.org:/data',
        host: 'login.example.org',
        port: 22,
        user: 'alice',
        remote_path: '/data',
      },
    };

    invokeMock.mockImplementation((cmd: string, args?: InvokeArgs) => {
      if (cmd === 'list_remote_mount_profiles') {
        return Promise.resolve([]);
      }
      if (cmd === 'remote_mount_connect') {
        return Promise.resolve({
          status: 'need_host_key',
          challenge: {
            challenge_id: 'challenge-123',
            host: 'login.example.org',
            port: 22,
            algorithm: 'ssh-ed25519',
            sha256_fingerprint: 'SHA256:abc123',
            disposition: 'unknown',
          },
        });
      }
      if (cmd === 'remote_mount_respond_host_key') {
        expect(args).toEqual({
          challengeId: 'challenge-123',
          trust: true,
        });
        return Promise.resolve({
          status: 'connected',
          mount,
        });
      }
      return Promise.reject(new Error(`Unhandled command: ${cmd}`));
    });

    const { onClose, onMounted } = setupDialog();

    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith('list_remote_mount_profiles');
    });

    fillPasswordForm();
    fireEvent.click(screen.getByRole('button', { name: 'Connect' }));

    await waitFor(() => {
      expect(screen.getByText('Unknown host key')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: 'Trust & Continue' }));

    await waitFor(() => {
      expect(onMounted).toHaveBeenCalledWith(mount);
      expect(onClose).toHaveBeenCalledTimes(1);
    });
  });

  it('renders a host-key mismatch warning when the server key changes', async () => {
    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === 'list_remote_mount_profiles') {
        return Promise.resolve([]);
      }
      if (cmd === 'remote_mount_connect') {
        return Promise.resolve({
          status: 'need_host_key',
          challenge: {
            challenge_id: 'challenge-mismatch',
            host: 'login.example.org',
            port: 22,
            algorithm: 'ssh-ed25519',
            sha256_fingerprint: 'SHA256:mismatch',
            disposition: 'mismatch',
          },
        });
      }
      return Promise.reject(new Error(`Unhandled command: ${cmd}`));
    });

    setupDialog();

    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith('list_remote_mount_profiles');
    });

    fillPasswordForm();
    fireEvent.click(screen.getByRole('button', { name: 'Connect' }));

    await waitFor(() => {
      expect(screen.getByText('Host key mismatch')).toBeInTheDocument();
      expect(screen.getByText('ssh-ed25519 • SHA256:mismatch')).toBeInTheDocument();
    });
  });

  it('handles keyboard-interactive auth challenge', async () => {
    const mount = {
      mount_id: 'mount-3',
      local_path: '/tmp/brainflow/mounts/mount-3',
      display_name: 'alice@login.example.org:/secure',
      origin: {
        label: 'alice@login.example.org:/secure',
        host: 'login.example.org',
        port: 22,
        user: 'alice',
        remote_path: '/secure',
      },
    };

    invokeMock.mockImplementation((cmd: string, args?: InvokeArgs) => {
      if (cmd === 'list_remote_mount_profiles') {
        return Promise.resolve([]);
      }
      if (cmd === 'remote_mount_connect') {
        return Promise.resolve({
          status: 'need_auth',
          challenge: {
            conversation_id: 'conversation-123',
            name: 'Keyboard-interactive',
            instructions: 'Provide OTP',
            prompts: [{ prompt: 'One-time code', echo: false }],
          },
        });
      }
      if (cmd === 'remote_mount_respond_auth') {
        expect(args).toEqual({
          conversationId: 'conversation-123',
          responses: ['123456'],
        });
        return Promise.resolve({
          status: 'connected',
          mount,
        });
      }
      return Promise.reject(new Error(`Unhandled command: ${cmd}`));
    });

    const { onClose, onMounted } = setupDialog();

    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith('list_remote_mount_profiles');
    });

    fillPasswordForm();
    fireEvent.click(screen.getByRole('button', { name: 'Connect' }));

    await waitFor(() => {
      expect(screen.getByText('Keyboard-interactive')).toBeInTheDocument();
    });

    fireEvent.change(screen.getByLabelText('One-time code'), {
      target: { value: '123456' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));

    await waitFor(() => {
      expect(onMounted).toHaveBeenCalledWith(mount);
      expect(onClose).toHaveBeenCalledTimes(1);
    });
  });

  it('surfaces Tauri object error details for failed connect', async () => {
    invokeMock.mockImplementation((cmd: string, _args?: InvokeArgs) => {
      if (cmd === 'list_remote_mount_profiles') {
        return Promise.resolve([]);
      }
      if (cmd === 'remote_mount_connect') {
        return Promise.reject({
          code: 8221,
          details: 'SSH authentication denied: permission denied (publickey,password)',
        });
      }
      return Promise.reject(new Error(`Unhandled command: ${cmd}`));
    });

    setupDialog();

    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith('list_remote_mount_profiles');
    });

    fillPasswordForm();
    fireEvent.click(screen.getByRole('button', { name: 'Connect' }));

    await waitFor(() => {
      expect(
        screen.getByText('SSH authentication denied: permission denied (publickey,password)')
      ).toBeInTheDocument();
    });
  });

  it('adds key-based auth hint when password auth is not offered by host', async () => {
    invokeMock.mockImplementation((cmd: string, _args?: InvokeArgs) => {
      if (cmd === 'list_remote_mount_profiles') {
        return Promise.resolve([]);
      }
      if (cmd === 'remote_mount_connect') {
        return Promise.reject({
          Input: {
            code: 8224,
            details:
              "SSH authentication denied: SSH error: authentication denied for user 'Brad' (partial_success=false, remaining=[\"publickey\", \"hostbased\"])",
          },
        });
      }
      return Promise.reject(new Error(`Unhandled command: ${cmd}`));
    });

    setupDialog();

    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith('list_remote_mount_profiles');
    });

    fillPasswordForm();
    fireEvent.click(screen.getByRole('button', { name: 'Connect' }));

    await waitFor(() => {
      expect(
        screen.getByText(/This host is not offering password authentication\./)
      ).toBeInTheDocument();
      expect(
        screen.getByText(/Switch Auth method to SSH Agent or SSH Key File/)
      ).toBeInTheDocument();
    });
  });

  it('adds keyboard-interactive hint when that is the only offered auth method', async () => {
    invokeMock.mockImplementation((cmd: string, _args?: InvokeArgs) => {
      if (cmd === 'list_remote_mount_profiles') {
        return Promise.resolve([]);
      }
      if (cmd === 'remote_mount_connect') {
        return Promise.reject({
          Input: {
            code: 8224,
            details:
              "SSH authentication denied: SSH error: authentication denied for user 'brad' (partial_success=false, remaining=[\"keyboard-interactive\", \"hostbased\"])",
          },
        });
      }
      return Promise.reject(new Error(`Unhandled command: ${cmd}`));
    });

    setupDialog();

    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith('list_remote_mount_profiles');
    });

    fillPasswordForm();
    fireEvent.click(screen.getByRole('button', { name: 'Connect' }));

    await waitFor(() => {
      expect(
        screen.getByText(/This host expects keyboard-interactive authentication/)
      ).toBeInTheDocument();
      expect(screen.getByText(/Switch Auth method to Keyboard interactive/)).toBeInTheDocument();
    });
  });

  it('sends key file path and passphrase when key-file auth is selected', async () => {
    invokeMock.mockImplementation((cmd: string, args?: InvokeArgs) => {
      if (cmd === 'list_remote_mount_profiles') {
        return Promise.resolve([]);
      }
      if (cmd === 'remote_mount_connect') {
        expect(args).toEqual({
          request: {
            host: 'login.example.org',
            port: 2222,
            user: 'alice',
            remote_path: '/data',
            auth_method: 'key_file',
            password: undefined,
            key_path: '~/.ssh/id_ed25519_brainflow',
            key_passphrase: 'secret-passphrase',
            remember_password: false,
            save_profile: true,
            profile_name: undefined,
            reconnect_on_launch: false,
          },
        });
        return Promise.resolve({
          status: 'need_auth',
          challenge: {
            conversation_id: 'conversation-key-1',
            name: 'Keyboard-interactive',
            instructions: 'Duo prompt',
            prompts: [{ prompt: 'Passcode', echo: false }],
          },
        });
      }
      return Promise.reject(new Error(`Unhandled command: ${cmd}`));
    });

    setupDialog();

    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith('list_remote_mount_profiles');
    });

    fireEvent.change(screen.getByLabelText('Host'), { target: { value: 'login.example.org' } });
    fireEvent.change(screen.getByLabelText('Port'), { target: { value: '2222' } });
    fireEvent.change(screen.getByLabelText('User'), { target: { value: 'alice' } });
    fireEvent.change(screen.getByLabelText('Remote folder'), { target: { value: '/data' } });
    fireEvent.change(screen.getByLabelText('Auth method'), { target: { value: 'key_file' } });
    fireEvent.change(screen.getByLabelText('SSH key file (optional)'), {
      target: { value: '~/.ssh/id_ed25519_brainflow' },
    });
    fireEvent.change(screen.getByLabelText('Key Passphrase (optional)'), {
      target: { value: 'secret-passphrase' },
    });

    fireEvent.click(screen.getByRole('button', { name: 'Connect' }));

    await waitFor(() => {
      expect(screen.getByText('Keyboard-interactive')).toBeInTheDocument();
      expect(screen.getByText('Duo prompt')).toBeInTheDocument();
    });
  });

  describe('reopening a known remote folder', () => {
    const agentProfile = {
      id: 'alice@login.example.org:22:/data',
      name: 'lab data',
      host: 'login.example.org',
      port: 22,
      user: 'alice',
      remote_path: '/data',
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
    const newerProfile = { ...agentProfile, id: 'other', name: 'other', host: 'other.example.org', updated_at_ms: 9 };
    const mount = {
      mount_id: 'mount-7',
      local_path: '/cache/cache-abc',
      display_name: 'lab data',
      origin: {
        mount_id: 'mount-7',
        label: 'alice@login.example.org:/data',
        host: 'login.example.org',
        port: 22,
        user: 'alice',
        remote_path: '/data',
      },
    };

    it('reconnects the matching saved profile without waiting for Connect', async () => {
      invokeMock.mockImplementation((cmd: string, args?: InvokeArgs) => {
        if (cmd === 'list_remote_mount_profiles') return Promise.resolve([newerProfile, agentProfile]);
        if (cmd === 'remote_mount_connect') {
          const request = (args as { request: Record<string, unknown> }).request;
          expect(request.host).toBe('login.example.org');
          expect(request.auth_method).toBe('agent');
          expect(request.remote_path).toBe('/data');
          return Promise.resolve({ status: 'connected', mount });
        }
        return Promise.reject(new Error(`Unhandled command: ${cmd}`));
      });
      const onClose = vi.fn();
      const onMounted = vi.fn().mockResolvedValue(undefined);

      render(
        <RemoteMountDialog
          isOpen={true}
          onClose={onClose}
          onMounted={onMounted}
          initialTarget={{ host: 'login.example.org', port: 22, user: 'alice', remotePath: '/data/' }}
          autoConnect
        />
      );

      await waitFor(() => {
        expect(onMounted).toHaveBeenCalledWith(mount);
        expect(onClose).toHaveBeenCalled();
      });
    });

    it('waits for a password the keychain does not hold', async () => {
      const passwordProfile = { ...agentProfile, auth_method: 'password', has_password: false };
      invokeMock.mockImplementation((cmd: string) => {
        if (cmd === 'list_remote_mount_profiles') return Promise.resolve([passwordProfile]);
        return Promise.reject(new Error(`Unhandled command: ${cmd}`));
      });

      render(
        <RemoteMountDialog
          isOpen={true}
          onClose={vi.fn()}
          onMounted={vi.fn()}
          initialTarget={{ host: 'login.example.org', port: 22, user: 'alice', remotePath: '/data' }}
          autoConnect
        />
      );

      await waitFor(() => {
        expect(screen.getByLabelText('Saved profile')).toHaveValue(passwordProfile.id);
        expect(screen.getByLabelText('Password')).toHaveValue('');
      });
      expect(invokeMock).not.toHaveBeenCalledWith('remote_mount_connect', expect.anything());
    });

    it('prefills an unsaved folder instead of connecting', async () => {
      render(
        <RemoteMountDialog
          isOpen={true}
          onClose={vi.fn()}
          onMounted={vi.fn()}
          initialTarget={{ host: 'scratch.example.org', port: 2200, user: 'bob', remotePath: '/scratch' }}
          autoConnect
        />
      );

      await waitFor(() => {
        expect(screen.getByLabelText('Host')).toHaveValue('scratch.example.org');
        expect(screen.getByLabelText('Port')).toHaveValue('2200');
        expect(screen.getByLabelText('User')).toHaveValue('bob');
        expect(screen.getByLabelText('Remote folder')).toHaveValue('/scratch');
      });
      expect(invokeMock).not.toHaveBeenCalledWith('remote_mount_connect', expect.anything());
    });
  });

  it('fills user and port from a ~/.ssh/config alias', async () => {
    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === 'list_remote_mount_profiles') return Promise.resolve([]);
      if (cmd === 'list_ssh_config_hosts') {
        return Promise.resolve([
          { alias: 'cluster', host_name: 'login.cluster.org', user: 'alice', port: 2222, proxy_jump: null },
          { alias: 'behind', host_name: 'inner.org', user: null, port: null, proxy_jump: 'gw.org' },
        ]);
      }
      return Promise.reject(new Error(`Unhandled command: ${cmd}`));
    });

    setupDialog();

    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith('list_ssh_config_hosts');
    });
    await waitFor(() => {
      expect(screen.getByLabelText('Host')).toHaveAttribute('list');
    });

    fireEvent.change(screen.getByLabelText('Host'), { target: { value: 'cluster' } });

    await waitFor(() => {
      expect(screen.getByLabelText('User')).toHaveValue('alice');
      expect(screen.getByLabelText('Port')).toHaveValue('2222');
      expect(screen.getByText(/From ~\/\.ssh\/config: alice@login\.cluster\.org:2222/)).toBeInTheDocument();
    });

    fireEvent.change(screen.getByLabelText('Host'), { target: { value: 'behind' } });
    await waitFor(() => {
      expect(screen.getByText(/jump host gw\.org/)).toBeInTheDocument();
    });
  });

  it('saves the reconnect-at-launch choice with the profile', async () => {
    invokeMock.mockImplementation((cmd: string, args?: InvokeArgs) => {
      if (cmd === 'list_remote_mount_profiles') return Promise.resolve([]);
      if (cmd === 'remote_mount_connect') {
        const request = (args as { request: Record<string, unknown> }).request;
        expect(request.reconnect_on_launch).toBe(true);
        expect(request.save_profile).toBe(true);
        return Promise.resolve({
          status: 'connected',
          mount: {
            mount_id: 'm',
            local_path: '/c',
            display_name: 'd',
            origin: { mount_id: 'm', label: 'l', host: 'h', port: 22, user: 'u', remote_path: '/' },
          },
        });
      }
      return Promise.reject(new Error(`Unhandled command: ${cmd}`));
    });

    const { onMounted } = setupDialog();
    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith('list_remote_mount_profiles');
    });
    fillPasswordForm();
    fireEvent.click(screen.getByRole('switch', { name: 'Reconnect when Brainflow starts' }));
    fireEvent.click(screen.getByRole('button', { name: 'Connect' }));

    await waitFor(() => {
      expect(onMounted).toHaveBeenCalled();
    });
  });
});
