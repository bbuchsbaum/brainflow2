<!--
  FileBrowserPanel Component - Migrated to new architecture
  File browser panel with integrated layer management and event-driven architecture
-->
<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { getService } from '$lib/di/Container';
	import { getEventBus } from '$lib/events/EventBus';
	import type { VolumeService } from '$lib/services/VolumeService';
	import type { LayerService } from '$lib/services/LayerService';
	import type { ConfigService } from '$lib/services/ConfigService';
	import type { NotificationService } from '$lib/services/NotificationService';
	import type { EventBus } from '$lib/events/EventBus';
	import MountableTreeBrowser from '../MountableTreeBrowser.svelte';
	import type { FlatNode, LayerSpec } from '@brainflow/api';
	import { nanoid } from 'nanoid';

	// Props
	let {
		rootDirectory = '.',
		autoCreateLayers = true,
		defaultColormap = 'grayscale',
		acceptedExtensions = ['.nii', '.nii.gz', '.gii'],
		maxRecentFiles = 10
	}: {
		rootDirectory?: string;
		autoCreateLayers?: boolean;
		defaultColormap?: string;
		acceptedExtensions?: string[];
		maxRecentFiles?: number;
	} = $props();

	// Services
	let volumeService: VolumeService | null = null;
	let layerService: LayerService | null = null;
	let configService: ConfigService | null = null;
	let notificationService: NotificationService | null = null;
	let eventBus: EventBus = getEventBus();

	// State
	let isLoadingFile = $state(false);
	let recentFiles = $state<Array<{ path: string; name: string; timestamp: number }>>([]);
	let dragOver = $state(false);
	let currentLoadingFile = $state<string | null>(null);

	// Constants
	const RECENT_FILES_KEY = 'brainflow-recent-files';

	// Load recent files from config service
	async function loadRecentFiles() {
		if (!configService) return;
		
		try {
			const stored = await configService.get(RECENT_FILES_KEY, []);
			if (Array.isArray(stored)) {
				recentFiles = stored.filter(f => 
					f.path && f.name && typeof f.timestamp === 'number'
				);
			}
		} catch (error) {
			console.error('[FileBrowserPanel] Failed to load recent files:', error);
		}
	}

	// Save recent files to config service
	async function saveRecentFiles() {
		if (!configService) return;
		
		try {
			await configService.set(RECENT_FILES_KEY, recentFiles);
			eventBus.emit('filebrowser.recentfiles.updated', { files: recentFiles });
		} catch (error) {
			console.error('[FileBrowserPanel] Failed to save recent files:', error);
		}
	}

	// Handle file selection from tree browser
	async function handleFileSelected(file: FlatNode) {
		if (isLoadingFile || !volumeService || !layerService) return;
		
		// Validate file extension
		const hasValidExtension = acceptedExtensions.some(ext => 
			file.name.toLowerCase().endsWith(ext)
		);
		
		if (!hasValidExtension) {
			notificationService?.warning(`${file.name} is not a supported file type`);
			return;
		}
		
		isLoadingFile = true;
		currentLoadingFile = file.name;
		
		try {
			console.log('[FileBrowserPanel] Loading file:', file.id);
			
			// Emit loading start event
			eventBus.emit('filebrowser.file.loading', { 
				path: file.id, 
				name: file.name 
			});
			
			// Load the file through service
			const volumeId = await volumeService.loadVolume(file.id);
			console.log('[FileBrowserPanel] Volume loaded:', volumeId);
			
			// Auto-create layer if enabled
			if (autoCreateLayers) {
				const layerSpec: LayerSpec = {
					Volume: {
						id: `layer-${nanoid(8)}`,
						source_resource_id: volumeId,
						colormap: defaultColormap,
						slice_axis: null,
						slice_index: null
					}
				};
				
				console.log('[FileBrowserPanel] Creating layer:', layerSpec);
				const layerId = await layerService.addLayer(layerSpec);
				
				// Request GPU resources
				await layerService.requestGpuResources(layerSpec);
				
				// Auto-activate the new layer
				layerService.setActiveLayer(layerId);
			}
			
			// Add to recent files
			await addToRecentFiles(file.id, file.name);
			
			// Show success notification
			notificationService?.success(`Loaded ${file.name}`);
			
			// Emit success event
			eventBus.emit('filebrowser.file.loaded', { 
				path: file.id, 
				name: file.name,
				volumeId 
			});
			
		} catch (error) {
			console.error('[FileBrowserPanel] Failed to load file:', error);
			
			const errorMessage = error instanceof Error ? error.message : 'Unknown error';
			notificationService?.error(`Failed to load ${file.name}`, { 
				error: error instanceof Error ? error : undefined 
			});
			
			// Emit error event
			eventBus.emit('filebrowser.file.error', { 
				path: file.id, 
				name: file.name,
				error: errorMessage 
			});
		} finally {
			isLoadingFile = false;
			currentLoadingFile = null;
		}
	}

	// Add file to recent files list
	async function addToRecentFiles(path: string, name: string) {
		const newEntry = { path, name, timestamp: Date.now() };
		
		// Remove if already exists
		recentFiles = recentFiles.filter(f => f.path !== path);
		
		// Add to beginning
		recentFiles = [newEntry, ...recentFiles];
		
		// Keep only last N files
		if (recentFiles.length > maxRecentFiles) {
			recentFiles = recentFiles.slice(0, maxRecentFiles);
		}
		
		// Save to config service
		await saveRecentFiles();
	}

	// Load recent file
	async function loadRecentFile(path: string, name: string) {
		await handleFileSelected({ 
			id: path, 
			name, 
			is_dir: false, 
			parent_idx: null 
		} as FlatNode);
	}

	// Clear recent files
	async function clearRecentFiles() {
		if (!await confirmClearRecentFiles()) return;
		
		recentFiles = [];
		await saveRecentFiles();
		
		notificationService?.info('Recent files cleared');
		eventBus.emit('filebrowser.recentfiles.cleared');
	}

	// Confirm dialog for clearing recent files
	async function confirmClearRecentFiles(): Promise<boolean> {
		return notificationService?.confirm(
			'Clear Recent Files',
			'Are you sure you want to clear all recent files?'
		) ?? true;
	}

	// Handle file drop
	async function handleFileDrop(event: DragEvent) {
		event.preventDefault();
		dragOver = false;
		
		const files = event.dataTransfer?.files;
		if (!files || files.length === 0) return;
		
		const validFiles: File[] = [];
		
		for (const file of files) {
			// Check if file has valid extension
			const hasValidExtension = acceptedExtensions.some(ext => 
				file.name.toLowerCase().endsWith(ext)
			);
			
			if (hasValidExtension) {
				validFiles.push(file);
			} else {
				notificationService?.warning(`${file.name} is not a supported file type`);
			}
		}
		
		// Load valid files
		for (const file of validFiles) {
			// Get file path if available (Tauri provides this)
			const filePath = (file as any).path || file.name;
			await handleFileSelected({
				id: filePath,
				name: file.name,
				is_dir: false,
				parent_idx: null
			} as FlatNode);
		}
		
		if (validFiles.length > 0) {
			eventBus.emit('filebrowser.files.dropped', { 
				count: validFiles.length 
			});
		}
	}

	// Handle drag events
	function handleDragOver(event: DragEvent) {
		event.preventDefault();
		if (event.dataTransfer) {
			event.dataTransfer.dropEffect = 'copy';
		}
		dragOver = true;
	}

	function handleDragLeave(event: DragEvent) {
		event.preventDefault();
		dragOver = false;
	}

	// Handle directory change
	function handleDirectoryChanged(path: string) {
		console.log('[FileBrowserPanel] Directory changed to:', path);
		eventBus.emit('filebrowser.directory.changed', { path });
	}

	// Handle errors from tree browser
	function handleError(error: Error) {
		console.error('[FileBrowserPanel] Tree browser error:', error);
		notificationService?.error('File browser error', { error });
	}

	// Subscribe to events
	let eventUnsubscribes: Array<() => void> = [];

	function subscribeToEvents() {
		// Listen for external file load requests
		eventUnsubscribes.push(
			eventBus.on('filebrowser.load.requested', async ({ path, name }) => {
				await handleFileSelected({
					id: path,
					name: name || path.split('/').pop() || 'Unknown',
					is_dir: false,
					parent_idx: null
				} as FlatNode);
			})
		);

		// Listen for recent files clear request
		eventUnsubscribes.push(
			eventBus.on('filebrowser.recentfiles.clear', () => {
				clearRecentFiles();
			})
		);

		// Listen for config changes
		eventUnsubscribes.push(
			eventBus.on('config.changed', ({ key }) => {
				if (key === 'filebrowser.autoCreateLayers') {
					autoCreateLayers = configService?.get('filebrowser.autoCreateLayers', true) ?? true;
				} else if (key === 'filebrowser.defaultColormap') {
					defaultColormap = configService?.get('filebrowser.defaultColormap', 'grayscale') ?? 'grayscale';
				}
			})
		);
	}

	// Lifecycle
	onMount(async () => {
		try {
			// Get services
			[volumeService, layerService, configService, notificationService] = await Promise.all([
				getService<VolumeService>('volumeService'),
				getService<LayerService>('layerService'),
				getService<ConfigService>('configService'),
				getService<NotificationService>('notificationService')
			]);

			// Load recent files
			await loadRecentFiles();

			// Subscribe to events
			subscribeToEvents();

			// Emit ready event
			eventBus.emit('filebrowser.ready');

			// Cleanup
			return () => {
				eventUnsubscribes.forEach(fn => fn());
			};
		} catch (error) {
			console.error('[FileBrowserPanel] Failed to initialize:', error);
			notificationService?.error('Failed to initialize file browser');
		}
	});
