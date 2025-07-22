/**
 * Plot Service
 * Manages plot providers, routes requests, and coordinates plotting functionality
 */
import type { EventBus } from '$lib/events/EventBus';
import type { ConfigService } from './ConfigService';
import type { NotificationService } from './NotificationService';
import type {
	PlotProvider,
	PlotProviderRegistration,
	PlotRequest,
	PlotDataSeries,
	PlotConfig,
	PlotUpdate,
	PlotInteraction,
	PlotPanelState
} from '$lib/plotting/PlotProvider';
import { nanoid } from 'nanoid';

export interface PlotServiceConfig {
	eventBus: EventBus;
	configService: ConfigService;
	notificationService: NotificationService;
}

export interface PlotPanelOptions {
	providerId?: string;
	title?: string;
	config?: PlotConfig;
	dockLocation?: 'left' | 'right' | 'bottom' | 'float';
}

export interface ActivePlot {
	panelId: string;
	provider: PlotProvider;
	component: any;
	state: PlotPanelState;
	subscriptions: (() => void)[];
}

export class PlotService {
	private providers = new Map<string, PlotProviderRegistration>();
	private activeProviders = new Map<string, PlotProvider>();
	private activePlots = new Map<string, ActivePlot>();
	private eventBus: EventBus;
	private configService: ConfigService;
	private notificationService: NotificationService;
	private eventUnsubscribes: Array<() => void> = [];

	constructor(config: PlotServiceConfig) {
		this.eventBus = config.eventBus;
		this.configService = config.configService;
		this.notificationService = config.notificationService;

		this.setupEventListeners();
	}

	private setupEventListeners(): void {
		// Listen for plot requests from various sources
		this.eventUnsubscribes.push(
			this.eventBus.on('plot.request', this.handlePlotRequest.bind(this))
		);

		// Listen for plot updates
		this.eventUnsubscribes.push(
			this.eventBus.on('plot.update', this.handlePlotUpdate.bind(this))
		);

		// Listen for plot interactions
		this.eventUnsubscribes.push(
			this.eventBus.on('plot.interaction', this.handlePlotInteraction.bind(this))
		);

		// Listen for panel close events
		this.eventUnsubscribes.push(
			this.eventBus.on('panel.closed', ({ panelId }) => {
				this.closePlot(panelId);
			})
		);
	}

	/**
	 * Register a plot provider
	 */
	registerProvider(registration: PlotProviderRegistration): void {
		if (this.providers.has(registration.id)) {
			throw new Error(`Plot provider '${registration.id}' is already registered`);
		}

		this.providers.set(registration.id, registration);

		this.eventBus.emit('plot.provider.registered', {
			providerId: registration.id,
			name: registration.name
		});
	}

	/**
	 * Unregister a plot provider
	 */
	unregisterProvider(providerId: string): void {
		const registration = this.providers.get(providerId);
		if (!registration) return;

		// Clean up any active instances
		if (this.activeProviders.has(providerId)) {
			const provider = this.activeProviders.get(providerId)!;
			provider.dispose();
			this.activeProviders.delete(providerId);
		}

		this.providers.delete(providerId);

		this.eventBus.emit('plot.provider.unregistered', { providerId });
	}

	/**
	 * Get all registered providers
	 */
	getProviders(): PlotProviderRegistration[] {
		return Array.from(this.providers.values());
	}

	/**
	 * Get a specific provider instance
	 */
	private async getProviderInstance(providerId: string): Promise<PlotProvider> {
		// Check if already instantiated
		if (this.activeProviders.has(providerId)) {
			return this.activeProviders.get(providerId)!;
		}

		// Get registration
		const registration = this.providers.get(providerId);
		if (!registration) {
			throw new Error(`Plot provider '${providerId}' not found`);
		}

		// Create instance
		const provider = registration.factory(this.eventBus, registration.config);

		// Initialize
		const defaultConfig = this.configService.get(`plotting.providers.${providerId}`, {});
		await provider.initialize(defaultConfig);

		// Cache instance
		this.activeProviders.set(providerId, provider);

		return provider;
	}

	/**
	 * Handle plot request
	 */
	private async handlePlotRequest(request: PlotRequest): Promise<void> {
		try {
			// Find suitable provider
			const provider = await this.findProviderForRequest(request);
			if (!provider) {
				this.notificationService.warning('No plot provider available for this request');
				return;
			}

			// Check if we should reuse existing panel
			const existingPlot = this.findExistingPlot(request);
			if (existingPlot && this.configService.get('plotting.reuseExistingPanels', true)) {
				// Update existing plot
				await this.updateExistingPlot(existingPlot, request);
			} else {
				// Create new plot
				await this.createNewPlot(provider, request);
			}
		} catch (error) {
			console.error('Plot request failed:', error);
			this.notificationService.error('Failed to create plot', { error });

			this.eventBus.emit('plot.request.failed', {
				request,
				error
			});
		}
	}

