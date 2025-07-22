/**
 * Tests for ResilientService base class
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ResilientService, CircuitState, RETRYABLE_ERRORS } from './ResilientService';
import { EventBus } from '../events/EventBus';
import type { NotificationService } from './NotificationService';

// Test implementation of ResilientService
class TestResilientService extends ResilientService {
	constructor(config: any) {
		super(config);
	}

	// Expose protected method for testing
	async testWithRetry<T>(
		operation: () => Promise<T>,
		operationName: string,
		customConfig?: any
	): Promise<T> {
		return this.withRetry(operation, operationName, customConfig);
	}
}

describe('ResilientService', () => {
	let service: TestResilientService;
	let eventBus: EventBus;
	let notificationService: NotificationService;

	beforeEach(() => {
		vi.useFakeTimers();
		vi.clearAllMocks();
		eventBus = new EventBus();
		notificationService = {
			info: vi.fn(),
			error: vi.fn(),
			warning: vi.fn(),
			success: vi.fn()
		} as any;

		service = new TestResilientService({
			serviceName: 'TestService',
			eventBus,
			notificationService
		});
	});

	afterEach(() => {
		vi.useRealTimers();
		vi.clearAllMocks();
	});

	describe('Basic Retry Logic', () => {
		it('should succeed on first attempt', async () => {
			const mockOperation = vi.fn().mockResolvedValue('success');

			const result = await service.testWithRetry(mockOperation, 'test-operation');

			expect(result).toBe('success');
			expect(mockOperation).toHaveBeenCalledTimes(1);
		});

		it('should retry on failure and succeed', async () => {
			const mockOperation = vi
				.fn()
				.mockRejectedValueOnce(new Error('NetworkError'))
				.mockResolvedValueOnce('success');

			const promise = service.testWithRetry(mockOperation, 'test-operation');

			// Use runAllTimersAsync for complex async flows
			await vi.runAllTimersAsync();

			const result = await promise;
			expect(result).toBe('success');
			expect(mockOperation).toHaveBeenCalledTimes(2);
		});

		it('should use exponential backoff', async () => {
			const mockOperation = vi
				.fn()
				.mockRejectedValueOnce(new Error('NetworkError'))
				.mockRejectedValueOnce(new Error('NetworkError'))
				.mockResolvedValueOnce('success');

			const promise = service.testWithRetry(mockOperation, 'test-operation', {
				maxRetries: 3,
				baseDelay: 100
			});

			// Use runAllTimersAsync to handle all timer operations
			await vi.runAllTimersAsync();

			const result = await promise;
			expect(result).toBe('success');
			expect(mockOperation).toHaveBeenCalledTimes(3);
		});

		it('should fail after max retries', async () => {
			const error = new Error('NetworkError');
			const mockOperation = vi.fn().mockRejectedValue(error);

			const promise = service.testWithRetry(mockOperation, 'test-operation', {
				maxRetries: 2,
				baseDelay: 100
			});

			// Use runAllTimersAsync to handle all retry attempts
			await vi.runAllTimersAsync();

			await expect(promise).rejects.toThrow('NetworkError');
			expect(mockOperation).toHaveBeenCalledTimes(3); // Initial + 2 retries
		});
	});

	describe('Retry Conditions', () => {
		it('should retry on retryable errors', async () => {
			for (const errorName of RETRYABLE_ERRORS) {
				const error = new Error('Test error');
				error.name = errorName;

				const mockOperation = vi.fn().mockRejectedValueOnce(error).mockResolvedValueOnce('success');

				const promise = service.testWithRetry(mockOperation, 'test-operation', { baseDelay: 100 });

				await vi.runAllTimersAsync();

				const result = await promise;
				expect(result).toBe('success');
			}
		});

		it('should retry on network-related errors', async () => {
			const networkErrors = [
				new Error('Network connection failed'),
				new Error('Failed to fetch resource'),
				new Error('ERR_NETWORK_CHANGED')
			];

			for (const error of networkErrors) {
				const mockOperation = vi.fn().mockRejectedValueOnce(error).mockResolvedValueOnce('success');

				const promise = service.testWithRetry(mockOperation, 'test-operation', { baseDelay: 100 });

				await vi.runAllTimersAsync();

				const result = await promise;
				expect(result).toBe('success');
			}
		});

		it('should retry on specific HTTP status codes', async () => {
			const retryableStatuses = [429, 502, 503, 504];

			for (const status of retryableStatuses) {
				const error: any = new Error(`HTTP ${status}`);
				error.status = status;

				const mockOperation = vi.fn().mockRejectedValueOnce(error).mockResolvedValueOnce('success');

				const promise = service.testWithRetry(mockOperation, 'test-operation', { baseDelay: 100 });

				await vi.runAllTimersAsync();

				const result = await promise;
				expect(result).toBe('success');
			}
		});

		it('should not retry on non-retryable errors', async () => {
			const error = new Error('ValidationError');
			error.name = 'ValidationError';

			const mockOperation = vi.fn().mockRejectedValue(error);

			await expect(service.testWithRetry(mockOperation, 'test-operation')).rejects.toThrow(
				'ValidationError'
			);

			expect(mockOperation).toHaveBeenCalledTimes(1);
		});

		it('should use custom shouldRetry function', async () => {
			const error = new Error('CustomError');
			const mockOperation = vi.fn().mockRejectedValueOnce(error).mockResolvedValueOnce('success');

			const shouldRetry = vi.fn().mockReturnValue(true);

			const promise = service.testWithRetry(mockOperation, 'test-operation', {
				shouldRetry,
				baseDelay: 100
			});

			await vi.advanceTimersByTimeAsync(0);
			await vi.advanceTimersByTimeAsync(100);

			const result = await promise;
			expect(result).toBe('success');
			expect(shouldRetry).toHaveBeenCalledWith(error, 1);
		});
	});

	describe('Circuit Breaker', () => {
		let circuitService: TestResilientService;
		let circuitNotificationService: any;
		let circuitEventBus: EventBus;

		beforeEach(() => {
			vi.clearAllMocks();
			vi.clearAllTimers();
			// Create fresh event bus for circuit breaker tests
			circuitEventBus = new EventBus();
			circuitNotificationService = {
				info: vi.fn(),
				error: vi.fn(),
				warning: vi.fn(),
				success: vi.fn()
			};

			circuitService = new TestResilientService({
				serviceName: 'CircuitService',
				eventBus: circuitEventBus,
				notificationService: circuitNotificationService,
				enableCircuitBreaker: true,
				circuitBreakerThreshold: 3,
				circuitBreakerResetTime: 5000
			});
		});

		it('should open circuit after threshold failures', async () => {
			const error = new Error('NetworkError');
			const mockOperation = vi.fn().mockRejectedValue(error);

			// Fail 3 times to open circuit
			for (let i = 0; i < 3; i++) {
				try {
					await circuitService.testWithRetry(mockOperation, 'test-operation', { maxRetries: 0 });
				} catch (e) {
					// Expected
				}
			}

			expect(circuitService.getCircuitState()).toBe(CircuitState.OPEN);
			expect(circuitNotificationService.error).toHaveBeenCalledWith(
				'CircuitService is temporarily unavailable due to repeated failures',
				{ duration: 10000 }
			);
		});

		it('should reject calls when circuit is open', async () => {
			// Open the circuit
			const error = new Error('NetworkError');
			const mockOperation = vi.fn().mockRejectedValue(error);

			for (let i = 0; i < 3; i++) {
				try {
					await circuitService.testWithRetry(mockOperation, 'test-operation', { maxRetries: 0 });
				} catch (e) {
					// Expected
				}
			}

			// Try another call - should be rejected immediately
			const newOperation = vi.fn().mockResolvedValue('success');

			await expect(circuitService.testWithRetry(newOperation, 'test-operation')).rejects.toThrow(
				'Circuit breaker open for CircuitService'
			);

			expect(newOperation).not.toHaveBeenCalled();
		});

		it('should transition to half-open after reset time', async () => {
			// Open the circuit
			const error = new Error('NetworkError');
			const mockOperation = vi.fn().mockRejectedValue(error);

			for (let i = 0; i < 3; i++) {
				try {
					await circuitService.testWithRetry(mockOperation, 'test-operation', { maxRetries: 0 });
				} catch (e) {
					// Expected
				}
			}

			expect(circuitService.getCircuitState()).toBe(CircuitState.OPEN);

			// Wait for reset time
			await vi.advanceTimersByTimeAsync(5001);
			await vi.runOnlyPendingTimersAsync();

			// Next call should be allowed (half-open test)
			const successOperation = vi.fn().mockResolvedValue('success');
			const result = await circuitService.testWithRetry(successOperation, 'test-operation');

			expect(result).toBe('success');
			expect(circuitService.getCircuitState()).toBe(CircuitState.CLOSED);
		});

		it('should reopen circuit if half-open test fails', async () => {
			// Open the circuit
			const error = new Error('NetworkError');
			const mockOperation = vi.fn().mockRejectedValue(error);

			for (let i = 0; i < 3; i++) {
				try {
					await circuitService.testWithRetry(mockOperation, 'test-operation', { maxRetries: 0 });
				} catch (e) {
					// Expected
				}
			}

			// Wait for reset time
			await vi.advanceTimersByTimeAsync(5000);
			await vi.runOnlyPendingTimersAsync();

			// Half-open test fails
			try {
				await circuitService.testWithRetry(mockOperation, 'test-operation', { maxRetries: 0 });
			} catch (e) {
				// Expected
			}

			expect(circuitService.getCircuitState()).toBe(CircuitState.OPEN);
		});

		it('should emit circuit breaker events', async () => {
			// Create a new service with its own event bus for this test
			const testEventBus = new EventBus();
			const testNotificationService = {
				info: vi.fn(),
				error: vi.fn(),
				warning: vi.fn(),
				success: vi.fn()
			} as any;

			const eventService = new TestResilientService({
				serviceName: 'EventCircuitService',
				eventBus: testEventBus,
				notificationService: testNotificationService,
				enableCircuitBreaker: true,
				circuitBreakerThreshold: 3,
				circuitBreakerResetTime: 5000
			});

			const openedSpy = vi.fn();
			const closedSpy = vi.fn();

			testEventBus.on('EventCircuitService.circuit.opened', openedSpy);
			testEventBus.on('EventCircuitService.circuit.closed', closedSpy);

			// Open circuit
			const error = new Error('NetworkError');
			const mockOperation = vi.fn().mockRejectedValue(error);

			for (let i = 0; i < 3; i++) {
				try {
					await eventService.testWithRetry(mockOperation, 'test-operation', { maxRetries: 0 });
				} catch (e) {
					// Expected
				}
			}

			expect(openedSpy).toHaveBeenCalled();

			// Wait and close circuit
			await vi.advanceTimersByTimeAsync(5001);

			const successOperation = vi.fn().mockResolvedValue('success');
			await eventService.testWithRetry(successOperation, 'test-operation');

			expect(closedSpy).toHaveBeenCalled();
		});

		it('should reset circuit breaker manually', async () => {
			// Set circuit to open state
			const error = new Error('NetworkError');
			const mockOperation = vi.fn().mockRejectedValue(error);

			// Fail enough times to open circuit
			for (let i = 0; i < 3; i++) {
				try {
					await circuitService.testWithRetry(mockOperation, 'test-operation', { maxRetries: 0 });
				} catch (e) {
					// Expected
				}
			}

			expect(circuitService.getCircuitState()).toBe(CircuitState.OPEN);

			// Manual reset
			circuitService.resetCircuitBreaker();

			expect(circuitService.getCircuitState()).toBe(CircuitState.CLOSED);
			expect(circuitService.getHealthStatus().failureCount).toBe(0);
		});
	});

	describe('Timeout Handling', () => {
		it('should timeout long-running operations', async () => {
			const mockOperation = vi.fn().mockImplementation(
				() =>
					new Promise<string>(() => {
						// Never resolves
					})
			);

			// Start the operation but don't await it yet
			const promise = service.testWithRetry(
				mockOperation,
				'test-operation',
				{ timeout: 100, maxRetries: 0 } // Short timeout, no retries
			);

			// Advance timers to trigger the timeout
			await vi.advanceTimersByTimeAsync(100);

			// Now we can safely await and expect the timeout error
			await expect(promise).rejects.toThrow('Operation test-operation timed out after 100ms');
		});
	});

	describe('Event Emission', () => {
		it('should emit success event', async () => {
			const successSpy = vi.fn();
			eventBus.on('TestService.operation.success', successSpy);

			const mockOperation = vi.fn().mockResolvedValue('success');
			await service.testWithRetry(mockOperation, 'test-operation');

			expect(successSpy).toHaveBeenCalledWith({
				operation: 'test-operation',
				attempt: 0
			});
		});

		it('should emit retry events', async () => {
			const retrySpy = vi.fn();
			eventBus.on('TestService.operation.retry', retrySpy);

			const mockOperation = vi
				.fn()
				.mockRejectedValueOnce(new Error('NetworkError'))
				.mockResolvedValueOnce('success');

			const promise = service.testWithRetry(mockOperation, 'test-operation', { baseDelay: 100 });

			await vi.runAllTimersAsync();
			await promise;

			expect(retrySpy).toHaveBeenCalledWith({
				operation: 'test-operation',
				error: expect.any(Error),
				attempt: 1,
				delay: 100
			});
		});

		it('should emit failure event', async () => {
			const failureSpy = vi.fn();
			eventBus.on('TestService.operation.failed', failureSpy);

			const error = new Error('NetworkError');
			const mockOperation = vi.fn().mockRejectedValue(error);

			const promise = service.testWithRetry(mockOperation, 'test-operation', {
				maxRetries: 1,
				baseDelay: 100
			});

			// Use runAllTimersAsync for all retry attempts
			await vi.runAllTimersAsync();

			try {
				await promise;
			} catch (e) {
				// Expected
			}

			expect(failureSpy).toHaveBeenCalledWith({
				operation: 'test-operation',
				error,
				attempts: 2
			});
		});
	});

	describe('Notification Integration', () => {
		it('should show retry notifications', async () => {
			const mockOperation = vi
				.fn()
				.mockRejectedValueOnce(new Error('NetworkError'))
				.mockResolvedValueOnce('success');

			const promise = service.testWithRetry(mockOperation, 'test-operation', { baseDelay: 100 });

			await vi.runAllTimersAsync();
			await promise;

			expect(notificationService.info).toHaveBeenCalledWith(
				'TestService: Retrying after error (attempt 1)',
				{ duration: 3000 }
			);
		});

		it('should use custom retry handler', async () => {
			const customOnRetry = vi.fn();
			const mockOperation = vi
				.fn()
				.mockRejectedValueOnce(new Error('NetworkError'))
				.mockResolvedValueOnce('success');

			const promise = service.testWithRetry(mockOperation, 'test-operation', {
				baseDelay: 100,
				onRetry: customOnRetry
			});

			await vi.advanceTimersByTimeAsync(0);
			await vi.advanceTimersByTimeAsync(100);
			await promise;

			expect(customOnRetry).toHaveBeenCalledWith(expect.any(Error), 1);
		});
	});

	describe('Health Status', () => {
		it('should report health status', () => {
			const status = service.getHealthStatus();

			expect(status).toEqual({
				serviceName: 'TestService',
				healthy: true,
				circuitState: CircuitState.CLOSED,
				failureCount: 0,
				lastFailureTime: 0
			});
		});

		it('should update health status on failures', async () => {
			// Create service with circuit breaker enabled
			const healthService = new TestResilientService({
				serviceName: 'HealthTestService',
				eventBus,
				notificationService,
				enableCircuitBreaker: true,
				circuitBreakerThreshold: 5
			});

			const error = new Error('NetworkError');
			const mockOperation = vi.fn().mockRejectedValue(error);

			try {
				await healthService.testWithRetry(mockOperation, 'test-operation', { maxRetries: 0 });
			} catch (e) {
				// Expected
			}

			const status = healthService.getHealthStatus();
			expect(status.failureCount).toBeGreaterThan(0);
			expect(status.lastFailureTime).toBeGreaterThan(0);
		});
	});
});
