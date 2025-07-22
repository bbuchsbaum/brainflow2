<!--
  ThresholdControl Component
  Threshold range control with enable/disable toggle
-->
<script lang="ts">
	import { createEventDispatcher } from 'svelte';
	import RangeSlider from '$lib/components/ui/RangeSlider.svelte';
	
	export let dataMin: number = 0;
	export let dataMax: number = 100;
	export let thresholdMin: number = 25;
	export let thresholdMax: number = 75;
	export let disabled: boolean = false;
	
	const dispatch = createEventDispatcher();
	
	// Handle threshold change
	function handleChange(e: CustomEvent<{ low: number; high: number }>) {
		// Always pass enabled: true since we removed the checkbox
		dispatch('change', { ...e.detail, enabled: true });
	}
</script>

<div class="threshold-control layer-panel-section">
	<div class="control-group">
		<span class="control-label">Threshold</span>
	</div>
	
	<div class="slider-container">
		<RangeSlider
				value={[thresholdMin, thresholdMax]}
				min={dataMin}
				max={dataMax}
				step={1}
				{disabled}
				formatter={(v) => Math.round(v).toString()}
				on:change={(e) => {
					if (e.detail?.values) {
						thresholdMin = e.detail.values[0];
						thresholdMax = e.detail.values[1];
						handleChange({ detail: { low: thresholdMin, high: thresholdMax } });
					}
				}}
			/>
	</div>
</div>

<style>
	/* Ensure component uses Inter font */
	.threshold-control {
		font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif !important;
		/* Component is now inside .layer-controls which has its own padding */
	}
	
	.threshold-control :global(*) {
		font-family: inherit !important;
	}
	
	/* Match the control-group styling from IntensityControl */
	.control-group {
		display: flex;
		align-items: center;
		margin-bottom: 8px; /* Reduced from 12px to match IntensityControl */
		min-height: 28px; /* Reduced from 32px to match IntensityControl */
		width: 100%; /* Make the container fill the available width */
		/* Removed padding-left - parent .layer-controls provides padding */
	}
	
	.slider-container {
		/* Removed padding - parent .layer-controls provides sufficient padding */
	}
</style>