/**
 * Monitoring Service
 * Provides comprehensive observability for production environments
 */
import { getEventBus } from '$lib/events/EventBus';
import type { EventBus } from '$lib/events/EventBus';
import { uiLogger } from '$lib/utils/logger';

export interface MetricData {
	name: string;
	value: number;
	unit?: string;
	tags?: Record<string, string>;
	timestamp?: number;
}

export interface ErrorData {
	message: string;
	stack?: string;
	context?: Record<string, any>;
	severity: 'low' | 'medium' | 'high' | 'critical';
	userId?: string;
	sessionId?: string;
}

export interface PerformanceEntry {
	name: string;
	duration: number;
	startTime: number;
	metadata?: Record<string, any>;
}

export interface ResourceMetrics {
	gpu?: {
		memoryUsed: number;
		memoryTotal: number;
		utilization: number;
	};
	memory: {
		used: number;
		total: number;
		heapUsed: number;
		heapTotal: number;
	};
	fps?: number;
}

export interface UserAction {
	action: string;
	category: string;
	label?: string;
	value?: number;
	metadata?: Record<string, any>;
}

export interface MonitoringConfig {
	enabled: boolean;
	endpoint?: string;
	apiKey?: string;
	sampleRate: number; // 0-1, percentage of events to send
	bufferSize: number;
	flushInterval: number; // ms
	enablePerformance: boolean;
	enableErrors: boolean;
	enableAnalytics: boolean;
	enableResources: boolean;
}

export class MonitoringService {
	private eventBus: EventBus;
	private config: MonitoringConfig;
	private buffer: Array<any> = [];
	private flushTimer?: number;
	private sessionId: string;
	private performanceObserver?: PerformanceObserver;
	private resourceMonitorInterval?: number;
	private isInitialized = false;
	private eventUnsubscribes: Array<() => void> = [];
	private errorHandler?: (event: ErrorEvent) => void;
	private unhandledRejectionHandler?: (event: PromiseRejectionEvent) => void;
	private visibilityChangeHandler?: () => void;
	private beforeUnloadHandler?: () => void;

	constructor() {
		this.eventBus = getEventBus();
		this.sessionId = this.generateSessionId();

		// Default configuration
		this.config = {
			enabled: !import.meta.env.DEV, // Only in production
			sampleRate: 1.0,
			bufferSize: 100,
			flushInterval: 30000, // 30 seconds
			enablePerformance: true,
			enableErrors: true,
			enableAnalytics: true,
			enableResources: true
		};
	}

	/**
	 * Initialize monitoring with configuration
	 */
	async initialize(config?: Partial<MonitoringConfig>): Promise<void> {
		if (this.isInitialized) return;

		this.config = { ...this.config, ...config };

		if (!this.config.enabled) {
			uiLogger.info('Monitoring disabled');
			return;
		}

		// Set up error handling
		if (this.config.enableErrors) {
			this.setupErrorHandling();
		}

		// Set up performance monitoring
		if (this.config.enablePerformance) {
			this.setupPerformanceMonitoring();
		}

		// Set up resource monitoring
		if (this.config.enableResources) {
			this.setupResourceMonitoring();
		}

		// Set up event listeners
		this.setupEventListeners();

		// Start flush timer
		this.startFlushTimer();

		this.isInitialized = true;
		uiLogger.info('Monitoring service initialized', { sessionId: this.sessionId });
	}

	/**
	 * Track a custom metric
	 */
	trackMetric(metric: MetricData): void {
		if (!this.shouldSample()) return;

		this.addToBuffer({
			type: 'metric',
			...metric,
			timestamp: metric.timestamp || Date.now(),
			sessionId: this.sessionId
		});
	}

	/**
	 * Track an error
	 */
	trackError(error: Error | ErrorData, context?: Record<string, any>): void {
		if (!this.config.enableErrors) return;

		const errorData: ErrorData =
			error instanceof Error
				? {
						message: error.message,
						stack: error.stack,
						context,
						severity: 'medium'
					}
				: error;

		this.addToBuffer({
			type: 'error',
			...errorData,
			timestamp: Date.now(),
			sessionId: this.sessionId,
			url: window.location.href,
			userAgent: navigator.userAgent
		});

		// Log locally as well
		uiLogger.error('Tracked error:', errorData);
	}

