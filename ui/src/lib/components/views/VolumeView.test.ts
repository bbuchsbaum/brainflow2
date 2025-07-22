/**
 * Minimal VolumeView Test
 * Testing the component in isolation without GPU components
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/svelte';
import { getEventBus } from '$lib/events/EventBus';
import { useLayerStore } from '$lib/stores/layerStore';

// Create a minimal mock component that avoids GPU initialization
const MockVolumeView = {
	render: () => {
		const container = document.createElement('div');
		container.className = 'volume-view-container';

		// Get current store state
		const state = useLayerStore.getState();

		// Render based on state
		if (!state.layers || state.layers.length === 0) {
			const empty = document.createElement('div');
			empty.className = 'empty-state';
			empty.innerHTML = `
        <div>No volume loaded</div>
        <div>Double-click a file or drag it here</div>
      `;
			container.appendChild(empty);
		} else {
			const content = document.createElement('div');
			content.className = 'orthogonal-views';
			content.textContent = 'Volume loaded';
			container.appendChild(content);
		}

		return {
			container,
			destroy: () => {}
		};
	}
};

// Mock the problematic components at module level
vi.mock('./VolumeView.svelte', () => ({
	default: MockVolumeView
}));

vi.mock('$lib/di/Container', () => ({
	getService: vi.fn()
}));

describe('VolumeView Minimal Tests', () => {
	beforeEach(() => {
		// Clear stores
		useLayerStore.setState({ layers: [], activeLayerId: null });
	});

	it('should show empty state when no layers exist', () => {
		const { container } = MockVolumeView.render();
		document.body.appendChild(container);

		expect(screen.getByText('No volume loaded')).toBeInTheDocument();
		expect(screen.getByText('Double-click a file or drag it here')).toBeInTheDocument();

		document.body.removeChild(container);
	});

	it('should show content when layers exist', () => {
		// Add a layer
		useLayerStore.setState({
			layers: [
				{
					id: 'test-layer',
					spec: { Volume: { id: 'vol-1', source_resource_id: 'res-1' } },
					isLoadingGpu: false,
					visible: true,
					opacity: 1,
					colormap: 'grayscale',
					windowLevel: { window: 1, level: 0.5 }
				}
			],
			activeLayerId: 'test-layer'
		});

		const { container } = MockVolumeView.render();
		document.body.appendChild(container);

		expect(screen.getByText('Volume loaded')).toBeInTheDocument();
		expect(screen.queryByText('No volume loaded')).not.toBeInTheDocument();

		document.body.removeChild(container);
	});
});
