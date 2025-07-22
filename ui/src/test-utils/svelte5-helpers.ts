/**
 * Test utilities for Svelte 5 components with reactive effects
 */
import { vi } from 'vitest';
import { waitFor } from '@testing-library/svelte';

/**
 * Wait for Svelte effects to complete
 * Useful when testing components with multiple $effect blocks
 */
export async function waitForEffects(timeout = 100): Promise<void> {
	// Allow effects to run
	await new Promise((resolve) => setTimeout(resolve, 0));

	// If using fake timers, advance them
	if (vi.isFakeTimers()) {
		await vi.runAllTimersAsync();
	}

	// Wait a bit more for any async operations
	await new Promise((resolve) => setTimeout(resolve, timeout));
}

/**
 * Flush all pending effects and microtasks
 */
export async function flushEffects(): Promise<void> {
	// Flush microtasks
	await Promise.resolve();

	// Run any pending timers
	if (vi.isFakeTimers()) {
		vi.runAllTimers();
	}

	// Allow another microtask cycle
	await Promise.resolve();
}

/**
 * Create a controllable async mock
 * Returns a mock function and methods to control its resolution
 */
export function createAsyncMock<T = any>() {
	let resolvePromise: ((value: T) => void) | null = null;
	let rejectPromise: ((error: Error) => void) | null = null;

	const promise = new Promise<T>((resolve, reject) => {
		resolvePromise = resolve;
		rejectPromise = reject;
	});

	const mockFn = vi.fn(() => promise);

	return {
		mockFn,
		resolve: (value: T) => {
			if (resolvePromise) {
				resolvePromise(value);
				// Allow promise to resolve
				return flushEffects();
			}
			return Promise.resolve();
		},
		reject: (error: Error) => {
			if (rejectPromise) {
				rejectPromise(error);
				// Allow promise to reject
				return flushEffects();
			}
			return Promise.resolve();
		},
		promise
	};
}

/**
 * Wait for a specific condition with better error messages
 */
export async function waitForCondition(
	condition: () => boolean | Promise<boolean>,
	options: {
		timeout?: number;
		interval?: number;
		message?: string;
	} = {}
): Promise<void> {
	const { timeout = 5000, interval = 50, message = 'Condition not met' } = options;
	const startTime = Date.now();

	while (Date.now() - startTime < timeout) {
		const result = await condition();
		if (result) {
			return;
		}
		await new Promise((resolve) => setTimeout(resolve, interval));
	}

	throw new Error(`waitForCondition timeout: ${message}`);
}

/**
 * Create a mock store subscription that can be controlled in tests
 */
export function createMockStoreSubscription<T>(initialState: T) {
	const listeners = new Set<(state: T) => void>();
	let currentState = initialState;

	const subscribe = vi.fn((listener: (state: T) => void) => {
		listeners.add(listener);
		// Call listener immediately with current state
		listener(currentState);

		return () => {
			listeners.delete(listener);
		};
	});

	const setState = (newState: T) => {
		currentState = newState;
		listeners.forEach((listener) => listener(newState));
	};

	return {
		subscribe,
		setState,
		getState: () => currentState,
		getListeners: () => listeners
	};
}

/**
 * Wrapper for testing components with async effects
 */
export async function renderWithEffects(
	renderFn: () => any,
	options: { waitForInitial?: boolean } = {}
) {
	const result = renderFn();

	if (options.waitForInitial) {
		await waitForEffects();
	}

	return result;
}

/**
 * Mock timer utilities for testing time-dependent operations
 */
export const timerUtils = {
	/**
	 * Setup fake timers with proper cleanup
	 */
	setup() {
		vi.useFakeTimers();
		return {
			cleanup: () => {
				vi.runOnlyPendingTimers();
				vi.useRealTimers();
			}
		};
	},

	/**
	 * Advance timers and wait for effects
	 */
	async advance(ms: number) {
		vi.advanceTimersByTime(ms);
		await flushEffects();
	},

	/**
	 * Run all timers and wait for effects
	 */
	async runAll() {
		await vi.runAllTimersAsync();
		await flushEffects();
	}
};

/**
 * Test helper for components with debounced operations
 */
export async function testWithDebounce(testFn: () => Promise<void>, debounceMs: number = 300) {
	const timer = timerUtils.setup();

	try {
		await testFn();
		await timer.advance(debounceMs);
	} finally {
		timer.cleanup();
	}
}
