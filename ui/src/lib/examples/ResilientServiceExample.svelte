<script lang="ts">
	/**
	 * Example demonstrating resilient service usage
	 * Shows retry logic, circuit breakers, and offline support
	 */
	import { onMount, onDestroy } from 'svelte';
	import { getService } from '$lib/di/Container';
	import { getEventBus } from '$lib/events/EventBus';
	import { ResilientVolumeService } from '$lib/services/ResilientVolumeService';
	import type { NotificationService } from '$lib/services/NotificationService';
	import { createLoadingState } from '$lib/utils/stateHelpers.svelte';
	import { CircuitState } from '$lib/services/ResilientService';

	// Services
	let resilientVolumeService: ResilientVolumeService | null = null;
	let notificationService: NotificationService | null = null;
	let eventBus = getEventBus();

	// State
	const volumeLoader = createLoadingState<string>();
	const batchLoader = createLoadingState<{ loaded: string[]; failed: any[] }>();

	let circuitState = $state<CircuitState>(CircuitState.CLOSED);
	let failureCount = $state(0);
	let offlineMode = $state(false);
	let offlineCacheSize = $state(0);

	// Demo controls
	let simulateNetworkError = $state(false);
	let simulateTimeout = $state(false);
	let simulateValidationError = $state(false);
	let simulateCircuitBreaker = $state(false);

	// Event subscriptions
	let unsubscribers: (() => void)[] = [];

	onMount(async () => {
		// Get services
		resilientVolumeService = await getService<ResilientVolumeService>('resilientVolumeService');
		notificationService = await getService<NotificationService>('notificationService');

		// Subscribe to circuit breaker events
		unsubscribers.push(
			eventBus.on('VolumeService.circuit.opened', () => {
				notificationService?.error('Circuit breaker opened - service unavailable');
				updateHealthStatus();
			})
		);

		unsubscribers.push(
			eventBus.on('VolumeService.circuit.closed', () => {
				notificationService?.success('Circuit breaker closed - service restored');
				updateHealthStatus();
			})
		);

		// Subscribe to retry events
		unsubscribers.push(
			eventBus.on('VolumeService.operation.retry', ({ attempt, delay }) => {
				notificationService?.info(`Retrying operation (attempt ${attempt}) in ${delay}ms`);
			})
		);

		// Monitor online/offline status
		window.addEventListener('online', handleOnline);
		window.addEventListener('offline', handleOffline);

		// Initial status
		offlineMode = !navigator.onLine;
		updateHealthStatus();
	});

	onDestroy(() => {
		unsubscribers.forEach((unsub) => unsub());
		window.removeEventListener('online', handleOnline);
		window.removeEventListener('offline', handleOffline);
	});

	function handleOnline() {
		offlineMode = false;
		notificationService?.success('Back online!');
	}

	function handleOffline() {
		offlineMode = true;
		notificationService?.warning('Working offline');
	}

	function updateHealthStatus() {
		if (resilientVolumeService) {
			const health = resilientVolumeService.getHealthStatus();
			circuitState = health.resilience.circuitState as CircuitState;
			failureCount = health.resilience.failureCount;
			offlineCacheSize = health.offlineCacheSize;
		}
	}

	// Demo: Load with retry
	async function loadVolumeWithRetry() {
		if (!resilientVolumeService) return;

		try {
			// Simulate different error conditions
			if (simulateNetworkError) {
				throw Object.assign(new Error('Network connection failed'), { name: 'NetworkError' });
			}
			if (simulateTimeout) {
				throw Object.assign(new Error('Request timed out'), { name: 'TimeoutError' });
			}
			if (simulateValidationError) {
				throw Object.assign(new Error('Invalid file format'), { name: 'ValidationError' });
			}

			const volumeId = await volumeLoader.load(() =>
				resilientVolumeService!.load('/demo/volume.nii')
			);

			notificationService?.success(`Volume loaded: ${volumeId}`);
		} catch (error) {
			console.error('Load failed:', error);
		} finally {
			updateHealthStatus();
		}
	}

	// Demo: Batch load with partial failure
	async function batchLoadVolumes() {
		if (!resilientVolumeService) return;

		const paths = [
			'/demo/volume1.nii',
			'/demo/volume2.nii',
			'/demo/volume3.nii',
			'/demo/missing.nii' // This one will fail
		];

		try {
			const result = await batchLoader.load(() => resilientVolumeService!.batchLoad(paths));

			if (result.failed.length > 0) {
				notificationService?.warning(
					`Loaded ${result.loaded.length} volumes, ${result.failed.length} failed`
				);
			} else {
				notificationService?.success(`All ${result.loaded.length} volumes loaded`);
			}
		} catch (error) {
			console.error('Batch load failed:', error);
		} finally {
			updateHealthStatus();
		}
	}

	// Demo: Trigger circuit breaker
	async function triggerCircuitBreaker() {
		if (!resilientVolumeService) return;

		simulateCircuitBreaker = true;

		// Make multiple failing requests
		for (let i = 0; i < 5; i++) {
			try {
				await resilientVolumeService.load(`/fail-${i}.nii`);
			} catch (error) {
				// Expected to fail
			}
		}

		simulateCircuitBreaker = false;
		updateHealthStatus();
	}

	// Demo: Reset circuit breaker
	function resetCircuitBreaker() {
		if (resilientVolumeService) {
			(resilientVolumeService as any).resilientBase.resetCircuitBreaker();
			notificationService?.info('Circuit breaker reset');
			updateHealthStatus();
		}
	}

	// Format circuit state for display
	function formatCircuitState(state: CircuitState): string {
		switch (state) {
			case CircuitState.CLOSED:
				return '🟢 Closed (Normal)';
			case CircuitState.OPEN:
				return '🔴 Open (Failing)';
			case CircuitState.HALF_OPEN:
				return '🟡 Half-Open (Testing)';
			default:
				return state;
		}
	}
