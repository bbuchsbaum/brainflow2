<script lang="ts">
	console.log('=== +layout.with-statusbar.svelte starting ===');
	
	// Initialize validated config before anything else
	import { loadAndValidateConfig } from '$lib/validation/schemas/Config';
	const validatedConfig = loadAndValidateConfig();
	(globalThis as any).__BRAINFLOW_VALIDATED_CONFIG__ = validatedConfig;
	console.log('Validated config initialized:', validatedConfig);
	
	let { children } = $props();
	
	import { onMount } from 'svelte';
	
	let statusBarError: string | null = null;
	let StatusBar: any = null;
	
	onMount(async () => {
		console.log('Layout with StatusBar mounting...');
		try {
			const module = await import('$lib/components/StatusBar.svelte');
			StatusBar = module.default;
			console.log('StatusBar imported successfully');
		} catch (err) {
			console.error('Failed to import StatusBar:', err);
			statusBarError = String(err);
		}
	});
</script>

<div style="display: flex; flex-direction: column; height: 100vh; background: #1a1a1a; color: white;">
	<div style="flex: 1; padding: 20px; overflow: auto;">
		<h1>Brainflow App - With StatusBar</h1>
		<p>Testing StatusBar component...</p>
		
		{#if statusBarError}
			<div style="background: #ff4444; color: white; padding: 10px; margin: 10px 0;">
				StatusBar Error: {statusBarError}
			</div>
		{/if}
		
		{@render children()}
	</div>
	
	{#if StatusBar && !statusBarError}
		<StatusBar />
	{:else}
		<div style="background: #2a2a2a; padding: 10px; text-align: center;">
			StatusBar loading...
		</div>
	{/if}
</div>