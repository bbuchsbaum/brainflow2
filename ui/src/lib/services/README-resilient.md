# Resilient Services

Pragmatic resilience patterns for Brainflow services, providing automatic retry logic, circuit breakers, and offline support without adding unnecessary complexity.

## Overview

The resilient services wrap existing services to add:

- **Automatic retry** with exponential backoff
- **Circuit breaker** pattern to prevent cascading failures
- **Offline mode** with intelligent caching
- **Partial failure handling** for batch operations
- **Timeout protection** for long-running operations

## Base Class: ResilientService

The `ResilientService` base class provides core resilience functionality that can be extended by any service.

### Features

#### Retry Logic

- Configurable max retries and delays
- Exponential backoff with jitter
- Smart retry decisions based on error type
- Custom retry handlers

```typescript
protected async withRetry<T>(
  operation: () => Promise<T>,
  operationName: string,
  config?: RetryConfig
): Promise<T>
```

#### Circuit Breaker

- Three states: CLOSED (normal), OPEN (failing), HALF_OPEN (testing)
- Automatic state transitions based on failure threshold
- Manual reset capability
- Event notifications for state changes

#### Error Classification

Automatically retries:

- Network errors
- Timeout errors
- Service unavailable (503)
- Rate limiting (429)
- Temporary failures

Does NOT retry:

- Validation errors
- Permission errors
- Not found errors
- Circuit breaker open

### Configuration

```typescript
const service = new ResilientService({
	serviceName: 'MyService',
	eventBus,
	notificationService,
	enableCircuitBreaker: true,
	circuitBreakerThreshold: 5, // Open after 5 failures
	circuitBreakerResetTime: 60000, // Try again after 1 minute
	defaultRetryConfig: {
		maxRetries: 3,
		baseDelay: 1000,
		maxDelay: 30000
	}
});
```

## Example: ResilientVolumeService

The `ResilientVolumeService` extends `VolumeService` with resilience features.

### Additional Features

#### Offline Mode

- Caches successfully loaded volumes
- Falls back to cache when offline
- Automatic cache size management
- Network status monitoring

#### Intelligent Fallbacks

- Placeholder data for failed slice loads
- Approximate coordinate conversions
- Graceful degradation of features

#### Batch Operations

- Partial failure handling
- Continue processing despite individual failures
- Detailed failure reporting

### Usage

```typescript
// Get the resilient service
const volumeService = await getService<ResilientVolumeService>('resilientVolumeService');

// Load with automatic retry
try {
	const volumeId = await volumeService.load('/path/to/volume.nii');
} catch (error) {
	// Failed after retries or non-retryable error
}

// Batch load with partial failure handling
const result = await volumeService.batchLoad(['/path/1.nii', '/path/2.nii', '/path/3.nii']);

console.log(`Loaded: ${result.loaded.length}`);
console.log(`Failed: ${result.failed.length}`);

// Get health status
const health = volumeService.getHealthStatus();
console.log(`Circuit state: ${health.resilience.circuitState}`);
console.log(`Offline cache: ${health.offlineCacheSize} volumes`);
```

## Creating Your Own Resilient Service

1. **Extend ResilientService**:

```typescript
export class ResilientMyService extends MyService {
	private resilientBase: ResilientService;

	constructor(config: ResilientMyServiceConfig) {
		super(config);

		this.resilientBase = new ResilientService({
			serviceName: 'MyService',
			eventBus: config.eventBus,
			notificationService: config.notificationService
		});
	}
}
```

2. **Wrap operations with retry**:

```typescript
async riskyOperation(param: string): Promise<Result> {
  return this.resilientBase.withRetry(
    () => super.riskyOperation(param),
    'risky-operation',
    {
      maxRetries: 2,
      baseDelay: 500
    }
  );
}
```

3. **Add custom retry logic**:

```typescript
private shouldRetryMyOperation(error: Error): boolean {
  // Custom logic for your service
  if (error.message.includes('specific-error')) {
    return false; // Don't retry
  }
  return true; // Use default logic
}
```

## Best Practices

### When to Use Resilient Services

✅ **Good candidates**:

- External API calls
- Network operations
- File system operations
- GPU operations that might fail
- Any operation with transient failures

❌ **Not suitable for**:

- Pure computation
- Local state management
- Validation logic
- User input handling

### Configuration Guidelines

1. **Retry counts**: Keep low (2-3) for user-facing operations
2. **Delays**: Start small (100-1000ms), increase exponentially
3. **Circuit breaker**: Set threshold based on criticality
4. **Timeouts**: Always set reasonable timeouts (5-30s)

### Error Handling

1. **Be specific**: Classify errors correctly for retry decisions
2. **User feedback**: Show progress during retries
3. **Graceful degradation**: Provide fallbacks when possible
4. **Logging**: Track failures for debugging

## Events

Resilient services emit events for monitoring:

```typescript
// Success
eventBus.on('ServiceName.operation.success', ({ operation, attempt }) => {
	console.log(`${operation} succeeded on attempt ${attempt}`);
});

// Retry
eventBus.on('ServiceName.operation.retry', ({ operation, error, attempt, delay }) => {
	console.log(`Retrying ${operation} after ${delay}ms (attempt ${attempt})`);
});

// Failure
eventBus.on('ServiceName.operation.failed', ({ operation, error, attempts }) => {
	console.log(`${operation} failed after ${attempts} attempts`);
});

// Circuit breaker
eventBus.on('ServiceName.circuit.opened', () => {
	console.log('Circuit breaker opened - service unavailable');
});

eventBus.on('ServiceName.circuit.closed', () => {
	console.log('Circuit breaker closed - service restored');
});
```

## Testing

Test resilient services with simulated failures:

```typescript
describe('ResilientService', () => {
	it('should retry on network error', async () => {
		const operation = vi
			.fn()
			.mockRejectedValueOnce(new Error('Network error'))
			.mockResolvedValueOnce('success');

		const result = await service.withRetry(operation, 'test');

		expect(result).toBe('success');
		expect(operation).toHaveBeenCalledTimes(2);
	});

	it('should open circuit breaker', async () => {
		// Fail multiple times
		for (let i = 0; i < 5; i++) {
			await expect(service.failingOperation()).rejects.toThrow();
		}

		// Circuit should be open
		await expect(service.failingOperation()).rejects.toThrow('Circuit breaker open');
	});
});
```

## Performance Considerations

1. **Retries add latency**: Consider user experience
2. **Circuit breakers prevent overload**: But may seem "broken" to users
3. **Caching uses memory**: Monitor cache sizes
4. **Events have overhead**: Don't emit too frequently

## Migration Guide

To migrate existing service usage:

```typescript
// Before
const volumeService = await getService<VolumeService>('volumeService');

// After (opt-in to resilience)
const volumeService = await getService<ResilientVolumeService>('resilientVolumeService');

// Or configure in DI container to use resilient version by default
container.register('volumeService', async () => {
	// Return resilient version instead
	return container.resolve('resilientVolumeService');
});
```

## Summary

Resilient services provide pragmatic error handling without complexity:

- Simple retry logic that "just works"
- Circuit breakers prevent cascade failures
- Offline support for better UX
- Easy to add to existing services
- No complex state machines or patterns

The goal is reliability without over-engineering - practical solutions for real-world problems.
