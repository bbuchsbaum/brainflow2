#!/usr/bin/env bash
# Setup script for the Brainflow cloud environment (claude.ai/code). Paste this
# file into the environment's "Setup script" box; the repo copy is the reference.
#
# Runs as root on Ubuntu 24.04 before Claude starts, without the environment's
# variables. Anthropic snapshots the result when it finishes within ~5 minutes,
# so keep it to system packages and toolchains; repo dependencies and private
# crate auth happen per session in tools/cloud/session-start.sh.
set -euo pipefail
export DEBIAN_FRONTEND=noninteractive

apt-get update -qq
# Tauri/wry -sys crates (as in quality-gates.yml), a virtual display, and
# lavapipe software Vulkan so wgpu finds an adapter without a GPU.
apt-get install -y -qq --no-install-recommends \
  pkg-config libssl-dev libwebkit2gtk-4.1-dev libgtk-3-dev \
  libayatana-appindicator3-dev librsvg2-dev libxdo-dev \
  xvfb xauth mesa-vulkan-drivers libvulkan1 vulkan-tools

# Rust 1.91.1, the toolchain CI pins for its -D warnings clippy gate.
export PATH="$HOME/.cargo/bin:$PATH"
if ! command -v rustup >/dev/null; then
  curl -sSf https://sh.rustup.rs | sh -s -- -y --profile minimal --default-toolchain none
fi
rustup toolchain install 1.91.1 --profile minimal -c rustfmt -c clippy
rustup default 1.91.1

# pnpm as pinned by packageManager in package.json.
corepack enable
corepack prepare pnpm@8.15.1 --activate
