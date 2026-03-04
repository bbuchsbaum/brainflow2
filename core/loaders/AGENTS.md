<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-02-10 -->

# loaders (brainflow-loaders)

## Purpose
Container crate providing unified loader registry for neuroimaging file formats. Implements plugin-style architecture where format-specific loaders (NIfTI, GIfTI) register themselves for automatic format detection and loading. Provides LoaderRegistry for extensible file format support without central modification.

## Key Files
| File | Description |
|------|-------------|
| `mod.rs` | LoaderRegistry implementation with can_load/load dispatch |

## Subdirectories
| Directory | Purpose |
|-----------|---------|
| `nifti/` | NIfTI volume loader (.nii, .nii.gz) - separate crate |
| `gifti/` | GIfTI surface geometry loader (.gii) - separate crate |

## For AI Agents

### Working In This Directory
This is a registry/dispatcher crate. Each format lives in its own subcrate implementing the Loader trait from bridge_types. LoaderRegistry stores function pointers (can_load, load) keyed by format name. When adding new formats: (1) create new subcrate in subdirectory, (2) implement Loader trait, (3) register in LoaderRegistry. Use static methods pattern for zero-cost abstraction. Extension-based or magic-number detection in can_load().

### Testing Requirements
Run `cargo test -p brainflow-loaders`. Test registry lookup, format detection priority, error handling for unknown formats. Each subcrate (nifti, gifti) has its own tests. Integration tests should verify multi-format loading workflows.

### Common Patterns
- Static method registration (fn pointers vs trait objects for performance)
- HashMap-based format dispatch
- OnceLock for singleton registry instances
- Path-based format detection (extension + optional magic number)
- BridgeResult return type for consistent error handling

## Dependencies

### Internal
- `bridge_types` - Loader trait, BridgeResult, Loaded enum
- `nifti-loader` - NIfTI format implementation
- `gifti-loader` - GIfTI format implementation

### External
- `log` - Logging for loader selection and errors

<!-- MANUAL: Each loader subcrate should have its own AGENTS.md file. -->
