import { afterEach, describe, expect, it, vi } from 'vitest';
import { registerWorkspaceEditHistory } from '@/services/workspaceEditHistory';
import { useWorkspaceStore } from '@/stores/workspaceStore';
import { getSceneHistory, runEditCommand } from '@/services/SceneHistoryService';

function active(viewMode: string | undefined) {
  useWorkspaceStore.setState({ activeWorkspaceId: 'w', workspaces: new Map(viewMode ? [['w', { id: 'w', timestamp: 1, type: 'mosaic', title: 'View', isActive: true, viewMode, layoutConfig: {} as never, panelStates: new Map() }]] : []) });
}
afterEach(() => { useWorkspaceStore.setState({ activeWorkspaceId: null, workspaces: new Map() }); (document.activeElement as HTMLElement | null)?.blur?.(); });
describe('workspace edit history routing', () => {
 it('claims key plus menu echo once and handles standalone menu without scene fallback', async () => {
  active('segmentation.segment'); const doc=vi.fn(async () => undefined); const off=registerWorkspaceEditHistory({ viewMode:'segmentation.segment', run: doc }); const scene=vi.spyOn(getSceneHistory(),'undo').mockResolvedValue(true);
  runEditCommand('undo','key'); runEditCommand('undo','menu'); await Promise.resolve(); expect(doc).toHaveBeenCalledTimes(1); expect(scene).not.toHaveBeenCalled();
  runEditCommand('undo','menu'); await Promise.resolve(); expect(doc).toHaveBeenCalledTimes(2); expect(scene).not.toHaveBeenCalled(); off(); scene.mockRestore();
 });
 it('keeps native text undo and restores scene fallback after mode exit/disposal', async () => {
  active('segmentation.segment'); const doc=vi.fn(); const off=registerWorkspaceEditHistory({ viewMode:'segmentation.segment', run:doc }); const scene=vi.spyOn(getSceneHistory(),'undo').mockResolvedValue(true); const exec=vi.fn(() => true); Object.defineProperty(document,'execCommand',{value:exec, configurable:true}); const input=document.createElement('input'); document.body.append(input); input.focus(); runEditCommand('undo','menu'); expect(exec).toHaveBeenCalledWith('undo'); expect(doc).not.toHaveBeenCalled(); input.remove();
  active('mosaic'); runEditCommand('undo','menu'); await Promise.resolve(); expect(scene).toHaveBeenCalledTimes(1); active('segmentation.segment'); off(); runEditCommand('undo','menu'); await Promise.resolve(); expect(scene).toHaveBeenCalledTimes(2); scene.mockRestore();
 });
});
