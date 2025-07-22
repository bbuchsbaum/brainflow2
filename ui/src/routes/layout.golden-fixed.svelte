<script lang="ts">
	console.log('=== layout.golden-fixed.svelte starting ===');
	
	// Initialize validated config before anything else
	import { loadAndValidateConfig } from '$lib/validation/schemas/Config';
	const validatedConfig = loadAndValidateConfig();
	(globalThis as any).__BRAINFLOW_VALIDATED_CONFIG__ = validatedConfig;
	console.log('Validated config initialized:', validatedConfig);
	
	let { children } = $props();
	
	// Import components and services after config is initialized
	import { onMount, setContext } from 'svelte';
	import { coreApi } from '$lib/api';
	import { GoldenLayout, type LayoutConfig } from 'golden-layout';
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
		
		// Use requestAnimationFrame to ensure DOM is ready
		requestAnimationFrame(() => {
			addDebugLog('In requestAnimationFrame');
			
			if (!layoutContainer) {
				initError = 'Layout container not found';
				addDebugLog('ERROR: Layout container not found');
				return;
			}
			
			// Check container has dimensions
			const rect = layoutContainer.getBoundingClientRect();
			addDebugLog(`Container dimensions: ${rect.width}x${rect.height}`);
			
			if (rect.width === 0 || rect.height === 0) {
				// Try again after a delay
				setTimeout(() => {
					const rect2 = layoutContainer.getBoundingClientRect();
					addDebugLog(`Container dimensions (retry): ${rect2.width}x${rect2.height}`);
					if (rect2.width > 0 && rect2.height > 0) {
						initializeGoldenLayout();
					} else {
						initError = 'Container has no dimensions';
						addDebugLog('ERROR: Container has no dimensions after retry');
					}
				}, 100);
				return;
			}
			
			initializeGoldenLayout();
		});
		
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
				try {
					goldenLayoutInstance.destroy();
					addDebugLog('GoldenLayout destroyed');
				} catch (err) {
					console.error('Error destroying GoldenLayout:', err);
				}
			}
		};
	});
	
	function initializeGoldenLayout() {
		try {
			addDebugLog('Starting GoldenLayout initialization...');
			
			// Log container state
			console.log('Container state:', {
				element: layoutContainer,
				width: layoutContainer?.offsetWidth,
				height: layoutContainer?.offsetHeight,
				clientWidth: layoutContainer?.clientWidth,
				clientHeight: layoutContainer?.clientHeight,
				computedStyle: layoutContainer ? getComputedStyle(layoutContainer) : null
			});
			
			// Create GoldenLayout instance with explicit config
			const config: LayoutConfig = {
				settings: {
					showPopoutIcon: false,
					showMaximiseIcon: true,
					showCloseIcon: true
				},
				dimensions: {
					borderWidth: 5,
					minItemHeight: 10,
					minItemWidth: 10,
					headerHeight: 20,
					dragProxyWidth: 300,
					dragProxyHeight: 200
				},
				labels: {
					close: 'close',
					maximise: 'maximise',
					minimise: 'minimise'
				},
				content: [{
					type: 'row',
					content: [
						{
							type: 'component',
							componentName: 'test',
							componentState: { text: 'Test Component 1' }
						},
						{
							type: 'component',
							componentName: 'test',
							componentState: { text: 'Test Component 2' }
						}
					]
				}]
			};
			
			addDebugLog('Creating GoldenLayout instance...');
			goldenLayoutInstance = new GoldenLayout(config, layoutContainer);
			addDebugLog('GoldenLayout instance created');
			
			// Register test component before init
			goldenLayoutInstance.registerComponent('test', function(container: any, componentState: any) {
				const text = componentState?.text || 'Test Component';
				container.getElement().html(`<div style="padding: 20px; color: white;">${text}</div>`);
			});
			addDebugLog('Test component registered');
			
			// Set up event handlers
			goldenLayoutInstance.on('initialised', () => {
				addDebugLog('GoldenLayout initialized event fired');
				layoutReady = true;
				// Set context after initialization
				setContext('layoutManager', goldenLayoutInstance);
			});
			
			goldenLayoutInstance.on('stateChanged', () => {
				addDebugLog('GoldenLayout state changed');
			});
			
			// Initialize
			addDebugLog('Calling init()...');
			goldenLayoutInstance.init();
			addDebugLog('init() called');
			
		} catch (err: any) {
			console.error('Failed to initialize GoldenLayout:', err);
			initError = err?.message || String(err);
			addDebugLog(`ERROR: ${err?.message || err}`);
			
			// Log more error details
			console.error('Error details:', {
				message: err?.message,
				stack: err?.stack,
				container: layoutContainer,
				containerHTML: layoutContainer?.outerHTML?.substring(0, 200)
			});
		}
	}
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
	
	<!-- Layout container with explicit sizing -->
	<div class="layout-wrapper" bind:this={layoutContainer}>
		{#if !layoutReady && !initError}
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
		min-height: 0; /* Important for flexbox */
		width: 100%;
		height: 100%;
		background: #2a2a2a; /* Ensure visibility */
	}
	
	.loading {
		position: absolute;
		top: 50%;
		left: 50%;
		transform: translate(-50%, -50%);
		color: #888;
		font-size: 18px;
	}
	
	/* GoldenLayout styles */
	:global(.lm_root) {
		width: 100%;
		height: 100%;
		position: relative;
	}
	
	:global(.lm_row > .lm_item) {
		float: left;
	}
	
	:global(.lm_content) {
		background: #333;
		overflow: auto;
	}
	
	:global(.lm_header) {
		height: 20px;
		background: #444;
	}
	
	:global(.lm_header .lm_tab) {
		padding: 0 10px;
		line-height: 20px;
		background: #555;
		color: white;
	}
</style>