import { useFileBrowserStore } from '@/stores/fileBrowserStore';
import { markRemoteMountActive, useRemoteConnectionStore } from '@/stores/remoteConnectionStore';
import type {
  RemoteMountConnectResult as ApiRemoteMountConnectResult,
  RemoteMountInfo as ApiRemoteMountInfo,
  RemoteMountProfile as ApiRemoteMountProfile,
  SshConfigHost as ApiSshConfigHost,
} from '@brainflow/api';
import { getTransport } from './transport';
import { formatTauriError } from '@/utils/formatTauriError';

export type RemoteAuthMethod = 'password' | 'key_file' | 'agent' | 'keyboard_interactive';

export type RemoteMountProfile = ApiRemoteMountProfile;
export type ConnectedRemoteMount = ApiRemoteMountInfo;
export type RemoteMountConnectResult = ApiRemoteMountConnectResult;
export type SshConfigHost = ApiSshConfigHost;

/** Where a remote folder lives; enough to find its saved profile again. */
export interface RemoteMountTarget {
  host: string;
  port?: number;
  user?: string;
  remotePath?: string;
}

export type StartupRemoteMountSpec =
  | { kind: 'profile'; profile: string }
  | { kind: 'direct'; user: string; host: string; remotePath: string };

interface RemoteMountConnectRequest {
  host: string;
  port?: number;
  user: string;
  remote_path: string;
  auth_method?: string;
  password?: string;
  key_path?: string;
  key_passphrase?: string;
  verify_host_key?: boolean;
  accept_unknown_host_keys?: boolean;
  known_hosts_path?: string;
  remember_password?: boolean;
  save_profile?: boolean;
  profile_name?: string;
  reconnect_on_launch?: boolean;
}

export function buildRemoteMountMountOptions(mount: ConnectedRemoteMount) {
  return {
    displayName: mount.display_name,
    mountSource: {
      kind: 'remote' as const,
      label: mount.origin.label,
      mountId: mount.mount_id,
      host: mount.origin.host,
      port: mount.origin.port,
      user: mount.origin.user,
      remotePath: mount.origin.remote_path,
    },
  };
}

export async function mountConnectedRemoteDirectory(mount: ConnectedRemoteMount): Promise<void> {
  await useFileBrowserStore
    .getState()
    .mountDirectory(mount.local_path, buildRemoteMountMountOptions(mount));
  // A mount that was down is usable again: whatever failed on it may retry.
  if (useRemoteConnectionStore.getState().down[mount.local_path]) {
    markRemoteMountActive(mount.local_path);
  }
}

export async function listRemoteMountProfiles(): Promise<RemoteMountProfile[]> {
  return getTransport().invoke<RemoteMountProfile[]>('list_remote_mount_profiles');
}

/**
 * Host aliases from the user's ~/.ssh/config. Suggestions only: a missing or
 * unreadable config, or a host without the command, yields an empty list.
 */
export async function listSshConfigHosts(): Promise<SshConfigHost[]> {
  try {
    const hosts = await getTransport().invoke<SshConfigHost[]>('list_ssh_config_hosts');
    return Array.isArray(hosts) ? hosts : [];
  } catch {
    return [];
  }
}

/** Remote paths compare the way the backend stores them: leading slash, no trailing one. */
function normalizeRemotePath(path: string | undefined): string {
  const trimmed = (path ?? '').trim().replace(/\/+$/, '');
  if (!trimmed) return '';
  return trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
}

/** The saved profile for a remote folder (e.g. a Recents or Pinned entry), if any. */
export function findProfileForTarget(
  profiles: RemoteMountProfile[],
  target: RemoteMountTarget
): RemoteMountProfile | null {
  const host = target.host.trim().toLowerCase();
  const port = target.port ?? 22;
  const remotePath = normalizeRemotePath(target.remotePath);
  return (
    profiles.find(
      (profile) =>
        profile.host.trim().toLowerCase() === host &&
        profile.port === port &&
        (target.user === undefined || profile.user === target.user) &&
        normalizeRemotePath(profile.remote_path) === remotePath
    ) ?? null
  );
}

/**
 * Reconnect a saved profile without prompting. Secrets come from the keychain
 * and are left there (`remember_password` unset), and the profile's settings
 * are unchanged.
 */
