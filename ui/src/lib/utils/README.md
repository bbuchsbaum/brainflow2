# State Helpers

Simple, pragmatic state helpers for common UI patterns in Brainflow. These helpers reduce boilerplate without adding unnecessary complexity.

## Why State Helpers?

Instead of heavyweight patterns like CQRS or XState, we provide lightweight helpers that solve real problems:

- Less boilerplate for common patterns
- Easy to understand and use
- No complex abstractions
- Minimal performance overhead

## Available Helpers

### Loading State (`createLoadingState`)

Simplifies async operations with built-in state management.

```typescript
// Non-reactive (for services/tests)
import { createLoadingState } from '$lib/utils/stateHelpers';

// Reactive (for Svelte components)
import { createLoadingState } from '$lib/utils/stateHelpers.svelte';

const volumeLoader = createLoadingState<Volume>();

await volumeLoader.load(() => volumeService.load(path));

// In template
{#if volumeLoader.isLoading}
  <Spinner />
{:else if volumeLoader.error}
  <Error message={volumeLoader.error.message} />
{:else if volumeLoader.data}
  <VolumeView volume={volumeLoader.data} />
{/if}
```

### Paginated State (`createPaginatedState`)

Handles pagination, loading more, and refresh patterns.

```typescript
const fileList = createPaginatedState<File>(20);

await fileList.load((page, size) => api.getFiles(page, size));
await fileList.loadMore((page, size) => api.getFiles(page, size));
```

### Debounced State (`createDebouncedState`)

Perfect for search inputs and real-time validation.

```typescript
const searchInput = createDebouncedState('', 500);

// Value updates immediately
searchInput.value = 'search term';

// Debounced value updates after delay
$effect(() => {
	if (searchInput.debouncedValue) {
		performSearch(searchInput.debouncedValue);
	}
});
```

### Form State (`createFormState`)

Simplifies form handling with built-in validation.

```typescript
const form = createFormState(
	{ email: '', password: '' },
	{
		email: (value) => (!value.includes('@') ? 'Invalid email' : null),
		password: (value) => (value.length < 8 ? 'Too short' : null)
	}
);

form.setFieldValue('email', 'user@example.com');
await form.submit(async (values) => {
	await api.login(values);
});
```

### Toggle State (`createToggleState`)

Simple toggle with optional localStorage persistence.

```typescript
const darkMode = createToggleState(false, 'dark-mode-preference');

darkMode.toggle();
// Automatically persisted to localStorage
```

### Selection State (`createSelectionState`)

Manages single and multi-selection patterns.

```typescript
const selection = createSelectionState<Item>(
	(item) => item.id,
	true // multi-select
);

selection.select(item, false, true); // with Ctrl key
selection.toggleSelection(item);
selection.selectAll(items);
```

### Retryable State (`createRetryableState`)

Automatic retry with exponential backoff.

```typescript
const apiCall = createRetryableState<Data>(3, 1000);

try {
	const data = await apiCall.loadWithRetry(() => fetch('/api/data'));
} catch (error) {
	// Failed after 3 retries
}
```

## Usage Guidelines

### In Svelte Components

Use the reactive versions from `stateHelpers.svelte.ts`:

```typescript
<script lang="ts">
  import { createLoadingState } from '$lib/utils/stateHelpers.svelte';

  const loader = createLoadingState<Data>();

  // All properties are reactive
  $inspect(loader.state); // Will log on every state change
</script>
```

### In Services/Tests

Use the non-reactive versions from `stateHelpers.ts`:

```typescript
import { createLoadingState } from '$lib/utils/stateHelpers';

export class DataService {
	private loader = createLoadingState<Data>();

	async loadData() {
		return this.loader.load(() => this.api.getData());
	}
}
```

## Benefits Over Complex Patterns

### vs CQRS

- **CQRS**: `commandBus.execute(new UpdateCommand(data))`
- **State Helper**: `await service.update(data)`
- **Benefit**: Less ceremony, easier to understand

### vs XState

- **XState**: Complex state machine configuration
- **State Helper**: Simple loading states with helper methods
- **Benefit**: Lightweight, no learning curve

## Best Practices

1. **Use reactive versions in components** - Better performance with Svelte's reactivity
2. **Use non-reactive in services** - Avoid runtime errors outside components
3. **Compose helpers** - Combine multiple helpers for complex scenarios
4. **Keep it simple** - Don't over-engineer, these are meant to be pragmatic

## Examples

See `/src/lib/examples/StateHelpersExample.svelte` for comprehensive usage examples.
