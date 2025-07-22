/**
 * Tests for PlotService
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { PlotService } from './PlotService';
import type { PlotServiceConfig } from './PlotService';
import type {
	PlotProvider,
	PlotProviderRegistration,
	PlotRequest,
	PlotDataSeries,
	PlotConfig,
	PlotProviderCapabilities
} from '$lib/plotting/PlotProvider';
import { getEventBus } from '$lib/events/EventBus';
import { mockService } from '@test-utils';
import type { ConfigService } from './ConfigService';
import type { NotificationService } from './NotificationService';

// Mock PlotProvider
class MockPlotProvider implements PlotProvider {
	constructor(
		private id: string,
		private name: string,
		private eventBus: any
	) {}

	getId() {
		return this.id;
	}
	getName() {
		return this.name;
	}

	getCapabilities(): PlotProviderCapabilities {
		return {
			streaming: true,
			multiSeries: true,
			interactions: ['click', 'hover'],
			exportFormats: ['png', 'csv'],
			customActions: []
		};
	}

	canHandle(request: PlotRequest): boolean {
		return request.requestType === this.id;
	}

	async initialize(config?: PlotConfig): Promise<void> {
		// Mock initialization
	}

	async handleRequest(request: PlotRequest): Promise<PlotDataSeries[]> {
		return [
			{
				id: `${this.id}-series`,
				name: `${this.name} Series`,
				data: [
					{ x: 0, y: Math.random() },
					{ x: 1, y: Math.random() }
				],
				type: 'line',
				visible: true
			}
		];
	}

	createComponent(series: PlotDataSeries[], config?: PlotConfig): any {
		return { type: 'MockComponent', series, config };
	}

	updatePlot(componentInstance: any, update: any): void {
		componentInstance.updates = componentInstance.updates || [];
		componentInstance.updates.push(update);
	}

	handleInteraction(interaction: any): void {
		this.eventBus.emit(`plot.${this.id}.interaction`, interaction);
	}

	async export(componentInstance: any, format: string): Promise<Blob | string> {
		if (format === 'csv') {
			return 'mock,data\n1,2';
		}
		return new Blob(['mock'], { type: 'image/png' });
	}

	dispose(): void {
		// Mock disposal
	}

	protected emitEvent(event: string, data: any): void {
		this.eventBus.emit(`plot.${this.id}.${event}`, data);
	}
}

describe('PlotService', () => {
	let plotService: PlotService;
	let eventBus: ReturnType<typeof getEventBus>;
	let configService: ConfigService;
	let notificationService: NotificationService;

	beforeEach(() => {
		eventBus = getEventBus();
		configService = mockService<ConfigService>({
			get: vi.fn().mockImplementation((key, defaultValue) => {
				if (key === 'plotting.reuseExistingPanels') return true;
				if (key.startsWith('plotting.providers.')) return {};
				return defaultValue;
			})
		});
		notificationService = mockService<NotificationService>({
			success: vi.fn(),
			warning: vi.fn(),
			error: vi.fn()
		});

		const config: PlotServiceConfig = {
			eventBus,
			configService,
			notificationService
		};

		plotService = new PlotService(config);
	});

	afterEach(() => {
		plotService.dispose();
	});

	describe('Provider registration', () => {
		it('should register a provider', () => {
			const registration: PlotProviderRegistration = {
				id: 'test',
				name: 'Test Provider',
				description: 'Test provider for unit tests',
				factory: (eb) => new MockPlotProvider('test', 'Test Provider', eb)
			};

			plotService.registerProvider(registration);

			const providers = plotService.getProviders();
			expect(providers).toHaveLength(1);
			expect(providers[0].id).toBe('test');
		});

		it('should throw error when registering duplicate provider', () => {
			const registration: PlotProviderRegistration = {
				id: 'test',
				name: 'Test Provider',
				description: 'Test provider',
				factory: (eb) => new MockPlotProvider('test', 'Test Provider', eb)
			};

			plotService.registerProvider(registration);

			expect(() => {
				plotService.registerProvider(registration);
			}).toThrow("Plot provider 'test' is already registered");
		});

		it('should emit event when provider is registered', () => {
			const spy = vi.fn();
			eventBus.on('plot.provider.registered', spy);

			const registration: PlotProviderRegistration = {
				id: 'test',
				name: 'Test Provider',
				description: 'Test provider',
				factory: (eb) => new MockPlotProvider('test', 'Test Provider', eb)
			};

			plotService.registerProvider(registration);

			expect(spy).toHaveBeenCalledWith({
				providerId: 'test',
				name: 'Test Provider'
			});
		});
	});

	describe('Provider unregistration', () => {
		it('should unregister a provider', () => {
			const registration: PlotProviderRegistration = {
				id: 'test',
				name: 'Test Provider',
				description: 'Test provider',
				factory: (eb) => new MockPlotProvider('test', 'Test Provider', eb)
			};

			plotService.registerProvider(registration);
			expect(plotService.getProviders()).toHaveLength(1);

			plotService.unregisterProvider('test');
			expect(plotService.getProviders()).toHaveLength(0);
		});

		it('should emit event when provider is unregistered', () => {
			const spy = vi.fn();
			eventBus.on('plot.provider.unregistered', spy);

			const registration: PlotProviderRegistration = {
				id: 'test',
				name: 'Test Provider',
				description: 'Test provider',
				factory: (eb) => new MockPlotProvider('test', 'Test Provider', eb)
			};

			plotService.registerProvider(registration);
			plotService.unregisterProvider('test');

			expect(spy).toHaveBeenCalledWith({ providerId: 'test' });
		});
	});

	describe('Plot request handling', () => {
		beforeEach(() => {
			// Register test provider
			const registration: PlotProviderRegistration = {
				id: 'timeseries',
				name: 'Time Series',
				description: 'Time series provider',
				factory: (eb) => new MockPlotProvider('timeseries', 'Time Series', eb)
			};

			plotService.registerProvider(registration);
		});

		it('should handle plot request and create panel', async () => {
			const panelCreateSpy = vi.fn();
			const plotCreatedSpy = vi.fn();

			eventBus.on('plot.panel.create', panelCreateSpy);
			eventBus.on('plot.created', plotCreatedSpy);

			const request: PlotRequest = {
				id: 'req-1',
				source: 'click',
				sourceData: {
					layerId: 'layer1',
					voxelCoord: [10, 20, 30]
				},
				requestType: 'timeseries'
			};

			// Emit plot request
			eventBus.emit('plot.request', request);

			// Wait for async processing
			await new Promise((resolve) => setTimeout(resolve, 10));

			expect(panelCreateSpy).toHaveBeenCalled();
			expect(plotCreatedSpy).toHaveBeenCalled();

			const createCall = panelCreateSpy.mock.calls[0][0];
			expect(createCall.providerId).toBe('timeseries');
			expect(createCall.component).toBeDefined();
		});

		it('should show warning when no provider can handle request', async () => {
			const request: PlotRequest = {
				id: 'req-1',
				source: 'click',
				sourceData: {},
				requestType: 'unknown'
			};

			eventBus.emit('plot.request', request);

			await new Promise((resolve) => setTimeout(resolve, 10));

			expect(notificationService.warning).toHaveBeenCalledWith(
				'No plot provider available for this request'
			);
		});

		it('should emit failure event on error', async () => {
			const failureSpy = vi.fn();
			eventBus.on('plot.request.failed', failureSpy);

			// Register provider that throws error
			const errorRegistration: PlotProviderRegistration = {
				id: 'error',
				name: 'Error Provider',
				description: 'Provider that throws errors',
				factory: (eb) => {
					const provider = new MockPlotProvider('error', 'Error', eb);
					provider.handleRequest = async () => {
						throw new Error('Test error');
					};
					return provider;
				}
			};

			plotService.registerProvider(errorRegistration);

			const request: PlotRequest = {
				id: 'req-1',
				source: 'click',
				sourceData: {},
				requestType: 'error'
			};

			eventBus.emit('plot.request', request);

			await new Promise((resolve) => setTimeout(resolve, 10));

			expect(failureSpy).toHaveBeenCalled();
			expect(notificationService.error).toHaveBeenCalled();
		});
	});

	describe('Plot export', () => {
		it('should export plot as CSV', async () => {
			// Register provider
			const registration: PlotProviderRegistration = {
				id: 'test',
				name: 'Test',
				description: 'Test provider',
				factory: (eb) => new MockPlotProvider('test', 'Test', eb)
			};

			plotService.registerProvider(registration);

			// Create a plot
			const request: PlotRequest = {
				id: 'req-1',
				source: 'click',
				sourceData: {},
				requestType: 'test'
			};

			eventBus.emit('plot.request', request);
			await new Promise((resolve) => setTimeout(resolve, 10));

			// Get panel ID from created plots
			const plots = plotService.getActivePlots();
			expect(plots).toHaveLength(1);
			const panelId = plots[0].id;

			// Mock document methods
			const createElementSpy = vi.spyOn(document, 'createElement');
			const clickSpy = vi.fn();
			createElementSpy.mockReturnValue({
				click: clickSpy,
				href: '',
				download: ''
			} as any);

			global.URL.createObjectURL = vi.fn().mockReturnValue('blob:mock');
			global.URL.revokeObjectURL = vi.fn();

			// Export plot
			await plotService.exportPlot(panelId, 'csv');

			expect(notificationService.success).toHaveBeenCalledWith('Plot exported as CSV');
			expect(clickSpy).toHaveBeenCalled();
		});

		it('should throw error for invalid panel ID', async () => {
			await expect(plotService.exportPlot('invalid-id', 'png')).rejects.toThrow(
				"Plot panel 'invalid-id' not found"
			);
		});
	});

	describe('Plot lifecycle', () => {
		it('should close plot and clean up resources', async () => {
			// Register provider
			const registration: PlotProviderRegistration = {
				id: 'test',
				name: 'Test',
				description: 'Test provider',
				factory: (eb) => new MockPlotProvider('test', 'Test', eb)
			};

			plotService.registerProvider(registration);

			// Create a plot
			const request: PlotRequest = {
				id: 'req-1',
				source: 'click',
				sourceData: {},
				requestType: 'test'
			};

			eventBus.emit('plot.request', request);
			await new Promise((resolve) => setTimeout(resolve, 10));

			// Verify plot exists
			let plots = plotService.getActivePlots();
			expect(plots).toHaveLength(1);
			const panelId = plots[0].id;

			// Close plot
			const closedSpy = vi.fn();
			eventBus.on('plot.closed', closedSpy);

			plotService.closePlot(panelId);

			// Verify plot is removed
			plots = plotService.getActivePlots();
			expect(plots).toHaveLength(0);
			expect(closedSpy).toHaveBeenCalledWith({ panelId });
		});

		it('should handle panel close event', async () => {
			// Register provider
			const registration: PlotProviderRegistration = {
				id: 'test',
				name: 'Test',
				description: 'Test provider',
				factory: (eb) => new MockPlotProvider('test', 'Test', eb)
			};

			plotService.registerProvider(registration);

			// Create a plot
			const request: PlotRequest = {
				id: 'req-1',
				source: 'click',
				sourceData: {},
				requestType: 'test'
			};

			eventBus.emit('plot.request', request);
			await new Promise((resolve) => setTimeout(resolve, 10));

			const plots = plotService.getActivePlots();
			const panelId = plots[0].id;

			// Emit panel close event
			eventBus.emit('panel.closed', { panelId });

			// Verify plot is removed
			expect(plotService.getActivePlots()).toHaveLength(0);
		});
	});

	describe('Service disposal', () => {
		it('should dispose all providers and plots', async () => {
			// Register provider
			const registration: PlotProviderRegistration = {
				id: 'test',
				name: 'Test',
				description: 'Test provider',
				factory: (eb) => new MockPlotProvider('test', 'Test', eb)
			};

			plotService.registerProvider(registration);

			// Create a plot
			const request: PlotRequest = {
				id: 'req-1',
				source: 'click',
				sourceData: {},
				requestType: 'test'
			};

			eventBus.emit('plot.request', request);
			await new Promise((resolve) => setTimeout(resolve, 10));

			// Dispose service
			plotService.dispose();

			// Verify everything is cleaned up
			expect(plotService.getProviders()).toHaveLength(0);
			expect(plotService.getActivePlots()).toHaveLength(0);
		});
	});
});
