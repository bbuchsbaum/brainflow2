import { useViewStateStore } from '@/stores/viewStateStore';
import { useWorkspaceStore } from '@/stores/workspaceStore';

type WorkspaceState = ReturnType<typeof useWorkspaceStore.getState>;

function studioWorkspaceIdOf(state: WorkspaceState): string | null {
  for (const workspace of state.workspaces.values()) {
    if (workspace.type === 'set-studio') return workspace.id;
  }
  return null;
}

/**
 * The view-state key of the Set studio's workspace (a singleton tab), or the
 * active key when there is none (tests, harnesses). Studio views bind to it,
 * never to whichever workspace is in front: a Studio tab left mounted behind
 * the Orthogonal tab must not move that tab's crosshair (QA F44).
 */
export function studioWorkspaceKey(): string {
  return (
    studioWorkspaceIdOf(useWorkspaceStore.getState()) ??
    useViewStateStore.getState().activeWorkspaceKey
  );
}

export function useStudioWorkspaceKey(): string {
  const studio = useWorkspaceStore(studioWorkspaceIdOf);
  const active = useViewStateStore((state) => state.activeWorkspaceKey);
  return studio ?? active;
}

/**
 * The Studio's workspace is the one in front. Without a Studio workspace
 * (tests, harnesses) the views are always live.
 */
export function useStudioInFront(): boolean {
  const studio = useWorkspaceStore(studioWorkspaceIdOf);
  const active = useViewStateStore((state) => state.activeWorkspaceKey);
  return studio === null || studio === active;
}
