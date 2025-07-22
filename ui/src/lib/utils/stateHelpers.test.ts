/**
 * Tests for state helpers
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
	createLoadingState,
	createPaginatedState,
	createDebouncedState,
	createFormState,
	createToggleState,
	createSelectionState,
	createRetryableState
} from './stateHelpers';

describe('createLoadingState', () => {
	it('should initialize with idle state', () => {
		const state = createLoadingState<string>();

		expect(state.state).toBe('idle');
		expect(state.data).toBe(null);
		expect(state.error).toBe(null);
		expect(state.isIdle).toBe(true);
		expect(state.isLoading).toBe(false);
	});

	it('should handle successful load', async () => {
		const state = createLoadingState<string>();
		const mockFn = vi.fn().mockResolvedValue('test data');

		const result = await state.load(mockFn);

		expect(result).toBe('test data');
		expect(state.state).toBe('success');
		expect(state.data).toBe('test data');
		expect(state.error).toBe(null);
		expect(state.isSuccess).toBe(true);
		expect(state.lastLoadTime).toBeGreaterThan(0);
	});

	it('should handle failed load', async () => {
		const state = createLoadingState<string>();
		const error = new Error('Load failed');
		const mockFn = vi.fn().mockRejectedValue(error);

		await expect(state.load(mockFn)).rejects.toThrow('Load failed');

		expect(state.state).toBe('error');
		expect(state.data).toBe(null);
		expect(state.error).toBe(error);
		expect(state.isError).toBe(true);
	});

	it('should reset state', async () => {
		const state = createLoadingState<string>('initial');
		await state.load(() => Promise.resolve('loaded'));

		state.reset();

		expect(state.state).toBe('idle');
		expect(state.data).toBe('initial');
		expect(state.error).toBe(null);
		expect(state.lastLoadTime).toBe(0);
	});

	it('should set data manually', () => {
		const state = createLoadingState<string>();

		state.setData('manual data');

		expect(state.state).toBe('success');
		expect(state.data).toBe('manual data');
		expect(state.error).toBe(null);
	});
});

describe('createPaginatedState', () => {
	const mockItems = (page: number, size: number) => {
		const items = [];
		for (let i = 0; i < size; i++) {
			items.push(`item-${page * size + i}`);
		}
		return items;
	};

	it('should load first page', async () => {
		const state = createPaginatedState<string>(3);
		const mockFn = vi.fn().mockImplementation(mockItems);

		await state.load(mockFn);

		expect(mockFn).toHaveBeenCalledWith(0, 3);
		expect(state.items).toEqual(['item-0', 'item-1', 'item-2']);
		expect(state.currentPage).toBe(1);
		expect(state.hasMore).toBe(true);
	});

	it('should load more items', async () => {
		const state = createPaginatedState<string>(2);
		const mockFn = vi.fn().mockImplementation(mockItems);

		await state.load(mockFn);
		await state.loadMore(mockFn);

		expect(state.items).toEqual(['item-0', 'item-1', 'item-2', 'item-3']);
		expect(state.currentPage).toBe(2);
	});

	it('should detect when no more items', async () => {
		const state = createPaginatedState<string>(3);
		const mockFn = vi
			.fn()
			.mockResolvedValueOnce(['item-0', 'item-1', 'item-2'])
			.mockResolvedValueOnce(['item-3', 'item-4']); // Less than page size

		await state.load(mockFn);
		await state.loadMore(mockFn);

		expect(state.hasMore).toBe(false);
	});

	it('should handle empty results', async () => {
		const state = createPaginatedState<string>();
		const mockFn = vi.fn().mockResolvedValue([]);

		await state.load(mockFn);

		expect(state.isEmpty).toBe(true);
		expect(state.hasMore).toBe(false);
	});
});

describe('createDebouncedState', () => {
	beforeEach(() => {
		vi.useFakeTimers();
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it('should debounce value updates', () => {
		const state = createDebouncedState('initial', 100);

		state.value = 'updated';

		expect(state.value).toBe('updated');
		expect(state.debouncedValue).toBe('initial');
		expect(state.isDebouncing).toBe(true);

		vi.advanceTimersByTime(100);

		expect(state.debouncedValue).toBe('updated');
		expect(state.isDebouncing).toBe(false);
	});

	it('should cancel previous debounce on new update', () => {
		const state = createDebouncedState('initial', 100);

		state.value = 'first';
		vi.advanceTimersByTime(50);
		state.value = 'second';
		vi.advanceTimersByTime(100);

		expect(state.debouncedValue).toBe('second');
	});

	it('should flush immediately', () => {
		const state = createDebouncedState('initial', 100);

		state.value = 'updated';
		state.flush();

		expect(state.debouncedValue).toBe('updated');
		expect(state.isDebouncing).toBe(false);
	});

	it('should cancel pending update', () => {
		const state = createDebouncedState('initial', 100);

		state.value = 'updated';
		state.cancel();

		vi.advanceTimersByTime(100);

		expect(state.debouncedValue).toBe('initial');
		expect(state.isDebouncing).toBe(false);
	});
});

describe('createFormState', () => {
	const validators = {
		email: (value: string) => {
			if (!value) return 'Email is required';
			if (!value.includes('@')) return 'Invalid email';
			return null;
		},
		password: (value: string) => {
			if (!value) return 'Password is required';
			if (value.length < 8) return 'Password must be at least 8 characters';
			return null;
		}
	};

	it('should initialize with values', () => {
		const form = createFormState({ email: '', password: '' }, validators);

		expect(form.fields.email.value).toBe('');
		expect(form.fields.email.error).toBe(null);
		expect(form.fields.email.touched).toBe(false);
		expect(form.fields.email.dirty).toBe(false);
	});

	it('should validate on field change', () => {
		const form = createFormState({ email: '', password: '' }, validators);

		form.setFieldValue('email', 'invalid');

		expect(form.fields.email.value).toBe('invalid');
		expect(form.fields.email.error).toBe('Invalid email');
		expect(form.fields.email.dirty).toBe(true);
	});

	it('should validate on touch', () => {
		const form = createFormState({ email: '', password: '' }, validators);

		form.setFieldTouched('email');

		expect(form.fields.email.error).toBe('Email is required');
		expect(form.fields.email.touched).toBe(true);
	});

	it('should validate all on submit', async () => {
		const form = createFormState({ email: '', password: '' }, validators);
		const mockSubmit = vi.fn();

		await form.submit(mockSubmit);

		expect(mockSubmit).not.toHaveBeenCalled();
		expect(form.fields.email.touched).toBe(true);
		expect(form.fields.password.touched).toBe(true);
		expect(form.isValid).toBe(false);
	});

	it('should submit valid form', async () => {
		const form = createFormState(
			{ email: 'test@example.com', password: 'password123' },
			validators
		);
		const mockSubmit = vi.fn().mockResolvedValue(undefined);

		await form.submit(mockSubmit);

		expect(mockSubmit).toHaveBeenCalledWith({
			email: 'test@example.com',
			password: 'password123'
		});
	});

	it('should track dirty state', () => {
		const form = createFormState({ name: 'initial' });

		expect(form.isDirty).toBe(false);

		form.setFieldValue('name', 'changed');

		expect(form.isDirty).toBe(true);
	});
});

describe('createToggleState', () => {
	beforeEach(() => {
		localStorage.clear();
	});

	it('should toggle value', () => {
		const toggle = createToggleState(false);

		expect(toggle.value).toBe(false);

		toggle.toggle();
		expect(toggle.value).toBe(true);

		toggle.toggle();
		expect(toggle.value).toBe(false);
	});

	it('should persist to localStorage', () => {
		const toggle = createToggleState(false, 'test-toggle');

		toggle.setTrue();

		expect(localStorage.getItem('test-toggle')).toBe('true');
	});

	it('should load from localStorage', () => {
		localStorage.setItem('test-toggle', 'true');

		const toggle = createToggleState(false, 'test-toggle');

		expect(toggle.value).toBe(true);
	});
});

describe('createSelectionState', () => {
	interface Item {
		id: string;
		name: string;
	}

	const items: Item[] = [
		{ id: '1', name: 'Item 1' },
		{ id: '2', name: 'Item 2' },
		{ id: '3', name: 'Item 3' }
	];

	it('should handle single selection', () => {
		const selection = createSelectionState<Item>((item) => item.id, false);

		selection.select(items[0]);
		expect(selection.selectedIds.has('1')).toBe(true);
		expect(selection.selectedIds.size).toBe(1);

		selection.select(items[1]);
		expect(selection.selectedIds.has('1')).toBe(false);
		expect(selection.selectedIds.has('2')).toBe(true);
		expect(selection.selectedIds.size).toBe(1);
	});

	it('should handle multi selection with ctrl', () => {
		const selection = createSelectionState<Item>((item) => item.id, true);

		selection.select(items[0]);
		selection.select(items[1], false, true); // Ctrl key

		expect(selection.selectedIds.has('1')).toBe(true);
		expect(selection.selectedIds.has('2')).toBe(true);
		expect(selection.selectedIds.size).toBe(2);
	});

	it('should toggle selection', () => {
		const selection = createSelectionState<Item>((item) => item.id, true);

		selection.toggleSelection(items[0]);
		expect(selection.isSelected(items[0])).toBe(true);

		selection.toggleSelection(items[0]);
		expect(selection.isSelected(items[0])).toBe(false);
	});

	it('should select all', () => {
		const selection = createSelectionState<Item>((item) => item.id, true);

		selection.selectAll(items);

		expect(selection.selectedIds.size).toBe(3);
		expect(selection.isMultiSelection).toBe(true);
	});

	it('should deselect all', () => {
		const selection = createSelectionState<Item>((item) => item.id, true);

		selection.selectAll(items);
		selection.deselectAll();

		expect(selection.selectedIds.size).toBe(0);
		expect(selection.hasSelection).toBe(false);
	});
});

describe('createRetryableState', () => {
	beforeEach(() => {
		vi.useFakeTimers();
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it('should retry on failure', async () => {
		const state = createRetryableState<string>(2, 100);
		const mockFn = vi
			.fn()
			.mockRejectedValueOnce(new Error('First fail'))
			.mockRejectedValueOnce(new Error('Second fail'))
			.mockResolvedValueOnce('Success');

		const promise = state.loadWithRetry(mockFn);

		// First attempt fails
		await vi.advanceTimersByTimeAsync(0);
		expect(state.retryCount).toBe(1);
		expect(state.isRetrying).toBe(true);

		// Wait for first retry
		await vi.advanceTimersByTimeAsync(100);
		expect(state.retryCount).toBe(2);

		// Wait for second retry
		await vi.advanceTimersByTimeAsync(200);

		const result = await promise;
		expect(result).toBe('Success');
		expect(state.retryCount).toBe(0);
		expect(mockFn).toHaveBeenCalledTimes(3);
	});

	it('should fail after max retries', async () => {
		const state = createRetryableState<string>(2, 100);
		const mockFn = vi.fn().mockRejectedValue(new Error('Always fails'));

		// Catch the promise immediately to prevent unhandled rejection
		const promise = state.loadWithRetry(mockFn).catch((e) => e);

		// Advance through all retries
		await vi.advanceTimersByTimeAsync(0); // Initial attempt
		await vi.advanceTimersByTimeAsync(100); // First retry
		await vi.advanceTimersByTimeAsync(200); // Second retry

		const result = await promise;
		expect(result).toBeInstanceOf(Error);
		expect(result.message).toBe('Always fails');
		expect(mockFn).toHaveBeenCalledTimes(3); // Initial + 2 retries
	});

	it('should use exponential backoff', async () => {
		const state = createRetryableState<string>(3, 100);
		const mockFn = vi.fn().mockRejectedValue(new Error('Fail'));
		const onError = vi.fn();

		// Catch the promise immediately to prevent unhandled rejection
		const promise = state.loadWithRetry(mockFn, onError).catch((e) => e);

		// First retry after 100ms
		await vi.advanceTimersByTimeAsync(0);
		expect(onError).toHaveBeenCalledWith(expect.any(Error), 1);

		// Second retry after 200ms (100 * 2^1)
		await vi.advanceTimersByTimeAsync(100);
		expect(onError).toHaveBeenCalledWith(expect.any(Error), 2);

		// Third retry after 400ms (100 * 2^2)
		await vi.advanceTimersByTimeAsync(200);
		expect(onError).toHaveBeenCalledWith(expect.any(Error), 3);

		await vi.advanceTimersByTimeAsync(400);
		const result = await promise;
		expect(result).toBeInstanceOf(Error);
		expect(result.message).toBe('Fail');
	});

	it('should cancel retry', async () => {
		const state = createRetryableState<string>(3, 100);
		const mockFn = vi.fn().mockRejectedValue(new Error('Fail'));

		// Start the retry but don't await it
		state.loadWithRetry(mockFn).catch(() => {
			// Ignore the error - we're testing cancellation
		});

		await vi.advanceTimersByTimeAsync(0);
		expect(state.isRetrying).toBe(true);

		state.cancelRetry();

		expect(state.retryCount).toBe(0);
		expect(state.nextRetryTime).toBe(null);
		expect(state.isLoading).toBe(false);

		// Verify no more retries happen
		const callCountAfterCancel = mockFn.mock.calls.length;
		await vi.advanceTimersByTimeAsync(1000);
		expect(mockFn.mock.calls.length).toBe(callCountAfterCancel);
	});
});
