<!--
  IntensityControl Component
  Wrapper for IntensityRangeSlider with histogram and better styling
-->
<script lang="ts">
	import { createEventDispatcher } from 'svelte';
	import RangeSlider from '$lib/components/ui/RangeSlider.svelte';
	import { RotateCcw } from 'lucide-svelte';
	
	export let dataMin: number = 0;
	export let dataMax: number = 100;
	export let windowMin: number = 0;
	export let windowMax: number = 100;
	export let histogramData: number[] = [];
	export let disabled: boolean = false;
	
	const dispatch = createEventDispatcher();
	
	// Handle range change
	function handleChange(e: CustomEvent<{ low: number; high: number }>) {
		dispatch('change', e.detail);
	}
	
	// Auto range detection
	function autoRange() {
		dispatch('auto');
	}
	
	// Reset to full range
	function resetRange() {
		dispatch('reset');
	}
</script>

<div class="intensity-control layer-panel-section">
	<div class="control-group">
		<span class="control-label">Intensity</span>
		<div class="control-actions">
			<button
				class="intensity-button"
				on:click={autoRange}
				title="Auto-detect range"
				aria-label="Auto-detect range"
				{disabled}
			>
				<span class="action-icon">◎</span>
				<span class="action-label">Auto</span>
			</button>
			<button
				class="intensity-button"
				on:click={resetRange}
				title="Reset to full range"
				aria-label="Reset to full range"
				{disabled}
			>
				<RotateCcw size={12} />
				<span class="action-label">Reset</span>
			</button>
		</div>
	</div>
	
	<div class="slider-container">
		<RangeSlider
			value={[windowMin, windowMax]}
			min={dataMin}
			max={dataMax}
			step={1}
			{disabled}
			formatter={(v) => Math.round(v).toString()}
			on:change={(e) => {
				if (e.detail?.values) {
					windowMin = e.detail.values[0];
					windowMax = e.detail.values[1];
					handleChange({ detail: { low: windowMin, high: windowMax } });
				}
			}}
		/>
	</div>
</div>

<style>
	/* Layout classes from app.css handle main styling */
	.intensity-control {
		/* Component is now inside .layer-controls which has its own padding */
	}
	
	.control-group {
		display: flex;
		align-items: center;
		justify-content: space-between;
		margin-bottom: 8px; /* Reduced from 12px */
		min-height: 28px; /* Reduced from 32px */
		width: 100%; /* Make the container fill the available width */
		/* Removed padding-left - parent .layer-controls provides padding */
	}
	
	.control-actions {
		display: flex;
		gap: 8px;
		align-items: center;
	}
	
	/* Custom button styles for intensity control */
	.intensity-button {
		display: inline-flex !important;
		align-items: center;
		gap: 4px;
		background: #5a5a5a !important;
		border: 1px solid #7a7a7a !important;
		color: #ffffff !important;
		padding: 5px 12px !important;
		border-radius: 4px;
		font-size: 11px;
		font-weight: 500;
		cursor: pointer;
		min-height: 26px;
		opacity: 1 !important;
		visibility: visible !important;
		box-shadow: 0 1px 3px rgba(0, 0, 0, 0.5);
		transition: all 0.2s ease;
	}
	
	.intensity-button:hover:not(:disabled) {
		background: #6a6a6a !important;
		border-color: #8a8a8a !important;
		transform: translateY(-1px);
		box-shadow: 0 2px 4px rgba(0, 0, 0, 0.6);
	}
	
	.intensity-button:active:not(:disabled) {
		transform: translateY(0);
		background: #4a4a4a !important;
	}
	
	.intensity-button:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}
	
	/* Ensure all button content is visible */
	.intensity-button span {
		color: #ffffff !important;
		opacity: 1 !important;
	}
	
	/* Ensure Lucide SVG icons are visible */
	.intensity-button :global(svg) {
		width: 12px;
		height: 12px;
		stroke: #ffffff !important;
		stroke-width: 2;
		fill: none;
		opacity: 1 !important;
	}
	
	.action-icon {
		font-size: 14px;
		line-height: 1;
		display: flex;
		align-items: center;
		justify-content: center;
		color: #ffffff !important;
	}
	
	.action-label {
		font-weight: 500;
		white-space: nowrap;
		color: #ffffff !important;
	}
	
	.slider-container {
		/* Removed padding - parent .layer-controls provides sufficient padding */
	}
</style>