export function buildProfileConnectRequest(profile: RemoteMountProfile): RemoteMountConnectRequest {
  return {
    host: profile.host,
    port: profile.port,
    user: profile.user,
    remote_path: profile.remote_path,
    auth_method: profile.auth_method,
    key_path: profile.key_path ?? undefined,
    verify_host_key: profile.verify_host_key,
    accept_unknown_host_keys: profile.accept_unknown_host_keys,
    known_hosts_path: profile.known_hosts_path ?? undefined,
    save_profile: false,
    profile_name: profile.name,
  };
}

function normalizeProfileLookup(value: string): string {
  return value.trim().toLowerCase();
}

function formatStartupRemoteSpec(spec: StartupRemoteMountSpec): string {
  if (spec.kind === 'profile') {
    return `profile:${spec.profile}`;
  }
  return `${spec.user}@${spec.host}:${spec.remotePath}`;
}

function buildInteractiveStartupError(spec: StartupRemoteMountSpec): Error {
  return new Error(
    `Startup remote mount '${formatStartupRemoteSpec(spec)}' requires interactive SSH confirmation. Use Mount remote (SSH)… to complete the connection.`
  );
}

async function buildStartupRemoteMountRequest(
  spec: StartupRemoteMountSpec
): Promise<RemoteMountConnectRequest> {
  if (spec.kind === 'direct') {
    return {
      host: spec.host,
      user: spec.user,
      remote_path: spec.remotePath,
      // No remember_password: the keychain is left as it is.
      save_profile: false,
    };
  }

  const target = normalizeProfileLookup(spec.profile);
  const profiles = await listRemoteMountProfiles();
  const profile =
    profiles.find((candidate) => normalizeProfileLookup(candidate.id) === target) ??
    profiles.find((candidate) => normalizeProfileLookup(candidate.name) === target);

  if (!profile) {
    throw new Error(`Remote mount profile '${spec.profile}' was not found.`);
  }

  return buildProfileConnectRequest(profile);
}

export async function mountRemoteFromStartupSpec(spec: StartupRemoteMountSpec): Promise<void> {
  const request = await buildStartupRemoteMountRequest(spec);
  const result = await getTransport().invoke<RemoteMountConnectResult>('remote_mount_connect', {
    request,
  });

  if (result.status === 'connected') {
    await mountConnectedRemoteDirectory(result.mount);
    return;
  }

  throw buildInteractiveStartupError(spec);
}

/** Request cancellation; the loading owner reports completion after worker cleanup. */
export async function cancelRemoteFileLoad(path: string): Promise<boolean> {
  return getTransport().invoke<boolean>('cancel_remote_file_load', { path });
}

export interface LaunchReconnectResult {
  mounted: string[];
  /** Profiles that need the user (a prompt, a missing secret, or an error). */
  needsAttention: Array<{ name: string; reason: string }>;
}

/**
 * Mount every saved profile marked "Reconnect at launch". Only connections
 * that need no prompt complete here; the rest are reported so the user can
 * finish them from Recents or the Mount remote dialog.
 */
export async function reconnectRemoteProfilesOnLaunch(): Promise<LaunchReconnectResult> {
  const result: LaunchReconnectResult = { mounted: [], needsAttention: [] };
  let profiles: RemoteMountProfile[];
  try {
    profiles = await listRemoteMountProfiles();
  } catch {
    return result;
  }
  const marked = profiles.filter((profile) => profile.reconnect_on_launch);
  await Promise.all(
    marked.map(async (profile) => {
      try {
        const outcome = await getTransport().invoke<RemoteMountConnectResult>(
          'remote_mount_connect',
          { request: buildProfileConnectRequest(profile) }
        );
        if (outcome.status === 'connected') {
          await mountConnectedRemoteDirectory(outcome.mount);
          result.mounted.push(profile.name);
        } else {
          result.needsAttention.push({
            name: profile.name,
            reason:
              outcome.status === 'need_host_key'
                ? 'the host key needs confirming'
                : 'it needs an interactive sign-in',
          });
        }
      } catch (error) {
        result.needsAttention.push({
          name: profile.name,
          reason: formatTauriError(error) || 'connection failed',
        });
      }
    })
  );
  return result;
}
