<!--
  LayerMenu Component
  Dropdown menu for secondary layer actions
-->
<script lang="ts">
	import { createEventDispatcher, onMount, onDestroy } from 'svelte';
	import { fade } from 'svelte/transition';
	import { 
		Trash2, 
		Copy, 
		Download, 
		Settings, 
		Sliders,
		Info,
		Eye,
		EyeOff
	} from 'lucide-svelte';
	
	export let x: number = 0;
	export let y: number = 0;
	export let visible: boolean = false;
	export let layerVisible: boolean = true;
	
	const dispatch = createEventDispatcher();
	
	let menuElement: HTMLDivElement;
	
	// Position menu to avoid viewport edges
	$: menuStyle = (() => {
		if (!menuElement) return `left: ${x}px; top: ${y}px;`;
		
		const rect = menuElement.getBoundingClientRect();
		const viewportWidth = window.innerWidth;
		const viewportHeight = window.innerHeight;
		
		let left = x;
		let top = y;
		
		// Adjust if menu would go off right edge
		if (x + rect.width > viewportWidth - 10) {
			left = viewportWidth - rect.width - 10;
		}
		
		// Adjust if menu would go off bottom edge
		if (y + rect.height > viewportHeight - 10) {
			top = viewportHeight - rect.height - 10;
		}
		
		return `left: ${left}px; top: ${top}px;`;
	})();
	
	// Menu items
	const menuItems = [
		{
			id: 'visibility',
			label: layerVisible ? 'Hide Layer' : 'Show Layer',
			icon: layerVisible ? EyeOff : Eye,
			action: 'toggle-visibility'
		},
		{ divider: true },
		{
			id: 'duplicate',
			label: 'Duplicate Layer',
			icon: Copy,
			action: 'duplicate'
		},
		{
			id: 'export',
			label: 'Export Layer',
			icon: Download,
			action: 'export'
		},
		{ divider: true },
		{
			id: 'threshold',
			label: 'Threshold Settings',
			icon: Sliders,
			action: 'threshold'
		},
		{
			id: 'properties',
			label: 'Layer Properties',
			icon: Settings,
			action: 'properties'
		},
		{
			id: 'info',
			label: 'Layer Information',
			icon: Info,
			action: 'info'
		},
		{ divider: true },
		{
			id: 'delete',
			label: 'Delete Layer',
			icon: Trash2,
			action: 'delete',
			destructive: true
		}
	];
	
	// Handle menu item click
	function handleItemClick(action: string) {
		dispatch('action', action);
		dispatch('close');
	}
	
	// Close menu on outside click
	function handleOutsideClick(e: MouseEvent) {
		if (menuElement && !menuElement.contains(e.target as Node)) {
			dispatch('close');
		}
	}
	
	// Close menu on escape
	function handleKeydown(e: KeyboardEvent) {
		if (e.key === 'Escape') {
			dispatch('close');
		}
	}
	
	// Setup/cleanup event listeners
	onMount(() => {
		window.addEventListener('click', handleOutsideClick);
		window.addEventListener('keydown', handleKeydown);
	});
	
	onDestroy(() => {
		window.removeEventListener('click', handleOutsideClick);
		window.removeEventListener('keydown', handleKeydown);
	});
</script>

{#if visible}
	<div 
		class="layer-menu"
		bind:this={menuElement}
		style={menuStyle}
		transition:fade={{ duration: 120 }}
		role="menu"
		aria-label="Layer options"
	>
		{#each menuItems as item}
			{#if item.divider}
				<div class="menu-divider" role="separator" />
			{:else}
				<button
					class="menu-item"
					class:destructive={item.destructive}
					on:click={() => handleItemClick(item.action)}
					role="menuitem"
				>
					<span class="menu-icon">
						<svelte:component this={item.icon} size={14} />
					</span>
					<span class="menu-label">{item.label}</span>
				</button>
			{/if}
		{/each}
	</div>
{/if}

<style>
	.layer-menu {
		position: fixed;
		z-index: 1000;
		min-width: 180px;
		padding: var(--spacing-1);
		background: var(--color-surface-elevated);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-base);
		box-shadow: 
			0 2px 8px rgba(0, 0, 0, 0.1),
			0 8px 24px rgba(0, 0, 0, 0.15);
		font-size: 12px;
	}
	
	.menu-item {
		display: flex;
		align-items: center;
		gap: var(--spacing-2);
		width: 100%;
		padding: 6px 10px;
		background: none;
		border: none;
		border-radius: var(--radius-sm);
		color: var(--color-text-primary);
		text-align: left;
		cursor: pointer;
		transition: all var(--transition-fast);
	}
	
	.menu-item:hover {
		background: var(--color-base-500);
	}
	
	.menu-item:active {
		transform: scale(0.98);
	}
	
	.menu-item:focus-visible {
		outline: 2px solid var(--color-primary-500);
		outline-offset: -2px;
	}
	
	.menu-item.destructive {
		color: var(--color-error);
	}
	
	.menu-item.destructive:hover {
		background: var(--color-error);
		color: white;
	}
	
	.menu-icon {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 16px;
		height: 16px;
		flex-shrink: 0;
	}
	
	.menu-label {
		flex: 1;
		font-weight: 400;
	}
	
	.menu-divider {
		height: 1px;
		margin: var(--spacing-1) 0;
		background: var(--color-border);
	}
</style>