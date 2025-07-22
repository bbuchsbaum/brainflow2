<script lang="ts">
	console.log('=== +layout.svelte script starting ===');
	
	// Initialize validated config before anything else
	import { loadAndValidateConfig } from '$lib/validation/schemas/Config';
	const validatedConfig = loadAndValidateConfig();
	(globalThis as any).__BRAINFLOW_VALIDATED_CONFIG__ = validatedConfig;
	console.log('Validated config initialized:', validatedConfig);
	
	let { children } = $props();
	
	// Simple test to verify script is running
	let message = $state('Layout script is running!');
	
	console.log('Script loaded, message:', message);

	// --- Debounce Utility ---
	function debounce<T extends (...args: any[]) => any>(func: T, waitFor: number) {
		let timeoutId: ReturnType<typeof setTimeout> | null = null;

		return (...args: Parameters<T>): Promise<ReturnType<T>> =>
			new Promise(resolve => {
				if (timeoutId) {
					clearTimeout(timeoutId);
				}

				timeoutId = setTimeout(() => {
					timeoutId = null;
					resolve(func(...args));
				}, waitFor);
			});
	}
	// ------------------------

	// --- Enhanced GoldenLayout Svelte Component Registration Helper ---
	function glRegister(
		instance: GoldenLayout | null,
		componentType: string, 
		SvelteComp: any,
		defaultTitle: string = componentType
	) {
		if (!instance) {
			console.error(`Cannot register component ${componentType}: GoldenLayout instance is null`);
			return;
		}

		console.log(`Registering component: ${componentType}`);
		
		try {
			instance.registerComponentFactoryFunction(componentType, (container, componentState) => {
				console.log(`Creating component instance: ${componentType}`);
			// Create a container context that can be passed to components
			const containerContext = {
				container,
				componentType,
				state: componentState || {},
				// Helper methods for container interaction
				setTitle: (title: string) => container.setTitle(title),
				setState: (state: Record<string, unknown>) => {
					// Update internal reference; Golden-Layout will request it via stateRequestEvent
					latestState = { ...latestState, ...state };
				},
				getState: () => latestState as Record<string, unknown>,
				close: () => container.close(),
				focus: () => container.focus()
			};
			
			// Adjust Prop Handling for Svelte 5 
			// Ensure componentState is an object before spreading
			const stateProps = 
				componentState && typeof componentState === 'object' && !Array.isArray(componentState)
				? componentState 
				: {};

			const initialProps = {
				...stateProps, // Spread only if it was an object
				title: container.title || defaultTitle, // Use container title or default
				componentType: componentType,
				containerContext: containerContext // Pass the context helper
			};

			// Create Svelte component instance using mount
			const component = mount(SvelteComp, {
				target: container.element,
				props: initialProps as any // Pass props to mount
			});
			
			// Handle component lifecycle and cleanup
			container.on('destroy', () => {
				if (component && typeof component.destroy === 'function') {
					component.destroy(); 
				} else {
					console.warn("Could not call destroy on mounted component - check Svelte 5 mount API");
				}
			});
			
			// Optional - handle visibility changes
			container.on('hide', () => {
				if ('onHide' in component) {
					(component as any).onHide();
				}
			});
			
			container.on('show', () => {
				if ('onShow' in component) {
					(component as any).onShow();
				}
			});
			
			// Maintain latest component state for persistence
			let latestState: Record<string, unknown> = { ...stateProps };
			// Provide to Golden-Layout when it asks
			(container as any).stateRequestEvent = () => latestState;

			// Return API for container to interact with component
			return {
				component,
				// update: (state: Record<string, unknown>) => {
				//     component.$set(state); // $set is likely gone in Svelte 5
				// }
			};
		});
		
		console.log(`Successfully registered component: ${componentType}`);
		} catch (err) {
			console.error(`Failed to register component ${componentType}:`, err);
		}
	}
	// -------------------------------------------------------

	// Debounced save function - Accept ResolvedLayoutConfig
	const debouncedSaveLayout = debounce(async (layout: ResolvedLayoutConfig) => {
		console.log('Debounced stateChanged: attempting to save layout...');
		try {
			// TODO: Replace with actual API call - backend needs to handle ResolvedLayoutConfig
			// await coreApi.saveConfig({ glLayout: layout });
			await Promise.resolve(); // Placeholder
			console.log('Layout save successful (stubbed).');
		} catch (error) {
			console.error('Failed to save layout configuration:', error);
		}
	}, 500); // Save 500ms after the last change

	// Import components and services after config is initialized
	import { onMount, setContext } from 'svelte';
	import { coreApi } from '$lib/api';
	import { setResizeBusDimensions } from '$lib/stores/resizeBus';
	// import { setupLogListener } from '$lib/integration/logListener';
	import { GoldenLayout, type LayoutConfig, type ResolvedLayoutConfig } from 'golden-layout';
	import 'golden-layout/dist/css/goldenlayout-base.css';
	import 'golden-layout/dist/css/themes/goldenlayout-light-theme.css';
	import { defaultLayout } from '$lib/layout/defaultLayout';
	import StatusBar from '$lib/components/StatusBar.svelte';
	import PlaceholderPanel from '$lib/components/panels/PlaceholderPanel.svelte';
	import MountableTreeBrowser from '$lib/components/MountableTreeBrowser.svelte';
	import VolumeView from '$lib/components/views/VolumeView.svelte';
	import LayerPanel from '$lib/components/panels/LayerPanel.svelte';
	import { mount } from 'svelte';
	
	// Local state for golden layout
	let layoutContainer: HTMLElement | null = $state(null);
	let goldenLayoutInstance: GoldenLayout | null = null;
	let resizeObserver: ResizeObserver | null = null;
	
	// Debug logging
	let debugLogs = $state<string[]>([]);
	const addDebugLog = (message: string) => {
		console.log(message);
		debugLogs = [...debugLogs.slice(-20), `${new Date().toISOString().slice(11,19)} - ${message}`];
	};
	
	onMount(() => { // Keep onMount synchronous
		console.log('=== +layout.svelte onMount START ===');
		let localGoldenLayoutInstance: GoldenLayout | null = null;
		let localResizeObserver: ResizeObserver | null = null;

		// Check if container exists and has dimensions
		if (!layoutContainer) {
			console.error('layoutContainer is null!');
			return;
		}
		
		const containerRect = layoutContainer.getBoundingClientRect();
		console.log('Layout container dimensions:', {
			width: containerRect.width,
			height: containerRect.height,
			element: layoutContainer
		});

		// Use an IIAFE for async operations within onMount
		// Move setContext outside the async block
		try {
			console.log('Creating GoldenLayout instance...');
			localGoldenLayoutInstance = new GoldenLayout(layoutContainer);
			goldenLayoutInstance = localGoldenLayoutInstance;
			console.log('GoldenLayout instance created successfully');
			
			setContext('layoutManager', localGoldenLayoutInstance); // MOVED HERE - Must be synchronous
			console.log('Context set for layoutManager');
			
			// Add GoldenLayout event listeners for debugging
			localGoldenLayoutInstance.on('initialised', () => {
				console.log('GoldenLayout: initialised event fired');
			});
			
			localGoldenLayoutInstance.on('itemCreated', (item: any) => {
				console.log('GoldenLayout: itemCreated event', item.type, item.componentType || 'N/A');
			});
			
			localGoldenLayoutInstance.on('itemDestroyed', (item: any) => {
				console.log('GoldenLayout: itemDestroyed event', item.type);
			});
			
		} catch (err) {
			console.error('Failed to create GoldenLayout instance:', err);
			return;
		}

		(async () => {
			console.log('=== Starting async initialization ===');
			addDebugLog('Starting async initialization');
			if (!layoutContainer) {
				console.error('layoutContainer became null in async block');
				return;
			}
			// GoldenLayout instance is already created synchronously above
			if (!localGoldenLayoutInstance) {
				console.error('localGoldenLayoutInstance is null in async block');
				return;
			}

			// Tauri v2 no longer uses window.__TAURI__ global
			// API is available through ES module imports from '@tauri-apps/api'

			// --- Setup Log Listener --- 
			// Commented out - logListener doesn't exist yet
			// try {
			// 	await setupLogListener(); // Call the setup function
			// 	addDebugLog('Log listener setup complete');
			// } catch (err) {
			// 	console.error('Failed to setup log listener:', err);
			// 	addDebugLog('Failed to setup log listener: ' + err);
			// }
			// --------------------------
			
			// --- Initialize GPU Render Loop ---
			try {
				console.log('Initializing GPU render loop...');
				addDebugLog('Initializing GPU render loop...');
				await coreApi.init_render_loop();
				await coreApi.create_offscreen_render_target(512, 512);
				console.log('GPU render loop initialized successfully');
				addDebugLog('GPU render loop initialized successfully');
			} catch (err) {
				console.error('Failed to initialize GPU render loop:', err);
				addDebugLog('[ERROR] Failed to initialize GPU: ' + err);
				// Continue anyway - some features may not work
			}
			// ----------------------------------

			// --- Register Components using the Helper ---
			console.log('=== Registering GoldenLayout components ===');
			addDebugLog('Registering GoldenLayout components...');
			// Use PlaceholderPanel temporarily for all component types
			// This will be replaced with actual components when they're ready
			try {
				glRegister(localGoldenLayoutInstance, 'tree-browser', MountableTreeBrowser);
				glRegister(localGoldenLayoutInstance, 'volume-view', VolumeView);
				glRegister(localGoldenLayoutInstance, 'surface-view', PlaceholderPanel);
				glRegister(localGoldenLayoutInstance, 'layer-panel', LayerPanel);
				glRegister(localGoldenLayoutInstance, 'layer-controls', PlaceholderPanel); // LayerControls);
				glRegister(localGoldenLayoutInstance, 'legend-drawer', PlaceholderPanel);
				glRegister(localGoldenLayoutInstance, 'plot-panel', PlaceholderPanel);
				console.log('=== All components registered ===');
				addDebugLog('All components registered successfully');
			} catch (err) {
				console.error('Failed to register components:', err);
				addDebugLog('[ERROR] Failed to register components: ' + err);
			}
			// ---------------------------------------------

			// --- Load Layout --- 
			console.log('=== Loading layout configuration ===');
			let loadedConfig: LayoutConfig | undefined = undefined;
			try {
				// TODO: Replace with actual API call when available
				// const config = await coreApi.loadConfig(); // e.g., load from backend/localStorage
				// loadedConfig = config?.glLayout;
				console.warn('Layout loading from Core API not implemented yet.');
				await Promise.resolve(); // Placeholder for async operation
			} catch (error) {
				console.error('Failed to load layout configuration:', error);
			}
			
			// Test with a minimal layout first
			const minimalLayout: LayoutConfig = {
				root: {
					type: 'row',
					content: [
						{
							type: 'component',
							componentType: 'tree-browser',
							title: 'Test Component'
						}
					]
				}
			};
			
			console.log('Using minimal test layout:', minimalLayout);
			// console.log('Using default layout:', defaultLayout);
			
			// Add a small delay to ensure components are fully registered
			await new Promise(resolve => setTimeout(resolve, 100));
			console.log('Delay complete, loading layout...');
			
			try {
				// localGoldenLayoutInstance.loadLayout(loadedConfig ?? defaultLayout);
				localGoldenLayoutInstance.loadLayout(minimalLayout);
				console.log('Layout loaded successfully');
			} catch (err) {
				console.error('Failed to load layout:', err);
			}
			// -------------------

			// --- Add State Change Listener for Saving ---
			localGoldenLayoutInstance.on('stateChanged', () => {
				if (localGoldenLayoutInstance) {
					const currentLayout = localGoldenLayoutInstance.saveLayout();
					debouncedSaveLayout(currentLayout);
				}
			});
			// ---------------------------------------------

			// Setup ResizeObserver to update resizeBus store
			localResizeObserver = new ResizeObserver(entries => {
				for (let entry of entries) {
					const { width, height } = entry.contentRect;
					// Call the setter from the new resizeBus store
					setResizeBusDimensions(width, height); 
					localGoldenLayoutInstance?.updateSize(width, height); 
				}
			});
			localResizeObserver.observe(layoutContainer);
			resizeObserver = localResizeObserver;

			// Initial dimension set - Use the new setter
			const { width, height } = layoutContainer.getBoundingClientRect();
			setResizeBusDimensions(width, height); 
			
			console.log('=== Async initialization complete ===');
			console.log('GoldenLayout instance state:', {
				isInitialised: localGoldenLayoutInstance.isInitialised,
				root: localGoldenLayoutInstance.root
			});

		})(); // End of IIAFE

		// Synchronous return with cleanup function
		return () => {
			resizeObserver?.disconnect();
			goldenLayoutInstance?.destroy();
			goldenLayoutInstance = null;
			resizeObserver = null;
		};
	});

	// onDestroy is handled by the onMount return function

