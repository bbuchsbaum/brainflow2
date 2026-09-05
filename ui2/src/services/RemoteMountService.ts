import { useFileBrowserStore } from '@/stores/fileBrowserStore';
import type {
  RemoteMountConnectResult as ApiRemoteMountConnectResult,
  RemoteMountInfo as ApiRemoteMountInfo,
  RemoteMountProfile as ApiRemoteMountProfile,
} from '@brainflow/api';
import { getTransport } from './transport';

export type RemoteAuthMethod = 'password' | 'key_file' | 'agent' | 'keyboard_interactive';

export type RemoteMountProfile = ApiRemoteMountProfile;
export type ConnectedRemoteMount = ApiRemoteMountInfo;
export type RemoteMountConnectResult = ApiRemoteMountConnectResult;

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
    `Startup remote mount '${formatStartupRemoteSpec(spec)}' requires interactive SSH confirmation. Use Mount Remote (SSH)… to complete the connection.`
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
      save_profile: false,
      remember_password: false,
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
    remember_password: false,
    save_profile: false,
    profile_name: profile.name,
  };
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
