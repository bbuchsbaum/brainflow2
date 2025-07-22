<!--
  FileTreeItem Component
  A clean, reusable tree item component for file browsers
-->
<script lang="ts">
	import { createEventDispatcher } from 'svelte';
	import type { FlatNode } from '@brainflow/api';
	import { ChevronRight, ChevronDown, Folder, FolderOpen, Loader2 } from 'lucide-svelte';
	import FileIcon from '$lib/components/icons/FileIcon.svelte';

	// Props
	let {
		node,
		depth = 0,
		isSelected = false,
		isExpanded = false,
		isRenaming = false,
		isLoading = false
	}: {
		node: FlatNode;
		depth?: number;
		isSelected?: boolean;
		isExpanded?: boolean;
		isRenaming?: boolean;
		isLoading?: boolean;
	} = $props();

	// Event dispatcher
	const dispatch = createEventDispatcher();

	// State
	let renameValue = $state(node.name);
	let renameInput: HTMLInputElement | null = null;

	// Calculate indentation
	const indentSize = 20; // 20px per level
	const indent = depth * indentSize;

	// Handlers
	function handleClick(event: MouseEvent) {
		event.stopPropagation();
		dispatch('select', { node });
	}

	function handleDoubleClick(event: MouseEvent) {
		console.log('🔥 FileTreeItem handleDoubleClick fired!', {
			nodeId: node.id,
			nodeName: node.name,
			isDir: node.is_dir,
			fullNode: node
		});
		event.stopPropagation();
		dispatch('open', { node });
		console.log('✅ FileTreeItem dispatched open event');
	}

	function handleToggleExpand(event: MouseEvent) {
		event.stopPropagation();
		dispatch('toggle', { node });
	}

	function handleKeyDown(event: KeyboardEvent) {
		switch (event.key) {
			case 'Enter':
				if (isRenaming) {
					commitRename();
				} else {
					dispatch('open', { node });
				}
				break;
			case 'Escape':
				if (isRenaming) {
					cancelRename();
				}
				break;
			case 'F2':
				if (!isRenaming && !node.is_dir) {
					startRename();
				}
				break;
			case 'ArrowLeft':
				if (node.is_dir && isExpanded) {
					dispatch('toggle', { node });
				}
				break;
			case 'ArrowRight':
				if (node.is_dir && !isExpanded) {
					dispatch('toggle', { node });
				}
				break;
			case 'ArrowUp':
				event.preventDefault();
				dispatch('navigate', { direction: 'up' });
				break;
			case 'ArrowDown':
				event.preventDefault();
				dispatch('navigate', { direction: 'down' });
				break;
			case ' ':
			case 'Space':
				event.preventDefault();
				dispatch('select', { node });
				break;
		}
	}

	function handleContextMenu(event: MouseEvent) {
		event.preventDefault();
		dispatch('contextmenu', { node, x: event.clientX, y: event.clientY });
	}

	function handleDragStart(event: DragEvent) {
		if (node.is_dir) {
			event.preventDefault();
			return;
		}

		if (event.dataTransfer) {
			event.dataTransfer.effectAllowed = 'copy';
			const data = JSON.stringify({
				path: node.id,
				name: node.name
			});
			event.dataTransfer.setData('application/x-brainflow-file', data);
			event.dataTransfer.setData('text/plain', data);
		}

		dispatch('dragstart', { node });
	}

	function handleDragEnd(event: DragEvent) {
		dispatch('dragend', { node });
	}

	function startRename() {
		dispatch('rename-start', { node });
		renameValue = node.name;
	}

	function commitRename() {
		if (renameValue && renameValue !== node.name) {
			dispatch('rename-commit', { node, newName: renameValue });
		} else {
			cancelRename();
		}
	}

	function cancelRename() {
		renameValue = node.name;
		dispatch('rename-cancel', { node });
	}

	// Focus input when entering rename mode
	$effect(() => {
		if (isRenaming && renameInput) {
			renameInput.focus();
			renameInput.select();
		}
	});
</script>

<div
	class="tree-item"
	class:selected={isSelected}
	class:directory={node.is_dir}
	style="padding-left: {indent}px"
	onclick={handleClick}
	ondblclick={handleDoubleClick}
	onkeydown={handleKeyDown}
	oncontextmenu={handleContextMenu}
	draggable={!node.is_dir}
	ondragstart={handleDragStart}
	ondragend={handleDragEnd}
	role="treeitem"
	tabindex={isSelected ? 0 : -1}
	aria-selected={isSelected}
	aria-expanded={node.is_dir ? isExpanded : undefined}
	aria-level={depth + 1}
