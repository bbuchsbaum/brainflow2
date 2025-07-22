<!--
  RangeSlider Component
  A reusable dual-handle range slider with proper styling for dark theme
-->
<script lang="ts">
	import RangeSlider from 'svelte-range-slider-pips';
	import { createEventDispatcher } from 'svelte';
	
	export let value: number[] = [0, 1];
	export let min: number = 0;
	export let max: number = 1;
	export let step: number = 0.01;
	export let label: string = '';
	export let disabled: boolean = false;
	export let formatter: (value: number) => string = (v) => v.toString();
	
	const dispatch = createEventDispatcher();
	
	// Handle value changes
	function handleChange(e: CustomEvent) {
		value = e.detail.values;
		dispatch('change', { values: value });
	}
	
	// Check if handles are overlapping (within 2% of range)
	$: handlesOverlapping = (() => {
		const range = max - min;
		const threshold = range * 0.02; // 2% of range
		return Math.abs(value[1] - value[0]) <= threshold;
	})();
</script>

{#if label}
	<label class="slider-label">{label}</label>
{/if}
<div class="range-slider-container" class:handles-overlapping={handlesOverlapping}>
	<div class="slider-labels">
		<span class="slider-label-min">{formatter(min)}</span>
		<span class="slider-label-max">{formatter(max)}</span>
	</div>
	<div class="range-slider-wrapper">
		<RangeSlider
			bind:values={value}
			{min}
			{max}
			{step}
			range
			pushy
			float
			hoverable
			{disabled}
			{formatter}
			on:change={handleChange}
		/>
	</div>
</div>

<style>
	.slider-label {
		display: block;
		font-size: 12px;
		font-weight: 500;
		color: var(--color-text-secondary);
		text-transform: uppercase;
		letter-spacing: 0.05em;
		margin-bottom: 8px;
	}
	
	.range-slider-container {
		position: relative;
		width: 100%;
		/* Prevent text selection when dragging */
		user-select: none;
		-webkit-user-select: none;
		-moz-user-select: none;
		-ms-user-select: none;
		/* CSS Variables for svelte-range-slider-pips customization */
		--range-slider: #4a4a4a; /* track background */
		--range-handle-inactive: #7a7a7a; /* handle color */
		--range-handle: #8a8a8a; /* handle hover color */
		--range-handle-focus: #7a7a7a; /* handle focus color */
		--range-handle-border: rgba(34, 197, 94, 0.6); /* subtle green border */
		--range-float-inactive: #2a2a2a; /* tooltip background */
		--range-float: #3a3a3a; /* tooltip background when active */
		--range-float-text: #ffffff; /* tooltip text color */
		--range-bar: #10b981; /* active track color - explicit green */
	}
	
	.slider-labels {
		display: flex;
		justify-content: space-between;
		font-size: 11px;
		color: var(--color-text-tertiary);
		margin-bottom: 4px;
		padding: 0 12px;
		user-select: none;
		-webkit-user-select: none;
	}
	
	.slider-label-min,
	.slider-label-max {
		font-family: 'Inter', sans-serif;
		font-weight: 500;
	}
	
	.range-slider-wrapper {
		padding: 0 12px; /* Padding to prevent handle clipping */
		margin: 0 0 12px; /* Reduced from 16px */
		width: 100%;
		min-height: 32px;
		user-select: none;
		-webkit-user-select: none;
	}
	
	/* Override library styles for dark theme */
	:global(.rangeSlider) {
		height: 32px !important;
		background: transparent !important;
		user-select: none !important;
		-webkit-user-select: none !important;
		-moz-user-select: none !important;
		-ms-user-select: none !important;
		--range-slider: #3a3a3a !important;
		--range-handle-inactive: #7a7a7a !important;
		--range-handle-active: #8a8a8a !important;
		--range-handle-focus: #7a7a7a !important;
	}
	
	/* Blanket no-select on all descendants to prevent any text selection */
	:global(.range-slider-container *),
	:global(.rangeSlider *) {
		user-select: none !important;
		-webkit-user-select: none !important;
		-moz-user-select: none !important;
		-ms-user-select: none !important;
	}
	
	/* Full track background - add via pseudo element */
	:global(.rangeSlider) {
		position: relative !important;
	}
	
	:global(.rangeSlider::after) {
		content: '' !important;
		position: absolute !important;
		left: 0 !important;
		right: 0 !important;
		height: 4px !important;
		background: #3a3a3a !important;
		border-radius: 2px !important;
		top: 50% !important;
		transform: translateY(-50%) !important;
		z-index: 0 !important;
		pointer-events: none !important;
	}
	
	/* Active range bar - the green part between handles */
	:global(.rangeSlider .rangeBar) {
		position: absolute !important;
		height: 4px !important;
		border-radius: 2px !important;
		background: var(--range-bar) !important;
		top: 50% !important;
		transform: translateY(-50%) !important;
		z-index: 1 !important;
	}
	
	/* Override handle appearance - restore all necessary properties */
	:global(.range-slider-container .rangeSlider .rangeHandle) {
		width: 14px !important;
		height: 14px !important;
		border-radius: 50% !important; /* Make it circular */
		background: #7a7a7a !important; /* Muted gray */
		background-color: #7a7a7a !important;
		border: 1px solid rgba(34, 197, 94, 0.6) !important; /* Subtle green border */
		box-shadow: 0 1px 3px rgba(0, 0, 0, 0.4) !important;
		top: 50% !important;
		transform: translate(-50%, -50%) !important;
		cursor: grab !important;
		transition: transform 150ms ease-out, box-shadow 150ms ease-out !important;
	}
	
	:global(.range-slider-container .rangeSlider .rangeHandle:hover) {
		background: #8a8a8a !important;
		background-color: #8a8a8a !important;
		transform: translate(-50%, -50%) scale(1.1) !important;
		border: 1px solid rgba(34, 197, 94, 0.8) !important;
	}
	
	:global(.range-slider-container .rangeSlider .rangeHandle:active),
	:global(.range-slider-container .rangeSlider .rangeHandle:focus) {
		background: #7a7a7a !important;
		background-color: #7a7a7a !important;
		cursor: grabbing !important;
	}
	
	/* Ensure handles appear above track */
	:global(.range-slider-container .rangeSlider .rangeHandle) {
		z-index: 2 !important;
	}
	
	/* Offset second handle when overlapping */
	:global(.range-slider-container.handles-overlapping .rangeSlider .rangeHandle:last-child) {
		transform: translate(calc(-50% + 3px), -50%) !important;
		box-shadow: 0 1px 3px rgba(0, 0, 0, 0.6) !important;
		z-index: 3 !important;
	}
	
	
	/* Float labels */
	:global(.rangeSlider .rangeFloat) {
		background: #2a2a2a !important;
		color: #ffffff !important;
		border: 1px solid #444 !important;
		border-radius: 4px !important;
		padding: 4px 8px !important;
		font-size: 11px !important;
		font-weight: 500 !important;
		font-family: 'Inter', sans-serif !important;
		top: -36px !important;
		opacity: 0 !important;
		transition: opacity 0.2s ease !important;
		pointer-events: none !important;
		white-space: nowrap !important;
		box-shadow: 0 2px 4px rgba(0, 0, 0, 0.3) !important;
		user-select: none !important;
		-webkit-user-select: none !important;
	}
	
	:global(.rangeSlider .rangeHandle:hover + .rangeFloat),
	:global(.rangeSlider .rangeHandle:active + .rangeFloat),
	:global(.rangeSlider .rangeHandle.active + .rangeFloat) {
		opacity: 1 !important;
	}
	
	:global(.rangeSlider .rangeHandle.hoverable:hover + .rangeFloat) {
		opacity: 1 !important;
	}
	
	/* Disabled state */
	:global(.rangeSlider.disabled) {
		opacity: 0.5 !important;
	}
	
	:global(.rangeSlider.disabled .rangeHandle) {
		cursor: not-allowed !important;
	}
</style>