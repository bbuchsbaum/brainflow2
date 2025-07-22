/**
 * Tests for PlotProvider Abstract Interface
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PlotProvider } from './PlotProvider';
import type {
	PlotRequest,
	PlotDataSeries,
	PlotConfig,
	PlotUpdate,
	PlotInteraction,
	PlotProviderCapabilities
} from './PlotProvider';
import { getEventBus } from '$lib/events/EventBus';

// Mock implementation for testing
class MockPlotProvider extends PlotProvider {
	initialized = false;

	getCapabilities(): PlotProviderCapabilities {
		return {
			streaming: true,
			multiSeries: true,
			interactions: ['click', 'hover'],
			exportFormats: ['png', 'csv'],
			customActions: ['reset']
		};
	}

	canHandle(request: PlotRequest): boolean {
		return request.requestType === 'mock';
	}

	async initialize(config?: PlotConfig): Promise<void> {
		this.initialized = true;
	}

	async handleRequest(request: PlotRequest): Promise<PlotDataSeries[]> {
		return [
			{
				id: 'mock-series',
				name: 'Mock Series',
				data: [
					{ x: 0, y: 1 },
					{ x: 1, y: 2 }
				],
				type: 'line',
				color: '#000000',
				visible: true
			}
		];
	}

	createComponent(series: PlotDataSeries[], config?: PlotConfig): any {
		return { series, config };
	}

	updatePlot(componentInstance: any, update: PlotUpdate): void {
		componentInstance.lastUpdate = update;
	}

	handleInteraction(interaction: PlotInteraction): void {
		this.emitEvent('interaction', interaction);
	}

	async export(
		componentInstance: any,
		format: 'png' | 'svg' | 'csv' | 'json'
	): Promise<Blob | string> {
		if (format === 'csv') {
			return 'x,y\n0,1\n1,2';
		}
		return new Blob(['mock'], { type: 'image/png' });
	}

	dispose(): void {
		this.initialized = false;
	}
}

describe('PlotProvider', () => {
	let eventBus: ReturnType<typeof getEventBus>;
	let provider: MockPlotProvider;

	beforeEach(() => {
		eventBus = getEventBus();
		provider = new MockPlotProvider('mock', 'Mock Provider', eventBus);
	});

	describe('Basic functionality', () => {
		it('should have correct ID and name', () => {
			expect(provider.getId()).toBe('mock');
			expect(provider.getName()).toBe('Mock Provider');
		});

		it('should report capabilities', () => {
			const capabilities = provider.getCapabilities();
			expect(capabilities.streaming).toBe(true);
			expect(capabilities.multiSeries).toBe(true);
			expect(capabilities.interactions).toContain('click');
			expect(capabilities.exportFormats).toContain('png');
		});

		it('should check if it can handle requests', () => {
			const mockRequest: PlotRequest = {
				id: '1',
				source: 'click',
				sourceData: {},
				requestType: 'mock'
			};

			const otherRequest: PlotRequest = {
				id: '2',
				source: 'click',
				sourceData: {},
				requestType: 'other'
			};

			expect(provider.canHandle(mockRequest)).toBe(true);
			expect(provider.canHandle(otherRequest)).toBe(false);
		});
	});

	describe('Initialization', () => {
		it('should initialize with config', async () => {
			expect(provider.initialized).toBe(false);

			await provider.initialize({
				width: 600,
				height: 400
			});

			expect(provider.initialized).toBe(true);
		});
	});

	describe('Request handling', () => {
		it('should handle plot requests', async () => {
			const request: PlotRequest = {
				id: '1',
				source: 'click',
				sourceData: {
					layerId: 'layer1',
					voxelCoord: [10, 20, 30]
				},
				requestType: 'mock'
			};

			const series = await provider.handleRequest(request);

			expect(series).toHaveLength(1);
			expect(series[0].id).toBe('mock-series');
			expect(series[0].data).toHaveLength(2);
		});
	});

	describe('Component creation', () => {
		it('should create component with series and config', () => {
			const series: PlotDataSeries[] = [
				{
					id: 'test',
					name: 'Test',
					data: [],
					visible: true
				}
			];

			const config: PlotConfig = {
				width: 800,
				height: 600
			};

			const component = provider.createComponent(series, config);

			expect(component.series).toBe(series);
			expect(component.config).toBe(config);
		});
	});

	describe('Plot updates', () => {
		it('should update plot with new data', () => {
			const component = { series: [], config: {} };
			const update: PlotUpdate = {
				seriesId: 'test',
				data: { x: 2, y: 3 },
				operation: 'append'
			};

			provider.updatePlot(component, update);

			expect(component.lastUpdate).toBe(update);
		});
	});

	describe('Event emission', () => {
		it('should emit events with provider prefix', () => {
			const spy = vi.fn();
			eventBus.on('plot.mock.interaction', spy);

			const interaction: PlotInteraction = {
				type: 'click',
				dataPoint: { x: 1, y: 2 }
			};

			provider.handleInteraction(interaction);

			expect(spy).toHaveBeenCalledWith(interaction);
		});
	});

	describe('Export functionality', () => {
		it('should export as CSV', async () => {
			const component = {};
			const result = await provider.export(component, 'csv');

			expect(result).toBe('x,y\n0,1\n1,2');
		});

		it('should export as PNG blob', async () => {
			const component = {};
			const result = await provider.export(component, 'png');

			expect(result).toBeInstanceOf(Blob);
			expect((result as Blob).type).toBe('image/png');
		});
	});

	describe('Disposal', () => {
		it('should clean up on dispose', () => {
			provider.initialized = true;
			provider.dispose();

			expect(provider.initialized).toBe(false);
		});
	});
});
