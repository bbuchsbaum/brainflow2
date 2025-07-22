/**
 * Plugin Performance Monitor
 * Monitors plugin performance and implements circuit breaker pattern
 */

import type { EventBus } from '$lib/events/EventBus';
import type { PluginPerformanceStats } from './types';

interface CircuitBreakerState {
	isOpen: boolean;
	failureCount: number;
	lastFailureTime: number;
	nextAttemptTime: number;
}

export class PluginPerformanceMonitor {
	private performanceStats = new Map<string, PluginPerformanceStats>();
	private circuitBreakers = new Map<string, CircuitBreakerState>();
	private executionHistory = new Map<string, number[]>();
	private monitoringIntervals = new Map<string, NodeJS.Timeout>();
	private circuitBreakerThreshold: number;
	private eventBus: EventBus;
	private onCircuitBreakerTripCallback?: (pluginId: string) => void;

	// Configuration constants
	private readonly HISTORY_SIZE = 100;
	private readonly SLOW_EXECUTION_THRESHOLD = 5000; // 5 seconds
	private readonly CIRCUIT_BREAKER_TIMEOUT = 60000; // 1 minute
	private readonly MEMORY_LEAK_THRESHOLD = 10; // 10 unfreed allocations
	private readonly MONITORING_INTERVAL = 10000; // 10 seconds

	constructor(circuitBreakerThreshold: number, eventBus: EventBus) {
		this.circuitBreakerThreshold = circuitBreakerThreshold;
		this.eventBus = eventBus;
	}

	/**
	 * Record a successful execution
	 */
	recordExecution(pluginId: string, executionTime: number): void {
		let stats = this.performanceStats.get(pluginId);
		if (!stats) {
			stats = this.createEmptyStats();
			this.performanceStats.set(pluginId, stats);
		}

		// Update stats
		stats.totalExecutions++;
		stats.avgExecutionTime = this.updateAverage(
			stats.avgExecutionTime,
			executionTime,
			stats.totalExecutions
		);

		// Update execution history
		let history = this.executionHistory.get(pluginId);
		if (!history) {
			history = [];
			this.executionHistory.set(pluginId, history);
		}

		history.push(executionTime);
		if (history.length > this.HISTORY_SIZE) {
			history.shift();
		}

		// Reset circuit breaker on successful execution
		this.resetCircuitBreaker(pluginId);

		// Check for performance warnings
		this.checkPerformanceWarnings(pluginId, executionTime);
	}

	/**
	 * Record an error
	 */
	recordError(pluginId: string, error?: Error): void {
		let stats = this.performanceStats.get(pluginId);
		if (!stats) {
			stats = this.createEmptyStats();
			this.performanceStats.set(pluginId, stats);
		}

		stats.errorCount++;
		if (error) {
			stats.lastError = error;
		}

		// Update circuit breaker
		this.updateCircuitBreaker(pluginId);
	}

	/**
	 * Record memory leak
	 */
	recordMemoryLeak(pluginId: string): void {
		let stats = this.performanceStats.get(pluginId);
		if (!stats) {
			stats = this.createEmptyStats();
			this.performanceStats.set(pluginId, stats);
		}

		stats.memoryLeaks++;

		// Check if memory leaks exceed threshold
		if (stats.memoryLeaks >= this.MEMORY_LEAK_THRESHOLD) {
			this.emitPerformanceWarning(pluginId, 'Memory leak detected');
		}
	}

	/**
	 * Get performance statistics for a plugin
	 */
	getStats(pluginId: string): PluginPerformanceStats | null {
		return this.performanceStats.get(pluginId) || null;
	}

	/**
	 * Get all performance statistics
	 */
	getAllStats(): Map<string, PluginPerformanceStats> {
		return new Map(this.performanceStats);
	}

	/**
	 * Check if circuit breaker is open
	 */
	isCircuitOpen(pluginId: string): boolean {
		const state = this.circuitBreakers.get(pluginId);
		if (!state || !state.isOpen) {
			return false;
		}

		// Check if timeout has passed
		const now = Date.now();
		if (now >= state.nextAttemptTime) {
			// Reset circuit breaker for trial
			state.isOpen = false;
			return false;
		}

		return true;
	}

