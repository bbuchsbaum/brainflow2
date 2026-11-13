import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setTransport } from '@/services/transport';
import {
  resetRemoteReconnectService,
  settleRemoteReconnectPrompt,
} from '@/services/RemoteReconnectService';
import type { ConnectedRemoteMount } from '@/services/RemoteMountService';
import { useFileBrowserStore } from '@/stores/fileBrowserStore';
import { useLayerStore, type LayerInfo } from '@/stores/layerStore';
import { useLoadingQueueStore } from '@/stores/loadingQueueStore';
import {
  markRemoteMountActive,
  resetRemoteConnectionStore,
  useRemoteConnectionStore,
} from '@/stores/remoteConnectionStore';
import { useViewStateStore } from '@/stores/viewStateStore';
import type { FileTreeNode } from '@/types/filesystem';
import type { ViewState } from '@/types/viewState';
import { StudioMemberLoadOverlay } from '../StudioMemberLoadOverlay';

const retryActiveMember = vi.hoisted(() => vi.fn());
vi.mock('@/services/studio/StudioCoordinationService', () => ({
  getStudioCoordinationService: () => ({ retryActiveMember }),
}));

const HOST = 'trillium.alliancecan.ca';
const ROOT = '/cache/remote_mounts/cache-aaa';
const OTHER_ROOT = '/cache/remote_mounts/cache-bbb';
const PATH = `${ROOT}/sub-04/same_item.nii.gz`;
const DROPPED = { Io: { code: 8218, details: 'SSH error: SSH session disconnected' } };

const queue = () => useLoadingQueueStore.getState();
const connection = () => useRemoteConnectionStore.getState();

function remoteRoot(path: string, host: string): FileTreeNode {
  return {
    id: path,
    name: host,
    path,
    type: 'directory',
    depth: 0,
    children: [],
    mountSource: { kind: 'remote', mountId: `old:${path}`, host, port: 22, user: 'brad', remotePath: '/scratch/brad' },
  } as FileTreeNode;
}

function mount(path: string): ConnectedRemoteMount {
  return {
    mount_id: 'new',
    local_path: path,
    display_name: HOST,
    origin: { mount_id: 'new', label: `brad@${HOST}`, host: HOST, port: 22, user: 'brad', remote_path: '/scratch/brad' },
  } as ConnectedRemoteMount;
}

/** The member's load ends the way the orchestrator records a failure. */
function failMember(error: unknown) {
  const id = queue().enqueue({ type: 'volume-load', path: PATH, displayName: 'same_item.nii.gz' });
  queue().startLoading(id);
  queue().markError(id, new Error('load failed', { cause: error }));
}

/** What the Studio does when asked for the member again, on a mount that answers. */
function memberLoadsOnRetry() {
  retryActiveMember.mockImplementation(() => {
    const id = queue().enqueue({ type: 'volume-load', path: PATH, displayName: 'same_item.nii.gz' });
    queue().startLoading(id);
    queue().markComplete(id);
    useLayerStore.setState({
      layers: [{ id: 'member', name: 'member', sourcePath: PATH } as unknown as LayerInfo],
    });
    useViewStateStore.setState((state) => ({
      viewState: { ...state.viewState, layers: [{ id: 'member' }] } as unknown as ViewState,
    }));
  });
}

const settle = async () => {
  await act(async () => {
    for (let i = 0; i < 3; i += 1) await new Promise((resolve) => setTimeout(resolve, 0));
  });
};

beforeEach(() => {
  retryActiveMember.mockReset();
  resetRemoteReconnectService();
  resetRemoteConnectionStore();
  useRemoteConnectionStore.setState({ hosts: 1 });
  useLoadingQueueStore.setState({ queue: [], activeLoads: new Map(), completed: [] });
  useLayerStore.setState({ layers: [], layerMetadata: new Map() });
  useViewStateStore.setState((state) => ({
    viewState: { ...state.viewState, layers: [] } as unknown as ViewState,
  }));
  useFileBrowserStore.setState({
    entries: [remoteRoot(ROOT, HOST), remoteRoot(OTHER_ROOT, 'other.example.org')],
    recents: [],
    pinned: [],
    error: null,
    errorPath: null,
  });
  // The backend no longer holds the mount; the sign-in goes straight to the dialog.
  setTransport({
    invoke: (cmd: string) =>
      cmd === 'list_remote_mounts'
        ? Promise.resolve([])
        : Promise.reject(new Error(`unexpected command ${cmd}`)),
  } as never);
});

afterEach(() => cleanup());

