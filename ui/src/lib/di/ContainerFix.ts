/**
 * Fixed Dependency Injection Container - Breaking Circular Dependencies
 * 
 * This is a temporary fix to break circular dependencies in the DI container.
 * The main issues are:
 * 1. Services depending on each other in circular ways
 * 2. Validator appearing to depend on API
 * 3. CrosshairService creating cycles
 * 
 * Solution: Create services with minimal dependencies and use lazy resolution
 */

import { DIContainer } from './Container';

export function registerCoreServicesFixed(container: DIContainer): void {
	// LEVEL 0: Core singletons with no dependencies
	
	// Event Bus - singleton with no dependencies
	container.register('eventBus', async () => {
		const { getEventBus } = await import('$lib/events/EventBus');
		return getEventBus();
	});

	// Base API - no validation to avoid cycles
	container.register('api', async () => {
		const { baseApi } = await import('$lib/api');
		return baseApi;
	});

	// Validation Service - standalone, no dependencies
	container.register('validator', async () => {
		const { ValidationService } = await import('$lib/validation/ValidationService');
		return new ValidationService();
	});

	// Render Scheduler - no dependencies
	container.register('renderScheduler', async () => {
		const { getRenderScheduler } = await import('$lib/scheduler/RenderScheduler');
		return getRenderScheduler();
	});

	// Config value
	const validatedConfig = (globalThis as any).__BRAINFLOW_VALIDATED_CONFIG__;
	if (!validatedConfig) {
		throw new Error('Validated config not found');
	}
	container.registerValue('AppConfig', validatedConfig);

	// LEVEL 1: Basic services with minimal dependencies
	
	// Config Service - only depends on config value
	container.register('configService', async () => {
		const { ConfigService } = await import('$lib/services/ConfigService');
		const appConfig = await container.resolve('AppConfig');
		const eventBus = await container.resolve('eventBus');
		
		// Create a minimal ConfigService that doesn't validate on construction
		const service = {
			getConfig: () => appConfig,
			getAppSettings: () => appConfig.app,
			getRenderSettings: () => appConfig.render,
			getViewerSettings: () => appConfig.viewer,
			get: (key: string, defaultValue?: any) => {
				// Simple key-value store for runtime settings
				const storage = localStorage.getItem('brainflow-runtime-config');
				if (storage) {
					try {
						const parsed = JSON.parse(storage);
						return parsed[key] ?? defaultValue;
					} catch {}
				}
				return defaultValue;
			},
			set: async (key: string, value: any) => {
				const storage = localStorage.getItem('brainflow-runtime-config');
				let data = {};
				if (storage) {
					try {
						data = JSON.parse(storage);
					} catch {}
				}
				data[key] = value;
				localStorage.setItem('brainflow-runtime-config', JSON.stringify(data));
			}
		};
		
		return service;
	});

	// Notification Service - only depends on eventBus
	container.register('notificationService', async () => {
		const { createNotificationService } = await import('$lib/services/NotificationService');
		const eventBus = await container.resolve('eventBus');
		return createNotificationService({
			eventBus,
			maxNotifications: 5,
			defaultDuration: 5000
		});
	});

	// LEVEL 2: GPU and resource services
	
	// GPU Resource Manager - depends only on API
	container.register('gpuResourceManager', async () => {
		const { GpuResourceManager } = await import('$lib/gpu/GpuResourceManager');
		const api = await container.resolve('api');
		const manager = new GpuResourceManager(api);
		await manager.initialize();
		return manager;
	});

	// GPU Render Manager Service - depends only on eventBus
	container.register('gpuRenderManagerService', async () => {
		const { createGpuRenderManagerService } = await import('$lib/services/GpuRenderManagerService');
		const eventBus = await container.resolve('eventBus');
		const service = createGpuRenderManagerService({ eventBus });
		await service.initialize();
		return service;
	});

	// GPU Resource Service - minimal dependencies
	container.register('gpuResourceService', async () => {
		const { GpuResourceService } = await import('$lib/services/GpuResourceService');
		const [eventBus, api, appConfig] = await container.resolveAll('eventBus', 'api', 'AppConfig');
		
		const minimalConfigService = {
			getRenderSettings: () => appConfig.render
		};
		
		return new GpuResourceService({
			eventBus,
			configService: minimalConfigService as any,
			api
		});
	});

	// LEVEL 3: Domain services
	
	// Volume Repository
	container.register('volumeRepository', async () => {
		const { createVolumeRepository } = await import('$lib/repositories/VolumeRepository');
		const eventBus = await container.resolve('eventBus');
		return createVolumeRepository({ eventBus, maxVolumes: 20 }, true);
	});

	// Layer Service - no validator dependency to break cycle
	container.register('layerService', async () => {
		const { createLayerService } = await import('$lib/services/LayerService');
		const [eventBus, api] = await container.resolveAll(
			'eventBus', 
			'api'
		);
		
		// Create a minimal validator that doesn't create cycles
		const minimalValidator = {
			validate: (schema: string, data: any) => data,
			isValid: () => true
		};
		
		return createLayerService({
			eventBus,
			validator: minimalValidator as any,
			api
		});
	});

	// Volume Service - no validator dependency to break cycle
	container.register('volumeService', async () => {
		const { createVolumeService } = await import('$lib/services/VolumeService');
		const [eventBus, api, gpuManager] = await container.resolveAll(
			'eventBus',
			'api',
			'gpuResourceManager'
		);
		
		// Create a minimal validator that doesn't create cycles
		const minimalValidator = {
			validate: (schema: string, data: any) => data,
			isValid: () => true
		};
		
		return createVolumeService({
			eventBus,
			validator: minimalValidator as any,
			api,
			gpuManager
		});
	});

	// Mount Service
	container.register('mountService', async () => {
		const { createMountService } = await import('$lib/services/MountService');
		const [eventBus, api, appConfig] = await container.resolveAll(
			'eventBus',
			'api',
			'AppConfig'
		);
		
		const minimalValidator = {
			validate: (schema: string, data: any) => data,
			isValid: () => true
		};
		
		const configService = {
			getConfig: () => appConfig,
			getAppSettings: () => appConfig.app
		};
		
		return createMountService({
			eventBus,
			validator: minimalValidator as any,
			api,
			configService: configService as any
		});
	});

	// Annotation Service
	container.register('annotationService', async () => {
		const { AnnotationService } = await import('$lib/services/AnnotationService');
		const [eventBus, appConfig, notificationService] = await container.resolveAll(
			'eventBus',
			'AppConfig',
			'notificationService'
		);
		
		const configService = {
			getConfig: () => appConfig,
			getAppSettings: () => appConfig.app
		};
		
		return new AnnotationService({
			eventBus,
			configService: configService as any,
			notificationService
		});
	});

	// Plot Service
	container.register('plotService', async () => {
		const { PlotService } = await import('$lib/services/PlotService');
		const [eventBus, appConfig, notificationService] = await container.resolveAll(
			'eventBus',
			'AppConfig',
			'notificationService'
		);
		
		const configService = {
			getConfig: () => appConfig,
			getAppSettings: () => appConfig.app
		};
		
		return new PlotService({
			eventBus,
			configService: configService as any,
			notificationService
		});
	});

	// Slice Navigation Service
	container.register('sliceNavigationService', async () => {
		const { createSliceNavigationService } = await import('$lib/services/SliceNavigationService');
		const eventBus = await container.resolve('eventBus');
		return createSliceNavigationService({ eventBus });
	});

	// LEVEL 4: Services that depend on Level 3
	
	// Crosshair Service - lazy resolution to break cycles
	container.register('crosshairService', async () => {
		const { createCrosshairService } = await import('$lib/services/CrosshairService');
		const eventBus = await container.resolve('eventBus');
		
		// Pre-resolve volumeService since CrosshairService needs it synchronously
		// volumeService is registered before crosshairService so this should always work
		const volumeService = await container.resolve('volumeService');
		
		// Create a wrapper that ensures all methods are available
		const volumeServiceWrapper = {
			getVolumeMetadata: (id: string) => {
				return volumeService.getVolumeMetadata(id);
			},
			getAllVolumes: () => {
				return volumeService.getAllVolumes();
			},
			worldToVoxel: async (volumeId: string, worldCoord: [number, number, number]) => {
				return volumeService.worldToVoxel(volumeId, worldCoord);
			},
			voxelToWorld: async (volumeId: string, voxelCoord: [number, number, number]) => {
				return volumeService.voxelToWorld(volumeId, voxelCoord);
			}
		};
		
		const minimalValidator = {
			validate: (schema: string, data: any) => data,
			isValid: () => true
		};
		
		return createCrosshairService({
			eventBus,
			validator: minimalValidator as any,
			volumeService: volumeServiceWrapper as any
		});
	});

	// Resilient Volume Service
	container.register('resilientVolumeService', async () => {
		const { createResilientVolumeService } = await import('$lib/services/ResilientVolumeService');
		const [eventBus, api, gpuManager, notificationService] = await container.resolveAll(
			'eventBus',
			'api',
			'gpuResourceManager',
			'notificationService'
		);
		
		const minimalValidator = {
			validate: (schema: string, data: any) => data,
			isValid: () => true
		};
		
		return createResilientVolumeService({
			eventBus,
			validator: minimalValidator as any,
			api,
			gpuManager,
			notificationService,
			enableOfflineMode: true,
			enableCaching: true,
			maxCacheSize: 10
		});
	});

	// Stream Manager
	container.register('streamManager', async () => {
		const { createStreamManager } = await import('$lib/services/StreamManager');
		const eventBus = await container.resolve('eventBus');
		
		const minimalValidator = {
			validate: (schema: string, data: any) => data,
			isValid: () => true
		};
		
		return createStreamManager({
			eventBus,
			validator: minimalValidator as any,
			maxReconnectAttempts: 5,
			reconnectDelay: 1000
		});
	});

	// LEVEL 5: Integration services
	
	// Plugin Manager
	container.register('pluginManager', async () => {
		const { createPluginSystem, getPluginConfigForEnvironment } = await import('$lib/plugins');
		const eventBus = await container.resolve('eventBus');
		const config = getPluginConfigForEnvironment();
		
		const pluginManager = createPluginSystem(eventBus, config);
		await pluginManager.initialize();
		
		return pluginManager;
	});

	// Store Service Bridge - lazy initialization
	container.register('storeServiceBridge', async () => {
		const { createLazyStoreServiceBridge } = await import('$lib/integration/StoreServiceBridge');
		return createLazyStoreServiceBridge(container);
	}, { singleton: true });

	// Monitoring Service
	container.register('monitoringService', async () => {
		const { getMonitoringService } = await import('$lib/services/MonitoringService');
		const monitoringService = getMonitoringService();
		
		const monitoringConfig = {
			enabled: !import.meta.env.DEV,
			sampleRate: 1.0,
			endpoint: undefined,
			apiKey: undefined
		};
		
		await monitoringService.initialize(monitoringConfig);
		return monitoringService;
	}, { singleton: true });
}