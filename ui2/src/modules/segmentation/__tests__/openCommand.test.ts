/** ⌘K › Open segmentation (and the Segmentation tab's button) enters Segment mode in a view. */
import { beforeEach, describe, expect, it, vi } from 'vitest';
const host = vi.hoisted(() => ({ activateViewTab: vi.fn() }));
vi.mock('@/modules/api/host', () => ({
  activateViewTab: (...args: unknown[]) => host.activateViewTab(...args),
  captureActiveWorkspace: () => null,
  registerWorkspaceEditHistory: () => () => {},
}));
vi.mock('@/modules/segmentation/session', () => ({ setSegmentationPresentation: vi.fn(), travelSegmentationHistory: vi.fn() }));
vi.mock('@/modules/segmentation/toolBindings', () => ({ segmentationPointerTool: () => ({}) }));
import { activate } from '@/modules/segmentation/activate';
import type { ModuleContext } from '@/modules/api';

function context(enterMode: () => Promise<boolean>) {
  const handlers = new Map<string, () => unknown>();
  const open = vi.fn(async () => null);
  const ctx = {
    commands: { register: (id: string, handler: () => unknown) => { handlers.set(id, handler); return () => {}; } },
    views: { registerTool: () => () => {}, enterMode: vi.fn(enterMode) },
    workspaces: { open },
    disposables: { add: (dispose: () => void) => dispose },
  } as unknown as ModuleContext;
  activate(ctx);
  return { run: () => handlers.get('segmentation.open')!(), enterMode: ctx.views.enterMode as ReturnType<typeof vi.fn>, open };
}
beforeEach(() => host.activateViewTab.mockReset());

describe('segmentation.open', () => {
  it('enters Segment mode in the front view directly', async () => {
    const c = context(async () => true);
    await c.run();
    expect(host.activateViewTab).not.toHaveBeenCalled();
    expect(c.open).not.toHaveBeenCalled();
  });

  it('with a surface tab in front, waits for the view to come forward and enters there in one click', async () => {
    let viewInFront = false;
    host.activateViewTab.mockImplementation(async () => { await new Promise((r) => setTimeout(r, 5)); viewInFront = true; return true; });
    const c = context(async () => viewInFront);
    await c.run();
    expect(c.enterMode).toHaveBeenCalledTimes(2);
    expect(c.enterMode).toHaveBeenLastCalledWith('segmentation.segment');
    expect(c.open).not.toHaveBeenCalled();
  });

  it('with no view tab, opens the Segmentation tab that explains what to do', async () => {
    host.activateViewTab.mockResolvedValue(false);
    const c = context(async () => false);
    await c.run();
    expect(c.enterMode).toHaveBeenCalledTimes(1);
    expect(c.open).toHaveBeenCalledWith('segmentation.workspace');
  });
});
