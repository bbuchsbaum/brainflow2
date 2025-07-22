<!-- Plugin System Test Page -->
<script lang="ts">
	import { onMount } from 'svelte';
	import { testPluginSystem } from '$lib/plugins/test-plugin-system';

	let testResults: string[] = [];
	let isRunning = false;
	let testPassed = false;

	const addResult = (message: string) => {
		testResults = [...testResults, message];
	};

	const runTests = async () => {
		isRunning = true;
		testResults = [];
		testPassed = false;

		// Override console methods to capture output
		const originalLog = console.log;
		const originalError = console.error;

		console.log = (...args) => {
			addResult(args.join(' '));
			originalLog(...args);
		};

		console.error = (...args) => {
			addResult(`❌ ERROR: ${args.join(' ')}`);
			originalError(...args);
		};

		try {
			testPassed = await testPluginSystem();

			if (testPassed) {
				addResult('🎉 All plugin system tests completed successfully!');
			} else {
				addResult('❌ Some plugin system tests failed.');
			}
		} catch (error) {
			addResult(`❌ Test execution failed: ${error}`);
		} finally {
			// Restore console methods
			console.log = originalLog;
			console.error = originalError;
			isRunning = false;
		}
	};

	onMount(() => {
		// Auto-run tests on page load
		runTests();
	});
</script>

<div class="container mx-auto max-w-4xl p-6">
	<h1 class="mb-6 text-3xl font-bold">Plugin System Test</h1>

	<div class="mb-6">
		<p class="mb-4 text-gray-600">
			This page tests the Brainflow plugin system to ensure all components are working correctly.
		</p>

		<button
			on:click={runTests}
			disabled={isRunning}
			class="rounded bg-blue-500 px-4 py-2 text-white hover:bg-blue-600 disabled:bg-gray-400"
		>
			{isRunning ? 'Running Tests...' : 'Run Plugin Tests'}
		</button>
	</div>

	<div class="mb-6 rounded-lg bg-gray-50 p-4">
		<h2 class="mb-4 text-xl font-semibold">Test Results</h2>

		{#if testResults.length === 0}
			<p class="text-gray-500">No test results yet. Click "Run Plugin Tests" to start.</p>
		{:else}
			<div class="space-y-2">
				{#each testResults as result}
					<div
						class="font-mono text-sm {result.includes('❌')
							? 'text-red-600'
							: result.includes('✅')
								? 'text-green-600'
								: result.includes('🎉')
									? 'text-blue-600'
									: 'text-gray-700'}"
					>
						{result}
					</div>
				{/each}
			</div>
		{/if}
	</div>

	{#if !isRunning && testResults.length > 0}
		<div
			class="mt-6 rounded-lg p-4 {testPassed
				? 'border-green-400 bg-green-100'
				: 'border-red-400 bg-red-100'} border"
		>
			<h3 class="font-semibold {testPassed ? 'text-green-800' : 'text-red-800'}">
				{testPassed ? '✅ Plugin System Test Passed' : '❌ Plugin System Test Failed'}
			</h3>
			<p class="mt-2 {testPassed ? 'text-green-700' : 'text-red-700'}">
				{testPassed
					? 'The plugin system is working correctly and ready for use!'
					: 'There are issues with the plugin system that need to be addressed.'}
			</p>
		</div>
	{/if}

	<div class="mt-8 rounded-lg bg-blue-50 p-4">
		<h3 class="mb-2 text-lg font-semibold">Plugin System Features Tested</h3>
		<ul class="list-inside list-disc space-y-1 text-sm">
			<li>Plugin Manager initialization</li>
			<li>Plugin Loader functionality</li>
			<li>Plugin Validator manifest validation</li>
			<li>Plugin lifecycle management (init/cleanup)</li>
			<li>Plugin method execution</li>
			<li>Resource management</li>
			<li>Event system integration</li>
			<li>Security and permissions</li>
		</ul>
	</div>

	<div class="mt-6 rounded-lg bg-gray-50 p-4">
		<h3 class="mb-2 text-lg font-semibold">Next Steps</h3>
		<ul class="list-inside list-disc space-y-1 text-sm">
			<li>Load actual plugin files from the plugin directory</li>
			<li>Test plugin hot reloading in development mode</li>
			<li>Verify inter-plugin communication via message bus</li>
			<li>Test resource limit enforcement</li>
			<li>Test plugin performance monitoring</li>
			<li>Create example plugins for each supported type</li>
		</ul>
	</div>
</div>

<style>
	.container {
		font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
	}
</style>
