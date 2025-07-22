/**
 * Tests for PlotActionConnector
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
	PlotActionConnector,
	PlotMappingBuilder,
	DEFAULT_PLOT_MAPPINGS
} from './PlotActionConnector';
import type { PlotActionMapping } from './PlotActionConnector';
import { getEventBus } from '$lib/events/EventBus';
import { mockService } from '@test-utils';
import type { PlotService } from '$lib/services/PlotService';

describe('PlotActionConnector', () => {
	let eventBus: ReturnType<typeof getEventBus>;
	let plotService: PlotService;
	let connector: PlotActionConnector;

	beforeEach(() => {
		eventBus = getEventBus();
		plotService = mockService<PlotService>({});

		connector = new PlotActionConnector({
			eventBus,
			plotService
		});
	});

	afterEach(() => {
		connector.dispose();
	});

	describe('Mapping management', () => {
		it('should add mappings', () => {
			const mapping: PlotActionMapping = {
				source: 'test.event',
				target: 'test-plot'
			};

			connector.addMapping(mapping);

			const mappings = connector.getMappings();
			expect(mappings).toHaveLength(1);
			expect(mappings[0]).toEqual(mapping);
		});

		it('should add multiple mappings', () => {
			const mappings: PlotActionMapping[] = [
				{ source: 'event1', target: 'plot1' },
				{ source: 'event2', target: 'plot2' }
			];

			connector.addMappings(mappings);

			expect(connector.getMappings()).toHaveLength(2);
		});

		it('should remove mappings by source', () => {
			const mappings: PlotActionMapping[] = [
				{ source: 'event1', target: 'plot1' },
				{ source: 'event2', target: 'plot2' },
				{ source: 'event1', target: 'plot3' }
			];

			connector.addMappings(mappings);
			connector.removeMappings('event1');

			const remaining = connector.getMappings();
			expect(remaining).toHaveLength(1);
			expect(remaining[0].source).toBe('event2');
		});

		it('should clear all mappings', () => {
			const mappings: PlotActionMapping[] = [
				{ source: 'event1', target: 'plot1' },
				{ source: 'event2', target: 'plot2' }
			];

			connector.addMappings(mappings);
			connector.clearMappings();

			expect(connector.getMappings()).toHaveLength(0);
		});
	});

	describe('Event handling', () => {
		it('should create plot request from event', async () => {
			const plotRequestSpy = vi.fn();
			eventBus.on('plot.request', plotRequestSpy);

			const mapping: PlotActionMapping = {
				source: 'viewer.voxel.clicked',
				target: 'timeseries'
			};

			connector.addMapping(mapping);

			// Emit event
			eventBus.emit('viewer.voxel.clicked', {
				layerId: 'layer1',
				voxelCoord: [10, 20, 30]
			});

			// Wait for async processing
			await new Promise((resolve) => setTimeout(resolve, 0));

			expect(plotRequestSpy).toHaveBeenCalled();
			const request = plotRequestSpy.mock.calls[0][0];
			expect(request.source).toBe('click');
			expect(request.requestType).toBe('timeseries');
			expect(request.sourceData.layerId).toBe('layer1');
		});

		it('should apply transform function', async () => {
			const plotRequestSpy = vi.fn();
			eventBus.on('plot.request', plotRequestSpy);

			const mapping: PlotActionMapping = {
				source: 'test.event',
				target: 'test-plot',
				transform: (data) => ({
					sourceData: {
						transformed: true,
						original: data.value
					}
				})
			};

			connector.addMapping(mapping);

			eventBus.emit('test.event', { value: 42 });

			await new Promise((resolve) => setTimeout(resolve, 0));

			const request = plotRequestSpy.mock.calls[0][0];
			expect(request.sourceData.transformed).toBe(true);
			expect(request.sourceData.original).toBe(42);
		});

		it('should apply filter function', async () => {
			const plotRequestSpy = vi.fn();
			eventBus.on('plot.request', plotRequestSpy);

			const mapping: PlotActionMapping = {
				source: 'test.event',
				target: 'test-plot',
				filter: (data) => data.shouldPlot === true
			};

			connector.addMapping(mapping);

			// Event that should be filtered out
			eventBus.emit('test.event', { shouldPlot: false });
			await new Promise((resolve) => setTimeout(resolve, 0));
			expect(plotRequestSpy).not.toHaveBeenCalled();

			// Event that should pass filter
			eventBus.emit('test.event', { shouldPlot: true });
			await new Promise((resolve) => setTimeout(resolve, 0));
			expect(plotRequestSpy).toHaveBeenCalled();
		});

		it('should handle multiple mappings for same event', async () => {
			const plotRequestSpy = vi.fn();
			eventBus.on('plot.request', plotRequestSpy);

			const mappings: PlotActionMapping[] = [
				{
					source: 'multi.event',
					target: 'plot1',
					filter: (data) => data.type === 'A'
				},
				{
					source: 'multi.event',
					target: 'plot2',
					filter: (data) => data.type === 'B'
				}
			];

			connector.addMappings(mappings);

			eventBus.emit('multi.event', { type: 'A' });
			await new Promise((resolve) => setTimeout(resolve, 0));

			expect(plotRequestSpy).toHaveBeenCalledTimes(1);
			expect(plotRequestSpy.mock.calls[0][0].requestType).toBe('plot1');
		});
	});

	describe('Source type inference', () => {
		it('should infer click source from event name', async () => {
			const plotRequestSpy = vi.fn();
			eventBus.on('plot.request', plotRequestSpy);

			const mappings: PlotActionMapping[] = [
				{ source: 'something.click', target: 'plot' },
				{ source: 'viewer.clicked', target: 'plot' },
				{ source: 'on.select', target: 'plot' },
				{ source: 'item.hover', target: 'plot' },
				{ source: 'plot.command', target: 'plot' }
			];

			connector.addMappings(mappings);

			// Test each mapping
			for (const mapping of mappings) {
				eventBus.emit(mapping.source, {});
			}

			await new Promise((resolve) => setTimeout(resolve, 10));

			const requests = plotRequestSpy.mock.calls.map((call) => call[0]);
			expect(requests[0].source).toBe('click');
			expect(requests[1].source).toBe('click');
			expect(requests[2].source).toBe('selection');
			expect(requests[3].source).toBe('hover');
			expect(requests[4].source).toBe('command');
		});
	});

	describe('PlotMappingBuilder', () => {
		it('should build voxel click mapping', () => {
			const mappings = new PlotMappingBuilder().onVoxelClick('timeseries').build();

			expect(mappings).toHaveLength(1);
			expect(mappings[0].source).toBe('viewer.voxel.clicked');
			expect(mappings[0].target).toBe('timeseries');
			expect(mappings[0].transform).toBeDefined();
		});

		it('should build ROI selection mapping', () => {
			const mappings = new PlotMappingBuilder().onRoiSelection('histogram').build();

			expect(mappings).toHaveLength(1);
			expect(mappings[0].source).toBe('annotation.roi.selected');
			expect(mappings[0].target).toBe('histogram');
		});

		it('should build custom event mapping', () => {
			const transform = (data: any) => ({ custom: true });
			const filter = (data: any) => data.enabled;

			const mappings = new PlotMappingBuilder()
				.onEvent('custom.event', 'custom-plot', transform, filter)
				.build();

			expect(mappings).toHaveLength(1);
			expect(mappings[0].source).toBe('custom.event');
			expect(mappings[0].target).toBe('custom-plot');
			expect(mappings[0].transform).toBe(transform);
			expect(mappings[0].filter).toBe(filter);
		});

		it('should chain multiple mappings', () => {
			const mappings = new PlotMappingBuilder()
				.onVoxelClick()
				.onRoiSelection()
				.onEvent('custom', 'custom-plot')
				.build();

			expect(mappings).toHaveLength(3);
		});
	});

	describe('Default mappings', () => {
		it('should include standard mappings', () => {
			expect(DEFAULT_PLOT_MAPPINGS).toBeDefined();
			expect(DEFAULT_PLOT_MAPPINGS.length).toBeGreaterThan(0);

			// Check for expected mappings
			const sources = DEFAULT_PLOT_MAPPINGS.map((m) => m.source);
			expect(sources).toContain('viewer.voxel.clicked');
			expect(sources).toContain('annotation.roi.selected');
			expect(sources).toContain('layer.histogram.requested');
		});

		it('should work with default mappings', async () => {
			const plotRequestSpy = vi.fn();
			eventBus.on('plot.request', plotRequestSpy);

			connector.addMappings(DEFAULT_PLOT_MAPPINGS);

			// Test voxel click
			eventBus.emit('viewer.voxel.clicked', {
				layerId: 'layer1',
				volumeId: 'vol1',
				worldCoord: [10, 20, 30],
				voxelCoord: [50, 60, 70],
				value: 100
			});

			await new Promise((resolve) => setTimeout(resolve, 0));

			expect(plotRequestSpy).toHaveBeenCalled();
			const request = plotRequestSpy.mock.calls[0][0];
			expect(request.requestType).toBe('timeseries');
			expect(request.sourceData.worldCoord).toEqual([10, 20, 30]);
		});
	});

	describe('Disposal', () => {
		it('should unsubscribe from all events on dispose', () => {
			const mapping: PlotActionMapping = {
				source: 'test.event',
				target: 'test-plot'
			};

			connector.addMapping(mapping);

			const plotRequestSpy = vi.fn();
			eventBus.on('plot.request', plotRequestSpy);

			// Dispose connector
			connector.dispose();

			// Event should not trigger after disposal
			eventBus.emit('test.event', {});
			expect(plotRequestSpy).not.toHaveBeenCalled();

			// Mappings should be cleared
			expect(connector.getMappings()).toHaveLength(0);
		});
	});
});