	/**
	 * Manually reset circuit breaker
	 */
	resetCircuitBreaker(pluginId: string): void {
		const state = this.circuitBreakers.get(pluginId);
		if (state) {
			state.isOpen = false;
			state.failureCount = 0;
			state.lastFailureTime = 0;
			state.nextAttemptTime = 0;
		}
	}

	/**
	 * Set callback for circuit breaker trips
	 */
	onCircuitBreakerTrip(callback: (pluginId: string) => void): void {
		this.onCircuitBreakerTripCallback = callback;
	}

	/**
	 * Start monitoring a plugin
	 */
	startMonitoring(pluginId: string): void {
		// Clear any existing monitoring
		this.stopMonitoring(pluginId);

		// Start new monitoring interval
		const interval = setInterval(() => {
			this.performPeriodicCheck(pluginId);
		}, this.MONITORING_INTERVAL);

		this.monitoringIntervals.set(pluginId, interval);
	}

	/**
	 * Stop monitoring a plugin
	 */
	stopMonitoring(pluginId: string): void {
		const interval = this.monitoringIntervals.get(pluginId);
		if (interval) {
			clearInterval(interval);
			this.monitoringIntervals.delete(pluginId);
		}
	}

	/**
	 * Get execution history for a plugin
	 */
	getExecutionHistory(pluginId: string): number[] {
		return this.executionHistory.get(pluginId) || [];
	}

	/**
	 * Get performance trends
	 */
	getPerformanceTrends(pluginId: string): {
		averageExecutionTime: number;
		recentAverageExecutionTime: number;
		trendDirection: 'improving' | 'degrading' | 'stable';
		errorRate: number;
	} {
		const stats = this.performanceStats.get(pluginId);
		const history = this.executionHistory.get(pluginId) || [];

		if (!stats || history.length === 0) {
			return {
				averageExecutionTime: 0,
				recentAverageExecutionTime: 0,
				trendDirection: 'stable',
				errorRate: 0
			};
		}

		// Calculate recent average (last 20 executions)
		const recentHistory = history.slice(-20);
		const recentAverage = recentHistory.reduce((sum, time) => sum + time, 0) / recentHistory.length;

		// Determine trend
		let trendDirection: 'improving' | 'degrading' | 'stable' = 'stable';
		if (recentAverage < stats.avgExecutionTime * 0.9) {
			trendDirection = 'improving';
		} else if (recentAverage > stats.avgExecutionTime * 1.1) {
			trendDirection = 'degrading';
		}

		const errorRate = stats.totalExecutions > 0 ? stats.errorCount / stats.totalExecutions : 0;

		return {
			averageExecutionTime: stats.avgExecutionTime,
			recentAverageExecutionTime: recentAverage,
			trendDirection,
			errorRate
		};
	}

	/**
	 * Generate performance report
	 */
	generateReport(): {
		totalPlugins: number;
		healthyPlugins: number;
		degradedPlugins: string[];
		circuitBreakerTripped: string[];
		topPerformers: string[];
		slowestPlugins: string[];
	} {
		const allStats = this.getAllStats();
		const degradedPlugins: string[] = [];
		const circuitBreakerTripped: string[] = [];
		const performanceData: Array<{ id: string; avgTime: number }> = [];

		for (const [pluginId, stats] of allStats) {
			// Check for degraded performance
			if (
				stats.avgExecutionTime > this.SLOW_EXECUTION_THRESHOLD ||
				stats.errorCount / Math.max(stats.totalExecutions, 1) > 0.1
			) {
				degradedPlugins.push(pluginId);
			}

			// Check circuit breaker status
			if (this.isCircuitOpen(pluginId)) {
				circuitBreakerTripped.push(pluginId);
			}

			performanceData.push({ id: pluginId, avgTime: stats.avgExecutionTime });
		}

		// Sort by performance
		performanceData.sort((a, b) => a.avgTime - b.avgTime);

		return {
			totalPlugins: allStats.size,
			healthyPlugins: allStats.size - degradedPlugins.length,
			degradedPlugins,
			circuitBreakerTripped,
			topPerformers: performanceData.slice(0, 5).map((p) => p.id),
			slowestPlugins: performanceData.slice(-5).map((p) => p.id)
		};
	}

