<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-02-10 -->

# tools - Development Utilities

## Purpose
Collection of development utilities, scripts, and command-line tools for building, testing, debugging, and validating the Brainflow2 application. Includes Rust-based conversion tools, plugin validation utilities, testing scripts for the Tauri bridge, and automation helpers for development workflows.

## Key Files
| File | Description |
|------|-------------|
| `test-bridge.js` | Node.js script for testing Tauri bridge commands with mock data |
| `dev-watch.sh` | File watcher for auto-recompilation and test execution on Rust changes |
| `test-command.sh` | Quick reference for bridge commands and browser testing examples |
| `test-render-pipeline.sh` | Script to test the rendering pipeline end-to-end |
| `validate_rendering.sh` | Validates rendered output against expected results |
| `check_api_bridge_permissions.mjs` | Checks Tauri API bridge permissions configuration |
| `setup-test-data.sh` | Verifies test data availability and provides test commands |
| `generate_colormaps.py` | Python script to generate colormap data |
| `run-typed-shader-check.sh` | Validates typed shader compilation (optional feature) |
| `make_bundle.sh` | Creates application bundles for distribution |
| `README-bridge-testing.md` | Comprehensive guide to Tauri bridge testing tools and workflows |

## Subdirectories
| Directory | Purpose |
|-----------|---------|
| `nifti-to-raw/` | Rust CLI tool for converting NIfTI files to raw binary format (see below) |
| `plugin-verify/` | TypeScript CLI tool for validating plugin manifests against JSON schema (see below) |

### nifti-to-raw/
Standalone Rust tool for NIfTI file conversion:
- `Cargo.toml`, `Cargo.lock` - Rust package configuration
- `src/main.rs` - Main conversion logic
- Purpose: Convert neuroimaging NIfTI files to raw binary for testing/debugging

### plugin-verify/
TypeScript CLI tool for plugin validation:
- `package.json`, `tsconfig.json` - Node.js/TypeScript configuration
- `src/cli.ts` - Command-line interface
- `src/validator.ts` - JSON schema validation logic
- `examples/` - Example plugin manifests for testing
- `debug-cli.sh` - Debug script for CLI testing
- `test-manifest.json` - Test manifest file
- Purpose: Validate Brainflow plugin manifests against schema version 0.1.1+

## For AI Agents

### Working In This Directory

**Bridge Testing Workflow (Recommended):**
```bash
# Start auto-watch mode for rapid iteration
./tools/dev-watch.sh

# In another terminal, make changes to core/api_bridge/src/lib.rs
# Tests run automatically on save

# Or run bridge tests manually
./tools/test-bridge.js

# Interactive mode for exploring commands
./tools/test-bridge.js --interactive

# Quick command reference
./tools/test-command.sh
```

**Plugin Validation:**
```bash
cd tools/plugin-verify
npm install
npm run build

# Validate plugin manifest
npx plugin-verify path/to/brainflow-plugin.json

# Validate all plugins in directory
npx plugin-verify path/to/plugins/directory --verbose
```

**NIfTI Conversion:**
```bash
cd tools/nifti-to-raw
cargo build --release
./target/release/nifti-to-raw input.nii.gz output.raw
```

**Other Utilities:**
```bash
# Validate rendering output
./tools/validate_rendering.sh

# Check permissions configuration
node ./tools/check_api_bridge_permissions.mjs

# Setup test data
./tools/setup-test-data.sh

# Generate colormaps
python3 ./tools/generate_colormaps.py
```

**Key Guidelines:**
- Read `README-bridge-testing.md` for comprehensive bridge testing documentation
- Use `dev-watch.sh` for rapid iteration during Rust backend development
- Plugin manifests must conform to JSON schema (use plugin-verify to validate)
- Bridge commands require proper permissions in `core/api_bridge/permissions/default.toml`
- See `core/api_bridge/ADDING_COMMANDS.md` for steps to add new Tauri commands

### Testing Requirements

**Bridge Testing:**
- Use `test-bridge.js` to test individual Tauri commands without running full app
- Use `dev-watch.sh` for continuous testing during development
- Browser console testing: `await window.__TAURI__.core.invoke('plugin:api-bridge|command_name', params)`
- Always verify permissions in capabilities configuration

**Plugin Validation:**
- All plugin manifests must pass `plugin-verify` validation
- Test with example manifests in `plugin-verify/examples/`
- Schema validation errors are detailed in verbose mode (`--verbose`)

**Rendering Pipeline:**
- Use `validate_rendering.sh` to check rendered output correctness
- Test both CPU and GPU rendering paths
- Compare output against baseline screenshots

### Common Patterns

**Testing Tauri Commands:**
```javascript
// In test-bridge.js or browser console
const result = await window.__TAURI__.core.invoke(
  'plugin:api-bridge|load_file',
  { path: '/path/to/file.nii.gz' }
);
console.log('Volume ID:', result);
```

**Watching for Changes:**
```bash
# Auto-rebuild and test on Rust changes
./tools/dev-watch.sh

# In another terminal
vim core/api_bridge/src/lib.rs  # Edit and save
# Tests run automatically
```

**Plugin Manifest Validation:**
```bash
# Validate with detailed errors
npx plugin-verify path/to/plugin.json --verbose

# Validate all plugins recursively
npx plugin-verify plugins/ --verbose
```

## Dependencies

### Internal
- `../core/api_bridge/` - Rust Tauri bridge for command testing
- `../core/loaders/nifti/` - NIfTI loading logic used by nifti-to-raw
- `../plugins/` - Plugin manifests validated by plugin-verify
- `../test-data/` - Test data for validation scripts

### External

**nifti-to-raw:**
- Rust dependencies defined in `nifti-to-raw/Cargo.toml`
- Uses `nifti` crate for NIfTI parsing

**plugin-verify:**
- `ajv` - JSON schema validation
- `commander` - CLI argument parsing
- TypeScript toolchain

**Scripts:**
- Node.js runtime (for `.js` scripts)
- Bash shell (for `.sh` scripts)
- Python 3 (for `generate_colormaps.py`)

<!-- MANUAL: Any manually added notes below this line are preserved on regeneration -->
