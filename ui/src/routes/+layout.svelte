<script lang="ts">
	// Initialize validated config before anything else
	import { loadAndValidateConfig } from '$lib/validation/schemas/Config';
	const validatedConfig = loadAndValidateConfig();
	(globalThis as any).__BRAINFLOW_VALIDATED_CONFIG__ = validatedConfig;
	
	let { children } = $props();
	
	// Import components and services after config is initialized
	import { onMount } from 'svelte';
	import { coreApi } from '$lib/api';
	import { GoldenLayout, type LayoutConfig } from 'golden-layout';
	import 'golden-layout/dist/css/goldenlayout-base.css';
	import 'golden-layout/dist/css/themes/goldenlayout-dark-theme.css';
	import StatusBar from '$lib/components/StatusBar.simple.svelte';
	
	// Import real components
	import VolumeView from '$lib/components/views/VolumeView.svelte';
	import FileBrowserPanel from '$lib/components/panels/FileBrowserPanel.svelte';
	import LayerPanel from '$lib/components/panels/LayerPanel.svelte';
	
	// Local state for golden layout
	let layoutContainer: HTMLElement;
	let goldenLayoutInstance: GoldenLayout | null = null;
	let initError = $state<string | null>(null);
	
	onMount(async () => {
		// Initialize GPU first
		try {
			await coreApi.init_render_loop();
			await coreApi.create_offscreen_render_target(512, 512);
		} catch (err) {
			console.error('Failed to initialize GPU render loop:', err);
		}
		
		// Wait a tick for container to be ready
		setTimeout(() => {
			if (!layoutContainer) {
				initError = 'Layout container not found';
				return;
			}
			
			try {
				goldenLayoutInstance = new GoldenLayout(layoutContainer);
				
				// Register file browser component
				goldenLayoutInstance.registerComponentFactoryFunction('tree-browser', (container) => {
					// Mount the FileBrowserPanel component
					import('$lib/components/panels/FileBrowserPanel.svelte').then(({ default: FileBrowserPanel }) => {
						import('svelte').then(({ mount }) => {
							mount(FileBrowserPanel, {
								target: container.element
							});
						});
					});
				});
				
				goldenLayoutInstance.registerComponentFactoryFunction('volume-view', (container) => {
					// For VolumeView, we'll mount the real Svelte component
					import('$lib/components/views/VolumeView.svelte').then(({ default: VolumeView }) => {
						import('svelte').then(({ mount }) => {
							mount(VolumeView, {
								target: container.element
							});
						});
					});
				});
				
				goldenLayoutInstance.registerComponentFactoryFunction('layer-panel', (container) => {
					// Mount the real LayerPanel component
					import('$lib/components/panels/LayerPanel.svelte').then(({ default: LayerPanel }) => {
						import('svelte').then(({ mount }) => {
							mount(LayerPanel, {
								target: container.element
							});
						});
					});
				});
				
				// Simple 3-panel layout
				const simpleLayout: LayoutConfig = {
					root: {
						type: 'row',
						content: [
							// Left sidebar
							{
								type: 'stack',
								width: 20,
								content: [{
									type: 'component',
									componentType: 'tree-browser',
									id: 'files-singleton',
									title: 'Files'
								}]
							},
							// Center content
							{
								type: 'stack',
								width: 60,
								content: [{
									type: 'component',
									componentType: 'volume-view',
									title: 'Volume View'
								}]
							},
							// Right sidebar
							{
								type: 'stack',
								width: 20,
								content: [{
									type: 'component',
									componentType: 'layer-panel',
									title: 'Layers'
								}]
							}
						]
					},
					settings: {
						showPopoutIcon: false,
						showMaximiseIcon: true,
						showCloseIcon: false,
					},
					dimensions: {
						borderWidth: 3,
						minItemHeight: 150,
						minItemWidth: 160,
						headerHeight: 28,
					}
				};
				
				// Load layout
				goldenLayoutInstance.loadLayout(simpleLayout);
				
			} catch (err) {
				console.error('Failed to initialize GoldenLayout:', err);
				initError = `GoldenLayout error: ${err}`;
			}
		}, 100);
		
		// Cleanup
		return () => {
			if (goldenLayoutInstance) {
				goldenLayoutInstance.destroy();
			}
		};
	});
</script>

<div class="app-container">
	<!-- Error display -->
	{#if initError}
		<div class="error-message">
			{initError}
		</div>
	{/if}
	
	<!-- Layout container -->
	<div class="layout-wrapper" bind:this={layoutContainer}>
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
	
	.error-message {
		position: fixed;
		top: 10px;
		left: 50%;
		transform: translateX(-50%);
		background: #ff3333;
		color: white;
		padding: 10px 20px;
		border-radius: 4px;
		z-index: 10000;
	}
	
	.layout-wrapper {
		flex: 1;
		overflow: hidden;
		position: relative;
	}
	
	/* GoldenLayout overrides for dark theme */
	:global(.lm_root) {
		position: relative;
	}
	
	:global(.lm_header) {
		background: #2a2a2a;
		height: 28px;
	}
	
	:global(.lm_header .lm_tab) {
		background: #333;
		color: #e0e0e0;
		font-size: 13px;
		height: 24px;
		line-height: 24px;
		margin-top: 2px;
	}
	
	:global(.lm_header .lm_tab.lm_active) {
		background: #444;
		color: white;
	}
	
	:global(.lm_content) {
		background: #1a1a1a;
	}
	
	:global(.lm_splitter) {
		background: #444;
		opacity: 1;
	}
	
	:global(.lm_splitter:hover) {
		background: #666;
	}
	
	:global(.lm_controls > li) {
		filter: invert(0.8);
	}
</style>