	/**
	 * Track a user action
	 */
	trackAction(action: UserAction): void {
		if (!this.config.enableAnalytics || !this.shouldSample()) return;

		this.addToBuffer({
			type: 'action',
			...action,
			timestamp: Date.now(),
			sessionId: this.sessionId
		});
	}

	/**
	 * Start a performance measurement
	 */
	startPerformance(name: string, metadata?: Record<string, any>): () => void {
		const startTime = performance.now();

		return () => {
			const duration = performance.now() - startTime;
			this.trackPerformance({
				name,
				duration,
				startTime,
				metadata
			});
		};
	}

	/**
	 * Track a performance measurement
	 */
	trackPerformance(entry: PerformanceEntry): void {
		if (!this.config.enablePerformance || !this.shouldSample()) return;

		this.addToBuffer({
			type: 'performance',
			...entry,
			timestamp: Date.now(),
			sessionId: this.sessionId
		});

		// Emit event for local consumption
		this.eventBus.emit('monitoring.performance', entry);
	}

	/**
	 * Get current resource metrics
	 */
	async getResourceMetrics(): Promise<ResourceMetrics> {
		const metrics: ResourceMetrics = {
			memory: {
				used: 0,
				total: 0,
				heapUsed: 0,
				heapTotal: 0
			}
		};

		// Memory metrics
		if ('memory' in performance) {
			const memory = (performance as any).memory;
			metrics.memory = {
				used: memory.usedJSHeapSize,
				total: memory.totalJSHeapSize,
				heapUsed: memory.usedJSHeapSize,
				heapTotal: memory.jsHeapSizeLimit
			};
		}

		// GPU metrics (if available through WebGPU)
		try {
			if ('gpu' in navigator) {
				const adapter = await navigator.gpu.requestAdapter();
				if (adapter) {
					// Note: Real GPU metrics would require browser-specific APIs
					// This is a placeholder for future implementation
					metrics.gpu = {
						memoryUsed: 0,
						memoryTotal: 0,
						utilization: 0
					};
				}
			}
		} catch (error) {
			// GPU not available
		}

		return metrics;
	}

