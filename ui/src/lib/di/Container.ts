/**
 * Dependency Injection Container
 * Manages service instances and their dependencies
 */

import { registerCoreServicesFixed } from './ContainerFix';

type Factory<T> = () => T;
type AsyncFactory<T> = () => Promise<T>;

interface ServiceDefinition<T> {
  factory: Factory<T> | AsyncFactory<T>;
  singleton: boolean;
  instance?: T;
  dependencies?: string[];
}

export class DIContainer {
  private services = new Map<string, ServiceDefinition<any>>();
  private resolving = new Set<string>();
  private resolutionPromises = new Map<string, Promise<any>>();
  
  /**
   * Register a service
   */
  register<T>(
    name: string,
    factory: Factory<T> | AsyncFactory<T>,
    options: {
      singleton?: boolean;
      dependencies?: string[];
    } = {}
  ): void {
    if (this.services.has(name)) {
      throw new Error(`Service "${name}" is already registered`);
    }
    
    this.services.set(name, {
      factory,
      singleton: options.singleton ?? true,
      dependencies: options.dependencies ?? []
    });
  }
  
  /**
   * Register a singleton value
   */
  registerValue<T>(name: string, value: T): void {
    this.services.set(name, {
      factory: () => value,
      singleton: true,
      instance: value
    });
  }
  
  /**
   * Register a factory function
   */
  registerFactory<T>(
    name: string,
    factory: Factory<T>
  ): void {
    this.register(name, factory, { singleton: false });
  }
  
  /**
   * Resolve a service
   */
  async resolve<T>(name: string): Promise<T> {
    const service = this.services.get(name);
    
    if (!service) {
      throw new Error(`Service "${name}" not found`);
    }
    
    // Return existing instance if singleton
    if (service.singleton && service.instance) {
      return service.instance;
    }
    
    // Check if already resolving (handle concurrent requests)
    if (this.resolutionPromises.has(name)) {
      return this.resolutionPromises.get(name);
    }
    
    // Check for circular dependencies
    if (this.resolving.has(name)) {
      throw new Error(`Circular dependency detected: ${name}`);
    }
    
    // Create resolution promise
    const resolutionPromise = (async () => {
      try {
        this.resolving.add(name);
        
        // Resolve dependencies first
        const deps = await this.resolveDependencies(service.dependencies || []);
        
        // Create instance
        const instance = await service.factory.apply(null, deps);
        
        // Store singleton instance
        if (service.singleton) {
          service.instance = instance;
        }
        
        return instance;
      } finally {
        this.resolving.delete(name);
        this.resolutionPromises.delete(name);
      }
    })();
    
    // Store promise for concurrent requests
    if (service.singleton) {
      this.resolutionPromises.set(name, resolutionPromise);
    }
    
    return resolutionPromise;
  }
  
  /**
   * Resolve multiple services
   */
  async resolveAll<T extends any[]>(
    ...names: string[]
  ): Promise<T> {
    const results = await Promise.all(
      names.map(name => this.resolve(name))
    );
    return results as T;
  }
  
  /**
   * Check if service is registered
   */
  has(name: string): boolean {
    return this.services.has(name);
  }
  
  /**
   * Clear all services
   */
  clear(): void {
    this.services.clear();
    this.resolving.clear();
  }
  
  /**
   * Resolve dependencies
   */
  private async resolveDependencies(deps: string[]): Promise<any[]> {
    return Promise.all(deps.map(dep => this.resolve(dep)));
  }
  
  /**
   * Create a scoped container
   */
  createScope(): DIContainer {
    const scope = new DIContainer();
    
    // Copy service definitions (not instances)
    for (const [name, service] of this.services) {
      scope.services.set(name, {
        factory: service.factory,
        singleton: service.singleton,
        dependencies: service.dependencies
      });
    }
    
    return scope;
  }
}

// Global container
let globalContainer: DIContainer | null = null;

export function getContainer(): DIContainer {
  if (!globalContainer) {
    globalContainer = new DIContainer();
    // Use the fixed registration function that avoids circular dependencies
    registerCoreServicesFixed(globalContainer);
  }
  return globalContainer;
}

