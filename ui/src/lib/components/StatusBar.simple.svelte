<!--
  Simple StatusBar Component - No service dependencies
  Shows basic coordinate information from stores
-->
<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { statusStore } from '$lib/stores/statusStore';
	
	// State
	let crosshairCoord = $state<[number, number, number] | null>(null);
	let mouseWorldCoord = $state<[number, number, number] | null>(null);
	
	// Subscribe to status store
	let unsubscribe: (() => void) | null = null;
	
	onMount(() => {
		console.log('[StatusBar.simple] Mounting...');
		
		// Subscribe to status store for mouse coordinates
		unsubscribe = statusStore.subscribe((state) => {
			mouseWorldCoord = state.mouseWorldCoord;
			// For now, use mouse coord as crosshair coord
			crosshairCoord = state.mouseWorldCoord;
		});
		
		console.log('[StatusBar.simple] Mounted successfully');
	});
	
	onDestroy(() => {
		if (unsubscribe) {
			unsubscribe();
		}
	});
	
	// Format functions
	function formatCoord(value: number): string {
		return value.toFixed(1);
	}
	
	function formatCoordTriple(coords: [number, number, number] | null): string {
		if (!coords) return '—, —, —';
		return `${formatCoord(coords[0])}, ${formatCoord(coords[1])}, ${formatCoord(coords[2])}`;
	}
</script>

<div class="status-bar">
	<!-- Crosshair coordinates -->
	<div class="status-item">
		<span class="label">Crosshair:</span>
		<span class="value">{formatCoordTriple(crosshairCoord)}</span>
	</div>
	
	<!-- Mouse coordinates -->
	<div class="status-item">
		<span class="label">Mouse:</span>
		<span class="value">{formatCoordTriple(mouseWorldCoord)}</span>
	</div>
	
	<!-- Status message -->
	<div class="status-item">
		<span class="label">Status:</span>
		<span class="value">Ready</span>
	</div>
</div>

<style>
	.status-bar {
		display: flex;
		align-items: center;
		gap: 16px;
		height: 28px;
		background-color: #1a1a1a;
		border-top: 1px solid #333;
		padding: 0 12px;
		font-size: 11px;
		font-family: system-ui, -apple-system, sans-serif;
		color: #e0e0e0;
	}
	
	.status-item {
		display: flex;
		align-items: center;
		gap: 6px;
	}
	
	.label {
		color: #888888;
		font-weight: 500;
	}
	
	.value {
		color: #e0e0e0;
		font-family: 'Monaco', 'Menlo', monospace;
		font-size: 11px;
	}
</style>