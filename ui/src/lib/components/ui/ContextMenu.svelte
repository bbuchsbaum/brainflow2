<!--
  ContextMenu Component
  A reusable context menu that can be positioned at specific coordinates
-->
<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { createEventDispatcher } from 'svelte';

	// Props
	let {
		visible = false,
		x = 0,
		y = 0,
		items = []
	}: {
		visible?: boolean;
		x?: number;
		y?: number;
		items?: Array<{
			label: string;
			icon?: any;
			action: () => void;
			divider?: boolean;
			disabled?: boolean;
		}>;
	} = $props();

	// Event dispatcher
	const dispatch = createEventDispatcher();

	// State
	let menuElement: HTMLDivElement | null = null;
	let adjustedX = $state(x);
	let adjustedY = $state(y);

	// Adjust position to ensure menu stays within viewport
	function adjustPosition() {
		if (!menuElement || !visible) return;

		const rect = menuElement.getBoundingClientRect();
		const viewportWidth = window.innerWidth;
		const viewportHeight = window.innerHeight;

		// Adjust X position
		if (x + rect.width > viewportWidth) {
			adjustedX = x - rect.width;
		} else {
			adjustedX = x;
		}

		// Adjust Y position
		if (y + rect.height > viewportHeight) {
			adjustedY = y - rect.height;
		} else {
			adjustedY = y;
		}
	}

	// Handle click outside
	function handleClickOutside(event: MouseEvent) {
		if (menuElement && !menuElement.contains(event.target as Node)) {
			dispatch('close');
		}
	}

	// Handle item click
	function handleItemClick(item: typeof items[0]) {
		if (!item.disabled) {
			item.action();
			dispatch('close');
		}
	}

	// Handle keyboard navigation
	function handleKeyDown(event: KeyboardEvent) {
		if (event.key === 'Escape') {
			dispatch('close');
		}
	}

	// Effects
	$effect(() => {
		if (visible) {
			adjustPosition();
			document.addEventListener('mousedown', handleClickOutside);
			document.addEventListener('keydown', handleKeyDown);
		} else {
			document.removeEventListener('mousedown', handleClickOutside);
			document.removeEventListener('keydown', handleKeyDown);
		}
	});

	// Lifecycle
	onDestroy(() => {
		document.removeEventListener('mousedown', handleClickOutside);
		document.removeEventListener('keydown', handleKeyDown);
	});
</script>

{#if visible}
	<div
		bind:this={menuElement}
		class="context-menu"
		style="left: {adjustedX}px; top: {adjustedY}px"
		role="menu"
		aria-label="Context menu"
	>
		{#each items as item, index}
			{#if item.divider}
				<div class="menu-divider" role="separator"></div>
			{:else}
				<button
					class="menu-item"
					class:disabled={item.disabled}
					onclick={() => handleItemClick(item)}
					disabled={item.disabled}
					role="menuitem"
					tabindex={item.disabled ? -1 : 0}
				>
					{#if item.icon}
						<svelte:component this={item.icon} size={14} class="menu-icon" />
					{/if}
					<span class="menu-label">{item.label}</span>
				</button>
			{/if}
		{/each}
	</div>
{/if}

<style>
	.context-menu {
		position: fixed;
		z-index: var(--z-popover, 1000);
		min-width: 160px;
		padding: var(--spacing-1);
		background-color: var(--color-surface-elevated);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		box-shadow: var(--shadow-lg);
		animation: fadeIn 150ms ease-out;
	}

	@keyframes fadeIn {
		from {
			opacity: 0;
			transform: translateY(-4px);
		}
		to {
			opacity: 1;
			transform: translateY(0);
		}
	}

	.menu-item {
		display: flex;
		align-items: center;
		gap: var(--spacing-2);
		width: 100%;
		padding: var(--spacing-1) var(--spacing-2);
		background: none;
		border: none;
		border-radius: var(--radius-base);
		color: var(--color-text-primary);
		font-size: var(--font-size-sm);
		text-align: left;
		cursor: pointer;
		transition: all var(--transition-fast);
		user-select: none;
	}

	.menu-item:hover:not(.disabled) {
		background-color: var(--color-hover);
	}

	.menu-item:focus-visible {
		outline: 2px solid var(--color-border-focus);
		outline-offset: -2px;
	}

	.menu-item.disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	:global(.menu-icon) {
		flex-shrink: 0;
		opacity: 0.7;
	}

	.menu-label {
		flex: 1;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.menu-divider {
		height: 1px;
		margin: var(--spacing-1) 0;
		background-color: var(--color-border);
	}

	/* Dark theme adjustments */
	:global(.dark) .context-menu {
		background-color: var(--color-surface-900, #1a1a1a);
		border-color: var(--color-surface-700, #333);
	}
</style>