// OLD REGISTRATION FUNCTION - DO NOT USE
// This function has circular dependencies and causes startup crashes
// Use registerCoreServicesFixed from ContainerFix.ts instead
/*
function registerCoreServices(container: DIContainer): void {
  // Event Bus
  container.register('eventBus', () => {
    const { getEventBus } = require('$lib/events/EventBus');
    return getEventBus();
  });
  
  // Validation Service
  container.register('validator', () => {
    const { getValidationService } = require('$lib/validation/ValidationService');
    return getValidationService();
  });
  
  // GPU Resource Manager
  container.register('gpuResourceManager', async () => {
    const { GpuResourceManager } = await import('$lib/gpu/GpuResourceManager');
    const manager = new GpuResourceManager();
    await manager.init();
    return manager;
  });
  
  // Render Scheduler
  container.register('renderScheduler', () => {
    const { getRenderScheduler } = require('$lib/scheduler/RenderScheduler');
    return getRenderScheduler();
  });
  
  // API
  container.register('api', async () => {
    const { validatedApi } = await import('$lib/api/validatedApi');
    return validatedApi;
  });
  
  // Layer Service
  container.register('layerService', async () => {
    const { createLayerService } = await import('$lib/services/LayerService');
    const [eventBus, validator, api] = await container.resolveAll(
      'eventBus',
      'validator',
      'api'
    );
    
    return createLayerService({
      eventBus,
      validator,
      api
    });
  }, {
    dependencies: ['eventBus', 'validator', 'api']
  });
  
  // Volume Service
  container.register('volumeService', async () => {
    const { createVolumeService } = await import('$lib/services/VolumeService');
    const [eventBus, validator, api, gpuManager] = await container.resolveAll(
      'eventBus',
      'validator',
      'api',
      'gpuResourceManager'
    );
    
    return createVolumeService({
      eventBus,
      validator,
      api,
      gpuManager
    });
  }, {
    dependencies: ['eventBus', 'validator', 'api', 'gpuResourceManager']
  });
  
  // Config Service
  container.register('configService', async () => {
    const { createConfigService } = await import('$lib/services/ConfigService');
    const [eventBus, validator] = await container.resolveAll(
      'eventBus',
      'validator'
    );
    
    return createConfigService({
      eventBus,
      validator
    });
  }, {
    dependencies: ['eventBus', 'validator']
  });
  
  // Notification Service
  container.register('notificationService', async () => {
    const { createNotificationService } = await import('$lib/services/NotificationService');
    const eventBus = await container.resolve('eventBus');
    
    return createNotificationService({
      eventBus,
      maxNotifications: 5,
      defaultDuration: 5000
    });
  }, {
    dependencies: ['eventBus']
  });
  
  // Crosshair Service
  container.register('crosshairService', async () => {
    const { createCrosshairService } = await import('$lib/services/CrosshairService');
    const [eventBus, validator, volumeService] = await container.resolveAll(
      'eventBus',
      'validator',
      'volumeService'
    );
    
    return createCrosshairService({
      eventBus,
      validator,
      volumeService
    });
  }, {
    dependencies: ['eventBus', 'validator', 'volumeService']
  });
  
  // Mount Service
  container.register('mountService', async () => {
    const { createMountService } = await import('$lib/services/MountService');
    const [eventBus, validator, api, configService] = await container.resolveAll(
      'eventBus',
      'validator',
      'api',
      'configService'
    );
    
    return createMountService({
      eventBus,
      validator,
      api,
      configService
    });
  }, {
    dependencies: ['eventBus', 'validator', 'api', 'configService']
  });
  
  // Stream Manager
  container.register('streamManager', async () => {
    const { createStreamManager } = await import('$lib/services/StreamManager');
    const [eventBus, validator] = await container.resolveAll(
      'eventBus',
      'validator'
    );
    
    return createStreamManager({
      eventBus,
      validator,
      maxReconnectAttempts: 5,
      reconnectDelay: 1000
    });
  }, {
    dependencies: ['eventBus', 'validator']
  });
  
  // Volume Repository
  container.register('volumeRepository', async () => {
    const { createVolumeRepository } = await import('$lib/repositories/VolumeRepository');
    const eventBus = await container.resolve('eventBus');
    
    return createVolumeRepository({
      eventBus,
      maxVolumes: 20
    }, true); // Use persistent storage
  }, {
    dependencies: ['eventBus']
  });
  
  // Annotation Service
  container.register('annotationService', async () => {
    const { AnnotationService } = await import('$lib/services/AnnotationService');
    const [eventBus, configService, notificationService] = await container.resolveAll(
      'eventBus',
      'configService',
      'notificationService'
    );
    
    return new AnnotationService({
      eventBus,
      configService,
      notificationService
    });
  }, {
    dependencies: ['eventBus', 'configService', 'notificationService']
  });
  
  // Store Service Bridge
  container.register('storeServiceBridge', async () => {
    const { initializeStoreServiceBridge } = await import('$lib/integration/StoreServiceBridge');
    return initializeStoreServiceBridge(container);
  }, {
    singleton: true,
    dependencies: ['eventBus', 'volumeService', 'crosshairService', 'layerService', 'notificationService']
  });
}
*/

// Decorator for dependency injection
export function Injectable(dependencies?: string[]) {
  return function(target: any) {
    const container = getContainer();
    const name = target.name.charAt(0).toLowerCase() + target.name.slice(1);
    
    container.register(name, () => {
      const deps = dependencies || [];
      const resolvedDeps = deps.map(dep => container.resolve(dep));
      return Promise.all(resolvedDeps).then(args => new target(...args));
    }, { dependencies });
  };
}

// For async service resolution
export async function getService<T>(name: string): Promise<T> {
  return getContainer().resolve<T>(name);
}

// For sync service check
export function hasService(name: string): boolean {
  return getContainer().has(name);
}