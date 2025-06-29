# BrainFlow UI Testing Guide

This guide covers testing patterns and best practices for the BrainFlow UI, built with Svelte 5, SvelteKit, and Vitest.

## Table of Contents
- [Setup](#setup)
- [Testing Utilities](#testing-utilities)
- [Component Testing](#component-testing)
- [Store Testing](#store-testing)
- [Mocking Strategies](#mocking-strategies)
- [Best Practices](#best-practices)

## Setup

Tests are configured in `vitest.config.ts` with the following key settings:
- **Environment**: `jsdom` for DOM simulation
- **Setup File**: `vitest-setup-client.ts` for global test configuration
- **Test Pattern**: `src/**/*.{test,spec}.{js,ts}`

### Running Tests

```bash
# Run all tests
pnpm test

# Run tests in watch mode
pnpm test:unit

# Run with coverage
pnpm test -- --coverage
```

## Testing Utilities

We provide custom utilities in `src/test/utils.ts` to simplify testing:

### `renderComponent`
Enhanced render function for Svelte 5 components with better type safety:

```typescript
import { renderComponent } from '$test/utils';
import MyComponent from './MyComponent.svelte';

const { container, component } = renderComponent(MyComponent, {
  propName: 'value'
});
```

### `waitForUpdates`
Ensures all Svelte reactive updates are completed:

```typescript
import { waitForUpdates } from '$test/utils';

await fireEvent.click(button);
await waitForUpdates(); // Wait for reactive changes
expect(screen.getByText('Updated')).toBeInTheDocument();
```

### `mockTauriAPI`
Mocks the Tauri API for testing components that interact with the backend:

```typescript
const { mockInvoke } = mockTauriAPI();
mockInvoke.mockResolvedValue({ data: 'test' });

// Your component can now call invoke() without errors
```

### `createMockStore`
Creates a mock Svelte store for testing:

```typescript
const mockStore = createMockStore({ count: 0 });
// Use in component props or context
```

## Component Testing

### Basic Component Test

```typescript
import { describe, it, expect } from 'vitest';
import { screen } from '@testing-library/svelte';
import { renderComponent } from '$test/utils';
import MyComponent from './MyComponent.svelte';

describe('MyComponent', () => {
  it('renders with props', () => {
    renderComponent(MyComponent, {
      title: 'Test Title'
    });
    
    expect(screen.getByText('Test Title')).toBeInTheDocument();
  });
});
```

### Testing Interactive Components

```typescript
import { fireEvent } from '@testing-library/svelte';
import { waitForUpdates } from '$test/utils';

it('handles user interaction', async () => {
  renderComponent(Counter);
  
  const button = screen.getByRole('button');
  await fireEvent.click(button);
  await waitForUpdates();
  
  expect(screen.getByText('Count: 1')).toBeInTheDocument();
});
```

### Testing Components with Stores

```typescript
import { useLayerStore } from '$lib/stores/layerStore';

// Mock the store module
vi.mock('$lib/stores/layerStore', () => ({
  useLayerStore: vi.fn(() => ({
    subscribe: vi.fn(),
    addLayer: vi.fn(),
  }))
}));

it('interacts with store', () => {
  const mockAddLayer = vi.fn();
  vi.mocked(useLayerStore).mockReturnValue({
    subscribe: vi.fn(),
    addLayer: mockAddLayer,
  });
  
  renderComponent(LayerManager);
  // Test store interaction
});
```

## Store Testing

### Zustand Store Testing

```typescript
import { useLayerStore } from './layerStore';

describe('layerStore', () => {
  beforeEach(() => {
    // Reset store to initial state
    useLayerStore.setState({ layers: [] });
  });
  
  it('adds a layer', () => {
    const layer = { id: 'test', spec: {...} };
    useLayerStore.getState().addLayer(layer);
    
    expect(useLayerStore.getState().layers).toHaveLength(1);
  });
});
```

### Testing Async Store Actions

```typescript
it('handles async operations', async () => {
  const mockApi = vi.fn().mockResolvedValue({ data: 'test' });
  vi.mocked(coreApi.loadData).mockImplementation(mockApi);
  
  await useStore.getState().loadData();
  
  expect(mockApi).toHaveBeenCalled();
  expect(useStore.getState().data).toEqual({ data: 'test' });
});
```

## Mocking Strategies

### Mocking Tauri Commands

```typescript
beforeEach(() => {
  const { mockInvoke } = mockTauriAPI();
  
  // Mock specific commands
  mockInvoke.mockImplementation((cmd, args) => {
    switch (cmd) {
      case 'load_file':
        return Promise.resolve({ volume_id: 'test-123' });
      case 'list_volumes':
        return Promise.resolve([]);
      default:
        return Promise.reject(new Error(`Unknown command: ${cmd}`));
    }
  });
});
```

### Mocking Golden Layout

```typescript
vi.mock('$lib/layout/glUtils', () => ({
  getGlContainer: vi.fn(() => ({
    setTitle: vi.fn(),
    on: vi.fn(),
    width: 800,
    height: 600,
  }))
}));
```

### Mocking WebGPU

```typescript
// In vitest-setup-client.ts
globalThis.GPU = {
  requestAdapter: vi.fn(),
};

globalThis.GPUAdapter = {
  requestDevice: vi.fn(),
};
```

## Best Practices

### 1. **Isolate Tests**
Always reset stores and clear mocks between tests:

```typescript
beforeEach(() => {
  vi.clearAllMocks();
  useStore.setState(initialState);
});
```

### 2. **Test User Behavior**
Focus on testing what users see and do:

```typescript
// ❌ Bad: Testing implementation details
expect(component.internalState).toBe(true);

// ✅ Good: Testing user-visible behavior
expect(screen.getByText('Success')).toBeInTheDocument();
```

### 3. **Use Data-Testid Sparingly**
Prefer accessible queries:

```typescript
// ❌ Avoid when possible
screen.getByTestId('submit-button');

// ✅ Better
screen.getByRole('button', { name: 'Submit' });
```

### 4. **Mock at the Right Level**
Mock external dependencies, not internal modules:

```typescript
// ✅ Mock external API
vi.mock('@tauri-apps/api/core');

// ❌ Avoid mocking internal utilities
vi.mock('$lib/utils/helpers');
```

### 5. **Test Error States**
Always test error handling:

```typescript
it('handles API errors gracefully', async () => {
  mockInvoke.mockRejectedValue(new Error('Network error'));
  
  renderComponent(DataLoader);
  await waitForUpdates();
  
  expect(screen.getByText(/error/i)).toBeInTheDocument();
});
```

### 6. **Use Descriptive Test Names**
Write tests that document behavior:

```typescript
describe('VolumeView', () => {
  it('displays loading state while fetching volume data', ...);
  it('renders three orthogonal views when data is loaded', ...);
  it('synchronizes crosshair position across all views', ...);
});
```

### 7. **Avoid Testing Framework Code**
Don't test Svelte or SvelteKit internals:

```typescript
// ❌ Don't test that Svelte reactivity works
$: doubled = count * 2;

// ✅ Test your business logic
it('calculates threshold correctly', () => {
  const result = calculateThreshold(inputData);
  expect(result).toBe(expectedValue);
});
```

## Common Patterns

### Testing Loading States

```typescript
it('shows loading indicator during data fetch', async () => {
  // Mock a slow API call
  mockInvoke.mockImplementation(() => 
    new Promise(resolve => setTimeout(resolve, 100))
  );
  
  renderComponent(DataView);
  expect(screen.getByText('Loading...')).toBeInTheDocument();
  
  await waitForUpdates();
  expect(screen.queryByText('Loading...')).not.toBeInTheDocument();
});
```

### Testing Component Lifecycle

```typescript
it('cleans up resources on unmount', () => {
  const cleanup = vi.fn();
  const { unmount } = renderComponent(ResourceComponent, { cleanup });
  
  unmount();
  expect(cleanup).toHaveBeenCalled();
});
```

### Testing Context Providers

```typescript
import { setContext } from 'svelte';

function renderWithContext(component, props, contextValue) {
  return renderComponent({
    render: () => {
      setContext('myContext', contextValue);
      return component;
    }
  }, props);
}
```

## Debugging Tests

### Visual Debugging

```typescript
import { screen, debug } from '@testing-library/svelte';

// Print the entire DOM
debug();

// Print a specific element
debug(screen.getByRole('button'));
```

### Async Debugging

```typescript
// Add longer timeouts for debugging
it('complex async test', async () => {
  // Your test
}, { timeout: 10000 });
```

## Resources

- [Vitest Documentation](https://vitest.dev/)
- [Testing Library Documentation](https://testing-library.com/docs/svelte-testing-library/intro/)
- [Svelte 5 Testing Guide](https://svelte.dev/docs/svelte/testing)
- [BrainFlow Test Examples](./examples/)