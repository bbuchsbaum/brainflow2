import type { Workspace } from '@/types/workspace';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MockTransport, setTransport } from '@/services/transport';
import { useWorkspaceStore } from '@/stores/workspaceStore';
import {
  discardWorkspaceDocument,
  isLiveWorkspaceDocument,
  requestWorkspaceClose,
  retainWorkspaceDocument,
  workspaceHasDocument,
  volumeDocumentRemovalReason,
} from '../workspaceDocuments';

const workspace = (id: string, timestamp: number): Workspace => ({
  id, timestamp, type: 'set-studio', title: id, isActive: false,
  layoutConfig: {}, panelStates: new Map(),
});

function put(id: string, timestamp = 1) {
  const state = useWorkspaceStore.getState();
  useWorkspaceStore.setState({ workspaces: new Map([[id, workspace(id, timestamp)]]) });
  return state;
}

describe('workspace documents', () => {
  it('keeps required images protected through parking, callback refresh and failed disposal', async () => {
    put('source-guard');
    const identity = retainWorkspaceDocument('source-guard', { moduleId: 'segmentation', protectedVolumeIds: ['reference', 'secondary'] });
    const saved = useWorkspaceStore.getState().workspaces.get('source-guard')!;
    useWorkspaceStore.setState({ workspaces: new Map(), parkedWorkspaces: new Map([['source-guard', saved]]) });
    retainWorkspaceDocument('source-guard', { moduleId: 'segmentation', protectedVolumeIds: ['retry-source'] });
    for (const id of ['reference', 'secondary', 'retry-source']) expect(volumeDocumentRemovalReason(id)).toContain('before removing');
    transport.setMockResponse('dispose_module_workspace', () => { throw new Error('busy'); });
    await expect(discardWorkspaceDocument(identity)).resolves.toBe(false);
    expect(volumeDocumentRemovalReason('reference')).not.toBeNull();
    transport.setMockResponse('dispose_module_workspace', null);
    await expect(discardWorkspaceDocument(identity)).resolves.toBe(true);
    expect(volumeDocumentRemovalReason('reference')).toBeNull();
    expect(volumeDocumentRemovalReason('secondary')).toBeNull();
  });
  it('releases the module record only after successful native disposal, once', async () => {
    put('cleanup'); const cleanup = vi.fn();
    const identity = retainWorkspaceDocument('cleanup', { moduleId: 'segmentation', onDiscarded: cleanup });
    expect(Object.keys(identity).sort()).toEqual(['workspaceId', 'workspaceInstance']);
    expect(cleanup).not.toHaveBeenCalled();
    await discardWorkspaceDocument(identity); await discardWorkspaceDocument(identity);
    expect(cleanup).toHaveBeenCalledTimes(1);
  });
  let transport: MockTransport;
  beforeEach(() => {
    transport = new MockTransport();
    setTransport(transport);
    useWorkspaceStore.setState({ workspaces: new Map(), parkedWorkspaces: new Map(), activeWorkspaceId: null });
    vi.stubGlobal('confirm', vi.fn(() => true));
  });

  it('retains pending creation without a module activation lifetime', () => {
    put('pending');
    const identity = retainWorkspaceDocument('pending', { moduleId: 'segmentation', label: 'Segmentation session' });
    expect(identity.workspaceId).toBe('pending');
    expect(identity.workspaceInstance).not.toBe('pending');
    expect(workspaceHasDocument('pending')).toBe(true);
    expect(useWorkspaceStore.getState().closeWorkspace('pending')).toBe(false);
  });

  it('cancels while a module is disabled without invoking disposal', async () => {
    put('disabled');
    retainWorkspaceDocument('disabled', { moduleId: 'segmentation' });
    vi.stubGlobal('confirm', vi.fn(() => false));
    await expect(requestWorkspaceClose('disabled')).resolves.toBe(false);
    expect(transport.getCallLog()).toEqual([]);
    expect(workspaceHasDocument('disabled')).toBe(true);
  });

  it('keeps the guard and workspace after disposal rejection, allowing retry', async () => {
    put('reject');
    const identity = retainWorkspaceDocument('reject', { moduleId: 'segmentation' });
    transport.setMockResponse('dispose_module_workspace', () => { throw new Error('native refused'); });
    await expect(requestWorkspaceClose('reject')).resolves.toBe(false);
    expect(workspaceHasDocument('reject')).toBe(true);
    expect(useWorkspaceStore.getState().workspaces.has('reject')).toBe(true);
    transport.setMockResponse('dispose_module_workspace', null);
    await expect(discardWorkspaceDocument(identity)).resolves.toBe(true);
    expect(workspaceHasDocument('reject')).toBe(false);
  });

  it('allows explicit old-identity cleanup after replacement without closing the replacement', async () => {
    put('replace', 1);
    const identity = retainWorkspaceDocument('replace', { moduleId: 'segmentation' });
    let resolve!: () => void;
    transport.setMockResponse('dispose_module_workspace', () => new Promise<void>((done) => { resolve = done; }));
    const pending = discardWorkspaceDocument(identity);
    await vi.waitFor(() => expect(resolve).toBeTypeOf('function'));
    useWorkspaceStore.setState({ workspaces: new Map([['replace', workspace('replace', 2)]]) });
    resolve();
    await expect(pending).resolves.toBe(true);
    expect(workspaceHasDocument('replace')).toBe(false);
    expect(isLiveWorkspaceDocument(identity)).toBe(false);
  });

  it('refuses a stale retain and keeps its old guard until explicit cleanup', async () => {
    put('stale-retain', 1);
    const old = retainWorkspaceDocument('stale-retain', { moduleId: 'segmentation' });
    useWorkspaceStore.setState({ workspaces: new Map([['stale-retain', workspace('stale-retain', 2)]]) });
    expect(() => retainWorkspaceDocument('stale-retain', { moduleId: 'segmentation' })).toThrow('stale retained');
    expect(useWorkspaceStore.getState().closeWorkspace('stale-retain')).toBe(false);
    await expect(discardWorkspaceDocument(old)).resolves.toBe(true);
    expect(workspaceHasDocument('stale-retain')).toBe(false);
  });

  it('does not close a replacement tab through an old document request', async () => {
    put('replacement-close', 1);
    retainWorkspaceDocument('replacement-close', { moduleId: 'segmentation' });
    useWorkspaceStore.setState({ workspaces: new Map([['replacement-close', workspace('replacement-close', 2)]]) });
    await expect(requestWorkspaceClose('replacement-close')).resolves.toBe(false);
    expect(transport.getCallLog()).toEqual([]);
    expect(useWorkspaceStore.getState().workspaces.has('replacement-close')).toBe(true);
  });

  it('treats parked workspaces as live ownership', () => {
    useWorkspaceStore.setState({ parkedWorkspaces: new Map([['parked', workspace('parked', 7)]]) });
    const identity = retainWorkspaceDocument('parked', { moduleId: 'segmentation' });
    expect(isLiveWorkspaceDocument(identity)).toBe(true);
  });

  it('refreshes the freeze callback after reactivation without changing identity', async () => {
    put('reactivate');
    const oldFreeze = vi.fn();
    const identity = retainWorkspaceDocument('reactivate', { moduleId: 'segmentation', label: 'old', freezeEditing: oldFreeze });
    const newFreeze = vi.fn();
    expect(retainWorkspaceDocument('reactivate', { moduleId: 'segmentation', label: 'new', freezeEditing: newFreeze })).toEqual(identity);
    await discardWorkspaceDocument(identity);
    expect(oldFreeze).not.toHaveBeenCalled();
    expect(newFreeze).toHaveBeenCalledTimes(1);
  });

  it('deduplicates repeated close requests while the confirmation is pending', async () => {
    put('repeat');
    retainWorkspaceDocument('repeat', { moduleId: 'segmentation' });
    let answer!: (value: boolean) => void;
    vi.stubGlobal('confirm', vi.fn(() => new Promise<boolean>((done) => { answer = done; })));
    const first = requestWorkspaceClose('repeat');
    const second = requestWorkspaceClose('repeat');
    answer(false);
    await expect(Promise.all([first, second])).resolves.toEqual([false, false]);
    expect(globalThis.confirm).toHaveBeenCalledTimes(1);
  });
});
