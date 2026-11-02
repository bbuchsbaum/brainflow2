/**
 * Runtime identity of one workspace incarnation. The frontend mints the
 * incarnation; it is not reused from persisted timestamps or restored tabs.
 */
export type WorkspaceIdentity = {
    workspaceId: string;
    workspaceInstance: string;
};
