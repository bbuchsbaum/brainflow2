import { useFileBrowserStore } from '@/stores/fileBrowserStore';
import type {
  RemoteMountConnectResult as ApiRemoteMountConnectResult,
  RemoteMountInfo as ApiRemoteMountInfo,
  RemoteMountProfile as ApiRemoteMountProfile,
  SshConfigHost as ApiSshConfigHost,
  RemoteFolderListing,
  RemoteMountStatus,
  RemoteCacheUsage,
} from '@brainflow/api';
import type { MountSource } from '@/types/filesystem';
import { getTransport } from './transport';
import { formatTauriError } from '@/utils/formatTauriError';

export type RemoteAuthMethod = 'password' | 'key_file' | 'agent' | 'keyboard_interactive';

export type RemoteMountProfile = ApiRemoteMountProfile;
export type ConnectedRemoteMount = ApiRemoteMountInfo;
export type RemoteMountConnectResult = ApiRemoteMountConnectResult;
export type SshConfigHost = ApiSshConfigHost;

/** Where a remote folder lives; enough to find its saved profile again. */
export type { RemoteFolderListing, RemoteMountStatus, RemoteCacheUsage };

/** Progress of a "make available offline" job (`remote-prefetch-progress`). */
export interface RemotePrefetchProgress {
  job_id: string;
  mount_id: string;
  folder: string;
  state: 'scanning' | 'downloading' | 'done' | 'cancelled' | 'failed';
  files_done: number;
  files_total: number;
  bytes_done: number;
  bytes_total: number;
  current: string | null;
  error: string | null;
  truncated: boolean;
}

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
  attempt_id?: string;
  browse_only?: boolean;
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

/** A fresh id for one connect attempt, so it can be cancelled. */
export function newRemoteAttemptId(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `attempt-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }
}

/** Stop a connect attempt and drop any prompt it is waiting on. */
export async function cancelRemoteConnect(attemptId: string): Promise<void> {
  try {
    await getTransport().invoke<boolean>('remote_mount_cancel_connect', { attemptId });
  } catch (error) {
    console.warn('Cancelling remote connect failed:', error);
  }
}

/** Subfolders on a host this app is signed in to (default: home). */
export async function listRemoteFolders(
  request: RemoteMountConnectRequest,
  path?: string
): Promise<RemoteFolderListing> {
  return getTransport().invoke<RemoteFolderListing>('remote_list_folders', {
    request,
    path: path ?? null,
  });
}

/** Release a session signed in to only for browsing folders. */
export async function closeRemoteBrowse(request: RemoteMountConnectRequest): Promise<void> {
  try {
    await getTransport().invoke<boolean>('remote_browse_close', { request });
  } catch {
    // Nothing to release.
  }
}

export async function getRemoteMountStatuses(): Promise<RemoteMountStatus[]> {
  return getTransport().invoke<RemoteMountStatus[]>('remote_mount_statuses');
}

export async function updateRemoteMountProfile(
  profileId: string,
  changes: { name?: string; reconnectOnLaunch?: boolean }
): Promise<RemoteMountProfile> {
  return getTransport().invoke<RemoteMountProfile>('update_remote_mount_profile', {
    profileId,
    name: changes.name ?? null,
    reconnectOnLaunch: changes.reconnectOnLaunch ?? null,
  });
}

export async function getRemoteCacheUsage(): Promise<RemoteCacheUsage> {
  return getTransport().invoke<RemoteCacheUsage>('remote_cache_usage');
}

export async function setRemoteCacheBudget(budgetBytes: number): Promise<RemoteCacheUsage> {
  return getTransport().invoke<RemoteCacheUsage>('set_remote_cache_budget', { budgetBytes });
}

export async function clearInactiveRemoteCaches(): Promise<RemoteCacheUsage> {
  return getTransport().invoke<RemoteCacheUsage>('clear_inactive_remote_caches');
}

/** Start downloading a remote folder's images for offline use; returns the job id. */
export async function startRemotePrefetch(path: string): Promise<string> {
  return getTransport().invoke<string>('remote_prefetch_folder', { path });
}

export async function cancelRemotePrefetch(jobId: string): Promise<void> {
  await getTransport().invoke<boolean>('remote_prefetch_cancel', { jobId });
}

/** `user@host[:port]:/path`, the way people write remote locations. */
export function formatRemoteLocation(source: Pick<MountSource, 'host' | 'port' | 'user' | 'remotePath' | 'label'>): string {
  if (!source.host) return source.label ?? 'remote';
  const user = source.user ? `${source.user}@` : '';
  const port = source.port && source.port !== 22 ? `:${source.port}` : '';
  const path = source.remotePath ? `:${source.remotePath}` : '';
  return `${user}${source.host}${port}${path}`;
}

/** `user@host[:port]`. */
export function formatRemoteHost(source: Pick<MountSource, 'host' | 'port' | 'user' | 'label'>): string {
  return formatRemoteLocation({ ...source, remotePath: undefined });
}

/** Human-readable byte count. */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 1024) return `${Math.max(0, Math.round(bytes || 0))} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let unit = -1;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value >= 100 ? value.toFixed(0) : value.toFixed(1)} ${units[unit]}`;
}
