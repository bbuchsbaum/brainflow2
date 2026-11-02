import type { ViewportTool } from '@/modules/api';
import { captureActiveWorkspace } from '@/modules/api/host';
type Binding = { tool: ViewportTool; live: boolean };
const targets = new Map<string, Binding>();
export function bindSegmentationViewport(workspaceId: string, tool: ViewportTool): () => void {
  const binding = { tool, live: true }; targets.set(workspaceId, binding);
  return () => { if (targets.get(workspaceId) === binding) targets.delete(workspaceId); binding.live = false; tool.cancel('disposed'); };
}
export function segmentationPointerTool(): ViewportTool {
  let owner: Binding | null = null;
  return {
    pointerDown(samples) {
      const workspace = captureActiveWorkspace();
      const target = workspace ? targets.get(workspace.workspaceId) : undefined;
      if (!target?.live || !target.tool.pointerDown(samples)) return false;
      owner = target; return true;
    },
    pointerMove(samples) { if (owner?.live) owner.tool.pointerMove(samples); },
    pointerUp(samples) { const target = owner; owner = null; if (target?.live) target.tool.pointerUp(samples); },
    cancel(reason) { const target = owner; owner = null; if (target?.live) target.tool.cancel(reason); },
  };
}
