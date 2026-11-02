/** Small synchronous registry shared by the store and the shell close broker. */
const guardedWorkspaceIds = new Set<string>();

export const installWorkspaceCloseGuard = (workspaceId: string): void => {
  guardedWorkspaceIds.add(workspaceId);
};

export const removeWorkspaceCloseGuard = (workspaceId: string): void => {
  guardedWorkspaceIds.delete(workspaceId);
};

export const workspaceCloseIsGuarded = (workspaceId: string): boolean =>
  guardedWorkspaceIds.has(workspaceId);
