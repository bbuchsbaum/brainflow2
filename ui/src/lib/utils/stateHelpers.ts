/**
 * Simple, pragmatic state helpers for common UI patterns
 * These helpers reduce boilerplate without adding complexity
 *
 * NOTE: These are non-reactive versions for use outside Svelte components.
 * For reactive versions, use stateHelpers.svelte.ts
 */

import { getNotificationService } from '$lib/services/NotificationService';
import type { NotificationService } from '$lib/services/NotificationService';

export type LoadingState = 'idle' | 'loading' | 'success' | 'error';

/**
 * Creates a non-reactive loading state helper
 * Use this in services, tests, or outside Svelte components
 *
 * @example
 * ```typescript
 * const volumeLoader = createLoadingState<Volume>();
 *
 * // In component
 * await volumeLoader.load(() => volumeService.load(path));
 *
 * // In template
 * {#if volumeLoader.state === 'loading'}
 *   <Spinner />
 * {:else if volumeLoader.error}
 *   <Error message={volumeLoader.error.message} />
 * {:else if volumeLoader.data}
 *   <VolumeView volume={volumeLoader.data} />
 * {/if}
 * ```
 */
export function createLoadingState<T>(initialData: T | null = null) {
	let state: LoadingState = 'idle';
	let data: T | null = initialData;
	let error: Error | null = null;
	let lastLoadTime = 0;

	return {
		// Getters
		get state() {
			return state;
		},
		get data() {
			return data;
		},
		get error() {
			return error;
		},
		get lastLoadTime() {
			return lastLoadTime;
		},

		// Computed states
		get isIdle() {
			return state === 'idle';
		},
		get isLoading() {
			return state === 'loading';
		},
		get isSuccess() {
			return state === 'success';
		},
		get isError() {
			return state === 'error';
		},
		get hasData() {
			return data !== null;
		},

		// Actions
		async load(fn: () => Promise<T>) {
			state = 'loading';
			error = null;

			try {
				const result = await fn();
				data = result;
				state = 'success';
				lastLoadTime = Date.now();
				return result;
			} catch (e) {
				error = e as Error;
				state = 'error';
				throw e;
			}
		},

		// Reset to initial state
		reset() {
			state = 'idle';
			data = initialData;
			error = null;
			lastLoadTime = 0;
		},

		// Manually set data (useful for optimistic updates)
		setData(newData: T) {
			data = newData;
			state = 'success';
			error = null;
		},

		// Manually set error
		setError(newError: Error) {
			error = newError;
			state = 'error';
		}
	};
}

/**
 * Creates a paginated loading state helper
 * Handles pagination, loading more, and refresh patterns
 */
export function createPaginatedState<T>(pageSize = 20) {
	let items: T[] = [];
	let currentPage = 0;
	let hasMore = true;
	let isLoading = false;
	let isLoadingMore = false;
	let error: Error | null = null;

	return {
		// Getters
		get items() {
			return items;
		},
		get currentPage() {
			return currentPage;
		},
		get hasMore() {
			return hasMore;
		},
		get isLoading() {
			return isLoading;
		},
		get isLoadingMore() {
			return isLoadingMore;
		},
		get error() {
			return error;
		},
		get isEmpty() {
			return items.length === 0 && !isLoading;
		},

		// Load first page
		async load(fn: (page: number, size: number) => Promise<T[]>) {
			isLoading = true;
			error = null;
			currentPage = 0;

			try {
				const result = await fn(0, pageSize);
				items = result;
				hasMore = result.length === pageSize;
				currentPage = 1;
			} catch (e) {
				error = e as Error;
				throw e;
			} finally {
				isLoading = false;
			}
		},

		// Load next page
		async loadMore(fn: (page: number, size: number) => Promise<T[]>) {
			if (!hasMore || isLoadingMore) return;

			isLoadingMore = true;

			try {
				const result = await fn(currentPage, pageSize);
				items = [...items, ...result];
				hasMore = result.length === pageSize;
				currentPage++;
			} catch (e) {
				error = e as Error;
				throw e;
			} finally {
				isLoadingMore = false;
			}
		},

		// Refresh all data
		async refresh(fn: (page: number, size: number) => Promise<T[]>) {
			await this.load(fn);
		},

		// Reset state
		reset() {
			items = [];
			currentPage = 0;
			hasMore = true;
			isLoading = false;
			isLoadingMore = false;
			error = null;
		}
	};
}

/**
 * Creates a debounced input state helper
 * Useful for search fields, real-time validation, etc.
 */