</script>

<div class="space-y-6">
	<div>
		<h2 class="mb-4 text-xl font-semibold">Resilient Service Example</h2>
		<p class="mb-4 text-gray-600 dark:text-gray-400">
			Demonstrates automatic retry, circuit breakers, and offline support
		</p>
	</div>

	<!-- Service Status -->
	<div class="rounded-lg bg-gray-100 p-4 dark:bg-gray-800">
		<h3 class="mb-3 font-semibold">Service Status</h3>
		<div class="grid grid-cols-2 gap-4 text-sm">
			<div>
				<span class="text-gray-600 dark:text-gray-400">Circuit State:</span>
				<span class="ml-2 font-medium">{formatCircuitState(circuitState)}</span>
			</div>
			<div>
				<span class="text-gray-600 dark:text-gray-400">Failure Count:</span>
				<span class="ml-2 font-medium">{failureCount}</span>
			</div>
			<div>
				<span class="text-gray-600 dark:text-gray-400">Connection:</span>
				<span class="ml-2 font-medium">
					{offlineMode ? '🔴 Offline' : '🟢 Online'}
				</span>
			</div>
			<div>
				<span class="text-gray-600 dark:text-gray-400">Offline Cache:</span>
				<span class="ml-2 font-medium">{offlineCacheSize} volumes</span>
			</div>
		</div>
	</div>

	<!-- Error Simulation -->
	<div class="rounded-lg border border-gray-200 p-4 dark:border-gray-700">
		<h3 class="mb-3 font-semibold">Error Simulation</h3>
		<div class="space-y-2">
			<label class="flex items-center">
				<input type="checkbox" bind:checked={simulateNetworkError} class="mr-2" />
				<span class="text-sm">Simulate Network Error (will retry)</span>
			</label>
			<label class="flex items-center">
				<input type="checkbox" bind:checked={simulateTimeout} class="mr-2" />
				<span class="text-sm">Simulate Timeout (will retry)</span>
			</label>
			<label class="flex items-center">
				<input type="checkbox" bind:checked={simulateValidationError} class="mr-2" />
				<span class="text-sm">Simulate Validation Error (won't retry)</span>
			</label>
		</div>
	</div>

	<!-- Demo Actions -->
	<div class="space-y-4">
		<!-- Single Volume Load -->
		<div class="rounded-lg border border-gray-200 p-4 dark:border-gray-700">
			<h3 class="mb-3 font-semibold">Load Volume with Retry</h3>
			<p class="mb-3 text-sm text-gray-600 dark:text-gray-400">
				Demonstrates automatic retry with exponential backoff
			</p>

			<button
				onclick={loadVolumeWithRetry}
				disabled={volumeLoader.isLoading || circuitState === CircuitState.OPEN}
				class="rounded bg-blue-500 px-4 py-2 text-white hover:bg-blue-600 disabled:cursor-not-allowed disabled:opacity-50"
			>
				{volumeLoader.isLoading ? 'Loading...' : 'Load Volume'}
			</button>

			{#if volumeLoader.error}
				<p class="mt-2 text-sm text-red-600">
					Error: {volumeLoader.error.message}
				</p>
			{/if}

			{#if volumeLoader.data}
				<p class="mt-2 text-sm text-green-600">
					Loaded: {volumeLoader.data}
				</p>
			{/if}
		</div>

		<!-- Batch Load -->
		<div class="rounded-lg border border-gray-200 p-4 dark:border-gray-700">
			<h3 class="mb-3 font-semibold">Batch Load with Partial Failure</h3>
			<p class="mb-3 text-sm text-gray-600 dark:text-gray-400">
				Loads multiple volumes, handling partial failures gracefully
			</p>

			<button
				onclick={batchLoadVolumes}
				disabled={batchLoader.isLoading || circuitState === CircuitState.OPEN}
				class="rounded bg-blue-500 px-4 py-2 text-white hover:bg-blue-600 disabled:cursor-not-allowed disabled:opacity-50"
			>
				{batchLoader.isLoading ? 'Loading...' : 'Batch Load'}
			</button>

			{#if batchLoader.data}
				<div class="mt-3 text-sm">
					<p class="text-green-600">
						✓ Loaded: {batchLoader.data.loaded.length} volumes
					</p>
					{#if batchLoader.data.failed.length > 0}
						<p class="text-red-600">
							✗ Failed: {batchLoader.data.failed.length} volumes
						</p>
						<ul class="mt-1 ml-4 text-xs text-gray-600">
							{#each batchLoader.data.failed as failure}
								<li>• {failure.path}: {failure.error.message}</li>
							{/each}
						</ul>
					{/if}
				</div>
			{/if}
		</div>

		<!-- Circuit Breaker -->
		<div class="rounded-lg border border-gray-200 p-4 dark:border-gray-700">
			<h3 class="mb-3 font-semibold">Circuit Breaker Demo</h3>
			<p class="mb-3 text-sm text-gray-600 dark:text-gray-400">
				Triggers circuit breaker by causing multiple failures
			</p>

			<div class="flex gap-3">
				<button
					onclick={triggerCircuitBreaker}
					disabled={circuitState === CircuitState.OPEN}
					class="rounded bg-red-500 px-4 py-2 text-white hover:bg-red-600 disabled:cursor-not-allowed disabled:opacity-50"
				>
					Trigger Circuit Breaker
				</button>

				<button
					onclick={resetCircuitBreaker}
					disabled={circuitState === CircuitState.CLOSED}
					class="rounded bg-green-500 px-4 py-2 text-white hover:bg-green-600 disabled:cursor-not-allowed disabled:opacity-50"
				>
					Reset Circuit
				</button>
			</div>
		</div>
	</div>

	<!-- Tips -->
	<div class="rounded-lg bg-blue-50 p-4 dark:bg-blue-900/20">
		<h3 class="mb-2 font-semibold">Tips</h3>
		<ul class="space-y-1 text-sm text-gray-700 dark:text-gray-300">
			<li>• Network errors are automatically retried with exponential backoff</li>
			<li>• Validation errors fail immediately without retry</li>
			<li>• Circuit breaker prevents cascading failures</li>
			<li>• Offline mode uses cached data when available</li>
			<li>• Partial batch failures don't block successful loads</li>
		</ul>
	</div>
</div>
