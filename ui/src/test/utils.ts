import { render, type RenderResult } from '@testing-library/svelte';
import { tick } from 'svelte';
import type { ComponentProps, Component } from 'svelte';
import { vi } from 'vitest';

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
    ...options,
  });
}

/**
 * Wait for all Svelte updates to complete
 * Useful for testing reactive changes
 */
export async function waitForUpdates(): Promise<void> {
  await tick();
  // Additional microtask to ensure all updates are processed
  await new Promise(resolve => setTimeout(resolve, 0));
}

/**
 * Create a mock store for testing
 * Provides subscribe/set/update methods compatible with Svelte stores
 */
export function createMockStore<T>(initialValue: T) {
  let value = initialValue;
  const subscribers = new Set<(value: T) => void>();

  return {
    subscribe(fn: (value: T) => void) {
      fn(value);
      subscribers.add(fn);
      return () => subscribers.delete(fn);
    },
    set(newValue: T) {
      value = newValue;
      subscribers.forEach(fn => fn(value));
    },
    update(fn: (value: T) => T) {
      value = fn(value);
      subscribers.forEach(subscriber => subscriber(value));
    },
    // Expose current value for testing
    get() {
      return value;
    },
  };
}

/**
 * Mock Tauri API for testing
 */
export function mockTauriAPI() {
  const mockInvoke = vi.fn();
  
  // Mock the Tauri window object
  (globalThis as any).__TAURI__ = {
    core: {
      invoke: mockInvoke,
    },
    event: {
      emit: vi.fn(),
      listen: vi.fn(),
      once: vi.fn(),
      unlisten: vi.fn(),
    },
  };

  return {
    mockInvoke,
    resetMocks: () => {
      mockInvoke.mockReset();
    },
  };
}

/**
 * Create a test harness for components that use stores
 */
export function createStoreTestHarness() {
  const stores = new Map<string, any>();

  return {
    addStore(name: string, store: any) {
      stores.set(name, store);
    },
    getStore(name: string) {
      return stores.get(name);
    },
    clearStores() {
      stores.clear();
    },
  };
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