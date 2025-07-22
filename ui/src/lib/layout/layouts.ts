import type { ComponentConfig, LayoutConfig } from 'golden-layout';

/**
 * Default layout configuration for Brainflow
 * Features layer panel with unified selection and controls
 */
export const defaultLayout: LayoutConfig = {
	root: {
		type: 'row',
		content: [
			{
				type: 'column',
				width: 20,
				content: [
					{
						type: 'component',
						componentType: 'FileBrowserPanel',
						componentState: {},
						title: 'Files',
						height: 50
					},
					{
						type: 'component',
						componentType: 'LayerPanel',
						componentState: {},
						title: 'Layers & Controls',
						height: 50
					}
				]
			},
			{
				type: 'column',
				width: 60,
				content: [
					{
						type: 'stack',
						content: [
							{
								type: 'component',
								componentType: 'OrthogonalViewGPU',
								componentState: { viewId: 'main' },
								title: 'Main View'
							},
							{
								type: 'component',
								componentType: 'VolumeView',
								componentState: { viewId: '3d' },
								title: '3D View'
							}
						]
					}
				]
			},
			{
				type: 'column',
				width: 20,
				content: [
					{
						type: 'stack',
						height: 70,
						content: [
							{
								type: 'component',
								componentType: 'TreeBrowser',
								componentState: {},
								title: 'Data Tree'
							}
						]
					},
					{
						type: 'stack',
						height: 30,
						content: [
							{
								type: 'component',
								componentType: 'PlotPanel',
								componentState: { plotId: 'timeseries' },
								title: 'Time Series'
							}
						]
					}
				]
			}
		]
	}
};

/**
 * Component registry for the enhanced layout
 */
export const componentRegistry: Record<string, any> = {
	FileBrowserPanel: () => import('$lib/components/panels/FileBrowserPanel.svelte'),
	LayerPanel: () => import('$lib/components/panels/LayerPanel.svelte'),
	OrthogonalViewGPU: () => import('$lib/components/views/VolumeView.svelte'), // Maps to VolumeView which shows 3 slice views
	VolumeView: () => import('$lib/components/views/VolumeView.svelte'),
	TreeBrowser: () => import('$lib/components/TreeBrowser.svelte'),
	PlotPanel: () => import('$lib/components/panels/PlotPanel.svelte')
};

/**
 * Alternative layouts
 */
export const layouts = {
	default: defaultLayout,

	// Focused view layout - larger main view
	focused: {
		root: {
			type: 'row',
			content: [
				{
					type: 'component',
					componentType: 'EnhancedLayerPanel',
					componentState: {},
					title: 'Layers & Controls',
					width: 15
				},
				{
					type: 'component',
					componentType: 'OrthogonalViewGPU',
					componentState: { viewId: 'main' },
					title: 'Main View',
					width: 85
				}
			]
		}
	},

	// Analysis layout - more space for plots
	analysis: {
		root: {
			type: 'row',
			content: [
				{
					type: 'column',
					width: 15,
					content: [
						{
							type: 'component',
							componentType: 'FileBrowserPanel',
							componentState: {},
							title: 'Files',
							height: 40
						},
						{
							type: 'component',
							componentType: 'LayerPanel',
							componentState: {},
							title: 'Layers & Controls',
							height: 60
						}
					]
				},
				{
					type: 'column',
					width: 50,
					content: [
						{
							type: 'component',
							componentType: 'OrthogonalViewGPU',
							componentState: { viewId: 'main' },
							title: 'Main View'
						}
					]
				},
				{
					type: 'column',
					width: 35,
					content: [
						{
							type: 'stack',
							content: [
								{
									type: 'component',
									componentType: 'PlotPanel',
									componentState: { plotId: 'timeseries' },
									title: 'Time Series'
								},
								{
									type: 'component',
									componentType: 'PlotPanel',
									componentState: { plotId: 'histogram' },
									title: 'Histogram'
								}
							]
						}
					]
				}
			]
		}
	}
};
