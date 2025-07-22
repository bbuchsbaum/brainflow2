import type { LayoutConfig } from 'golden-layout';

// Defines the default layout structure for Brainflow
// Component types here MUST match those registered in +layout.svelte
export const defaultLayout: LayoutConfig = {
  root: {
    type: 'row',
    content: [
      // Column 0: Tree Browser Stack
      {
        type: 'stack',
        width: 20,
        minWidth: 160,
        content: [{
          type: 'component',
          componentType: 'tree-browser',
          id: 'files-singleton',
          title: 'Files'
        }]
      },
      // Column 1: Main Stack
      {
        type: 'stack',
        id: 'main-stack',
        width: 60,
        minWidth: 300,
        content: [
          // Add a default empty VolumeView
          {
            type: 'component',
            componentType: 'volume-view',
            title: 'Volume View',
            componentState: { layerId: null }
          }
        ]
      },
      // Column 2: Inspector Column
      {
        type: 'column',
        id: 'inspector-column',
        width: 20,
        minWidth: 220,
        content: [
          {
            type: 'row',
            height: 60,
            content: [
              {
                type: 'stack',
                id: 'inspector-top-stack',
                width: 50,
                content: [
                  { type: 'component', componentType: 'layer-panel', title: 'Layers' },
                  { type: 'component', componentType: 'legend-drawer', title: 'Atlas Legend' }
                ]
              },
              {
                type: 'component',
                componentType: 'layer-controls',
                title: 'Layer Controls',
                width: 50
              }
            ]
          },
          {
            type: 'component',
            id: 'plot-pane',
            componentType: 'plot-panel',
            title: 'Plots',
            height: 40,
            minHeight: 180
          }
        ]
      }
    ]
  },
  settings: {
    showPopoutIcon: false,
    showMaximiseIcon: true,
    showCloseIcon: true,
  },
  dimensions: {
    borderWidth: 3,
    minItemHeight: 150,
    minItemWidth: 160,
    headerHeight: 28,
  }
}; 