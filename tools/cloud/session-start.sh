#!/usr/bin/env bash
# SessionStart hook for cloud sessions (.claude/settings.json). Does nothing
# locally. Per session: authenticate the private crates, start a virtual
# display, and fetch repo dependencies. Progress goes to stderr and
# cruft/cloud-session-start.log; failures are reported, not fatal, so the
# session still starts and tools/cloud/probe.sh can say what is missing.
[ "${CLAUDE_CODE_REMOTE:-}" = "true" ] || exit 0
set -uo pipefail
cd "${CLAUDE_PROJECT_DIR:-.}" || exit 0
mkdir -p cruft
exec 2> >(tee -a cruft/cloud-session-start.log >&2)
export PATH="$HOME/.cargo/bin:$PATH"

# Private git dependencies, read from Cargo.lock so the list cannot drift.
# Each is rewritten to carry CARGO_GIT_PAT (set in the environment's variables);
# brainflow2 itself is left to the session's GitHub proxy.
if [ -n "${CARGO_GIT_PAT:-}" ]; then
  grep -ohE 'git\+https://github\.com/bbuchsbaum/[A-Za-z0-9_.-]+' Cargo.lock | sed 's/^git+//' | sort -u |
    while read -r repo; do
      git config --global --replace-all "url.https://x-access-token:${CARGO_GIT_PAT}@${repo#https://}.insteadOf" "$repo"
    done
else
  echo "session-start: CARGO_GIT_PAT is not set; cargo cannot fetch the private crates." >&2
fi

# Virtual display for webkit and wgpu; DISPLAY=:99 is set in the environment.
if ! pgrep -x Xvfb >/dev/null; then
  nohup Xvfb :99 -screen 0 1600x1000x24 -nolisten tcp >/dev/null 2>&1 &
fi

cargo fetch --locked >&2 || echo "session-start: cargo fetch failed (see above)." >&2
corepack pnpm install --frozen-lockfile >&2 || echo "session-start: pnpm install failed (see above)." >&2
exit 0
