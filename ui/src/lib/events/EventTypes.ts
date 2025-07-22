/**
 * Type-safe event payload definitions
 * Ensures all events have properly typed payloads
 */

import type { LayerSpec, VolumeLayerGpuInfo } from '@brainflow/api';
import type { LayerEntry } from '$lib/stores/layerStore';
import type { ViewType } from '$lib/types/ViewType';
import type { PluginManifest, PluginPerformanceStats } from '$lib/plugins/types';

// Layer Events
export interface LayerEvents {
	'layer.add.requested': {
		layerId: string;
		spec: LayerSpec;
	};
	'layer.added': {
		layerEntry: LayerEntry;
	};
	'layer.update.requested': {
		layerId: string;
		updates: Partial<LayerEntry>;
	};
	'layer.updated': {
		layerId: string;
		updates: Partial<LayerEntry>;
	};
	'layer.remove.requested': {
		layerId: string;
	};
	'layer.removed': {
		layerId: string;
	};
	'layer.selected': {
		layerId: string;
	};
	'layer.setactive.requested': {
		layerId: string | null;
	};
	'layer.opacity.changed': {
		layerId: string;
		opacity: number;
	};
	'layer.colormap.changed': {
		layerId: string;
		colormap: string;
	};
	'layer.windowlevel.changed': {
		layerId: string;
		window: number;
		level: number;
	};
	'layer.threshold.changed': {
		layerId: string;
		threshold: {
			low: number;
			high: number;
			enabled: boolean;
		};
	};
	'layer.gpu.request.error': {
		layerId: string;
		error: Error;
	};
	'layer.gpu.released': {
		layerId: string;
	};
	'layer.gpu.release.error': {
		layerId: string;
		error: Error;
	};
}

// GPU Events
export interface GpuEvents {
	'gpu.initialized': {
		viewType: ViewType;
	};
	'gpu.error': {
		viewType: ViewType;
		error: Error;
	};
	'gpu.rendertarget.created': {
		viewType: ViewType;
		size: { width: number; height: number };
	};
	'gpu.layer.added': {
		layerId: string;
		viewType: ViewType;
	};
	'gpu.layer.error': {
		layerId: string;
		viewType: ViewType;
		error: Error;
	};
	'gpu.resources.requested': {
		layerId: string;
		spec: LayerSpec;
	};
	'gpu.resources.ready': {
		layerId: string;
		info: VolumeLayerGpuInfo;
	};
	'gpu.resources.error': {
		layerId: string;
		error: Error;
	};
	'gpu.resources.released': {
		layerId: string;
	};
}

// Volume Events
export interface VolumeEvents {
	'volume.load.requested': {
		path: string;
	};
	'volume.loaded': {
		volumeId: string;
		info: any; // TODO: Create VolumeInfo type
	};
	'volume.load.error': {
		path: string;
		error: Error;
	};
	'volumeview.layer.selected': {
		layerId: string;
	};
	'volumeview.viewport.changed': {
		viewType: ViewType;
		viewport: {
			scale: number;
			offset: [number, number];
		};
	};
}

// Mouse/Interaction Events
export interface InteractionEvents {
	'mouse.worldcoord': {
		coord: [number, number, number] | null;
		viewType: ViewType;
	};
	'crosshair.changed': {
		worldCoord: [number, number, number];
	};
}

// Notification Events
export interface NotificationEvents {
	'notification.show': {
		type: 'success' | 'error' | 'warning' | 'info';
		message: string;
		details?: string;
	};
	'notification.clear': {
		id: string;
	};
}

// System Events
export interface SystemEvents {
	'storeservice.bridge.ready': void;
	'system.initialized': void;
	'system.error': {
		error: Error;
		context?: string;
	};
}

// Plugin Events
export interface PluginEvents {
	'plugin.loading': {
		pluginId: string;
	};
	'plugin.loaded': {
		pluginId: string;
		manifest: PluginManifest;
	};
	'plugin.initializing': {
		pluginId: string;
	};
	'plugin.activated': {
		pluginId: string;
	};
	'plugin.deactivated': {
		pluginId: string;
	};
	'plugin.error': {
		pluginId: string;
		error: Error;
	};
	'plugin.unloaded': {
		pluginId: string;
	};
	'plugin.performance.warning': {
		pluginId: string;
		message: string;
		stats?: PluginPerformanceStats;
	};
	'plugin.circuit.opened': {
		pluginId: string;
	};
	'plugin.circuit.closed': {
		pluginId: string;
	};
	'plugin.circuit.reset': {
		pluginId: string;
	};
	'plugin.message': {
		channel: string;
		data: any;
		metadata: {
			senderId: string;
			timestamp: Date;
			channel: string;
		};
	};

	// UI Plugin Events
	'ui.component.register': {
		name: string;
		component: any;
		pluginId: string;
	};
	'ui.component.unregister': {
		name: string;
		pluginId: string;
	};
	'ui.panel.create': {
		id: string;
		pluginId: string;
		config: any;
	};
	'ui.panel.destroy': {
		id: string;
		pluginId: string;
	};
	'ui.panel.show': {
		id: string;
	};
	'ui.panel.hide': {
		id: string;
	};
	'ui.panel.close': {
		id: string;
	};
	'ui.panel.resize': {
		id: string;
		size: { width?: number; height?: number };
	};
	'ui.menu.add': {
		label: string;
		icon?: string;
		action: () => void;
		pluginId: string;
	};
}

// Combined event map
export interface BrainflowEvents
	extends LayerEvents,
		GpuEvents,
		VolumeEvents,
		InteractionEvents,
		NotificationEvents,
		SystemEvents,
		PluginEvents {}

// Type helper for event names
export type BrainflowEventName = keyof BrainflowEvents;

// Type helper for event payloads
export type BrainflowEventPayload<T extends BrainflowEventName> = BrainflowEvents[T];
