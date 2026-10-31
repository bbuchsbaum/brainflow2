<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-02-10 -->

# TypeScript Packages

## Purpose
The packages directory contains shared TypeScript packages managed via pnpm workspace. These packages provide the TypeScript API surface for Brainflow's frontend, consuming auto-generated type bindings from Rust and providing developer-friendly interfaces and utilities. The structure separates core API types from reusable visualization components.

## Key Files
| File | Description |
|------|-------------|
| `../pnpm-workspace.yaml` | Workspace configuration defining package locations and dependency resolution |

## Subdirectories
| Directory | Purpose |
|-----------|---------|
| `api/` | Core TypeScript interfaces (@brainflow/api) - consumes generated bindings from `core/bridge_types/bindings/` |
| `visualization/` | Reusable React slice/surface viewer package (@brainflow/visualization) with store-free adapters |

## For AI Agents

### Working In This Directory
When working with TypeScript packages:
1. **Build a package**: `pnpm --filter <package-name> build` (e.g., `pnpm --filter @brainflow/api build`)
2. **Build all packages**: `pnpm -r build` (recursive across workspace)
3. **Watch mode**: `pnpm --filter <package-name> dev` for auto-rebuild on changes
4. **Install dependencies**: `pnpm install` from project root
5. **Add dependency to package**: `cd packages/<name> && pnpm add <dependency>`
6. **Update generated types**: Run `cargo xtask ts-bindings` from project root to regenerate Rust bindings

### Testing Requirements
- API package: Primarily type definitions - verify TypeScript compilation with `pnpm build`
- Integration testing: Actual testing happens in `ui2/` which consumes these packages
- Type safety: Ensure exported types match Rust-generated bindings

### Common Patterns
- **Generated types**: Files in `api/src/generated/` are auto-generated from Rust - do not edit manually
- **Helper functions**: Add TypeScript-specific helpers in `api/src/helpers.ts`
- **Workspace dependencies**: Use `workspace:*` protocol for internal dependencies (e.g., `@brainflow/api`)
- **Module format**: All packages use ESM (`"type": "module"` in package.json)
- **Type exports**: Ensure proper `types` and `exports` fields in package.json for TypeScript resolution
- **Build output**: Compiled JavaScript + declaration files go to `dist/` directory
- **Visualization package boundary**: `visualization/src/` must not import `ui2` stores, services, Tauri APIs, or app aliases; pass host integration through props/callbacks.
- **Surface runtime**: `visualization/src/surface/surfaceRuntime.ts` adapts SurfView 3.1 (`neurosurface` npm alias). Keep base-layer color separate from material tint, reuse viewer-owned lights with explicit world-space lighting, and specify volume sampling. Update both workspace dependency pins together. Real WebGL regressions run through `e2e/playwright.surfview.config.ts` with synthetic data.

### Package Details

#### @brainflow/api
- **Purpose**: Core TypeScript interfaces and types
- **Main export**: `dist/index.js` (ESM)
- **Types**: `dist/index.d.ts`
- **Build**: Runs `tsc` to compile TypeScript
- **Source structure**:
  - `src/generated/` - Auto-generated from Rust types (via ts-rs)
  - `src/helpers.ts` - TypeScript-specific utilities
  - `src/index.ts` - Main entry point, re-exports

#### @brainflow/visualization
- **Purpose**: Store-free React visualization primitives for reusable slice and surface viewers
- **Main export**: `dist/index.js` (ESM), plus `./slice` and `./surface` subpath exports
- **Types**: `dist/index.d.ts`, `dist/slice/index.d.ts`, `dist/surface/index.d.ts`
- **Build**: Runs `tsc -p tsconfig.json`
- **Source structure**:
  - `src/slice/` - slice viewport, canvas image surface, geometry helpers, drawing helpers
  - `src/surface/` - neurosurface canvas, renderable types, reconciliation helpers
  - `src/index.ts` - Main entry point, re-exports

## Dependencies

### Internal
- `visualization` is consumed by host apps that provide React/neurosurface and pass data through props
- Packages are consumed by the `ui2/` application

### External
- `typescript` ^5.0.0 - TypeScript compiler (devDependency for all packages)
- `react` / `react-dom` - peer dependencies for visualization components
- `neurosurface` - peer dependency for the surface viewer export

### Generated Dependencies
Types in `api/src/generated/` correspond to Rust types in `core/bridge_types/src/`:
- Serialization via `serde`
- TypeScript binding generation via `ts-rs` crate
- Bindings written to `core/bridge_types/bindings/` and copied to `api/src/generated/`

<!-- MANUAL: Any manually added notes below this line are preserved on regeneration -->
