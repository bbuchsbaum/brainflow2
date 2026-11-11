# Remote Mount Runbook

This document covers the SSH remote-mount path added for `bd-2xd`.

## Ownership Boundaries

- `remotely` owns the SSH protocol/session layer: host-key validation, keyboard-interactive challenges, retries/recovery signals, remote directory listing, stat calls, and streamed downloads.
- `core/api_bridge` owns Brainflow-specific orchestration: Tauri commands, saved-profile metadata, keychain integration, remote mount registry, staged-cache bookkeeping, and conversion of remote files back into the existing local `load_file` pipeline.
- `ui2` owns the user workflow: `RemoteMountDialog`, startup mount resolution via `RemoteMountService`, guided host-key/auth prompts, and the root-only origin indicator in Files.
- `ui2/src/hooks/useMountListener.ts` also turns backend `remote-mount-recovery` events into warning notifications so SFTP reconnects are visible instead of silent.
- `packages/api` owns the shared TypeScript contract generated from `bridge_types`; the UI should consume these generated `RemoteMount*` types rather than maintaining hand-written mirrors.

## Command And API Inventory

Backend commands exposed through `api_bridge` and `ui2/src/services/transport.ts`:

- `remote_mount_connect`
- `remote_mount_respond_host_key`
- `remote_mount_respond_auth`
- `list_remote_mounts`
- `list_remote_directory`
- `remote_mount_unmount`
- `list_remote_mount_profiles`
- `list_ssh_config_hosts`
- `remove_remote_mount_profile`

Shared bridge types exported to `@brainflow/api`:

- `RemoteMountConnectRequest`
- `RemoteMountConnectResult`
- `RemoteMountInfo`
- `RemoteMountProfile`
- `RemoteHostKeyChallenge`
- `RemoteAuthChallenge`
- `SshConfigHost`

## Runtime Flow

1. Files panel opens `RemoteMountDialog`.
2. The dialog calls `remote_mount_connect`.
3. `api_bridge` delegates SSH negotiation to `remotely`.
4. If the session needs trust or interactive auth, the backend returns `need_host_key` or `need_auth`.
5. The dialog answers those prompts through `remote_mount_respond_host_key` or `remote_mount_respond_auth`.
6. Once connected, the backend registers a stable `mount_id`, creates a local staging root, and returns `RemoteMountInfo`.
7. `RemoteMountService` mounts that local path into the file browser with remote origin metadata.
8. When a remote file is opened, `materialize_remote_file_if_needed()` stages it into the local cache, verifies freshness from remote stat metadata, and then calls the normal local load/render path.
9. If an SFTP list/stat/download operation hits a retryable transport error, `remotely` retries once, `api_bridge` emits `remote-mount-recovery`, and the frontend shows a warning notification describing the recovered mount.
   - Transport hardening underneath this: all ops on a mount multiplex over a single SFTP channel per SSH session (no more per-call channel opens that exhausted the session into "Channel send error"), and a dropped SSH session is transparently re-established before the next op — but only for non-interactive auth (key file / agent / stored password), with a short cooldown so a down host doesn't trigger a reconnect storm. Keyboard-interactive sessions are never silently reconnected.

## Repeat Connections

Reaching the same machine again should take one click and, where possible, no new login:

- **Recents and Pinned reconnect.** A remote entry in Files › Recents or Pinned opens the dialog on that folder's saved profile and connects at once (`RemoteMountDialog` `initialTarget` + `autoConnect`). The dialog only stays up if SSH asks for something (host-key trust, a Duo/OTP prompt) or the profile uses a password the keychain does not hold. A folder with no saved profile is prefilled instead.
- **Already mounted → no handshake.** `remote_mount_connect` first looks for a live mount of the same folder and returns it without dialling.
- **One session per host.** If another folder on the same `(HostName, port, user)` is mounted and its session is up, the new folder reuses that authenticated `RemoteClient` after a filesystem probe, so a second folder on a 2FA host needs no second prompt. A probe that fails for transport reasons falls back to a fresh login; a readiness failure (missing folder, no SFTP) is reported. Unmount closes the session only when no other mount shares it, and moves the recovery-notice hook to a remaining mount.
- **`~/.ssh/config` aliases.** `remotely::ssh::SshConfig` resolves the typed host as OpenSSH would. `HostName` is dialled, `User` fills an empty user, `Port` replaces the default 22, and the first existing `IdentityFile` is used for key auth without an explicit key path. Profiles, keychain entries and the cache identity stay keyed on the alias the user typed. The dialog offers the aliases (`list_ssh_config_hosts`) as host suggestions and shows what an alias resolves to. `ProxyJump` is not supported: the dialog warns, and a failed connect explains it.
- **Reconnect when Brainflow starts.** A saved profile can be marked `reconnect_on_launch`. After startup actions flush, `useMountListener` remounts those profiles without prompting (`reconnectRemoteProfilesOnLaunch`); any that need a prompt or fail produce a warning pointing at Recents.
- **Keychain left alone on reconnect.** `remember_password` is tri-state: `true` stores, `false` deletes, absent leaves the keychain as it is. Startup, launch and profile reconnects omit it. Previously startup mounts sent `false`, which deleted a saved password or key passphrase after connecting with it.

