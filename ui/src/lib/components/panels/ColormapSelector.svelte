<!--
  ColormapSelector Component
  Horizontal scrollable colormap picker with gradient previews
-->
<script lang="ts">
	import { createEventDispatcher } from 'svelte';
	import { ChevronRight, Check } from 'lucide-svelte';
	
	export let selectedColormap: string = 'grayscale';
	export let reversed: boolean = false;
	export let collapsed: boolean = true;
	
	const dispatch = createEventDispatcher();
	
	// Colormap definitions with accessibility info
	const colormaps = [
		{
			id: 'grayscale',
			label: 'Grayscale',
			gradient: 'linear-gradient(to right, #000, #fff)',
			colorBlindSafe: true
		},
		{
			id: 'viridis',
			label: 'Viridis',
			gradient: 'linear-gradient(to right, #440154, #31688e, #35b779, #fde725)',
			colorBlindSafe: true
		},
		{
			id: 'plasma',
			label: 'Plasma',
			gradient: 'linear-gradient(to right, #0d0887, #7e03a8, #cc4778, #f89540, #f0f921)',
			colorBlindSafe: true
		},
		{
			id: 'inferno',
			label: 'Inferno',
			gradient: 'linear-gradient(to right, #000, #420a68, #932667, #dd513a, #fca50a, #fcffa4)',
			colorBlindSafe: true
		},
		{
			id: 'magma',
			label: 'Magma',
			gradient: 'linear-gradient(to right, #000, #3b0f70, #8c2981, #de4968, #fe9f6d, #fcfdbf)',
			colorBlindSafe: true
		},
		{
			id: 'hot',
			label: 'Hot',
			gradient: 'linear-gradient(to right, #000, #f00, #ff0, #fff)',
			colorBlindSafe: false
		},
		{
			id: 'cool',
			label: 'Cool',
			gradient: 'linear-gradient(to right, #00f, #0ff)',
			colorBlindSafe: false
		},
		{
			id: 'jet',
			label: 'Jet',
			gradient: 'linear-gradient(to right, #00f, #0ff, #0f0, #ff0, #f00)',
			colorBlindSafe: false
		}
	];
	
	// Handle colormap selection
	function selectColormap(id: string) {
		dispatch('select', { colormap: id, reversed });
	}
	
	// Toggle reversed
	function toggleReversed() {
		reversed = !reversed;
		console.log('Reverse toggled:', reversed, 'colormap:', selectedColormap);
		dispatch('select', { colormap: selectedColormap, reversed });
	}
	
	// Toggle collapsed state
	function toggleCollapsed() {
		collapsed = !collapsed;
		dispatch('toggle', collapsed);
	}
	
	// Get current colormap info
	$: currentColormap = colormaps.find(c => c.id === selectedColormap) || colormaps[0];
</script>