>
	<div class="tree-item-content">
		{#if node.is_dir}
			<button
				class="expand-button"
				onclick={handleToggleExpand}
				aria-label={isExpanded ? 'Collapse folder' : 'Expand folder'}
				tabindex="-1"
				disabled={isLoading}
			>
				{#if isLoading}
					<Loader2 size={16} class="loading-spinner" />
				{:else if isExpanded}
					<ChevronDown size={16} />
				{:else}
					<ChevronRight size={16} />
				{/if}
			</button>
			{#if isExpanded}
				<FolderOpen size={16} class="tree-icon folder-icon" />
			{:else}
				<Folder size={16} class="tree-icon folder-icon" />
			{/if}
		{:else}
			<div class="expand-spacer"></div>
			<FileIcon fileName={node.name} size={16} class="tree-icon file-icon" />
		{/if}

		{#if isRenaming}
			<input
				bind:this={renameInput}
				type="text"
				class="rename-input"
				bind:value={renameValue}
				onblur={commitRename}
				onkeydown={(e) => {
					if (e.key === 'Enter') {
						e.preventDefault();
						commitRename();
					} else if (e.key === 'Escape') {
						e.preventDefault();
						cancelRename();
					}
				}}
			/>
		{:else}
			<span class="tree-label" title={node.id}>
				{node.name}
			</span>
		{/if}
	</div>

	{#if depth > 0}
		<div class="indent-guide" style="left: {indent - indentSize + 8}px"></div>
	{/if}
</div>

<style>
	.tree-item {
		position: relative;
		display: flex;
		align-items: center;
		min-height: 28px;
		cursor: pointer;
		user-select: none;
		transition: background-color var(--transition-fast);
	}

	.tree-item:hover {
		background-color: rgba(255, 255, 255, 0.04);
	}

	.tree-item:focus {
		outline: none;
	}

	.tree-item:focus-visible {
		outline: 2px solid var(--color-border-focus);
		outline-offset: -2px;
	}

	.tree-item.selected {
		background-color: rgba(80, 180, 140, 0.2);
		border-left: 2px solid var(--color-primary-500);
	}

	.tree-item.selected .tree-label {
		color: var(--color-text-primary);
		font-weight: var(--font-weight-medium);
	}

	.tree-item-content {
		display: flex;
		align-items: center;
		gap: 6px;
		flex: 1;
		padding: 4px 8px;
		min-width: 0;
	}

	.expand-button {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 16px;
		height: 16px;
		padding: 0;
		background: none;
		border: none;
		color: var(--color-text-secondary);
		cursor: pointer;
		transition: all var(--transition-fast);
		flex-shrink: 0;
	}

	.expand-button:hover {
		color: var(--color-text-primary);
	}

	.expand-spacer {
		width: 16px;
		flex-shrink: 0;
	}

	:global(.tree-icon) {
		width: 16px;
		height: 16px;
		flex-shrink: 0;
		opacity: 0.6;
		transition: opacity var(--transition-fast);
	}

	.tree-item:hover :global(.tree-icon),
	.tree-item.selected :global(.tree-icon) {
		opacity: 1;
	}

	:global(.folder-icon) {
		color: var(--color-primary-500);
	}

	:global(.file-icon) {
		color: var(--color-text-secondary);
	}

	.tree-label {
		flex: 1;
		font-size: var(--font-ui-sm);
		color: var(--color-text-primary);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		line-height: 1.4;
	}

	.rename-input {
		flex: 1;
		padding: 2px 4px;
		font-size: var(--font-ui-sm);
		font-family: inherit;
		background-color: var(--color-surface);
		color: var(--color-text-primary);
		border: 1px solid var(--color-primary-500);
		border-radius: var(--radius-sm);
		outline: none;
	}

	.indent-guide {
		position: absolute;
		top: 0;
		bottom: 0;
		width: 1px;
		background-color: rgba(255, 255, 255, 0.06);
		pointer-events: none;
	}

	/* Animations */
	.expand-button {
		transform-origin: center;
		transition: transform var(--transition-fast);
	}
	
	.expand-button:disabled {
		cursor: wait;
		opacity: 0.8;
	}
	
	:global(.loading-spinner) {
		animation: spin 1s linear infinite;
	}
	
	@keyframes spin {
		from {
			transform: rotate(0deg);
		}
		to {
			transform: rotate(360deg);
		}
	}

	/* Drag styles */
	.tree-item[draggable='true'] {
		cursor: grab;
	}

	.tree-item[draggable='true']:active {
		cursor: grabbing;
		opacity: 0.5;
	}

	/* Accessibility */
	.tree-item:focus-visible .tree-label {
		text-decoration: underline;
		text-decoration-style: dotted;
		text-underline-offset: 2px;
	}

	/* Dark theme adjustments */
	:global(.dark) .tree-item:hover {
		background-color: rgba(255, 255, 255, 0.02);
	}

	:global(.dark) .indent-guide {
		background-color: rgba(255, 255, 255, 0.04);
	}
</style>