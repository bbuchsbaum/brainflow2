<script lang="ts">
	import { onMount } from 'svelte';
	import { browser } from '$app/environment';
	
	let tauriStatus = 'Checking...';
	let apiTestResult = '';
	let directoryListing = '';
	
	onMount(async () => {
		if (!browser) {
			tauriStatus = 'Not in browser environment';
			return;
		}
		
		// Test 1: Check if we can import Tauri API
		try {
			const { invoke } = await import('@tauri-apps/api/core');
			tauriStatus = '✅ Tauri API module loaded successfully';
			
			// Test 2: Try to list a directory
			try {
				const result = await invoke('plugin:api-bridge|fs_list_directory', { 
					path_str: '/Users/bbuchsbaum/code/brainflow2/test-data' 
				});
				directoryListing = '✅ Directory listing successful';
				console.log('Directory listing result:', result);
			} catch (e) {
				directoryListing = `❌ Directory listing failed: ${e}`;
				console.error('Directory listing error:', e);
			}
			
			// Test 3: Check if window.__TAURI__ exists (it shouldn't in v2)
			apiTestResult = `window.__TAURI__ is ${window.__TAURI__ ? 'defined' : 'undefined'} (expected: undefined in Tauri v2)`;
			
		} catch (e) {
			tauriStatus = `❌ Failed to load Tauri API: ${e}`;
			console.error('Tauri import error:', e);
		}
	});
</script>

<div class="p-8">
	<h1 class="text-2xl font-bold mb-4">Tauri API Test</h1>
	
	<div class="space-y-4">
		<div>
			<h2 class="font-semibold">Tauri Module Status:</h2>
			<p class="text-gray-700">{tauriStatus}</p>
		</div>
		
		<div>
			<h2 class="font-semibold">Legacy Global Check:</h2>
			<p class="text-gray-700">{apiTestResult}</p>
		</div>
		
		<div>
			<h2 class="font-semibold">API Call Test:</h2>
			<p class="text-gray-700">{directoryListing}</p>
		</div>
		
		<div class="mt-8 p-4 bg-blue-100 rounded">
			<p class="text-sm">
				<strong>Note:</strong> In Tauri v2, the window.__TAURI__ global no longer exists. 
				The API is accessed through ES module imports from '@tauri-apps/api'.
			</p>
		</div>
	</div>
</div>