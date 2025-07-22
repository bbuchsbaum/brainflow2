<!--
  LayerHeader Component
  Clean, professional header for layer items with visibility, name, opacity, and menu
-->
<script lang="ts">
	import { createEventDispatcher } from 'svelte';
	import { Eye, EyeOff, MoreVertical } from 'lucide-svelte';
	
	// Props
	export let name: string = '';
	export let visible: boolean = true;
	export let opacity: number = 1;
	export let isActive: boolean = false;
	
	const dispatch = createEventDispatcher();
	
	// Format opacity for display
	$: opacityPercent = Math.round(opacity * 100);
	
	// Handle opacity change
	function handleOpacityChange(e: Event) {
		const target = e.target as HTMLInputElement;
		const newOpacity = parseFloat(target.value) / 100;
		dispatch('opacity', newOpacity);
	}
	
	// Handle visibility toggle
	function toggleVisibility() {
		dispatch('visibility', !visible);
	}
	
	// Handle menu click
	function handleMenuClick(e: MouseEvent) {
		e.stopPropagation();
		dispatch('menu', { x: e.clientX, y: e.clientY });
	}
	
	// Handle header click
	function handleClick() {
		dispatch('select');
	}
	
	// Handle name edit
	function handleNameEdit() {
		dispatch('rename');
	}
</script>

<header 
	class="layer-header"
	class:active={isActive}
	on:click={handleClick}
	role="button"
	tabindex="0"
	on:keydown={(e) => {
		if (e.key === 'Enter' || e.key === ' ') {
			e.preventDefault();
			handleClick();
		}
	}}
>
	<!-- Visibility Toggle -->
	<button
		class="icon-btn visibility"
		on:click|stopPropagation={toggleVisibility}
		aria-label={visible ? 'Hide layer' : 'Show layer'}
		title={visible ? 'Hide layer' : 'Show layer'}
	>
		{#if visible}
			<Eye size={14} />
		{:else}
			<EyeOff size={14} />
		{/if}
	</button>
	
	<!-- Layer Name -->
	<h3 
		class="layer-name"
		on:dblclick|stopPropagation={handleNameEdit}
		title="Double-click to rename"
	>
		{name}
	</h3>
	
	<!-- Opacity Control -->
	<div class="opacity-control">
		<input
			type="range"
			class="opacity-slider"
			min="0"
			max="100"
			step="1"
			value={opacityPercent}
			on:input|stopPropagation={handleOpacityChange}
			aria-label="Layer opacity"
			title="Opacity: {opacityPercent}%"
		/>
		<span class="opacity-value">{opacityPercent}%</span>
	</div>
	
	<!-- Menu Button -->
	<button
		class="icon-btn menu"
		on:click|stopPropagation={handleMenuClick}
		aria-label="Layer options"
		title="More options"
	>
		<MoreVertical size={14} />
	</button>
</header>

<style>
	.layer-header {
		display: flex;
		align-items: center;
		gap: var(--spacing-2);
		padding: var(--spacing-2);
		min-height: 36px;
		background: transparent;
		border-radius: var(--radius-base);
		cursor: pointer;
		transition: background-color var(--transition-fast);
		user-select: none;
	}
	
	.layer-header:hover {
		background: var(--color-surface-elevated);
	}
	
	.layer-header.active {
		background: var(--color-surface-elevated);
		box-shadow: inset 0 0 0 1px var(--color-primary-500);
	}
	
	.layer-header:focus-visible {
		outline: 2px solid var(--color-primary-500);
		outline-offset: -2px;
	}
	
	/* Icon Buttons */
	.icon-btn {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 24px;
		height: 24px;
		padding: 0;
		background: none;
		border: none;
		border-radius: var(--radius-sm);
		color: var(--color-text-secondary);
		cursor: pointer;
		transition: all var(--transition-fast);
		flex-shrink: 0;
	}
	
	.icon-btn:hover {
		color: var(--color-text-primary);
		background: var(--color-base-500);
	}
	
	.icon-btn:active {
		transform: scale(0.95);
	}
	
	.icon-btn:focus-visible {
		outline: 2px solid var(--color-primary-500);
		outline-offset: 0;
	}
	
	/* Layer Name */
	.layer-name {
		flex: 1;
		margin: 0;
		font-size: 13px;
		font-weight: 500;
		color: var(--color-text-primary);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		line-height: 1.4;
	}
	
	/* Opacity Control */
	.opacity-control {
		display: flex;
		align-items: center;
		gap: var(--spacing-1);
		flex-shrink: 0;
	}
	
	.opacity-slider {
		width: 60px;
		height: 4px;
		-webkit-appearance: none;
		appearance: none;
		background: var(--color-base-600);
		border-radius: 2px;
		outline: none;
		cursor: pointer;
	}
	
	.opacity-slider::-webkit-slider-thumb {
		-webkit-appearance: none;
		appearance: none;
		width: 12px;
		height: 12px;
		background: var(--color-primary-500);
		border-radius: 50%;
		cursor: pointer;
		transition: transform var(--transition-fast);
	}
	
	.opacity-slider::-moz-range-thumb {
		width: 12px;
		height: 12px;
		background: var(--color-primary-500);
		border-radius: 50%;
		border: none;
		cursor: pointer;
		transition: transform var(--transition-fast);
	}
	
	.opacity-slider:hover::-webkit-slider-thumb,
	.opacity-slider:hover::-moz-range-thumb {
		transform: scale(1.2);
	}
	
	.opacity-value {
		min-width: 35px;
		font-size: 11px;
		color: var(--color-text-secondary);
		text-align: right;
		font-variant-numeric: tabular-nums;
	}
	
	/* Transitions */
	:global(.transition-fast) {
		transition-duration: 120ms;
		transition-timing-function: cubic-bezier(0.25, 0.1, 0.25, 1);
	}
</style>