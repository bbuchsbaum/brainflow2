import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { RemoteAuthChallenge, RemoteHostKeyChallenge } from '@brainflow/api';
import {
  Button,
  FieldRow,
  LABEL_WIDTH,
  Notice,
  Select,
  Switch,
  TextField,
  type SelectOption,
} from '@/components/ui/bf';
import { Modal } from '@/components/ui/Modal';
import { getTransport } from '@/services/transport';
import {
  listRemoteMountProfiles,
  type ConnectedRemoteMount,
  type RemoteAuthMethod,
  type RemoteMountConnectResult,
  type RemoteMountProfile,
} from '@/services/RemoteMountService';
import { formatTauriError } from '@/utils/formatTauriError';

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

const AUTH_METHOD_OPTIONS: readonly SelectOption[] = [
  { value: 'password', label: 'Password' },
  { value: 'key_file', label: 'SSH key file' },
  { value: 'agent', label: 'SSH Agent' },
  { value: 'keyboard_interactive', label: 'Keyboard interactive' },
];

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
      'Switch Auth method to SSH Agent or SSH Key File, and verify username case (typically lowercase).'
    );
  }

  if (isAuthDenied && mentionsRemainingMethods && keyboardInteractiveOnly) {
    if (authMethod !== 'keyboard_interactive') {
      return (
        `${message} ` +
        'This host expects keyboard-interactive authentication (often MFA/Duo). ' +
        'Switch Auth method to Keyboard interactive and retry.'
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

function profileHasStoredSecret(
  profile: RemoteMountProfile | null,
  authMethod: RemoteAuthMethod
): boolean {
  if (!profile) {
    return false;
  }

  if (authMethod === 'password') {
    return profile.has_password;
  }

  if (authMethod === 'key_file') {
    return profile.has_key_passphrase;
  }

  return false;
}

function rememberSecretLabel(authMethod: RemoteAuthMethod): string | null {
  if (authMethod === 'password') {
    return 'Remember password in OS keychain';
  }

  if (authMethod === 'key_file') {
    return 'Remember key passphrase in OS keychain';
  }

  return null;
}

function sortProfilesByMostRecent(profiles: RemoteMountProfile[]): RemoteMountProfile[] {
  return [...profiles].sort((a, b) => {
    const aUpdated = Number(a.updated_at_ms ?? 0);
    const bUpdated = Number(b.updated_at_ms ?? 0);
    if (aUpdated !== bUpdated) {
      return bUpdated - aUpdated;
    }
    return a.name.localeCompare(b.name);
  });
}

export function RemoteMountDialog({ isOpen, onClose, onMounted }: RemoteMountDialogProps) {
  const profileSelectRef = useRef<HTMLSelectElement | null>(null);
  const authInputRef = useRef<HTMLInputElement | null>(null);
  const trustButtonRef = useRef<HTMLButtonElement | null>(null);
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

    if (step === 'host_key') {
      trustButtonRef.current?.focus();
      return;
    }

    if (step === 'auth') {
      authInputRef.current?.focus();
      return;
    }

    profileSelectRef.current?.focus();
  }, [isOpen, step]);

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
        const loadedProfiles = await listRemoteMountProfiles();
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
    const authMethod = normalizeAuthMethod(profile.auth_method);
    setForm((prev) => ({
      ...prev,
      host: profile.host,
      port: String(profile.port),
      user: profile.user,
      remotePath: profile.remote_path,
      authMethod,
      password: '',
      keyPath: profile.key_path ?? '',
      keyPassphrase: '',
      rememberPassword:
        authMethod === 'password'
          ? profile.has_password
          : authMethod === 'key_file'
            ? profile.has_key_passphrase
            : false,
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
    if (form.authMethod === 'password' && !form.password.trim() && !profileHasStoredSecret(selectedProfile, 'password')) {
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
          remember_password:
            form.authMethod === 'password' || form.authMethod === 'key_file'
              ? form.rememberPassword
              : false,
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
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Mount remote folder"
      ariaLabel="Remote mount"
      size="xl"
      initialFocusRef={profileSelectRef}
      closeOnEscape={!pending}
      closeOnOverlayClick={!pending}
      closeButtonDisabled={pending}
      bodyClassName="p-0"
      className="max-w-[560px]"
    >
      <p className="m-0 px-3 pt-3 text-bf-sm text-bf-text-secondary">
        Connect over SSH and mount into a local cache path.
      </p>

      <div className="min-h-0 flex-1 overflow-auto px-3 py-2">
        {step === 'form' && (
          <div className="flex flex-col">
            <FieldRow label="Saved profile" labelWidth="wide">
              {(field) => (
                <div className="flex w-full min-w-0 items-center gap-1">
                  <Select
                    {...field}
                    ref={profileSelectRef}
                    value={selectedProfileId}
                    onValueChange={handleProfileSelect}
                    disabled={pending || profilesLoading}
                  >
                    <option value="">New connection…</option>
                    {profiles.map((profile) => (
                      <option key={profile.id} value={profile.id}>
                        {profile.name}
                      </option>
                    ))}
                  </Select>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => void handleRemoveProfile()}
                    disabled={pending || !selectedProfile}
                  >
                    Remove
                  </Button>
                </div>
              )}
            </FieldRow>

            <FieldRow label="Host" labelWidth="wide" disabled={pending}>
              <TextField
                value={form.host}
                onChange={(event) => setForm((prev) => ({ ...prev, host: event.target.value }))}
                placeholder="login.example.org"
                mono
              />
            </FieldRow>

            <FieldRow label="Port" labelWidth="wide" disabled={pending}>
              <TextField
                value={form.port}
                onChange={(event) => setForm((prev) => ({ ...prev, port: event.target.value }))}
                placeholder="22"
                inputMode="numeric"
                data-numeric="true"
                mono
                className="w-20"
              />
            </FieldRow>

            <FieldRow label="User" labelWidth="wide" disabled={pending}>
              <TextField
                value={form.user}
                onChange={(event) => setForm((prev) => ({ ...prev, user: event.target.value }))}
                placeholder="alice"
                mono
              />
            </FieldRow>

            <FieldRow label="Remote folder" labelWidth="wide" disabled={pending}>
              <TextField
                value={form.remotePath}
                onChange={(event) =>
                  setForm((prev) => ({ ...prev, remotePath: event.target.value }))
                }
                placeholder="/data/project"
                mono
              />
            </FieldRow>

            <FieldRow label="Auth method" labelWidth="wide" disabled={pending}>
              <Select
                value={form.authMethod}
                onValueChange={(value) => {
                  const nextAuthMethod = normalizeAuthMethod(value);
                  setForm((prev) => ({
                    ...prev,
                    authMethod: nextAuthMethod,
                    rememberPassword:
                      nextAuthMethod === 'password'
                        ? selectedProfile
                          ? profileHasStoredSecret(selectedProfile, 'password')
                          : true
                        : nextAuthMethod === 'key_file'
                          ? profileHasStoredSecret(selectedProfile, 'key_file')
                          : false,
                  }));
                }}
                options={AUTH_METHOD_OPTIONS}
              />
            </FieldRow>

            {form.authMethod === 'password' && (
              <>
                <FieldRow label="Password" labelWidth="wide" disabled={pending}>
                  <TextField
                    type="password"
                    value={form.password}
                    onChange={(event) =>
                      setForm((prev) => ({ ...prev, password: event.target.value }))
                    }
                    placeholder={
                      profileHasStoredSecret(selectedProfile, 'password') ? 'Stored in keychain' : ''
                    }
                  />
                </FieldRow>
                <SwitchRow
                  checked={form.rememberPassword}
                  onCheckedChange={(checked) =>
                    setForm((prev) => ({ ...prev, rememberPassword: checked }))
                  }
                  disabled={pending}
                >
                  {rememberSecretLabel('password')}
                </SwitchRow>
              </>
            )}

            {form.authMethod === 'key_file' && (
              <>
                <FieldRow label="SSH key file (optional)" labelWidth="wide" disabled={pending}>
                  <TextField
                    value={form.keyPath}
                    onChange={(event) =>
                      setForm((prev) => ({ ...prev, keyPath: event.target.value }))
                    }
                    placeholder="~/.ssh/id_ed25519"
                    mono
                  />
                </FieldRow>
                <FieldRow label="Key Passphrase (optional)" labelWidth="wide" disabled={pending}>
                  <TextField
                    type="password"
                    value={form.keyPassphrase}
                    onChange={(event) =>
                      setForm((prev) => ({ ...prev, keyPassphrase: event.target.value }))
                    }
                    placeholder={
                      profileHasStoredSecret(selectedProfile, 'key_file')
                        ? 'Stored in keychain'
                        : 'Only if your key is encrypted'
                    }
                  />
                </FieldRow>
                <SwitchRow
                  checked={form.rememberPassword}
                  onCheckedChange={(checked) =>
                    setForm((prev) => ({ ...prev, rememberPassword: checked }))
                  }
                  disabled={pending}
                >
                  {rememberSecretLabel('key_file')}
                </SwitchRow>
                <Notice severity="info" role={undefined} className="my-1">
                  Duo-enabled hosts often require a valid SSH key first, then prompt for second
                  factor.
                </Notice>
              </>
            )}

            <SwitchRow
              checked={form.saveProfile}
              onCheckedChange={(checked) => setForm((prev) => ({ ...prev, saveProfile: checked }))}
              disabled={pending}
            >
              Save connection profile
            </SwitchRow>

            {form.saveProfile && (
              <FieldRow label="Profile name" labelWidth="wide" disabled={pending}>
                <TextField
                  value={form.profileName}
                  onChange={(event) =>
                    setForm((prev) => ({ ...prev, profileName: event.target.value }))
                  }
                  placeholder={`${form.user || 'user'}@${form.host || 'host'}:${form.remotePath || '/'}`}
                />
              </FieldRow>
            )}
          </div>
        )}

        {step === 'host_key' && hostKeyChallenge && (
          <div className="flex flex-col gap-2">
            <Notice
              severity={hostKeyChallenge.disposition === 'mismatch' ? 'danger' : 'warning'}
              role={undefined}
            >
              <p className="m-0 text-bf-sm font-semibold">
                {hostKeyChallenge.disposition === 'mismatch'
                  ? 'Host key mismatch'
                  : 'Unknown host key'}
              </p>
            </Notice>
            <p className="m-0 font-mono text-bf-xs text-bf-text-secondary">
              {hostKeyChallenge.host}:{hostKeyChallenge.port}
            </p>
            <p className="m-0 break-all font-mono text-bf-xs text-bf-text-secondary">
              {hostKeyChallenge.algorithm} • {hostKeyChallenge.sha256_fingerprint}
            </p>
          </div>
        )}

        {step === 'auth' && authChallenge && (
          <div className="flex flex-col gap-1">
            <p className="m-0 text-bf-sm font-semibold text-foreground">
              {authChallenge.name || 'Additional authentication required'}
            </p>
            {authChallenge.instructions && (
              <p className="m-0 text-bf-xs text-bf-text-secondary">{authChallenge.instructions}</p>
            )}
            {authChallenge.prompts.map((prompt, index) => (
              <FieldRow
                key={`${prompt.prompt}-${index}`}
                label={prompt.prompt || `Response ${index + 1}`}
                labelWidth="wide"
                disabled={pending}
              >
                <TextField
                  ref={index === 0 ? authInputRef : undefined}
                  type={prompt.echo ? 'text' : 'password'}
                  value={authResponses[index] ?? ''}
                  onChange={(event) => handleAuthResponseChange(index, event.target.value)}
                />
              </FieldRow>
            ))}
          </div>
        )}

        {error && (
          <Notice severity="danger" role="status" className="mt-2">
            {error}
          </Notice>
        )}
      </div>

      <div className="flex justify-end gap-2 border-t border-bf-border-subtle px-3 py-2">
        {step === 'form' && (
          <>
            <Button variant="secondary" size="sm" onClick={onClose} disabled={pending}>
              Cancel
            </Button>
            <Button
              variant="primary"
              size="sm"
              onClick={() => void handleConnect()}
              disabled={pending}
            >
              {pending ? 'Connecting…' : 'Connect'}
            </Button>
          </>
        )}

        {step === 'host_key' && (
          <>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => void handleHostKeyDecision(false)}
              disabled={pending}
            >
              Reject
            </Button>
            <Button
              variant="primary"
              size="sm"
              ref={trustButtonRef}
              onClick={() => void handleHostKeyDecision(true)}
              disabled={pending}
            >
              Trust & Continue
            </Button>
          </>
        )}

        {step === 'auth' && (
          <>
            <Button variant="secondary" size="sm" onClick={onClose} disabled={pending}>
              Cancel
            </Button>
            <Button
              variant="primary"
              size="sm"
              onClick={() => void handleAuthSubmit()}
              disabled={pending}
            >
              {pending ? 'Submitting…' : 'Continue'}
            </Button>
          </>
        )}
      </div>
    </Modal>
  );
}

/** On/off form option: a bf Switch with its visible label, indented to the field column. */
function SwitchRow({
  checked,
  onCheckedChange,
  disabled,
  children,
}: {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="py-1" style={{ paddingLeft: LABEL_WIDTH.wide + 12 }}>
      <Switch checked={checked} onCheckedChange={onCheckedChange} disabled={disabled}>
        {children}
      </Switch>
    </div>
  );
}
