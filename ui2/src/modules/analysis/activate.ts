/**
 * Activation of the Analysis module (first use: its command, or its tab).
 * Switching the module off disposes what is registered here; the bridge
 * cancels running jobs in `on_disable`, so the session's job list is reset too.
 */

import type { ModuleContext } from '@/modules/api';
import { useAnalysisStore } from '@/modules/analysis/stores/analysisStore';
import { ANALYSIS_WORKBENCH } from './module';

export function activate(ctx: ModuleContext): void {
  ctx.commands.register('analysis.open', async () => {
    await ctx.workspaces.open(ANALYSIS_WORKBENCH);
  });
  ctx.disposables.add(() => useAnalysisStore.getState().resetSession());
}