export function createDebouncedState<T>(initialValue: T, delay = 300) {
	let value = initialValue;
	let debouncedValue = initialValue;
	let isDebouncing = false;
	let timeoutId: ReturnType<typeof setTimeout> | null = null;

	// Update debounced value after delay
	function updateDebouncedValue(newValue: T) {
		isDebouncing = true;

		if (timeoutId) {
			clearTimeout(timeoutId);
		}

		timeoutId = setTimeout(() => {
			debouncedValue = newValue;
			isDebouncing = false;
			timeoutId = null;
		}, delay);
	}

	return {
		// Current value (updates immediately)
		get value() {
			return value;
		},
		set value(newValue: T) {
			value = newValue;
			updateDebouncedValue(newValue);
		},

		// Debounced value (updates after delay)
		get debouncedValue() {
			return debouncedValue;
		},
		get isDebouncing() {
			return isDebouncing;
		},

		// Force immediate update
		flush() {
			if (timeoutId) {
				clearTimeout(timeoutId);
				timeoutId = null;
			}
			debouncedValue = value;
			isDebouncing = false;
		},

		// Cancel pending update
		cancel() {
			if (timeoutId) {
				clearTimeout(timeoutId);
				timeoutId = null;
			}
			isDebouncing = false;
		},

		// Reset to initial value
		reset() {
			this.cancel();
			value = initialValue;
			debouncedValue = initialValue;
		}
	};
}

/**
 * Creates a form state helper with validation
 * Simplifies form handling with built-in validation
 */
export interface FormField<T> {
	value: T;
	error: string | null;
	touched: boolean;
	dirty: boolean;
}

export function createFormState<T extends Record<string, any>>(
	initialValues: T,
	validators?: Partial<Record<keyof T, (value: any) => string | null>>
) {
	// Create fields
	const fields = {} as Record<keyof T, FormField<T[keyof T]>>;

	for (const key in initialValues) {
		fields[key] = {
			value: initialValues[key],
			error: null,
			touched: false,
			dirty: false
		};
	}

	let isSubmitting = false;
	let submitError: Error | null = null;

	// Validate single field
	function validateField(name: keyof T) {
		const validator = validators?.[name];
		if (!validator) return true;

		const error = validator(fields[name].value);
		fields[name].error = error;
		return !error;
	}

	// Validate all fields
	function validateAll() {
		let isValid = true;
		for (const key in fields) {
			if (!validateField(key)) {
				isValid = false;
			}
		}
		return isValid;
	}

	return {
		// Field access
		fields,

		// Form state
		get isSubmitting() {
			return isSubmitting;
		},
		get submitError() {
			return submitError;
		},
		get isDirty() {
			return Object.values(fields).some((f) => f.dirty);
		},
		get isValid() {
			return Object.values(fields).every((f) => !f.error);
		},
		get values() {
			const values = {} as T;
			for (const key in fields) {
				values[key] = fields[key].value;
			}
			return values;
		},

		// Field operations
		setFieldValue(name: keyof T, value: T[keyof T]) {
			fields[name].value = value;
			fields[name].dirty = true;
			validateField(name);
		},

		setFieldError(name: keyof T, error: string | null) {
			fields[name].error = error;
		},

		setFieldTouched(name: keyof T, touched = true) {
			fields[name].touched = touched;
			if (touched) {
				validateField(name);
			}
		},

		// Form operations
		async submit(fn: (values: T) => Promise<void>) {
			// Mark all fields as touched
			for (const key in fields) {
				fields[key].touched = true;
			}

			// Validate all fields
			if (!validateAll()) {
				return;
			}

			isSubmitting = true;
			submitError = null;

			try {
				await fn(this.values);
			} catch (e) {
				submitError = e as Error;
				throw e;
			} finally {
				isSubmitting = false;
			}
		},

		reset() {
			for (const key in fields) {
				fields[key] = {
					value: initialValues[key],
					error: null,
					touched: false,
					dirty: false
				};
			}
			isSubmitting = false;
			submitError = null;
		}
	};
}

/**
 * Creates a simple toggle state with optional persistence
 */
export function createToggleState(initialValue = false, persistKey?: string) {
	// Load from localStorage if persist key provided
	const stored = persistKey ? localStorage.getItem(persistKey) : null;
	let value = stored !== null ? stored === 'true' : initialValue;

	// Persist changes
	function persist(newValue: boolean) {
		if (persistKey) {
			localStorage.setItem(persistKey, String(newValue));
		}
	}

	return {
		get value() {
			return value;
		},
		set value(newValue: boolean) {
			value = newValue;
			persist(newValue);
		},

		toggle() {
			this.value = !this.value;
		},

		setTrue() {
			this.value = true;
		},

		setFalse() {
			this.value = false;
		}
	};
}

