<!--
  Test Orthogonal Slice Generation
  Simple route to test the backend orthogonal slice generation functionality
-->
<script lang="ts">
	import { onMount } from 'svelte';
	import { coreApi } from '$lib/api';
	
	let testResult = $state<string>('Not started');
	let error = $state<string | null>(null);
	let sliceImageUrl = $state<string | null>(null);
	
	async function runTest() {
		testResult = 'Running test...';
		error = null;
		sliceImageUrl = null;
		
		try {
			// Call the test command
			const result = await coreApi.generate_orthogonal_slice_test();
			
			if (result.success) {
				testResult = 'Test successful!';
				// Convert the slice data to an image URL
				if (result.slice_data) {
					const blob = new Blob([result.slice_data], { type: 'image/png' });
					sliceImageUrl = URL.createObjectURL(blob);
				}
			} else {
				testResult = 'Test failed';
				error = result.message || 'Unknown error';
			}
		} catch (err) {
			testResult = 'Test failed with error';
			error = err instanceof Error ? err.message : String(err);
		}
	}
	
	onMount(() => {
		// Clean up object URL on unmount
		return () => {
			if (sliceImageUrl) {
				URL.revokeObjectURL(sliceImageUrl);
			}
		};
	});
</script>

<div class="test-container">
	<h1>Test Backend Orthogonal Slice Generation</h1>
	
	<button onclick={runTest} disabled={testResult === 'Running test...'}>
		Run Test
	</button>
	
	<div class="status">
		<h2>Status: {testResult}</h2>
		{#if error}
			<div class="error">
				<h3>Error:</h3>
				<pre>{error}</pre>
			</div>
		{/if}
	</div>
	
	{#if sliceImageUrl}
		<div class="result">
			<h2>Generated Slice:</h2>
			<img src={sliceImageUrl} alt="Generated orthogonal slice" />
		</div>
	{/if}
</div>

<style>
	.test-container {
		padding: 2rem;
		max-width: 800px;
		margin: 0 auto;
	}
	
	button {
		padding: 0.5rem 1rem;
		font-size: 1rem;
		background-color: #3b82f6;
		color: white;
		border: none;
		border-radius: 4px;
		cursor: pointer;
	}
	
	button:hover:not(:disabled) {
		background-color: #2563eb;
	}
	
	button:disabled {
		background-color: #9ca3af;
		cursor: not-allowed;
	}
	
	.status {
		margin-top: 2rem;
	}
	
	.error {
		background-color: #fee;
		border: 1px solid #fcc;
		padding: 1rem;
		margin-top: 1rem;
		border-radius: 4px;
	}
	
	.error pre {
		margin: 0;
		font-family: monospace;
		font-size: 0.875rem;
	}
	
	.result {
		margin-top: 2rem;
	}
	
	.result img {
		max-width: 100%;
		border: 1px solid #ddd;
		border-radius: 4px;
	}
</style>