/**
 * Mock EventBus for Testing
 * Provides a test-friendly event bus with inspection capabilities
 */
import { vi } from 'vitest';
import type { Mock } from 'vitest';
import type { EventBus, EventHandler, EventUnsubscribe } from '$lib/events/EventBus';

export interface MockEventBus extends EventBus {
	// Test helpers
	getEmittedEvents(): Array<{ event: string; data: any }>;
	getListenerCount(event: string): number;
	clearEmittedEvents(): void;
	simulateEvent(event: string, data: any): void;
}

/**
 * Creates a mock EventBus for testing
 */
export function createMockEventBus(): MockEventBus {
	const listeners = new Map<string, Set<EventHandler<any>>>();
	const emittedEvents: Array<{ event: string; data: any }> = [];

	const emit: Mock = vi.fn((event: string, data?: any) => {
		emittedEvents.push({ event, data });

		// Trigger actual listeners if they exist
		const eventListeners = listeners.get(event);
		if (eventListeners) {
			eventListeners.forEach((handler) => {
				try {
					handler(data);
				} catch (error) {
					console.error(`Error in event handler for ${event}:`, error);
				}
			});
		}

		// Also trigger wildcard listeners
		const wildcardListeners = listeners.get('*');
		if (wildcardListeners) {
			wildcardListeners.forEach((handler) => {
				try {
					handler({ event, data });
				} catch (error) {
					console.error(`Error in wildcard handler:`, error);
				}
			});
		}
	});

	const on: Mock = vi.fn((event: string, handler: EventHandler<any>): EventUnsubscribe => {
		if (!listeners.has(event)) {
			listeners.set(event, new Set());
		}
		listeners.get(event)!.add(handler);

		return () => {
			const eventListeners = listeners.get(event);
			if (eventListeners) {
				eventListeners.delete(handler);
				if (eventListeners.size === 0) {
					listeners.delete(event);
				}
			}
		};
	});

	const once: Mock = vi.fn((event: string, handler: EventHandler<any>): EventUnsubscribe => {
		const wrappedHandler = (data: any) => {
			unsubscribe();
			handler(data);
		};
		const unsubscribe = on(event, wrappedHandler);
		return unsubscribe;
	});

	const off: Mock = vi.fn((event: string, handler: EventHandler<any>) => {
		const eventListeners = listeners.get(event);
		if (eventListeners) {
			eventListeners.delete(handler);
			if (eventListeners.size === 0) {
				listeners.delete(event);
			}
		}
	});

	const clear: Mock = vi.fn(() => {
		listeners.clear();
		emittedEvents.length = 0;
	});

	// Test helpers
	const getEmittedEvents = () => [...emittedEvents];

	const getListenerCount = (event: string) => {
		const eventListeners = listeners.get(event);
		return eventListeners ? eventListeners.size : 0;
	};

	const clearEmittedEvents = () => {
		emittedEvents.length = 0;
		emit.mockClear();
	};

	const simulateEvent = (event: string, data: any) => {
		emit(event, data);
	};

	return {
		emit,
		on,
		once,
		off,
		clear,
		getEmittedEvents,
		getListenerCount,
		clearEmittedEvents,
		simulateEvent
	};
}

/**
 * Helper to wait for an event to be emitted
 */
export function waitForEvent(
	eventBus: MockEventBus,
	eventName: string,
	timeout = 1000
): Promise<any> {
	return new Promise((resolve, reject) => {
		const timer = setTimeout(() => {
			unsubscribe();
			reject(new Error(`Timeout waiting for event: ${eventName}`));
		}, timeout);

		const unsubscribe = eventBus.once(eventName, (data) => {
			clearTimeout(timer);
			resolve(data);
		});
	});
}

/**
 * Helper to assert events were emitted in order
 */
export function assertEventSequence(eventBus: MockEventBus, expectedEvents: string[]): void {
	const emittedEvents = eventBus.getEmittedEvents();
	const emittedEventNames = emittedEvents.map((e) => e.event);

	expectedEvents.forEach((expectedEvent, index) => {
		if (index >= emittedEventNames.length) {
			throw new Error(
				`Expected event "${expectedEvent}" at position ${index} but only ${emittedEventNames.length} events were emitted`
			);
		}

		if (emittedEventNames[index] !== expectedEvent) {
			throw new Error(
				`Expected event "${expectedEvent}" at position ${index} but got "${emittedEventNames[index]}"`
			);
		}
	});
}

/**
 * Helper to assert an event was emitted with specific data
 */
export function assertEventEmitted(
	eventBus: MockEventBus,
	eventName: string,
	expectedData?: any
): void {
	const emittedEvents = eventBus.getEmittedEvents();
	const matchingEvent = emittedEvents.find((e) => e.event === eventName);

	if (!matchingEvent) {
		const emittedNames = emittedEvents.map((e) => e.event).join(', ');
		throw new Error(
			`Expected event "${eventName}" to be emitted. Emitted events: [${emittedNames}]`
		);
	}

	if (expectedData !== undefined) {
		expect(matchingEvent.data).toEqual(expectedData);
	}
}
