<script lang="ts">
	import { onMount } from 'svelte';
	import { coreApi } from '$lib/api';

	// State
	let isLoading = $state(false);
	let error = $state<Error | null>(null);
	let outputPath = $state<string | null>(null);
	let progress = $state('');

	// Volume path - relative to Tauri app root
	const volumePath = 'test-data/unit/tpl-MNI152NLin2009cAsym_res-01_desc-brain_T1w.nii';

	// Trigger the backend test
	async function runBackendTest() {
		try {
			isLoading = true;
			error = null;
			progress = 'Calling backend orthogonal slice test...';

			console.log('[Backend Test] Starting test with volume:', volumePath);
			
			// Call the backend command
			const result = await coreApi.generate_orthogonal_slice_test(volumePath);
			
			console.log('[Backend Test] Test completed. Output:', result);
			outputPath = result;
			progress = 'Test completed successfully!';
		} catch (err) {
			console.error('[Backend Test] Failed:', err);
			error = err instanceof Error ? err : new Error('Backend test failed');
			progress = '';
		} finally {
			isLoading = false;
		}
	}

	onMount(() => {
		console.log('[Backend Test] Component mounted');
	});
</script>

<div class="container">
	<h1>Orthogonal Slice Test - Backend Only</h1>
	
	<div class="description">
		<p>This test runs entirely in the Rust backend, generating PNG images and an HTML report directly to disk.</p>
		<p>Volume: <code>{volumePath}</code></p>
	</div>

	<div class="controls">
		<button 
			onclick={() => runBackendTest()} 
			disabled={isLoading}
			class="run-button"
		>
			{isLoading ? 'Running...' : 'Run Backend Test'}
		</button>
	</div>

	{#if progress}
		<div class="progress">
			<p>{progress}</p>
		</div>
	{/if}

	{#if error}
		<div class="error">
			<h2>Error</h2>
			<p>{error.message}</p>
			<details>
				<summary>Details</summary>
				<pre>{error.stack}</pre>
			</details>
		</div>
	{/if}

	{#if outputPath}
		<div class="success">
			<h2>Test Completed!</h2>
			<p>Output directory: <code>{outputPath}</code></p>
			<p>Open the following file in your browser to view the results:</p>
			<p><code>{outputPath}/orthogonal_slice_test.html</code></p>
			
			<div class="note">
				<p><strong>Note:</strong> The files have been saved to your local filesystem.</p>
				<p>Navigate to the output directory to find:</p>
				<ul>
					<li>30 PNG images (10 coordinates × 3 views)</li>
					<li>orthogonal_slice_test.html - Complete report</li>
				</ul>
			</div>
		</div>
	{/if}
</div>

<style>
	.container {
		max-width: 800px;
		margin: 0 auto;
		padding: 20px;
		font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
	}

	h1 {
		color: #333;
		margin-bottom: 20px;
	}

	.description {
		background: #f8f8f8;
		padding: 15px;
		border-radius: 8px;
		margin-bottom: 20px;
	}

	.description code {
		background: #e0e0e0;
		padding: 2px 4px;
		border-radius: 3px;
		font-family: 'SF Mono', Monaco, monospace;
		font-size: 0.9em;
	}

	.controls {
		margin-bottom: 30px;
	}

	.run-button {
		padding: 12px 24px;
		background: #0066cc;
		color: white;
		border: none;
		border-radius: 6px;
		font-size: 16px;
		cursor: pointer;
		transition: background 0.2s;
	}

	.run-button:hover:not(:disabled) {
		background: #0052a3;
	}

	.run-button:disabled {
		background: #999;
		cursor: not-allowed;
	}

	.progress {
		background: #e8f4f8;
		padding: 15px;
		border-radius: 8px;
		margin-bottom: 20px;
		color: #0066cc;
	}

	.error {
		background: #fee;
		border: 1px solid #fcc;
		padding: 20px;
		border-radius: 8px;
		color: #c00;
		margin-bottom: 20px;
	}

	.error h2 {
		margin-top: 0;
		color: #c00;
	}

	.error details {
		margin-top: 10px;
	}

	.error pre {
		background: #fff;
		padding: 10px;
		border-radius: 4px;
		overflow-x: auto;
		font-size: 12px;
		margin: 5px 0 0 0;
	}

	.success {
		background: #efe;
		border: 1px solid #cfc;
		padding: 20px;
		border-radius: 8px;
		color: #060;
		margin-bottom: 20px;
	}

	.success h2 {
		margin-top: 0;
		color: #060;
	}

	.success code {
		background: #dfd;
		padding: 2px 4px;
		border-radius: 3px;
		font-family: 'SF Mono', Monaco, monospace;
		font-size: 0.9em;
		color: #040;
	}

	.note {
		margin-top: 20px;
		padding: 15px;
		background: #f0faf0;
		border-radius: 6px;
		font-size: 14px;
	}

	.note ul {
		margin: 10px 0 0 20px;
		padding: 0;
	}

	.note li {
		margin: 5px 0;
	}
</style>