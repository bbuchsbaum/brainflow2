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
- `update_remote_mount_profile`
- `remote_mount_cancel_connect`
- `remote_list_folders`, `remote_browse_close`
- `remote_mount_statuses`
- `cached_remote_directory`
- `remote_prefetch_folder`, `remote_prefetch_cancel`
- `remote_cache_usage`, `set_remote_cache_budget`, `clear_inactive_remote_caches`

Events: `remote-mount-recovery`, `remote-file-progress`, `remote-prefetch-progress`.

Shared bridge types exported to `@brainflow/api`:

- `RemoteMountConnectRequest`
- `RemoteMountConnectResult`
- `RemoteMountInfo`
- `RemoteMountProfile`
- `RemoteHostKeyChallenge`
- `RemoteAuthChallenge`
- `SshConfigHost`
- `RemoteSessionInfo`, `RemoteFolderListing`
- `RemoteMountStatus`
- `RemoteCacheUsage`, `RemoteCacheFolderUsage`

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
- **Jump hosts.** A `ProxyJump` chain from `~/.ssh/config` is resolved hop by hop (each hop's own `HostName`, `User`, `Port`, `IdentityFile`) and nested as `remotely` jump hosts; the last hop opens a `direct-tcpip` tunnel to the target. Jump hosts sign in without prompts: the hop's key, else the target's key/agent/password, else default key files (a keyboard-interactive target cannot prompt on its jump host). A jump host's key must already be trusted. A failed connect names the jump host.
- **`~/.ssh/config` aliases.** `remotely::ssh::SshConfig` resolves the typed host as OpenSSH would. `HostName` is dialled, `User` fills an empty user, `Port` replaces the default 22, and the first existing `IdentityFile` is used for key auth without an explicit key path. Profiles, keychain entries and the cache identity stay keyed on the alias the user typed. The dialog offers the aliases (`list_ssh_config_hosts`) as host suggestions and shows what an alias resolves to. `ProxyJump` is not supported: the dialog warns, and a failed connect explains it.
- **Reconnect when Brainflow starts.** A saved profile can be marked `reconnect_on_launch`. After startup actions flush, `useMountListener` remounts those profiles without prompting (`reconnectRemoteProfilesOnLaunch`); any that need a prompt or fail produce a warning pointing at Recents.
- **Connection status and revive.** `remote_mount_statuses` reports `connected`, `reconnecting` (dropped; a replayable login comes back on the next operation) or `disconnected` (needs a new sign-in, e.g. an expired 2FA session). The UI polls every 15 s (5 s while one is down, and on window focus) and shows a dot on the remote root, with Reconnect when it is down. Reconnect refreshes a `reconnecting` folder, and opens the dialog on the folder's profile for a `disconnected` one. A fresh sign-in hands its session to every mounted folder on that endpoint whose session is gone; they keep their mount ids and trees.
- **Cancel.** Requests carry an `attempt_id`. Cancel (or closing the dialog, or Escape) calls `remote_mount_cancel_connect`, which stops the in-flight handshake step and drops a pending host-key or sign-in prompt, closing the half-open connection.
- **Remote folder picker.** Browse… signs in with `browse_only` (result `session_ready` with the home folder) and lists subfolders with `remote_list_folders`. The browse session is shared: Connect afterwards mounts without another login. Closing the dialog calls `remote_browse_close`, which keeps the session open if a mount now uses it.
- **Recents while mounted.** The Files header has a Recent menu of pinned and recent locations that are not mounted; remote entries reconnect as above. Recents/Pinned rows show `user@host` and the full `user@host:/path` as a tooltip.
- **Saved connections.** Manage… in the dialog renames profiles, toggles reconnect-at-launch and removes them without connecting (`update_remote_mount_profile`).
- **Offline.** Every successful listing is stored under `.metadata/<cache-id>/.listings/`. Expanding a remote folder shows that listing at once (`cached_remote_directory`) and the live listing replaces it. When the server is unreachable (session down or timed out), listings come from that store and a complete downloaded file opens without the remote stat. The footer shows "offline".
- **Make available offline.** The folder context menu starts `remote_prefetch_folder`: it walks the folder (≤ 8 levels, 2,000 folders, 5,000 files) through the normal listing path, then downloads images, surfaces and sidecars (`.nii[.gz]`, `.gii`, `.mgz`, `.mgh`, `.img/.hdr`, `.json`, `.tsv`, `.csv`, `.label`, `.annot`) through the normal materialize path. It refuses a folder larger than the cache limit up front. Progress (`remote-prefetch-progress`) shows in the footer with Stop. A notification reports when it is done, fails or is stopped.
- **Downloads (cache).** Files › Remote downloads… shows use per folder (mounted or last used), the limit (saved in `remote_cache.json` in the config directory; `BRAINFLOW_REMOTE_CACHE_BYTES` still overrides and locks it), and Clear unused (`clear_inactive_remote_caches`). Remote roots also offer Unmount and clear downloads. Each cache directory records its origin in `.origin` so unmounted folders are named.
- **Keychain left alone on reconnect.** `remember_password` is tri-state: `true` stores, `false` deletes, absent leaves the keychain as it is. Startup, launch and profile reconnects omit it. Previously startup mounts sent `false`, which deleted a saved password or key passphrase after connecting with it.

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
- An alias from `~/.ssh/config` fails to connect: if it uses `ProxyJump`, check that the jump host accepts your key, agent or saved password without a prompt and that its host key is already in `known_hosts` (connect to it once with `ssh`). `Match` blocks are skipped, so their options never apply.
- A remote root shows red (disconnected) after sleep: click Reconnect; one sign-in revives every folder mounted from that host.
