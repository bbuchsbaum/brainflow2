import { render, type RenderResult } from '@testing-library/svelte';
import { tick } from 'svelte';
import type { ComponentProps, Component } from 'svelte';

/**
 * Custom render function for Svelte 5 components
 * Handles the new component API and provides better type safety
 */
export function renderComponent<T extends Component<any>>(
	component: T,
	props?: ComponentProps<T>,
	options?: {
		target?: HTMLElement;
		intro?: boolean;
	}
): RenderResult {
	return render(component, {
		props: props || {},
		...options
	});
}

/**
 * Wait for all Svelte updates to complete
 * Useful for testing reactive changes
 */
export async function waitForUpdates(): Promise<void> {
	await tick();
	// Additional microtask to ensure all updates are processed
	await new Promise((resolve) => setTimeout(resolve, 0));
}

/**
 * Helper to test async component lifecycle
 */
export async function renderAndWait<T extends Component<any>>(
	component: T,
	props?: ComponentProps<T>
): Promise<RenderResult> {
	const result = renderComponent(component, props);
	await waitForUpdates();
	return result;
}

/**
 * Helper to wait for a condition to be true
 */
export async function waitFor(
	condition: () => boolean,
	timeout = 1000,
	interval = 10
): Promise<void> {
	const start = Date.now();

	while (!condition()) {
		if (Date.now() - start > timeout) {
			throw new Error('Timeout waiting for condition');
		}
		await new Promise((resolve) => setTimeout(resolve, interval));
	}
}

/**
 * Flush all pending promises
 */
export async function flushPromises(): Promise<void> {
	await new Promise((resolve) => setTimeout(resolve, 0));
	await tick();
}
