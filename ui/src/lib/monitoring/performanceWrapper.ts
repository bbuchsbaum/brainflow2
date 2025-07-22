/**
 * Performance monitoring wrapper for Svelte components
 * Tracks component lifecycle and render performance
 */
import { onMount, onDestroy } from 'svelte';
import { getMonitoringService } from '$lib/services/MonitoringService';

export interface ComponentPerformanceOptions {
	componentName: string;
	trackMount?: boolean;
	trackRender?: boolean;
	trackDestroy?: boolean;
	metadata?: Record<string, any>;
}

/**
 * Hook to monitor component performance
 */
export function useComponentPerformance(options: ComponentPerformanceOptions) {
	const monitoring = getMonitoringService();
	const mountTime = performance.now();

	if (options.trackMount !== false) {
		onMount(() => {
			const mountDuration = performance.now() - mountTime;
			monitoring.trackPerformance({
				name: `component.mount.${options.componentName}`,
				duration: mountDuration,
				startTime: mountTime,
				metadata: options.metadata
			});
		});
	}

	if (options.trackDestroy !== false) {
		onDestroy(() => {
			const totalLifetime = performance.now() - mountTime;
			monitoring.trackPerformance({
				name: `component.lifetime.${options.componentName}`,
				duration: totalLifetime,
				startTime: mountTime,
				metadata: options.metadata
			});
		});
	}

	// Return render tracking function
	return {
		trackRender: (renderName?: string) => {
			if (options.trackRender === false) return () => {};

			const renderStart = performance.now();
			return () => {
				const renderDuration = performance.now() - renderStart;
				monitoring.trackPerformance({
					name: `component.render.${options.componentName}${renderName ? `.${renderName}` : ''}`,
					duration: renderDuration,
					startTime: renderStart,
					metadata: options.metadata
				});
			};
		}
	};
}

/**
 * Measure async operation performance
 */
export async function measureAsync<T>(
	name: string,
	operation: () => Promise<T>,
	metadata?: Record<string, any>
): Promise<T> {
	const monitoring = getMonitoringService();
	const endMeasure = monitoring.startPerformance(name, metadata);

	try {
		const result = await operation();
		endMeasure();
		return result;
	} catch (error) {
		endMeasure();
		monitoring.trackError(error as Error, { operation: name, ...metadata });
		throw error;
	}
}

/**
 * Measure sync operation performance
 */
export function measureSync<T>(
	name: string,
	operation: () => T,
	metadata?: Record<string, any>
): T {
	const monitoring = getMonitoringService();
	const endMeasure = monitoring.startPerformance(name, metadata);

	try {
		const result = operation();
		endMeasure();
		return result;
	} catch (error) {
		endMeasure();
		monitoring.trackError(error as Error, { operation: name, ...metadata });
		throw error;
	}
}

/**
 * Create a debounced performance tracker for high-frequency operations
 */
export function createPerformanceTracker(name: string, debounceMs: number = 1000) {
	const monitoring = getMonitoringService();
	let measurements: number[] = [];
	let timeout: number | undefined;

	const flush = () => {
		if (measurements.length === 0) return;

		const avg = measurements.reduce((a, b) => a + b, 0) / measurements.length;
		const min = Math.min(...measurements);
		const max = Math.max(...measurements);

		monitoring.trackPerformance({
			name: `${name}.aggregate`,
			duration: avg,
			startTime: performance.now() - avg,
			metadata: {
				samples: measurements.length,
				min,
				max,
				avg
			}
		});

		measurements = [];
	};

	return {
		track: (duration: number) => {
			measurements.push(duration);

			if (timeout) clearTimeout(timeout);
			timeout = window.setTimeout(flush, debounceMs);
		},
		flush
	};
}

/**
 * Track user interaction performance
 */
export function trackInteraction(action: string, category: string = 'interaction'): () => void {
	const monitoring = getMonitoringService();
	const endMeasure = monitoring.startPerformance(`${category}.${action}`);

	// Also track as user action
	monitoring.trackAction({
		action,
		category,
		metadata: {
			timestamp: Date.now()
		}
	});

	return endMeasure;
}
