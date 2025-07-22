/**
 * Core plugin system type definitions
 * Defines the interfaces and types for the Brainflow plugin architecture
 */

import type { CoreApi } from '@brainflow/api';
import type { EventBus } from '$lib/events/EventBus';

// Plugin manifest interface (enhanced from existing schema)
export interface PluginManifest {
	id: string;
	name: string;
	version: string;
	compatibleCore: string;
	type: PluginType;
	apiVersion: string;
	entrypoint: string;
	description?: string;
	author?: string;
	handles: string[];
	permissions?: PluginPermission[];
	dependencies?: PluginDependency[];
	resources?: ResourceRequirements;
}

// Plugin types
export type PluginType =
	| 'loader'
	| 'visualization'
	| 'analysis'
	| 'ui'
	| 'workflow'
	| 'integration';

// Plugin permissions
export interface PluginPermission {
	type: 'api' | 'filesystem' | 'network' | 'gpu' | 'storage';
	scope: string;
	level: 'read' | 'write' | 'execute';
}

// Plugin dependencies
export interface PluginDependency {
	pluginId: string;
	version: string;
	optional: boolean;
}

// Resource requirements
export interface ResourceRequirements {
	maxMemoryMB: number;
	maxExecutionTimeMs: number;
	requiresGPU: boolean;
	requiresNetwork: boolean;
}

// Plugin lifecycle states
export enum PluginState {
	UNLOADED = 'unloaded',
	LOADING = 'loading',
	LOADED = 'loaded',
	INITIALIZING = 'initializing',
	ACTIVE = 'active',
	DEACTIVATING = 'deactivating',
	ERROR = 'error',
	DISABLED = 'disabled'
}

// Plugin instance interface
export interface PluginInstance {
	id: string;
	manifest: PluginManifest;
	state: PluginState;
	module?: any;
	context?: PluginContext;
	resources?: PluginResources;
	performance?: PluginPerformanceStats;
	createdAt: Date;
	lastActivated?: Date;
}

// Plugin context provided to plugins at runtime
export interface PluginContext {
	pluginId: string;
	api: PluginAPI;
	messageBus: PluginMessageBus;
	resources: PluginResourceManager;
	logger: PluginLogger;
	config: PluginConfig;
}

// Secure API interface for plugins
export interface PluginAPI {
	// Core API access (filtered by permissions)
	core: Partial<CoreApi>;

	// Service access
	getService<T>(serviceName: string): Promise<T | null>;

	// Event system access
	emitEvent(eventName: string, payload: any): Promise<void>;
	subscribeEvent(eventName: string, handler: (payload: any) => void): () => void;

	// Storage access
	storage: PluginStorage;

	// UI integration
	ui: PluginUIAPI;
}

// Plugin message bus for inter-plugin communication
export interface PluginMessageBus {
	publish(channel: string, data: any): Promise<void>;
	subscribe(channel: string, handler: MessageHandler): Unsubscribe;
	createPrivateChannel(pluginId: string): PrivateChannel;
	getPublicChannels(): string[];
}

export type MessageHandler = (data: any, metadata: MessageMetadata) => void;
export type Unsubscribe = () => void;

export interface MessageMetadata {
	senderId: string;
	timestamp: Date;
	channel: string;
}

export interface PrivateChannel {
	send(targetPluginId: string, data: any): Promise<void>;
	onReceive(handler: MessageHandler): Unsubscribe;
}

// Plugin resource manager
export interface PluginResourceManager {
	allocateMemory(size: number): MemoryBlock | null;
	releaseMemory(block: MemoryBlock): void;
	getMemoryUsage(): MemoryUsage;
	setExecutionTimeout(timeoutMs: number): void;
	checkResourceLimits(): ResourceLimitStatus;
}

export interface MemoryBlock {
	id: string;
	size: number;
	buffer: ArrayBuffer;
	allocated: Date;
}

export interface MemoryUsage {
	allocated: number;
	used: number;
	limit: number;
}

export interface ResourceLimitStatus {
	memoryOk: boolean;
	executionTimeOk: boolean;
	withinLimits: boolean;
}

// Plugin logger
export interface PluginLogger {
	debug(message: string, data?: any): void;
	info(message: string, data?: any): void;
	warn(message: string, data?: any): void;
	error(message: string, error?: Error, data?: any): void;
}

// Plugin configuration
export interface PluginConfig {
	get<T>(key: string, defaultValue?: T): T;
	set<T>(key: string, value: T): void;
	has(key: string): boolean;
	delete(key: string): void;
}