<div class="colormap-selector" class:collapsed>
	<!-- Header Row -->
	<button
		class="selector-header"
		on:click={toggleCollapsed}
		aria-label="Toggle colormap selector"
		aria-expanded={!collapsed}
	>
		<span class="icon" class:rotated={!collapsed}>
			<ChevronRight size={14} />
		</span>
		<span class="label">Color Map</span>
		
		<!-- Preview of selected colormap -->
		<div 
			class="preview-bar"
			style="background: {currentColormap.gradient}"
			class:reversed
			title={currentColormap.label}
		/>
	</button>
	
	<!-- Expanded Content -->
	{#if !collapsed}
		<div class="colormap-grid">
			{#each colormaps as colormap}
				{@const isSelected = colormap.id === selectedColormap}
				<button
					class="colormap-option"
					class:selected={isSelected}
					on:click={() => selectColormap(colormap.id)}
					title={colormap.label}
					aria-label={colormap.label}
					aria-pressed={isSelected}
				>
					<div 
						class="colormap-preview"
						style="background: {colormap.gradient}"
					>
						{#if isSelected}
							<Check size={12} class="check-icon" />
						{/if}
						{#if colormap.colorBlindSafe}
							<span class="cvd-indicator">✓</span>
						{/if}
					</div>
					<span class="colormap-name">{colormap.label}</span>
				</button>
			{/each}
		</div>
		
		<!-- Reverse Toggle -->
		<label class="reverse-toggle">
			<input
				type="checkbox"
				checked={reversed}
				on:change={toggleReversed}
			/>
			<span>Reverse colormap</span>
		</label>
	{/if}
</div>

<style>
	.colormap-selector {
		border-bottom: 1px solid var(--color-border);
		transition: all var(--transition-fast);
	}
	
	.colormap-selector.collapsed {
		border-bottom: none;
	}
	
	/* Header */
	.selector-header {
		display: flex;
		align-items: center;
		gap: var(--spacing-2);
		width: 100%;
		padding: var(--spacing-2);
		background: none;
		border: none;
		color: var(--color-text-primary);
		cursor: pointer;
		text-align: left;
		transition: background-color var(--transition-fast);
	}
	
	.selector-header:hover {
		background: var(--color-surface-elevated);
	}
	
	.selector-header:focus-visible {
		outline: 2px solid var(--color-primary-500);
		outline-offset: -2px;
	}
	
	.icon {
		display: flex;
		transition: transform var(--transition-fast);
	}
	
	.icon.rotated {
		transform: rotate(90deg);
	}
	
	.label {
		font-family: 'Inter', sans-serif !important;
		font-weight: 600;
		font-size: 12px;
		/* Removed text-transform: uppercase */
		letter-spacing: 0.5px;
		color: var(--color-text-secondary);
		margin-right: 2px; /* Add spacing between label and preview bar */
	}
	
	.preview-bar {
		flex: 1;
		height: 12px;
		border-radius: var(--radius-sm);
		border: 1px solid var(--color-border);
		max-width: 120px;
	}
	
	.preview-bar.reversed {
		transform: scaleX(-1);
	}
	
	/* Grid */
	.colormap-grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(100px, 1fr));
		gap: 8px;
		padding: 8px;
		padding-top: 12px; /* Extra top padding for better spacing from label */
		max-height: 200px;
		overflow-y: auto;
		overflow-x: hidden; /* Prevent horizontal scroll */
	}
	
	/* Colormap Options */
	.colormap-option {
		display: flex;
		flex-direction: column;
		gap: var(--spacing-1);
		padding: var(--spacing-1);
		background: none;
		border: 1px solid transparent;
		border-radius: var(--radius-base);
		cursor: pointer;
		transition: all var(--transition-fast);
	}
	
	.colormap-option:hover {
		background: var(--color-surface-elevated);
		border-color: var(--color-border);
	}
	
	.colormap-option.selected {
		background: var(--color-surface-elevated);
		border-color: var(--color-primary-500);
	}
	
	.colormap-option:focus-visible {
		outline: 2px solid var(--color-primary-500);
		outline-offset: 0;
	}
	
	.colormap-preview {
		position: relative;
		width: 100%;
		height: 24px;
		border-radius: var(--radius-sm);
		border: 1px solid var(--color-border);
		overflow: hidden;
	}
	
	.check-icon {
		position: absolute;
		top: 50%;
		left: 50%;
		transform: translate(-50%, -50%);
		color: white;
		filter: drop-shadow(0 1px 2px rgba(0, 0, 0, 0.5));
	}
	
	.cvd-indicator {
		position: absolute;
		top: 2px;
		right: 2px;
		font-size: 10px;
		color: white;
		filter: drop-shadow(0 1px 2px rgba(0, 0, 0, 0.5));
	}
	
	.colormap-name {
		font-size: 11px;
		color: var(--color-text-secondary);
		text-align: center;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	
	/* Reverse Toggle */
	.reverse-toggle {
		display: flex;
		align-items: center;
		gap: var(--spacing-2);
		padding: var(--spacing-2);
		font-size: 12px;
		color: var(--color-text-secondary);
		cursor: pointer;
		border-top: 1px solid var(--color-border);
	}
	
	.reverse-toggle:hover {
		color: var(--color-text-primary);
	}
	
	.reverse-toggle input[type="checkbox"] {
		accent-color: var(--color-primary-500);
		cursor: pointer;
	}
	
	/* Scrollbar */
	.colormap-grid::-webkit-scrollbar {
		width: 8px;
	}
	
	.colormap-grid::-webkit-scrollbar-track {
		background: var(--color-base-500);
		border-radius: 3px;
		margin-right: 2px;
	}
	
	.colormap-grid::-webkit-scrollbar-thumb {
		background: var(--color-base-700);
		border-radius: 3px;
	}
	
	.colormap-grid::-webkit-scrollbar-thumb:hover {
		background: var(--color-base-800);
	}
</style>