</script>

<!-- Static HTML to verify page loads -->
<div style="position: fixed; top: 0; right: 0; background: lime; color: black; padding: 20px; z-index: 10000;">
	STATIC HTML - Page Loaded
</div>

<div class="app-container">
	<!-- Debug console output panel -->
	<div style="position: fixed; top: 10px; left: 10px; max-width: 600px; max-height: 400px; overflow-y: auto; background: rgba(0,0,0,0.9); color: white; padding: 10px; z-index: 9999; font-family: monospace; font-size: 12px; border: 2px solid red;">
		<div style="color: yellow; font-weight: bold; margin-bottom: 10px;">DEBUG CONSOLE OUTPUT:</div>
		{#each debugLogs as log}
			<div style="margin: 2px 0; {log.startsWith('[ERROR]') ? 'color: #ff6666;' : log.startsWith('[WARN]') ? 'color: #ffff66;' : 'color: #66ff66;'}">
				{log}
			</div>
		{/each}
		{#if debugLogs.length === 0}
			<div style="color: #999;">No logs yet...</div>
		{/if}
	</div>
	
	<div class="layout-wrapper" bind:this={layoutContainer}>
		<!-- GoldenLayout will render here -->
		<!-- The main page content ($children) will typically be rendered *inside* 
			 one of the GoldenLayout panels in a real app, not here directly. -->
		<!-- For now, keep the slot for SvelteKit routing to work -->
		<div style="display: none;">
			{@render children()}
		</div>
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
	}

	.layout-wrapper {
		flex: 1;
		overflow: hidden; /* Prevent scrollbars on the wrapper */
	}

	/* Ensure GoldenLayout takes full space */
	:global(.lm_root) {
		width: 100%;
		height: 100%;
	}

	/* Basic styling for placeholder */
	:global(.lm_content h2) {
		margin-top: 0;
		font-size: 1.1em;
	}
</style>
