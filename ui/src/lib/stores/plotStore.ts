/**
 * Plot Store
 * Svelte-compatible state management for plot panels and their data
 */
import { writable } from 'svelte/store';
import type { PlotPanelState, PlotDataSeries } from '$lib/plotting/PlotProvider';

export interface PlotState {
	// Plot panels by ID
	panels: Map<string, PlotPanelState>;

	// Currently focused panel
	activePanelId: string | null;

	// Panel layout preferences
	panelLayouts: Map<
		string,
		{
			width: number;
			height: number;
			x?: number;
			y?: number;
			docked?: 'left' | 'right' | 'bottom';
		}
	>;
}

// Create reactive store using Svelte's writable
function createPlotStore() {
	const { subscribe, update, set } = writable<PlotState>({
		panels: new Map(),
		activePanelId: null,
		panelLayouts: new Map()
	});

	return {
		subscribe,

		// State accessors
		get panels() {
			let value = new Map<string, PlotPanelState>();
			subscribe((state) => {
				value = state.panels;
			})();
			return value;
		},

		get activePanelId() {
			let value: string | null = null;
			subscribe((state) => {
				value = state.activePanelId;
			})();
			return value;
		},

		get panelLayouts() {
			let value = new Map<string, any>();
			subscribe((state) => {
				value = state.panelLayouts;
			})();
			return value;
		},

		// Actions
		addPanel: (panel: PlotPanelState) => {
			update((state) => {
				const panels = new Map(state.panels);
				panels.set(panel.id, panel);
				return { ...state, panels };
			});
		},

		updatePanel: (panelId: string, updates: Partial<PlotPanelState>) => {
			update((state) => {
				const panels = new Map(state.panels);
				const existing = panels.get(panelId);
				if (existing) {
					panels.set(panelId, { ...existing, ...updates });
				}
				return { ...state, panels };
			});
		},

		removePanel: (panelId: string) => {
			update((state) => {
				const panels = new Map(state.panels);
				panels.delete(panelId);

				// Clear active panel if it was removed
				const activePanelId = state.activePanelId === panelId ? null : state.activePanelId;

				// Remove layout
				const panelLayouts = new Map(state.panelLayouts);
				panelLayouts.delete(panelId);

				return { panels, activePanelId, panelLayouts };
			});
		},

		setActivePanel: (panelId: string | null) => {
			update((state) => ({ ...state, activePanelId: panelId }));
		},

		updatePanelLayout: (panelId: string, layout: any) => {
			update((state) => {
				const panelLayouts = new Map(state.panelLayouts);
				panelLayouts.set(panelId, layout);
				return { ...state, panelLayouts };
			});
		},

		updatePanelSeries: (panelId: string, series: PlotDataSeries[]) => {
			update((state) => {
				const panels = new Map(state.panels);
				const panel = panels.get(panelId);
				if (panel) {
					panels.set(panelId, { ...panel, series });
				}
				return { ...state, panels };
			});
		},

		setPanelLoading: (panelId: string, isLoading: boolean) => {
			update((state) => {
				const panels = new Map(state.panels);
				const panel = panels.get(panelId);
				if (panel) {
					panels.set(panelId, { ...panel, isLoading });
				}
				return { ...state, panels };
			});
		},

		setPanelError: (panelId: string, error: Error | undefined) => {
			update((state) => {
				const panels = new Map(state.panels);
				const panel = panels.get(panelId);
				if (panel) {
					panels.set(panelId, { ...panel, error });
				}
				return { ...state, panels };
			});
		}
	};
}

// Export singleton instance
export const plotStore = createPlotStore();

// Selectors
export const getPlotPanel = (panelId: string) => plotStore.panels.get(panelId);

export const getActivePlotPanel = () => {
	return plotStore.activePanelId ? plotStore.panels.get(plotStore.activePanelId) : null;
};

export const getAllPlotPanels = () => Array.from(plotStore.panels.values());

export const getPlotPanelLayout = (panelId: string) => plotStore.panelLayouts.get(panelId);
