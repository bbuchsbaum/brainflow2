# Cloud environment for Claude Code sessions

How to configure a claude.ai/code environment that can build Brainflow and run
its Linux-side tests: Rust and UI tests, the in-process SFTP remote-mount tests,
and scripted E2E under Xvfb with lavapipe software Vulkan. It does not replace
native macOS checks: there is no GPU, no Metal and no WD Passport data.

Facts about the platform come from
<https://code.claude.com/docs/en/cloud-environments.md> (read 2026-11-02):
Ubuntu 24.04 x86_64, 4 vCPU / 16 GB / 30 GB disk, setup script runs as root
before Claude starts and is snapshotted when it finishes in about 5 minutes,
environment variables are not visible to the setup script, and background
processes do not survive the snapshot.

## Files

| File | Where it runs |
| --- | --- |
| `setup.sh` | Pasted into the environment's **Setup script**. System packages, Rust 1.91.1, pnpm 8.15.1. |
| `session-start.sh` | Repo `SessionStart` hook, cloud only (`CLAUDE_CODE_REMOTE=true`). Private-crate auth, Xvfb, `cargo fetch`, `pnpm install`. |
| `probe.sh` | Run by Claude in a new session. One PASS/FAIL line per requirement. |

## One-time setup

1. **Token for the private crates.** Seven git dependencies are private
   (bids-rs, gifti-rs, neuroatlas-rs, neuroim-rs, neurosurf-rs, remotely,
   templateflow-rs). Create a fine-grained GitHub token with read-only
   *Contents* on exactly those repositories. Do not reuse the broad
   `CARGO_GIT_PAT` classic token from Actions: environment variables are
   visible to anyone the environment is shared with.
2. **Create the environment** at claude.ai/code (environment selector under the
   message box, then *New environment*):
   - Name: `brainflow-linux`
   - Network access: **Trusted** (covers GitHub, crates.io, static.rust-lang.org,
     rustup.rs, npm, nodejs.org and the Ubuntu archives)
   - Setup script: the contents of `tools/cloud/setup.sh`
   - Environment variables:
     ```
     CARGO_GIT_PAT=<the fine-grained token>
     DISPLAY=:99
     WGPU_BACKEND=vulkan
     CARGO_TERM_COLOR=never
     ```
3. **Register the hook** in `.claude/settings.json` under `"hooks"`, and merge it
   to `main` (cloud sessions start from the default branch unless you pick
   another pushed branch):
   ```json
   "SessionStart": [
     {
       "matcher": "startup|resume",
       "hooks": [
         {
           "type": "command",
           "command": "bash \"$CLAUDE_PROJECT_DIR\"/tools/cloud/session-start.sh",
           "timeout": 900
         }
       ]
     }
   ]
   ```
   Locally the script exits immediately.
4. **Probe.** Start a cloud session on that environment and ask it to run
   `bash tools/cloud/probe.sh --build`. Every line should read PASS; the
   session-start log is in `cruft/cloud-session-start.log`.

## Known unknowns

The docs leave these open; the probe answers them.

- Whether private-repo fetches with a token in the URL pass the session's
  GitHub proxy. If the `git access` lines fail while the token is valid, try
  the environment's *Network secrets* for `github.com`, and record the result
  here.
- Whether lavapipe gives wgpu a usable adapter in the VM (CI gets one on
  `ubuntu-latest`).
- Build time: a cold `api_bridge` build on 4 vCPU may run past the 10-minute
  foreground command limit, so run it in the background.

Inside cloud sessions the GitHub proxy rejects GraphQL, so `gh pr` fails. Use
`gh api repos/bbuchsbaum/brainflow2/pulls` or the session's *Create PR* button.
