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
- `remove_remote_mount_profile`

Shared bridge types exported to `@brainflow/api`:

- `RemoteMountConnectRequest`
- `RemoteMountConnectResult`
- `RemoteMountInfo`
- `RemoteMountProfile`
- `RemoteHostKeyChallenge`
- `RemoteAuthChallenge`

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
- Interactive startup mounts fail: this is expected. Startup mounts only support non-interactive reuse; interactive flows must be completed from `Mount Remote (SSH)…`.
