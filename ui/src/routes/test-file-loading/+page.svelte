<script lang="ts">
	import { onMount } from 'svelte';
	import MountableTreeBrowser from '$lib/components/MountableTreeBrowser.svelte';
	import VolumeView from '$lib/components/views/VolumeView.svelte';
	
	let logs = $state<string[]>([]);
	
	// Override console.log to capture logs
	onMount(() => {
		const originalLog = console.log;
		console.log = (...args: any[]) => {
			originalLog(...args);
			logs = [...logs, args.map(arg => 
				typeof arg === 'object' ? JSON.stringify(arg, null, 2) : String(arg)
			).join(' ')];
			// Keep only last 50 logs
			if (logs.length > 50) {
				logs = logs.slice(-50);
			}
		};
		
		return () => {
			console.log = originalLog;
		};
	});
</script>

<div class="test-container">
	<div class="panel file-browser">
		<h2>File Browser</h2>
		<MountableTreeBrowser />
	</div>
	
	<div class="panel volume-view">
		<h2>Volume View</h2>
		<VolumeView />
	</div>
	
	<div class="panel logs">
		<h2>Console Logs</h2>
		<div class="log-viewer">
			{#each logs as log}
				<pre>{log}</pre>
			{/each}
		</div>
	</div>
</div>

<style>
	.test-container {
		display: grid;
		grid-template-columns: 1fr 2fr;
		grid-template-rows: 1fr 1fr;
		gap: 1rem;
		height: 100vh;
		padding: 1rem;
		background: #1a1a1a;
		color: #e0e0e0;
	}
	
	.panel {
		border: 1px solid #333;
		border-radius: 8px;
		overflow: hidden;
		display: flex;
		flex-direction: column;
		background: #222;
	}
	
	.panel h2 {
		margin: 0;
		padding: 0.5rem 1rem;
		background: #333;
		border-bottom: 1px solid #444;
		font-size: 1rem;
	}
	
	.file-browser {
		grid-row: span 2;
	}
	
	.logs {
		grid-column: 2;
		grid-row: 2;
	}
	
	.log-viewer {
		flex: 1;
		overflow-y: auto;
		padding: 0.5rem;
		font-family: 'Monaco', 'Consolas', monospace;
		font-size: 0.8rem;
		line-height: 1.4;
	}
	
	.log-viewer pre {
		margin: 0 0 0.25rem 0;
		padding: 0.25rem;
		background: #2a2a2a;
		border-radius: 3px;
		white-space: pre-wrap;
		word-break: break-all;
	}
</style>