	/**
	 * Find a provider that can handle the request
	 */
	private async findProviderForRequest(request: PlotRequest): Promise<PlotProvider | null> {
		// Check if specific provider requested
		if (request.targetPanelId) {
			const plot = this.activePlots.get(request.targetPanelId);
			if (plot) {
				return plot.provider;
			}
		}

		// Find first provider that can handle the request
		for (const registration of this.providers.values()) {
			const provider = await this.getProviderInstance(registration.id);
			if (provider.canHandle(request)) {
				return provider;
			}
		}

		return null;
	}

	/**
	 * Find existing plot that matches request criteria
	 */
	private findExistingPlot(request: PlotRequest): ActivePlot | null {
		// If specific panel targeted, return it
		if (request.targetPanelId) {
			return this.activePlots.get(request.targetPanelId) || null;
		}

		// Find plot with same source and type
		for (const plot of this.activePlots.values()) {
			if (plot.state.providerId === request.requestType) {
				// Additional matching logic based on source
				if (request.source === 'click' && request.sourceData.layerId) {
					const hasMatchingSeries = plot.state.series.some(
						(s) => s.metadata?.layerId === request.sourceData.layerId
					);
					if (hasMatchingSeries) {
						return plot;
					}
				}
			}
		}

		return null;
	}

	/**
	 * Create a new plot
	 */
	private async createNewPlot(provider: PlotProvider, request: PlotRequest): Promise<void> {
		const panelId = nanoid();

		// Create initial state
		const state: PlotPanelState = {
			id: panelId,
			providerId: provider.getId(),
			series: [],
			config: this.getDefaultConfig(provider.getId()),
			isLoading: true
		};

		try {
			// Get data from provider
			const series = await provider.handleRequest(request);
			state.series = series;
			state.isLoading = false;

			// Create component
			const component = provider.createComponent(series, state.config);

			// Create active plot entry
			const activePlot: ActivePlot = {
				panelId,
				provider,
				component,
				state,
				subscriptions: []
			};

			// Store active plot
			this.activePlots.set(panelId, activePlot);

			// Emit event to create panel
			this.eventBus.emit('plot.panel.create', {
				panelId,
				providerId: provider.getId(),
				title: this.generatePlotTitle(request, series),
				component,
				config: state.config
			});

			// Subscribe to panel events
			this.subscribeToPlotEvents(activePlot);

			this.eventBus.emit('plot.created', {
				panelId,
				providerId: provider.getId(),
				request
			});
		} catch (error) {
			state.isLoading = false;
			state.error = error as Error;

			this.eventBus.emit('plot.create.failed', {
				panelId,
				request,
				error
			});

			throw error;
		}
	}

	/**
	 * Update existing plot with new request
	 */
	private async updateExistingPlot(plot: ActivePlot, request: PlotRequest): Promise<void> {
		plot.state.isLoading = true;

		try {
			// Get new data
			const newSeries = await plot.provider.handleRequest(request);

			// Merge or replace series based on provider capabilities
			const capabilities = plot.provider.getCapabilities();
			if (capabilities.multiSeries) {
				// Add new series
				plot.state.series = [...plot.state.series, ...newSeries];
			} else {
				// Replace series
				plot.state.series = newSeries;
			}

			plot.state.isLoading = false;

			// Update component
			// Note: Component should be reactive to state changes
			this.eventBus.emit('plot.updated', {
				panelId: plot.panelId,
				series: plot.state.series
			});
		} catch (error) {
			plot.state.isLoading = false;
			plot.state.error = error as Error;

			this.eventBus.emit('plot.update.failed', {
				panelId: plot.panelId,
				request,
				error
			});
		}
	}

	/**
	 * Handle plot update (streaming data)
	 */
	private async handlePlotUpdate(update: PlotUpdate & { panelId: string }): Promise<void> {
		const plot = this.activePlots.get(update.panelId);
		if (!plot) return;

		try {
			plot.provider.updatePlot(plot.component, update);

			this.eventBus.emit('plot.data.updated', {
				panelId: update.panelId,
				seriesId: update.seriesId,
				operation: update.operation
			});
		} catch (error) {
			console.error('Plot update failed:', error);
			this.eventBus.emit('plot.update.failed', {
				panelId: update.panelId,
				update,
				error
			});
		}
	}

	/**
	 * Handle plot interaction
	 */
	private async handlePlotInteraction(
		interaction: PlotInteraction & { panelId: string }
	): Promise<void> {
		const plot = this.activePlots.get(interaction.panelId);
		if (!plot) return;

		try {
			plot.provider.handleInteraction(interaction);

			// Emit interaction event for other systems to respond
			this.eventBus.emit('plot.interaction.handled', {
				panelId: interaction.panelId,
				interaction
			});
		} catch (error) {
			console.error('Plot interaction failed:', error);
		}
	}

