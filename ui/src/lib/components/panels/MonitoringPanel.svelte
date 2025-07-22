<!--
  Monitoring Panel Component
  Real-time display of application metrics and performance
-->
<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { getMonitoringService } from '$lib/services/MonitoringService';
	import { getEventBus } from '$lib/events/EventBus';
	import type { PerformanceEntry, ResourceMetrics } from '$lib/services/MonitoringService';
	import type { EventBus } from '$lib/events/EventBus';

	// State
	let performanceMetrics = $state<PerformanceEntry[]>([]);
	let resourceMetrics = $state<ResourceMetrics | null>(null);
	let errorCount = $state(0);
	let actionCount = $state(0);
	let avgRenderTime = $state(0);
	let memoryTrend = $state<number[]>([]);
	let isMonitoring = $state(true);

	// Services
	let monitoringService = getMonitoringService();
	let eventBus: EventBus = getEventBus();

	// Update intervals
	let resourceInterval: number | undefined;
	let eventUnsubscribes: Array<() => void> = [];

	// Format bytes to human readable
	function formatBytes(bytes: number): string {
		if (bytes === 0) return '0 B';
		const k = 1024;
		const sizes = ['B', 'KB', 'MB', 'GB'];
		const i = Math.floor(Math.log(bytes) / Math.log(k));
		return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`;
	}

	// Format duration
	function formatDuration(ms: number): string {
		if (ms < 1) return `${(ms * 1000).toFixed(0)}μs`;
		if (ms < 1000) return `${ms.toFixed(1)}ms`;
		return `${(ms / 1000).toFixed(2)}s`;
	}

	// Calculate average render time
	function updateAverageRenderTime() {
		const renderMetrics = performanceMetrics.filter(
			(m) => m.name.startsWith('component.render') || m.name === 'gpu.render'
		);

		if (renderMetrics.length > 0) {
			const total = renderMetrics.reduce((sum, m) => sum + m.duration, 0);
			avgRenderTime = total / renderMetrics.length;
		}
	}

	// Update resource metrics
	async function updateResourceMetrics() {
		if (!isMonitoring) return;

		try {
			resourceMetrics = await monitoringService.getResourceMetrics();

			// Update memory trend
			if (resourceMetrics?.memory) {
				memoryTrend = [...memoryTrend, resourceMetrics.memory.heapUsed].slice(-20);
			}
		} catch (error) {
			console.error('Failed to get resource metrics:', error);
		}
	}

	// Clear metrics
	function clearMetrics() {
		performanceMetrics = [];
		errorCount = 0;
		actionCount = 0;
		avgRenderTime = 0;
		memoryTrend = [];
	}

	// Toggle monitoring
	function toggleMonitoring() {
		isMonitoring = !isMonitoring;
		if (!isMonitoring && resourceInterval) {
			clearInterval(resourceInterval);
			resourceInterval = undefined;
		} else if (isMonitoring && !resourceInterval) {
			resourceInterval = window.setInterval(updateResourceMetrics, 2000);
		}
	}

	onMount(() => {
		// Subscribe to performance events
		eventUnsubscribes.push(
			eventBus.on('monitoring.performance', (entry: PerformanceEntry) => {
				performanceMetrics = [...performanceMetrics.slice(-49), entry];
				updateAverageRenderTime();
			})
		);

		// Subscribe to error events
		eventUnsubscribes.push(
			eventBus.on('monitoring.error', () => {
				errorCount++;
			})
		);

		// Subscribe to action events
		eventUnsubscribes.push(
			eventBus.on('monitoring.action', () => {
				actionCount++;
			})
		);

		// Start resource monitoring
		updateResourceMetrics();
		resourceInterval = window.setInterval(updateResourceMetrics, 2000);
	});

	onDestroy(() => {
		if (resourceInterval) {
			clearInterval(resourceInterval);
		}
		eventUnsubscribes.forEach((fn) => fn());
	});
</script>

<div class="monitoring-panel">
	<div class="panel-header">
		<h3>Performance Monitor</h3>
		<div class="controls">
			<button class="control-button" onclick={clearMetrics} title="Clear metrics"> Clear </button>
			<button
				class="control-button"
				class:active={isMonitoring}
				onclick={toggleMonitoring}
				title={isMonitoring ? 'Pause monitoring' : 'Resume monitoring'}
			>
				{isMonitoring ? 'Pause' : 'Resume'}
			</button>
		</div>
	</div>

	<div class="metrics-grid">
		<!-- Summary Stats -->
		<div class="metric-card">
			<h4>Performance</h4>
			<div class="metric-value">{formatDuration(avgRenderTime)}</div>
			<div class="metric-label">Avg Render Time</div>
		</div>

		<div class="metric-card">
			<h4>Errors</h4>
			<div class="metric-value" class:error={errorCount > 0}>
				{errorCount}
			</div>
			<div class="metric-label">Total Errors</div>
		</div>

		<div class="metric-card">
			<h4>Activity</h4>
			<div class="metric-value">{actionCount}</div>
			<div class="metric-label">User Actions</div>
		</div>

		<div class="metric-card">
			<h4>Memory</h4>
			{#if resourceMetrics?.memory}
				<div class="metric-value">
					{formatBytes(resourceMetrics.memory.heapUsed)}
				</div>
				<div class="metric-label">
					of {formatBytes(resourceMetrics.memory.heapTotal)}
				</div>
			{:else}
				<div class="metric-value">--</div>
				<div class="metric-label">Loading...</div>
			{/if}
		</div>
	</div>

	<!-- Memory Trend Chart -->
	{#if memoryTrend.length > 0}
		<div class="chart-section">
			<h4>Memory Usage Trend</h4>
			<div class="mini-chart">
				<svg viewBox="0 0 200 50" preserveAspectRatio="none">
					<polyline
						points={memoryTrend
							.map((val, i) => {
								const x = (i / (memoryTrend.length - 1)) * 200;
								const max = Math.max(...memoryTrend);
								const min = Math.min(...memoryTrend);
								const y = 50 - ((val - min) / (max - min)) * 45;
								return `${x},${y}`;
							})
							.join(' ')}
						fill="none"
						stroke="var(--color-primary)"
						stroke-width="2"
					/>
				</svg>
			</div>
		</div>
	{/if}

	<!-- Recent Performance Entries -->
	<div class="performance-list">
		<h4>Recent Operations</h4>
		<div class="entries">
			{#each performanceMetrics.slice(-10).reverse() as entry}
				<div class="entry">
					<span class="entry-name">{entry.name}</span>
					<span class="entry-duration" class:slow={entry.duration > 100}>
						{formatDuration(entry.duration)}
					</span>
				</div>
			{/each}
			{#if performanceMetrics.length === 0}
				<div class="empty-state">No performance data yet</div>
			{/if}
		</div>
	</div>

	<!-- GPU Info -->
	{#if resourceMetrics?.gpu}
		<div class="gpu-section">
			<h4>GPU Resources</h4>
			<div class="gpu-metrics">
				<div>
					Memory: {formatBytes(resourceMetrics.gpu.memoryUsed)} / {formatBytes(
						resourceMetrics.gpu.memoryTotal
					)}
				</div>
				<div>Utilization: {resourceMetrics.gpu.utilization.toFixed(0)}%</div>
			</div>
		</div>
	{/if}
</div>

<style>
	.monitoring-panel {
		height: 100%;
		display: flex;
		flex-direction: column;
		background-color: var(--color-surface-900, #1a1a1a);
		color: var(--color-text-primary, #e0e0e0);
		padding: 16px;
		overflow-y: auto;
	}

	.panel-header {
		display: flex;
		justify-content: space-between;
		align-items: center;
		margin-bottom: 16px;
	}

	.panel-header h3 {
		margin: 0;
		font-size: 18px;
		font-weight: 600;
	}

	.controls {
		display: flex;
		gap: 8px;
	}

	.control-button {
		padding: 6px 12px;
		background: var(--color-surface-800, #2a2a2a);
		border: 1px solid var(--color-surface-700, #3a3a3a);
		color: var(--color-text-secondary, #999);
		border-radius: 4px;
		font-size: 12px;
		cursor: pointer;
		transition: all 0.2s;
	}

	.control-button:hover {
		background: var(--color-surface-700, #3a3a3a);
		color: var(--color-text-primary, #e0e0e0);
	}

	.control-button.active {
		background: var(--color-primary, #3b82f6);
		color: white;
		border-color: var(--color-primary, #3b82f6);
	}

	.metrics-grid {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
		gap: 12px;
		margin-bottom: 20px;
	}

	.metric-card {
		background: var(--color-surface-800, #2a2a2a);
		padding: 16px;
		border-radius: 8px;
		text-align: center;
	}

	.metric-card h4 {
		margin: 0 0 8px;
		font-size: 12px;
		text-transform: uppercase;
		color: var(--color-text-tertiary);
		font-weight: 500;
	}

	.metric-value {
		font-size: 24px;
		font-weight: 600;
		color: var(--color-text-primary, #e0e0e0);
		margin-bottom: 4px;
	}

	.metric-value.error {
		color: var(--color-error, #ff6b6b);
	}

	.metric-label {
		font-size: 12px;
		color: var(--color-text-secondary, #999);
	}

	.chart-section {
		margin-bottom: 20px;
	}

	.chart-section h4 {
		margin: 0 0 8px;
		font-size: 14px;
		color: var(--color-text-secondary, #999);
	}

	.mini-chart {
		background: var(--color-surface-800, #2a2a2a);
		border-radius: 4px;
		padding: 8px;
		height: 60px;
	}

	.mini-chart svg {
		width: 100%;
		height: 100%;
	}

	.performance-list {
		flex: 1;
		min-height: 0;
		display: flex;
		flex-direction: column;
	}

	.performance-list h4 {
		margin: 0 0 12px;
		font-size: 14px;
		color: var(--color-text-secondary, #999);
	}

	.entries {
		flex: 1;
		overflow-y: auto;
		background: var(--color-surface-800, #2a2a2a);
		border-radius: 4px;
		padding: 8px;
	}

	.entry {
		display: flex;
		justify-content: space-between;
		align-items: center;
		padding: 6px 8px;
		border-radius: 4px;
		font-size: 12px;
		transition: background 0.2s;
	}

	.entry:hover {
		background: var(--color-surface-700, #3a3a3a);
	}

	.entry-name {
		color: var(--color-text-secondary, #999);
		flex: 1;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		margin-right: 8px;
	}

	.entry-duration {
		color: var(--color-success, #51cf66);
		font-weight: 500;
		white-space: nowrap;
	}

	.entry-duration.slow {
		color: var(--color-warning, #ffd93d);
	}

	.empty-state {
		text-align: center;
		color: var(--color-text-tertiary);
		padding: 20px;
		font-size: 14px;
	}

	.gpu-section {
		margin-top: 20px;
		padding: 12px;
		background: var(--color-surface-800, #2a2a2a);
		border-radius: 4px;
	}

	.gpu-section h4 {
		margin: 0 0 8px;
		font-size: 14px;
		color: var(--color-text-secondary, #999);
	}

	.gpu-metrics {
		font-size: 12px;
		color: var(--color-text-tertiary);
		line-height: 1.6;
	}

	/* Scrollbar */
	.entries::-webkit-scrollbar {
		width: 6px;
	}

	.entries::-webkit-scrollbar-track {
		background: var(--color-surface-900, #1a1a1a);
	}

	.entries::-webkit-scrollbar-thumb {
		background: var(--color-surface-600, #4a4a4a);
		border-radius: 3px;
	}

	.entries::-webkit-scrollbar-thumb:hover {
		background: var(--color-surface-500, #5a5a5a);
	}
</style>
