/**
 * Header Actions Configuration for Golden Layout panels
 * Maps component types to their custom header actions
 */

import { Plus, Download, Upload, Search, RefreshCw, Filter } from 'lucide-svelte';
import { getEventBus } from '$lib/events/EventBus';

export interface HeaderAction {
	label: string;
	icon?: any;
	onclick: () => void;
	className?: string;
}

export interface HeaderActionConfig {
	componentType: string;
	actions: HeaderAction[];
	menuItems?: HeaderAction[];
}

/**
 * Define header actions for each component type
 */
export const headerActionConfigs: HeaderActionConfig[] = [
	{
		componentType: 'layer-panel',
		actions: [],
		menuItems: [
			{
				label: 'Add Layer',
				icon: Plus,
				onclick: () => getEventBus().emit('layer.add.request')
			},
			{
				label: 'Export Layers',
				icon: Download,
				onclick: () => getEventBus().emit('layers.export.request')
			},
			{
				label: 'Import Layers',
				icon: Upload,
				onclick: () => getEventBus().emit('layers.import.request')
			}
		]
	},
	{
		componentType: 'tree-browser',
		actions: [
			{
				label: 'Search',
				icon: Search,
				onclick: () => getEventBus().emit('filebrowser.search.toggle'),
				className: 'action-button'
			},
			{
				label: 'Refresh',
				icon: RefreshCw,
				onclick: () => getEventBus().emit('filebrowser.refresh.all'),
				className: 'action-button'
			}
		]
	},
	{
		componentType: 'plot-panel',
		actions: [
			{
				label: 'Refresh',
				icon: RefreshCw,
				onclick: () => getEventBus().emit('plot.refresh'),
				className: 'action-button'
			}
		],
		menuItems: [
			{
				label: 'Export as PNG',
				icon: Download,
				onclick: () => getEventBus().emit('plot.export', { format: 'png' })
			},
			{
				label: 'Export as SVG',
				icon: Download,
				onclick: () => getEventBus().emit('plot.export', { format: 'svg' })
			},
			{
				label: 'Export as CSV',
				icon: Download,
				onclick: () => getEventBus().emit('plot.export', { format: 'csv' })
			},
			{
				label: 'Export as JSON',
				icon: Download,
				onclick: () => getEventBus().emit('plot.export', { format: 'json' })
			}
		]
	}
];

/**
 * Get header actions for a specific component type
 */
export function getHeaderActions(componentType: string): HeaderActionConfig | undefined {
	return headerActionConfigs.find(config => config.componentType === componentType);
}

/**
 * Add custom controls to Golden Layout header
 * This should be called after the component is created
 */
export function addCustomHeaderControls(container: any, componentType: string) {
	const config = getHeaderActions(componentType);
	if (!config) return;

	// Get the header element
	const header = container.header;
	if (!header || !header.element) return;

	const headerElement = header.element[0] || header.element;
	const controlsContainer = headerElement.querySelector('.lm_controls');
	
	if (!controlsContainer) {
		console.warn('Could not find controls container in header');
		return;
	}

	// Add custom action buttons before the standard controls
	config.actions.forEach(action => {
		const button = document.createElement('button');
		button.className = 'lm_custom_action ' + (action.className || '');
		button.title = action.label;
		button.setAttribute('aria-label', action.label);
		button.onclick = action.onclick;
		
		// Add icon if provided (we'll use innerHTML for simplicity)
		if (action.icon) {
			// For Lucide icons, we need to render them differently
			// This is a simplified approach - in production you'd use a proper icon system
			button.innerHTML = `<span class="custom-icon" style="width: 16px; height: 16px; display: block;">${action.label[0]}</span>`;
		} else {
			button.textContent = action.label;
		}
		
		// Insert before the first standard control
		const firstControl = controlsContainer.firstChild;
		controlsContainer.insertBefore(button, firstControl);
	});
	
	// TODO: Add menu items support
	// This would require creating a dropdown menu similar to PanelHeader
}