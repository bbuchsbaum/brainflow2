<script lang="ts">
	console.log('=== +layout.golden.svelte starting ===');
	
	// Initialize validated config before anything else
	import { loadAndValidateConfig } from '$lib/validation/schemas/Config';
	const validatedConfig = loadAndValidateConfig();
	(globalThis as any).__BRAINFLOW_VALIDATED_CONFIG__ = validatedConfig;
	console.log('Validated config initialized:', validatedConfig);
	
	let { children } = $props();
	
	// Import components and services after config is initialized
	import { onMount, setContext } from 'svelte';
	import { coreApi } from '$lib/api';
	import StatusBar from '$lib/components/StatusBar.svelte';
	
	// Import GoldenLayout with error handling
	let GoldenLayout: any;
	let layoutError: string | null = null;
	
	try {
		const gl = await import('golden-layout');
		GoldenLayout = gl.GoldenLayout;
		await import('golden-layout/dist/css/goldenlayout-base.css');
		await import('golden-layout/dist/css/themes/goldenlayout-light-theme.css');
		console.log('GoldenLayout imported successfully');
	} catch (err) {
		console.error('Failed to import GoldenLayout:', err);
		layoutError = `Failed to import GoldenLayout: ${err}`;
	}
	
	// Local state
	let layoutContainer: HTMLElement | null = $state(null);
	let goldenLayoutInstance: any = null;
	let layoutInitialized = $state(false);
	let initError = $state<string | null>(null);
	
	onMount(() => {
		console.log('=== +layout.golden.svelte onMount START ===');
		
		if (layoutError) {
			initError = layoutError;
			return;
		}
		
		if (!layoutContainer) {
			initError = 'Layout container not found';
			return;
		}
		
		// Initialize GPU render loop first
		(async () => {
			try {
				console.log('Initializing GPU render loop...');
				await coreApi.init_render_loop();
				await coreApi.create_offscreen_render_target(512, 512);
				console.log('GPU render loop initialized successfully');
			} catch (err) {
				console.error('Failed to initialize GPU render loop:', err);
				// Continue anyway - some features may not work
			}
			
			// Now try to initialize GoldenLayout
			if (GoldenLayout) {
				try {
					console.log('Creating GoldenLayout instance...');
					goldenLayoutInstance = new GoldenLayout(layoutContainer);
					
					// Set context synchronously
					setContext('layoutManager', goldenLayoutInstance);
					console.log('Context set for layoutManager');
					
					// Try a very simple layout
					const minimalLayout = {
						root: {
							type: 'row',
							content: [{
								type: 'component',
								componentType: 'placeholder',
								title: 'Test Component'
							}]
						}
					};
					
					// Register a simple placeholder component
					goldenLayoutInstance.registerComponentFactoryFunction('placeholder', (container: any) => {
						container.element.innerHTML = '<div style="padding: 20px;">Placeholder Component</div>';
					});
					
					console.log('Loading minimal layout...');
					goldenLayoutInstance.loadLayout(minimalLayout);
					layoutInitialized = true;
					console.log('Layout loaded successfully');
					
				} catch (err) {
					console.error('Failed to initialize GoldenLayout:', err);
					initError = `Failed to initialize GoldenLayout: ${err}`;
				}
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
	{#if initError}
		<div class="error-panel">
			<h2>Initialization Error</h2>
			<p>{initError}</p>
			<p>Check the browser console for more details.</p>
		</div>
	{:else if !layoutInitialized}
		<div class="loading-panel">
			<h2>Loading...</h2>
			<p>Initializing application layout...</p>
		</div>
	{/if}
	
	<div class="layout-wrapper" bind:this={layoutContainer}>
		<!-- GoldenLayout will render here -->
	</div>
	
	<!-- Always show children (hidden) for routing -->
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
	
	.layout-wrapper {
		flex: 1;
		overflow: hidden;
	}
	
	.error-panel, .loading-panel {
		position: fixed;
		top: 50%;
		left: 50%;
		transform: translate(-50%, -50%);
		background: #2a2a2a;
		padding: 30px;
		border-radius: 8px;
		text-align: center;
		z-index: 1000;
	}
	
	.error-panel {
		border: 2px solid #ff4444;
	}
	
	.error-panel h2 {
		color: #ff4444;
		margin: 0 0 10px 0;
	}
	
	:global(.lm_root) {
		width: 100%;
		height: 100%;
	}
</style>