## Reconnecting A Dropped Mount

A session that drops (sleep/wake, network change, server timeout) is only re-established silently for non-interactive auth. For a keyboard-interactive host (Duo) the next operation fails, and the UI offers one way back:

- **Recognising it.** `isRemoteConnectionLost` (`ui2/src/utils/remoteConnectionError.ts`) is the single classifier: bridge codes 8232, 8252, 8262 and 8266, else the backend's exact sentences ("SSH session disconnected", "Remote mount is not active for", "The remote folder is not connected.", "Remote mount has been unmounted", "Remote mount closed") for failures that arrive as text only.
- **8266: the session is gone.** `map_remotely_error` gives every "session or transport ended" error from `remotely` the one code `Io 8266` (`REMOTE_SESSION_LOST_CODE`), with the transport's sentence as details, whatever operation met it (it used to carry the operation's 8216/8218/8229/8243): `SshError::Disconnected`, also inside a `Context`; a `ChannelError` of an SFTP stream or a channel open that closed, hit EOF, a broken pipe or a reset; a `Protocol` error saying the same. Not 8266: a refused login, a missing file, permission denied, "SFTP request timed out" on a live session, "Channel send error" (retried by `remotely`), and anything during sign-in (8221/8224/8227).
- **One action.** `reconnectRemoteMount(pathOrMountId)` (`ui2/src/services/RemoteReconnectService.ts`) finds the mount owning a cache path, probes it (a session that answers needs no sign-in), and opens `RemoteMountDialog` on the folder's saved profile with `autoConnect` through `RemoteReconnectHost` (mounted once in `App`). It resolves `connected` only for the same local cache root, `cancelled` when the dialog is closed, `failed` with a reason otherwise. One reconnect runs per mount; later callers get the same promise.
- **The backend replaces a dead mount.** `register_remote_mount` (behind `finalize_remote_mount`) keeps an existing entry for the same local root only while its session is connected (the spare session is closed, as before). An entry whose session is gone is retired the way unmount retires one (`retire_remote_mount`: transfers stopped, cache admission and the operation gate drained, session closed unless another mount shares it) without purging the cache, and the new session is registered under the same local root with a new mount id. So startup, launch and direct `remote_mount_connect` calls recover a dropped folder too. The reconnect service still unmounts first in one case: a mount whose probe got no answer in time, because the backend still counts that session as connected and would hand it back without dialling.
- **Recovery.** `remoteConnectionStore` (keyed by local cache root) holds `down`, `reconnecting` and `activeEpoch`. A successful reconnect, a remount, or a listing that answers again bumps `activeEpoch`; `useRecoverOnReconnect(path, wanted, retry)` runs a surface's retry once per bump, only while that surface still shows the failure for a path on that mount. Wired: the Deck member card, the dataset card (the whole card, and a count that failed after its descriptions arrived), the Studio grid check, the Population/Compare image fetch (`StudioSourceFetchNotice`, through `connectionLostPath` in `studioSourceFetchStore`), the Files listing error.
- **No backend signal.** Nothing announces a dropped session before an operation fails (`remote-mount-recovery` only reports a retry that worked), so the Files header's "Disconnected" mark appears after the first failure any surface sees.

## Credential Storage Policy

- Saved profiles keep non-secret metadata only: host, port, user, remote path, auth method, host-key policy, known-hosts path, key path, and flags that indicate whether secrets exist in keychain.
- Passwords and SSH key passphrases are stored in the OS keychain via `keyring`; they are never written to the profile JSON.
- Keyboard-interactive responses, including OTP/2FA prompts, remain in memory for the current SSH conversation only and are never persisted.
- Removing a saved profile also deletes the associated password and key-passphrase entries from keychain.

## Host-Key Trust Behavior

- With `verify_host_key=true`, the backend validates against known hosts and returns a `need_host_key` challenge when trust must be established or a key mismatch is detected.
- Unknown-host acceptance can be enabled explicitly through the dialog/profile.
- The Files panel shows remote provenance only on the mounted root row. Child rows intentionally remain local-feel.

## Cache And Local Handoff

