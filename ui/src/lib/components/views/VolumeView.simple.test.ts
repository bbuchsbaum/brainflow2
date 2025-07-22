/**
 * Simple VolumeView Test to verify basic functionality
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from '@testing-library/svelte';
import VolumeView from './VolumeView.svelte';

// Mock modules before component import
vi.mock('./SliceViewGPU.svelte');
vi.mock('$lib/di/Container', () => ({
	getService: vi.fn().mockImplementation(() =>
		Promise.resolve({
			addLayer: vi.fn(),
			removeLayer: vi.fn(),
			loadVolume: vi.fn(),
			success: vi.fn(),
			error: vi.fn()
		})
	)
}));
vi.mock('$lib/stores/statusStore', () => ({
	statusStore: {
		setLoading: vi.fn(),
		setError: vi.fn(),
		clearStatus: vi.fn()
	}
}));

describe('VolumeView - Simple Test', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('should render without crashing', () => {
		const { container } = render(VolumeView);
		expect(container).toBeTruthy();
	});

	it('should show empty state initially', () => {
		const { getByText } = render(VolumeView);
		expect(getByText('No volume loaded')).toBeTruthy();
	});
});
