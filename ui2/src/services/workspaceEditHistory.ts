/** A module's document history may own Edit while its declared view mode is in front. */
import { useWorkspaceStore } from '@/stores/workspaceStore';
import { getEventBus } from '@/events/EventBus';
type Action = 'undo' | 'redo';
interface Handler { viewMode: string; run(action: Action, workspaceId: string): void | Promise<unknown>; }
const handlers = new Set<Handler>();
export function registerWorkspaceEditHistory(handler: Handler): () => void {
  handlers.add(handler); return () => { handlers.delete(handler); };
}
/** Claim synchronously so an empty/busy document never undoes an unrelated scene edit. */
export function runWorkspaceEditCommand(action: Action): boolean {
  const state = useWorkspaceStore.getState(), id = state.activeWorkspaceId;
  const workspace = id ? state.workspaces.get(id) : undefined;
  if (!id || !workspace?.viewMode) return false;
  const handler = [...handlers].find((item) => item.viewMode === workspace.viewMode);
  if (!handler) return false;
  try { Promise.resolve(handler.run(action, id)).catch(report); } catch (error) { report(error); }
  return true;
}
function report(error: unknown) {
  getEventBus().emit('ui.notification', { type: 'error', message: error instanceof Error ? error.message : 'Could not change workspace history.' });
}
