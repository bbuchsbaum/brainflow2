/**
 * Base class for resilient services with automatic retry logic
 * Provides error recovery, retry mechanisms, and fallback strategies
 */

import type { NotificationService } from './NotificationService';
import { createRetryableState } from '$lib/utils/stateHelpers';
import type { EventBus } from '$lib/events/EventBus';

export interface RetryConfig {
	maxRetries?: number;
	baseDelay?: number;
	maxDelay?: number;
	shouldRetry?: (error: Error, attempt: number) => boolean;
	onRetry?: (error: Error, attempt: number) => void;
	timeout?: number;
}

export interface ResilientServiceConfig {
	serviceName: string;
	eventBus?: EventBus;
	notificationService?: NotificationService;
	defaultRetryConfig?: RetryConfig;
	enableCircuitBreaker?: boolean;
	circuitBreakerThreshold?: number;
	circuitBreakerResetTime?: number;
	resilientSettings?: {
		enableCircuitBreaker?: boolean;
		circuitBreakerThreshold?: number;
		circuitBreakerResetTime?: number;
		maxRetries?: number;
		baseDelay?: number;
		maxDelay?: number;
		timeout?: number;
	};
}

// Common retryable errors
export const RETRYABLE_ERRORS = [
	'NetworkError',
	'TimeoutError',
	'ServiceUnavailable',
	'TooManyRequests',
	'TemporaryFailure'
];

/**
 * Circuit breaker states
 */
export enum CircuitState {
	CLOSED = 'closed', // Normal operation
	OPEN = 'open', // Failing, reject all calls
	HALF_OPEN = 'half_open' // Testing if service recovered
}

/**
 * Base class for resilient services
 */
export abstract class ResilientService {
	protected serviceName: string;
	protected eventBus?: EventBus;
	protected notificationService?: NotificationService;
	protected defaultRetryConfig: Required<RetryConfig>;

	// Circuit breaker state
	private circuitBreakerEnabled: boolean;
	private circuitState = CircuitState.CLOSED;
	private failureCount = 0;
	private circuitBreakerThreshold: number;
	private circuitBreakerResetTime: number;
	private lastFailureTime = 0;
	private halfOpenTestInProgress = false;

	constructor(config: ResilientServiceConfig) {
		this.serviceName = config.serviceName;
		this.eventBus = config.eventBus;
		this.notificationService = config.notificationService;

		// Set default retry configuration with precedence:
		// 1. defaultRetryConfig (specific overrides)
		// 2. resilientSettings from config service
		// 3. hardcoded defaults
		this.defaultRetryConfig = {
			maxRetries: config.defaultRetryConfig?.maxRetries ?? 
				config.resilientSettings?.maxRetries ?? 3,
			baseDelay: config.defaultRetryConfig?.baseDelay ?? 
				config.resilientSettings?.baseDelay ?? 1000,
			maxDelay: config.defaultRetryConfig?.maxDelay ?? 
				config.resilientSettings?.maxDelay ?? 30000,
			shouldRetry: config.defaultRetryConfig?.shouldRetry ?? this.defaultShouldRetry.bind(this),
			onRetry: config.defaultRetryConfig?.onRetry ?? this.defaultOnRetry.bind(this),
			timeout: config.defaultRetryConfig?.timeout ?? 
				config.resilientSettings?.timeout ?? 30000
		};

		// Circuit breaker configuration with precedence:
		// 1. direct config properties
		// 2. resilientSettings from config service
		// 3. hardcoded defaults
		this.circuitBreakerEnabled = config.enableCircuitBreaker ?? 
			config.resilientSettings?.enableCircuitBreaker ?? false;
		this.circuitBreakerThreshold = config.circuitBreakerThreshold ?? 
			config.resilientSettings?.circuitBreakerThreshold ?? 5;
		this.circuitBreakerResetTime = config.circuitBreakerResetTime ?? 
			config.resilientSettings?.circuitBreakerResetTime ?? 60000; // 1 minute
	}

	/**
	 * Execute an operation with retry logic
	 */
	protected async withRetry<T>(
		operation: () => Promise<T>,
		operationName: string,
		customConfig?: Partial<RetryConfig>
	): Promise<T> {
		const config = { ...this.defaultRetryConfig, ...customConfig };

		// Check circuit breaker
		if (this.circuitBreakerEnabled) {
			this.checkCircuitBreaker();

			if (this.circuitState === CircuitState.OPEN) {
				const error = new Error(`Circuit breaker open for ${this.serviceName}`);
				error.name = 'CircuitBreakerOpen';
				throw error;
			}
		}

		let lastError: Error | null = null;

		for (let attempt = 0; attempt <= config.maxRetries; attempt++) {
			try {
				// Execute operation
				const result = await this.executeWithTimeout(operation, operationName, config.timeout);

				// Success - reset circuit breaker
				if (this.circuitBreakerEnabled) {
					this.onSuccess();
				}

				// Emit success event
				this.eventBus?.emit(`${this.serviceName}.operation.success`, {
					operation: operationName,
					attempt
				});

				return result;
			} catch (error) {
				lastError = error as Error;

				// Check if we should retry
				if (attempt < config.maxRetries && config.shouldRetry(lastError, attempt + 1)) {
					// Calculate delay with exponential backoff
					const delay = Math.min(config.baseDelay * Math.pow(2, attempt), config.maxDelay);

					// Call retry handler
					config.onRetry(lastError, attempt + 1);

					// Emit retry event
					this.eventBus?.emit(`${this.serviceName}.operation.retry`, {
						operation: operationName,
						error: lastError,
						attempt: attempt + 1,
						delay
					});

					// Wait before retrying
					await this.delay(delay);
				} else {
					// No more retries
					break;
				}
			}
		}

		// All retries failed
		if (this.circuitBreakerEnabled) {
			this.onFailure();
		}

		// Emit failure event
		this.eventBus?.emit(`${this.serviceName}.operation.failed`, {
			operation: operationName,
			error: lastError,
			attempts: config.maxRetries + 1
		});

		throw lastError;
	}