describe('StudioMemberLoadOverlay on a dropped remote connection', () => {
  it('says the connection was lost, with the host, and offers Reconnect before Retry', () => {
    failMember(DROPPED);
    render(<StudioMemberLoadOverlay sourcePath={PATH} />);
    const card = screen.getByTestId('studio-member-failed');
    expect(card).toHaveAttribute('data-cause', 'connection-lost');
    expect(card).toHaveTextContent(`The connection to ${HOST} was lost`);
    expect(card).toHaveTextContent('Reconnect to keep browsing this set.');
    expect(card).not.toHaveTextContent('SSH error');
    expect(card).not.toHaveTextContent('Could not open');
    const buttons = Array.from(card.querySelectorAll('button')).map((button) => button.textContent);
    expect(buttons).toEqual(['Reconnect', 'Retry']);
  });

  it('reconnects, then asks for the member again by itself, and the image appears', async () => {
    memberLoadsOnRetry();
    failMember(DROPPED);
    render(<StudioMemberLoadOverlay sourcePath={PATH} />);

    fireEvent.click(screen.getByTestId('studio-member-reconnect'));
    // In progress: neutral, no buttons, no alert.
    const waiting = await screen.findByTestId('studio-member-reconnecting');
    expect(waiting).toHaveTextContent(`Reconnecting to ${HOST}…`);
    expect(waiting).toHaveAttribute('role', 'status');
    expect(waiting.querySelector('button')).toBeNull();
    await waitFor(() => expect(connection().requests).toHaveLength(1));
    expect(retryActiveMember).not.toHaveBeenCalled();

    // The sign-in completes (the dialog host reports the mount).
    act(() => settleRemoteReconnectPrompt(ROOT, mount(ROOT)));
    await settle();

    expect(retryActiveMember).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId('studio-member-failed')).toBeNull();
    expect(screen.queryByTestId('studio-member-reconnecting')).toBeNull();
  });

  it('returns to the card when the sign-in is cancelled', async () => {
    failMember(DROPPED);
    render(<StudioMemberLoadOverlay sourcePath={PATH} />);
    fireEvent.click(screen.getByTestId('studio-member-reconnect'));
    await screen.findByTestId('studio-member-reconnecting');
    await waitFor(() => expect(connection().requests).toHaveLength(1));

    act(() => settleRemoteReconnectPrompt(ROOT, null));
    await settle();

    expect(screen.getByTestId('studio-member-failed')).toHaveTextContent(
      `The connection to ${HOST} was lost`,
    );
    expect(screen.getByTestId('studio-member-reconnect')).toBeEnabled();
    expect(screen.queryByTestId('studio-member-reconnect-failure')).toBeNull();
    expect(retryActiveMember).not.toHaveBeenCalled();
  });

  it('says why when the reconnect could not be done, and keeps the card', async () => {
    useRemoteConnectionStore.setState({ hosts: 0 });
    failMember(DROPPED);
    render(<StudioMemberLoadOverlay sourcePath={PATH} />);
    fireEvent.click(screen.getByTestId('studio-member-reconnect'));
    await settle();
    expect(screen.getByTestId('studio-member-reconnect-failure')).toHaveTextContent(/Recents/);
    expect(screen.getByTestId('studio-member-retry')).toBeInTheDocument();
    expect(retryActiveMember).not.toHaveBeenCalled();
  });

  it('recovers when the mount is reconnected from another surface', () => {
    memberLoadsOnRetry();
    failMember(DROPPED);
    render(<StudioMemberLoadOverlay sourcePath={PATH} />);
    act(() => markRemoteMountActive(ROOT));
    expect(retryActiveMember).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId('studio-member-failed')).toBeNull();
    // Once per reconnect: later renders and store writes do not ask again.
    act(() => useRemoteConnectionStore.setState({ hosts: 2 }));
    expect(retryActiveMember).toHaveBeenCalledTimes(1);
  });

  it('does not retry for another mount, for another kind of failure, or after the view is gone', () => {
    failMember(DROPPED);
    const view = render(<StudioMemberLoadOverlay sourcePath={PATH} />);
    act(() => markRemoteMountActive(OTHER_ROOT));
    expect(retryActiveMember).not.toHaveBeenCalled();
    view.unmount();
    act(() => markRemoteMountActive(ROOT));
    expect(retryActiveMember).not.toHaveBeenCalled();

    useLoadingQueueStore.setState({ queue: [], activeLoads: new Map(), completed: [] });
    failMember({ Loader: { code: 2001, details: 'not a NIfTI file' } });
    render(<StudioMemberLoadOverlay sourcePath={PATH} />);
    act(() => markRemoteMountActive(ROOT));
    expect(retryActiveMember).not.toHaveBeenCalled();
  });

  it('keeps the plain "Could not open" card, with Retry only, for other failures', () => {
    const id = queue().enqueue({ type: 'volume-load', path: PATH, displayName: 'same_item.nii.gz' });
    queue().startLoading(id);
    queue().markError(id, new Error('SSH error: SSH channel error: Channel send error'));
    render(<StudioMemberLoadOverlay sourcePath={PATH} />);
    const card = screen.getByTestId('studio-member-failed');
    expect(card).not.toHaveAttribute('data-cause');
    expect(card).toHaveTextContent('Could not open same_item.nii.gz');
    // The transport's prefix is noise; the cause stays.
    expect(card).toHaveTextContent('SSH channel error: Channel send error');
    expect(card).not.toHaveTextContent('SSH error:');
    expect(screen.queryByTestId('studio-member-reconnect')).toBeNull();
    fireEvent.click(screen.getByTestId('studio-member-retry'));
    expect(retryActiveMember).toHaveBeenCalledTimes(1);
  });

  it('offers Retry alone when no remote folder is known for the file', () => {
    useFileBrowserStore.setState({ entries: [] });
    failMember(DROPPED);
    render(<StudioMemberLoadOverlay sourcePath={PATH} />);
    const card = screen.getByTestId('studio-member-failed');
    expect(card).toHaveTextContent('The connection to the remote folder was lost');
    expect(screen.queryByTestId('studio-member-reconnect')).toBeNull();
    expect(screen.getByTestId('studio-member-retry')).toBeInTheDocument();
  });
});
