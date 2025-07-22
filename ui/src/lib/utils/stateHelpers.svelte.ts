/**
 * Reactive state helpers for Svelte components
 * These use Svelte 5 runes for reactivity
 */

import { getNotificationService } from '$lib/services/NotificationService';
import type { NotificationService } from '$lib/services/NotificationService';

export type LoadingState = 'idle' | 'loading' | 'success' | 'error';

/**
 * Creates a reactive loading state helper using Svelte 5 runes
 * Use this inside Svelte components for reactive state
 *
 * @example
 * ```typescript
 * // In <script> tag of Svelte component
 * import { createLoadingState } from '$lib/utils/stateHelpers.svelte';
 *
 * const volumeLoader = createLoadingState<Volume>();
 *
 * // In component
 * await volumeLoader.load(() => volumeService.load(path));
 *
 * // In template - all properties are reactive
 * {#if volumeLoader.isLoading}
 *   <Spinner />
 * {:else if volumeLoader.error}
 *   <Error message={volumeLoader.error.message} />
 * {:else if volumeLoader.data}
 *   <VolumeView volume={volumeLoader.data} />
 * {/if}
 * ```
 */
export function createLoadingState<T>(initialData: T | null = null) {
	let state = $state<LoadingState>('idle');
	let data = $state<T | null>(initialData);
	let error = $state<Error | null>(null);
	let lastLoadTime = $state<number>(0);

	return {
		// Reactive getters
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

		reset() {
			state = 'idle';
			data = initialData;
			error = null;
			lastLoadTime = 0;
		},

		setData(newData: T) {
			data = newData;
			state = 'success';
			error = null;
		},

		setError(newError: Error) {
			error = newError;
			state = 'error';
		}
	};
}

/**
 * Creates a reactive debounced state helper
 * All values are reactive and will trigger component updates
 */
export function createDebouncedState<T>(initialValue: T, delay = 300) {
	let value = $state(initialValue);
	let debouncedValue = $state(initialValue);
	let isDebouncing = $state(false);
	let timeoutId: ReturnType<typeof setTimeout> | null = null;

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
		get value() {
			return value;
		},
		set value(newValue: T) {
			value = newValue;
			updateDebouncedValue(newValue);
		},

		get debouncedValue() {
			return debouncedValue;
		},
		get isDebouncing() {
			return isDebouncing;
		},

		flush() {
			if (timeoutId) {
				clearTimeout(timeoutId);
				timeoutId = null;
			}
			debouncedValue = value;
			isDebouncing = false;
		},

		cancel() {
			if (timeoutId) {
				clearTimeout(timeoutId);
				timeoutId = null;
			}
			isDebouncing = false;
		},

		reset() {
			this.cancel();
			value = initialValue;
			debouncedValue = initialValue;
		}
	};
}

/**
 * Creates a reactive toggle state with optional persistence
 */
export function createToggleState(initialValue = false, persistKey?: string) {
	const stored = persistKey ? localStorage.getItem(persistKey) : null;
	let value = $state(stored !== null ? stored === 'true' : initialValue);

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
 * Creates a reactive selection state helper
 */
export function createSelectionState<T>(idGetter: (item: T) => string, multiSelect = false) {
	let selectedIds = $state(new Set<string>());
	let lastSelectedId = $state<string | null>(null);

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
				selectedIds = new Set([id]);
				lastSelectedId = id;
				return;
			}

			if (isCtrlKey) {
				if (selectedIds.has(id)) {
					selectedIds.delete(id);
					selectedIds = new Set(selectedIds);
				} else {
					selectedIds.add(id);
					selectedIds = new Set(selectedIds);
				}
			} else if (isShiftKey && lastSelectedId) {
				selectedIds.add(id);
				selectedIds = new Set(selectedIds);
			} else {
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
