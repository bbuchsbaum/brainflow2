// Minimal plugin types for SDK typing without depending on UI internals

export type PluginType = 'loader' | 'visualization' | 'analysis' | 'ui' | 'workflow' | 'integration' | string;

export interface PluginPermission {
  type: 'api' | 'filesystem' | 'network' | 'gpu' | 'storage' | string;
  scope: string;
  level: 'read' | 'write' | 'execute' | string;
}

export interface PluginDependency {
  id: string;
  version: string;
}

export interface ResourceRequirements {
  maxMemoryMB?: number;
  maxExecutionTimeMs?: number;
  requiresGPU?: boolean;
  requiresNetwork?: boolean;
}

export interface PanelHandle {
  id: string;
  show(): void;
  hide(): void;
  close(): void;
  resize(width?: number, height?: number): void;
}

export interface PanelConfig {
  id: string;
  title?: string;
  initialSize?: { width: number; height: number };
}

export interface NotificationConfig {
  type: 'success' | 'error' | 'warning' | 'info';
  message: string;
}

export interface MenuConfig {
  id: string;
  label: string;
  shortcut?: string;
}

export interface MemoryBlock { id: string; size: number }
export interface MemoryUsage { allocated: number; used: number; limit: number }
export interface ResourceLimitStatus { memoryOk: boolean; executionTimeOk: boolean; withinLimits: boolean }

export type MessageHandler<T = any> = (payload: T, meta?: MessageMetadata) => void;
export interface MessageMetadata { timestamp: number; source?: string }

export interface PrivateChannel<T = any> {
  send(message: T): Promise<void>;
  onReceive(handler: MessageHandler<T>): () => void;
}

export interface ValidationResult { valid: boolean; errors?: string[] }

export interface PluginLogger {
  debug(msg: string, data?: any): void;
  info(msg: string, data?: any): void;
  warn(msg: string, data?: any): void;
  error(msg: string, data?: any): void;
}

export interface PluginStorage {
  get<T = any>(key: string): Promise<T | null>;
  set<T = any>(key: string, value: T): Promise<void>;
  delete(key: string): Promise<void>;
  clear(): Promise<void>;
  keys(): Promise<string[]>;
}

export interface PluginUIAPI {
  registerComponent(name: string, factory: (...args: any[]) => any): void;
  createPanel(config: PanelConfig): Promise<PanelHandle>;
  showNotification(config: NotificationConfig): void;
  addMenuItem(config: MenuConfig): void;
}

export interface PluginMessageBus {
  publish<T = any>(channel: string, message: T): Promise<void>;
  subscribe<T = any>(channel: string, handler: MessageHandler<T>): () => void;
  createPrivateChannel<T = any>(name?: string): PrivateChannel<T>;
  getPublicChannels(): string[];
}

export interface PluginResourceManager {
  allocateMemory(size: number): MemoryBlock | null;
  releaseMemory(block: MemoryBlock): void;
  getMemoryUsage(): MemoryUsage;
  setExecutionTimeout(ms: number): void;
  checkResourceLimits(): ResourceLimitStatus;
}

export interface PluginConfig {
  get<T = any>(key: string, defaultValue?: T): T;
  set<T = any>(key: string, value: T): void;
  has(key: string): boolean;
  delete(key: string): void;
}

export interface PluginAPI {
  core: unknown;
  getService<T = any>(name: string): Promise<T | null>;
  emitEvent(event: string, payload?: any): Promise<void>;
  subscribeEvent(event: string, handler: (payload: any) => void): () => void;
  storage: PluginStorage;
  ui: PluginUIAPI;
}

export interface PluginContext {
  pluginId: string;
  api: PluginAPI & { messageBus?: PluginMessageBus; resources?: PluginResourceManager; logger?: PluginLogger; config?: PluginConfig };
  messageBus: PluginMessageBus;
  resources: PluginResourceManager;
  logger: PluginLogger;
  config: PluginConfig;
}

