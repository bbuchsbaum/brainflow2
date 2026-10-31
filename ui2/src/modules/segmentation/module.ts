/**
 * The Segmentation module: label tracing on a reference grid (research:
 * docs/plans/segmentation-module-research.md, "Recommended design").
 *
 * Stage: experimental, off by default. It is in design: editing is not
 * implemented and there is no bridge section yet. Switched on, it adds one
 * palette command and a tool tab that says so. The design directions live in
 * `components/directions/` and render only in the dev harness
 * (`ui2/segmentation-harness.html`).
 */

import { defineModule } from '@/modules/api';

export const SEGMENTATION_WORKSPACE = 'segmentation.workspace';

export default defineModule({
  id: 'segmentation',
  title: 'Segmentation',
  description: 'Trace and edit labels on a reference grid (in design; editing is not available yet).',
  version: '0.0.1',
  stage: 'experimental',
  hosts: ['desktop'],
  contributes: {
    commands: [
      {
        id: 'segmentation.open',
        title: 'Open segmentation',
        subtitle: 'The segmentation module is in design; editing is not available yet.',
        keywords: ['segmentation', 'labels', 'tracing', 'segment'],
        group: 'Segmentation',
      },
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
  },
  activate: () => import('./activate'),
});
