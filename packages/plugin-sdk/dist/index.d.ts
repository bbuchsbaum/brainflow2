import { PluginManifest } from '@brainflow/api';
export { CoreApi, DataFrame, DataSample, PluginManifest } from '@brainflow/api';

type PluginType = 'loader' | 'visualization' | 'analysis' | 'ui' | 'workflow' | 'integration' | string;
interface PluginPermission {
    type: 'api' | 'filesystem' | 'network' | 'gpu' | 'storage' | string;
    scope: string;
    level: 'read' | 'write' | 'execute' | string;
}
interface PluginDependency {
    id: string;
    version: string;
}
interface ResourceRequirements {
    maxMemoryMB?: number;
    maxExecutionTimeMs?: number;
    requiresGPU?: boolean;
    requiresNetwork?: boolean;
}
interface PanelHandle {
    id: string;
    show(): void;
    hide(): void;
    close(): void;
    resize(width?: number, height?: number): void;
}
interface PanelConfig {
    id: string;
    title?: string;
    initialSize?: {
        width: number;
        height: number;
    };
}
interface NotificationConfig {
    type: 'success' | 'error' | 'warning' | 'info';
    message: string;
}
interface MenuConfig {
    id: string;
    label: string;
    shortcut?: string;
}
interface MemoryBlock {
    id: string;
    size: number;
}
interface MemoryUsage {
    allocated: number;
    used: number;
    limit: number;
}
interface ResourceLimitStatus {
    memoryOk: boolean;
    executionTimeOk: boolean;
    withinLimits: boolean;
}
type MessageHandler<T = any> = (payload: T, meta?: MessageMetadata) => void;
interface MessageMetadata {
    timestamp: number;
    source?: string;
}
interface PrivateChannel<T = any> {
    send(message: T): Promise<void>;
    onReceive(handler: MessageHandler<T>): () => void;
}
interface ValidationResult {
    valid: boolean;
    errors?: string[];
}
interface PluginLogger {
    debug(msg: string, data?: any): void;
    info(msg: string, data?: any): void;
    warn(msg: string, data?: any): void;
    error(msg: string, data?: any): void;
}
interface PluginStorage {
    get<T = any>(key: string): Promise<T | null>;
    set<T = any>(key: string, value: T): Promise<void>;
    delete(key: string): Promise<void>;
    clear(): Promise<void>;
    keys(): Promise<string[]>;
}
interface PluginUIAPI {
    registerComponent(name: string, factory: (...args: any[]) => any): void;
    createPanel(config: PanelConfig): Promise<PanelHandle>;
    showNotification(config: NotificationConfig): void;
    addMenuItem(config: MenuConfig): void;
}
interface PluginMessageBus {
    publish<T = any>(channel: string, message: T): Promise<void>;
    subscribe<T = any>(channel: string, handler: MessageHandler<T>): () => void;
    createPrivateChannel<T = any>(name?: string): PrivateChannel<T>;
    getPublicChannels(): string[];
}
interface PluginResourceManager {
    allocateMemory(size: number): MemoryBlock | null;
    releaseMemory(block: MemoryBlock): void;
    getMemoryUsage(): MemoryUsage;
    setExecutionTimeout(ms: number): void;
    checkResourceLimits(): ResourceLimitStatus;
}
interface PluginConfig {
    get<T = any>(key: string, defaultValue?: T): T;
    set<T = any>(key: string, value: T): void;
    has(key: string): boolean;
    delete(key: string): void;
}
interface PluginAPI {
    core: unknown;
    getService<T = any>(name: string): Promise<T | null>;
    emitEvent(event: string, payload?: any): Promise<void>;
    subscribeEvent(event: string, handler: (payload: any) => void): () => void;
    storage: PluginStorage;
    ui: PluginUIAPI;
}
interface PluginContext {
    pluginId: string;
    api: PluginAPI & {
        messageBus?: PluginMessageBus;
        resources?: PluginResourceManager;
        logger?: PluginLogger;
        config?: PluginConfig;
    };
    messageBus: PluginMessageBus;
    resources: PluginResourceManager;
    logger: PluginLogger;
    config: PluginConfig;
}

/**
 * @brainflow/plugin-sdk
 * TypeScript SDK for developing Brainflow plugins
 */

/**
 * Base Plugin Class
 * Provides common functionality for all plugin types
 */
