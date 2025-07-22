<script lang="ts">
	console.log('=== +layout.minimal.svelte starting ===');
	
	// Initialize validated config before anything else
	import { loadAndValidateConfig } from '$lib/validation/schemas/Config';
	const validatedConfig = loadAndValidateConfig();
	(globalThis as any).__BRAINFLOW_VALIDATED_CONFIG__ = validatedConfig;
	console.log('Validated config initialized:', validatedConfig);
	
	let { children } = $props();
</script>

<div style="background: #1a1a1a; color: white; padding: 20px; min-height: 100vh;">
	<h1>Brainflow App - Minimal Layout</h1>
	<p>If you can see this, the app is loading!</p>
	<p>Config initialized: {JSON.stringify(validatedConfig, null, 2)}</p>
	{@render children()}
</div>