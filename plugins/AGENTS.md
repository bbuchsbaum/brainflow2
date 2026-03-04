<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-02-10 -->

# plugins - Plugin System

## Purpose
Plugin architecture for extending Brainflow2 with custom analysis pipelines, visualization tools, and data processing workflows. Provides a sandboxed environment for user-contributed code to integrate with the core application through a well-defined plugin API. Currently contains example plugins demonstrating the manifest schema and plugin structure.

## Key Files
No key files at this level (see subdirectories)

## Subdirectories
| Directory | Purpose |
|-----------|---------|
| `analyses/` | Analysis plugin directory for statistical and computational plugins |

### analyses/ - Analysis Plugins
Contains analysis plugins for data processing and computation:
- `example/` - Example analysis plugin demonstrating manifest structure and plugin API

**Plugin Structure:**
Each plugin directory contains:
- `brainflow-plugin.json` - Plugin manifest (validated against schema)
- Source code files (JavaScript, TypeScript, or WebAssembly)
- `README.md` - Plugin documentation
- Dependencies and build configuration

## For AI Agents

### Working In This Directory

**Creating a New Plugin:**
```bash
# Create plugin directory
mkdir -p plugins/analyses/my-analysis
cd plugins/analyses/my-analysis

# Create manifest
cat > brainflow-plugin.json << EOF
{
  "name": "my-analysis",
  "version": "1.0.0",
  "description": "My custom analysis plugin",
  "author": "Your Name",
  "entry": "dist/index.js",
  "capabilities": ["file-read", "compute"],
  "api_version": "0.1.1"
}
EOF

# Create source files
mkdir src
# ... implement plugin logic
```

**Validating Plugin Manifests:**
```bash
# Validate single plugin
npx ../tools/plugin-verify/bin/plugin-verify brainflow-plugin.json

# Validate all plugins in directory
npx ../tools/plugin-verify/bin/plugin-verify . --verbose
```

**Plugin Development Guidelines:**
1. All plugins MUST have valid `brainflow-plugin.json` manifest
2. Manifests validated against JSON schema in `../schemas/`
3. Plugin entry point specified in `entry` field
4. Capabilities declared upfront for security sandboxing
5. API version compatibility specified in `api_version`
6. Follow example plugin structure in `analyses/example/`

**Plugin Manifest Fields:**
- `name` (required): Unique plugin identifier
- `version` (required): Semantic version string
- `description` (required): Human-readable description
- `author` (optional): Plugin author
- `entry` (required): Main JavaScript/WASM file path
- `capabilities` (required): Array of required permissions
- `api_version` (required): Brainflow API version compatibility

**Available Capabilities:**
- `file-read` - Read files from user-selected directories
- `file-write` - Write output files
- `compute` - CPU-intensive computations
- `gpu` - GPU acceleration access
- `network` - Network requests (with user consent)

**Plugin API Access:**
```javascript
// Inside plugin code
const brainflow = window.brainflow;

// Load volume data
const volumeId = await brainflow.loadVolume(path);

// Get voxel data
const data = await brainflow.getVolumeData(volumeId);

// Display results
await brainflow.displayOverlay(resultData, { colormap: 'hot' });
```

### Testing Requirements

**Plugin Validation:**
```bash
# All plugins must pass validation
cd plugins
npx ../tools/plugin-verify/bin/plugin-verify analyses/ --verbose

# Test plugin loading in app
cargo tauri dev
# Use plugin menu to load plugin
```

**Testing Checklist:**
- [ ] Manifest validates against schema
- [ ] Entry point file exists and exports required interface
- [ ] Capabilities are minimal and justified
- [ ] Plugin loads without errors
- [ ] Plugin API calls work correctly
- [ ] Error handling is robust
- [ ] Documentation is complete

**Security Testing:**
- Plugin sandbox prevents unauthorized file access
- Network requests require user approval
- GPU access is properly isolated
- Plugin cannot access other plugin data
- Plugin unload cleans up resources

### Common Patterns

**Basic Analysis Plugin:**
```javascript
// src/index.js
export default class MyAnalysisPlugin {
  constructor(api) {
    this.api = api;
  }

  async initialize() {
    console.log('Plugin initialized');
  }

  async run(volumeId) {
    const data = await this.api.getVolumeData(volumeId);
    const result = this.processData(data);
    await this.api.displayOverlay(result, { colormap: 'hot' });
  }

  processData(data) {
    // Analysis logic here
    return data.map(v => v > 0.5 ? v : 0);
  }
}
```

**Time-Series Analysis Plugin:**
```javascript
export default class TimeSeriesPlugin {
  async run(volumeId) {
    const timeseries = await this.api.getTimeSeries(volumeId);
    const correlation = this.computeCorrelation(timeseries);
    await this.api.displayMatrix(correlation, {
      title: 'Correlation Matrix',
      colormap: 'coolwarm'
    });
  }

  computeCorrelation(timeseries) {
    // Compute correlation matrix
    return correlationMatrix;
  }
}
```

**Manifest with Multiple Capabilities:**
```json
{
  "name": "advanced-analysis",
  "version": "2.0.0",
  "description": "Advanced fMRI analysis with GPU acceleration",
  "entry": "dist/analysis.js",
  "capabilities": [
    "file-read",
    "file-write",
    "compute",
    "gpu"
  ],
  "api_version": "0.1.1",
  "settings": {
    "configurable": true,
    "ui": "settings-panel.html"
  }
}
```

## Dependencies

### Internal
- `../ui2/` - Frontend plugin API implementation
- `../core/api_bridge/` - Backend plugin communication
- `../tools/plugin-verify/` - Manifest validation tool
- `../docs/analysis_plugins.md` - Plugin system documentation
- `../docs/analysis_bundle_architecture.md` - Architecture docs

### External
**Plugin Runtime:**
- JavaScript ES modules (for JS plugins)
- WebAssembly runtime (for WASM plugins)
- Sandboxed iframe environment

**Plugin Development:**
- Node.js for building plugins
- TypeScript for type-safe plugin development
- Webpack/Rollup for bundling
- JSON Schema for manifest validation

**Plugin API:**
Plugins access Brainflow API injected into plugin context:
- Volume loading and data access
- Overlay rendering and visualization
- UI integration hooks
- File I/O with user permissions
- Progress reporting

## Plugin Security Model

**Sandboxing:**
- Plugins run in isolated iframe with limited capabilities
- Capability-based security: Only granted permissions work
- No direct access to file system (must go through API)
- No direct network access without user consent
- No access to other plugin data or main app internals

**User Consent:**
- First plugin run requires user approval
- Network requests show user consent dialog
- File writes show file picker dialog
- GPU access shows permission prompt

**Code Signing (Future):**
- Plugin verification via digital signatures
- Trusted plugin repository
- Warning for unsigned plugins

<!-- MANUAL: Any manually added notes below this line are preserved on regeneration -->
