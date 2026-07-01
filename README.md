# Brainflow

Brainflow is a cross-platform desktop app for neuroimaging visualization and analysis. It is built with Tauri 2, a Rust 2021 backend, WGPU-based rendering, and a React 19/Vite frontend.

## Development Status

Brainflow is in active development. It is useful as a source checkout for contributors and local testing, but it should not be treated as a polished end-user release yet.

- Binary installers are not currently the primary distribution path.
- Some features are experimental, incomplete, or behind development workflows.
- The app may require local build tools, GPU/WebGPU-compatible drivers, and occasional generated TypeScript binding refreshes.
- The UI currently depends on a local `neurosurface`/`surfviewjs` checkout through `file:` dependencies. On a fresh machine, make sure the sibling checkout exists at the path expected by `ui2/package.json` and `packages/visualization/package.json`, or update those dependencies before running `pnpm install`.

## What It Does

- Load and inspect NIfTI volumes and GIfTI surfaces.
- Render orthogonal slice views through the Rust/WGPU rendering path.
- Display surfaces and atlas/template-driven resources.
- Manage layers, atlases, remote mounts, and analysis workbench jobs through the Tauri command bridge.
- Share Rust/TypeScript request and response types through generated `ts-rs` bindings.

## Repository Layout

- `src-tauri/` - Tauri entry point, app configuration, menus, plugins, and command registration.
- `core/` - Rust workspace crates for rendering, bridge commands, loaders, filesystem utilities, atlases, templates, math, and shared bridge types.
- `ui2/` - Current React/Vite UI, including GoldenLayout workspaces, Zustand stores, services, hooks, and panels.
- `packages/` - Shared TypeScript packages, including `@brainflow/api` and visualization/plugin scaffolding.
- `plugins/` - Bundled plugin examples and analysis plugin bundles.
- `docs/` and `memory-bank/` - Architecture notes, implementation plans, runbooks, and subsystem documentation.
- `e2e/` - Playwright-based end-to-end testing harness.
- `tools/` - Developer utilities for bridge tests, render checks, colormap generation, and plugin verification.

## Prerequisites

Use the current Tauri 2 prerequisite guide as the source of truth for platform-specific system dependencies: <https://v2.tauri.app/start/prerequisites/>.

All platforms need:

- Git.
- Rust stable from <https://rustup.rs/>.
- Node.js `20.19+` or `22.12+`; this matches the locked Vite 7 requirement in `pnpm-lock.yaml`.
- pnpm via Corepack. This repo declares `pnpm@8.15.1`.
- Tauri CLI: `cargo install tauri-cli --locked`.

Recommended common setup after installing Node:

```bash
corepack enable
corepack prepare pnpm@8.15.1 --activate
rustup component add clippy rustfmt
cargo install tauri-cli --locked
```

## Install From Source

### macOS

Install the Xcode command line tools:

```bash
xcode-select --install
```

Then install Rust, Node.js, pnpm, and the Tauri CLI as described above.

Clone and run:

```bash
git clone https://github.com/bbuchsbaum/brainflow2.git
cd brainflow2
pnpm install
cargo fetch
pnpm --filter @brainflow/api build
pnpm --filter @brainflow/visualization build
cargo tauri dev
```

Build a local release bundle:

```bash
cargo tauri build
```

Build and install the macOS app into Applications:

```bash
make mac:install-app
```

This copies `target/release/bundle/macos/Brainflow.app` to `/Applications/Brainflow.app`. To install somewhere else, pass `APPLICATIONS_DIR`, for example:

```bash
make mac:install-app APPLICATIONS_DIR="$HOME/Applications"
```

For the maintainer-oriented local launcher on macOS:

```bash
make local:deploy
```

This builds the app bundle and installs a stable `~/bin/brainflow` launcher that points at the repo-local bundle.

### Windows

Install:

- Microsoft C++ Build Tools with the `Desktop development with C++` workload.
- Microsoft Edge WebView2 Runtime, using the Evergreen Bootstrapper.
- Rust with the MSVC toolchain selected as the default host triple.
- Node.js `20.19+` or `22.12+`.

Then run in PowerShell:

```powershell
corepack enable
corepack prepare pnpm@8.15.1 --activate
cargo install tauri-cli --locked

git clone https://github.com/bbuchsbaum/brainflow2.git
cd brainflow2
pnpm install
cargo fetch
pnpm --filter @brainflow/api build
pnpm --filter @brainflow/visualization build
cargo tauri dev
```

Build a Windows bundle:

```powershell
cargo tauri build
```

### Linux

Install Rust, Node.js, pnpm, and the Tauri CLI as described above. You also need WebKitGTK and related desktop build packages.

Debian/Ubuntu:

```bash
sudo apt update
sudo apt install -y \
  libwebkit2gtk-4.1-dev \
  build-essential \
  curl \
  wget \
  file \
  libxdo-dev \
  libssl-dev \
  libayatana-appindicator3-dev \
  librsvg2-dev
```

Fedora:

```bash
sudo dnf check-update
sudo dnf install -y \
  webkit2gtk4.1-devel \
  openssl-devel \
  curl \
  wget \
  file \
  libappindicator-gtk3-devel \
  librsvg2-devel \
  libxdo-devel
sudo dnf group install -y "c-development"
```

Arch:

```bash
sudo pacman -Syu
sudo pacman -S --needed \
  webkit2gtk-4.1 \
  base-devel \
  curl \
  wget \
  file \
  openssl \
  appmenu-gtk-module \
  libappindicator-gtk3 \
  librsvg \
  xdotool
```

Then clone and run:

```bash
git clone https://github.com/bbuchsbaum/brainflow2.git
cd brainflow2
pnpm install
cargo fetch
pnpm --filter @brainflow/api build
pnpm --filter @brainflow/visualization build
cargo tauri dev
```

Build a Linux bundle:

```bash
cargo tauri build
```

To build only an AppImage when your Linux environment supports it:

```bash
make linux:appimage
```

## Development Commands

```bash
# Full desktop app with Tauri backend and UI hot reload
cargo tauri dev
# equivalent root package script
pnpm dev

# UI-only development server; many app features still need the Tauri backend
pnpm --filter temp-ui dev

# Build all TS workspace packages and the desktop app
pnpm -r build
cargo tauri build

# Regenerate Rust -> TypeScript bindings
cargo xtask ts-bindings

# Rust formatting, linting, and tests
cargo fmt --all
cargo clippy --workspace --all-targets
cargo test --workspace

# UI unit tests
pnpm --filter temp-ui test

# E2E tests
pnpm -C e2e test
```

Rendering-data-affecting changes should also run the render golden harness when a GPU adapter is available:

```bash
cargo test -p render_loop --test render_golden_test
```

Regenerate the committed golden only for an intentional visual change:

```bash
UPDATE_RENDER_GOLDEN=1 cargo test -p render_loop --test render_golden_test
```

## Useful Documentation

- `AGENTS.md` - Maintainer-oriented quick reference for architecture, commands, caveats, and testing.
- `memory-bank/README.md` - Index for project history and planning documents.
- `memory-bank/ARCHITECTURE.md` - Current high-level architecture notes.
- `memory-bank/Implementation_Roadmap.md` - Roadmap and milestone context.
- `memory-bank/REMOTE_MOUNTS.md` - Remote mount architecture and runbook.
- `memory-bank/SHADER_BINDINGS_PLAN.md` - Shader binding status and typed-shader caveats.
- `docs/analysis_plugins.md` - Analysis plugin protocol.
- `ui2/ui_architecture.md` - Frontend architecture notes.
- `e2e/README.md` - End-to-end test harness details.

## Notes For Contributors

- Prefer `cargo tauri dev` when testing behavior that crosses the Rust/Tauri bridge.
- Keep generated TypeScript bindings in sync after bridge type changes with `cargo xtask ts-bindings`.
- Add new Tauri commands in all required surfaces: Rust command function, `core/api_bridge/build.rs`, the Tauri `generate_handler!`, permissions, and `ui2/src/services/transport.ts`.
- Keep `README.md`, `AGENTS.md`, and the relevant subsystem docs current when changing core architecture, command surfaces, or directory structure.