	/**
	 * Flush buffered data
	 */
	async flush(): Promise<void> {
		if (this.buffer.length === 0) return;

		const data = [...this.buffer];
		this.buffer = [];

		if (!this.config.endpoint) {
			// No endpoint configured, just log
			uiLogger.debug('Monitoring data:', data);
			return;
		}

		try {
			await fetch(this.config.endpoint, {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					...(this.config.apiKey && { 'X-API-Key': this.config.apiKey })
				},
				body: JSON.stringify({
					sessionId: this.sessionId,
					events: data
				})
			});
		} catch (error) {
			uiLogger.error('Failed to send monitoring data:', error);
			// Put data back in buffer if send failed
			this.buffer.unshift(...data);
		}
	}

	/**
	 * Clean up resources
	 */
	dispose(): void {
		// Clear intervals
		if (this.flushTimer) {
			clearInterval(this.flushTimer);
		}

		if (this.resourceMonitorInterval) {
			clearInterval(this.resourceMonitorInterval);
		}

		// Disconnect performance observer
		if (this.performanceObserver) {
			this.performanceObserver.disconnect();
		}

		// Remove window event listeners
		if (this.errorHandler) {
			window.removeEventListener('error', this.errorHandler);
		}

		if (this.unhandledRejectionHandler) {
			window.removeEventListener('unhandledrejection', this.unhandledRejectionHandler);
		}

		if (this.visibilityChangeHandler) {
			document.removeEventListener('visibilitychange', this.visibilityChangeHandler);
		}

		if (this.beforeUnloadHandler) {
			window.removeEventListener('beforeunload', this.beforeUnloadHandler);
		}

		// Clean up event bus listeners
		this.eventUnsubscribes.forEach(unsubscribe => unsubscribe());
		this.eventUnsubscribes = [];

		// Final flush
		this.flush();

		this.isInitialized = false;
	}

	// Private methods

	private setupErrorHandling(): void {
		// Global error handler
		this.errorHandler = (event) => {
			this.trackError({
				message: event.message,
				stack: event.error?.stack,
				severity: 'high',
				context: {
					filename: event.filename,
					lineno: event.lineno,
					colno: event.colno
				}
			});
		};
		window.addEventListener('error', this.errorHandler);

		// Unhandled promise rejections
		this.unhandledRejectionHandler = (event) => {
			this.trackError({
				message: `Unhandled Promise Rejection: ${event.reason}`,
				severity: 'high',
				context: {
					reason: event.reason
				}
			});
		};
		window.addEventListener('unhandledrejection', this.unhandledRejectionHandler);
	}

	private setupPerformanceMonitoring(): void {
		// Monitor long tasks
		if ('PerformanceObserver' in window) {
			try {
				this.performanceObserver = new PerformanceObserver((entries) => {
					for (const entry of entries.getEntries()) {
						if (entry.duration > 50) {
							// Long task threshold
							this.trackPerformance({
								name: 'long-task',
								duration: entry.duration,
								startTime: entry.startTime,
								metadata: {
									entryType: entry.entryType
								}
							});
						}
					}
				});

				this.performanceObserver.observe({ entryTypes: ['longtask', 'measure'] });
			} catch (error) {
				uiLogger.warn('Performance Observer not supported');
			}
		}

		// Monitor page visibility changes
		this.visibilityChangeHandler = () => {
			this.trackAction({
				action: 'visibility-change',
				category: 'engagement',
				label: document.hidden ? 'hidden' : 'visible'
			});
		};
		document.addEventListener('visibilitychange', this.visibilityChangeHandler);
	}

	private setupResourceMonitoring(): void {
		// Monitor resources every 30 seconds
		this.resourceMonitorInterval = window.setInterval(async () => {
			const metrics = await this.getResourceMetrics();

			this.trackMetric({
				name: 'memory.heap.used',
				value: metrics.memory.heapUsed,
				unit: 'bytes'
			});

			if (metrics.gpu) {
				this.trackMetric({
					name: 'gpu.memory.used',
					value: metrics.gpu.memoryUsed,
					unit: 'bytes'
				});
			}
		}, 30000);
	}

	private setupEventListeners(): void {
		// Track key application events
		const eventsToTrack = [
			'volume.loaded',
			'layer.added',
			'layer.removed',
			'annotation.created',
			'plot.created',
			'gpu.context.lost',
			'gpu.context.restored'
		];

		eventsToTrack.forEach((eventName) => {
			const unsubscribe = this.eventBus.on(eventName, (data) => {
				this.trackAction({
					action: eventName,
					category: 'application',
					metadata: data
				});
			});
			this.eventUnsubscribes.push(unsubscribe);
		});

		// Track performance-critical operations
		const perfUnsubscribe = this.eventBus.on('gpu.render.complete', ({ duration }: { duration: number }) => {
			this.trackPerformance({
				name: 'gpu.render',
				duration,
				startTime: performance.now() - duration
			});
		});
		this.eventUnsubscribes.push(perfUnsubscribe);
	}

	private startFlushTimer(): void {
		this.flushTimer = window.setInterval(() => {
			this.flush();
		}, this.config.flushInterval);

		// Also flush on page unload
		this.beforeUnloadHandler = () => {
			this.flush();
		};
		window.addEventListener('beforeunload', this.beforeUnloadHandler);
	}

	private addToBuffer(data: any): void {
		this.buffer.push(data);

		// Flush if buffer is full
		if (this.buffer.length >= this.config.bufferSize) {
			this.flush();
		}
	}

	private shouldSample(): boolean {
		return Math.random() < this.config.sampleRate;
	}

	private generateSessionId(): string {
		return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
	}
}

// Singleton instance
let monitoringService: MonitoringService | null = null;

export function getMonitoringService(): MonitoringService {
	if (!monitoringService) {
		monitoringService = new MonitoringService();
	}
	return monitoringService;
}