declare abstract class BasePlugin {
    protected context?: PluginContext;
    protected manifest: PluginManifest;
    constructor(manifest: PluginManifest);
    /**
     * Initialize the plugin with context
     * Called by the plugin manager when the plugin is activated
     */
    initialize(context: PluginContext): Promise<void>;
    /**
     * Cleanup the plugin
     * Called by the plugin manager when the plugin is deactivated
     */
    cleanup(): Promise<void>;
    /**
     * Get plugin manifest
     */
    getManifest(): PluginManifest;
    /**
     * Get plugin context (throws if not initialized)
     */
    protected getContext(): PluginContext;
    /**
     * Log a message
     */
    protected log(level: 'debug' | 'info' | 'warn' | 'error', message: string, data?: any): void;
    /**
     * Get configuration value
     */
    protected getConfig<T>(key: string, defaultValue?: T): T;
    /**
     * Set configuration value
     */
    protected setConfig<T>(key: string, value: T): void;
    /**
     * Emit an event
     */
    protected emitEvent(eventName: string, payload: any): Promise<void>;
    /**
     * Subscribe to an event
     */
    protected subscribeEvent(eventName: string, handler: (payload: any) => void): () => void;
    /**
     * Show a notification
     */
    protected showNotification(type: 'success' | 'error' | 'warning' | 'info', message: string): void;
    protected abstract onInitialize(): Promise<void>;
    protected abstract onCleanup(): Promise<void>;
}
/**
 * Loader Plugin Base Class
 */
declare abstract class LoaderPlugin extends BasePlugin {
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
declare abstract class VisualizationPlugin extends BasePlugin {
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
declare abstract class AnalysisPlugin extends BasePlugin {
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
    validate?(input: any): Promise<{
        valid: boolean;
        errors?: string[];
    }>;
    /**
     * Get processing progress (0-1)
     */
    getProgress?(): number;
}
/**
 * UI Plugin Base Class
 */
declare abstract class UIPlugin extends BasePlugin {
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
declare abstract class WorkflowPlugin extends BasePlugin {
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
    validate?(config: any): Promise<{
        valid: boolean;
        errors?: string[];
    }>;
    /**
     * Get execution progress
     */
    getProgress?(): {
        currentStep: number;
        totalSteps: number;
        progress: number;
    };
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
declare abstract class IntegrationPlugin extends BasePlugin {
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
declare const PluginSDK: {
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
    }): PluginManifest;
    /**
     * Create basic permissions
     */
    createPermissions(permissions: Array<{
        type: "api" | "filesystem" | "network" | "gpu" | "storage";
        scope: string;
        level: "read" | "write" | "execute";
    }>): PluginPermission[];
    /**
     * Create resource requirements
     */
    createResourceRequirements(config: {
        maxMemoryMB?: number;
        maxExecutionTimeMs?: number;
        requiresGPU?: boolean;
        requiresNetwork?: boolean;
    }): ResourceRequirements;
    /**
     * Validate plugin structure
     */
    validatePlugin(plugin: any, expectedType: PluginType): {
        valid: boolean;
        errors: string[];
    };
};
/**
 * Plugin decorators for metadata
 */
declare function Plugin(manifest: PluginManifest): <T extends new (...args: any[]) => BasePlugin>(constructor: T) => T;
declare function RequiresPermission(permission: PluginPermission): (target: any, propertyKey: string, descriptor: PropertyDescriptor) => void;
declare function RequiresGPU(): (target: any, propertyKey: string, descriptor: PropertyDescriptor) => void;
declare function RequiresNetwork(): (target: any, propertyKey: string, descriptor: PropertyDescriptor) => void;
/**
 * Helper types for plugin development
 */
type PluginClass<T extends BasePlugin = BasePlugin> = new (manifest: PluginManifest) => T;
interface PluginModule {
    default: PluginClass;
    manifest?: PluginManifest;
}
/**
 * Plugin testing utilities
 */
declare const PluginTestUtils: {
    /**
     * Create a mock plugin context for testing
     */
    createMockContext(pluginId: string): PluginContext;
};

export { AnalysisPlugin, BasePlugin, IntegrationPlugin, LoaderPlugin, type MemoryBlock, type MemoryUsage, type MenuConfig, type MessageHandler, type MessageMetadata, type NotificationConfig, type PanelConfig, type PanelHandle, Plugin, type PluginAPI, type PluginClass, type PluginConfig, type PluginContext, type PluginDependency, type PluginLogger, type PluginMessageBus, type PluginModule, type PluginPermission, type PluginResourceManager, PluginSDK, type PluginStorage, PluginTestUtils, type PluginType, type PluginUIAPI, type PrivateChannel, RequiresGPU, RequiresNetwork, RequiresPermission, type ResourceLimitStatus, type ResourceRequirements, UIPlugin, type ValidationResult, VisualizationPlugin, WorkflowPlugin };