	/**
	 * Export plot
	 */
	async exportPlot(panelId: string, format: 'png' | 'svg' | 'csv' | 'json'): Promise<void> {
		const plot = this.activePlots.get(panelId);
		if (!plot) {
			throw new Error(`Plot panel '${panelId}' not found`);
		}

		try {
			const result = await plot.provider.export(plot.component, format);

			// Create download
			let blob: Blob;
			let filename: string;

			if (typeof result === 'string') {
				blob = new Blob([result], { type: this.getMimeType(format) });
			} else {
				blob = result;
			}

			filename = `plot-${panelId}-${Date.now()}.${format}`;

			// Trigger download
			const url = URL.createObjectURL(blob);
			const a = document.createElement('a');
			a.href = url;
			a.download = filename;
			a.click();
			URL.revokeObjectURL(url);

			this.notificationService.success(`Plot exported as ${format.toUpperCase()}`);

			this.eventBus.emit('plot.exported', {
				panelId,
				format,
				filename
			});
		} catch (error) {
			console.error('Plot export failed:', error);
			this.notificationService.error('Failed to export plot', { error });
		}
	}

	/**
	 * Close plot panel
	 */
	closePlot(panelId: string): void {
		const plot = this.activePlots.get(panelId);
		if (!plot) return;

		// Unsubscribe from events
		plot.subscriptions.forEach((unsubscribe) => unsubscribe());

		// Let provider clean up
		try {
			// Provider might need to clean up component resources
			if (plot.provider.dispose) {
				plot.provider.dispose();
			}
		} catch (error) {
			console.error('Error disposing plot provider:', error);
		}

		// Remove from active plots
		this.activePlots.delete(panelId);

		this.eventBus.emit('plot.closed', { panelId });
	}

	/**
	 * Get active plots
	 */
	getActivePlots(): PlotPanelState[] {
		return Array.from(this.activePlots.values()).map((plot) => plot.state);
	}

	/**
	 * Subscribe to plot-specific events
	 */
	private subscribeToPlotEvents(plot: ActivePlot): void {
		// Subscribe to plot-specific interactions
		const interactionSub = this.eventBus.on(
			`plot.${plot.state.providerId}.interaction`,
			(interaction) => {
				this.handlePlotInteraction({ ...interaction, panelId: plot.panelId });
			}
		);

		// Subscribe to plot-specific updates
		const updateSub = this.eventBus.on(`plot.${plot.state.providerId}.update`, (update) => {
			this.handlePlotUpdate({ ...update, panelId: plot.panelId });
		});

		plot.subscriptions.push(interactionSub, updateSub);
	}

	/**
	 * Generate plot title from request and data
	 */
	private generatePlotTitle(request: PlotRequest, series: PlotDataSeries[]): string {
		// Provider-specific title generation
		if (series.length > 0 && series[0].name) {
			return series[0].name;
		}

		// Default based on request source
		switch (request.source) {
			case 'click':
				return `Plot at (${request.sourceData.worldCoord?.map((v) => v.toFixed(1)).join(', ')})`;
			case 'selection':
				return 'Selection Plot';
			case 'command':
				return 'Plot';
			default:
				return 'Plot';
		}
	}

	/**
	 * Get default config for provider
	 */
	private getDefaultConfig(providerId: string): PlotConfig {
		const defaults: PlotConfig = {
			width: 400,
			height: 300,
			margin: { top: 20, right: 20, bottom: 40, left: 50 },
			theme: 'auto',
			interactive: true,
			exportable: true
		};

		// Merge with provider-specific defaults
		const providerDefaults = this.configService.get(
			`plotting.providers.${providerId}.defaults`,
			{}
		);

		return { ...defaults, ...providerDefaults };
	}

	/**
	 * Get MIME type for export format
	 */
	private getMimeType(format: string): string {
		switch (format) {
			case 'png':
				return 'image/png';
			case 'svg':
				return 'image/svg+xml';
			case 'csv':
				return 'text/csv';
			case 'json':
				return 'application/json';
			default:
				return 'application/octet-stream';
		}
	}

	/**
	 * Dispose service
	 */
	dispose(): void {
		// Clean up event listeners
		this.eventUnsubscribes.forEach(unsubscribe => unsubscribe());
		this.eventUnsubscribes = [];

		// Close all active plots
		for (const panelId of this.activePlots.keys()) {
			this.closePlot(panelId);
		}

		// Dispose all active providers
		for (const provider of this.activeProviders.values()) {
			provider.dispose();
		}

		this.activeProviders.clear();
		this.providers.clear();
	}
}
