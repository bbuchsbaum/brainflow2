/**
 * Time Series Plot Provider
 * Example implementation of PlotProvider for displaying time series data
 */
import { PlotProvider } from '../PlotProvider';
import type {
	PlotRequest,
	PlotDataSeries,
	PlotConfig,
	PlotUpdate,
	PlotInteraction,
	PlotProviderCapabilities,
	PlotProviderFactory
} from '../PlotProvider';
import type { EventBus } from '$lib/events/EventBus';
import TimeSeriesPlotComponent from './TimeSeriesPlotComponent.svelte';
import { fetchTimeSeries } from '$lib/api';

export interface TimeSeriesConfig extends PlotConfig {
	xAxis?: {
		label?: string;
		type?: 'time' | 'index';
		format?: string;
	};
	yAxis?: {
		label?: string;
		scale?: 'linear' | 'log';
		min?: number;
		max?: number;
	};
	interpolation?: 'linear' | 'step' | 'smooth';
	showPoints?: boolean;
	showGrid?: boolean;
	animation?: boolean;
}

export class TimeSeriesPlotProvider extends PlotProvider {
	private config: TimeSeriesConfig = {};

	constructor(eventBus: EventBus, config?: TimeSeriesConfig) {
		super('timeseries', 'Time Series Plot', eventBus);
		this.config = {
			...this.getDefaultConfig(),
			...config
		};
	}

	getCapabilities(): PlotProviderCapabilities {
		return {
			streaming: true,
			multiSeries: true,
			interactions: ['click', 'hover', 'select', 'zoom', 'pan'],
			exportFormats: ['png', 'svg', 'csv', 'json'],
			customActions: ['reset-zoom', 'toggle-legend', 'toggle-grid']
		};
	}

	canHandle(request: PlotRequest): boolean {
		// Handle time series requests
		if (request.requestType === 'timeseries') {
			return true;
		}

		// Handle voxel clicks if time series data available
		if (request.source === 'click' && request.sourceData.volumeId) {
			return true;
		}

		// Handle ROI selections
		if (request.source === 'selection' && request.sourceData.roiId) {
			return true;
		}

		return false;
	}

	async initialize(config?: TimeSeriesConfig): Promise<void> {
		this.config = {
			...this.config,
			...config
		};

		// Initialize any required resources
		this.emitEvent('initialized', { config: this.config });
	}

	async handleRequest(request: PlotRequest): Promise<PlotDataSeries[]> {
		try {
			const series: PlotDataSeries[] = [];

			switch (request.source) {
				case 'click':
					// Fetch time series for clicked voxel
					if (request.sourceData.volumeId && request.sourceData.voxelCoord) {
						const data = await this.fetchVoxelTimeSeries(
							request.sourceData.volumeId,
							request.sourceData.voxelCoord
						);
						series.push(data);
					}
					break;

				case 'selection':
					// Fetch time series for ROI
					if (request.sourceData.roiId) {
						const data = await this.fetchRoiTimeSeries(
							request.sourceData.volumeId!,
							request.sourceData.roiId
						);
						series.push(...data);
					}
					break;

				case 'command':
					// Handle direct time series request
					if (request.options?.seriesIds) {
						const data = await this.fetchMultipleSeries(request.options.seriesIds);
						series.push(...data);
					}
					break;
			}

			return series;
		} catch (error) {
			console.error('Failed to fetch time series:', error);
			throw error;
		}
	}

	createComponent(series: PlotDataSeries[], config?: PlotConfig): any {
		return TimeSeriesPlotComponent;
	}

	updatePlot(componentInstance: any, update: PlotUpdate): void {
		// Update component with new data
		switch (update.operation) {
			case 'append':
				componentInstance.appendData(update.seriesId, update.data);
				break;

			case 'replace':
				componentInstance.replaceData(update.seriesId, update.data);
				break;

			case 'update':
				if (update.range) {
					componentInstance.updateRange(update.seriesId, update.data, update.range);
				}
				break;
		}
	}

	handleInteraction(interaction: PlotInteraction): void {
		switch (interaction.type) {
			case 'click':
				if (interaction.dataPoint) {
					this.emitEvent('point.clicked', {
						seriesId: interaction.seriesId,
						point: interaction.dataPoint
					});
				}
				break;

			case 'select':
				if (interaction.range) {
					this.emitEvent('range.selected', {
						seriesId: interaction.seriesId,
						range: interaction.range
					});
				}
				break;

			case 'zoom':
				this.emitEvent('zoom.changed', {
					range: interaction.range
				});
				break;
		}
	}

