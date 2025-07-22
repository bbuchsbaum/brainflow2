<script lang="ts">
	import { onMount } from 'svelte';
	import { GoldenLayout } from 'golden-layout';

	let container: HTMLElement;
	let layoutInstance: GoldenLayout | null = null;
	let error: string | null = null;

	onMount(() => {
		// Wait a tick for the container to be ready
		setTimeout(() => {
			try {
				console.log('Container:', container);
				console.log('Container dimensions:', {
					width: container.offsetWidth,
					height: container.offsetHeight
				});

				// Create a minimal layout config
				const config = {
					root: {
						type: 'row',
						content: [
							{
								type: 'component',
								componentType: 'test',
								title: 'Test Component'
							}
						]
					}
				};

				// Initialize Golden Layout
				layoutInstance = new GoldenLayout(container);

				// Register a simple test component
				layoutInstance.registerComponentFactoryFunction('test', (container) => {
					const div = document.createElement('div');
					div.innerHTML = '<h2>Test Component Works!</h2><p>Golden Layout is functioning.</p>';
					div.style.padding = '20px';
					div.style.color = 'white';
					container.element.appendChild(div);
				});

				// Load the layout
				layoutInstance.loadLayout(config);

				console.log('✅ Golden Layout initialized successfully!');
			} catch (err) {
				error = `Error: ${err.message}`;
				console.error('Failed to initialize:', err);
			}
		}, 100);

		return () => {
			if (layoutInstance) {
				layoutInstance.destroy();
			}
		};
	});
</script>

<div class="test-container" bind:this={container}>
	{#if error}
		<div class="error">{error}</div>
	{/if}
</div>

<style>
	.test-container {
		width: 100%;
		height: 600px;
		position: relative;
		background: #1a1a1a;
		border: 2px solid #444;
	}

	.error {
		color: red;
		padding: 20px;
	}

	:global(.lm_root) {
		position: absolute;
		top: 0;
		left: 0;
		width: 100%;
		height: 100%;
	}
</style>
