<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-02-10 -->

# packages/plugin-sdk

## Purpose
Plugin development SDK for extending Brainflow functionality through a secure, type-safe plugin system. Provides base classes, utilities, and templates for creating loader, visualization, analysis, UI, workflow, and integration plugins. Includes permission-based API access, resource management, and inter-plugin communication.

## Key Files
| File | Description |
|------|-------------|
| README.md | Comprehensive plugin development guide with examples |
| package.json | Package configuration and exports |
| tsconfig.json | TypeScript configuration |

## Subdirectories
| Directory | Purpose |
|-----------|---------|
| src/ | SDK source code (index.ts, types.ts) with base classes and utilities |
| templates/ | Starter templates for plugin development |
| templates/analysis/ | Analysis plugin template |
| templates/loader/ | File loader plugin template |
| templates/visualization/ | Visualization plugin template |
| dist/ | Compiled SDK distribution |

## For AI Agents

### Working In This Directory
- Follow the plugin architecture documented in README.md
- All plugins extend base classes (BasePlugin, LoaderPlugin, VisualizationPlugin, etc.)
- Plugins operate in a secure sandbox with explicit permissions
- Use manifest.json for plugin metadata and permission declarations
- Implement required lifecycle methods: onInitialize(), onCleanup()
- Access Brainflow API through plugin context (filtered by permissions)
- Use message bus for inter-plugin communication
- Respect resource limits (memory, execution time)
- Provide clear error messages and progress updates

### Testing Requirements
- Use PluginTestUtils.createMockContext() for testing
- Test plugin initialization and cleanup
- Test with realistic data sizes
- Validate resource cleanup
- Test permission enforcement
- Mock external dependencies
- Test error conditions

### Common Patterns
- Plugin manifest: manifest.json with id, version, type, permissions
- Context access: `this.getContext()` for API, message bus, resources
- Logging: `this.log(level, message, data)`
- Permission requests: Minimal required permissions in manifest
- Resource management: Allocate and free resources properly
- Event handling: Subscribe/unsubscribe in lifecycle methods
- Type safety: Full TypeScript definitions for all interfaces

## Dependencies

### Internal
- @brainflow/api - Core type definitions

### External
- typescript - Type checking and compilation

<!-- MANUAL: See templates/ for working plugin examples. Run `npm run build` to compile SDK. -->