- Remote opens download into the managed remote cache directory through `remotely::download_to_path`.
- Each cached file has a sidecar metadata record that captures endpoint identity, remote path, size, and modified timestamp.
- Cached files are reused only when the sidecar metadata matches the latest remote stat result.
- `DownloadOptions { sync_on_finish: true }` preserves atomic finalize behavior so partial downloads never become visible to the local loader path.
- `remote_mount_unmount(..., purge_cache=true)` removes both staged files and the cache-metadata sidecars for that mount.
- The cache directory and sidecars are keyed on `(host, port, user, remote path)`, not on the per-session `mount_id`, so files downloaded in an earlier session are reused after reconnecting as long as the remote size and mtime still match. Inactive mount caches are evicted oldest-first once the 4 GiB budget (`BRAINFLOW_REMOTE_CACHE_BYTES`) is exceeded.
- Set studio computations over a whole set (Population, Compare) fetch the member files they read with `fetch_studio_sources` before computing: one stat pass, a confirmation above 2 GiB, then sequential downloads through the same staging, size check and sidecar as an interactive open. `cancel_studio_source_fetch` stops it; `studio-source-fetch-progress` carries "n of m". Files that finished stay cached, so the next request fetches only the rest.
  - **Budget.** Connected mounts are never evicted. After the stat pass the fetch is refused (code 8257, sizes in the message, nothing downloaded) when the bytes eviction cannot reclaim (`remote_cache::pinned_bytes`) plus the bytes to fetch exceed `remote_cache::budget()`.
  - **Cancel.** The fetch's cancel signal is passed down (`materialize_remote_file_for`, `download_owned_for`): it interrupts the wait for `ADMISSION`, is checked again before `make_room`, and stops the download the fetch itself started. A fetch never calls `transfers.cancel(path)`: that registration is keyed by path and may belong to an interactive open of the same file.
  - **Session down.** When the stat pass fails because the mount's session is not connected, a source whose cached file and sidecar both exist counts as usable (`unverifiedCount` in the result; the UI says once that the images were not re-checked). A source that is not cached still fails with "not connected".
  - **Missing members.** One member absent on the server blocks the whole fetch (code 8251); the message names up to three and counts the rest.
  - **`require_local` checks existence, not currency.** The population commands (`resolve_member_source_path`) refuse a remote path only when no file is at its cache path: 8255 on a connected mount, 8252 when no mount serves it. They do not stat the server or compare the sidecar; a cached copy that the server has since replaced is read as it is. Currency is checked by `fetch_studio_sources` (and by an interactive open), not by the computation.
  - **Validation happens once per mount id per session.** `StudioSourceFetchService` remembers the paths a fetch has made local, per mount id, and asks the backend nothing more for them until that mount id goes away (unmount or reconnect, which gives a new id), or a command refuses one of them. A file changed on the server during a session is therefore not re-fetched for the Studio until the folder is reconnected.
  - **UI.** One fetch at a time. A request for more images is queued behind the fetch in flight rather than restarting it. A change of set or leaving the Studio ends the fetch at once and the next request starts its own. A user stop holds every request until Continue. The agreement to a large fetch applies only to requests within the images it was given for. When a command is refused with 8252 or 8255 for a path the Files panel shows no remote folder for, the lens shows the message with Retry, which asks `list_remote_mounts` and fetches.
- SSH connect/probe also uses a bounded retry budget (`retry_count=1`) so transient handshake failures do not loop indefinitely.

## Testing

Targeted verification commands:

```bash
cargo check -p api-bridge
cargo test -p api-bridge remote_mount_
pnpm --filter temp-ui exec vitest run \
  src/hooks/__tests__/useMountListener.test.ts \
  src/services/__tests__/RemoteMountService.test.ts \
  src/components/panels/__tests__/RemoteMountDialog.test.tsx \
  src/components/panels/__tests__/FileBrowserPanel.remoteOrigin.test.tsx \
  src/components/panels/__tests__/FileBrowserPanel.unmount.test.tsx
pnpm --filter temp-ui exec tsc --noEmit --pretty false
cargo xtask ts-bindings
```

## E2E And Auth-Matrix Notes

- Remote-mount smoke coverage requires an SSH server fixture that can exercise: known-host success, unknown-host trust prompt, host-key mismatch failure, keyboard-interactive/OTP challenge, and auth denial.
- Keep these fixture values outside the repo and provide them through environment variables consumed by Playwright/Tauri launch wrappers.
- Local mount regression coverage must still run in the same suite, because remote mounts reuse the standard file-browser and load-file path after staging.

Suggested environment variables for automation:

- `BRAINFLOW_E2E_SSH_HOST`
- `BRAINFLOW_E2E_SSH_PORT`
- `BRAINFLOW_E2E_SSH_USER`
- `BRAINFLOW_E2E_SSH_PASSWORD`
- `BRAINFLOW_E2E_SSH_KEY_PATH`
- `BRAINFLOW_E2E_SSH_OTP_SECRET` or a fixture-specific equivalent

## Troubleshooting

- Host key challenge repeats unexpectedly: inspect the selected `known_hosts_path`, verify the profile trust flags, and confirm the server key did not rotate.
- Saved profile reconnects but still prompts for a secret: confirm the profile `auth_method` still matches the intended login path and that the relevant keychain entry exists.
- Cached remote file seems stale: unmount with cache purge or remove the affected mount cache directory so the next open forces a fresh stat+download cycle.
- Interactive startup mounts fail: this is expected. Startup mounts and "Reconnect when Brainflow starts" only support non-interactive reuse; interactive flows must be completed from `Mount Remote (SSH)…` or by clicking the folder in Recents.
- An alias from `~/.ssh/config` fails to connect: check whether it uses `ProxyJump` (not supported) or `Match` blocks (skipped; their options never apply).
