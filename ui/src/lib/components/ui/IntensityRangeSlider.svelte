<script lang="ts">
	import { createEventDispatcher } from 'svelte';

	interface Props {
		min?: number;
		max?: number;
		dataMin?: number;
		dataMax?: number;
		valueLow?: number;
		valueHigh?: number;
		disabled?: boolean;
		label?: string;
		showHistogram?: boolean;
		histogramData?: number[];
	}

	let {
		min = 0,
		max = 255,
		dataMin = 0,
		dataMax = 255,
		valueLow = $bindable(0),
		valueHigh = $bindable(255),
		disabled = false,
		label = 'Intensity Range',
		showHistogram = false,
		histogramData = []
	}: Props = $props();

	const dispatch = createEventDispatcher<{
		change: { low: number; high: number };
		input: { low: number; high: number };
	}>();

	// Track interaction state
	let isDragging = $state(false);
	let dragTarget: 'low' | 'high' | 'range' | null = $state(null);
	let dragStartX = 0;
	let dragStartLow = 0;
	let dragStartHigh = 0;

	// Calculate positions
	let lowPercent = $derived(((valueLow - min) / (max - min)) * 100);
	let highPercent = $derived(((valueHigh - min) / (max - min)) * 100);
	let rangePercent = $derived(highPercent - lowPercent);

	// Format value for display
	function formatValue(value: number): string {
		if (Number.isInteger(value)) {
			return value.toString();
		}
		return value.toFixed(1);
	}

	// Handle direct input changes
	function handleLowInput(e: Event) {
		const target = e.target as HTMLInputElement;
		const newValue = parseFloat(target.value);

		if (!isNaN(newValue)) {
			valueLow = Math.max(min, Math.min(newValue, valueHigh));
			dispatch('input', { low: valueLow, high: valueHigh });
		}
	}

	function handleHighInput(e: Event) {
		const target = e.target as HTMLInputElement;
		const newValue = parseFloat(target.value);

		if (!isNaN(newValue)) {
			valueHigh = Math.min(max, Math.max(newValue, valueLow));
			dispatch('input', { low: valueLow, high: valueHigh });
		}
	}

	// Mouse/touch handling
	function startDrag(e: MouseEvent | TouchEvent, target: 'low' | 'high' | 'range') {
		if (disabled) return;

		isDragging = true;
		dragTarget = target;
		dragStartX = e instanceof MouseEvent ? e.clientX : e.touches[0].clientX;
		dragStartLow = valueLow;
		dragStartHigh = valueHigh;

		// Add global listeners
		document.addEventListener('mousemove', handleDrag);
		document.addEventListener('mouseup', endDrag);
		document.addEventListener('touchmove', handleDrag);
		document.addEventListener('touchend', endDrag);
	}

	function handleDrag(e: MouseEvent | TouchEvent) {
		if (!isDragging || !dragTarget) return;

		const currentX = e instanceof MouseEvent ? e.clientX : e.touches[0].clientX;
		const deltaX = currentX - dragStartX;
		const sliderRect = sliderEl?.getBoundingClientRect();

		if (!sliderRect) return;

		const deltaPercent = (deltaX / sliderRect.width) * 100;
		const deltaValue = (deltaPercent / 100) * (max - min);

		if (dragTarget === 'low') {
			const newLow = Math.max(min, Math.min(dragStartLow + deltaValue, valueHigh));
			if (newLow !== valueLow) {
				valueLow = newLow;
				dispatch('input', { low: valueLow, high: valueHigh });
			}
		} else if (dragTarget === 'high') {
			const newHigh = Math.min(max, Math.max(dragStartHigh + deltaValue, valueLow));
			if (newHigh !== valueHigh) {
				valueHigh = newHigh;
				dispatch('input', { low: valueLow, high: valueHigh });
			}
		} else if (dragTarget === 'range') {
			const range = dragStartHigh - dragStartLow;
			let newLow = dragStartLow + deltaValue;
			let newHigh = dragStartHigh + deltaValue;

			// Constrain to bounds
			if (newLow < min) {
				newLow = min;
				newHigh = min + range;
			} else if (newHigh > max) {
				newHigh = max;
				newLow = max - range;
			}

			if (newLow !== valueLow || newHigh !== valueHigh) {
				valueLow = newLow;
				valueHigh = newHigh;
				dispatch('input', { low: valueLow, high: valueHigh });
			}
		}
	}

	function endDrag() {
		if (isDragging) {
			isDragging = false;
			dragTarget = null;
			dispatch('change', { low: valueLow, high: valueHigh });

			// Remove global listeners
			document.removeEventListener('mousemove', handleDrag);
			document.removeEventListener('mouseup', endDrag);
			document.removeEventListener('touchmove', handleDrag);
			document.removeEventListener('touchend', endDrag);
		}
	}

	// Click on track to set value
	function handleTrackClick(e: MouseEvent) {
		if (disabled || isDragging) return;

		const rect = sliderEl?.getBoundingClientRect();
		if (!rect) return;

		const percent = ((e.clientX - rect.left) / rect.width) * 100;
		const clickValue = min + (percent / 100) * (max - min);

		// Set closest handle
		const distToLow = Math.abs(clickValue - valueLow);
		const distToHigh = Math.abs(clickValue - valueHigh);

		if (distToLow < distToHigh) {
			valueLow = Math.max(min, Math.min(clickValue, valueHigh));
		} else {
			valueHigh = Math.min(max, Math.max(clickValue, valueLow));
		}

		dispatch('input', { low: valueLow, high: valueHigh });
		dispatch('change', { low: valueLow, high: valueHigh });
	}

	let sliderEl: HTMLDivElement | undefined = $state();

	// Keyboard event handler for accessibility
	function handleKeyDown(e: KeyboardEvent) {
		if (disabled) return;

		const step = (max - min) / 100; // 1% step
		let handled = false;

		switch (e.key) {
			case 'ArrowLeft':
			case 'ArrowDown':
				if (e.shiftKey) {
					valueLow = Math.max(min, valueLow - step);
				} else {
					valueHigh = Math.max(valueLow, valueHigh - step);
				}
				handled = true;
				break;

			case 'ArrowRight':
			case 'ArrowUp':
				if (e.shiftKey) {
					valueLow = Math.min(valueHigh, valueLow + step);
				} else {
					valueHigh = Math.min(max, valueHigh + step);
				}
				handled = true;
				break;

			case 'Home':
				if (e.shiftKey) {
					valueLow = min;
				} else {
					valueHigh = min;
				}
				handled = true;
				break;

			case 'End':
				if (e.shiftKey) {
					valueLow = max;
				} else {
					valueHigh = max;
				}
				handled = true;
				break;
		}

		if (handled) {
			e.preventDefault();
			dispatch('input', { low: valueLow, high: valueHigh });
			dispatch('change', { low: valueLow, high: valueHigh });
		}
	}
