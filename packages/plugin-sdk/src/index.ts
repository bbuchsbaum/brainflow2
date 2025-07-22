/**
 * @brainflow/plugin-sdk
 * TypeScript SDK for developing Brainflow plugins
 */

// Re-export plugin types from the main UI package
export type {
  PluginManifest,
  PluginType,
  PluginPermission,
  PluginDependency,
  ResourceRequirements,
  PluginContext,
  PluginAPI,
  PluginMessageBus,
  PluginResourceManager,
  PluginLogger,
  PluginConfig,
  PluginStorage,
  PluginUIAPI,
  PanelConfig,
  PanelHandle,
  NotificationConfig,
  MenuConfig,
  MemoryBlock,
  MemoryUsage,
  ResourceLimitStatus,
  MessageHandler,
  MessageMetadata,
  PrivateChannel,
  ValidationResult
} from '../../ui/src/lib/plugins/types';

// Re-export API types
export type { CoreApi, DataSample, DataFrame } from '@brainflow/api';

/**
 * Base Plugin Class
 * Provides common functionality for all plugin types
 */
export abstract class BasePlugin {
  protected context?: PluginContext;
  protected manifest: PluginManifest;

  constructor(manifest: PluginManifest) {
    this.manifest = manifest;
  }

  /**
   * Initialize the plugin with context
   * Called by the plugin manager when the plugin is activated
   */
  async initialize(context: PluginContext): Promise<void> {
    this.context = context;
    await this.onInitialize();
  }

  /**
   * Cleanup the plugin
   * Called by the plugin manager when the plugin is deactivated
   */
  async cleanup(): Promise<void> {
    await this.onCleanup();
    this.context = undefined;
  }

  /**
   * Get plugin manifest
   */
  getManifest(): PluginManifest {
    return this.manifest;
  }

  /**
   * Get plugin context (throws if not initialized)
   */
  protected getContext(): PluginContext {
    if (!this.context) {
      throw new Error('Plugin not initialized');
    }
    return this.context;
  }

  /**
   * Log a message
   */
  protected log(level: 'debug' | 'info' | 'warn' | 'error', message: string, data?: any): void {
    const context = this.getContext();
    context.logger[level](message, data);
  }

  /**
   * Get configuration value
   */
  protected getConfig<T>(key: string, defaultValue?: T): T {
    const context = this.getContext();
    return context.config.get(key, defaultValue);
  }

  /**
   * Set configuration value
   */
  protected setConfig<T>(key: string, value: T): void {
    const context = this.getContext();
    context.config.set(key, value);
  }

  /**
   * Emit an event
   */
  protected async emitEvent(eventName: string, payload: any): Promise<void> {
    const context = this.getContext();
    await context.api.emitEvent(eventName, payload);
  }

  /**
   * Subscribe to an event
   */
  protected subscribeEvent(eventName: string, handler: (payload: any) => void): () => void {
    const context = this.getContext();
    return context.api.subscribeEvent(eventName, handler);
  }

  /**
   * Show a notification
   */
  protected showNotification(type: 'success' | 'error' | 'warning' | 'info', message: string): void {
    const context = this.getContext();
    context.api.ui.showNotification({ type, message });
  }

  // Abstract methods to be implemented by subclasses
  protected abstract onInitialize(): Promise<void>;
  protected abstract onCleanup(): Promise<void>;
}

/**
 * Loader Plugin Base Class
 */
export abstract class LoaderPlugin extends BasePlugin {
  /**
   * Check if this loader can handle the given file
   */
  abstract canHandle(filePath: string, mimeType?: string): boolean;

  /**
   * Load a file and return volume handle
   */
  abstract load(filePath: string): Promise<any>;

  /**
   * Get metadata about supported file types
   */
  getMetadata?(): {
    supportedExtensions: string[];
    supportedMimeTypes: string[];
    description: string;
  };
}

/**
 * Visualization Plugin Base Class
 */
export abstract class VisualizationPlugin extends BasePlugin {
  /**
   * Render data to the target element
   */
  abstract render(targetElement: HTMLElement | OffscreenCanvas, data: any, options?: any): Promise<void>;

