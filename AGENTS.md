# Brainflow agent guide

Brainflow is a cross-platform neuroimaging desktop app: Tauri/Rust and WGPU
render NIfTI volumes and GIfTI surfaces; React/TypeScript in `ui2` provides the UI.
Data flows from UI services through `api_bridge` to loaders and `render_loop`.

This file is the shared repository guide. Root `CLAUDE.md` imports it with
`@AGENTS.md`; edit shared instructions here. Read nested `AGENTS.md` files along
the paths you change. Consult the references below only when relevant.

## Working agreement

- Complete the requested change through relevant verification. Resolve routine,
  reversible choices yourself; ask when missing information affects correctness,
  scope, data safety, or external consequences.
- Preserve unrelated tracked and untracked work. Keep edits scoped; do not
  publish, deploy, merge, delete data, or weaken safeguards without authorization.
- Keep credentials and restricted data out of logs and prompts. Use synthetic
  or explicitly approved fixtures.
- Report what changed, checks actually run, and remaining limits. Distinguish
  unit tests, mocked UI checks, native app behavior, and GPU/visual evidence.

## Where to work

| Area | Entry points |
| --- | --- |
| Desktop setup, menus, capabilities | `src-tauri/src/main.rs`, `src-tauri/capabilities/` |
| Commands, registries, loading | `core/api_bridge/` |
| GPU rendering and shaders | `core/render_loop/` |
| Shared types and generated client | `core/bridge_types/`, `packages/api/` |
| UI services, stores, components | `ui2/src/` |
| Numerical and format support | `core/neuro-*`, `core/volmath/`, `core/loaders/` |
| Tests and fixtures | `e2e/`, `test-data/`, crate tests, colocated UI tests |

## Commands

Run from the repository root. Use the Node/pnpm versions in `package.json` and
pnpm for the JS workspace. The current UI package name is **`temp-ui`**.

| Task | Command |
| --- | --- |
| Install dependencies | `pnpm install` and `cargo fetch` |
| Full desktop app | `pnpm dev` (runs `cargo tauri dev`) |
| UI-only dev server | `pnpm --filter temp-ui dev` (requires mocks for native features) |
| UI tests | `pnpm --filter temp-ui exec vitest run <test-path>` |
| UI lint / build | `pnpm --filter temp-ui lint` / `pnpm --filter temp-ui build` |
| Rust tests | `cargo test -p <crate> [test-filter]` |
| Rust format / lint | `cargo fmt --all --check` / `cargo clippy -p <crate> --all-targets` |
| Generate TS bindings | `cargo run -p xtask -- ts-bindings`, then `pnpm --filter @brainflow/api build` |
| Bridge permission check | `pnpm check:permissions:strict` |
| Browser E2E | `pnpm test:e2e` (see `e2e/AGENTS.md` and its harness requirements) |
| Production build | `pnpm build` (JS packages and Tauri bundle) |

Choose checks that cover the changed behavior and credible failure modes. Use
`cargo test --workspace` and workspace Clippy for cross-crate changes when needed.
Root `pnpm lint` and `pnpm format` suppress JS failures; use package commands for
verification. A skipped GPU test is not a pass. Regenerate visual baselines only
for an intended visual change. See the reference for targeted GPU checks.

## Contracts to preserve

- **Bridge:** the plugin owns the single `BridgeState`. Commands are single-sourced
  in `core/api_bridge/src/command_list.rs`; generated bindings and permissions must
  stay aligned. Read [ADDING_COMMANDS.md](core/api_bridge/ADDING_COMMANDS.md) when
  changing the command surface. JS arguments use camelCase; Rust uses snake_case.
- **Coordinates:** preserve the volume affine (+R, +A, +S for NIfTI). Surface
  `vertices_world` already include the GIfTI transform. Keep Y-flips at GPU
  readback and preserve square pixels with uniform scale. Do not add compensating
  reflections to geometry or UI coordinates.
- **UI state:** GoldenLayout panels have separate React roots; cross-panel state
  belongs in Zustand/services. Select existing references or primitives, guard
  no-op updates, and never write stores during render. Use `safeUnlisten` from
  `ui2/src/utils/eventUtils.ts` for listener teardown.
- **Async ownership:** capture workspace identity and request order before I/O;
  reject stale results after switches, resets, or closure. Failed loads and unloads
  must reclaim provisional volumes, GPU leases, overlays, and cached samplers.
- **Rendering:** runtime masked WGSL is authoritative; `typed-shaders` is
  intentionally disabled. Keep Rust/WGSL layouts aligned with `shader_contract.rs`.
  Use the shared `SliceViewport` for placement, click mapping, and standard overlays.
- **Visual style:** use live `--bf-*` tokens in `ui2/src/styles/theme.css`; never raw
  palette classes or hex. Colour is data: chrome is achromatic (cool neutrals), and
  chroma is reserved for images, plots and semantic status. `--primary` is a light
  neutral (primary buttons, "on" states); `--bf-accent`/`ring` is a muted amber used
  only as a thin focus ring or selected-row edge; `--accent` is the neutral hover
  fill. Focus and selection differ in form. The crosshair colour is independent of
  the accent (default green with a dark halo). IBM Plex Sans/Mono, `text-bf-*` type
  scale, sentence case, 2px radii. Rationale: `docs/plans/ui-redesign-2026-10.md`.

## Read when relevant

- [Subsystem reference](docs/architecture-agent-reference.md): loading/teardown,
  remote mounts, GPU residency/readback, parcel tables, image sets, population
  analysis, targeted checks, and local installation. Read the relevant section.
- [Coordinate specification](docs/COORDINATE_SYSTEM_SPEC.md): geometry changes.
- [Loading contracts](docs/loading-hardening-2026-09-04.md) and
  [remote mounts](memory-bank/REMOTE_MOUNTS.md): I/O and cache changes.
- [Analysis plugins](docs/analysis_plugins.md): plugin protocol changes.
- [Alpha readiness](docs/alpha-readiness.md) and
  [acceptance checks](docs/alpha-acceptance.md): native release validation.

Keep this guide limited to durable, repository-wide instructions. Put detailed
contracts in scoped guidance or linked docs, and progress/evidence in the existing
task records. Update the relevant source when behavior changes; keep root
`CLAUDE.md` as the single import so the two agents share the same guidance.

Keep root files limited to entry points and tool configuration. Product ideas
live in [docs/vision.md](docs/vision.md) and linked plans; scripts belong in
`tools/`, fixtures in `test-data/`, and local logs/captures in ignored `cruft/`.
Retired root notes and scripts are indexed in the
[2026-10-25 archive](memory-bank/archive/root-cleanup-2026-10-25/README.md).
