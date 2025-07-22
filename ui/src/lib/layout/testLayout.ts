import type { LayoutConfig } from 'golden-layout';

// Simple test layout to verify Golden Layout chrome/headers work
export const testLayout: LayoutConfig = {
	root: {
		type: 'row',
		content: [
			{
				type: 'stack',
				width: 50,
				content: [
					{
						type: 'component',
						componentType: 'tree-browser',
						title: 'Files'
					}
				]
			},
			{
				type: 'stack',
				width: 50,
				content: [
					{
						type: 'component',
						componentType: 'OrthogonalViewGPU',
						title: 'Main View'
					},
					{
						type: 'component',
						componentType: 'layer-panel',
						title: 'Layers'
					}
				]
			}
		]
	},
	settings: {
		showPopoutIcon: true,
		showMaximiseIcon: true,
		showCloseIcon: true,
		reorderEnabled: true,
		selectionEnabled: true
	},
	dimensions: {
		borderWidth: 2,
		minItemHeight: 150,
		minItemWidth: 160,
		headerHeight: 30
	}
};
