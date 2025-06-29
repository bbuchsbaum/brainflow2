REPOSITORY_STRUCTURE.md
Version: 1.0
Status: Adopted for Phase 1 (WebGPU v2)
Date: [Insert Date]
1. Overview
This document outlines the directory structure for the Brainflow Phase 1 monorepo. The structure is designed to support a dual-workspace setup (Rust/Cargo and TypeScript/pnpm) within a single Git repository, aligning with the approved "WebGPU v2" architecture plan using Tauri, Rust (wgpu), Svelte, and TypeScript.
2. Directory Tree
brainflow/
├── README.md                    # High-level intro, build badges, quick-start
├── .gitignore
├── pnpm-workspace.yaml          # Defines the TypeScript pnpm workspace root
├── Cargo.toml                   # Defines the Rust Cargo workspace root (includes members in core/)
│
├── core/                        # Rust Crates Workspace Root
│   ├── render_loop/             # Rust crate: wgpu-driven continuous rendering service
│   │   ├── src/lib.rs           # RenderLoopService implementation
│   │   └── Cargo.toml
│   ├── filesystem/              # Rust crate: File system operations, BIDS scanning
│   │   ├── src/lib.rs
│   │   └── Cargo.toml
│   ├── loaders/                 # Rust crate workspace for core loaders
│   │   ├── nifti/               # Rust crate: NIfTI loader implementation
│   │   │   ├── src/lib.rs
│   │   │   └── Cargo.toml
│   │   ├── gifti/               # Rust crate: GIfTI loader implementation
│   │   │   ├── src/lib.rs
│   │   │   └── Cargo.toml
│   │   └── Cargo.toml           # Virtual manifest for the loaders workspace
│   ├── volmath/                 # Rust crate: Core geometry, volume math, spatial utils
│   │   ├── src/lib.rs           # NeuroSpace, slicing logic, KD-tree helpers etc.
│   │   └── Cargo.toml
│   └── api_bridge/              # Rust crate: Implements Tauri commands, bridges CoreApi
│       ├── src/lib.rs           # Defines #[tauri::command] functions
│       └── Cargo.toml
│
├── ui/                          # TypeScript Package: SvelteKit Frontend Application
│   ├── svelte.config.js
│   ├── vite.config.ts
│   ├── tsconfig.json
│   ├── src/
│   │   ├── app.html
│   │   ├── routes/              # SvelteKit routes/pages
│   │   │   └── +layout.svelte   # Main app layout with Dockview shell
│   │   ├── lib/
│   │   │   ├── components/      # Svelte UI components (LayerPanel, VolumeView, etc.)
│   │   │   ├── stores/          # Zustand state management slices
│   │   │   └── utils/           # Frontend utility functions
│   │   └── index.css            # Global styles (Tailwind base)
│   ├── static/                  # Static assets
│   └── package.json             # Frontend dependencies and scripts
│
├── plugins/                     # TypeScript Package: First-Party TS Plugins
│   ├── atlas-loader/            # Example TS loader plugin
│   │   ├── src/index.ts         # Plugin implementation
│   │   ├── brainflow-plugin.json # Plugin manifest
│   │   └── package.json
│   ├── plot-voxel-histogram/    # Example TS plot plugin
│   │   ├── src/index.ts
│   │   ├── worker.ts            # Optional dedicated worker script
│   │   ├── brainflow-plugin.json
│   │   └── package.json
│   └── README.md                # Guide for plugin structure
│
├── packages/                    # TypeScript Package: Shared TS Libraries
│   ├── api/                     # Package: @brainflow/api (Published TS Interfaces)
│   │   ├── src/index.ts         # CoreApi, Volume, Surface, Plugin interfaces etc.
│   │   └── package.json
│   └── legacy-ts/               # Package: @brainflow/legacy-ts (Temporary Imported Code)
│       ├── src/                 # Copied legacy TS files (Atlas, ColorMap)
│       └── package.json
│
├── docs/                        # Project Documentation
│   ├── ADR-001-architecture.md
│   ├── ADR-002-multilayer-rendering.md
│   ├── PLAN-migration-phase1.md
│   ├── PLAN-phase1-milestones.md
│   ├── DEV-setup.md             # Developer setup guide
│   ├── DEV-style-guide.md       # Coding standards
│   ├── PLUGIN-guide-v0.1.md     # Plugin authoring guide
│   ├── DATA-fixtures.md         # Info on test datasets
│   ├── CI-pipeline.md           # CI/CD overview
│   └── diagrams/
│       └── brainflow-phase1.uml # Source for architecture diagram
│
├── schemas/                     # Machine-Readable JSON Schemas
│   ├── 0.1.1/                   # Versioned directory for schemas
│   │   ├── brainflow-plugin.schema.json
│   │   ├── plot-worker-message.schema.json
│   │   ├── config.schema.json
│   │   └── volume-layer.schema.json # (Or similar schema names)
│   └── README.md                # Explanation of schemas
│
├── tools/                       # Developer Tools & Scripts
│   ├── plugin-verify/           # CLI tool for validating plugin manifests/structure
│   │   ├── index.ts             # (Or Rust main.rs)
│   │   └── package.json         # (Or Cargo.toml)
│   └── scripts/
│       └── fetch-fixtures.ts    # Script to download test data
│
├── src-tauri/                   # Tauri Configuration and Main Rust Entrypoint
│   ├── src/
│   │   └── main.rs              # Main Rust application entry, Tauri builder setup
│   ├── build.rs                 # Optional Tauri build script
│   ├── tauri.conf.json
│   └── Cargo.toml               # Dependencies for the main Tauri executable
│
└── .github/                     # GitHub Actions & Issue Templates
    ├── workflows/
    │   ├── ci.yml               # Build, lint, test matrix
    │   └── release.yml          # Automated release packaging
    └── ISSUE_TEMPLATE/