// Plugin storage
export interface PluginStorage {
	get<T>(key: string): Promise<T | null>;
	set<T>(key: string, value: T): Promise<void>;
	delete(key: string): Promise<void>;
	clear(): Promise<void>;
	keys(): Promise<string[]>;
}

// Plugin UI API
export interface PluginUIAPI {
	registerComponent(name: string, component: any): void;
	createPanel(config: PanelConfig): Promise<PanelHandle>;
	showNotification(notification: NotificationConfig): void;
	addMenuItem(menu: MenuConfig): void;
}

export interface PanelConfig {
	title: string;
	component: any;
	position?: 'left' | 'right' | 'bottom' | 'center';
	size?: { width?: number; height?: number };
	closable?: boolean;
	resizable?: boolean;
}

export interface PanelHandle {
	id: string;
	show(): void;
	hide(): void;
	close(): void;
	resize(size: { width?: number; height?: number }): void;
}

export interface NotificationConfig {
	type: 'success' | 'error' | 'warning' | 'info';
	message: string;
	duration?: number;
	persistent?: boolean;
}

export interface MenuConfig {
	label: string;
	icon?: string;
	action: () => void;
	submenu?: MenuConfig[];
	separator?: boolean;
}

// Plugin resources tracking
export interface PluginResources {
	memoryBlocks: MemoryBlock[];
	openChannels: string[];
	eventSubscriptions: string[];
	uiElements: string[];
	timers: number[];
}

// Plugin performance tracking
export interface PluginPerformanceStats {
	loadTime: number;
	initTime: number;
	avgExecutionTime: number;
	totalExecutions: number;
	errorCount: number;
	memoryLeaks: number;
	lastError?: Error;
}

// Plugin lifecycle events
export interface PluginLifecycleEvents {
	'plugin.loading': { pluginId: string };
	'plugin.loaded': { pluginId: string; manifest: PluginManifest };
	'plugin.initializing': { pluginId: string };
	'plugin.activated': { pluginId: string };
	'plugin.deactivated': { pluginId: string };
	'plugin.error': { pluginId: string; error: Error };
	'plugin.unloaded': { pluginId: string };
	'plugin.performance.warning': { pluginId: string; stats: PluginPerformanceStats };
}

// Plugin manager configuration
export interface PluginManagerConfig {
	pluginsDirectory: string;
	enableHotReload: boolean;
	enablePerformanceMonitoring: boolean;
	defaultResourceLimits: ResourceRequirements;
	circuitBreakerThreshold: number;
	maxConcurrentLoads: number;
}

// Plugin loader interface
export interface PluginLoader {
	canLoad(manifest: PluginManifest): boolean;
	load(manifest: PluginManifest): Promise<any>;
	unload(pluginId: string): Promise<void>;
	reload(pluginId: string): Promise<any>;
}

// Plugin validator interface
export interface PluginValidator {
	validateManifest(manifest: PluginManifest): ValidationResult;
	validatePermissions(manifest: PluginManifest): ValidationResult;
	validateDependencies(
		manifest: PluginManifest,
		availablePlugins: PluginInstance[]
	): ValidationResult;
	validateResources(requirements: ResourceRequirements): ValidationResult;
}

export interface ValidationResult {
	valid: boolean;
	errors: string[];
	warnings: string[];
}

// Plugin error types
export class PluginError extends Error {
	constructor(
		message: string,
		public pluginId: string,
		public code: PluginErrorCode,
		public details?: any
	) {
		super(message);
		this.name = 'PluginError';
	}
}

export enum PluginErrorCode {
	LOAD_FAILED = 'LOAD_FAILED',
	INIT_FAILED = 'INIT_FAILED',
	PERMISSION_DENIED = 'PERMISSION_DENIED',
	RESOURCE_LIMIT_EXCEEDED = 'RESOURCE_LIMIT_EXCEEDED',
	DEPENDENCY_MISSING = 'DEPENDENCY_MISSING',
	VALIDATION_FAILED = 'VALIDATION_FAILED',
	EXECUTION_TIMEOUT = 'EXECUTION_TIMEOUT',
	CIRCUIT_BREAKER_OPEN = 'CIRCUIT_BREAKER_OPEN'
}

// Plugin registry interface
export interface PluginRegistry {
	register(manifest: PluginManifest): Promise<void>;
	unregister(pluginId: string): Promise<void>;
	find(criteria: PluginSearchCriteria): PluginManifest[];
	getAll(): PluginManifest[];
	getById(pluginId: string): PluginManifest | null;
	getByType(type: PluginType): PluginManifest[];
}

export interface PluginSearchCriteria {
	type?: PluginType;
	handles?: string;
	author?: string;
	version?: string;
	tags?: string[];
}
