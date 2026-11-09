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
  cancelRemoteConnect,
  closeRemoteBrowse,
  findProfileForTarget,
  listRemoteFolders,
  listRemoteMountProfiles,
  listSshConfigHosts,
  newRemoteAttemptId,
  updateRemoteMountProfile,
  type RemoteFolderListing,
  type ConnectedRemoteMount,
  type RemoteAuthMethod,
  type RemoteMountConnectResult,
  type RemoteMountProfile,
  type RemoteMountTarget,
  type SshConfigHost,
} from '@/services/RemoteMountService';
import { formatTauriError } from '@/utils/formatTauriError';

type RemoteDialogStep = 'form' | 'host_key' | 'auth' | 'browse' | 'manage';
type ConnectPurpose = 'mount' | 'browse';

interface ProfileDraft {
  name: string;
  reconnectOnLaunch: boolean;
}

interface RemoteMountDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onMounted: (mount: ConnectedRemoteMount) => Promise<void> | void;
  /**
   * Open on this folder (e.g. a remote Recents entry): its saved profile is
   * selected, or the form is prefilled when there is none.
   */
  initialTarget?: RemoteMountTarget | null;
  /**
   * With `initialTarget` and a saved profile that needs no typed secret,
   * connect straight away; the dialog only shows if SSH asks for something.
   */
  autoConnect?: boolean;
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
  reconnectOnLaunch: boolean;
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
  reconnectOnLaunch: false,
};

const SSH_HOSTS_LIST_ID = 'remote-mount-ssh-config-hosts';

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

/** Whether a profile can connect without the user typing a secret first. */
function canConnectUnattended(profile: RemoteMountProfile): boolean {
  return normalizeAuthMethod(profile.auth_method) !== 'password' || profile.has_password;
}

function formFromTarget(target: RemoteMountTarget): RemoteMountFormState {
  return {
    ...DEFAULT_FORM,
    host: target.host,
    port: String(target.port ?? 22),
    user: target.user ?? '',
    remotePath: target.remotePath || '/',
  };
}

function formFromProfile(profile: RemoteMountProfile): RemoteMountFormState {
  const authMethod = normalizeAuthMethod(profile.auth_method);
  return {
    ...DEFAULT_FORM,
    host: profile.host,
    port: String(profile.port),
    user: profile.user,
    remotePath: profile.remote_path,
    authMethod,
    keyPath: profile.key_path ?? '',
    rememberPassword:
      authMethod === 'password'
        ? profile.has_password
        : authMethod === 'key_file'
          ? profile.has_key_passphrase
          : false,
    saveProfile: true,
    profileName: profile.name,
    reconnectOnLaunch: profile.reconnect_on_launch ?? false,
  };
}

