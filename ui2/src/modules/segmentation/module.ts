/** Experimental reference-grid segmentation: live setup and manual native-plane tracing. */

import { defineModule } from '@/modules/api';

/** Persisted migration entry; new work opens Segment mode in the current view. */
export const SEGMENTATION_WORKSPACE = 'segmentation.workspace';
export const SEGMENTATION_VIEW_MODE = 'segmentation.segment';

export default defineModule({
  id: 'segmentation',
  title: 'Segmentation',
  description: 'Trace and edit labels on a loaded reference grid.',
  version: '0.1.0',
  stage: 'experimental',
  hosts: ['desktop'],
  requires: { renderFeatures: ['editableLabels', 'subRegionUpload', 'multiOutline', 'zoomPan', 'nativePlanes', 'obliquePlanes'] },
  contributes: {
    commands: [
      ...(['navigate', 'brush', 'eraser', 'contour', 'undo', 'redo', 'pan'] as const).map((id) => ({ id: `segmentation.${id}`, title: `${id[0].toUpperCase()}${id.slice(1)}`, group: 'Segmentation', when: { viewMode: SEGMENTATION_VIEW_MODE } })),
      {
        id: 'segmentation.open',
        title: 'Open segmentation',
        subtitle: 'Enter Segment mode in the current view.',
        keywords: ['segmentation', 'labels', 'tracing', 'segment'],
        group: 'Segmentation',
      },
    ],
    keybindings: [
      { command: 'segmentation.pan', key: ' ', when: { viewMode: SEGMENTATION_VIEW_MODE } },
      ...([['navigate', 'v'], ['brush', 'b'], ['eraser', 'e'], ['contour', 'c']] as const).map(([id, key]) => ({ command: `segmentation.${id}`, key, when: { viewMode: SEGMENTATION_VIEW_MODE } })),
    ],
    workspaces: [
      {
        id: SEGMENTATION_WORKSPACE,
        title: 'Segmentation',
        label: 'Segmentation',
        component: () =>
          import('./components/SegmentationWorkspace').then((m) => ({ default: m.SegmentationWorkspace })),
      },
    ],
    inspectorModes: [
      {
        id: SEGMENTATION_VIEW_MODE,
        title: 'Segment',
        component: () => import('./components/SegmentationInspector').then((m) => ({ default: m.SegmentationInspector })),
      },
    ],
    viewportTools: [
      { id: 'segmentation.brush', title: 'Brush' },
      { id: 'segmentation.eraser', title: 'Eraser' },
      { id: 'segmentation.contour', title: 'Contour' },
    ],
    viewModes: [
      {
        id: SEGMENTATION_VIEW_MODE,
        title: 'Segment',
        layoutPreset: 'segmentation.trace',
        component: () => import('./components/SegmentationMode').then((m) => ({ default: m.SegmentationMode })),
        inspectorMode: SEGMENTATION_VIEW_MODE,
        viewportTools: ['segmentation.brush', 'segmentation.eraser', 'segmentation.contour'],
      },
    ],
    layerKinds: [
      {
        id: 'segmentation.editable-label', title: 'Editable label layer', baseRenderMode: 'label', stackingBand: 4, icon: 'labels',
        capabilities: { thresholdable: false, colormappable: true, editable: true, outline: true },
      },
    ],
  },
  activate: () => import('./activate'),
});
