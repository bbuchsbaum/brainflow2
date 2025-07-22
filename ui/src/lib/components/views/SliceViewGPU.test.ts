/**
 * Simple SliceViewGPU Test
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from '@testing-library/svelte';
import SliceViewGPU from './SliceViewGPU.svelte';

// Mock all dependencies
vi.mock('$lib/di/Container', () => ({
	getService: vi.fn(() =>
		Promise.resolve({
			requestGpuResources: vi.fn(),
			setWorldCoordinate: vi.fn(),
			error: vi.fn()
		})
	)
}));

vi.mock('$lib/events/EventBus', () => ({
	getEventBus: () => ({
		on: vi.fn(() => () => {}),
		off: vi.fn(),
		emit: vi.fn()
	})
}));

vi.mock('$lib/stores/layerStore', () => ({
	useLayerStore: {
		getState: () => ({ layers: [], activeLayerId: null }),
		subscribe: vi.fn(() => () => {})
	}
}));

vi.mock('$lib/stores/crosshairSlice', () => ({
	crosshairStore: {
		getState: () => ({ worldCoord: [0, 0, 0], visible: true }),
		subscribe: vi.fn(() => () => {})
	},
	crosshairSlice: () => ({
		getState: () => ({ worldCoord: [0, 0, 0], visible: true }),
		subscribe: vi.fn(() => () => {})
	})
}));

vi.mock('$lib/stores/zustandBridge', () => ({
	zustandToReadable: (store: any) => ({
		subscribe: vi.fn((fn) => {
			fn(store.getState());
			return () => {};
		})
	})
}));

vi.mock('$lib/api', () => ({
	coreApi: {
		init_render_loop: vi.fn(),
		set_view_plane: vi.fn(),
		set_crosshair: vi.fn(),
		update_frame_for_synchronized_view: vi.fn(),
		render_to_image: vi.fn().mockResolvedValue('data:image/raw-rgba;base64,'),
		render_to_image_binary: vi.fn().mockResolvedValue(new Uint8Array(512 * 512 * 4))
	}
}));

vi.mock('$lib/types/ViewType', () => ({
	ViewType: { Axial: 0, Coronal: 1, Sagittal: 2 },
	getViewTypeName: (type: number) => ['Axial', 'Coronal', 'Sagittal'][type]
}));

vi.mock('$lib/utils/debounce', () => ({
	debounce: (fn: Function) => Object.assign(fn, { cancel: vi.fn() })
}));

// Mock global objects
global.ResizeObserver = class ResizeObserver {
	observe() {}
	unobserve() {}
	disconnect() {}
};

describe('SliceViewGPU - Simple', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('should render without crashing', () => {
		const { container } = render(SliceViewGPU, {
			props: {
				layerId: null,
				viewType: 0
			}
		});

		expect(container).toBeTruthy();
	});

	it('should display view type name', () => {
		const { getByText } = render(OrthogonalViewGPU, {
			props: {
				layerId: null,
				viewType: 0
			}
		});

		expect(getByText('Axial')).toBeTruthy();
	});
});
