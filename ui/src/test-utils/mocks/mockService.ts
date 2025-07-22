/**
 * Mock Service Factory
 * Creates mock implementations of services for testing
 */
import { vi } from 'vitest';
import type { Mock } from 'vitest';

/**
 * Creates a mock service with all methods as vi.fn() mocks
 * @param overrides - Specific method implementations to override
 * @returns Mocked service instance
 */
export function mockService<T extends Record<string, any>>(overrides: Partial<T> = {}): T {
	const mockMethods: Record<string, Mock> = {};

	// Create a proxy that returns vi.fn() for any property access
	const handler: ProxyHandler<T> = {
		get(target, prop: string) {
			// Return override if provided
			if (prop in overrides) {
				return overrides[prop as keyof T];
			}

			// Return existing mock if already created
			if (prop in mockMethods) {
				return mockMethods[prop];
			}

			// Create and cache new mock
			mockMethods[prop] = vi.fn();
			return mockMethods[prop];
		}
	};

	return new Proxy({} as T, handler);
}

/**
 * Creates a mock service with common async patterns
 * @param serviceName - Name of the service for better error messages
 * @param methods - Method names that should return promises
 * @param overrides - Specific implementations
 */
export function mockAsyncService<T extends Record<string, any>>(
	serviceName: string,
	methods: string[],
	overrides: Partial<T> = {}
): T {
	const service = {} as T;

	methods.forEach((method) => {
		if (method in overrides) {
			(service as any)[method] = overrides[method as keyof T];
		} else {
			(service as any)[method] = vi
				.fn()
				.mockRejectedValue(new Error(`${serviceName}.${method} not implemented in mock`));
		}
	});

	// Add any additional overrides not in methods list
	Object.keys(overrides).forEach((key) => {
		if (!methods.includes(key)) {
			(service as any)[key] = overrides[key as keyof T];
		}
	});

	return service;
}

/**
 * Helper to create a resolved promise mock
 */
export function mockResolvedValue<T>(value: T) {
	return vi.fn().mockResolvedValue(value);
}

/**
 * Helper to create a rejected promise mock
 */
export function mockRejectedValue(error: Error | string) {
	return vi.fn().mockRejectedValue(typeof error === 'string' ? new Error(error) : error);
}

/**
 * Helper to create a mock that returns different values on each call
 */
export function mockSequence<T>(...values: T[]) {
	const fn = vi.fn();
	values.forEach((value) => {
		fn.mockReturnValueOnce(value);
	});
	return fn;
}

/**
 * Helper to create an async mock that returns different values on each call
 */
export function mockAsyncSequence<T>(...values: T[]) {
	const fn = vi.fn();
	values.forEach((value) => {
		fn.mockResolvedValueOnce(value);
	});
	return fn;
}
