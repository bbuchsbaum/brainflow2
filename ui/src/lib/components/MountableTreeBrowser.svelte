<script lang="ts">
	import { getContext, tick, onMount, onDestroy } from 'svelte';
	import type { ComponentContainer } from 'golden-layout';
	import { getGlContainer } from '$lib/layout/glUtils';
	import { coreApi } from '$lib/api';
	import { useVolumeStore } from '$lib/stores/volumeStore';
	import { useLayerStore } from '$lib/stores/layerStore';
	import { mountStore, useMountStore, FILE_PATTERNS, type FilePatternKey } from '$lib/stores/mountStore';
	import { nanoid } from 'nanoid';
	import type { LayerSpec, FlatNode, TreePayload } from '$lib/api';
	import { listen } from '@tauri-apps/api/event';
	import { invoke } from '@tauri-apps/api/core';
	import { waitForTauri } from '$lib/tauri-ready';
	import FileIcon from '$lib/components/icons/FileIcon.svelte';
	import { RefreshCw, Filter, X, ChevronRight, ChevronDown, Folder } from 'lucide-svelte';

	// --- Component State ---
	let container: ComponentContainer | undefined;
	let isLoading = $state(false);
	let errorMsg: string | null = $state(null);
	let treeNodesMap = $state(new Map<string, FlatNode[]>()); // Map mount ID to nodes
	let nodeMapByMount = $state(new Map<string, Map<string, FlatNode>>()); // Map mount ID to node map
	let childrenMapByMount = $state(new Map<string, Map<string | null, FlatNode[]>>()); // Map mount ID to children map
	
	// Mount store subscriptions
	let mounts = $state(useMountStore().getAllMounts());
	let activeMountId = $state(useMountStore().activeMountId);
	
	// Subscribe to store changes
	$effect(() => {
		const unsubscribe = mountStore.subscribe((state) => {
			const newMounts = state.getAllMounts();
			console.log('📊 Mount store updated. Mounts:', newMounts.length, newMounts.map(m => ({ id: m.id, path: m.path })));
			mounts = newMounts;
			activeMountId = state.activeMountId;
		});
		
		// Log initial state
		console.log('📊 Initial mounts:', mounts.length, mounts.map(m => ({ id: m.id, path: m.path })));
		
		return unsubscribe;
	});
	
	// File filter dialog state
	let showFilterDialog = $state(false);
	let filterDialogMountId: string | null = $state(null);
	let selectedPatterns: string[] = $state([]);
	
	// Selection state
	let selectedNodeId: string | null = $state(null);
	
	// Click handling state for distinguishing single/double clicks
	let clickTimeouts = new Map<string, number>();

	// --- Effects ---
	let unlistenMount: (() => void) | null = null;
	
	// Setup event listener in a separate effect to ensure it's always active
	$effect(() => {
		let localUnlisten: (() => void) | null = null;
		
		(async () => {
			// Wait for Tauri to be ready
			await waitForTauri();
			
			// Listen for mount directory events from the native menu
			try {
				console.log('🔧 Setting up mount-directory-event listener...');
				localUnlisten = await listen('mount-directory-event', async (event: any) => {
					console.log('🔔 Received mount directory event:', event);
					const path = event.payload?.path;
					if (path) {
						console.log('📁 Processing mount directory path:', path);
						await handleMountFromMenu(path);
					} else {
						console.error('❌ No path in mount directory event payload:', event.payload);
					}
				});
				console.log('✅ Mount directory event listener registered successfully');
				unlistenMount = localUnlisten;
			} catch (error) {
				console.error('❌ Failed to register mount directory event listener:', error);
			}
		})();
		
		// Cleanup function
		return () => {
			if (localUnlisten) {
				console.log('🧹 Cleaning up mount directory event listener');
				localUnlisten();
			}
		};
	});
	
	onMount(async () => {
		container = getGlContainer();
		
		await tick();
		console.log("MountableTreeBrowser initialized.");
		
		// Mount default directory if no mounts exist
		if (mounts.length === 0) {
			const defaultPath = "/Users/bbuchsbaum/code/brainflow2/test-data";
			useMountStore().mountDirectory(defaultPath, "Test Data");
		}
		
		// Load initial directories for all mounts
		for (const mount of mounts) {
			loadDirectory(mount.id, mount.path);
		}
	});
	
	onDestroy(() => {
		if (unlistenMount) {
			unlistenMount();
		}
	});

	// Rebuild maps whenever tree nodes change for a mount
	function rebuildMapsForMount(mountId: string, nodes: FlatNode[]) {
		console.log(`Rebuilding tree maps for mount ${mountId}...`);
		const newNodes = new Map<string, FlatNode>();
		const newChildren = new Map<string | null, FlatNode[]>();
		newChildren.set(null, []); // Initialize root children

		for (const [index, node] of nodes.entries()) {
			newNodes.set(node.id, node);
			const parentId = node.parent_idx !== null && node.parent_idx !== undefined && node.parent_idx < nodes.length 
				? nodes[node.parent_idx].id 
				: null;

			if (!newChildren.has(parentId)) {
				newChildren.set(parentId, []);
			}
			newChildren.get(parentId)!.push(node);
		}
		
		// Sort children alphabetically (directories first, then files)
		for (const children of newChildren.values()) {
			children.sort((a, b) => {
				if (a.is_dir !== b.is_dir) {
					return a.is_dir ? -1 : 1; // Directories first
				}
				return a.name.localeCompare(b.name); // Then alphabetical
			});
		}

		nodeMapByMount.set(mountId, newNodes);
		childrenMapByMount.set(mountId, newChildren);
		console.log(`Tree maps rebuilt for mount ${mountId}.`);
	}

	// --- Event Handlers ---
	let showMountDialog = $state(false);
	let mountPath = $state('');
	
	// Handle mount from native menu
	async function handleMountFromMenu(path: string) {
		console.log('📍 handleMountFromMenu called with path:', path);
		try {
			const label = path.split('/').pop() || path;
			console.log('📍 Creating mount with label:', label);
			const mountId = useMountStore().mountDirectory(path, label);
			console.log('📍 Mount created with ID:', mountId);
			await loadDirectory(mountId, path);
			console.log('📍 Directory loaded successfully');
			
			// Update dynamic menus with current mounts
			await updateDynamicMenus();
			console.log('📍 Dynamic menus updated');
		} catch (error) {
			console.error("❌ Error mounting directory from menu:", error);
			errorMsg = "Failed to mount directory";
		}
	}
	
	// Update the backend menus with current state
	async function updateDynamicMenus() {
		const currentMounts = mounts.map(m => ({
			id: m.id,
			path: m.path
		}));
		
		try {
			await invoke('update_dynamic_menus', { mounted: currentMounts });
		} catch (error) {
			console.error("Failed to update dynamic menus:", error);
		}
	}
	
	function handleMountDirectory() {
		showMountDialog = true;
		mountPath = '';
	}
	
	async function confirmMount() {
		if (!mountPath) return;
		
		try {
			const label = mountPath.split('/').pop() || mountPath;
			const mountId = useMountStore().mountDirectory(mountPath, label);
			await loadDirectory(mountId, mountPath);
			showMountDialog = false;
			mountPath = '';
			
			// Update dynamic menus
			await updateDynamicMenus();
		} catch (error) {
			console.error("Error mounting directory:", error);
			errorMsg = "Failed to mount directory";
		}
	}

	async function loadDirectory(mountId: string, dir: string) {
		if (isLoading) return;
		isLoading = true;
		errorMsg = null;
		
		console.log(`Loading directory for mount ${mountId}: ${dir}`);
		try {
			const payload = await coreApi.fs_list_directory(dir);
			await tick();
			
			// Filter nodes based on mount's file patterns
			const mount = useMountStore().getMountById(mountId);
			let filteredNodes = payload.nodes;
			
			if (mount && mount.filePatterns.length > 0) {
				filteredNodes = payload.nodes.filter(node => {
					if (node.is_dir) return true; // Always show directories
					
					// Check if file matches any of the patterns
					const lowerName = node.name.toLowerCase();
					return mount.filePatterns.some(pattern => {
						if (pattern.endsWith('.gz') && lowerName.endsWith('.gz')) {
							// Special handling for .nii.gz files
							const basePattern = pattern.slice(0, -3); // Remove .gz
							return lowerName.endsWith(pattern) || 
								   (lowerName.endsWith('.gz') && lowerName.slice(0, -3).endsWith(basePattern));
						}
						return lowerName.endsWith(pattern);
					});
				});
			}
			
			treeNodesMap.set(mountId, filteredNodes);
			rebuildMapsForMount(mountId, filteredNodes);
			console.log(`Loaded ${filteredNodes.length} nodes for mount ${mountId}.`);
		} catch (error: any) {
			console.error(`Error listing directory ${dir}: ${JSON.stringify(error)}`);
			errorMsg = error?.message || 'Failed to list directory.';
			treeNodesMap.set(mountId, []);
		} finally {
			isLoading = false;
		}
	}

	function handleNodeClick(mountId: string, node: FlatNode) {
		if (node.is_dir) {
			console.log(`Directory clicked: ${node.id}`);
			loadDirectory(mountId, node.id);
		} else {
			// Single click - just select the file, don't load it
			console.log(`File selected: ${node.id}`);
			selectedNodeId = node.id;
		}
	}

	function handleNodeDoubleClick(mountId: string, node: FlatNode) {
		console.log(`Node double-clicked:`, node);
		if (!node.is_dir) {
			console.log(`File double-clicked: ${node.id}`);
			handleSingleFile(node.id, node.name);
		} else {
			console.log(`Directory double-clicked: ${node.id}`);
		}
	}

	async function handleSingleFile(fullPath: string, fileName: string) {
		if (isLoading) return;
		isLoading = true;
		errorMsg = null;

		try {
			console.log(`Loading file: ${fileName} from path: ${fullPath}`);
			const handleInfo = await coreApi.load_file(fullPath);
			console.log('File loaded successfully:', handleInfo);
			
			useVolumeStore.getState().add(handleInfo);

			const layerId = `layer-${nanoid(5)}`;
			const defaultLayerSpec: LayerSpec = {
				Volume: {
					id: layerId,
					source_resource_id: handleInfo.id,
					colormap: 'grayscale',
					slice_axis: null,
					slice_index: null
				}
			};
			console.log('Adding default layer spec:', defaultLayerSpec);
			useLayerStore.getState().addLayer(defaultLayerSpec);
			useLayerStore.getState().requestGpuResources(layerId);

			// The VolumeView will automatically pick up the new layer through the store subscription
			console.log('Layer added, VolumeView should update automatically');

		} catch (error: unknown) {
			console.error(`Error loading file ${fileName}:`, error);
			let message = `Failed to load ${fileName}.`;
			if (error instanceof Error) {
				message = error.message;
			} else if (typeof error === 'string') {
				message = error;
			} else if (error && typeof error === 'object' && 'message' in error) {
				message = String((error as any).message);
			}
			errorMsg = message;
		} finally {
			isLoading = false;
		}
	}

	function showFilterDialogForMount(mountId: string) {
		const mount = useMountStore().getMountById(mountId);
		if (mount) {
			filterDialogMountId = mountId;
			selectedPatterns = [...mount.filePatterns];
			showFilterDialog = true;
		}
	}

	function applyFilters() {
		if (filterDialogMountId) {
			useMountStore().updateMountPatterns(filterDialogMountId, selectedPatterns);
			const mount = useMountStore().getMountById(filterDialogMountId);
			if (mount) {
				loadDirectory(filterDialogMountId, mount.path);
			}
		}
		showFilterDialog = false;
		filterDialogMountId = null;
	}

	function togglePattern(pattern: string) {
		const index = selectedPatterns.indexOf(pattern);
		if (index >= 0) {
			selectedPatterns = selectedPatterns.filter(p => p !== pattern);
		} else {
			selectedPatterns = [...selectedPatterns, pattern];
		}
	}

	function selectPreset(key: FilePatternKey) {
		selectedPatterns = [...FILE_PATTERNS[key]];
	}
	
	// Svelte action for handling click/double-click intelligently
	function clickHandler(node: HTMLElement, params: { mountId: string, treeNode: FlatNode }) {
		const DOUBLE_CLICK_DELAY = 300; // ms
		
		function handleClick(event: MouseEvent) {
			event.preventDefault();
			
			const nodeId = params.treeNode.id;
			const existingTimeout = clickTimeouts.get(nodeId);
			
			if (existingTimeout) {
				// This is a double-click
				clearTimeout(existingTimeout);
				clickTimeouts.delete(nodeId);
				console.log(`Double-click detected on: ${params.treeNode.name}`);
				handleNodeDoubleClick(params.mountId, params.treeNode);
			} else {
				// First click - wait to see if it's a double-click
				const timeoutId = window.setTimeout(() => {
					clickTimeouts.delete(nodeId);
					console.log(`Single-click confirmed on: ${params.treeNode.name}`);
					handleNodeClick(params.mountId, params.treeNode);
				}, DOUBLE_CLICK_DELAY);
				
				clickTimeouts.set(nodeId, timeoutId);
			}
		}
		
		node.addEventListener('click', handleClick);
		
		return {
			destroy() {
				node.removeEventListener('click', handleClick);
				// Clean up any pending timeouts
				const nodeId = params.treeNode.id;
				const timeout = clickTimeouts.get(nodeId);
				if (timeout) {
					clearTimeout(timeout);
					clickTimeouts.delete(nodeId);
				}
			}
		};
	}


	// Handle drag start for files
	function handleDragStart(event: DragEvent, node: FlatNode) {
		console.log('🎯 Drag start event fired for:', node.name, 'is_dir:', node.is_dir);
		
		if (node.is_dir) {
			console.log('❌ Cannot drag directories');
			event.preventDefault();
			return;
		}
		
		if (!event.dataTransfer) {
			console.error('❌ No dataTransfer available');
			return;
		}
		
		// Set drag data
		event.dataTransfer.effectAllowed = 'copy';
		const data = JSON.stringify({
			path: node.id,
			name: node.name
		});
		
		try {
			event.dataTransfer.setData('application/x-brainflow-file', data);
			event.dataTransfer.setData('text/plain', data); // Fallback
			console.log('✅ Drag data set successfully:', data);
			
			// Add visual feedback
			if (event.target instanceof HTMLElement) {
				event.target.style.opacity = '0.5';
			}
		} catch (error) {
			console.error('❌ Failed to set drag data:', error);
		}
	}
	
	// Handle drag end to reset visual feedback
	function handleDragEnd(event: DragEvent) {
		if (event.target instanceof HTMLElement) {
			event.target.style.opacity = '';
		}
		console.log('🎯 Drag ended');
	}
