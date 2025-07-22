# Plotting Infrastructure Implementation Summary

## Overview

The plotting infrastructure provides a flexible, extensible system for creating various types of plots in response to user actions. It follows the plugin architecture pattern, allowing new plot types to be added without modifying core code.

## Key Components

### 1. **PlotProvider Interface** (`PlotProvider.ts`)

Abstract base class that all plot implementations must extend.

**Key Methods:**

- `canHandle(request)` - Determines if provider can handle a specific request
- `handleRequest(request)` - Fetches/prepares data for plotting
- `createComponent(series, config)` - Creates the Svelte component
- `updatePlot(component, update)` - Updates plot with new data
- `export(component, format)` - Exports plot in various formats

**Capabilities System:**

```typescript
interface PlotProviderCapabilities {
	streaming: boolean; // Supports real-time updates
	multiSeries: boolean; // Can display multiple data series
	interactions: string[]; // Supported interaction types
	exportFormats: string[]; // Available export formats
	customActions: string[]; // Provider-specific actions
}
```

### 2. **PlotService** (`services/PlotService.ts`)

Central service managing all plot providers and coordinating plot creation.

**Features:**

- Provider registration and lifecycle management
- Request routing to appropriate providers
- Panel creation and management
- Export functionality
- Event coordination

**Usage:**

```typescript
// Register a provider
plotService.registerProvider({
	id: 'timeseries',
	name: 'Time Series Plot',
	factory: createTimeSeriesPlotProvider
});

// Export a plot
await plotService.exportPlot(panelId, 'png');
```

### 3. **PlotStore** (`stores/plotStore.ts`)

Clean Zustand store for plot panel state management.

**State Structure:**

```typescript
interface PlotState {
	panels: Map<string, PlotPanelState>;
	activePanelId: string | null;
	panelLayouts: Map<string, LayoutConfig>;
}
```

### 4. **PlotPanel Component** (`components/panels/PlotPanel.svelte`)

Generic container component that renders any plot provider.

**Features:**

- Dynamic component mounting
- Loading and error states
- Export menu
- Panel actions (refresh, clear, close)
- Responsive layout

### 5. **PlotActionConnector** (`plotting/PlotActionConnector.ts`)

Maps user actions to plot requests using configurable mappings.

**Mapping Structure:**

```typescript
interface PlotActionMapping {
	source: string; // Event to listen for
	target: string; // Plot type to create
	transform?: (data) => PlotRequest;
	filter?: (data) => boolean;
}
```

**Builder Pattern:**

```typescript
const mappings = new PlotMappingBuilder()
	.onVoxelClick('timeseries')
	.onRoiSelection('timeseries')
	.onEvent('custom.event', 'custom-plot')
	.build();
```

## Implementation Example: TimeSeriesPlotProvider

The `TimeSeriesPlotProvider` demonstrates a complete provider implementation:

1. **Provider Class** - Extends PlotProvider with time series logic
2. **Component** - D3.js-based Svelte component for rendering
3. **Data Handling** - Fetches time series from API
4. **Interactions** - Click, hover, zoom, pan support
5. **Export** - PNG, SVG, CSV, JSON formats

## Data Flow

```
User Action → Event Bus → PlotActionConnector → PlotRequest
                                                      ↓
                                               PlotService
                                                      ↓
                                             Find Provider
                                                      ↓
                                            Provider.handleRequest()
                                                      ↓
                                            Create Component
                                                      ↓
                                              PlotPanel
                                                      ↓
                                            Render Plot
```

## Event System

### Core Events

- `plot.request` - Request to create a plot
- `plot.panel.create` - Panel needs to be created
- `plot.created` - Plot successfully created
- `plot.updated` - Plot data updated
- `plot.exported` - Plot exported

### Provider Events

Providers emit namespaced events:

- `plot.{providerId}.initialized`
- `plot.{providerId}.interaction`
- `plot.{providerId}.update`

## Usage Examples

### Basic Setup

```typescript
// In component
const plotService = await getService<PlotService>('plotService');
const connector = new PlotActionConnector({
	eventBus,
	plotService,
	mappings: DEFAULT_PLOT_MAPPINGS
});
```

### Custom Provider

```typescript
class HistogramProvider extends PlotProvider {
	async handleRequest(request: PlotRequest): Promise<PlotDataSeries[]> {
		const data = await fetchHistogramData(request.sourceData);
		return [
			{
				id: 'histogram',
				name: 'Value Distribution',
				data: data.bins.map((bin) => ({
					x: bin.center,
					y: bin.count
				})),
				type: 'bar'
			}
		];
	}
}
```

### Custom Mapping

```typescript
connector.addMapping({
	source: 'surface.vertex.clicked',
	target: 'connectivity',
	transform: (data) => ({
		sourceData: {
			vertexId: data.vertexIndex,
			surfaceId: data.surfaceId
		}
	}),
	filter: (data) => data.hasConnectivity
});
```

## Benefits

1. **Extensibility** - New plot types without core changes
2. **Decoupling** - Plots independent of data sources
3. **Reusability** - Providers work with any data matching interface
4. **Flexibility** - Custom mappings for any use case
5. **Performance** - Efficient panel reuse and batching
6. **User Experience** - Consistent plot interactions

## Testing

Comprehensive test coverage includes:

- `PlotProvider.test.ts` - Abstract interface tests
- `PlotService.test.ts` - Service functionality
- `PlotActionConnector.test.ts` - Event mapping logic

## Future Enhancements

1. **More Providers**

   - Histogram
   - Scatter plots
   - Connectivity matrices
   - Surface plots

2. **Advanced Features**

   - Plot synchronization
   - Linked brushing
   - Animation support
   - Plot templates

3. **Performance**
   - WebWorker data processing
   - Virtual scrolling for large datasets
   - GPU-accelerated rendering

## Migration Guide

To use the new plotting infrastructure:

1. Register plot providers in app initialization
2. Set up PlotActionConnector with desired mappings
3. Use PlotPanel components in layouts
4. Emit appropriate events from interactive components

The system is designed to coexist with existing plotting code, allowing gradual migration.
