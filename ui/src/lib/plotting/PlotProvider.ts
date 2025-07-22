/**
 * Abstract Plot Provider Interface
 * Defines the contract for plot implementations that can respond to user actions
 * and display various types of data visualizations
 */

import type { EventBus } from '$lib/events/EventBus';

/**
 * Plot configuration that providers can customize
 */
export interface PlotConfig {
	width?: number;
	height?: number;
	margin?: { top: number; right: number; bottom: number; left: number };
	theme?: 'light' | 'dark' | 'auto';
	interactive?: boolean;
	exportable?: boolean;
	[key: string]: any; // Allow provider-specific config
}

/**
 * Data point for plotting
 */
export interface PlotDataPoint {
	x: number;
	y: number;
	z?: number;
	label?: string;
	metadata?: Record<string, any>;
}

/**
 * Series of data for plotting
 */
export interface PlotDataSeries {
	id: string;
	name: string;
	data: PlotDataPoint[];
	type?: 'line' | 'scatter' | 'bar' | 'area' | 'custom';
	color?: string;
	visible?: boolean;
	metadata?: Record<string, any>;
}

/**
 * Plot request triggered by user action
 */
export interface PlotRequest {
	id: string;
	source: 'click' | 'selection' | 'hover' | 'command' | 'custom';
	sourceData: {
		layerId?: string;
		volumeId?: string;
		worldCoord?: [number, number, number];
		voxelCoord?: [number, number, number];
		value?: number;
		timestamp?: number;
		[key: string]: any;
	};
	targetPanelId?: string;
	requestType: string; // Provider-specific type
	options?: Record<string, any>;
}

/**
 * Plot update for streaming/real-time data
 */
export interface PlotUpdate {
	seriesId: string;
	data: PlotDataPoint | PlotDataPoint[];
	operation: 'append' | 'replace' | 'update';
	range?: { start: number; end: number };
}

/**
 * Plot interaction event
 */
export interface PlotInteraction {
	type: 'click' | 'hover' | 'select' | 'zoom' | 'pan' | 'export';
	seriesId?: string;
	dataPoint?: PlotDataPoint;
	range?: { x?: [number, number]; y?: [number, number] };
	metadata?: Record<string, any>;
}

/**
 * Plot provider capabilities
 */
export interface PlotProviderCapabilities {
	streaming: boolean;
	multiSeries: boolean;
	interactions: PlotInteraction['type'][];
	exportFormats: ('png' | 'svg' | 'csv' | 'json')[];
	customActions: string[];
}

/**
 * Abstract base class for plot providers
 */
export abstract class PlotProvider {
	protected id: string;
	protected name: string;
	protected eventBus: EventBus;

	constructor(id: string, name: string, eventBus: EventBus) {
		this.id = id;
		this.name = name;
		this.eventBus = eventBus;
	}

	/**
	 * Get provider ID
	 */
	getId(): string {
		return this.id;
	}

	/**
	 * Get provider name
	 */
	getName(): string {
		return this.name;
	}

	/**
	 * Get provider capabilities
	 */
	abstract getCapabilities(): PlotProviderCapabilities;

	/**
	 * Check if provider can handle a specific request
	 */
	abstract canHandle(request: PlotRequest): boolean;

	/**
	 * Initialize the provider
	 */
	abstract initialize(config?: PlotConfig): Promise<void>;

	/**
	 * Handle a plot request
	 */
	abstract handleRequest(request: PlotRequest): Promise<PlotDataSeries[]>;

	/**
	 * Create plot component
	 * Returns a Svelte component class or constructor
	 */
	abstract createComponent(series: PlotDataSeries[], config?: PlotConfig): any; // Svelte component constructor

	/**
	 * Update existing plot with new data
	 */
	abstract updatePlot(componentInstance: any, update: PlotUpdate): void;

	/**
	 * Handle plot interaction
	 */
	abstract handleInteraction(interaction: PlotInteraction): void;

	/**
	 * Export plot data or image
	 */
	abstract export(
		componentInstance: any,
		format: 'png' | 'svg' | 'csv' | 'json'
	): Promise<Blob | string>;

	/**
	 * Clean up resources
	 */
	abstract dispose(): void;

	/**
	 * Emit plot event
	 */
	protected emitEvent(event: string, data: any): void {
		this.eventBus.emit(`plot.${this.id}.${event}`, data);
	}
}

/**
 * Factory function type for creating plot providers
 */
export type PlotProviderFactory = (eventBus: EventBus, config?: any) => PlotProvider;

/**
 * Registry entry for plot providers
 */
export interface PlotProviderRegistration {
	id: string;
	name: string;
	description: string;
	factory: PlotProviderFactory;
	config?: any;
}

/**
 * Plot panel state
 */
export interface PlotPanelState {
	id: string;
	providerId: string;
	series: PlotDataSeries[];
	config: PlotConfig;
	isLoading: boolean;
	error?: Error;
}
