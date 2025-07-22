<!--
  PanelHeader Component
  Standardized header for all panels with consistent styling and actions
-->
<script lang="ts">
	import { createEventDispatcher } from 'svelte';
	import { X, Minus, Maximize2, MoreVertical } from 'lucide-svelte';

	// Props
	let {
		title = 'Panel',
		showClose = true,
		showMinimize = true,
		showMaximize = true,
		showMenu = false,
		menuItems = [],
		className = ''
	}: {
		title?: string;
		showClose?: boolean;
		showMinimize?: boolean;
		showMaximize?: boolean;
		showMenu?: boolean;
		menuItems?: Array<{ label: string; action: () => void; icon?: any }>;
		className?: string;
	} = $props();

	// Event dispatcher
	const dispatch = createEventDispatcher();

	// State
	let showDropdown = $state(false);

	// Handlers
	function handleClose() {
		dispatch('close');
	}

	function handleMinimize() {
		dispatch('minimize');
	}

	function handleMaximize() {
		dispatch('maximize');
	}

	function toggleDropdown() {
		showDropdown = !showDropdown;
	}

	function handleMenuItemClick(item: { label: string; action: () => void }) {
		item.action();
		showDropdown = false;
	}

	// Close dropdown when clicking outside
	function handleClickOutside(event: MouseEvent) {
		const target = event.target as HTMLElement;
		if (!target.closest('.menu-container')) {
			showDropdown = false;
		}
	}

	$effect(() => {
		if (showDropdown) {
			document.addEventListener('click', handleClickOutside);
			return () => {
				document.removeEventListener('click', handleClickOutside);
			};
		}
	});
</script>

<div class="panel-header {className}">
	<h3 class="panel-title" title={title}>
		{title}
	</h3>

	<div class="panel-actions">
		<!-- Custom slot for additional actions -->
		<slot name="actions" />

		<!-- Menu dropdown -->
		{#if showMenu && menuItems.length > 0}
			<div class="menu-container">
				<button
					class="panel-action"
					onclick={toggleDropdown}
					title="More options"
					aria-label="More options"
					aria-expanded={showDropdown}
				>
					<MoreVertical size={16} />
				</button>

				{#if showDropdown}
					<div class="dropdown-menu">
						{#each menuItems as item}
							<button
								class="menu-item"
								onclick={() => handleMenuItemClick(item)}
								title={item.label}
							>
								{#if item.icon}
									<svelte:component this={item.icon} size={14} />
								{/if}
								<span>{item.label}</span>
							</button>
						{/each}
					</div>
				{/if}
			</div>
		{/if}

		<!-- Standard actions -->
		{#if showMinimize}
			<button
				class="panel-action"
				onclick={handleMinimize}
				title="Minimize"
				aria-label="Minimize panel"
			>
				<Minus size={16} />
			</button>
		{/if}

		{#if showMaximize}
			<button
				class="panel-action"
				onclick={handleMaximize}
				title="Maximize"
				aria-label="Maximize panel"
			>
				<Maximize2 size={16} />
			</button>
		{/if}

		{#if showClose}
			<button
				class="panel-action panel-action-close"
				onclick={handleClose}
				title="Close"
				aria-label="Close panel"
			>
				<X size={16} />
			</button>
		{/if}
	</div>
</div>

<style>
	.panel-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		height: var(--height-panel-header);
		padding: 0 var(--spacing-2);
		background-color: var(--color-panel-header);
		border-bottom: 1px solid var(--color-border);
		user-select: none;
		flex-shrink: 0;
	}

	.panel-title {
		margin: 0;
		font-size: var(--font-size-base);
		font-weight: var(--font-weight-medium);
		color: var(--color-text-primary);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		flex: 1;
		min-width: 0;
	}

	.panel-actions {
		display: flex;
		align-items: center;
		gap: var(--spacing-1);
		margin-left: var(--spacing-2);
	}

	.panel-action {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 28px;
		height: 28px;
		padding: 0;
		background: none;
		border: none;
		border-radius: var(--radius-base);
		color: var(--color-text-secondary);
		opacity: 0.6;
		cursor: pointer;
		transition: all var(--transition-fast);
	}

	.panel-action:hover {
		background-color: var(--color-hover);
		color: var(--color-text-primary);
		opacity: 1;
	}

	.panel-action:active {
		transform: scale(0.95);
	}

	.panel-action-close:hover {
		background-color: rgba(239, 68, 68, 0.1);
		color: var(--color-error);
	}

	.panel-action:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	/* Menu container */
	.menu-container {
		position: relative;
	}

	.dropdown-menu {
		position: absolute;
		top: 100%;
		right: 0;
		margin-top: var(--spacing-1);
		min-width: 160px;
		background-color: var(--color-surface-elevated);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		box-shadow: var(--shadow-lg);
		z-index: var(--z-dropdown);
		padding: var(--spacing-1);
	}

	.menu-item {
		display: flex;
		align-items: center;
		gap: var(--spacing-2);
		width: 100%;
		padding: var(--spacing-2) var(--spacing-2);
		background: none;
		border: none;
		border-radius: var(--radius-base);
		color: var(--color-text-primary);
		font-size: var(--font-size-sm);
		text-align: left;
		cursor: pointer;
		transition: all var(--transition-fast);
	}

	.menu-item:hover {
		background-color: var(--color-hover);
	}

	.menu-item:active {
		transform: scale(0.98);
	}

	/* Focus styles */
	.panel-action:focus-visible,
	.menu-item:focus-visible {
		outline: 2px solid var(--color-border-focus);
		outline-offset: -1px;
	}

	/* Slot styles */
	:global(.panel-header slot[name="actions"]) {
		display: contents;
	}
</style>