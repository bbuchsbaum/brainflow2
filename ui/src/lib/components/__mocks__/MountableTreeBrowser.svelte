<!-- Mock MountableTreeBrowser Component for Testing -->
<script lang="ts">
	import { onMount } from 'svelte';
	import { getEventBus } from '$lib/events/EventBus';

	// Props
	let {
		rootDirectory = '.',
		acceptedExtensions = []
	}: {
		rootDirectory?: string;
		acceptedExtensions?: string[];
	} = $props();

	const eventBus = getEventBus();

	onMount(() => {
		// Emit ready event to mimic real component
		setTimeout(() => {
			eventBus.emit('mountabletreebrowser.ready', {});
		}, 0);
	});

	// Handle file selection simulation for tests
	function handleTestFileSelection(file: any) {
		eventBus.emit('filebrowser.file.selected', { file });
	}

	// Expose method for tests to trigger file selection
	if (import.meta.env.TEST) {
		(window as any).__mockTreeBrowser = {
			selectFile: handleTestFileSelection
		};
	}
</script>

<div class="mock-tree-browser" data-testid="mock-tree-browser">
	<div class="mock-header">Mock Tree Browser</div>
	<div class="mock-content">
		<p>Root: {rootDirectory}</p>
		<p>Extensions: {acceptedExtensions.join(', ')}</p>
	</div>
</div>

<style>
	.mock-tree-browser {
		padding: 1rem;
		border: 1px dashed #ccc;
		background: #f5f5f5;
	}

	.mock-header {
		font-weight: bold;
		margin-bottom: 0.5rem;
	}

	.mock-content {
		font-size: 0.875rem;
		color: #666;
	}
</style>