</script>

<!-- Recursive Tree Node Component -->
{#snippet renderChildren(mountId: string, parentId: string | null, level: number = 0)}
	{@const childrenMap = childrenMapByMount.get(mountId)}
	{@const children = childrenMap?.get(parentId)}
	{#if children && children.length > 0}
		<ul class="tree-list" style="padding-left: {level > 0 ? '1.25rem' : '0'}">
			{#each children as node (node.id)}
				{@const typedNode = node as FlatNode}
				<li 
					class="tree-item {selectedNodeId === typedNode.id ? 'selected' : ''}"
					use:clickHandler={{ mountId, treeNode: typedNode }}
					onkeydown={(e) => {
						if (e.key === 'Enter') {
							e.preventDefault();
							handleNodeDoubleClick(mountId, typedNode);
						}
					}}
					draggable={!typedNode.is_dir}
					ondragstart={(e) => handleDragStart(e, typedNode)}
					ondragend={handleDragEnd}
					role="treeitem"
					tabindex="0"
					title={typedNode.id}
				>
					<div class="tree-item-content">
						<FileIcon 
							fileName={typedNode.name} 
							isDirectory={typedNode.is_dir}
							isOpen={false}
							class="tree-icon"
						/>
						<span class="tree-label">{typedNode.name}</span>
					</div>
					{#if typedNode.is_dir}
						{@render renderChildren(mountId, typedNode.id, level + 1)}
					{/if}
				</li>
			{/each}
		</ul>
	{/if}
{/snippet}

<div class="tree-browser-container">
	{#if false}
	<!-- Keeping mount button code for reference, but using native menu instead -->
	<div class="toolbar">
		<button onclick={handleMountDirectory} class="toolbar-button">
			Mount Directory
		</button>
	</div>
	{/if}

	{#if errorMsg}
		<div class="feedback error">Error: {errorMsg}</div>
	{/if}

	<div class="mounts-container">
		{#if mounts.length === 0}
			<div class="empty-state">
				<p>No directories mounted</p>
				<p>Use <strong>File → Mount Directory...</strong> to add a folder</p>
				<p style="font-size: 0.8em; color: #999; margin-top: 20px;">
					Component ready • Event listener: {unlistenMount ? '✅' : '⏳'}
				</p>
			</div>
		{:else}
			{#each mounts as mount (mount.id)}
				{@const nodes = treeNodesMap.get(mount.id) || []}
				{@const isActive = mount.id === activeMountId}
				<div class="mount-section" class:active={isActive}>
					<div class="mount-header">
						<button 
							class="expand-button"
							onclick={() => useMountStore().toggleMountExpanded(mount.id)}
							aria-label={mount.isExpanded ? 'Collapse' : 'Expand'}
						>
							{#if mount.isExpanded}
								<ChevronDown size={16} />
							{:else}
								<ChevronRight size={16} />
							{/if}
						</button>
						<Folder class="mount-folder-icon" size={16} />
						<span 
							class="mount-label" 
							onclick={() => useMountStore().setActiveMountId(mount.id)}
							onkeydown={(e) => e.key === 'Enter' && useMountStore().setActiveMountId(mount.id)}
							role="button"
							tabindex="0"
							title={mount.path}
						>
							{mount.label}
						</span>
						<div class="mount-actions">
							<button 
								class="icon-button" 
								onclick={() => showFilterDialogForMount(mount.id)}
								title="Configure file filters"
								aria-label="Configure file filters"
							>
								<Filter size={16} />
							</button>
							<button 
								class="icon-button" 
								onclick={() => loadDirectory(mount.id, mount.path)}
								title="Refresh"
								aria-label="Refresh directory"
							>
								<RefreshCw size={16} />
							</button>
							<button 
								class="icon-button icon-button-danger" 
								onclick={async () => {
									useMountStore().unmountDirectory(mount.id);
									await updateDynamicMenus();
								}}
								title="Unmount"
								aria-label="Unmount directory"
							>
								<X size={16} />
							</button>
						</div>
					</div>
					
					{#if mount.isExpanded}
						<div class="tree-view">
							{#if isLoading && isActive}
								<p>Loading...</p>
							{:else if nodes.length > 0}
								{@render renderChildren(mount.id, null)}
							{:else}
								<p>No matching files found</p>
							{/if}
						</div>
					{/if}
				</div>
			{/each}
		{/if}
	</div>
</div>

<!-- Mount Dialog -->
{#if showMountDialog}
	<div class="dialog-overlay" onclick={() => showMountDialog = false}>
		<div class="dialog" onclick={(e) => e.stopPropagation()}>
			<h3>Mount Directory</h3>
			<div class="mount-form">
				<label>
					Directory Path:
					<input 
						type="text" 
						bind:value={mountPath}
						placeholder="/path/to/directory"
						class="mount-input"
						onkeydown={(e) => e.key === 'Enter' && confirmMount()}
					/>
				</label>
			</div>
			<div class="dialog-actions">
				<button onclick={() => showMountDialog = false} class="cancel-button">Cancel</button>
				<button onclick={confirmMount} class="apply-button" disabled={!mountPath}>Mount</button>
			</div>
		</div>
	</div>
{/if}

<!-- Filter Dialog -->
{#if showFilterDialog}
	<div class="dialog-overlay" onclick={() => showFilterDialog = false}>
		<div class="dialog" onclick={(e) => e.stopPropagation()}>
			<h3>Configure File Filters</h3>
			
			<div class="filter-presets">
				<h4>Presets:</h4>
				<button onclick={() => selectPreset('nifti')} class="preset-button">NIfTI</button>
				<button onclick={() => selectPreset('gifti')} class="preset-button">GIfTI</button>
				<button onclick={() => selectPreset('image')} class="preset-button">Images</button>
				<button onclick={() => selectPreset('data')} class="preset-button">Data</button>
				<button onclick={() => selectPreset('all')} class="preset-button">All Files</button>
			</div>
			
			<div class="filter-patterns">
				<h4>File Extensions:</h4>
				<div class="pattern-grid">
					{#each ['.nii', '.nii.gz', '.gii', '.gii.gz', '.png', '.jpg', '.csv', '.tsv'] as pattern}
						<label class="pattern-checkbox">
							<input 
								type="checkbox" 
								checked={selectedPatterns.includes(pattern)}
								onchange={() => togglePattern(pattern)}
							/>
							{pattern}
						</label>
					{/each}
				</div>
			</div>
			
			<div class="dialog-actions">
				<button onclick={() => showFilterDialog = false} class="cancel-button">Cancel</button>
				<button onclick={applyFilters} class="apply-button">Apply</button>
			</div>
		</div>
	</div>
{/if}

<style>
	.tree-browser-container {
		height: 100%;
		display: flex;
		flex-direction: column;
		overflow: hidden;
		background-color: #fafafa;
		:global(.dark) & {
			background-color: #1a1a1a;
		}
	}

	.toolbar {
		padding: 8px;
		border-bottom: 1px solid #e5e7eb;
		display: flex;
		gap: 8px;
		:global(.dark) & {
			border-bottom-color: #374151;
		}
	}

	.toolbar-button {
		padding: 6px 12px;
		background-color: #3b82f6;
		color: white;
		border: none;
		border-radius: 6px;
		cursor: pointer;
		font-size: 14px;
		font-weight: 500;
		transition: background-color 0.2s;
	}

	.toolbar-button:hover {
		background-color: #2563eb;
	}

	.mounts-container {
		flex: 1;
		overflow-y: auto;
		padding: 12px;
	}

	.empty-state {
		text-align: center;
		padding: 40px 20px;
		color: #6b7280;
		:global(.dark) & {
			color: #9ca3af;
		}
	}

	.mount-section {
		margin-bottom: 12px;
		border: 1px solid #e5e7eb;
		border-radius: 8px;
		overflow: hidden;
		background: white;
		transition: all 0.2s;
		:global(.dark) & {
			border-color: #374151;
			background: #262626;
		}
	}

	.mount-section.active {
		border-color: #3b82f6;
		box-shadow: 0 0 0 2px rgba(59, 130, 246, 0.2);
	}

	.mount-header {
		display: flex;
		align-items: center;
		padding: 10px 12px;
		background-color: #f9fafb;
		user-select: none;
		gap: 8px;
		:global(.dark) & {
			background-color: #1f1f1f;
		}
	}

	.mount-section.active .mount-header {
		background-color: #eff6ff;
		:global(.dark) & {
			background-color: #1e3a5f;
		}
	}

	.expand-button {
		border: none;
		background: none;
		cursor: pointer;
		padding: 2px;
		color: #6b7280;
		display: flex;
		align-items: center;
		transition: color 0.2s;
		:global(.dark) & {
			color: #9ca3af;
		}
	}

	.expand-button:hover {
		color: #374151;
		:global(.dark) & {
			color: #d1d5db;
		}
	}

	.mount-folder-icon {
		color: #3b82f6;
		flex-shrink: 0;
	}

	.mount-label {
		flex: 1;
		font-weight: 500;
		font-size: 14px;
		color: #111827;
		cursor: pointer;
		padding: 2px 4px;
		border-radius: 4px;
		transition: background-color 0.2s;
		:global(.dark) & {
			color: #f3f4f6;
		}
	}

	.mount-label:hover {
		background-color: rgba(0, 0, 0, 0.05);
		:global(.dark) & {
			background-color: rgba(255, 255, 255, 0.05);
		}
	}

	.mount-label:focus {
		outline: 2px solid #3b82f6;
		outline-offset: 2px;
	}

	.mount-actions {
		display: flex;
		gap: 2px;
		margin-left: auto;
	}

	.icon-button {
		border: none;
		background: none;
		cursor: pointer;
		padding: 6px;
		color: #6b7280;
		border-radius: 4px;
		transition: all 0.2s;
		display: flex;
		align-items: center;
		:global(.dark) & {
			color: #9ca3af;
		}
	}

	.icon-button:hover {
		background-color: rgba(0, 0, 0, 0.05);
		color: #374151;
		:global(.dark) & {
			background-color: rgba(255, 255, 255, 0.1);
			color: #d1d5db;
		}
	}

	.icon-button-danger:hover {
		background-color: #fee2e2;
		color: #dc2626;
		:global(.dark) & {
			background-color: rgba(220, 38, 38, 0.2);
			color: #ef4444;
		}
	}

	.tree-view {
		padding: 8px 12px;
		max-height: 400px;
		overflow-y: auto;
		background-color: white;
		:global(.dark) & {
			background-color: #262626;
		}
	}

	.tree-list {
		list-style: none;
		margin: 0;
	}

	.tree-item {
		cursor: pointer;
		outline: none;
		border-radius: 4px;
		transition: background-color 0.15s;
	}
	
	/* Apply user-select: none only to non-draggable items (directories) */
	.tree-item:not([draggable="true"]) {
		user-select: none;
	}

	.tree-item:hover {
		background-color: #f3f4f6;
		:global(.dark) & {
			background-color: #374151;
		}
	}

	/* Draggable file styles */
	.tree-item[draggable="true"] {
		cursor: grab;
	}

	.tree-item[draggable="true"]:active {
		cursor: grabbing;
		opacity: 0.5;
	}

	.tree-item:focus {
		outline: 2px solid #3b82f6;
		outline-offset: -2px;
	}

	.tree-item.selected {
		background-color: #e0f2fe;
		:global(.dark) & {
			background-color: #1e40af;
		}
	}

	.tree-item.selected:hover {
		background-color: #bae6fd;
		:global(.dark) & {
			background-color: #2563eb;
		}
	}

	.tree-item-content {
		display: flex;
		align-items: center;
		gap: 6px;
		padding: 4px 8px;
	}

	.tree-icon {
		flex-shrink: 0;
	}

	.tree-label {
		font-size: 13px;
		color: #374151;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		:global(.dark) & {
			color: #e5e7eb;
		}
	}

	.feedback {
		padding: 8px 12px;
		margin: 8px;
		border-radius: 4px;
	}

	.error {
		background-color: #f8d7da;
		color: #721c24;
		border: 1px solid #f5c6cb;
	}

	/* Dialog styles */
	.dialog-overlay {
		position: fixed;
		top: 0;
		left: 0;
		right: 0;
		bottom: 0;
		background-color: rgba(0, 0, 0, 0.5);
		display: flex;
		align-items: center;
		justify-content: center;
		z-index: 1000;
	}

	.dialog {
		background: white;
		border-radius: 8px;
		padding: 24px;
		min-width: 400px;
		max-width: 500px;
		box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
	}

	.dialog h3 {
		margin: 0 0 16px 0;
		font-size: 18px;
	}

	.dialog h4 {
		margin: 16px 0 8px 0;
		font-size: 14px;
		font-weight: 500;
		color: #666;
	}

	.mount-form {
		margin: 16px 0;
	}

	.mount-form label {
		display: block;
		font-size: 14px;
		color: #333;
	}

	.mount-input {
		width: 100%;
		padding: 8px;
		margin-top: 4px;
		border: 1px solid #ddd;
		border-radius: 4px;
		font-size: 14px;
	}

	.mount-input:focus {
		outline: none;
		border-color: #007bff;
		box-shadow: 0 0 0 1px #007bff;
	}

	.filter-presets {
		margin-bottom: 16px;
	}

	.preset-button {
		padding: 4px 12px;
		margin-right: 8px;
		background: #f0f0f0;
		border: 1px solid #ddd;
		border-radius: 4px;
		cursor: pointer;
		font-size: 13px;
	}

	.preset-button:hover {
		background: #e0e0e0;
	}

	.pattern-grid {
		display: grid;
		grid-template-columns: repeat(2, 1fr);
		gap: 8px;
	}

	.pattern-checkbox {
		display: flex;
		align-items: center;
		gap: 4px;
		cursor: pointer;
	}

	.dialog-actions {
		display: flex;
		justify-content: flex-end;
		gap: 8px;
		margin-top: 24px;
	}

	.cancel-button,
	.apply-button {
		padding: 6px 16px;
		border: none;
		border-radius: 4px;
		cursor: pointer;
		font-size: 14px;
	}

	.cancel-button {
		background: #f0f0f0;
		color: #333;
	}

	.cancel-button:hover {
		background: #e0e0e0;
	}

	.apply-button {
		background: #007bff;
		color: white;
	}

	.apply-button:hover {
		background: #0056b3;
	}
</style>