/**
 * Tests for Monitoring Service
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { MonitoringService, getMonitoringService } from './MonitoringService';
import { getEventBus } from '$lib/events/EventBus';
import type { EventBus } from '$lib/events/EventBus';

// Mock fetch
global.fetch = vi.fn();

// Mock performance observer
const mockObserve = vi.fn();
const mockDisconnect = vi.fn();
global.PerformanceObserver = vi.fn().mockImplementation((callback) => ({
	observe: mockObserve,
	disconnect: mockDisconnect
})) as any;

describe('MonitoringService', () => {
	let service: MonitoringService;
	let eventBus: EventBus;
	let originalEnv: any;

	beforeEach(() => {
		// Store original env
		originalEnv = import.meta.env.DEV;

		// Set to production mode for testing
		Object.defineProperty(import.meta, 'env', {
			value: { DEV: false },
			configurable: true
		});

		// Reset mocks
		vi.clearAllMocks();
		(global.fetch as any).mockReset();

		// Create new service instance
		service = new MonitoringService();
		eventBus = getEventBus();
	});

	afterEach(() => {
		// Restore env
		Object.defineProperty(import.meta, 'env', {
			value: { DEV: originalEnv },
			configurable: true
		});

		// Clean up
		service.dispose();
	});

	describe('Initialization', () => {
		it('should initialize with default config', async () => {
			await service.initialize();

			expect(mockObserve).toHaveBeenCalledWith({
				entryTypes: ['longtask', 'measure']
			});
		});

		it('should not initialize when disabled', async () => {
			await service.initialize({ enabled: false });

			expect(mockObserve).not.toHaveBeenCalled();
		});

		it('should not initialize twice', async () => {
			await service.initialize();
			await service.initialize();

			expect(mockObserve).toHaveBeenCalledTimes(1);
		});

		it('should respect custom configuration', async () => {
			await service.initialize({
				enabled: true,
				sampleRate: 0.5,
				bufferSize: 50,
				flushInterval: 10000,
				enablePerformance: false,
				enableErrors: false
			});

			expect(mockObserve).not.toHaveBeenCalled(); // Performance disabled
		});
	});

	describe('Metric tracking', () => {
		beforeEach(async () => {
			await service.initialize({ enabled: true });
		});

		it('should track metrics', () => {
			const spy = vi.spyOn(service as any, 'addToBuffer');

			service.trackMetric({
				name: 'test.metric',
				value: 42,
				unit: 'ms',
				tags: { environment: 'test' }
			});

			expect(spy).toHaveBeenCalledWith(
				expect.objectContaining({
					type: 'metric',
					name: 'test.metric',
					value: 42,
					unit: 'ms',
					tags: { environment: 'test' }
				})
			);
		});

		it('should respect sampling rate', async () => {
			// Reinitialize with 0 sample rate
			service.dispose();
			service = new MonitoringService();
			await service.initialize({
				enabled: true,
				sampleRate: 0 // Never sample
			});

			const spy = vi.spyOn(service as any, 'addToBuffer');

			service.trackMetric({
				name: 'test.metric',
				value: 42
			});

			expect(spy).not.toHaveBeenCalled();
		});
	});

	describe('Error tracking', () => {
		beforeEach(async () => {
			await service.initialize({ enabled: true });
		});

		it('should track Error objects', () => {
			const error = new Error('Test error');
			const spy = vi.spyOn(service as any, 'addToBuffer');

			service.trackError(error, { component: 'TestComponent' });

			expect(spy).toHaveBeenCalledWith(
				expect.objectContaining({
					type: 'error',
					message: 'Test error',
					stack: expect.any(String),
					context: { component: 'TestComponent' },
					severity: 'medium'
				})
			);
		});

		it('should track ErrorData objects', () => {
			const spy = vi.spyOn(service as any, 'addToBuffer');

			service.trackError({
				message: 'Custom error',
				severity: 'critical',
				context: { userId: '123' }
			});

			expect(spy).toHaveBeenCalledWith(
				expect.objectContaining({
					type: 'error',
					message: 'Custom error',
					severity: 'critical',
					context: { userId: '123' }
				})
			);
		});
	});

	describe('Performance tracking', () => {
		beforeEach(async () => {
			await service.initialize({ enabled: true });
		});

		it('should track performance with startPerformance', () => {
			const spy = vi.spyOn(service as any, 'addToBuffer');

			const end = service.startPerformance('test.operation', { userId: '123' });

			// Simulate some work
			const start = performance.now();
			while (performance.now() - start < 10) {
				// Busy wait
			}

			end();

			expect(spy).toHaveBeenCalledWith(
				expect.objectContaining({
					type: 'performance',
					name: 'test.operation',
					duration: expect.any(Number),
					metadata: { userId: '123' }
				})
			);
		});

		it('should emit performance events', () => {
			const eventSpy = vi.fn();
			eventBus.on('monitoring.performance', eventSpy);

			service.trackPerformance({
				name: 'test.render',
				duration: 16.7,
				startTime: 1000
			});

			expect(eventSpy).toHaveBeenCalledWith({
				name: 'test.render',
				duration: 16.7,
				startTime: 1000
			});
		});
	});

	describe('User action tracking', () => {
		beforeEach(async () => {
			await service.initialize({ enabled: true });
		});

		it('should track user actions', () => {
			const spy = vi.spyOn(service as any, 'addToBuffer');

			service.trackAction({
				action: 'button.click',
				category: 'ui',
				label: 'submit',
				value: 1
			});

			expect(spy).toHaveBeenCalledWith(
				expect.objectContaining({
					type: 'action',
					action: 'button.click',
					category: 'ui',
					label: 'submit',
					value: 1
				})
			);
		});
	});

	describe('Resource metrics', () => {
		it('should get resource metrics', async () => {
			await service.initialize({ enabled: true });

			// Mock performance.memory
			Object.defineProperty(performance, 'memory', {
				value: {
					usedJSHeapSize: 1000000,
					totalJSHeapSize: 2000000,
					jsHeapSizeLimit: 4000000
				},
				configurable: true
			});

			const metrics = await service.getResourceMetrics();

			expect(metrics.memory).toEqual({
				used: 1000000,
				total: 2000000,
				heapUsed: 1000000,
				heapTotal: 4000000
			});
		});
	});

	describe('Buffer and flushing', () => {
		beforeEach(async () => {
			await service.initialize({
				enabled: true,
				bufferSize: 3,
				endpoint: 'https://monitoring.example.com/api'
			});
		});

		it('should buffer data until buffer size reached', () => {
			const flushSpy = vi.spyOn(service, 'flush');

			service.trackMetric({ name: 'metric1', value: 1 });
			service.trackMetric({ name: 'metric2', value: 2 });

			expect(flushSpy).not.toHaveBeenCalled();

			service.trackMetric({ name: 'metric3', value: 3 });

			expect(flushSpy).toHaveBeenCalled();
		});

		it('should send data to endpoint on flush', async () => {
			(global.fetch as any).mockResolvedValueOnce({ ok: true });

			service.trackMetric({ name: 'test', value: 42 });

			await service.flush();

			expect(global.fetch).toHaveBeenCalledWith(
				'https://monitoring.example.com/api',
				expect.objectContaining({
					method: 'POST',
					headers: {
						'Content-Type': 'application/json'
					},
					body: expect.stringContaining('"name":"test"')
				})
			);
		});

		it('should restore buffer on failed flush', async () => {
			(global.fetch as any).mockRejectedValueOnce(new Error('Network error'));

			service.trackMetric({ name: 'test', value: 42 });
			const bufferLengthBefore = (service as any).buffer.length;

			await service.flush();

			expect((service as any).buffer.length).toBe(bufferLengthBefore);
		});

		it('should include API key if configured', async () => {
			// Create new service with API key
			service.dispose();
			service = new MonitoringService();
			await service.initialize({
				enabled: true,
				endpoint: 'https://monitoring.example.com/api',
				apiKey: 'secret-key'
			});

			(global.fetch as any).mockResolvedValueOnce({ ok: true });

			service.trackMetric({ name: 'test', value: 42 });
			await service.flush();

			expect(global.fetch).toHaveBeenCalledWith(
				expect.any(String),
				expect.objectContaining({
					headers: expect.objectContaining({
						'X-API-Key': 'secret-key',
						'Content-Type': 'application/json'
					})
				})
			);
		});
	});

	describe('Event listeners', () => {
		beforeEach(async () => {
			await service.initialize({ enabled: true });
		});

		it('should track application events', () => {
			const spy = vi.spyOn(service, 'trackAction');

			eventBus.emit('volume.loaded', { volumeId: 'vol-123' });

			expect(spy).toHaveBeenCalledWith({
				action: 'volume.loaded',
				category: 'application',
				metadata: { volumeId: 'vol-123' }
			});
		});

		it('should track GPU render performance', () => {
			const spy = vi.spyOn(service, 'trackPerformance');

			eventBus.emit('gpu.render.complete', { duration: 16.7 });

			expect(spy).toHaveBeenCalledWith({
				name: 'gpu.render',
				duration: 16.7,
				startTime: expect.any(Number)
			});
		});
	});

	describe('Singleton pattern', () => {
		it('should return same instance', () => {
			const instance1 = getMonitoringService();
			const instance2 = getMonitoringService();

			expect(instance1).toBe(instance2);
		});
	});

	describe('Cleanup', () => {
		it('should clean up resources on dispose', async () => {
			await service.initialize({ enabled: true });

			const flushSpy = vi.spyOn(service, 'flush');

			service.dispose();

			expect(mockDisconnect).toHaveBeenCalled();
			expect(flushSpy).toHaveBeenCalled();
		});
	});
});