  /**
   * Get supported data types
   */
  abstract getSupportedDataTypes(): string[];

  /**
   * Resize the visualization
   */
  resize?(width: number, height: number): Promise<void>;

  /**
   * Dispose of resources
   */
  dispose?(): Promise<void>;

  /**
   * Get visualization options schema
   */
  getOptions?(): any;

  /**
   * Set visualization options
   */
  setOptions?(options: any): Promise<void>;
}

/**
 * Analysis Plugin Base Class
 */
export abstract class AnalysisPlugin extends BasePlugin {
  /**
   * Process input data and return results
   */
  abstract process(input: any, options?: any): Promise<any>;

  /**
   * Get supported input data types
   */
  abstract getInputTypes(): string[];

  /**
   * Get output data types
   */
  abstract getOutputTypes(): string[];

  /**
   * Validate input data
   */
  validate?(input: any): Promise<{ valid: boolean; errors?: string[] }>;

  /**
   * Get processing progress (0-1)
   */
  getProgress?(): number;
}

/**
 * UI Plugin Base Class
 */
export abstract class UIPlugin extends BasePlugin {
  /**
   * Create a UI component
   */
  abstract createComponent(type: string, props?: any): Promise<any>;

  /**
   * Get available component types
   */
  getComponentTypes?(): string[];
}

/**
 * Workflow Plugin Base Class
 */
export abstract class WorkflowPlugin extends BasePlugin {
  /**
   * Execute the workflow
   */
  abstract execute(input: any, options?: any): Promise<any>;

  /**
   * Get workflow steps
   */
  abstract getSteps(): Array<{
    id: string;
    name: string;
    description: string;
    required: boolean;
  }>;

  /**
   * Validate workflow configuration
   */
  validate?(config: any): Promise<{ valid: boolean; errors?: string[] }>;

  /**
   * Get execution progress
   */
  getProgress?(): { currentStep: number; totalSteps: number; progress: number };

  /**
   * Pause execution
   */
  pause?(): Promise<void>;

  /**
   * Resume execution
   */
  resume?(): Promise<void>;
}

/**
 * Integration Plugin Base Class
 */
export abstract class IntegrationPlugin extends BasePlugin {
  /**
   * Connect to external service
   */
  abstract connect(config: any): Promise<void>;

  /**
   * Disconnect from external service
   */
  abstract disconnect(): Promise<void>;

  /**
   * Check connection status
   */
  isConnected?(): boolean;

  /**
   * Get connection status
   */
  getStatus?(): {
    connected: boolean;
    lastError?: string;
    metadata?: any;
  };
}

/**
 * Plugin Development Utilities
 */
export const PluginSDK = {
  /**
   * Create a plugin manifest
   */
  createManifest(config: {
    id: string;
    name: string;
    type: PluginType;
    entrypoint: string;
    handles: string[];
    version?: string;
    description?: string;
    author?: string;
    permissions?: PluginPermission[];
    dependencies?: PluginDependency[];
    resources?: ResourceRequirements;
  }): PluginManifest {
    return {
      id: config.id,
      name: config.name,
      version: config.version || '1.0.0',
      compatibleCore: '^0.1.0',
      type: config.type,
      apiVersion: '0.1.1',
      entrypoint: config.entrypoint,
      handles: config.handles,
      description: config.description,
      author: config.author,
      permissions: config.permissions,
      dependencies: config.dependencies,
      resources: config.resources
    };
  },

  /**
   * Create basic permissions
   */
  createPermissions(permissions: Array<{
    type: 'api' | 'filesystem' | 'network' | 'gpu' | 'storage';
    scope: string;
    level: 'read' | 'write' | 'execute';
  }>): PluginPermission[] {
    return permissions;
  },

  /**
   * Create resource requirements
   */
  createResourceRequirements(config: {
    maxMemoryMB?: number;
    maxExecutionTimeMs?: number;
    requiresGPU?: boolean;
    requiresNetwork?: boolean;
  }): ResourceRequirements {
    return {
      maxMemoryMB: config.maxMemoryMB || 128,
      maxExecutionTimeMs: config.maxExecutionTimeMs || 30000,
      requiresGPU: config.requiresGPU || false,
      requiresNetwork: config.requiresNetwork || false
    };
  },

  /**
   * Validate plugin structure
   */
  validatePlugin(plugin: any, expectedType: PluginType): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    // Check if plugin extends appropriate base class
    if (!plugin) {
      errors.push('Plugin is null or undefined');
      return { valid: false, errors };
    }

    // Check required methods based on type
    const requiredMethods: Record<PluginType, string[]> = {
      loader: ['canHandle', 'load'],
      visualization: ['render', 'getSupportedDataTypes'],
      analysis: ['process', 'getInputTypes', 'getOutputTypes'],
      ui: ['createComponent'],
      workflow: ['execute', 'getSteps'],
      integration: ['connect', 'disconnect']
    };

    const required = requiredMethods[expectedType];
    if (required) {
      for (const method of required) {
        if (typeof plugin[method] !== 'function') {
          errors.push(`Missing required method: ${method}`);
        }
      }
    }

    // Check for initialize and cleanup methods
    if (typeof plugin.initialize !== 'function') {
      errors.push('Missing required method: initialize');
    }

    if (typeof plugin.cleanup !== 'function') {
      errors.push('Missing required method: cleanup');
    }

    return {
      valid: errors.length === 0,
      errors
    };
  }
};