Use code with caution.
3. Key Directory Explanations
core/: Contains all Rust source code organized into modular crates, managed by the root Cargo.toml as a workspace.
render_loop: Handles all wgpu interactions for 2D slice rendering.
filesystem: Manages file system access, BIDS dataset scanning.
loaders: Workspace for core Rust-based file loaders (NIfTI, GIfTI).
volmath: Core numerical types and operations (NeuroSpace, slicing, geometry).
api_bridge: Implements the Tauri commands defined conceptually by @brainflow/api.
ui/: The SvelteKit frontend application, responsible for all user interface elements, interactions, and local state management.
plugins/: Location for first-party plugins implemented in TypeScript. Serves as a template structure for external plugins. Each plugin is a self-contained package with its manifest.
packages/: Shared TypeScript libraries within the monorepo.
api: Defines the canonical TypeScript interfaces and types (CoreApi, Volume, Surface, LoaderPlugin, etc.) shared between the UI, plugins, and generated from Rust types (ts-rs). This is the primary contract.
legacy-ts: A temporary package holding salvaged code from the previous iteration, used by plugins like atlas-loader during Phase 1. To be phased out as functionality is ported to Rust.
docs/: Contains all human-readable documentation, architectural decision records (ADRs), and planning documents.
schemas/: Holds versioned JSON Schema definitions for manifests, configurations, and message formats, enabling automated validation.
tools/: Houses developer utilities, such as the plugin verifier script/CLI and data fetching scripts.
src-tauri/: Standard Tauri directory containing the main Rust entry point (main.rs) that initializes the Tauri application, webview, and the Rust backend command handlers (likely delegating to functions in core/api_bridge).
4. Conclusion
This repository structure provides a clear separation between the Rust backend, the SvelteKit UI, shared TypeScript definitions, plugins, and supporting documentation/tooling. It facilitates the dual-workspace development model and aligns with the technical requirements of the Brainflow Phase 1 (WebGPU v2) plan.