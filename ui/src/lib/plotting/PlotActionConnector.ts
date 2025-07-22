/**
 * Plot Action Connector
 * Maps user actions from various sources to plot requests
 * Provides a clean abstraction for connecting UI events to plot providers
 */
import type { EventBus } from '$lib/events/EventBus';
import type { PlotService } from '$lib/services/PlotService';
import type { PlotRequest } from './PlotProvider';
import { nanoid } from '$lib/utils/nanoid';

export interface PlotActionMapping {
	source: string; // Event source pattern (e.g., 'viewer.click', 'roi.selected')
	target: string; // Plot request type (e.g., 'timeseries', 'histogram')
	transform?: (eventData: any) => Partial<PlotRequest>;
	filter?: (eventData: any) => boolean;
	options?: Record<string, any>;
}

export interface PlotActionConnectorConfig {
	eventBus: EventBus;
	plotService: PlotService;
	mappings?: PlotActionMapping[];
}

export class PlotActionConnector {
	private eventBus: EventBus;
	private plotService: PlotService;
	private mappings: PlotActionMapping[] = [];
	private subscriptions: (() => void)[] = [];

	constructor(config: PlotActionConnectorConfig) {
		this.eventBus = config.eventBus;
		this.plotService = config.plotService;

		if (config.mappings) {
			this.addMappings(config.mappings);
		}
	}

	/**
	 * Add action mappings
	 */
	addMappings(mappings: PlotActionMapping[]): void {
		this.mappings.push(...mappings);
		this.updateSubscriptions();
	}

	/**
	 * Add a single mapping
	 */
	addMapping(mapping: PlotActionMapping): void {
		this.mappings.push(mapping);
		this.updateSubscriptions();
	}

	/**
	 * Remove mappings by source pattern
	 */
	removeMappings(source: string): void {
		this.mappings = this.mappings.filter((m) => m.source !== source);
		this.updateSubscriptions();
	}

	/**
	 * Clear all mappings
	 */
	clearMappings(): void {
		this.mappings = [];
		this.updateSubscriptions();
	}

	/**
	 * Get current mappings
	 */
	getMappings(): PlotActionMapping[] {
		return [...this.mappings];
	}

	/**
	 * Update event subscriptions based on mappings
	 */
	private updateSubscriptions(): void {
		// Unsubscribe from previous events
		this.subscriptions.forEach((unsubscribe) => unsubscribe());
		this.subscriptions = [];

		// Group mappings by source
		const mappingsBySource = new Map<string, PlotActionMapping[]>();
		for (const mapping of this.mappings) {
			const existing = mappingsBySource.get(mapping.source) || [];
			existing.push(mapping);
			mappingsBySource.set(mapping.source, existing);
		}

		// Subscribe to each unique source
		for (const [source, mappings] of mappingsBySource) {
			const unsubscribe = this.eventBus.on(source, (eventData) => {
				this.handleAction(source, eventData, mappings);
			});
			this.subscriptions.push(unsubscribe);
		}
	}

	/**
	 * Handle an action and create plot requests
	 */
	private async handleAction(
		source: string,
		eventData: any,
		mappings: PlotActionMapping[]
	): Promise<void> {
		for (const mapping of mappings) {
			// Check filter
			if (mapping.filter && !mapping.filter(eventData)) {
				continue;
			}

			try {
				// Create plot request
				const request = this.createPlotRequest(mapping, eventData);

				// Emit plot request
				this.eventBus.emit('plot.request', request);
			} catch (error) {
				console.error(`Failed to create plot request for ${source}:`, error);
			}
		}
	}

	/**
	 * Create a plot request from mapping and event data
	 */
	private createPlotRequest(mapping: PlotActionMapping, eventData: any): PlotRequest {
		// Base request
		const request: PlotRequest = {
			id: nanoid(),
			source: this.inferRequestSource(mapping.source),
			sourceData: eventData,
			requestType: mapping.target,
			options: mapping.options || {}
		};

		// Apply transform if provided
		if (mapping.transform) {
			const transformed = mapping.transform(eventData);
			Object.assign(request, transformed);
		}

		return request;
	}

