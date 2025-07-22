<script lang="ts">
	import { onMount } from 'svelte';
	import type { VolumeHandleInfo } from '@brainflow/api';

	// State
	let isLoading = $state(true);
	let error = $state<Error | null>(null);
	let volume = $state<VolumeHandleInfo | null>(null);
	let progress = $state('');
	let sliceImages = $state<Array<{ coord: [number, number, number]; images: { axial: string; sagittal: string; coronal: string } }>>([]);

	// Test coordinates - distributed throughout the volume
	const testCoordinates: Array<[number, number, number]> = [
		[0, 0, 0], // Origin
		[0, 0, 20], // Superior
		[0, 0, -40], // Inferior
		[30, 0, 0], // Right
		[-30, 0, 0], // Left
		[0, 40, 0], // Anterior
		[0, -40, 0], // Posterior
		[20, 20, 10], // Right-anterior-superior
		[-20, -20, -10], // Left-posterior-inferior
		[15, -25, 15] // Mixed position
	];

	// Direct API access without DI container
	async function getApi() {
		// Import the base API directly
		const { baseApi } = await import('$lib/api');
		return baseApi;
	}

	// Initialize GPU and load volume
	async function initialize() {
		try {
			console.log('[OrthogonalSliceTest] Starting initialization...');
			const api = await getApi();
			
			progress = 'Initializing GPU render loop...';
			console.log('[OrthogonalSliceTest] Initializing GPU...');
			
			// Add timeout to GPU initialization
			try {
				const initPromise = api.init_render_loop();
				const timeoutPromise = new Promise((_, reject) => 
					setTimeout(() => reject(new Error('GPU initialization timeout after 5 seconds')), 5000)
				);
				
				await Promise.race([initPromise, timeoutPromise]);
				console.log('[OrthogonalSliceTest] GPU initialized successfully');
			} catch (gpuError) {
				console.error('[OrthogonalSliceTest] GPU initialization failed:', gpuError);
				throw gpuError;
			}

			progress = 'Loading MNI152 template...';
			const volumePath = '../test-data/unit/tpl-MNI152NLin2009cAsym_res-01_desc-brain_T1w.nii';
			console.log('[OrthogonalSliceTest] Loading volume from:', volumePath);
			volume = await api.load_file(volumePath);
			console.log('[OrthogonalSliceTest] Loaded volume:', volume);

			progress = 'Requesting GPU resources...';
			const layerSpec = {
				Volume: {
					id: 'mni152-layer',
					source_resource_id: volume.handle_id,
					colormap: 'grayscale',
					intensity_range: [0, volume.native_range[1]],
					opacity: 1.0
				}
			};

			console.log('[OrthogonalSliceTest] Requesting GPU resources with spec:', layerSpec);
			const gpuInfo = await api.request_layer_gpu_resources(layerSpec);
			console.log('[OrthogonalSliceTest] GPU resources allocated:', gpuInfo);

			// Create offscreen render target
			const renderSize = 512;
			console.log('[OrthogonalSliceTest] Creating offscreen render target...');
			await api.create_offscreen_render_target(renderSize, renderSize);

			// Configure render layer
			await api.clear_render_layers();
			await api.add_render_layer(
				gpuInfo.texture_atlas_slot,
				1.0, // opacity
				[0, 0, 1, 1] // texture coords (full texture)
			);

			console.log('[OrthogonalSliceTest] Starting slice extraction...');
			// Extract slices at each coordinate
			for (let i = 0; i < testCoordinates.length; i++) {
				const coord = testCoordinates[i];
				progress = `Rendering slices at coordinate ${i + 1}/10: [${coord.join(', ')}]`;
				console.log(`[OrthogonalSliceTest] Processing coordinate ${i + 1}:`, coord);

				const images = {
					axial: await renderSlice(api, coord, 0, renderSize),
					coronal: await renderSlice(api, coord, 1, renderSize),
					sagittal: await renderSlice(api, coord, 2, renderSize)
				};

				sliceImages = [...sliceImages, { coord, images }];
			}

			progress = 'Complete! Scroll down to see all slices.';
			console.log('[OrthogonalSliceTest] All slices generated successfully!');
			isLoading = false;

			// Generate HTML output
			generateHTMLOutput();
		} catch (err) {
			console.error('[OrthogonalSliceTest] Failed to initialize:', err);
			error = err instanceof Error ? err : new Error('Failed to initialize');
			isLoading = false;
		}
	}

	// Render a single slice
	async function renderSlice(
		api: any,
		worldCoord: [number, number, number],
		planeId: 0 | 1 | 2,
		size: number
	): Promise<string> {
		// Set crosshair position
		await api.set_crosshair(worldCoord);

		// Update frame for the specific plane
		// Using a reasonable field of view (e.g., 240mm)
		const viewSizeMm = 240;
		await api.update_frame_for_synchronized_view(viewSizeMm, viewSizeMm, worldCoord, planeId);

		// Render frame
		await api.render_frame();

		// Get image as base64
		const base64Image = await api.render_to_image();
		return base64Image;
	}

	// Generate downloadable HTML
	function generateHTMLOutput() {
		const html = `<!DOCTYPE html>
<html>
<head>
    <title>Orthogonal Slice Test - MNI152 Template</title>
    <style>
        body {
            font-family: Arial, sans-serif;
            margin: 20px;
            background: #f0f0f0;
        }
        h1, h2 {
            color: #333;
        }
        .coordinate-section {
            background: white;
            padding: 20px;
            margin-bottom: 30px;
            border-radius: 8px;
            box-shadow: 0 2px 4px rgba(0,0,0,0.1);
        }
        .slices {
            display: grid;
            grid-template-columns: repeat(3, 1fr);
            gap: 20px;
            margin-top: 20px;
        }
        .slice {
            text-align: center;
        }
        .slice img {
            width: 100%;
            max-width: 400px;
            border: 1px solid #ddd;
            background: #000;
        }
        .slice h3 {
            margin: 10px 0;
            color: #555;
        }
        .info {
            background: #e8f4f8;
            padding: 10px;
            border-radius: 4px;
            margin-bottom: 20px;
            font-size: 14px;
        }
        .crosshair-info {
            color: #0066cc;
            font-weight: bold;
        }
    </style>
</head>
<body>
    <h1>Orthogonal Slice Test - MNI152 Template</h1>
    <div class="info">
        <p><strong>Volume:</strong> tpl-MNI152NLin2009cAsym_res-01_desc-brain_T1w.nii</p>
        <p><strong>Dimensions:</strong> ${volume ? `${volume.dims[0]} × ${volume.dims[1]} × ${volume.dims[2]}` : 'Unknown'}</p>
        <p><strong>Voxel Size:</strong> ${volume ? `${volume.voxel_size[0].toFixed(2)} × ${volume.voxel_size[1].toFixed(2)} × ${volume.voxel_size[2].toFixed(2)} mm` : 'Unknown'}</p>
        <p><strong>Orientation:</strong> RAS (Neurological convention)</p>
        <p class="crosshair-info">Green crosshairs indicate the exact world coordinate position on each slice.</p>
    </div>

    ${sliceImages
			.map(
				(item, index) => `
    <div class="coordinate-section">
        <h2>Coordinate ${index + 1}: [${item.coord.join(', ')}] mm</h2>
        <div class="slices">
            <div class="slice">
                <h3>Axial (z = ${item.coord[2]} mm)</h3>
                <img src="${item.images.axial}" alt="Axial slice at ${item.coord[2]}mm">
            </div>
            <div class="slice">
                <h3>Sagittal (x = ${item.coord[0]} mm)</h3>
                <img src="${item.images.sagittal}" alt="Sagittal slice at ${item.coord[0]}mm">
            </div>
            <div class="slice">
                <h3>Coronal (y = ${item.coord[1]} mm)</h3>
                <img src="${item.images.coronal}" alt="Coronal slice at ${item.coord[1]}mm">
            </div>
        </div>
    </div>
    `
			)
			.join('')}

    <div class="info">
        <p><strong>Test Date:</strong> ${new Date().toISOString()}</p>
        <p><strong>Total Slices Generated:</strong> ${sliceImages.length * 3} (3 views × ${sliceImages.length} coordinates)</p>
    </div>
</body>
</html>`;

		// Create download link
		const blob = new Blob([html], { type: 'text/html' });
		const url = URL.createObjectURL(blob);
		const a = document.createElement('a');
		a.href = url;
		a.download = 'orthogonal-slice-test.html';
		a.click();
		URL.revokeObjectURL(url);
	}

	// Download individual PNGs
	async function downloadPNGs() {
		for (let i = 0; i < sliceImages.length; i++) {
			const item = sliceImages[i];
			const coordStr = `${item.coord[0]}_${item.coord[1]}_${item.coord[2]}`;

			// Download each view
			await downloadPNG(item.images.axial, `slice_${i + 1}_axial_${coordStr}.png`);
			await downloadPNG(item.images.sagittal, `slice_${i + 1}_sagittal_${coordStr}.png`);
			await downloadPNG(item.images.coronal, `slice_${i + 1}_coronal_${coordStr}.png`);
		}
	}

	async function downloadPNG(dataUrl: string, filename: string) {
		const response = await fetch(dataUrl);
		const blob = await response.blob();
		const url = URL.createObjectURL(blob);
		const a = document.createElement('a');
		a.href = url;
		a.download = filename;
		a.click();
		URL.revokeObjectURL(url);
	}

	onMount(() => {
		console.log('[OrthogonalSliceTest] Component mounted, starting initialization...');
		initialize();
	});
