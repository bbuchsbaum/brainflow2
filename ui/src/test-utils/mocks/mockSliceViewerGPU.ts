/**
 * Mock SliceViewerGPU Component
 * Used to prevent GPU initialization during tests
 */
import { vi } from 'vitest';

// Create a mock component that avoids GPU initialization
export const MockSliceViewerGPU = {
	render: (props: any) => {
		const div = document.createElement('div');
		div.className = 'mock-slice-viewer-gpu';
		div.setAttribute('data-plane', props.plane || 'axial');
		div.textContent = `Mock SliceViewerGPU (${props.plane || 'axial'})`;

		// Emit frame change if callback provided
		if (props.onFrameChange) {
			// Simulate frame initialization
			setTimeout(() => {
				props.onFrameChange({
					plane: props.plane || 'axial',
					dimensions: { width: 512, height: 512 },
					worldToScreen: new Float32Array(16),
					screenToWorld: new Float32Array(16),
					viewBounds: { min: [0, 0], max: [512, 512] },
					sliceMm: props.sliceMm || 0
				});
			}, 0);
		}

		return {
			container: div,
			destroy: vi.fn()
		};
	}
};

// Mock the GpuRenderManager to prevent GPU access
export const mockGpuRenderManager = () => {
	vi.mock('$lib/gpu/renderManager', () => ({
		GpuRenderManager: vi.fn().mockImplementation(() => ({
			initialize: vi.fn().mockResolvedValue(undefined),
			render: vi.fn().mockResolvedValue({
				imageData: new Uint8Array([])
			}),
			destroy: vi.fn()
		}))
	}));
};