	/**
	 * Infer request source type from event name
	 */
	private inferRequestSource(eventName: string): PlotRequest['source'] {
		if (eventName.includes('click')) return 'click';
		if (eventName.includes('select')) return 'selection';
		if (eventName.includes('hover')) return 'hover';
		if (eventName.includes('command')) return 'command';
		return 'custom';
	}

	/**
	 * Dispose connector
	 */
	dispose(): void {
		this.subscriptions.forEach((unsubscribe) => unsubscribe());
		this.subscriptions = [];
		this.mappings = [];
	}
}

// Default mappings for common scenarios
export const DEFAULT_PLOT_MAPPINGS: PlotActionMapping[] = [
	// Voxel click → Time series plot
	{
		source: 'viewer.voxel.clicked',
		target: 'timeseries',
		transform: (data) => ({
			sourceData: {
				layerId: data.layerId,
				volumeId: data.volumeId,
				worldCoord: data.worldCoord,
				voxelCoord: data.voxelCoord,
				value: data.value
			}
		})
	},

	// ROI selection → Time series plot
	{
		source: 'annotation.roi.selected',
		target: 'timeseries',
		transform: (data) => ({
			sourceData: {
				layerId: data.layerId,
				volumeId: data.volumeId,
				roiId: data.roiId,
				roiName: data.name
			}
		})
	},

	// Layer histogram request
	{
		source: 'layer.histogram.requested',
		target: 'histogram',
		transform: (data) => ({
			sourceData: {
				layerId: data.layerId,
				volumeId: data.volumeId
			}
		})
	},

	// Surface vertex click → Vertex time series
	{
		source: 'surface.vertex.clicked',
		target: 'timeseries',
		transform: (data) => ({
			sourceData: {
				surfaceId: data.surfaceId,
				vertexIndex: data.vertexIndex,
				coordinate: data.coordinate
			}
		})
	},

	// Connectivity matrix cell → Connectivity plot
	{
		source: 'connectivity.cell.clicked',
		target: 'connectivity',
		transform: (data) => ({
			sourceData: {
				matrixId: data.matrixId,
				sourceRegion: data.sourceRegion,
				targetRegion: data.targetRegion,
				value: data.value
			}
		})
	}
];

// Helper to create common mappings
export class PlotMappingBuilder {
	private mappings: PlotActionMapping[] = [];

	/**
	 * Add voxel click mapping
	 */
	onVoxelClick(target: string = 'timeseries', options?: Partial<PlotActionMapping>): this {
		this.mappings.push({
			source: 'viewer.voxel.clicked',
			target,
			transform: (data) => ({
				sourceData: {
					layerId: data.layerId,
					volumeId: data.volumeId,
					worldCoord: data.worldCoord,
					voxelCoord: data.voxelCoord,
					value: data.value
				}
			}),
			...options
		});
		return this;
	}

	/**
	 * Add ROI selection mapping
	 */
	onRoiSelection(target: string = 'timeseries', options?: Partial<PlotActionMapping>): this {
		this.mappings.push({
			source: 'annotation.roi.selected',
			target,
			transform: (data) => ({
				sourceData: {
					layerId: data.layerId,
					volumeId: data.volumeId,
					roiId: data.roiId,
					roiName: data.name,
					voxelCount: data.voxelCount
				}
			}),
			...options
		});
		return this;
	}

	/**
	 * Add custom event mapping
	 */
	onEvent(
		source: string,
		target: string,
		transform?: (data: any) => Partial<PlotRequest>,
		filter?: (data: any) => boolean
	): this {
		this.mappings.push({
			source,
			target,
			transform,
			filter
		});
		return this;
	}

	/**
	 * Build mappings array
	 */
	build(): PlotActionMapping[] {
		return this.mappings;
	}
}

// Example usage factory
export function createDefaultPlotConnector(
	eventBus: EventBus,
	plotService: PlotService
): PlotActionConnector {
	const connector = new PlotActionConnector({
		eventBus,
		plotService,
		mappings: DEFAULT_PLOT_MAPPINGS
	});

	return connector;
}