	/**
	 * Shutdown the performance monitor
	 */
	shutdown(): void {
		// Clear all monitoring intervals
		for (const interval of this.monitoringIntervals.values()) {
			clearInterval(interval);
		}

		// Clear all data
		this.performanceStats.clear();
		this.circuitBreakers.clear();
		this.executionHistory.clear();
		this.monitoringIntervals.clear();
	}

	// Private methods

	private createEmptyStats(): PluginPerformanceStats {
		return {
			loadTime: 0,
			initTime: 0,
			avgExecutionTime: 0,
			totalExecutions: 0,
			errorCount: 0,
			memoryLeaks: 0
		};
	}

	private updateAverage(currentAvg: number, newValue: number, count: number): number {
		return (currentAvg * (count - 1) + newValue) / count;
	}

	private updateCircuitBreaker(pluginId: string): void {
		let state = this.circuitBreakers.get(pluginId);
		if (!state) {
			state = {
				isOpen: false,
				failureCount: 0,
				lastFailureTime: 0,
				nextAttemptTime: 0
			};
			this.circuitBreakers.set(pluginId, state);
		}

		state.failureCount++;
		state.lastFailureTime = Date.now();

		// Check if threshold exceeded
		if (state.failureCount >= this.circuitBreakerThreshold) {
			state.isOpen = true;
			state.nextAttemptTime = Date.now() + this.CIRCUIT_BREAKER_TIMEOUT;

			// Emit circuit breaker event
			this.eventBus.emit('plugin.circuit.opened' as any, { pluginId });

			// Notify callback
			if (this.onCircuitBreakerTripCallback) {
				this.onCircuitBreakerTripCallback(pluginId);
			}

			console.warn(
				`Circuit breaker opened for plugin ${pluginId} after ${state.failureCount} failures`
			);
		}
	}

	private checkPerformanceWarnings(pluginId: string, executionTime: number): void {
		// Check for slow execution
		if (executionTime > this.SLOW_EXECUTION_THRESHOLD) {
			this.emitPerformanceWarning(pluginId, `Slow execution: ${executionTime}ms`);
		}

		// Check execution history for trend analysis
		const history = this.executionHistory.get(pluginId);
		if (history && history.length >= 10) {
			const recentAverage = history.slice(-5).reduce((sum, time) => sum + time, 0) / 5;
			const olderAverage = history.slice(-10, -5).reduce((sum, time) => sum + time, 0) / 5;

			if (recentAverage > olderAverage * 1.5) {
				this.emitPerformanceWarning(pluginId, 'Performance degradation detected');
			}
		}
	}

	private performPeriodicCheck(pluginId: string): void {
		const stats = this.performanceStats.get(pluginId);
		if (!stats) {
			return;
		}

		// Check for memory leaks
		if (stats.memoryLeaks > 0) {
			this.emitPerformanceWarning(pluginId, `${stats.memoryLeaks} memory leaks detected`);
		}

		// Check error rate
		const errorRate = stats.totalExecutions > 0 ? stats.errorCount / stats.totalExecutions : 0;

		if (errorRate > 0.1) {
			// 10% error rate
			this.emitPerformanceWarning(pluginId, `High error rate: ${(errorRate * 100).toFixed(1)}%`);
		}
	}

	private emitPerformanceWarning(pluginId: string, message: string): void {
		const stats = this.performanceStats.get(pluginId);

		this.eventBus.emit('plugin.performance.warning' as any, {
			pluginId,
			message,
			stats
		});

		console.warn(`Performance warning for plugin ${pluginId}: ${message}`);
	}
}
