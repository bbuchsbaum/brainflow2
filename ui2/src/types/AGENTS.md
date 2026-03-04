<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-02-10 -->

# ui2/src/types

## Purpose
TypeScript type definitions and interfaces for the UI2 frontend. Contains 21 type files defining data structures for layers, rendering, views, atlases, surfaces, annotations, workspaces, and system integration. Provides type safety across the application and documents data contracts.

## Key Files
| File | Description |
|------|-------------|
| layers.ts | Layer type definitions - 0.7KB |
| displayLayer.ts | Display layer interface - 1KB |
| layer.ts | Core layer types - 0.6KB |
| surfaceLayers.ts | Surface layer types and interfaces - 6KB |
| renderContext.ts | Render context types - 2KB |
| renderEvents.ts | Render event type definitions - 5KB |
| viewState.ts | View state types - 1KB |
| rustViewState.ts | Rust ViewState mapping types - 3KB |
| atlas.ts | Brain atlas types - 4KB |
| atlasPalette.ts | Atlas palette types - 0.8KB |
| alphaMask.ts | Alpha mask types - 0.8KB |
| coordinates.ts | Coordinate system types - 1KB |
| hoverInfo.ts | Hover information types - 2KB |
| histogram.ts | Histogram data types - 2KB |
| annotations.ts | Annotation types - 1KB |
| filesystem.ts | File system types - 2KB |
| workspace.ts | Workspace and session types - 3KB |
| viewLayout.ts | View layout types - 0.5KB |
| statusBar.ts | Status bar types - 0.8KB |

## Subdirectories
| Directory | Purpose |
|-----------|---------|
| None | All types are in this directory |

## For AI Agents

### Working In This Directory
- Define all interfaces and types
- Use TypeScript strict mode
- Export all types from individual files
- Keep types focused and cohesive
- Document complex types with JSDoc
- Use discriminated unions for variants
- Prefer interfaces for objects, types for unions
- Align types with Rust backend types where applicable
- Use branded types for opaque identifiers

### Testing Requirements
- No unit tests for types
- Types are validated at compile time
- Integration tests use these types
- Ensure types match Rust definitions
- Test type inference in IDE

### Common Patterns
- Interface exports: `export interface LayerSpec { ... }`
- Type aliases: `export type LayerId = string`
- Union types: `export type ViewType = 'axial' | 'sagittal' | 'coronal'`
- Discriminated unions: Use `type` field for variants
- Optional fields: Use `?` for optional properties
- Readonly: Use `readonly` for immutable properties
- Generic types: `export interface Result<T, E> { ... }`
- Type guards: Companion functions in utils/

## Dependencies

### Internal
- @brainflow/api - Core API types (imported where needed)

### External
- None (pure types)

<!-- MANUAL: Types define data contracts. Keep aligned with Rust backend types. -->