	async export(
		componentInstance: any,
		format: 'png' | 'svg' | 'csv' | 'json'
	): Promise<Blob | string> {
		switch (format) {
			case 'png':
			case 'svg':
				// Export chart as image
				return componentInstance.exportImage(format);

			case 'csv':
				// Export data as CSV
				return this.exportDataAsCSV(componentInstance.getSeries());

			case 'json':
				// Export data as JSON
				return this.exportDataAsJSON(componentInstance.getSeries());

			default:
				throw new Error(`Unsupported export format: ${format}`);
		}
	}

	dispose(): void {
		// Clean up any resources
		this.emitEvent('disposed', {});
	}

	// Private helper methods

	private getDefaultConfig(): TimeSeriesConfig {
		return {
			width: 600,
			height: 400,
			margin: { top: 20, right: 20, bottom: 40, left: 60 },
			theme: 'auto',
			interactive: true,
			exportable: true,
			xAxis: {
				label: 'Time',
				type: 'time'
			},
			yAxis: {
				label: 'Value',
				scale: 'linear'
			},
			interpolation: 'linear',
			showPoints: false,
			showGrid: true,
			animation: true
		};
	}

	private async fetchVoxelTimeSeries(
		volumeId: string,
		voxelCoord: [number, number, number]
	): Promise<PlotDataSeries> {
		// Call API to get time series data
		const result = await fetchTimeSeries({
			volumeId,
			voxelCoord,
			type: 'voxel'
		});

		return {
			id: `voxel-${voxelCoord.join('-')}`,
			name: `Voxel (${voxelCoord.map((v) => v.toFixed(0)).join(', ')})`,
			data: result.data.map((value, index) => ({
				x: index,
				y: value,
				metadata: { timepoint: index }
			})),
			type: 'line',
			color: '#3b82f6',
			visible: true,
			metadata: {
				volumeId,
				voxelCoord,
				unit: result.unit
			}
		};
	}

	private async fetchRoiTimeSeries(volumeId: string, roiId: string): Promise<PlotDataSeries[]> {
		// Call API to get ROI time series
		const result = await fetchTimeSeries({
			volumeId,
			roiId,
			type: 'roi'
		});

		// Return mean and std dev as separate series
		return [
			{
				id: `roi-${roiId}-mean`,
				name: `${result.roiName} (mean)`,
				data: result.mean.map((value, index) => ({
					x: index,
					y: value
				})),
				type: 'line',
				color: '#10b981',
				visible: true,
				metadata: {
					volumeId,
					roiId,
					statistic: 'mean'
				}
			},
			{
				id: `roi-${roiId}-std`,
				name: `${result.roiName} (±1 SD)`,
				data: result.mean.map((mean, index) => ({
					x: index,
					y: mean,
					metadata: {
						yMin: mean - result.std[index],
						yMax: mean + result.std[index]
					}
				})),
				type: 'area',
				color: '#10b981',
				visible: true,
				metadata: {
					volumeId,
					roiId,
					statistic: 'std',
					opacity: 0.2
				}
			}
		];
	}

	private async fetchMultipleSeries(seriesIds: string[]): Promise<PlotDataSeries[]> {
		// Fetch multiple pre-defined series
		const results = await Promise.all(seriesIds.map((id) => fetchTimeSeries({ seriesId: id })));

		return results.map((result, index) => ({
			id: result.id,
			name: result.name,
			data: result.data.map((point: any) => ({
				x: point.x,
				y: point.y,
				metadata: point.metadata
			})),
			type: 'line',
			color: this.getSeriesColor(index),
			visible: true,
			metadata: result.metadata
		}));
	}

	private getSeriesColor(index: number): string {
		const colors = [
			'#3b82f6', // blue
			'#10b981', // emerald
			'#f59e0b', // amber
			'#ef4444', // red
			'#8b5cf6', // violet
			'#ec4899', // pink
			'#06b6d4', // cyan
			'#84cc16' // lime
		];
		return colors[index % colors.length];
	}

	private exportDataAsCSV(series: PlotDataSeries[]): string {
		let csv = 'Series,X,Y\n';

		for (const s of series) {
			for (const point of s.data) {
				csv += `"${s.name}",${point.x},${point.y}\n`;
			}
		}

		return csv;
	}

	private exportDataAsJSON(series: PlotDataSeries[]): string {
		return JSON.stringify(
			{
				exportDate: new Date().toISOString(),
				series: series.map((s) => ({
					id: s.id,
					name: s.name,
					type: s.type,
					data: s.data,
					metadata: s.metadata
				}))
			},
			null,
			2
		);
	}
}

// Factory function
export const createTimeSeriesPlotProvider: PlotProviderFactory = (eventBus, config) => {
	return new TimeSeriesPlotProvider(eventBus, config);
};
