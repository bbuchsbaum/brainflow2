<!--
  IntensityPresets Component - Quick preset buttons for common intensity adjustments
  Part of LayerPanel redesign for improved ergonomics
-->
<script lang="ts">
	import { createEventDispatcher } from 'svelte';

	// Props
	let {
		presets = [],
		dataRange = [0, 255],
		disabled = false,
		class: className = ''
	}: {
		presets?: Array<{
			label: string;
			tooltip?: string;
			getValue: (min: number, max: number) => [number, number];
		}>;
		dataRange?: [number, number];
		disabled?: boolean;
		class?: string;
	} = $props();

	const dispatch = createEventDispatcher<{
		apply: { preset: any; range: [number, number] };
	}>();

	function applyPreset(preset: any) {
		const [min, max] = preset.getValue(dataRange[0], dataRange[1]);
		dispatch('apply', { preset, range: [min, max] });
	}
</script>

<div class="intensity-presets {className}">
	{#each presets as preset}
		<button
			class="preset-button"
			onclick={() => applyPreset(preset)}
			title={preset.tooltip || preset.label}
			{disabled}
			type="button"
		>
			{preset.label}
		</button>
	{/each}
</div>

<style>
	.intensity-presets {
		display: flex;
		gap: 0.25rem;
	}

	.preset-button {
		flex: 1;
		padding: 0.25rem 0.5rem;
		border: 1px solid var(--color-border);
		background: var(--color-surface);
		color: var(--color-text-secondary);
		font-size: 12px;
		font-weight: 500;
		border-radius: 4px;
		cursor: pointer;
		transition: all 0.15s ease;
		white-space: nowrap;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.preset-button:hover:not(:disabled) {
		background: var(--color-hover);
		color: var(--color-text-primary);
		border-color: var(--color-primary-500);
	}

	.preset-button:active:not(:disabled) {
		transform: scale(0.98);
		background: var(--color-active);
	}

	.preset-button:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	/* Compact mode for smaller containers */
	.intensity-presets.compact .preset-button {
		padding: 0.125rem 0.375rem;
		font-size: 11px;
	}
</style>