	/**
	 * Execute an operation with timeout
	 */
	private async executeWithTimeout<T>(
		operation: () => Promise<T>,
		operationName: string,
		timeout?: number
	): Promise<T> {
		if (!timeout || timeout <= 0) {
			// No timeout specified
			return operation();
		}

		const timeoutPromise = new Promise<never>((_, reject) => {
			setTimeout(() => {
				const error = new Error(`Operation ${operationName} timed out after ${timeout}ms`);
				error.name = 'TimeoutError';
				reject(error);
			}, timeout);
		});

		return Promise.race([operation(), timeoutPromise]);
	}

	/**
	 * Default logic for determining if an error is retryable
	 */
	private defaultShouldRetry(error: Error, attempt: number): boolean {
		// Don't retry circuit breaker errors
		if (error.name === 'CircuitBreakerOpen') {
			return false;
		}

		// Check if error is in retryable list
		if (RETRYABLE_ERRORS.includes(error.name)) {
			return true;
		}

		// Check for network errors
		if (
			error.message.toLowerCase().includes('network') ||
			error.message.toLowerCase().includes('fetch')
		) {
			return true;
		}

		// Check for specific HTTP status codes
		if ('status' in error) {
			const status = (error as any).status;
			// Retry on 429 (rate limit), 502 (bad gateway), 503 (service unavailable), 504 (gateway timeout)
			return [429, 502, 503, 504].includes(status);
		}

		return false;
	}

	/**
	 * Default retry handler
	 */
	private defaultOnRetry(error: Error, attempt: number): void {
		const message = `${this.serviceName}: Retrying after error (attempt ${attempt})`;

		if (this.notificationService) {
			this.notificationService.info(message, {
				duration: 3000
			});
		}

		console.warn(message, error);
	}

	/**
	 * Circuit breaker: Check and update state
	 */
	private checkCircuitBreaker(): void {
		const now = Date.now();

		switch (this.circuitState) {
			case CircuitState.OPEN:
				// Check if enough time has passed to try half-open
				if (now - this.lastFailureTime > this.circuitBreakerResetTime) {
					this.circuitState = CircuitState.HALF_OPEN;
					this.halfOpenTestInProgress = true;
				}
				break;

			case CircuitState.HALF_OPEN:
				// Allow one test request
				if (this.halfOpenTestInProgress) {
					// Another request is already testing
					this.circuitState = CircuitState.OPEN;
				}
				break;
		}
	}

	/**
	 * Circuit breaker: Handle success
	 */
	private onSuccess(): void {
		this.failureCount = 0;

		if (this.circuitState === CircuitState.HALF_OPEN) {
			// Test succeeded, close circuit
			this.circuitState = CircuitState.CLOSED;
			this.halfOpenTestInProgress = false;

			this.eventBus?.emit(`${this.serviceName}.circuit.closed`);
		}
	}

	/**
	 * Circuit breaker: Handle failure
	 */
	private onFailure(): void {
		this.failureCount++;
		this.lastFailureTime = Date.now();

		if (this.circuitState === CircuitState.HALF_OPEN) {
			// Test failed, reopen circuit
			this.circuitState = CircuitState.OPEN;
			this.halfOpenTestInProgress = false;

			this.eventBus?.emit(`${this.serviceName}.circuit.opened`);
		} else if (this.failureCount >= this.circuitBreakerThreshold) {
			// Too many failures, open circuit
			this.circuitState = CircuitState.OPEN;

			this.eventBus?.emit(`${this.serviceName}.circuit.opened`);

			if (this.notificationService) {
				this.notificationService.error(
					`${this.serviceName} is temporarily unavailable due to repeated failures`,
					{ duration: 10000 }
				);
			}
		}
	}

	/**
	 * Helper to create retryable state for complex operations
	 */
	protected createRetryableOperation<T>(maxRetries = 3, baseDelay = 1000) {
		return createRetryableState<T>(maxRetries, baseDelay, this.notificationService);
	}

	/**
	 * Utility: Delay for specified milliseconds
	 */
	private delay(ms: number): Promise<void> {
		return new Promise((resolve) => setTimeout(resolve, ms));
	}

	/**
	 * Get current circuit breaker state
	 */
	public getCircuitState(): CircuitState {
		return this.circuitState;
	}

	/**
	 * Manually reset circuit breaker
	 */
	public resetCircuitBreaker(): void {
		this.circuitState = CircuitState.CLOSED;
		this.failureCount = 0;
		this.lastFailureTime = 0;
		this.halfOpenTestInProgress = false;

		this.eventBus?.emit(`${this.serviceName}.circuit.reset`);
	}

	/**
	 * Get service health status
	 */
	public getHealthStatus() {
		return {
			serviceName: this.serviceName,
			healthy: this.circuitState === CircuitState.CLOSED,
			circuitState: this.circuitState,
			failureCount: this.failureCount,
			lastFailureTime: this.lastFailureTime
		};
	}
}
