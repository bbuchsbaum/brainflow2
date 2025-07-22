# Brainflow Plugin SDK

A comprehensive TypeScript SDK for developing plugins for the Brainflow neuroimaging application.

## Overview

The Brainflow Plugin SDK enables developers to extend Brainflow's functionality through a secure, type-safe plugin system. Plugins can add new file format loaders, custom visualizations, analysis algorithms, UI components, workflows, and integrations with external services.

## Features

- **Type-Safe Development**: Full TypeScript support with comprehensive type definitions
- **Secure Execution**: Permission-based API access and resource sandboxing
- **Performance Monitoring**: Built-in performance tracking and circuit breaker patterns
- **Hot Reloading**: Development-time plugin updates without restart
- **Inter-Plugin Communication**: Message bus for plugin-to-plugin communication
- **Resource Management**: Memory pooling and resource limit enforcement
- **Rich Templates**: Starter templates for all plugin types

## Plugin Types

### Loader Plugins
Load custom file formats into Brainflow.
```typescript
import { LoaderPlugin } from '@brainflow/plugin-sdk';

export class MyLoaderPlugin extends LoaderPlugin {
  canHandle(filePath: string): boolean {
    return filePath.endsWith('.myformat');
  }
  
  async load(filePath: string): Promise<VolumeHandle> {
    // Implementation
  }
}
```

### Visualization Plugins
Create custom visualizations for neuroimaging data.
```typescript
import { VisualizationPlugin } from '@brainflow/plugin-sdk';

export class MyVisualizationPlugin extends VisualizationPlugin {
  getSupportedDataTypes(): string[] {
    return ['timeseries', 'connectivity-matrix'];
  }
  
  async render(element: HTMLElement, data: DataSample): Promise<void> {
    // Implementation
  }
}
```

### Analysis Plugins
Implement custom analysis algorithms.
```typescript
import { AnalysisPlugin } from '@brainflow/plugin-sdk';

export class MyAnalysisPlugin extends AnalysisPlugin {
  getInputTypes(): string[] {
    return ['timeseries', 'volume'];
  }
  
  getOutputTypes(): string[] {
    return ['statistical-map'];
  }
  
  async process(input: any, options?: any): Promise<any> {
    // Implementation
  }
}
```

### UI Plugins
Add custom UI components and panels.
```typescript
import { UIPlugin } from '@brainflow/plugin-sdk';

export class MyUIPlugin extends UIPlugin {
  async createComponent(type: string, props?: any): Promise<any> {
    // Implementation
  }
}
```

### Workflow Plugins
Create multi-step analysis workflows.
```typescript
import { WorkflowPlugin } from '@brainflow/plugin-sdk';

export class MyWorkflowPlugin extends WorkflowPlugin {
  getSteps() {
    return [
      { id: 'preprocess', name: 'Preprocessing', required: true },
      { id: 'analyze', name: 'Analysis', required: true },
      { id: 'visualize', name: 'Visualization', required: false }
    ];
  }
  
  async execute(input: any, options?: any): Promise<any> {
    // Implementation
  }
}
```

### Integration Plugins
Connect to external services and APIs.
```typescript
import { IntegrationPlugin } from '@brainflow/plugin-sdk';

export class MyIntegrationPlugin extends IntegrationPlugin {
  async connect(config: any): Promise<void> {
    // Implementation
  }
  
  async disconnect(): Promise<void> {
    // Implementation
  }
}
```

## Getting Started

### Installation

```bash
npm install @brainflow/plugin-sdk
```

### Creating a Plugin

1. **Create a new project**:
```bash
mkdir my-brainflow-plugin
cd my-brainflow-plugin
npm init -y
npm install @brainflow/plugin-sdk
```

2. **Create the plugin manifest** (`manifest.json`):
```json
{
  "id": "my-plugin",
  "name": "My Plugin",
  "version": "1.0.0",
  "compatibleCore": "^0.1.0",
  "type": "visualization",
  "apiVersion": "0.1.1",
  "entrypoint": "dist/index.js",
  "handles": ["timeseries"],
  "permissions": [
    {
      "type": "api",
      "scope": "events",
      "level": "read"
    }
  ]
}
```

