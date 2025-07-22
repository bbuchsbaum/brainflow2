/**
 * Component Mounting Helper
 * Provides lightweight component mounting for tests
 */
import { render, type RenderResult } from '@testing-library/svelte';
import type { Component } from 'svelte';
import { createTestEnvironment, type TestEnvironment } from '../factories/testServices';
import { getContext, setContext } from 'svelte';

export interface MountOptions {
	props?: Record<string, any>;
	context?: Map<string, any>;
	testEnvironment?: TestEnvironment;
}

export interface MountResult extends RenderResult {
	testEnvironment: TestEnvironment;
}

/**
 * Mounts a Svelte component with test services and environment
 */
export function mountTestComponent(Component: any, options: MountOptions = {}): MountResult {
	const { props = {}, context = new Map(), testEnvironment } = options;

	// Create test environment if not provided
	const env = testEnvironment || createTestEnvironment();

	// Add test services to context
	context.set('container', env.container);
	context.set('eventBus', env.eventBus);

	// Render component with context
	const result = render(Component, {
		props,
		context
	});

	// Return result with test environment
	return {
		...result,
		testEnvironment: env
	};
}

/**
 * Creates a test wrapper component
 */
export function createTestWrapper(testEnvironment?: TestEnvironment) {
	return function TestWrapper(Component: any) {
		const env = testEnvironment || createTestEnvironment();

		// Set context for child components
		setContext('container', env.container);
		setContext('eventBus', env.eventBus);

		return Component;
	};
}

/**
 * Helper to wait for component updates
 */
export async function waitForComponentUpdate(ms: number = 0): Promise<void> {
	return new Promise((resolve) => {
		setTimeout(resolve, ms);
	});
}

/**
 * Helper to trigger and wait for GPU render
 */
export async function waitForGpuRender(): Promise<void> {
	// Wait for requestAnimationFrame
	await new Promise((resolve) => requestAnimationFrame(resolve));
	// Wait for any async GPU operations
	await waitForComponentUpdate(10);
}
