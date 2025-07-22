/**
 * Simplified StatusBar Component Tests
 * Focused on preventing hanging issues
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/svelte';
import StatusBar from './StatusBar.svelte';

// Simple mock setup
const mockEventBus = {
	on: vi.fn(() => () => {}),
	off: vi.fn(),
	emit: vi.fn()
};

// Mock modules before component import
vi.mock('$lib/events/EventBus', () => ({
	getEventBus: () => mockEventBus
}));

vi.mock('$lib/di/Container', () => ({
	getService: vi.fn(() =>
		Promise.resolve({
			getWorldCoord: vi.fn(() => [0, 0, 0]),
			setWorldCoord: vi.fn(),
			getActiveLayer: vi.fn(),
			sampleWorldCoordinate: vi.fn().mockResolvedValue({ value: 0 })
		})
	)
}));

vi.mock('$lib/stores/crosshairSlice', () => ({
	crosshairStore: {
		getState: () => ({ worldCoord: [0, 0, 0], voxelCoord: [0, 0, 0], visible: true }),
		subscribe: vi.fn((fn) => {
			// Call immediately but don't create loops
			fn({ worldCoord: [0, 0, 0], voxelCoord: [0, 0, 0], visible: true });
			return () => {};
		})
	},
	crosshairSlice: () => ({
		getState: () => ({ worldCoord: [0, 0, 0], voxelCoord: [0, 0, 0], visible: true }),
		subscribe: vi.fn((fn) => {
			// Call immediately but don't create loops
			fn({ worldCoord: [0, 0, 0], voxelCoord: [0, 0, 0], visible: true });
			return () => {};
		})
	})
}));

vi.mock('$lib/stores/layerStore', () => ({
	useLayerStore: {
		getState: () => ({ layers: [], activeLayerId: null }),
		subscribe: vi.fn((fn) => {
			fn({ layers: [], activeLayerId: null });
			return () => {};
		})
	}
}));

vi.mock('$lib/stores/zustandBridge', () => ({
	zustandToReadable: (store: any) => ({
		subscribe: (run: Function) => {
			const state = store.getState();
			run(state);
			return () => {};
		}
	})
}));

vi.mock('$lib/stores/statusStore', () => ({
	statusStore: {
		subscribe: vi.fn((fn) => {
			fn({ mouseWorldCoord: null });
			return () => {};
		})
	}
}));

vi.mock('$lib/api', () => ({
	coreApi: {
		sample_world_coordinate: vi.fn().mockResolvedValue(0)
	}
}));

describe('StatusBar - Simplified', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('should render without hanging', async () => {
		const { container } = render(StatusBar);

		// Should render quickly without hanging
		await waitFor(
			() => {
				expect(screen.getByRole('status')).toBeInTheDocument();
			},
			{ timeout: 1000 }
		);

		expect(container).toBeTruthy();
	});

	it('should display coordinate labels', async () => {
		render(StatusBar);

		await waitFor(
			() => {
				expect(screen.getByText(/World:/)).toBeInTheDocument();
			},
			{ timeout: 1000 }
		);

		expect(screen.getByText(/Voxel:/)).toBeInTheDocument();
	});

	it('should handle event subscriptions', async () => {
		render(StatusBar);

		await waitFor(
			() => {
				expect(mockEventBus.on).toHaveBeenCalled();
			},
			{ timeout: 1000 }
		);

		// Should subscribe to events
		expect(mockEventBus.on).toHaveBeenCalledWith('crosshair.changed', expect.any(Function));
		expect(mockEventBus.on).toHaveBeenCalledWith('mouse.worldcoord', expect.any(Function));
	});
});