</script>

<div class="intensity-range-slider" class:disabled>
	<div class="slider-header">
		<span class="slider-label">{label}</span>
		<div class="value-inputs">
			<label for="low-input" class="sr-only">Low value</label>
			<input
				id="low-input"
				type="number"
				value={valueLow}
				{min}
				max={valueHigh}
				oninput={handleLowInput}
				onchange={() => dispatch('change', { low: valueLow, high: valueHigh })}
				class="value-input"
				{disabled}
				aria-label="Low value"
			/>
			<span class="value-separator">–</span>
			<label for="high-input" class="sr-only">High value</label>
			<input
				id="high-input"
				type="number"
				value={valueHigh}
				min={valueLow}
				{max}
				oninput={handleHighInput}
				onchange={() => dispatch('change', { low: valueLow, high: valueHigh })}
				class="value-input"
				{disabled}
				aria-label="High value"
			/>
		</div>
	</div>

	<div
		class="slider-container"
		bind:this={sliderEl}
		onclick={handleTrackClick}
		onkeydown={handleKeyDown}
		role="slider"
		tabindex="0"
		aria-label="Intensity range slider"
		aria-valuenow={valueHigh}
		aria-valuemin={min}
		aria-valuemax={max}
	>
		{#if showHistogram && histogramData.length > 0}
			<div class="histogram">
				{#each histogramData as value, i}
					<div
						class="histogram-bar"
						style="height: {value}%; left: {(i / histogramData.length) * 100}%"
					></div>
				{/each}
			</div>
		{/if}

		<!-- Track -->
		<div class="track">
			<!-- Data range indicator -->
			<div
				class="data-range"
				style="left: {((dataMin - min) / (max - min)) * 100}%; 
               right: {100 - ((dataMax - min) / (max - min)) * 100}%"
			></div>

			<!-- Active range -->
			<div
				class="active-range"
				class:dragging={dragTarget === 'range'}
				style="left: {lowPercent}%; width: {rangePercent}%"
				onmousedown={(e) => startDrag(e, 'range')}
				ontouchstart={(e) => startDrag(e, 'range')}
				role="slider"
				tabindex="0"
				aria-label="Drag to move range"
				aria-valuenow={valueHigh}
				aria-valuemin={min}
				aria-valuemax={max}
			></div>
		</div>

		<!-- Handles -->
		<div
			class="handle handle-low"
			class:dragging={dragTarget === 'low'}
			style="left: {lowPercent}%"
			onmousedown={(e) => startDrag(e, 'low')}
			ontouchstart={(e) => startDrag(e, 'low')}
			title={formatValue(valueLow)}
			role="slider"
			tabindex="0"
			aria-label="Low value handle"
			aria-valuemin={min}
			aria-valuemax={max}
			aria-valuenow={valueLow}
		>
			<div class="handle-value">{formatValue(valueLow)}</div>
		</div>

		<div
			class="handle handle-high"
			class:dragging={dragTarget === 'high'}
			style="left: {highPercent}%"
			onmousedown={(e) => startDrag(e, 'high')}
			ontouchstart={(e) => startDrag(e, 'high')}
			title={formatValue(valueHigh)}
			role="slider"
			tabindex="0"
			aria-label="High value handle"
			aria-valuemin={min}
			aria-valuemax={max}
			aria-valuenow={valueHigh}
		>
			<div class="handle-value">{formatValue(valueHigh)}</div>
		</div>
	</div>

	<!-- Scale markers -->
	<div class="scale">
		<span class="scale-min">{formatValue(min)}</span>
		<span class="scale-mid">{formatValue((min + max) / 2)}</span>
		<span class="scale-max">{formatValue(max)}</span>
	</div>
</div>

<style>
	.intensity-range-slider {
		width: 100%;
		user-select: none;
	}

	.intensity-range-slider.disabled {
		opacity: 0.5;
		pointer-events: none;
	}

	.sr-only {
		position: absolute;
		width: 1px;
		height: 1px;
		padding: 0;
		margin: -1px;
		overflow: hidden;
		clip: rect(0, 0, 0, 0);
		white-space: nowrap;
		border: 0;
	}

	.slider-header {
		display: flex;
		justify-content: space-between;
		align-items: center;
		margin-bottom: 1rem;
	}

	.slider-label {
		font-size: 0.875rem;
		font-weight: 500;
		color: var(--foreground);
	}

	.value-inputs {
		display: flex;
		align-items: center;
		gap: 0.5rem;
	}

	.value-input {
		width: 4.5rem;
		padding: 0.25rem 0.5rem;
		border: 1px solid var(--border);
		border-radius: 0.25rem;
		background: var(--background);
		color: var(--foreground);
		font-size: 0.813rem;
		font-variant-numeric: tabular-nums;
		text-align: center;
	}

	.value-input:focus {
		outline: none;
		border-color: var(--primary);
	}

	.value-separator {
		color: var(--muted-foreground);
		font-size: 0.875rem;
	}

	.slider-container {
		position: relative;
		height: 3rem;
		margin: 0.5rem 0;
		padding: 0 0.75rem; /* Add horizontal padding for handles */
		cursor: pointer;
	}

	.histogram {
		position: absolute;
		bottom: 1.5rem;
		left: 0.75rem; /* Account for container padding */
		right: 0.75rem; /* Account for container padding */
		height: 2rem;
		opacity: 0.2;
	}

	.histogram-bar {
		position: absolute;
		bottom: 0;
		width: 1px;
		background: var(--primary);
	}

	.track {
		position: absolute;
		bottom: 1rem;
		left: 0.75rem; /* Account for container padding */
		right: 0.75rem; /* Account for container padding */
		height: 0.5rem;
		background: var(--muted);
		border-radius: 0.25rem;
		overflow: visible; /* Allow handles to extend beyond track */
	}

	.data-range {
		position: absolute;
		top: 0;
		bottom: 0;
		background: var(--muted-foreground);
		opacity: 0.2;
	}

	.active-range {
		position: absolute;
		top: 0;
		bottom: 0;
		background: #3b82f6; /* Direct blue color */
		opacity: 0.3;
		cursor: move;
		transition: opacity 0.2s;
	}

	.active-range:hover {
		opacity: 0.4;
	}

	.active-range.dragging {
		opacity: 0.5;
	}

	.handle {
		position: absolute;
		bottom: 0.75rem;
		width: 1rem;
		height: 1rem;
		margin-left: -0.5rem;
		background: #3b82f6; /* Direct blue color instead of CSS variable */
		border: 2px solid #ffffff;
		border-radius: 50%;
		cursor: ew-resize;
		box-shadow: 
			0 0 0 1px rgba(0, 0, 0, 0.2),
			0 2px 4px rgba(0, 0, 0, 0.3);
		transition:
			transform 0.2s,
			box-shadow 0.2s;
		z-index: 10;
	}

	.handle:hover {
		transform: scale(1.15);
		box-shadow: 
			0 0 0 1px rgba(0, 0, 0, 0.25),
			0 2px 6px rgba(0, 0, 0, 0.4);
		background: #2563eb; /* Darker blue on hover */
	}

	.handle.dragging {
		transform: scale(1.25);
		box-shadow: 
			0 0 0 1px rgba(0, 0, 0, 0.3),
			0 2px 8px rgba(0, 0, 0, 0.5);
		background: #1d4ed8; /* Even darker blue when dragging */
	}

	.handle-value {
		position: absolute;
		bottom: 100%;
		left: 50%;
		transform: translateX(-50%) translateY(-0.25rem);
		padding: var(--spacing-1) var(--spacing-2);
		background: var(--popover);
		color: var(--popover-foreground);
		border: 1px solid var(--border);
		border-radius: 0.25rem;
		font-size: 0.75rem;
		font-variant-numeric: tabular-nums;
		white-space: nowrap;
		opacity: 0;
		pointer-events: none;
		transition: opacity 0.2s;
	}

	.handle:hover .handle-value,
	.handle.dragging .handle-value {
		opacity: 1;
	}

	.scale {
		display: flex;
		justify-content: space-between;
		font-size: 0.75rem;
		color: var(--muted-foreground);
		font-variant-numeric: tabular-nums;
	}

	.scale-mid {
		opacity: 0.5;
	}
</style>
