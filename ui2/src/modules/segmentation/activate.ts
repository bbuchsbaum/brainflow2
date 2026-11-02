import type { ModuleContext } from '@/modules/api';
import { captureActiveWorkspace, registerWorkspaceEditHistory } from '@/modules/api/host';
import { SEGMENTATION_VIEW_MODE, SEGMENTATION_WORKSPACE } from './module';
import { setSegmentationPresentation, travelSegmentationHistory } from './session';
import { segmentationPointerTool } from './toolBindings';

export function activate(ctx: ModuleContext): void {
  ctx.disposables.add(registerWorkspaceEditHistory({ viewMode: SEGMENTATION_VIEW_MODE, run: (action, workspaceId) => travelSegmentationHistory(workspaceId, action === 'redo') }));
  ctx.commands.register('segmentation.pan', () => undefined);
  ctx.commands.register('segmentation.open', async () => {
    if (!await ctx.views.enterMode(SEGMENTATION_VIEW_MODE)) await ctx.workspaces.open(SEGMENTATION_WORKSPACE);
  });
  for (const tool of ['brush', 'eraser', 'contour'] as const) ctx.views.registerTool(`segmentation.${tool}`, segmentationPointerTool());
  for (const tool of ['navigate', 'brush', 'eraser', 'contour'] as const) ctx.commands.register(`segmentation.${tool}`, () => {
    const view = captureActiveWorkspace(); if (view) setSegmentationPresentation(view.workspaceId, { tool });
  });
  ctx.commands.register('segmentation.undo', async () => { const view = captureActiveWorkspace(); if (view) await travelSegmentationHistory(view.workspaceId); });
  ctx.commands.register('segmentation.redo', async () => { const view = captureActiveWorkspace(); if (view) await travelSegmentationHistory(view.workspaceId, true); });
}
