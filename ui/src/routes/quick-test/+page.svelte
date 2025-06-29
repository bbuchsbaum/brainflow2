<script>
	import { onMount } from 'svelte';
	
	onMount(async () => {
		console.log('=== Quick Tauri API Test ===');
		
		try {
			const { invoke } = await import('@tauri-apps/api/core');
			console.log('✅ API module loaded');
			
			// Quick test
			const result = await invoke('plugin:api-bridge|fs_list_directory', {
				path_str: '/Users/bbuchsbaum/code/brainflow2'
			});
			console.log('✅ API call successful!', result);
		} catch (e) {
			console.error('❌ Test failed:', e);
		}
	});
</script>

<h1>Check Console</h1>