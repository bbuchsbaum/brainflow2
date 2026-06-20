<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-02-10 -->

# packages/api

## Purpose
Core TypeScript interfaces and app-neutral helper contracts for Brainflow (@brainflow/api). Provides the API contract between frontend and backend, including auto-generated TypeScript bindings from Rust types. Runtime helpers must use injected transports; this package must not import Tauri, UI stores, or app services.

## Key Files
| File | Description |
|------|-------------|
| package.json | Package configuration, exports dist/index.js and types |
| tsconfig.json | TypeScript compilation configuration |

## Subdirectories
| Directory | Purpose |
|-----------|---------|
| src/ | Source TypeScript files (helpers.ts, index.ts) |
| src/generated/ | Auto-generated TypeScript bindings from Rust types (50+ files) |
| dist/ | Compiled JavaScript and type definitions |

## For AI Agents

### Working In This Directory
- Keep this package app-neutral. Runtime helpers may exist, but they must take injected transports/invokers rather than importing Tauri directly.
- DO NOT manually edit files in src/generated/ - they are auto-generated
- To regenerate bindings: `cargo xtask ts-bindings` from repository root
- When adding new Rust types, ensure they have `#[derive(Serialize, Deserialize)]` and `#[tsify(into_wasm_abi, from_wasm_abi)]`
- Type definitions must match Rust structs exactly
- Use helpers.ts for utility type functions and transport-agnostic helper wrappers
- Keep index.ts as the single export point

### Testing Requirements
- No broad unit suite is required; use TypeScript builds and focused smoke tests for helper contracts
- Types are validated at compile time
- Integration testing happens in ui2/ when using these types
- Rust side validates types during tsify generation

### Common Patterns
- Type exports: Re-export everything through index.ts
- Naming convention: Match Rust struct names exactly (PascalCase)
- Optional fields: Use TypeScript `?` for Rust `Option<T>`
- Enums: Rust enums become TypeScript union types
- Handles: Opaque types represented as branded types or simple strings
- Type guards: Create in helpers.ts for runtime validation

## Dependencies

### Internal
- None (this is a leaf package)

### External
- typescript - Type checking and compilation

<!-- MANUAL: Run `cargo xtask ts-bindings` to regenerate types after Rust changes. Do not add Tauri imports to this package; inject host transports instead. -->
