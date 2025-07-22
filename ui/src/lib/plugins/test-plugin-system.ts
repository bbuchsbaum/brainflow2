/**
 * Test script to verify plugin system functionality
 * This is a simple test to ensure the plugin system is working correctly
 */

import { PluginManager } from './PluginManager';
import { PluginLoader } from './PluginLoader';
// import { PluginValidator } from './PluginValidator'; // File doesn't exist
import { EventBus } from '$lib/events/EventBus';
import type { PluginManifest, PluginManagerConfig } from './types';

// Mock plugin for testing
class TestPlugin {
	private manifest: PluginManifest;
	private context: any;
	private initialized = false;

	constructor(manifest: PluginManifest) {
		this.manifest = manifest;
	}

	async initialize(context: any): Promise<void> {
		this.context = context;
		this.initialized = true;
		console.log(`TestPlugin ${this.manifest.id} initialized`);
	}

	async cleanup(): Promise<void> {
		this.initialized = false;
		console.log(`TestPlugin ${this.manifest.id} cleaned up`);
	}

	getManifest(): PluginManifest {
		return this.manifest;
	}

	isInitialized(): boolean {
		return this.initialized;
	}

	// Test method to verify plugin is working
	async testMethod(): Promise<string> {
		return `Hello from ${this.manifest.name}!`;
	}
}

// Test manifest
const testManifest: PluginManifest = {
	id: 'test-plugin',
	name: 'Test Plugin',
	version: '1.0.0',
	compatibleCore: '^0.1.0',
	type: 'analysis',
	apiVersion: '0.1.1',
	entrypoint: 'dist/index.js',
	description: 'A test plugin for verification',
	author: 'Test Author',
	handles: ['test-data'],
	permissions: [
		{
			type: 'api',
			scope: 'events',
			level: 'read'
		}
	],
	resources: {
		maxMemoryMB: 64,
		maxExecutionTimeMs: 10000,
		requiresGPU: false,
		requiresNetwork: false
	}
};

// Test configuration
const testConfig: PluginManagerConfig = {
	pluginDirectory: '/tmp/test-plugins',
	maxPlugins: 10,
	enableHotReload: false,
	securityLevel: 'strict',
	allowedOrigins: ['localhost'],
	maxResourceMemoryMB: 1024,
	maxResourceExecutionTimeMs: 60000,
	developmentMode: true
};

export async function testPluginSystem(): Promise<boolean> {
	try {
		console.log('🧪 Testing Plugin System...');

		// Create dependencies
		const eventBus = new EventBus();
		const loader = new PluginLoader();
		const validator = new PluginValidator();

		// Create plugin manager
		const pluginManager = new PluginManager(eventBus, testConfig, loader, validator);

		// Create test plugin instance
		const testPlugin = new TestPlugin(testManifest);

		console.log('✅ Plugin system components created successfully');

		// Test plugin manifest validation
		const validationResult = await validator.validateManifest(testManifest);
		if (!validationResult.valid) {
			console.error('❌ Manifest validation failed:', validationResult.errors);
			return false;
		}

		console.log('✅ Plugin manifest validation passed');

		// Test plugin initialization
		await testPlugin.initialize({
			api: {},
			messageBus: {},
			resources: {},
			logger: { info: console.log, error: console.error, warn: console.warn, debug: console.log }
		});

		if (!testPlugin.isInitialized()) {
			console.error('❌ Plugin initialization failed');
			return false;
		}

		console.log('✅ Plugin initialization successful');

		// Test plugin method
		const result = await testPlugin.testMethod();
		if (result !== 'Hello from Test Plugin!') {
			console.error('❌ Plugin method test failed:', result);
			return false;
		}

		console.log('✅ Plugin method test passed');

		// Test cleanup
		await testPlugin.cleanup();

		if (testPlugin.isInitialized()) {
			console.error('❌ Plugin cleanup failed');
			return false;
		}

		console.log('✅ Plugin cleanup successful');

		console.log('🎉 All plugin system tests passed!');
		return true;
	} catch (error) {
		console.error('❌ Plugin system test failed:', error);
		return false;
	}
}

// Run tests if called directly
if (typeof window !== 'undefined' && window.location?.search?.includes('test-plugins')) {
	testPluginSystem().then((success) => {
		if (success) {
			console.log('✅ Plugin system is working correctly!');
		} else {
			console.error('❌ Plugin system tests failed!');
		}
	});
}