3. **Implement the plugin** (`src/index.ts`):
```typescript
import { VisualizationPlugin, PluginSDK } from '@brainflow/plugin-sdk';
import manifest from '../manifest.json';

export class MyPlugin extends VisualizationPlugin {
  constructor() {
    super(manifest);
  }

  protected async onInitialize(): Promise<void> {
    this.log('info', 'Plugin initialized');
  }

  protected async onCleanup(): Promise<void> {
    this.log('info', 'Plugin cleaned up');
  }

  getSupportedDataTypes(): string[] {
    return ['timeseries'];
  }

  async render(element: HTMLElement, data: any): Promise<void> {
    // Your visualization logic here
  }
}

export default MyPlugin;
```

4. **Build and test**:
```bash
npm run build
npm test
```

## Plugin Manifest

The plugin manifest (`manifest.json`) describes your plugin:

```json
{
  "id": "unique-plugin-id",
  "name": "Human Readable Name",
  "version": "1.0.0",
  "compatibleCore": "^0.1.0",
  "type": "loader|visualization|analysis|ui|workflow|integration",
  "apiVersion": "0.1.1",
  "entrypoint": "dist/index.js",
  "description": "Plugin description",
  "author": "Your Name",
  "handles": ["file-extensions", "data-types"],
  "permissions": [
    {
      "type": "api|filesystem|network|gpu|storage",
      "scope": "specific-scope",
      "level": "read|write|execute"
    }
  ],
  "dependencies": [
    {
      "pluginId": "other-plugin",
      "version": "^1.0.0",
      "optional": false
    }
  ],
  "resources": {
    "maxMemoryMB": 128,
    "maxExecutionTimeMs": 30000,
    "requiresGPU": false,
    "requiresNetwork": false
  }
}
```

## Permissions System

Plugins operate in a secure sandbox with explicit permissions:

### API Permissions
```json
{
  "type": "api",
  "scope": "volumes|events|rendering",
  "level": "read|write|execute"
}
```

### Filesystem Permissions
```json
{
  "type": "filesystem",
  "scope": "read|write",
  "level": "read|write"
}
```

### GPU Permissions
```json
{
  "type": "gpu",
  "scope": "rendering",
  "level": "execute"
}
```

### Storage Permissions
```json
{
  "type": "storage",
  "scope": "cache|config",
  "level": "read|write"
}
```

## Plugin Context

Every plugin receives a context object with access to:

### API Access
```typescript
const context = this.getContext();

// Core API (filtered by permissions)
const volumeHandle = await context.api.core.load_file?.(path);

// Service access
const layerService = await context.api.getService('layerService');

// Event system
await context.api.emitEvent('my.event', payload);
const unsubscribe = context.api.subscribeEvent('volume.loaded', handler);
```

### Message Bus
```typescript
// Publish to public channel
await context.messageBus.publish('data.channel', data);

// Subscribe to channel
const unsubscribe = context.messageBus.subscribe('ui.channel', handler);

// Private channel communication
const privateChannel = context.messageBus.createPrivateChannel('target-plugin');
await privateChannel.send('target-plugin', message);
```

### Resource Management
```typescript
// Allocate memory
const memoryBlock = context.resources.allocateMemory(1024 * 1024); // 1MB

// Check resource limits
const status = context.resources.checkResourceLimits();

// Set execution timeout
context.resources.setExecutionTimeout(30000); // 30 seconds
```

### Storage
```typescript
// Plugin-specific storage
await context.api.storage.set('config', { theme: 'dark' });
const config = await context.api.storage.get('config');
```

### UI Integration
```typescript
// Create a panel
const panel = await context.api.ui.createPanel({
  title: 'My Panel',
  component: MyPanelComponent
});

// Show notification
context.api.ui.showNotification({
  type: 'success',
  message: 'Operation completed'
});

// Add menu item
context.api.ui.addMenuItem({
  label: 'My Action',
  action: () => this.doSomething()
});
```

