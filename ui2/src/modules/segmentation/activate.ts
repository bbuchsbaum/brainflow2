/**
 * Activation of the Segmentation module (first use: its command or its tab).
 * Nothing to tear down yet: the module holds no session state.
 */

import type { ModuleContext } from '@/modules/api';
import { SEGMENTATION_WORKSPACE } from './module';

export function activate(ctx: ModuleContext): void {
  ctx.commands.register('segmentation.open', async () => {
    await ctx.workspaces.open(SEGMENTATION_WORKSPACE);
  });
}
