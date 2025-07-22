/**
 * Tests for Plot Store
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
	usePlotStore,
	getPlotPanel,
	getActivePlotPanel,
	getAllPlotPanels,
	getPlotPanelLayout
} from './plotStore';
import type { PlotPanelState, PlotDataSeries } from '$lib/plotting/PlotProvider';

describe('plotStore', () => {
	// Sample data
	const mockPanel: PlotPanelState = {
		id: 'panel-1',
		title: 'Test Panel',
		providerId: 'timeseries',
		series: [],
		isLoading: false,
		error: undefined,
		config: {}
	};

	const mockSeries: PlotDataSeries[] = [
		{
			id: 'series-1',
			name: 'Test Series',
			data: [
				{ x: 0, y: 1 },
				{ x: 1, y: 2 }
			],
			type: 'line'
		}
	];

	const mockLayout = {
		width: 400,
		height: 300,
		x: 100,
		y: 50,
		docked: 'right' as const
	};

	beforeEach(() => {
		// Reset store to initial state
		usePlotStore.setState({
			panels: new Map(),
			activePanelId: null,
			panelLayouts: new Map()
		});
	});

	describe('Panel management', () => {
		it('should add a new panel', () => {
			const { addPanel } = usePlotStore.getState();

			addPanel(mockPanel);

			const state = usePlotStore.getState();
			expect(state.panels.size).toBe(1);
			expect(state.panels.get('panel-1')).toEqual(mockPanel);
		});

		it('should update an existing panel', () => {
			const { addPanel, updatePanel } = usePlotStore.getState();

			addPanel(mockPanel);
			updatePanel('panel-1', { title: 'Updated Title', isLoading: true });

			const panel = usePlotStore.getState().panels.get('panel-1');
			expect(panel?.title).toBe('Updated Title');
			expect(panel?.isLoading).toBe(true);
			expect(panel?.providerId).toBe('timeseries'); // Unchanged
		});

		it('should not update non-existent panel', () => {
			const { updatePanel } = usePlotStore.getState();

			updatePanel('non-existent', { title: 'Test' });

			expect(usePlotStore.getState().panels.size).toBe(0);
		});

		it('should remove a panel and clean up', () => {
			const { addPanel, removePanel, setActivePanel, updatePanelLayout } = usePlotStore.getState();

			// Add panel with layout and make it active
			addPanel(mockPanel);
			setActivePanel('panel-1');
			updatePanelLayout('panel-1', mockLayout);

			// Verify setup
			expect(usePlotStore.getState().activePanelId).toBe('panel-1');
			expect(usePlotStore.getState().panelLayouts.has('panel-1')).toBe(true);

			// Remove panel
			removePanel('panel-1');

			// Verify cleanup
			const state = usePlotStore.getState();
			expect(state.panels.has('panel-1')).toBe(false);
			expect(state.activePanelId).toBe(null);
			expect(state.panelLayouts.has('panel-1')).toBe(false);
		});

		it('should handle removing non-active panel', () => {
			const { addPanel, removePanel, setActivePanel } = usePlotStore.getState();

			// Add two panels
			addPanel(mockPanel);
			addPanel({ ...mockPanel, id: 'panel-2' });
			setActivePanel('panel-2');

			// Remove non-active panel
			removePanel('panel-1');

			// Active panel should remain
			expect(usePlotStore.getState().activePanelId).toBe('panel-2');
		});
	});

	describe('Active panel', () => {
		it('should set active panel', () => {
			const { addPanel, setActivePanel } = usePlotStore.getState();

			addPanel(mockPanel);
			setActivePanel('panel-1');

			expect(usePlotStore.getState().activePanelId).toBe('panel-1');
		});

		it('should clear active panel', () => {
			const { addPanel, setActivePanel } = usePlotStore.getState();

			addPanel(mockPanel);
			setActivePanel('panel-1');
			setActivePanel(null);

			expect(usePlotStore.getState().activePanelId).toBe(null);
		});
	});

	describe('Panel layout', () => {
		it('should update panel layout', () => {
			const { updatePanelLayout } = usePlotStore.getState();

			updatePanelLayout('panel-1', mockLayout);

			const layout = usePlotStore.getState().panelLayouts.get('panel-1');
			expect(layout).toEqual(mockLayout);
		});

		it('should update existing layout', () => {
			const { updatePanelLayout } = usePlotStore.getState();

			updatePanelLayout('panel-1', mockLayout);
			updatePanelLayout('panel-1', { width: 500, height: 400 });

			const layout = usePlotStore.getState().panelLayouts.get('panel-1');
			expect(layout).toEqual({ width: 500, height: 400 });
		});
	});

	describe('Panel series', () => {
		it('should update panel series', () => {
			const { addPanel, updatePanelSeries } = usePlotStore.getState();

			addPanel(mockPanel);
			updatePanelSeries('panel-1', mockSeries);

			const panel = usePlotStore.getState().panels.get('panel-1');
			expect(panel?.series).toEqual(mockSeries);
		});

		it('should not update series for non-existent panel', () => {
			const { updatePanelSeries } = usePlotStore.getState();

			updatePanelSeries('non-existent', mockSeries);

			expect(usePlotStore.getState().panels.size).toBe(0);
		});
	});

	describe('Loading state', () => {
		it('should set panel loading state', () => {
			const { addPanel, setPanelLoading } = usePlotStore.getState();

			addPanel(mockPanel);
			setPanelLoading('panel-1', true);

			const panel = usePlotStore.getState().panels.get('panel-1');
			expect(panel?.isLoading).toBe(true);
		});

		it('should clear panel loading state', () => {
			const { addPanel, setPanelLoading } = usePlotStore.getState();

			addPanel({ ...mockPanel, isLoading: true });
			setPanelLoading('panel-1', false);

			const panel = usePlotStore.getState().panels.get('panel-1');
			expect(panel?.isLoading).toBe(false);
		});
	});

	describe('Error state', () => {
		it('should set panel error', () => {
			const { addPanel, setPanelError } = usePlotStore.getState();
			const error = new Error('Test error');

			addPanel(mockPanel);
			setPanelError('panel-1', error);

			const panel = usePlotStore.getState().panels.get('panel-1');
			expect(panel?.error).toBe(error);
		});

		it('should clear panel error', () => {
			const { addPanel, setPanelError } = usePlotStore.getState();

			addPanel({ ...mockPanel, error: new Error('Initial error') });
			setPanelError('panel-1', undefined);

			const panel = usePlotStore.getState().panels.get('panel-1');
			expect(panel?.error).toBeUndefined();
		});
	});

	describe('Selectors', () => {
		it('should get plot panel by ID', () => {
			const { addPanel } = usePlotStore.getState();

			addPanel(mockPanel);

			const panel = getPlotPanel('panel-1');
			expect(panel).toEqual(mockPanel);
		});

		it('should return undefined for non-existent panel', () => {
			const panel = getPlotPanel('non-existent');
			expect(panel).toBeUndefined();
		});

		it('should get active plot panel', () => {
			const { addPanel, setActivePanel } = usePlotStore.getState();

			addPanel(mockPanel);
			setActivePanel('panel-1');

			const activePanel = getActivePlotPanel();
			expect(activePanel).toEqual(mockPanel);
		});

		it('should return null when no active panel', () => {
			const activePanel = getActivePlotPanel();
			expect(activePanel).toBe(null);
		});

		it('should get all plot panels', () => {
			const { addPanel } = usePlotStore.getState();
			const panel2 = { ...mockPanel, id: 'panel-2', title: 'Panel 2' };

			addPanel(mockPanel);
			addPanel(panel2);

			const allPanels = getAllPlotPanels();
			expect(allPanels).toHaveLength(2);
			expect(allPanels).toContainEqual(mockPanel);
			expect(allPanels).toContainEqual(panel2);
		});

		it('should return empty array when no panels', () => {
			const allPanels = getAllPlotPanels();
			expect(allPanels).toEqual([]);
		});

		it('should get plot panel layout', () => {
			const { updatePanelLayout } = usePlotStore.getState();

			updatePanelLayout('panel-1', mockLayout);

			const layout = getPlotPanelLayout('panel-1');
			expect(layout).toEqual(mockLayout);
		});

		it('should return undefined for non-existent layout', () => {
			const layout = getPlotPanelLayout('non-existent');
			expect(layout).toBeUndefined();
		});
	});

	describe('Complex scenarios', () => {
		it('should handle multiple panels with different states', () => {
			const { addPanel, updatePanel, setPanelLoading, setPanelError } = usePlotStore.getState();

			// Add multiple panels
			addPanel(mockPanel);
			addPanel({ ...mockPanel, id: 'panel-2', title: 'Panel 2' });
			addPanel({ ...mockPanel, id: 'panel-3', title: 'Panel 3' });

			// Set different states
			setPanelLoading('panel-1', true);
			setPanelError('panel-2', new Error('Panel 2 error'));
			updatePanel('panel-3', { series: mockSeries });

			// Verify states
			const state = usePlotStore.getState();
			expect(state.panels.get('panel-1')?.isLoading).toBe(true);
			expect(state.panels.get('panel-2')?.error?.message).toBe('Panel 2 error');
			expect(state.panels.get('panel-3')?.series).toEqual(mockSeries);
		});

		it('should handle panel state transitions', () => {
			const { addPanel, setPanelLoading, updatePanelSeries, setPanelError } =
				usePlotStore.getState();

			addPanel(mockPanel);

			// Loading -> Success
			setPanelLoading('panel-1', true);
			expect(getPlotPanel('panel-1')?.isLoading).toBe(true);

			updatePanelSeries('panel-1', mockSeries);
			setPanelLoading('panel-1', false);

			const successPanel = getPlotPanel('panel-1');
			expect(successPanel?.isLoading).toBe(false);
			expect(successPanel?.series).toEqual(mockSeries);

			// Loading -> Error
			setPanelLoading('panel-1', true);
			setPanelError('panel-1', new Error('Load failed'));
			setPanelLoading('panel-1', false);

			const errorPanel = getPlotPanel('panel-1');
			expect(errorPanel?.isLoading).toBe(false);
			expect(errorPanel?.error?.message).toBe('Load failed');
		});
	});
});
