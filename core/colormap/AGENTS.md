<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-02-10 -->

# colormap

## Purpose
High-performance colormap system for neuroimaging visualization with compile-time optimized builtin colormaps and zero runtime overhead. Provides medical imaging standard colormaps (grayscale, viridis, hot, PET, fMRI activation) and custom colormap support. Uses compile-time perfect hash maps for O(1) name lookups.

## Key Files
| File | Description |
|------|-------------|
| `src/lib.rs` | Colormap lookup functions and name-to-ID mapping |
| `src/data.rs` | Builtin colormap data arrays and BuiltinColormap enum |
| `src/metadata.rs` | Colormap metadata (categories, flags, descriptions) |

## Subdirectories
| Directory | Purpose |
|-----------|---------|
| `src/colormaps/` | Individual colormap data files (if separated) |

## For AI Agents

### Working In This Directory
Colormaps are compile-time constants for zero runtime overhead. The `phf` crate provides perfect hash map for name lookups. When adding new colormaps: (1) add variant to BuiltinColormap enum in `data.rs`, (2) add 256-entry RGBA array to BUILTIN_COLORMAPS, (3) add name mapping in COLORMAP_NAMES phf_map in `lib.rs`, (4) add metadata in `metadata.rs`. Support aliases (e.g., "gray" = "grey" = "grayscale"). Use bytemuck for safe RGBA byte casting.

### Testing Requirements
Run `cargo test -p colormap`. Test colormap lookup by name (including aliases), verify array lengths (must be 256 entries), test metadata completeness. No runtime dependencies means tests run fast. Verify all names in phf_map have corresponding enum variants.

### Common Patterns
- Static compile-time data arrays
- Perfect hash maps with `phf::phf_map!` macro
- Bytemuck for zero-copy type casting
- Enum-based colormap identification
- Metadata flags for perceptual uniformity, diverging, etc.

## Dependencies

### Internal
None - this is a leaf crate with no internal dependencies

### External
- `bytemuck` - Safe zero-copy type casting for RGBA data
- `phf` - Perfect hash maps with macro support for compile-time generation
- `serde` - Serialization with derive macros for metadata types

<!-- MANUAL: -->
