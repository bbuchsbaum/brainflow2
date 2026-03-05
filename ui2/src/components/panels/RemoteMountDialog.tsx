import React, { useEffect, useMemo, useState } from 'react';
import { getTransport } from '@/services/transport';
import { formatTauriError } from '@/utils/formatTauriError';

type RemoteAuthMethod = 'password' | 'key_file' | 'agent' | 'keyboard_interactive';

interface RemoteMountProfile {
  id: string;
  name: string;
  host: string;
  port: number;
  user: string;
  remote_path: string;
  auth_method: string;
  has_password: boolean;
  updated_at_ms?: number;
}

interface RemoteHostKeyChallenge {
  challenge_id: string;
  host: string;
  port: number;
  algorithm: string;
  sha256_fingerprint: string;
  disposition: 'unknown' | 'mismatch' | string;
}

interface RemoteAuthPrompt {
  prompt: string;
  echo: boolean;
}

interface RemoteAuthChallenge {
  conversation_id: string;
  name: string;
  instructions: string;
  prompts: RemoteAuthPrompt[];
}

export interface ConnectedRemoteMount {
  mount_id: string;
  local_path: string;
  display_name: string;
  origin: {
    label: string;
    host: string;
    port: number;
    user: string;
    remote_path: string;
  };
}

type RemoteMountConnectResult =
  | { status: 'connected'; mount: ConnectedRemoteMount }
  | { status: 'need_host_key'; challenge: RemoteHostKeyChallenge }
  | { status: 'need_auth'; challenge: RemoteAuthChallenge };

type RemoteDialogStep = 'form' | 'host_key' | 'auth';

interface RemoteMountDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onMounted: (mount: ConnectedRemoteMount) => Promise<void> | void;
}

interface RemoteMountFormState {
  host: string;
  port: string;
  user: string;
  remotePath: string;
  authMethod: RemoteAuthMethod;
  password: string;
  keyPath: string;
  keyPassphrase: string;
  rememberPassword: boolean;
  saveProfile: boolean;
  profileName: string;
}

const DEFAULT_FORM: RemoteMountFormState = {
  host: '',
  port: '22',
  user: '',
  remotePath: '/',
  authMethod: 'password',
  password: '',
  keyPath: '',
  keyPassphrase: '',
  rememberPassword: true,
  saveProfile: true,
  profileName: '',
};

function normalizeAuthMethod(authMethod: string): RemoteAuthMethod {
  if (
    authMethod === 'password' ||
    authMethod === 'key_file' ||
    authMethod === 'agent' ||
    authMethod === 'keyboard_interactive'
  ) {
    return authMethod;
  }
  return 'password';
}

function withAuthHint(message: string, authMethod: RemoteAuthMethod): string {
  const lowered = message.toLowerCase();
  const isAuthDenied = lowered.includes('authentication denied');
  const mentionsRemainingMethods = lowered.includes('remaining=[');
  const hasPublicKey = lowered.includes('publickey');
  const hasPassword = lowered.includes('password');
  const hasKeyboardInteractive = lowered.includes('keyboard-interactive');
  const keyboardInteractiveOnly = hasKeyboardInteractive && !hasPublicKey && !hasPassword;
  const onlyKeyBasedMethods = hasPublicKey && !hasPassword && !hasKeyboardInteractive;

  if (
    isAuthDenied &&
    mentionsRemainingMethods &&
    onlyKeyBasedMethods &&
    (authMethod === 'password' || authMethod === 'keyboard_interactive')
  ) {
    return (
      `${message} ` +
      'This host is not offering password authentication. ' +
      'Switch Auth Method to SSH Agent or SSH Key File, and verify username case (typically lowercase).'
    );
  }

  if (isAuthDenied && mentionsRemainingMethods && keyboardInteractiveOnly) {
    if (authMethod !== 'keyboard_interactive') {
      return (
        `${message} ` +
        'This host expects keyboard-interactive authentication (often MFA/Duo). ' +
        'Switch Auth Method to Keyboard Interactive and retry.'
      );
    }

    return (
      `${message} ` +
      'Keyboard-interactive is enabled but authentication still failed. ' +
      'Verify username/case and complete the MFA prompt (Duo/passcode).'
    );
  }

  return message;
}

