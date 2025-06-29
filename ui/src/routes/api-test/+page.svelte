<script lang="ts">
	import { onMount } from 'svelte';
	import { browser } from '$app/environment';
	import { waitForTauri } from '$lib/tauri-ready';
	
	interface TestResult {
		name: string;
		status: 'pending' | 'running' | 'success' | 'error';
		message?: string;
		error?: any;
		duration?: number;
	}
	
	let tests: TestResult[] = [
		{ name: 'Import Tauri API Module', status: 'pending' },
		{ name: 'Check Legacy window.__TAURI__', status: 'pending' },
		{ name: 'List Directory', status: 'pending' },
		{ name: 'Load Test File', status: 'pending' },
		{ name: 'Initialize Render Loop', status: 'pending' },
		{ name: 'Create Offscreen Render Target', status: 'pending' }
	];
	
	let overallStatus = 'Not started';
	let apiModule: any = null;
	
	async function runTest(index: number, testFn: () => Promise<void>) {
		const startTime = Date.now();
		tests[index].status = 'running';
		tests = tests;
		
		try {
			await testFn();
			tests[index].status = 'success';
			tests[index].duration = Date.now() - startTime;
		} catch (e) {
			tests[index].status = 'error';
			tests[index].error = e;
			tests[index].message = e?.message || String(e);
			tests[index].duration = Date.now() - startTime;
			console.error(`Test "${tests[index].name}" failed:`, e);
		}
		tests = tests;
	}
	
	async function runAllTests() {
		if (!browser) {
			overallStatus = 'Not in browser environment';
			return;
		}
		
		overallStatus = 'Running tests...';
		console.log('=== Starting Tauri API Test Suite ===');
		
		// First wait for Tauri to be ready
		try {
			await waitForTauri();
			console.log('✅ Tauri is ready');
		} catch (error) {
			overallStatus = 'Failed to initialize Tauri';
			console.error('❌ Failed to initialize Tauri:', error);
			return;
		}
		
		// Test 1: Import Tauri API
		await runTest(0, async () => {
			const module = await import('@tauri-apps/api/core');
			apiModule = module;
			console.log('✅ Tauri API module loaded:', module);
		});
		
		// Test 2: Check legacy global
		await runTest(1, async () => {
			const hasLegacyGlobal = 'window' in globalThis && '__TAURI__' in window;
			tests[1].message = `window.__TAURI__ is ${hasLegacyGlobal ? 'defined' : 'undefined'} (expected: undefined in Tauri v2)`;
			console.log('✅ Legacy global check:', tests[1].message);
		});
		
		// Test 3: List directory
		await runTest(2, async () => {
			if (!apiModule) throw new Error('API module not loaded');
			const result = await apiModule.invoke('plugin:api-bridge|fs_list_directory', { 
				path_str: '/Users/bbuchsbaum/code/brainflow2/test-data' 
			});
			tests[2].message = `Found ${result?.nodes?.length || 0} items`;
			console.log('✅ Directory listing result:', result);
		});
		
		// Test 4: Load a test file
		await runTest(3, async () => {
			if (!apiModule) throw new Error('API module not loaded');
			const result = await apiModule.invoke('plugin:api-bridge|load_file', { 
				path_str: '/Users/bbuchsbaum/code/brainflow2/test-data/unit/toy_t1w.nii.gz' 
			});
			tests[3].message = `Loaded volume: ${result.name} (${result.id})`;
			console.log('✅ Load file result:', result);
		});
		
		// Test 5: Initialize render loop
		await runTest(4, async () => {
			if (!apiModule) throw new Error('API module not loaded');
			await apiModule.invoke('plugin:api-bridge|init_render_loop');
			tests[4].message = 'Render loop initialized';
			console.log('✅ Render loop initialized');
		});
		
		// Test 6: Create offscreen render target
		await runTest(5, async () => {
			if (!apiModule) throw new Error('API module not loaded');
			await apiModule.invoke('plugin:api-bridge|create_offscreen_render_target', {
				width: 800,
				height: 600
			});
			tests[5].message = 'Created 800x600 render target';
			console.log('✅ Offscreen render target created');
		});
		
		// Calculate summary
		const successCount = tests.filter(t => t.status === 'success').length;
		const errorCount = tests.filter(t => t.status === 'error').length;
		const totalDuration = tests.reduce((sum, t) => sum + (t.duration || 0), 0);
		
		overallStatus = `Completed: ${successCount}/${tests.length} passed, ${errorCount} failed (${totalDuration}ms)`;
		console.log('=== Test Suite Complete ===');
		console.log(overallStatus);
		
		// Auto-copy results to clipboard for easy sharing
		const results = {
			summary: overallStatus,
			tests: tests.map(t => ({
				name: t.name,
				status: t.status,
				message: t.message,
				error: t.error ? String(t.error) : undefined,
				duration: t.duration
			}))
		};
		
		try {
			await navigator.clipboard.writeText(JSON.stringify(results, null, 2));
			console.log('Results copied to clipboard!');
		} catch (e) {
			console.log('Could not copy to clipboard:', e);
		}
	}
	
	onMount(() => {
		// Auto-run tests after a short delay
		setTimeout(runAllTests, 500);
	});
</script>

<div class="p-8 max-w-4xl mx-auto">
	<h1 class="text-3xl font-bold mb-4">Tauri API Automated Test Suite</h1>
	
	<div class="mb-6 p-4 bg-gray-100 rounded">
		<p class="text-lg font-semibold">{overallStatus}</p>
	</div>
	
	<div class="space-y-2 mb-6">
		{#each tests as test}
			<div class="flex items-center p-3 border rounded {
				test.status === 'success' ? 'bg-green-50 border-green-300' :
				test.status === 'error' ? 'bg-red-50 border-red-300' :
				test.status === 'running' ? 'bg-blue-50 border-blue-300' :
				'bg-gray-50 border-gray-300'
			}">
				<span class="mr-3 text-2xl">
					{#if test.status === 'success'}
						✅
					{:else if test.status === 'error'}
						❌
					{:else if test.status === 'running'}
						⏳
					{:else}
						⏸️
					{/if}
				</span>
				<div class="flex-1">
					<p class="font-semibold">{test.name}</p>
					{#if test.message}
						<p class="text-sm text-gray-600">{test.message}</p>
					{/if}
					{#if test.error}
						<pre class="text-xs text-red-600 mt-1 whitespace-pre-wrap">{test.error}</pre>
					{/if}
				</div>
				{#if test.duration}
					<span class="text-sm text-gray-500 ml-4">{test.duration}ms</span>
				{/if}
			</div>
		{/each}
	</div>
	
	<button 
		onclick={runAllTests}
		class="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600"
	>
		Run Tests Again
	</button>
	
	<div class="mt-8 p-4 bg-yellow-50 border border-yellow-200 rounded">
		<p class="text-sm">
			<strong>Note:</strong> Tests run automatically on page load. Results are copied to clipboard.
			Open browser console for detailed logs.
		</p>
	</div>
</div>