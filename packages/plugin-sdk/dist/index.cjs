"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/index.ts
var index_exports = {};
__export(index_exports, {
  AnalysisPlugin: () => AnalysisPlugin,
  BasePlugin: () => BasePlugin,
  IntegrationPlugin: () => IntegrationPlugin,
  LoaderPlugin: () => LoaderPlugin,
  Plugin: () => Plugin,
  PluginSDK: () => PluginSDK,
  PluginTestUtils: () => PluginTestUtils,
  RequiresGPU: () => RequiresGPU,
  RequiresNetwork: () => RequiresNetwork,
  RequiresPermission: () => RequiresPermission,
  UIPlugin: () => UIPlugin,
  VisualizationPlugin: () => VisualizationPlugin,
  WorkflowPlugin: () => WorkflowPlugin
});
module.exports = __toCommonJS(index_exports);
var BasePlugin = class {
  context;
  manifest;
  constructor(manifest) {
    this.manifest = manifest;
  }
  /**
   * Initialize the plugin with context
   * Called by the plugin manager when the plugin is activated
   */
  async initialize(context) {
    this.context = context;
    await this.onInitialize();
  }
  /**
   * Cleanup the plugin
   * Called by the plugin manager when the plugin is deactivated
   */
  async cleanup() {
    await this.onCleanup();
    this.context = void 0;
  }
  /**
   * Get plugin manifest
   */
  getManifest() {
    return this.manifest;
  }
  /**
   * Get plugin context (throws if not initialized)
   */
  getContext() {
    if (!this.context) {
      throw new Error("Plugin not initialized");
    }
    return this.context;
  }
  /**
   * Log a message
   */
  log(level, message, data) {
    const context = this.getContext();
    context.logger[level](message, data);
  }
  /**
   * Get configuration value
   */
  getConfig(key, defaultValue) {
    const context = this.getContext();
    return context.config.get(key, defaultValue);
  }
  /**
   * Set configuration value
   */
  setConfig(key, value) {
    const context = this.getContext();
    context.config.set(key, value);
  }
  /**
   * Emit an event
   */
  async emitEvent(eventName, payload) {
    const context = this.getContext();
    await context.api.emitEvent(eventName, payload);
  }
  /**
   * Subscribe to an event
   */
  subscribeEvent(eventName, handler) {
    const context = this.getContext();
    return context.api.subscribeEvent(eventName, handler);
  }
  /**
   * Show a notification
   */
  showNotification(type, message) {
    const context = this.getContext();
    context.api.ui.showNotification({ type, message });
  }
};
var LoaderPlugin = class extends BasePlugin {
};
var VisualizationPlugin = class extends BasePlugin {
};
var AnalysisPlugin = class extends BasePlugin {
};
var UIPlugin = class extends BasePlugin {
};
var WorkflowPlugin = class extends BasePlugin {
};
var IntegrationPlugin = class extends BasePlugin {
};
var PluginSDK = {
  /**
   * Create a plugin manifest
   */
  createManifest(config) {
    return {
      id: config.id,
      name: config.name,
      version: config.version || "1.0.0",
      compatibleCore: "^0.1.0",
      type: config.type,
      apiVersion: "0.1.1",
      entrypoint: config.entrypoint,
      handles: config.handles,
      description: config.description,
      author: config.author
    };
  },
  /**
   * Create basic permissions
   */
  createPermissions(permissions) {
    return permissions;
  },
  /**
   * Create resource requirements
   */
  createResourceRequirements(config) {
    return {
      maxMemoryMB: config.maxMemoryMB || 128,
      maxExecutionTimeMs: config.maxExecutionTimeMs || 3e4,
      requiresGPU: config.requiresGPU || false,
      requiresNetwork: config.requiresNetwork || false
    };
  },
  /**
   * Validate plugin structure
   */
  validatePlugin(plugin, expectedType) {
    const errors = [];
    if (!plugin) {
      errors.push("Plugin is null or undefined");
      return { valid: false, errors };
    }
    const requiredMethods = {
      loader: ["canHandle", "load"],
      visualization: ["render", "getSupportedDataTypes"],
      analysis: ["process", "getInputTypes", "getOutputTypes"],
      ui: ["createComponent"],
      workflow: ["execute", "getSteps"],
      integration: ["connect", "disconnect"]
    };
    const required = requiredMethods[expectedType];
    if (required) {
      for (const method of required) {
        if (typeof plugin[method] !== "function") {
          errors.push(`Missing required method: ${method}`);
        }
      }
    }
    if (typeof plugin.initialize !== "function") {
      errors.push("Missing required method: initialize");
    }
    if (typeof plugin.cleanup !== "function") {
      errors.push("Missing required method: cleanup");
    }
    return {
      valid: errors.length === 0,
      errors
    };
  }
};
function Plugin(manifest) {
  return function(constructor) {
    constructor.manifest = manifest;
    return constructor;
  };
}
function RequiresPermission(permission) {
  return function(target, propertyKey, descriptor) {
    const requiredPermissions = target.requiredPermissions || [];
    requiredPermissions.push(permission);
    target.requiredPermissions = requiredPermissions;
  };
}
function RequiresGPU() {
  return function(target, propertyKey, descriptor) {
    target.requiresGPU = true;
  };
}
function RequiresNetwork() {
  return function(target, propertyKey, descriptor) {
    target.requiresNetwork = true;
  };
}
var PluginTestUtils = {
  /**
   * Create a mock plugin context for testing
   */
  createMockContext(pluginId) {
    return {
      pluginId,
      api: {
        core: {},
        getService: async () => null,
        emitEvent: async () => {
        },
        subscribeEvent: () => () => {
        },
        storage: {
          get: async () => null,
          set: async () => {
          },
          delete: async () => {
          },
          clear: async () => {
          },
          keys: async () => []
        },
        ui: {
          registerComponent: () => {
          },
          createPanel: async () => ({
            id: "test-panel",
            show: () => {
            },
            hide: () => {
            },
            close: () => {
            },
            resize: () => {
            }
          }),
          showNotification: () => {
          },
          addMenuItem: () => {
          }
        }
      },
      messageBus: {
        publish: async () => {
        },
        subscribe: () => () => {
        },
        createPrivateChannel: () => ({
          send: async () => {
          },
          onReceive: () => () => {
          }
        }),
        getPublicChannels: () => []
      },
      resources: {
        allocateMemory: () => null,
        releaseMemory: () => {
        },
        getMemoryUsage: () => ({ allocated: 0, used: 0, limit: 1e6 }),
        setExecutionTimeout: () => {
        },
        checkResourceLimits: () => ({ memoryOk: true, executionTimeOk: true, withinLimits: true })
      },
      logger: {
        debug: () => {
        },
        info: () => {
        },
        warn: () => {
        },
        error: () => {
        }
      },
      config: {
        get: (_key, defaultValue) => defaultValue,
        set: () => {
        },
        has: () => false,
        delete: () => {
        }
      }
    };
  }
};
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  AnalysisPlugin,
  BasePlugin,
  IntegrationPlugin,
  LoaderPlugin,
  Plugin,
  PluginSDK,
  PluginTestUtils,
  RequiresGPU,
  RequiresNetwork,
  RequiresPermission,
  UIPlugin,
  VisualizationPlugin,
  WorkflowPlugin
});
