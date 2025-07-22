<script lang="ts">
	console.log('=== layout.golden-safe.svelte starting ===');
	
	// Initialize validated config before anything else
	import { loadAndValidateConfig } from '$lib/validation/schemas/Config';
	const validatedConfig = loadAndValidateConfig();
	(globalThis as any).__BRAINFLOW_VALIDATED_CONFIG__ = validatedConfig;
	console.log('Validated config initialized:', validatedConfig);
	
	let { children } = $props();
	
	// Import components and services after config is initialized
	import { onMount, setContext } from 'svelte';
	import { coreApi } from '$lib/api';
	import { GoldenLayout, type LayoutConfig, type ResolvedLayoutConfig } from 'golden-layout';
	import 'golden-layout/dist/css/goldenlayout-base.css';
	import 'golden-layout/dist/css/themes/goldenlayout-light-theme.css';
	import StatusBar from '$lib/components/StatusBar.svelte';
	
	// Local state for golden layout
	let layoutContainer: HTMLElement | null = $state(null);
	let goldenLayoutInstance: GoldenLayout | null = null;
	let initError = $state<string | null>(null);
	let layoutReady = $state(false);
	
	// Debug logging
	let debugLogs = $state<string[]>([]);
	const addDebugLog = (message: string) => {
		console.log(message);
		debugLogs = [...debugLogs.slice(-20), `${new Date().toISOString().slice(11,19)} - ${message}`];
	};
	
	onMount(() => {
		console.log('=== onMount START ===');
		addDebugLog('onMount started');
		
		// Check if container exists
		if (!layoutContainer) {
			initError = 'Layout container not found';
			addDebugLog('ERROR: Layout container not found');
			return;
		}
		
		const containerRect = layoutContainer.getBoundingClientRect();
		addDebugLog(`Container size: ${containerRect.width}x${containerRect.height}`);
		
		try {
			// Create GoldenLayout instance
			addDebugLog('Creating GoldenLayout instance...');
			goldenLayoutInstance = new GoldenLayout(layoutContainer);
			
			// Set context synchronously
			setContext('layoutManager', goldenLayoutInstance);
			addDebugLog('Context set');
			
			// Register a simple test component
			goldenLayoutInstance.registerComponentFactoryFunction('test', (container) => {
				container.element.innerHTML = '<div style="padding: 20px; color: white;">Test Component</div>';
			});
			addDebugLog('Test component registered');
			
			// Use minimal layout
			const minimalLayout: LayoutConfig = {
				root: {
					type: 'row',
					content: [
						{
							type: 'component',
							componentType: 'test',
							title: 'Test 1'
						},
						{
							type: 'component',
							componentType: 'test',
							title: 'Test 2'
						}
					]
				}
			};
			
			// Add event listeners for debugging
			goldenLayoutInstance.on('initialised', () => {
				addDebugLog('GoldenLayout initialized');
				layoutReady = true;
			});
			
			goldenLayoutInstance.on('stateChanged', () => {
				addDebugLog('GoldenLayout state changed');
			});
			
			// Load layout
			addDebugLog('Loading layout...');
			goldenLayoutInstance.loadLayout(minimalLayout);
			addDebugLog('Layout load called');
			
		} catch (err) {
			console.error('Failed to initialize GoldenLayout:', err);
			initError = String(err);
			addDebugLog(`ERROR: ${err}`);
		}
		
		// Initialize GPU in background
		(async () => {
			try {
				addDebugLog('Initializing GPU...');
				await coreApi.init_render_loop();
				await coreApi.create_offscreen_render_target(512, 512);
				addDebugLog('GPU initialized');
			} catch (err) {
				addDebugLog(`GPU init error: ${err}`);
			}
		})();
		
		// Cleanup
		return () => {
			if (goldenLayoutInstance) {
				goldenLayoutInstance.destroy();
			}
		};
	});
</script>

<div class="app-container">
	<!-- Debug panel -->
	<div class="debug-panel">
		<h3>Debug Log:</h3>
		{#each debugLogs as log}
			<div class="log-entry" class:error={log.includes('ERROR')}>
				{log}
			</div>
		{/each}
		{#if debugLogs.length === 0}
			<div class="log-entry">Waiting for logs...</div>
		{/if}
	</div>
	
	<!-- Error display -->
	{#if initError}
		<div class="error-message">
			<h2>Initialization Error:</h2>
			<p>{initError}</p>
		</div>
	{/if}
	
	<!-- Layout container -->
	<div class="layout-wrapper" bind:this={layoutContainer}>
		{#if !layoutReady}
			<div class="loading">Loading GoldenLayout...</div>
		{/if}
		<!-- GoldenLayout will render here -->
	</div>
	
	<!-- Hidden children for routing -->
	<div style="display: none;">
		{@render children()}
	</div>
	
	<StatusBar />
</div>

<style>
	.app-container {
		display: flex;
		flex-direction: column;
		width: 100vw;
		height: 100vh;
		overflow: hidden;
		background: #1a1a1a;
		color: white;
	}
	
	.debug-panel {
		position: fixed;
		top: 10px;
		right: 10px;
		width: 400px;
		max-height: 300px;
		background: rgba(0, 0, 0, 0.9);
		border: 1px solid #444;
		padding: 10px;
		overflow-y: auto;
		z-index: 10000;
		font-family: monospace;
		font-size: 12px;
	}
	
	.debug-panel h3 {
		margin: 0 0 10px 0;
		color: #0f0;
	}
	
	.log-entry {
		margin: 2px 0;
		color: #0f0;
	}
	
	.log-entry.error {
		color: #f00;
	}
	
	.error-message {
		position: fixed;
		top: 50%;
		left: 50%;
		transform: translate(-50%, -50%);
		background: #ff0000;
		color: white;
		padding: 20px;
		border-radius: 8px;
		z-index: 1000;
	}
	
	.layout-wrapper {
		flex: 1;
		overflow: hidden;
		position: relative;
	}
	
	.loading {
		position: absolute;
		top: 50%;
		left: 50%;
		transform: translate(-50%, -50%);
		color: #888;
	}
	
	/* GoldenLayout styles */
	:global(.lm_root) {
		width: 100%;
		height: 100%;
	}
	
	:global(.lm_content) {
		background: #2a2a2a;
	}
</style>