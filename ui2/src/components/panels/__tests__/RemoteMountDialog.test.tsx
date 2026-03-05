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
  fireEvent.change(screen.getByLabelText('Remote Folder'), { target: { value: '/data' } });
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
            has_password: false,
            updated_at_ms: 20,
          },
        ]);
      }
      return Promise.reject(new Error(`Unhandled command: ${cmd}`));
    });

    setupDialog();

    await waitFor(() => {
      expect(screen.getByLabelText('Saved Profile')).toHaveValue('newer');
      expect(screen.getByLabelText('Host')).toHaveValue('new.example.org');
      expect(screen.getByLabelText('Port')).toHaveValue('2222');
      expect(screen.getByLabelText('User')).toHaveValue('newuser');
      expect(screen.getByLabelText('Remote Folder')).toHaveValue('/new');
      expect(screen.getByLabelText('Auth Method')).toHaveValue('key_file');
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
      expect(screen.getByLabelText('Saved Profile')).toHaveValue('profile-1');
    });

    fireEvent.change(screen.getByLabelText('Saved Profile'), { target: { value: '' } });

    await waitFor(() => {
      expect(screen.getByLabelText('Host')).toHaveValue('');
      expect(screen.getByLabelText('Port')).toHaveValue('22');
      expect(screen.getByLabelText('User')).toHaveValue('');
      expect(screen.getByLabelText('Remote Folder')).toHaveValue('/');
      expect(screen.getByLabelText('Auth Method')).toHaveValue('password');
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
        screen.getByText(/Switch Auth Method to SSH Agent or SSH Key File/)
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
      expect(screen.getByText(/Switch Auth Method to Keyboard Interactive/)).toBeInTheDocument();
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
    fireEvent.change(screen.getByLabelText('Remote Folder'), { target: { value: '/data' } });
    fireEvent.change(screen.getByLabelText('Auth Method'), { target: { value: 'key_file' } });
    fireEvent.change(screen.getByLabelText('SSH Key File (optional)'), {
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
});
