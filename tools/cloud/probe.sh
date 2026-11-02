#!/usr/bin/env bash
# Reports whether a cloud session can build and test Brainflow. Run it first in
# a new environment and after changing the setup script:
#
#   bash tools/cloud/probe.sh           # toolchains, packages, auth, display, Vulkan
#   bash tools/cloud/probe.sh --build   # also builds api_bridge and runs the SFTP tests
#
# Prints one PASS/FAIL line per check and exits non-zero if any check failed.
set -uo pipefail
cd "$(dirname "$0")/../.." || exit 2
export PATH="$HOME/.cargo/bin:$PATH"
failed=0

check() {
  local name=$1
  shift
  local out
  if out=$("$@" 2>&1); then
    printf 'PASS  %-28s %s\n' "$name" "$(printf '%s' "$out" | tail -n 1)"
  else
    printf 'FAIL  %-28s %s\n' "$name" "$(printf '%s' "$out" | tail -n 3 | tr '\n' ' ')"
    failed=1
  fi
}

echo "cloud=${CLAUDE_CODE_REMOTE:-false} $(uname -srm) cpus=$(nproc 2>/dev/null) $(free -g 2>/dev/null | awk '/Mem:/{print "mem="$2"G"}')"
check "rustc 1.91.1" sh -c 'rustc --version | grep -F 1.91.1'
check "clippy and rustfmt" sh -c 'cargo clippy --version && cargo fmt --version'
check "node >= 22.12" node -e 'const [a,b]=process.versions.node.split(".").map(Number); if (a<22||(a===22&&b<12)) {console.log(process.version); process.exit(1)} console.log(process.version)'
check "pnpm 8.15.1" sh -c 'corepack pnpm --version | grep -Fx 8.15.1'
check "webkit2gtk-4.1" pkg-config --modversion webkit2gtk-4.1
check "Xvfb on DISPLAY=${DISPLAY:-unset}" sh -c 'test -n "${DISPLAY:-}" && pgrep -x Xvfb'

while read -r repo; do
  check "git access ${repo##*/}" git ls-remote --exit-code "$repo" HEAD
done < <(grep -ohE 'git\+https://github\.com/bbuchsbaum/[A-Za-z0-9_.-]+' Cargo.lock | sed 's/^git+//' | sort -u)

check "Vulkan adapter (lavapipe)" sh -c 'vulkaninfo --summary 2>/dev/null | grep -m1 deviceName'
check "cargo fetch --locked" cargo fetch --locked
check "pnpm install" corepack pnpm install --frozen-lockfile --prefer-offline

if [ "${1:-}" = "--build" ]; then
  check "SFTP remote-transfer tests" cargo test -p api_bridge --lib remote_transfer:: -- --test-threads=1
fi

exit $failed
