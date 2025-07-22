<script lang="ts">
	console.log('=== +layout.super-simple.svelte starting ===');
	
	// Initialize validated config before anything else
	import { loadAndValidateConfig } from '$lib/validation/schemas/Config';
	const validatedConfig = loadAndValidateConfig();
	(globalThis as any).__BRAINFLOW_VALIDATED_CONFIG__ = validatedConfig;
	console.log('Validated config initialized:', validatedConfig);
	
	let { children } = $props();
	
	import { onMount } from 'svelte';
	
	let mounted = false;
	let error: string | null = null;
	
	onMount(() => {
		console.log('Super simple layout mounted');
		mounted = true;
		
		// Try to import and initialize API
		(async () => {
			try {
				const { coreApi } = await import('$lib/api');
				console.log('API imported successfully');
				
				await coreApi.init_render_loop();
				console.log('Render loop initialized');
			} catch (err) {
				console.error('Error in onMount:', err);
				error = String(err);
			}
		})();
	});
</script>

<div style="background: #1a1a1a; color: white; min-height: 100vh; padding: 20px;">
	<h1>Brainflow - Super Simple Layout</h1>
	<p>Config loaded: ✓</p>
	<p>Mounted: {mounted ? '✓' : '✗'}</p>
	
	{#if error}
		<div style="background: red; color: white; padding: 10px; margin: 10px 0;">
			Error: {error}
		</div>
	{/if}
	
	<div style="margin-top: 20px;">
		<h2>Debug Info:</h2>
		<pre style="background: #2a2a2a; padding: 10px; overflow: auto;">
Config: {JSON.stringify(validatedConfig, null, 2)}
		</pre>
	</div>
	
	<div style="margin-top: 20px; padding: 20px; background: #2a2a2a;">
		<h3>Main Content Area</h3>
		<p>If you can see this, the layout is working!</p>
		{@render children()}
	</div>
</div>