function sortProfilesByMostRecent(profiles: RemoteMountProfile[]): RemoteMountProfile[] {
  return [...profiles].sort((a, b) => {
    const aUpdated = a.updated_at_ms ?? 0;
    const bUpdated = b.updated_at_ms ?? 0;
    if (aUpdated !== bUpdated) {
      return bUpdated - aUpdated;
    }
    return a.name.localeCompare(b.name);
  });
}

export function RemoteMountDialog({ isOpen, onClose, onMounted }: RemoteMountDialogProps) {
  const [profiles, setProfiles] = useState<RemoteMountProfile[]>([]);
  const [profilesLoading, setProfilesLoading] = useState(false);
  const [selectedProfileId, setSelectedProfileId] = useState('');

  const [form, setForm] = useState<RemoteMountFormState>(DEFAULT_FORM);
  const [step, setStep] = useState<RemoteDialogStep>('form');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [hostKeyChallenge, setHostKeyChallenge] = useState<RemoteHostKeyChallenge | null>(null);
  const [authChallenge, setAuthChallenge] = useState<RemoteAuthChallenge | null>(null);
  const [authResponses, setAuthResponses] = useState<string[]>([]);

  const selectedProfile = useMemo(
    () => profiles.find((profile) => profile.id === selectedProfileId) ?? null,
    [profiles, selectedProfileId]
  );

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    let active = true;

    const bootstrap = async () => {
      setProfilesLoading(true);
      setPending(false);
      setStep('form');
      setError(null);
      setHostKeyChallenge(null);
      setAuthChallenge(null);
      setAuthResponses([]);
      setSelectedProfileId('');
      setForm(DEFAULT_FORM);

      try {
        const loadedProfiles = await getTransport().invoke<RemoteMountProfile[]>(
          'list_remote_mount_profiles'
        );
        if (!active) return;
        const sortedProfiles = sortProfilesByMostRecent(loadedProfiles);
        setProfiles(sortedProfiles);
        if (sortedProfiles.length > 0) {
          const recentProfile = sortedProfiles[0];
          setSelectedProfileId(recentProfile.id);
          applyProfile(recentProfile);
        }
      } catch (profileError) {
        if (!active) return;
        const message = formatTauriError(profileError) || 'Failed to load remote mount profiles.';
        setError(message);
      } finally {
        if (active) {
          setProfilesLoading(false);
        }
      }
    };

    void bootstrap();

    return () => {
      active = false;
    };
  }, [isOpen]);

  const applyProfile = (profile: RemoteMountProfile) => {
    setForm((prev) => ({
      ...prev,
      host: profile.host,
      port: String(profile.port),
      user: profile.user,
      remotePath: profile.remote_path,
      authMethod: normalizeAuthMethod(profile.auth_method),
      password: '',
      keyPath: '',
      keyPassphrase: '',
      rememberPassword: profile.has_password,
      saveProfile: true,
      profileName: profile.name,
    }));
  };

  const handleProfileSelect = (profileId: string) => {
    setSelectedProfileId(profileId);
    if (!profileId) {
      setForm(DEFAULT_FORM);
      return;
    }
    const profile = profiles.find((candidate) => candidate.id === profileId);
    if (profile) {
      applyProfile(profile);
    }
  };

  const handleRemoveProfile = async () => {
    if (!selectedProfile) {
      return;
    }

    setPending(true);
    setError(null);
    try {
      await getTransport().invoke<void>('remove_remote_mount_profile', {
        profileId: selectedProfile.id,
      });

      setProfiles((current) => current.filter((profile) => profile.id !== selectedProfile.id));
      setSelectedProfileId('');
    } catch (removeError) {
      const message = formatTauriError(removeError) || 'Failed to remove profile.';
      setError(message);
    } finally {
      setPending(false);
    }
  };

  const handleConnectOutcome = async (result: RemoteMountConnectResult) => {
    if (result.status === 'connected') {
      await onMounted(result.mount);
      onClose();
      return;
    }

    if (result.status === 'need_host_key') {
      setHostKeyChallenge(result.challenge);
      setAuthChallenge(null);
      setAuthResponses([]);
      setStep('host_key');
      return;
    }

    if (result.status === 'need_auth') {
      setAuthChallenge(result.challenge);
      setAuthResponses(result.challenge.prompts.map(() => ''));
      setHostKeyChallenge(null);
      setStep('auth');
    }
  };

  const handleConnect = async () => {
    const host = form.host.trim();
    const user = form.user.trim();
    const remotePath = form.remotePath.trim();
    const parsedPort = Number.parseInt(form.port, 10);
    const port = Number.isFinite(parsedPort) && parsedPort > 0 ? parsedPort : 22;

    if (!host || !user || !remotePath) {
      setError('Host, user, and remote path are required.');
      return;
    }
    if (form.authMethod === 'password' && !form.password.trim() && !selectedProfile?.has_password) {
      setError('Password is required for password authentication.');
      return;
    }

    setPending(true);
    setError(null);
    setStep('form');
    setHostKeyChallenge(null);
    setAuthChallenge(null);
    setAuthResponses([]);

    try {
      const result = await getTransport().invoke<RemoteMountConnectResult>('remote_mount_connect', {
        request: {
          host,
          port,
          user,
          remote_path: remotePath,
          auth_method: form.authMethod,
          password: form.authMethod === 'password' ? form.password : undefined,
          key_path: form.authMethod === 'key_file' ? form.keyPath.trim() || undefined : undefined,
          key_passphrase:
            form.authMethod === 'key_file' ? form.keyPassphrase || undefined : undefined,
          remember_password: form.authMethod === 'password' ? form.rememberPassword : false,
          save_profile: form.saveProfile,
          profile_name: form.saveProfile ? form.profileName.trim() || undefined : undefined,
        },
      });

      await handleConnectOutcome(result);
    } catch (connectError) {
      const message = formatTauriError(connectError) || 'Failed to connect to remote host.';
      const messageWithHint = withAuthHint(message, form.authMethod);
      setError(messageWithHint);
      setStep('form');
    } finally {
      setPending(false);
    }
  };

  const handleHostKeyDecision = async (trust: boolean) => {
    if (!hostKeyChallenge) {
      return;
    }

    if (!trust) {
      setError('Host key was rejected.');
      setHostKeyChallenge(null);
      setStep('form');
      return;
    }

    setPending(true);
    setError(null);

    try {
      const result = await getTransport().invoke<RemoteMountConnectResult>(
        'remote_mount_respond_host_key',
        {
          challengeId: hostKeyChallenge.challenge_id,
          trust: true,
        }
      );
      await handleConnectOutcome(result);
    } catch (hostKeyError) {
      const message =
        formatTauriError(hostKeyError) || 'Failed to continue after host-key approval.';
      setError(message);
      setStep('form');
      setHostKeyChallenge(null);
    } finally {
      setPending(false);
    }
  };

  const handleAuthResponseChange = (index: number, value: string) => {
    setAuthResponses((current) => {
      const next = [...current];
      next[index] = value;
      return next;
    });
  };

  const handleAuthSubmit = async () => {
    if (!authChallenge) {
      return;
    }

    setPending(true);
    setError(null);

    try {
      const result = await getTransport().invoke<RemoteMountConnectResult>('remote_mount_respond_auth', {
        conversationId: authChallenge.conversation_id,
        responses: authResponses,
      });
      await handleConnectOutcome(result);
    } catch (authError) {
      const message =
        formatTauriError(authError) || 'Failed to continue authentication challenge.';
      setError(message);
      setStep('form');
      setAuthChallenge(null);
      setAuthResponses([]);
    } finally {
      setPending(false);
    }
  };

  if (!isOpen) {
    return null;
  }

  return (
    <div className="remote-mount-overlay" role="presentation">
      <div className="remote-mount-modal" role="dialog" aria-modal="true" aria-label="Remote mount">
        <div className="remote-mount-header">
          <div>
            <h3 className="remote-mount-title">Mount Remote Folder</h3>
            <p className="remote-mount-subtitle">
              Connect over SSH and mount into a local cache path.
            </p>
          </div>
          <button
            type="button"
            className="remote-mount-close"
            onClick={onClose}
            disabled={pending}
            aria-label="Close"
          >
            ×
          </button>
        </div>

        <div className="remote-mount-body">
          {step === 'form' && (
            <div className="remote-mount-form-grid">
              <label className="remote-mount-field">
                <span>Saved Profile</span>
                <div className="remote-mount-profile-row">
                  <select
                    value={selectedProfileId}
                    onChange={(event) => handleProfileSelect(event.target.value)}
                    disabled={pending || profilesLoading}
                  >
                    <option value="">New connection…</option>
                    {profiles.map((profile) => (
                      <option key={profile.id} value={profile.id}>
                        {profile.name}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    onClick={() => void handleRemoveProfile()}
                    disabled={pending || !selectedProfile}
                  >
                    Remove
                  </button>
                </div>
              </label>

              <label className="remote-mount-field">
                <span>Host</span>
                <input
                  value={form.host}
                  onChange={(event) => setForm((prev) => ({ ...prev, host: event.target.value }))}
                  placeholder="login.example.org"
                  disabled={pending}
                />
              </label>

              <div className="remote-mount-row">
                <label className="remote-mount-field">
                  <span>Port</span>
                  <input
                    value={form.port}
                    onChange={(event) => setForm((prev) => ({ ...prev, port: event.target.value }))}
                    placeholder="22"
                    disabled={pending}
                  />
                </label>
                <label className="remote-mount-field">
                  <span>User</span>
                  <input
                    value={form.user}
                    onChange={(event) => setForm((prev) => ({ ...prev, user: event.target.value }))}
                    placeholder="alice"
                    disabled={pending}
                  />
                </label>
              </div>

              <label className="remote-mount-field">
                <span>Remote Folder</span>
                <input
                  value={form.remotePath}
                  onChange={(event) =>
                    setForm((prev) => ({ ...prev, remotePath: event.target.value }))
                  }
                  placeholder="/data/project"
                  disabled={pending}
                />
              </label>

              <label className="remote-mount-field">
                <span>Auth Method</span>
                <select
                  value={form.authMethod}
                  onChange={(event) =>
                    setForm((prev) => ({
                      ...prev,
                      authMethod: normalizeAuthMethod(event.target.value),
                    }))
                  }
                  disabled={pending}
                >
                  <option value="password">Password</option>
                  <option value="key_file">SSH Key File</option>
                  <option value="agent">SSH Agent</option>
                  <option value="keyboard_interactive">Keyboard Interactive</option>
                </select>
              </label>

              {form.authMethod === 'password' && (
                <>
                  <label className="remote-mount-field">
                    <span>Password</span>
                    <input
                      type="password"
                      value={form.password}
                      onChange={(event) =>
                        setForm((prev) => ({ ...prev, password: event.target.value }))
                      }
                      placeholder={selectedProfile?.has_password ? 'Stored in keychain' : ''}
                      disabled={pending}
                    />
                  </label>
                  <label className="remote-mount-checkbox">
                    <input
                      type="checkbox"
                      checked={form.rememberPassword}
                      onChange={(event) =>
                        setForm((prev) => ({ ...prev, rememberPassword: event.target.checked }))
                      }
                      disabled={pending}
                    />
                    <span>Remember password in OS keychain</span>
                  </label>
                </>
              )}

              {form.authMethod === 'key_file' && (
                <>
                  <label className="remote-mount-field">
                    <span>SSH Key File (optional)</span>
                    <input
                      value={form.keyPath}
                      onChange={(event) =>
                        setForm((prev) => ({ ...prev, keyPath: event.target.value }))
                      }
                      placeholder="~/.ssh/id_ed25519"
                      disabled={pending}
                    />
                  </label>
                  <label className="remote-mount-field">
                    <span>Key Passphrase (optional)</span>
                    <input
                      type="password"
                      value={form.keyPassphrase}
                      onChange={(event) =>
                        setForm((prev) => ({ ...prev, keyPassphrase: event.target.value }))
                      }
                      placeholder="Only if your key is encrypted"
                      disabled={pending}
                    />
                  </label>
                  <p className="remote-mount-step-text">
                    Duo-enabled hosts often require a valid SSH key first, then prompt for second factor.
                  </p>
                </>
              )}

              <label className="remote-mount-checkbox">
                <input
                  type="checkbox"
                  checked={form.saveProfile}
                  onChange={(event) =>
                    setForm((prev) => ({ ...prev, saveProfile: event.target.checked }))
                  }
                  disabled={pending}
                />
                <span>Save connection profile</span>
              </label>

              {form.saveProfile && (
                <label className="remote-mount-field">
                  <span>Profile Name</span>
                  <input
                    value={form.profileName}
                    onChange={(event) =>
                      setForm((prev) => ({ ...prev, profileName: event.target.value }))
                    }
                    placeholder={`${form.user || 'user'}@${form.host || 'host'}:${form.remotePath || '/'}`}
                    disabled={pending}
                  />
                </label>
              )}
            </div>
          )}

          {step === 'host_key' && hostKeyChallenge && (
            <div className="remote-mount-step">
              <p className="remote-mount-step-title">
                {hostKeyChallenge.disposition === 'mismatch'
                  ? 'Host key mismatch'
                  : 'Unknown host key'}
              </p>
              <p className="remote-mount-step-text">
                {hostKeyChallenge.host}:{hostKeyChallenge.port}
              </p>
              <p className="remote-mount-step-text">
                {hostKeyChallenge.algorithm} • {hostKeyChallenge.sha256_fingerprint}
              </p>
            </div>
          )}

          {step === 'auth' && authChallenge && (
            <div className="remote-mount-step">
              <p className="remote-mount-step-title">
                {authChallenge.name || 'Additional authentication required'}
              </p>
              {authChallenge.instructions && (
                <p className="remote-mount-step-text">{authChallenge.instructions}</p>
              )}
              <div className="remote-mount-form-grid">
                {authChallenge.prompts.map((prompt, index) => (
                  <label key={`${prompt.prompt}-${index}`} className="remote-mount-field">
                    <span>{prompt.prompt || `Response ${index + 1}`}</span>
                    <input
                      type={prompt.echo ? 'text' : 'password'}
                      value={authResponses[index] ?? ''}
                      onChange={(event) =>
                        handleAuthResponseChange(index, event.target.value)
                      }
                      disabled={pending}
                    />
                  </label>
                ))}
              </div>
            </div>
          )}

          {error && (
            <div className="remote-mount-error" role="status">
              {error}
            </div>
          )}
        </div>

        <div className="remote-mount-footer">
          {step === 'form' && (
            <>
              <button type="button" onClick={onClose} disabled={pending}>
                Cancel
              </button>
              <button type="button" className="primary" onClick={() => void handleConnect()} disabled={pending}>
                {pending ? 'Connecting…' : 'Connect'}
              </button>
            </>
          )}

          {step === 'host_key' && (
            <>
              <button type="button" onClick={() => void handleHostKeyDecision(false)} disabled={pending}>
                Reject
              </button>
              <button type="button" className="primary" onClick={() => void handleHostKeyDecision(true)} disabled={pending}>
                Trust & Continue
              </button>
            </>
          )}

          {step === 'auth' && (
            <>
              <button type="button" onClick={onClose} disabled={pending}>
                Cancel
              </button>
              <button type="button" className="primary" onClick={() => void handleAuthSubmit()} disabled={pending}>
                {pending ? 'Submitting…' : 'Continue'}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