/** Connection settings from the form, as the backend expects them. */
function buildConnectRequest(values: RemoteMountFormState) {
  const parsedPort = Number.parseInt(values.port, 10);
  return {
    host: values.host.trim(),
    port: Number.isFinite(parsedPort) && parsedPort > 0 ? parsedPort : 22,
    user: values.user.trim(),
    remote_path: values.remotePath.trim(),
    auth_method: values.authMethod,
    password: values.authMethod === 'password' ? values.password : undefined,
    key_path: values.authMethod === 'key_file' ? values.keyPath.trim() || undefined : undefined,
    key_passphrase: values.authMethod === 'key_file' ? values.keyPassphrase || undefined : undefined,
    remember_password:
      values.authMethod === 'password' || values.authMethod === 'key_file'
        ? values.rememberPassword
        : false,
    save_profile: values.saveProfile,
    profile_name: values.saveProfile ? values.profileName.trim() || undefined : undefined,
    reconnect_on_launch: values.saveProfile ? values.reconnectOnLaunch : undefined,
  };
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

export function RemoteMountDialog({
  isOpen,
  onClose,
  onMounted,
  initialTarget = null,
  autoConnect = false,
}: RemoteMountDialogProps) {
  const profileSelectRef = useRef<HTMLSelectElement | null>(null);
  const authInputRef = useRef<HTMLInputElement | null>(null);
  const trustButtonRef = useRef<HTMLButtonElement | null>(null);
  const [profiles, setProfiles] = useState<RemoteMountProfile[]>([]);
  const [profilesLoading, setProfilesLoading] = useState(false);
  const [selectedProfileId, setSelectedProfileId] = useState('');
  const [sshHosts, setSshHosts] = useState<SshConfigHost[]>([]);

  const [form, setForm] = useState<RemoteMountFormState>(DEFAULT_FORM);
  const [step, setStep] = useState<RemoteDialogStep>('form');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [hostKeyChallenge, setHostKeyChallenge] = useState<RemoteHostKeyChallenge | null>(null);
  const [authChallenge, setAuthChallenge] = useState<RemoteAuthChallenge | null>(null);
  const [authResponses, setAuthResponses] = useState<string[]>([]);
  const [notice, setNotice] = useState<string | null>(null);

  // The attempt in flight (for Cancel) and what it is for.
  const attemptRef = useRef<string | null>(null);
  const purposeRef = useRef<ConnectPurpose>('mount');
  // Remote folder browser.
  const [browseListing, setBrowseListing] = useState<RemoteFolderListing | null>(null);
  const [browseLoading, setBrowseLoading] = useState(false);
  const browseRequestRef = useRef<ReturnType<typeof buildConnectRequest> | null>(null);
  // Saved-connection editor.
  const [drafts, setDrafts] = useState<Record<string, ProfileDraft>>({});

  const selectedProfile = useMemo(
    () => profiles.find((profile) => profile.id === selectedProfileId) ?? null,
    [profiles, selectedProfileId]
  );
  const sshHost = useMemo(() => {
    const host = form.host.trim().toLowerCase();
    return host ? (sshHosts.find((candidate) => candidate.alias === host) ?? null) : null;
  }, [form.host, sshHosts]);

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

    if (step === 'form') {
      profileSelectRef.current?.focus();
    }
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
      setNotice(null);
      setBrowseListing(null);
      attemptRef.current = null;

      void listSshConfigHosts().then((hosts) => {
        if (active) setSshHosts(hosts);
      });

      try {
        const loadedProfiles = await listRemoteMountProfiles();
        if (!active) return;
        const sortedProfiles = sortProfilesByMostRecent(loadedProfiles);
        setProfiles(sortedProfiles);
        if (initialTarget) {
          const profile = findProfileForTarget(sortedProfiles, initialTarget);
          if (profile) {
            setSelectedProfileId(profile.id);
            const profileForm = formFromProfile(profile);
            setForm(profileForm);
            if (autoConnect && canConnectUnattended(profile)) {
              setProfilesLoading(false);
              await connectWith(profileForm, profile, () => active);
            }
          } else {
            setForm(formFromTarget(initialTarget));
          }
        } else if (sortedProfiles.length > 0) {
          const recentProfile = sortedProfiles[0];
          setSelectedProfileId(recentProfile.id);
          setForm(formFromProfile(recentProfile));
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
    // The target and auto-connect choice are read once per opening.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  const applyProfile = (profile: RemoteMountProfile) => {
    setForm(formFromProfile(profile));
  };

  const handleHostChange = (value: string) => {
    const alias = sshHosts.find((candidate) => candidate.alias === value.trim().toLowerCase());
    setForm((prev) => ({
      ...prev,
      host: value,
      // Picking a ~/.ssh/config alias fills what the config knows and the
      // form has not been given yet.
      user: alias?.user && !prev.user.trim() ? alias.user : prev.user,
      port: alias?.port && prev.port.trim() === '22' ? String(alias.port) : prev.port,
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

  const handleRemoveProfile = async (profileId: string | undefined = selectedProfile?.id) => {
    if (!profileId) {
      return;
    }

    setPending(true);
    setError(null);
    try {
      await getTransport().invoke<void>('remove_remote_mount_profile', {
        profileId,
      });

      setProfiles((current) => current.filter((profile) => profile.id !== profileId));
      setDrafts((current) => {
        const next = { ...current };
        delete next[profileId];
        return next;
      });
      if (selectedProfileId === profileId) setSelectedProfileId('');
    } catch (removeError) {
      const message = formatTauriError(removeError) || 'Failed to remove profile.';
      setError(message);
    } finally {
      setPending(false);
    }
  };

  const handleConnectOutcome = async (result: RemoteMountConnectResult) => {
    if (result.status === 'connected') {
      attemptRef.current = null;
      await onMounted(result.mount);
      handleClose();
      return;
    }

    if (result.status === 'session_ready') {
      attemptRef.current = null;
      setHostKeyChallenge(null);
      setAuthChallenge(null);
      setStep('browse');
      const typed = form.remotePath.trim();
      await loadBrowseFolder(typed && typed !== '/' ? typed : result.session.home, result.session.home);
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

  const handleConnect = () => connectWith(form, selectedProfile, () => true);

  async function connectWith(
    values: RemoteMountFormState,
    profile: RemoteMountProfile | null,
    isActive: () => boolean,
    purpose: ConnectPurpose = 'mount'
  ) {
    const request = buildConnectRequest(values);
    // A ~/.ssh/config alias may supply the user.
    const configUser = sshHosts.find(
      (candidate) => candidate.alias === request.host.toLowerCase()
    )?.user;

    if (!request.host || (!request.user && !configUser) || (purpose === 'mount' && !request.remote_path)) {
      setError('Host, user, and remote path are required.');
      return;
    }
    if (values.authMethod === 'password' && !values.password.trim() && !profileHasStoredSecret(profile, 'password')) {
      setError('Password is required for password authentication.');
      return;
    }

    const attemptId = newRemoteAttemptId();
    attemptRef.current = attemptId;
    purposeRef.current = purpose;
    const current = () => isActive() && attemptRef.current === attemptId;

    setPending(true);
    setError(null);
    setNotice(null);
    setStep('form');
    setHostKeyChallenge(null);
    setAuthChallenge(null);
    setAuthResponses([]);

    if (purpose === 'browse') {
      browseRequestRef.current = request;
    }

    try {
      const result = await getTransport().invoke<RemoteMountConnectResult>('remote_mount_connect', {
        request: {
          ...request,
          remote_path: request.remote_path || '/',
          attempt_id: attemptId,
          browse_only: purpose === 'browse' ? true : undefined,
          // Browsing signs in only; profile and keychain choices apply on Connect.
          ...(purpose === 'browse'
            ? { save_profile: false, remember_password: undefined, reconnect_on_launch: undefined }
            : {}),
        },
      });

      if (!current()) return;
      await handleConnectOutcome(result);
    } catch (connectError) {
      if (!current()) return;
      attemptRef.current = null;
      const message = formatTauriError(connectError) || 'Failed to connect to remote host.';
      const messageWithHint = withAuthHint(message, values.authMethod);
      setError(messageWithHint);
      setStep('form');
    } finally {
      if (isActive()) setPending(false);
    }
  }

  /** Stop the attempt in flight (or waiting on a prompt) and return to the form. */
  const handleCancelAttempt = () => {
    const attemptId = attemptRef.current;
    attemptRef.current = null;
    if (attemptId) void cancelRemoteConnect(attemptId);
    setPending(false);
    setHostKeyChallenge(null);
    setAuthChallenge(null);
    setAuthResponses([]);
    setStep('form');
    setError(null);
    setNotice('Connection cancelled.');
  };

  /** Close, abandoning any attempt and releasing a browse-only session. */
  function handleClose() {
    const attemptId = attemptRef.current;
    attemptRef.current = null;
    if (attemptId) void cancelRemoteConnect(attemptId);
    const browseRequest = browseRequestRef.current;
    browseRequestRef.current = null;
    if (browseRequest) void closeRemoteBrowse(browseRequest);
    onClose();
  }

  async function loadBrowseFolder(path: string | undefined, fallback?: string) {
    const request = browseRequestRef.current ?? buildConnectRequest(form);
    setBrowseLoading(true);
    setError(null);
    try {
      setBrowseListing(await listRemoteFolders({ ...request, remote_path: '/' }, path));
    } catch (browseError) {
      if (fallback && fallback !== path) {
        await loadBrowseFolder(fallback);
        return;
      }
      setError(formatTauriError(browseError) || 'Could not list the remote folder.');
    } finally {
      setBrowseLoading(false);
    }
  }

  const handleBrowse = () => connectWith(form, selectedProfile, () => true, 'browse');

  const handleChooseFolder = () => {
    if (browseListing) {
      setForm((prev) => ({ ...prev, remotePath: browseListing.path }));
    }
    setStep('form');
  };

  const openManage = () => {
    const next: Record<string, ProfileDraft> = {};
    for (const profile of profiles) {
      next[profile.id] = {
        name: profile.name,
        reconnectOnLaunch: profile.reconnect_on_launch ?? false,
      };
    }
    setDrafts(next);
    setError(null);
    setNotice(null);
    setStep('manage');
  };

  const changedDrafts = profiles.filter((profile) => {
    const draft = drafts[profile.id];
    return (
      draft !== undefined &&
      (draft.name.trim() !== profile.name ||
        draft.reconnectOnLaunch !== (profile.reconnect_on_launch ?? false))
    );
  });

  const handleSaveProfiles = async () => {
    setPending(true);
    setError(null);
    try {
      const updated = new Map<string, RemoteMountProfile>();
      for (const profile of changedDrafts) {
        const draft = drafts[profile.id];
        if (!draft.name.trim()) {
          throw new Error('Profile names cannot be empty.');
        }
        updated.set(
          profile.id,
          await updateRemoteMountProfile(profile.id, {
            name: draft.name.trim(),
            reconnectOnLaunch: draft.reconnectOnLaunch,
          })
        );
      }
      setProfiles((current) => current.map((profile) => updated.get(profile.id) ?? profile));
      const selected = selectedProfileId ? updated.get(selectedProfileId) : undefined;
      if (selected) {
        setForm((prev) => ({
          ...prev,
          profileName: selected.name,
          reconnectOnLaunch: selected.reconnect_on_launch,
        }));
      }
      setStep('form');
      if (updated.size > 0) setNotice('Saved connections updated.');
    } catch (saveError) {
      setError(formatTauriError(saveError) || 'Could not save the changes.');
    } finally {
      setPending(false);
    }
  };

  const handleHostKeyDecision = async (trust: boolean) => {
    if (!hostKeyChallenge) {
      return;
    }

    if (!trust) {
      const attemptId = attemptRef.current;
      attemptRef.current = null;
      if (attemptId) void cancelRemoteConnect(attemptId);
      setError('Host key was rejected.');
      setHostKeyChallenge(null);
      setStep('form');
      return;
    }

    const attemptId = attemptRef.current;
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
      if (attemptRef.current !== attemptId) return;
      await handleConnectOutcome(result);
    } catch (hostKeyError) {
      if (attemptRef.current !== attemptId) return;
      attemptRef.current = null;
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

    const attemptId = attemptRef.current;
    setPending(true);
    setError(null);

    try {
      const result = await getTransport().invoke<RemoteMountConnectResult>('remote_mount_respond_auth', {
        conversationId: authChallenge.conversation_id,
        responses: authResponses,
      });
      if (attemptRef.current !== attemptId) return;
      await handleConnectOutcome(result);
    } catch (authError) {
      if (attemptRef.current !== attemptId) return;
      attemptRef.current = null;
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
      onClose={handleClose}
      title="Mount remote folder"
      ariaLabel="Remote mount"
      size="xl"
      initialFocusRef={profileSelectRef}
      closeOnEscape
      closeOnOverlayClick={!pending}
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
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={openManage}
                    disabled={pending || profiles.length === 0}
                    title="Rename saved connections or change which reconnect at launch"
                  >
                    Manage…
                  </Button>
                </div>
              )}
            </FieldRow>

            <FieldRow label="Host" labelWidth="wide" disabled={pending}>
              <TextField
                value={form.host}
                onChange={(event) => handleHostChange(event.target.value)}
                placeholder={sshHosts.length > 0 ? 'Host or ~/.ssh/config alias' : 'login.example.org'}
                list={sshHosts.length > 0 ? SSH_HOSTS_LIST_ID : undefined}
                autoComplete="off"
                mono
              />
            </FieldRow>
            {sshHosts.length > 0 && (
              <datalist id={SSH_HOSTS_LIST_ID}>
                {sshHosts.map((candidate) => (
                  <option key={candidate.alias} value={candidate.alias}>
                    {[
                      candidate.user ? `${candidate.user}@` : '',
                      candidate.host_name ?? candidate.alias,
                    ].join('')}
                  </option>
                ))}
              </datalist>
            )}
            {sshHost && (
              <p
                className="m-0 py-0.5 text-bf-xs text-bf-text-secondary"
                style={{ paddingLeft: LABEL_WIDTH.wide + 12 }}
              >
                From ~/.ssh/config: {sshHost.user ? `${sshHost.user}@` : ''}
                {sshHost.host_name ?? sshHost.alias}
                {sshHost.port && sshHost.port !== 22 ? `:${sshHost.port}` : ''}
              </p>
            )}
            {sshHost?.proxy_jump && (
              <Notice severity="warning" role={undefined} className="my-1">
                This host is reached through the jump host {sshHost.proxy_jump}, which remote
                mounts cannot use yet. Connect over VPN or use a directly reachable host.
              </Notice>
            )}

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
                placeholder={sshHost?.user ?? 'alice'}
                mono
              />
            </FieldRow>

            <FieldRow label="Remote folder" labelWidth="wide" disabled={pending}>
              {(field) => (
                <div className="flex w-full min-w-0 items-center gap-1">
                  <TextField
                    {...field}
                    value={form.remotePath}
                    onChange={(event) =>
                      setForm((prev) => ({ ...prev, remotePath: event.target.value }))
                    }
                    placeholder="/data/project"
                    mono
                  />
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => void handleBrowse()}
                    disabled={pending || !form.host.trim()}
                    title="Sign in and pick a folder on the server"
                  >
                    Browse…
                  </Button>
                </div>
              )}
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
              <SwitchRow
                checked={form.reconnectOnLaunch}
                onCheckedChange={(checked) =>
                  setForm((prev) => ({ ...prev, reconnectOnLaunch: checked }))
                }
                disabled={pending}
              >
                Reconnect when Brainflow starts
              </SwitchRow>
            )}

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

        {step === 'browse' && (
          <div className="flex flex-col gap-1" aria-label="Remote folders">
            <div className="flex min-w-0 items-center gap-1">
              <Button
                variant="secondary"
                size="sm"
                onClick={() => void loadBrowseFolder(browseListing?.parent ?? undefined)}
                disabled={browseLoading || !browseListing?.parent}
                title="Parent folder"
              >
                Up
              </Button>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => void loadBrowseFolder(undefined)}
                disabled={browseLoading}
                title="Home folder"
              >
                Home
              </Button>
              <span
                className="min-w-0 flex-1 truncate font-mono text-bf-xs text-bf-text-secondary"
                title={browseListing?.path}
              >
                {browseListing?.path ?? '…'}
              </span>
            </div>
            <ul
              className="m-0 max-h-[280px] min-h-[120px] list-none overflow-auto border border-bf-border-subtle p-0"
              aria-busy={browseLoading}
            >
              {browseLoading && (
                <li className="px-2 py-1 text-bf-xs text-bf-text-secondary">Loading…</li>
              )}
              {!browseLoading && browseListing?.folders.length === 0 && (
                <li className="px-2 py-1 text-bf-xs text-bf-text-secondary">No subfolders</li>
              )}
              {!browseLoading &&
                browseListing?.folders.map((folder) => (
                  <li key={folder}>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="w-full justify-start font-mono font-normal"
                      onClick={() =>
                        void loadBrowseFolder(
                          `${browseListing.path === '/' ? '' : browseListing.path}/${folder}`
                        )
                      }
                    >
                      {folder}/
                    </Button>
                  </li>
                ))}
            </ul>
          </div>
        )}

        {step === 'manage' && (
          <div className="flex flex-col gap-1" aria-label="Saved connections">
            {profiles.length === 0 && (
              <p className="m-0 text-bf-sm text-bf-text-secondary">No saved connections.</p>
            )}
            {profiles.map((profile) => {
              const draft = drafts[profile.id] ?? {
                name: profile.name,
                reconnectOnLaunch: profile.reconnect_on_launch ?? false,
              };
              return (
                <div
                  key={profile.id}
                  className="flex flex-col gap-1 border-b border-bf-border-subtle py-1 last:border-b-0"
                >
                  <div className="flex min-w-0 items-center gap-1">
                    <TextField
                      aria-label={`Name for ${profile.id}`}
                      value={draft.name}
                      onChange={(event) =>
                        setDrafts((current) => ({
                          ...current,
                          [profile.id]: { ...draft, name: event.target.value },
                        }))
                      }
                      disabled={pending}
                    />
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => void handleRemoveProfile(profile.id)}
                      disabled={pending}
                      aria-label={`Remove ${profile.name}`}
                    >
                      Remove
                    </Button>
                  </div>
                  <span className="truncate font-mono text-bf-xs text-bf-text-secondary">
                    {profile.user}@{profile.host}
                    {profile.port !== 22 ? `:${profile.port}` : ''}:{profile.remote_path}
                  </span>
                  <Switch
                    checked={draft.reconnectOnLaunch}
                    onCheckedChange={(checked) =>
                      setDrafts((current) => ({
                        ...current,
                        [profile.id]: { ...draft, reconnectOnLaunch: checked },
                      }))
                    }
                    disabled={pending}
                    aria-label={`Reconnect ${profile.name} when Brainflow starts`}
                  >
                    Reconnect when Brainflow starts
                  </Switch>
                </div>
              );
            })}
          </div>
        )}

        {notice && !error && (
          <Notice severity="info" role="status" className="mt-2">
            {notice}
          </Notice>
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
            <Button
              variant="secondary"
              size="sm"
              onClick={pending ? handleCancelAttempt : handleClose}
            >
              Cancel
            </Button>
            <Button
              variant="primary"
              size="sm"
              onClick={() => void handleConnect()}
              disabled={pending}
            >
              {pending
                ? purposeRef.current === 'browse'
                  ? 'Signing in…'
                  : 'Connecting…'
                : 'Connect'}
            </Button>
          </>
        )}

        {step === 'browse' && (
          <>
            <Button variant="secondary" size="sm" onClick={() => setStep('form')}>
              Back
            </Button>
            <Button
              variant="primary"
              size="sm"
              onClick={handleChooseFolder}
              disabled={browseLoading || !browseListing}
            >
              Use this folder
            </Button>
          </>
        )}

        {step === 'manage' && (
          <>
            <Button variant="secondary" size="sm" onClick={() => setStep('form')} disabled={pending}>
              Back
            </Button>
            <Button
              variant="primary"
              size="sm"
              onClick={() => void handleSaveProfiles()}
              disabled={pending || changedDrafts.length === 0}
            >
              Save changes
            </Button>
          </>
        )}

        {step === 'host_key' && (
          <>
            <Button
              variant="secondary"
              size="sm"
              onClick={() =>
                pending ? handleCancelAttempt() : void handleHostKeyDecision(false)
              }
            >
              {pending ? 'Cancel' : 'Reject'}
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
            <Button variant="secondary" size="sm" onClick={handleCancelAttempt}>
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
