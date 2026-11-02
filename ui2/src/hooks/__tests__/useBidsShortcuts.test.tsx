import { act, render } from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createBidsBrowserDataset } from '@/devHarness/app/bidsBrowserData';
import {
  getKeyboardShortcutService,
  setKeyboardShortcutService,
} from '@/services/KeyboardShortcutService';
import { selectBidsModel, useBidsStore } from '@/stores/bidsStore';
import { useLayoutSettingsStore } from '@/stores/layoutSettingsStore';
import { useWorkspaceStore } from '@/stores/workspaceStore';
import { buildBidsPaletteCommands } from '../useBidsPaletteCommands';
import { undoBidsExclusion, useBidsShortcuts } from '../useBidsShortcuts';

const { openSelectedRun } = vi.hoisted(() => ({ openSelectedRun: vi.fn() }));
vi.mock('@/services/bids/openRunInViewer', () => ({ openSelectedRun, openRunInViewer: vi.fn() }));

function Host() {
  useBidsShortcuts();
  return null;
}

const press = (key: string, init: KeyboardEventInit = {}) =>
  act(() => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init }));
  });

const inFront = (type: string) =>
  useWorkspaceStore.setState({
    getActiveWorkspace: () => ({ type }) as never,
  });

describe('useBidsShortcuts', () => {
  const viewerHandlers = {
    layer: vi.fn(),
    centre: vi.fn(),
    labels: vi.fn(),
    play: vi.fn(),
    undo: vi.fn(),
  };

  beforeEach(() => {
    setKeyboardShortcutService(undefined as never);
    const service = getKeyboardShortcutService();
    service.init();
    Object.values(viewerHandlers).forEach((fn) => fn.mockClear());
    const cat = { category: 't', description: 't' };
    service.register({ id: 'layers.toggle1', key: '1', handler: viewerHandlers.layer, ...cat });
    service.register({ id: 'nav.goToCenter', key: 'c', handler: viewerHandlers.centre, ...cat });
    service.register({ id: 'toggle-orientation-labels', key: 'l', handler: viewerHandlers.labels, ...cat });
    service.register({ id: 'time.playPause', key: ' ', handler: viewerHandlers.play, ...cat });
    service.register({
      id: 'edit.undo.meta',
      key: 'z',
      modifiers: { meta: true },
      priority: 0,
      allowInInputs: true,
      handler: viewerHandlers.undo,
      ...cat,
    });
    const index = createBidsBrowserDataset().index('s');
    useBidsStore.getState().reset();
    useBidsStore.setState({ index, exclusions: index.exclusions, scanStatus: 'ready' });
    inFront('bids-explorer');
    render(<Host />);
  });

  afterEach(() => getKeyboardShortcutService().destroy());

  it('moves with J K H L', () => {
    press('j');
    const first = useBidsStore.getState().selectedRunId;
    expect(first).not.toBeNull();
    press('j');
    expect(useBidsStore.getState().selectedRunId).not.toBe(first);
    press('k');
    expect(useBidsStore.getState().selectedRunId).toBe(first);
    press('l');
    expect(useBidsStore.getState().selectedRunId).not.toBe(first);
    press('h');
    expect(useBidsStore.getState().selectedRunId).toBe(first);
    expect(viewerHandlers.labels).not.toHaveBeenCalled();
  });

  it('sends the Edit menu undo to an exclusion only when one is waiting', () => {
    const undoExclusion = vi.fn(async () => undefined);
    useBidsStore.setState({ undoExclusion });
    expect(undoBidsExclusion()).toBe(false);
    useBidsStore.setState({ undoStack: [{ id: 1, added: [] }] });
    expect(undoBidsExclusion()).toBe(true);
    expect(undoExclusion).toHaveBeenCalledTimes(1);
    inFront('orthogonal-locked');
    expect(undoBidsExclusion()).toBe(false);
    useBidsStore.setState({ undoStack: [] });
  });

  it('overrides the viewer keys only while BIDS is in front', () => {
    // 2 returns with the Images view.
    press('2');
    expect(useBidsStore.getState().activeView).toBe('coverage');
    press('1');
    expect(useBidsStore.getState().activeView).toBe('coverage');
    expect(viewerHandlers.layer).not.toHaveBeenCalled();
    press('c');
    expect(useBidsStore.getState().actionRequest?.kind).toBe('compare');
    press(' ');
    expect(useBidsStore.getState().actionRequest?.kind).toBe('quick-look');
    useBidsStore.setState({ exclusionsLoaded: true });
    press('x');
    expect(useBidsStore.getState().actionRequest?.kind).toBe('exclude');
    expect(viewerHandlers.centre).not.toHaveBeenCalled();
    expect(viewerHandlers.play).not.toHaveBeenCalled();

    inFront('orthogonal-locked');
    press('1');
    press('c');
    press('l');
    press(' ');
    expect(viewerHandlers.layer).toHaveBeenCalledOnce();
    expect(viewerHandlers.centre).toHaveBeenCalledOnce();
    expect(viewerHandlers.labels).toHaveBeenCalledOnce();
    expect(viewerHandlers.play).toHaveBeenCalledOnce();
  });

  it('stands down under a modal dialog', () => {
    const dialog = document.createElement('div');
    dialog.setAttribute('aria-modal', 'true');
    document.body.append(dialog);
    press('x');
    dialog.remove();
    expect(useBidsStore.getState().actionRequest).toBeNull();
    expect(viewerHandlers.centre).not.toHaveBeenCalled();
  });

  it('Enter opens the selected run, but a focused control keeps its Enter', () => {
    openSelectedRun.mockClear();
    press('Enter');
    expect(openSelectedRun).toHaveBeenCalledOnce();
    const button = document.createElement('button');
    document.body.append(button);
    button.focus();
    press('Enter');
    button.remove();
    expect(openSelectedRun).toHaveBeenCalledOnce();
  });

  it('⌘Z undoes an exclusion, and the scene otherwise', () => {
    const undoExclusion = vi.fn().mockResolvedValue(undefined);
    useBidsStore.setState({ undoExclusion });
    press('z', { metaKey: true });
    expect(undoExclusion).not.toHaveBeenCalled();
    expect(viewerHandlers.undo).toHaveBeenCalledOnce();

    useBidsStore.setState({
      undoStack: [{ id: 1, added: [], prior: [], context: {} as never }],
    });
    press('z', { metaKey: true });
    expect(undoExclusion).toHaveBeenCalledOnce();
    expect(viewerHandlers.undo).toHaveBeenCalledOnce();

    const field = document.createElement('input');
    document.body.append(field);
    field.focus();
    press('z', { metaKey: true });
    field.remove();
    expect(undoExclusion).toHaveBeenCalledOnce();
    useBidsStore.setState({ undoStack: [] });
  });

  it('stays out of text fields and open dialogs', () => {
    useBidsStore.setState({ actionRequest: null, activeView: 'coverage' });
    const field = document.createElement('input');
    document.body.append(field);
    field.focus();
    for (const key of ['x', 'c', '2']) {
      act(() => {
        field.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
      });
    }
    field.remove();
    expect(useBidsStore.getState().actionRequest).toBeNull();
    expect(useBidsStore.getState().activeView).toBe('coverage');

    const dialog = document.createElement('div');
    dialog.setAttribute('aria-modal', 'true');
    document.body.append(dialog);
    press('x');
    press(' ');
    press('j');
    dialog.remove();
    expect(useBidsStore.getState().actionRequest).toBeNull();
  });

  it('leaves R alone: the dock is reached through ⌘K', () => {
    useLayoutSettingsStore.setState({ bottomDockActiveTab: 'log' });
    press('r');
    expect(useLayoutSettingsStore.getState().bottomDockActiveTab).toBe('log');
    const model = selectBidsModel(useBidsStore.getState());
    const go = buildBidsPaletteCommands(model, null).find((c) => c.title === 'Go to runs in lens')!;
    void go.run();
    expect(useLayoutSettingsStore.getState().bottomDockActiveTab).toBe('bids.runs');
  });
});