/**
 * Creates a state helper for managing selections
 * Supports single and multi-select patterns
 */
export function createSelectionState<T>(idGetter: (item: T) => string, multiSelect = false) {
	let selectedIds = new Set<string>();
	let lastSelectedId: string | null = null;

	return {
		get selectedIds() {
			return selectedIds;
		},
		get selectedCount() {
			return selectedIds.size;
		},
		get hasSelection() {
			return selectedIds.size > 0;
		},
		get isSingleSelection() {
			return selectedIds.size === 1;
		},
		get isMultiSelection() {
			return selectedIds.size > 1;
		},

		isSelected(item: T) {
			return selectedIds.has(idGetter(item));
		},

		select(item: T, isShiftKey = false, isCtrlKey = false) {
			const id = idGetter(item);

			if (!multiSelect) {
				// Single select mode
				selectedIds = new Set([id]);
				lastSelectedId = id;
				return;
			}

			// Multi-select mode
			if (isCtrlKey) {
				// Toggle selection
				if (selectedIds.has(id)) {
					selectedIds.delete(id);
					selectedIds = new Set(selectedIds);
				} else {
					selectedIds.add(id);
					selectedIds = new Set(selectedIds);
				}
			} else if (isShiftKey && lastSelectedId) {
				// Range select (would need item order info for full implementation)
				selectedIds.add(id);
				selectedIds = new Set(selectedIds);
			} else {
				// Replace selection
				selectedIds = new Set([id]);
			}

			lastSelectedId = id;
		},

		selectAll(items: T[]) {
			selectedIds = new Set(items.map(idGetter));
		},

		deselect(item: T) {
			const id = idGetter(item);
			selectedIds.delete(id);
			selectedIds = new Set(selectedIds);
		},

		deselectAll() {
			selectedIds = new Set();
			lastSelectedId = null;
		},

		toggleSelection(item: T) {
			const id = idGetter(item);
			if (selectedIds.has(id)) {
				this.deselect(item);
			} else {
				this.select(item);
			}
		}
	};
}

/**
 * Creates a state helper for managing async operations with automatic retry
 * Includes exponential backoff and max retry limits
 */
export function createRetryableState<T>(
	maxRetries = 3,
	baseDelay = 1000,
	notificationService?: NotificationService
) {
	const loadingState = createLoadingState<T>();
	let retryCount = 0;
	let nextRetryTime: number | null = null;
	let retryTimeoutId: ReturnType<typeof setTimeout> | null = null;
	let isInRetryLoop = false;

	async function executeWithRetry(
		fn: () => Promise<T>,
		onError?: (error: Error, attempt: number) => void
	): Promise<T> {
		retryCount = 0;
		isInRetryLoop = true;

		while (retryCount <= maxRetries) {
			try {
				const result = await loadingState.load(fn);
				retryCount = 0;
				nextRetryTime = null;
				isInRetryLoop = false;
				return result;
			} catch (error) {
				retryCount++;

				if (retryCount > maxRetries) {
					// Max retries exceeded
					isInRetryLoop = false;
					if (notificationService) {
						notificationService.error(`Operation failed after ${maxRetries} attempts`, {
							error: error as Error
						});
					}
					throw error;
				}

				// Calculate next retry delay (exponential backoff)
				const delay = baseDelay * Math.pow(2, retryCount - 1);
				nextRetryTime = Date.now() + delay;

				// Call error handler if provided
				onError?.(error as Error, retryCount);

				// Show retry notification
				if (notificationService) {
					notificationService.info(
						`Retrying in ${delay / 1000}s (attempt ${retryCount}/${maxRetries})...`
					);
				}

				// Wait before retry
				await new Promise((resolve) => {
					retryTimeoutId = setTimeout(resolve, delay);
				});
			}
		}

		throw new Error('Retry logic error');
	}

	return {
		// Inherit loading state properties
		...loadingState,

		// Retry-specific properties
		get retryCount() {
			return retryCount;
		},
		get nextRetryTime() {
			return nextRetryTime;
		},
		get isRetrying() {
			return isInRetryLoop && retryCount > 0;
		},

		// Execute with retry
		loadWithRetry: executeWithRetry,

		// Cancel ongoing retry
		cancelRetry() {
			if (retryTimeoutId) {
				clearTimeout(retryTimeoutId);
				retryTimeoutId = null;
			}
			retryCount = 0;
			nextRetryTime = null;
			isInRetryLoop = false;
			loadingState.reset();
		}
	};
}
