<script lang="ts">
	console.log('=== +layout.simple.svelte starting ===');
	
	// Initialize validated config before anything else
	import { loadAndValidateConfig } from '$lib/validation/schemas/Config';
	const validatedConfig = loadAndValidateConfig();
	(globalThis as any).__BRAINFLOW_VALIDATED_CONFIG__ = validatedConfig;
	console.log('Validated config initialized:', validatedConfig);
	
	let { children } = $props();
	
	import { onMount } from 'svelte';
	import StatusBar from '$lib/components/StatusBar.svelte';
	
	onMount(() => {
		console.log('Simple layout mounted');
	});
</script>

<div class="app-container">
	<div class="content">
		<h1>Brainflow App - Simple Layout</h1>
		<p>If you can see this, the app is loading!</p>
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
	
	.content {
		flex: 1;
		padding: 20px;
		overflow: auto;
	}
	
	h1 {
		margin: 0 0 10px 0;
	}
</style>