</script>

<div class="container">
	<h1>Orthogonal Slice Test (Standalone)</h1>

	{#if isLoading}
		<div class="loading">
			<p>{progress}</p>
			<div class="spinner"></div>
		</div>
	{:else if error}
		<div class="error">
			<h2>Error</h2>
			<p>{error.message}</p>
			<details>
				<summary>Stack trace</summary>
				<pre>{error.stack}</pre>
			</details>
		</div>
	{:else}
		<div class="controls">
			<button onclick={() => generateHTMLOutput()}>Download HTML Report</button>
			<button onclick={() => downloadPNGs()}>Download All PNG Images</button>
		</div>

		<div class="results">
			<h2>Test Results</h2>
			<p>Generated {sliceImages.length} coordinate sets with 3 views each.</p>

			{#each sliceImages as item, index}
				<div class="coordinate-result">
					<h3>Coordinate {index + 1}: [{item.coord.join(', ')}] mm</h3>
					<div class="slice-grid">
						<div class="slice-view">
							<h4>Axial (z = {item.coord[2]} mm)</h4>
							<img src={item.images.axial} alt="Axial slice" />
						</div>
						<div class="slice-view">
							<h4>Sagittal (x = {item.coord[0]} mm)</h4>
							<img src={item.images.sagittal} alt="Sagittal slice" />
						</div>
						<div class="slice-view">
							<h4>Coronal (y = {item.coord[1]} mm)</h4>
							<img src={item.images.coronal} alt="Coronal slice" />
						</div>
					</div>
				</div>
			{/each}
		</div>
	{/if}
</div>

<style>
	.container {
		max-width: 1400px;
		margin: 0 auto;
		padding: 20px;
		font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
	}

	h1 {
		color: #333;
		margin-bottom: 30px;
	}

	.loading {
		text-align: center;
		padding: 50px;
	}

	.spinner {
		width: 50px;
		height: 50px;
		margin: 20px auto;
		border: 4px solid #f3f3f3;
		border-top: 4px solid #333;
		border-radius: 50%;
		animation: spin 1s linear infinite;
	}

	@keyframes spin {
		0% {
			transform: rotate(0deg);
		}
		100% {
			transform: rotate(360deg);
		}
	}

	.error {
		background: #fee;
		border: 1px solid #fcc;
		padding: 20px;
		border-radius: 8px;
		color: #c00;
	}

	.error pre {
		background: #fff;
		padding: 10px;
		border-radius: 4px;
		overflow-x: auto;
		font-size: 12px;
	}

	.controls {
		margin-bottom: 30px;
		display: flex;
		gap: 10px;
	}

	.controls button {
		padding: 10px 20px;
		background: #0066cc;
		color: white;
		border: none;
		border-radius: 4px;
		cursor: pointer;
		font-size: 16px;
	}

	.controls button:hover {
		background: #0052a3;
	}

	.results {
		background: #f8f8f8;
		padding: 20px;
		border-radius: 8px;
	}

	.coordinate-result {
		background: white;
		padding: 20px;
		margin-bottom: 30px;
		border-radius: 8px;
		box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
	}

	.coordinate-result h3 {
		color: #555;
		margin-bottom: 20px;
	}

	.slice-grid {
		display: grid;
		grid-template-columns: repeat(3, 1fr);
		gap: 20px;
	}

	.slice-view {
		text-align: center;
	}

	.slice-view h4 {
		margin: 0 0 10px 0;
		color: #666;
		font-size: 14px;
	}

	.slice-view img {
		width: 100%;
		max-width: 400px;
		border: 1px solid #ddd;
		background: #000;
		display: block;
		margin: 0 auto;
	}
</style>