<script lang="ts">
	import { onMount } from 'svelte';
	import { coreApi } from '$lib/api';
	import type { VolumeHandleInfo } from '@brainflow/api';

	let status = $state('Not started');
	let error = $state<string | null>(null);
	let volumeInfo = $state<VolumeHandleInfo | null>(null);
	let canvasElement = $state<HTMLCanvasElement>();

	async function runGPUTest() {
		try {
			status = 'Initializing render loop...';
			await coreApi.init_render_loop();
			
			status = 'Loading test volume...';
			const testPath = '/Users/bbuchsbaum/code/brainflow2/test-data/unit/toy_t1w.nii.gz';
			volumeInfo = await coreApi.load_file(testPath);
			console.log('Volume loaded:', volumeInfo);
			
			status = 'Creating offscreen render target...';
			await coreApi.create_offscreen_render_target(256, 256);
			
			status = 'Setting up view parameters...';
			// Use the simplified API
			await coreApi.update_frame_for_synchronized_view(
				256.0, // view width in mm
				256.0, // view height in mm
				[5, 5, 5], // center of 10x10x10 volume
				2 // Axial view
			);
			
			status = 'Rendering frame...';
			await coreApi.render_frame();
			
			status = 'Getting rendered image...';
			const imageDataUrl = await coreApi.render_to_image();
			
			status = 'Displaying image...';
			if (canvasElement) {
				const ctx = canvasElement.getContext('2d');
				if (ctx && imageDataUrl.startsWith('data:image/raw-rgba;base64,')) {
					const base64Data = imageDataUrl.substring('data:image/raw-rgba;base64,'.length);
					const binaryData = atob(base64Data);
					const bytes = new Uint8Array(binaryData.length);
					for (let i = 0; i < binaryData.length; i++) {
						bytes[i] = binaryData.charCodeAt(i);
					}
					
					const imageData = new ImageData(new Uint8ClampedArray(bytes.buffer), 256, 256);
					ctx.putImageData(imageData, 0, 0);
					
					status = 'Test completed successfully!';
				} else {
					throw new Error('Invalid image data format');
				}
			}
		} catch (err) {
			error = `Test failed: ${err}`;
			status = 'Test failed';
			console.error('GPU test error:', err);
		}
	}

	onMount(() => {
		if (canvasElement) {
			canvasElement.width = 256;
			canvasElement.height = 256;
		}
	});
</script>

<div class="test-page">
	<h1>GPU Rendering Test</h1>
	
	<div class="controls">
		<button onclick={runGPUTest}>Run GPU Test</button>
		<div class="status">Status: {status}</div>
		{#if error}
			<div class="error">{error}</div>
		{/if}
		{#if volumeInfo}
			<div class="info">
				Volume loaded: {volumeInfo.dims[0]}×{volumeInfo.dims[1]}×{volumeInfo.dims[2]} ({volumeInfo.dtype})
			</div>
		{/if}
	</div>
	
	<div class="canvas-container">
		<canvas bind:this={canvasElement} class="test-canvas"></canvas>
	</div>
</div>

<style>
	.test-page {
		padding: 2rem;
		max-width: 800px;
		margin: 0 auto;
	}

	h1 {
		margin-bottom: 2rem;
	}

	.controls {
		margin-bottom: 2rem;
	}

	button {
		padding: 0.5rem 1rem;
		background-color: #4dabf7;
		color: white;
		border: none;
		border-radius: 4px;
		cursor: pointer;
		font-size: 16px;
		margin-bottom: 1rem;
		display: block;
	}

	button:hover {
		background-color: #339af0;
	}

	.status {
		margin: 1rem 0;
		font-weight: bold;
	}

	.error {
		color: #c92a2a;
		margin: 1rem 0;
		padding: 1rem;
		background-color: #ffe0e0;
		border-radius: 4px;
	}

	.info {
		margin: 1rem 0;
		color: #495057;
	}

	.canvas-container {
		border: 2px solid #dee2e6;
		display: inline-block;
		background-color: #000;
	}

	.test-canvas {
		display: block;
		image-rendering: pixelated;
	}
</style>