### Logging
```typescript
context.logger.info('Information message');
context.logger.warn('Warning message');
context.logger.error('Error message', error);
context.logger.debug('Debug message', data);
```

## Templates

Use the provided templates to get started quickly:

### Copy a Template
```bash
# Copy loader template
cp -r node_modules/@brainflow/plugin-sdk/templates/loader my-loader-plugin

# Copy visualization template
cp -r node_modules/@brainflow/plugin-sdk/templates/visualization my-viz-plugin

# Copy analysis template
cp -r node_modules/@brainflow/plugin-sdk/templates/analysis my-analysis-plugin
```

### Template Structure
```
template/
├── manifest.json          # Plugin manifest
├── src/
│   └── index.ts           # Main plugin implementation
├── package.json           # NPM package configuration
├── tsconfig.json          # TypeScript configuration
└── README.md              # Template-specific documentation
```

## Development Workflow

### 1. Development Mode
```bash
# Start development with hot reloading
npm run dev
```

### 2. Testing
```typescript
import { PluginTestUtils } from '@brainflow/plugin-sdk';

// Create mock context for testing
const mockContext = PluginTestUtils.createMockContext('my-plugin');

// Test plugin initialization
const plugin = new MyPlugin();
await plugin.initialize(mockContext);

// Test plugin functionality
const result = await plugin.process(testData);
expect(result).toBeDefined();
```

### 3. Validation
```typescript
import { PluginSDK } from '@brainflow/plugin-sdk';

// Validate plugin structure
const validation = PluginSDK.validatePlugin(new MyPlugin(), 'visualization');
if (!validation.valid) {
  console.error('Validation errors:', validation.errors);
}
```

### 4. Building
```bash
# Build for production
npm run build

# The built plugin will be in dist/
```

## Best Practices

### Performance
- Use resource allocation efficiently
- Implement proper cleanup in `onCleanup()`
- Monitor memory usage with context.resources
- Use streaming for large datasets

### Security
- Request minimal required permissions
- Validate all input data
- Use secure coding practices
- Handle errors gracefully

### User Experience
- Provide clear error messages
- Show progress for long operations
- Use notifications appropriately
- Follow Brainflow UI patterns

### Testing
- Test with realistic data sizes
- Mock external dependencies
- Test error conditions
- Validate resource cleanup

## API Reference

### Base Classes
- `BasePlugin` - Common functionality for all plugins
- `LoaderPlugin` - Base class for file loaders
- `VisualizationPlugin` - Base class for visualizations
- `AnalysisPlugin` - Base class for analysis algorithms
- `UIPlugin` - Base class for UI components
- `WorkflowPlugin` - Base class for workflows
- `IntegrationPlugin` - Base class for integrations

### Utilities
- `PluginSDK` - Plugin development utilities
- `PluginTestUtils` - Testing utilities
- Decorators: `@Plugin`, `@RequiresPermission`, `@RequiresGPU`

### Types
Complete TypeScript definitions for all plugin interfaces, contexts, and data structures.

## Examples

Check the `/templates` directory for complete working examples of each plugin type.

## Troubleshooting

### Common Issues

**Permission Denied**
- Check your manifest permissions
- Ensure you're not accessing APIs outside your scope

**Memory Allocation Failed**
- Reduce memory usage or request higher limits
- Check for memory leaks in your code

**Plugin Load Failed**
- Verify manifest syntax
- Check entrypoint path
- Ensure all required methods are implemented

**Hot Reload Not Working**
- Ensure development mode is enabled
- Check for syntax errors
- Restart the development server

### Debug Mode
```typescript
// Enable debug logging
this.log('debug', 'Debug information', data);

// Check resource usage
const usage = context.resources.getMemoryUsage();
this.log('info', 'Memory usage', usage);
```

## Contributing

1. Report issues on GitHub
2. Submit pull requests for improvements
3. Share your plugins with the community
4. Contribute to documentation

## License

MIT License - see LICENSE file for details.