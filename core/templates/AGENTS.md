<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-02-10 -->

# templates

## Purpose
Template system providing fast hierarchical menu access to commonly used brain templates (T1w, T2w, tissue segmentation) in standard spaces (MNI152NLin2009cAsym, MNI152NLin6Asym, etc.) at various resolutions. Integrates with templateflow-rs for standardized template discovery, downloading, and caching. Eliminates need for manual file browsing.

## Key Files
| File | Description |
|------|-------------|
| `src/lib.rs` | Module exports and type re-exports |
| `src/catalog.rs` | Template catalog management and registry |
| `src/service.rs` | Template loading service with async download/caching |
| `src/types.rs` | Template type definitions (TemplateSpace, TemplateType, etc.) |

## Subdirectories
| Directory | Purpose |
|-----------|---------|
| N/A | Flat module structure |

## For AI Agents

### Working In This Directory
Wraps templateflow-rs for Brainflow integration. When adding new templates, update catalog.rs (add_*_templates methods) and types.rs (TemplateSpace enum). Service handles async downloading from templateflow S3, local caching, and volume loading via nifti_loader. See core/CLAUDE.md section "Adding New Brain Templates" for 4-step process including frontend menu updates. Templates cached per templateflow conventions. Future: dynamic discovery via templateflow-rs API will eliminate manual catalog updates.

### Testing Requirements
Run `cargo test -p templates`. Use `tempfile` for test cache directories. Mock HTTP requests where possible. Test template discovery, download (or cache hit), decompression (gzip), and volume loading. Verify metadata correctness (space, resolution, type). Integration with templateflow-rs API.

### Common Patterns
- Async loading with tokio runtime
- HTTP download via reqwest with streaming
- Gzip decompression with flate2
- Local caching in templateflow directory structure
- Metadata tracking with chrono timestamps
- Volume loading delegation to nifti_loader
- URL construction for templateflow S3 bucket

## Dependencies

### Internal
- `bridge_types` - Shared types for volume loading
- `nifti_loader` - NIfTI file loading for template volumes
- `brainflow_loaders` - Loader registry
- `volmath` - Volume mathematics

### External
- `templateflow` - TemplateFlow Rust library (local path dependency)
- `serde`, `serde_json` (workspace) - Serialization
- `tokio` (workspace) - Async runtime
- `anyhow`, `thiserror` (workspace) - Error handling
- `tracing` (workspace) - Logging
- `ts-rs` (workspace) - TypeScript type generation
- `futures` (workspace) - Async utilities
- `reqwest` - HTTP downloads (json, stream features)
- `url` - URL parsing and construction
- `uuid` - Unique ID generation (v4 feature)
- `chrono` - Timestamp tracking with serde
- `flate2` - Gzip decompression for .nii.gz files

<!-- MANUAL: See core/CLAUDE.md "Adding New Brain Templates" section for full process including frontend updates. -->