/**
 * Plugin decorators for metadata
 */
export function Plugin(manifest: PluginManifest) {
  return function<T extends new (...args: any[]) => BasePlugin>(constructor: T) {
    // Store manifest in plugin class
    (constructor as any).manifest = manifest;
    return constructor;
  };
}

export function RequiresPermission(permission: PluginPermission) {
  return function(target: any, propertyKey: string, descriptor: PropertyDescriptor) {
    // Store permission requirement metadata
    const requiredPermissions = target.requiredPermissions || [];
    requiredPermissions.push(permission);
    target.requiredPermissions = requiredPermissions;
  };
}

export function RequiresGPU() {
  return function(target: any, propertyKey: string, descriptor: PropertyDescriptor) {
    target.requiresGPU = true;
  };
}

export function RequiresNetwork() {
  return function(target: any, propertyKey: string, descriptor: PropertyDescriptor) {
    target.requiresNetwork = true;
  };
}

/**
 * Helper types for plugin development
 */
export type PluginClass<T extends BasePlugin = BasePlugin> = new (manifest: PluginManifest) => T;

export interface PluginModule {
  default: PluginClass;
  manifest?: PluginManifest;
}

/**
 * Plugin testing utilities
 */
export const PluginTestUtils = {
  /**
   * Create a mock plugin context for testing
   */
  createMockContext(pluginId: string): PluginContext {
    return {
      pluginId,
      api: {
        core: {},
        getService: async () => null,
        emitEvent: async () => {},
        subscribeEvent: () => () => {},
        storage: {
          get: async () => null,
          set: async () => {},
          delete: async () => {},
          clear: async () => {},
          keys: async () => []
        },
        ui: {
          registerComponent: () => {},
          createPanel: async () => ({
            id: 'test-panel',
            show: () => {},
            hide: () => {},
            close: () => {},
            resize: () => {}
          }),
          showNotification: () => {},
          addMenuItem: () => {}
        }
      },
      messageBus: {
        publish: async () => {},
        subscribe: () => () => {},
        createPrivateChannel: () => ({
          send: async () => {},
          onReceive: () => () => {}
        }),
        getPublicChannels: () => []
      },
      resources: {
        allocateMemory: () => null,
        releaseMemory: () => {},
        getMemoryUsage: () => ({ allocated: 0, used: 0, limit: 1000000 }),
        setExecutionTimeout: () => {},
        checkResourceLimits: () => ({ memoryOk: true, executionTimeOk: true, withinLimits: true })
      },
      logger: {
        debug: () => {},
        info: () => {},
        warn: () => {},
        error: () => {}
      },
      config: {
        get: () => undefined,
        set: () => {},
        has: () => false,
        delete: () => {}
      }
    };
  }
};