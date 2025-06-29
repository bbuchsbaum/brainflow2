
---

# `docs/DEV-bootstrap-guide.md`

**Version:** 1.1
**Status:** Approved
**Date:** [Insert Date]
**Context:** This guide provides the step-by-step commands to initialize a new Brainflow project repository from scratch, creating the necessary directory structure, workspace configurations, and basic stubs according to the Phase 1 (WebGPU v2) architecture plan.

## 0. Prerequisites (One-time per machine)

Ensure the following tools are installed and configured correctly. Commands shown assume macOS/Linux (Bash/Zsh). See notes for Windows.

1.  **Rust Toolchain:**
    ```bash
    # Install rustup (if not already installed)
    curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
    # Set default toolchain and add WASM target
    rustup default stable
    rustup target add wasm32-unknown-unknown # Needed for adapter tests
    # Add essential components
    rustup component add clippy rustfmt
    ```
    *   **Windows:** Download and run the Rust installer from [rustup.rs](https://rustup.rs/). Choose the default MSVC toolchain during installation. Install **LLVM** separately (required by `wgpu` for shader compilation) - download from [LLVM Download Page](https://releases.llvm.org/download.html). Ensure `clang` is in your PATH.

2.  **Node.js (>= v20) + pnpm:**
    ```bash
    # Enable corepack (built into Node.js >= 16.10)
    corepack enable
    # Install/activate the latest pnpm version
    corepack prepare pnpm@latest --activate
    ```
    *   Alternatively, use package managers like Homebrew (`brew install pnpm`) or scoop/winget on Windows.

3.  **Tauri CLI:**
    ```bash
    cargo install tauri-cli --locked
    ```
    *   Follow platform-specific dependency instructions from the [Tauri prerequisites guide](https://tauri.app/v1/guides/getting-started/prerequisites).

## 1. Generate Repository Skeleton

Execute these commands from the desired parent directory where you want the `brainflow` project folder to live.

```bash
# Create project root directory
mkdir brainflow
cd brainflow

# 1. Initialise git & main branches
git init -b main
echo "# Brainflow Project Ignore List
/target
/node_modules
/ui/build/
/ui/.svelte-kit/
dist # For plugins/tools builds
pnpm-lock.yaml
.DS_Store
*.log
*.wasm # Unless explicitly checked in for tests
*.spv # Compiled shaders
.idea/
.vscode/settings.json # Allow user-specific vscode settings

# Tauri Runtime
src-tauri/target/" > .gitignore

# 2. Create Top-Level Workspace Directories
mkdir -p core ui plugins packages tools schemas/0.1.1 docs/diagrams docs/interfaces

# 3. Create Stub Cargo Workspace Root File
cat <<'TOML' > Cargo.toml
[workspace]
# Members will be populated by 'cargo tauri init' and manual additions
# Example initial members (adjust as crates are added):
members = [
  "src-tauri", # Added by tauri init
  "core/render_loop",
  "core/filesystem",
  "core/loaders/nifti",
  "core/loaders/gifti",
  "core/volmath",
  "core/api_bridge",
  # Add more core crates here as needed
]
resolver = "2" # Use Cargo's modern feature resolver

# Default profile settings (optional, can tune later)
[profile.release]
lto = true
codegen-units = 1
strip = true
opt-level = 'z' # Optimize for size
panic = 'abort'
TOML

# 4. Create Stub pnpm Workspace Root File
cat <<'YAML' > pnpm-workspace.yaml
packages:
  - "ui"
  - "plugins/*"
  - "packages/*"
  - "tools/*"
YAML

# 5. Copy Initial Schemas (if available locally)
# If schemas are hosted externally, skip this and reference URLs later.
# If schemas are versioned within this repo:
cp ../path/to/your/schemas/* schemas/0.1.1/
# Example: Assuming schemas were prepared alongside docs
# cp ../initial-docs/schemas/*.schema.json schemas/0.1.1/

# Note: Add repository_structure.md to docs/ if desired.
```

## 2. Scaffold Core Rust Crates

These commands create the subdirectories and `Cargo.toml` files for the Rust crates within the `core/` workspace member directory.

```bash
# Create subdirectories within core/
cargo new core/render_loop --lib
cargo new core/filesystem   --lib
cargo new core/volmath      --lib
cargo new core/api_bridge   --lib

# Create loaders workspace and sub-crates
mkdir -p core/loaders
cargo new core/loaders/nifti --lib
cargo new core/loaders/gifti --lib
# Create virtual manifest for the loaders workspace
cat <<'TOML' > core/loaders/Cargo.toml
[package]
name = "brainflow-loaders"
version = "0.1.0"
edition = "2021"

[workspace]
# This ensures sub-crates are recognized by the main workspace
members = ["nifti", "gifti"]
TOML
```

*   *Note:* You will need to add dependencies (`wgpu`, `nalgebra`, `nifti`, `gifti`, `serde`, `ts-rs`, `thiserror`, `rayon`, `kiddo`, etc.) to the respective `Cargo.toml` files as development proceeds in later milestones. Remember to also update the root `Cargo.toml` `[workspace]` members list if not done initially.

## 3. Scaffold SvelteKit Frontend & Install Core UI Dependencies

```bash
# Create the SvelteKit UI package
# Choose "Skeleton project" and TypeScript options when prompted
pnpm create svelte@latest ui

# Navigate into the UI directory
cd ui

# Install initial dependencies
# Note: Removed @skeletonlabs/skeleton as per final plan
pnpm install
pnpm add zustand # State management

# Initialize shadcn-svelte (follow prompts, choose default theme/colors)
# This sets up Tailwind, PostCSS, and base components/utils
pnpm dlx shadcn-svelte@latest init

# Return to the project root
cd ..
```

*   *Note:* `golden-layout` and `dockview-svelte` will be added in M1 implementation when the layout shell is built.

## 4. Scaffold Shared `@brainflow/api` Package

This package defines the core TypeScript interfaces shared across the UI and plugins.

```bash
# Create package structure
mkdir -p packages/api/src

# Create package.json
cat <<'JSON' > packages/api/package.json
{
  "name": "@brainflow/api",
  "version": "0.1.1",
  "description": "Core TypeScript interfaces and types for Brainflow",
  "type": "module",
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js"
    }
  },
  "scripts": {
    "build": "tsc",
    "dev": "tsc --watch"
  },
  "devDependencies": {
    "typescript": "^5.0.0"
  },
  "files": [
    "dist"
  ]
}
JSON

# Create basic tsconfig.json
cat <<'JSON' > packages/api/tsconfig.json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "lib": ["ES2022", "DOM"],
    "moduleResolution": "node",
    "strict": true,
    "declaration": true,
    "outDir": "./dist",
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true
  },
  "include": ["src/**/*.ts"],
  "exclude": ["node_modules", "dist"]
}
JSON

# Create stub index.ts (to be populated immediately after)
echo "// @brainflow/api v0.1.1 - Core TypeScript Interfaces" > packages/api/src/index.ts

# **Action:** Populate the API definitions
# Assuming finalized interfaces are in docs/interfaces/core-api-0.1.1.ts
cp docs/interfaces/core-api-0.1.1.ts packages/api/src/index.ts

# Build the API package initially
cd packages/api
pnpm install
pnpm run build
cd ../..

# Reminder: Publish this package (e.g., to private registry or link locally)
# Example: pnpm publish --tag next --no-git-checks (if using npm registry)
# Or manage via pnpm workspace protocols: "*"
```

*   **Workspace Protocol:** In `ui/package.json` and plugin `package.json` files, depend on the API package using `"@brainflow/api": "workspace:*"`.

## 5. Scaffold Temporary `legacy-ts` Package

```bash
mkdir -p packages/legacy-ts/src
cat <<'JSON' > packages/legacy-ts/package.json
{
  "name": "@brainflow/legacy-ts",
  "version": "0.1.0",
  "private": true, # Not intended for publishing
  "type": "module",
  "main": "src/index.ts", # Adjust if needed
  "types": "src/index.ts",
  "scripts": {
    "build": "echo 'Legacy TS - No build step needed' || exit 0",
    "lint": "eslint . --ext .ts"
  },
  "devDependencies": {
    "typescript": "^5.0.0",
    "eslint": "^8.0.0",
    # Add other legacy dependencies if needed (lodash, etc.)
  }
}
JSON
# Create stub index.ts
echo "// Exports legacy TS modules needed for Phase 1" > packages/legacy-ts/src/index.ts
# **Action:** Copy required legacy TS files (e.g., NeuroAtlas.ts, ColorMap.ts) into packages/legacy-ts/src/
# **Action:** Update legacy-ts/src/index.ts to export the necessary classes/functions.
```

## 6. Initial CI Stub (`.github/workflows/ci.yml`)

```yaml
name: Brainflow CI

on: [push, pull_request]

jobs:
  build_lint_test:
    runs-on: ubuntu-latest # Add macos/windows matrix later
    steps:
      - uses: actions/checkout@v4

      - name: Setup pnpm
        uses: pnpm/action-setup@v3 # Updated version
        with:
          version: latest # Or specify exact version

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'pnpm'

      - name: Setup Rust
        uses: dtolnay/rust-toolchain@stable
        with:
          toolchain: stable
          targets: wasm32-unknown-unknown # For adapter tests

      - name: Install JS Dependencies
        run: pnpm install --frozen-lockfile

      - name: Check TS Formatting & Linting
        run: pnpm -r run format:check && pnpm -r run lint

      - name: Build TS Packages (@brainflow/api, legacy-ts)
        run: pnpm --filter=!./ui run build # Build shared libs first

      - name: Build SvelteKit UI (Type Check)
        run: pnpm --filter ui build

      - name: Check Rust Code
        run: cargo check --workspace --all-targets

      - name: Run Rust Unit Tests
        run: cargo test --workspace

      # Placeholder for adapter tests (enable in M2)
      # - name: Run Adapter Tests (Rust -> WASM)
      #   run: wasm-pack test --node -- --package volmath

      # Placeholder for UI tests (enable in M1/M3)
      # - name: Run Frontend Unit Tests (Vitest)
      #   run: pnpm --filter ui run test:unit -- --run
      # - name: Run E2E Tests (Playwright)
      #   working-directory: ./ui
      #   run: |
      #     pnpm exec playwright install --with-deps
      #     pnpm run test:e2e
```

## 7. Commit Initial Skeleton

```bash
git add .
git commit -m "feat: Initial repository skeleton for Brainflow Phase 1 (WebGPU v2)

Sets up Cargo and pnpm workspaces, scaffolds core Rust crates,
the SvelteKit UI package, shared TS packages (@brainflow/api, legacy-ts),
and basic CI configuration."
git tag v0.0.0-skeleton # Or similar initial tag
```

## 8. Integrate Tauri

Run this from the **repository root** (`brainflow/`).

```bash
cargo tauri init --ci --app-name brainflow --window-title "Brainflow" \
  --dist-dir ../ui/build --dev-path http://localhost:5173
```

*   **Prompts:** Accept defaults or adjust as needed. This command will:
    *   Create the `src-tauri/` directory.
    *   Generate `src-tauri/src/main.rs` (initial Tauri setup).
    *   Generate `src-tauri/Cargo.toml`.
    *   Generate `src-tauri/tauri.conf.json` (verify security CSP, devPath, distDir).
    *   Update the root `Cargo.toml` to include `src-tauri` as a workspace member.
    *   Update `ui/package.json` with Tauri scripts.

*   **Action:** Review the generated/modified files, especially `tauri.conf.json` for correct paths and initial window settings. Commit these changes.

## 9. First Smoke Test

```bash
# Check Rust workspace including Tauri app
cargo check --workspace --all-targets

# Run the Tauri app in development mode
# This starts the SvelteKit dev server AND the Tauri backend
pnpm tauri dev
```

*   This should launch the Tauri window, loading the (currently basic) SvelteKit UI from `http://localhost:5173`. Verify the window appears and the SvelteKit default page renders without errors in the console.

---

This bootstrap guide provides the necessary steps to establish the complete project foundation, ready for implementing the tasks outlined in Milestone 1 of the Phase 1 plan.