<!-- Mock SliceViewGPU for testing -->
<script lang="ts">
	import { ViewType } from '$lib/types/ViewType';

	// Props
	let {
		layerId,
		viewType,
		onViewportChange
	}: {
		layerId: string | null;
		viewType: ViewType;
		onViewportChange?: (
			viewType: ViewType,
			viewport: { scale: number; offset: [number, number] }
		) => void;
	} = $props();
</script>

<div class="mock-slice-view" data-testid={`mock-slice-view-${viewType}`}>
	<div class="mock-view-label">
		Mock {viewType === ViewType.Axial
			? 'Axial'
			: viewType === ViewType.Coronal
				? 'Coronal'
				: 'Sagittal'} View
	</div>
	{#if layerId}
		<div class="mock-layer-id">Layer: {layerId}</div>
	{:else}
		<div class="mock-no-layer">No layer</div>
	{/if}
</div>

<style>
	.mock-slice-view {
		width: 100%;
		height: 100%;
		background-color: #f0f0f0;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		padding: 1rem;
	}

	.mock-view-label {
		font-weight: bold;
		margin-bottom: 0.5rem;
	}

	.mock-layer-id,
	.mock-no-layer {
		font-size: 0.875rem;
		color: #666;
	}
</style>