</script>

<div 
	class="file-browser-panel"
	class:drag-over={dragOver}
	ondragover={handleDragOver}
	ondragleave={handleDragLeave}
	ondrop={handleFileDrop}
	role="region"
	aria-label="File browser"
>
	<!-- Main tree browser -->
	<div class="browser-section">
		<MountableTreeBrowser
			onFileDoubleClick={handleFileSelected}
			onError={handleError}
			acceptedExtensions={acceptedExtensions}
			showFileInfo={true}
		/>
	</div>
	
	<!-- Recent files section -->
	{#if recentFiles.length > 0}
		<div class="recent-files">
			<div class="section-header">
				<h3>Recent Files</h3>
				<button 
					class="clear-button"
					onclick={clearRecentFiles}
					title="Clear recent files"
					aria-label="Clear recent files"
				>
					Clear
				</button>
			</div>
			<div class="recent-list" role="list">
				{#each recentFiles as file}
					<button
						class="recent-item"
						onclick={() => loadRecentFile(file.path, file.name)}
						disabled={isLoadingFile}
						title={file.path}
						role="listitem"
						aria-label={`Load ${file.name}`}
					>
						<span class="file-icon" aria-hidden="true">📄</span>
						<span class="file-name">{file.name}</span>
						{#if currentLoadingFile === file.name}
							<span class="loading-indicator" aria-label="Loading">
								<span class="mini-spinner"></span>
							</span>
						{/if}
					</button>
				{/each}
			</div>
		</div>
	{/if}
	
	<!-- Loading overlay -->
	{#if isLoadingFile}
		<div class="loading-overlay" role="status" aria-live="polite">
			<div class="spinner"></div>
			<span>Loading {currentLoadingFile || 'file'}...</span>
		</div>
	{/if}
	
	<!-- Drop zone overlay -->
	{#if dragOver}
		<div class="drop-overlay" role="status" aria-live="polite">
			<div class="drop-message">
				<span>Drop {acceptedExtensions.join(', ')} files here</span>
			</div>
		</div>
	{/if}
</div>

<style>
	.file-browser-panel {
		display: flex;
		flex-direction: column;
		height: 100%;
		position: relative;
		background-color: var(--color-surface-900, #1a1a1a);
		transition: box-shadow 0.2s ease;
	}

	.browser-section {
		flex: 1;
		overflow: hidden;
		border-bottom: 1px solid var(--color-surface-700, #333);
	}

	.recent-files {
		background-color: var(--color-surface-800, #242424);
		border-top: 1px solid var(--color-surface-700, #333);
	}

	.section-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 8px 12px;
		border-bottom: 1px solid var(--color-surface-700, #333);
	}

	.section-header h3 {
		margin: 0;
		font-size: 14px;
		font-weight: 500;
		color: var(--color-text-primary, #e0e0e0);
		user-select: none;
	}

	.clear-button {
		padding: 4px 8px;
		font-size: 12px;
		background: none;
		border: 1px solid var(--color-surface-600, #444);
		color: var(--color-text-secondary, #999);
		cursor: pointer;
		border-radius: 4px;
		transition: all 0.2s;
	}

	.clear-button:hover {
		color: var(--color-text-primary, #e0e0e0);
		border-color: var(--color-text-primary, #e0e0e0);
		background-color: var(--color-surface-700, #333);
	}

	.clear-button:active {
		transform: translateY(1px);
	}

	.recent-list {
		max-height: 200px;
		overflow-y: auto;
		padding: 4px;
	}

	.recent-item {
		display: flex;
		align-items: center;
		gap: 8px;
		width: 100%;
		padding: 6px 8px;
		background: none;
		border: none;
		color: var(--color-text-primary, #e0e0e0);
		cursor: pointer;
		text-align: left;
		border-radius: 4px;
		transition: all 0.2s;
		position: relative;
	}

	.recent-item:hover:not(:disabled) {
		background-color: var(--color-surface-700, #333);
	}

	.recent-item:disabled {
		opacity: 0.6;
		cursor: not-allowed;
	}

	.file-icon {
		font-size: 16px;
		flex-shrink: 0;
	}

	.file-name {
		flex: 1;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		font-size: 13px;
	}

	.loading-indicator {
		margin-left: auto;
		display: flex;
		align-items: center;
	}

	.mini-spinner {
		width: 14px;
		height: 14px;
		border: 2px solid transparent;
		border-top-color: var(--color-primary, #4dabf7);
		border-radius: 50%;
		animation: spin 0.8s linear infinite;
	}

	.loading-overlay {
		position: absolute;
		top: 0;
		left: 0;
		right: 0;
		bottom: 0;
		background-color: rgba(0, 0, 0, 0.8);
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 16px;
		z-index: 100;
		color: var(--color-text-primary, #e0e0e0);
		backdrop-filter: blur(4px);
	}

	.spinner {
		width: 40px;
		height: 40px;
		border: 3px solid rgba(255, 255, 255, 0.2);
		border-top-color: var(--color-primary, #4dabf7);
		border-radius: 50%;
		animation: spin 1s linear infinite;
	}

	@keyframes spin {
		to { transform: rotate(360deg); }
	}

	.drop-overlay {
		position: absolute;
		top: 0;
		left: 0;
		right: 0;
		bottom: 0;
		background-color: rgba(77, 171, 247, 0.1);
		border: 3px dashed var(--color-primary, #4dabf7);
		display: flex;
		align-items: center;
		justify-content: center;
		z-index: 99;
		pointer-events: none;
		animation: pulse 1.5s ease-in-out infinite;
	}

	@keyframes pulse {
		0%, 100% { opacity: 1; }
		50% { opacity: 0.8; }
	}

	.drop-message {
		padding: 20px 40px;
		background-color: var(--color-primary, #4dabf7);
		color: white;
		border-radius: 8px;
		font-size: 16px;
		font-weight: 500;
		box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
	}

	.file-browser-panel.drag-over {
		box-shadow: inset 0 0 0 3px var(--color-primary, #4dabf7);
	}

	/* Scrollbar styling */
	.recent-list::-webkit-scrollbar {
		width: 8px;
	}

	.recent-list::-webkit-scrollbar-track {
		background: var(--color-surface-900, #1a1a1a);
		border-radius: 4px;
	}

	.recent-list::-webkit-scrollbar-thumb {
		background: var(--color-surface-600, #444);
		border-radius: 4px;
	}

	.recent-list::-webkit-scrollbar-thumb:hover {
		background: var(--color-surface-500, #555);
	}

	/* Dark mode adjustments */
	:global(.dark) .file-browser-panel {
		background-color: var(--color-surface-900, #0a0a0a);
	}

	:global(.dark) .recent-files {
		background-color: var(--color-surface-800, #141414);
	}

	/* Accessibility */
	@media (prefers-reduced-motion: reduce) {
		.spinner,
		.mini-spinner {
			animation: none;
			opacity: 0.8;
		}
		
		.drop-overlay {
			animation: none;
		}
		
		* {
			transition-duration: 0.01ms !important;
		}
	}

	/* Focus styles */
	.clear-button:focus-visible,
	.recent-item:focus-visible {
		outline: 2px solid var(--color-primary, #4dabf7);
		outline-offset: 2px;
	}
</style>