/**
 * plotModeStore — persistence
 * (mote `bd-01KQJSP4GWGW9AJZRNBE5TVX0M`).
 *
 * Verifies the store round-trips both `activePlotModeId` and
 * `selectionSource` through localStorage so a refresh keeps the user's
 * last manual pick. The pre-mote store had no persistence; once the
 * workspace startup wipe was removed, plot-mode state needed to follow
 * the same persistence story so the visible mode survives reload.
 */

import { describe, expect, it, beforeEach } from 'vitest';

import { usePlotModeStore } from '../plotModeStore';

const STORAGE_KEY = 'brainflow2-plot-mode';

function readPersistedState(): { activePlotModeId: string | null; selectionSource: string } | null {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return null;
  const parsed = JSON.parse(raw) as { state: { activePlotModeId: string | null; selectionSource: string } };
  return parsed.state;
}

describe('plotModeStore persistence', () => {
  beforeEach(() => {
    localStorage.removeItem(STORAGE_KEY);
    usePlotModeStore.getState().resetPlotModeStore();
  });

  it('persists activePlotModeId and selectionSource on a user pick', () => {
    usePlotModeStore.getState().setActivePlotMode('crosshair-time-series');

    const persisted = readPersistedState();
    expect(persisted).toMatchObject({
      activePlotModeId: 'crosshair-time-series',
      selectionSource: 'user',
    });
  });

  it('persists auto-selected mode + auto source when set via the auto resolver', () => {
    usePlotModeStore.getState().setAutoActivePlotMode('histogram');

    const persisted = readPersistedState();
    expect(persisted).toMatchObject({
      activePlotModeId: 'histogram',
      selectionSource: 'auto',
    });
  });

  it('user pick is preserved against a subsequent auto resolver call (auto is a no-op when source=user)', () => {
    usePlotModeStore.getState().setActivePlotMode('histogram');
    usePlotModeStore.getState().setAutoActivePlotMode('crosshair-time-series');

    const persisted = readPersistedState();
    expect(persisted).toMatchObject({
      activePlotModeId: 'histogram',
      selectionSource: 'user',
    });
  });

  it('resetPlotModeStore clears both fields and persists the reset', () => {
    usePlotModeStore.getState().setActivePlotMode('histogram');
    usePlotModeStore.getState().resetPlotModeStore();

    const state = usePlotModeStore.getState();
    expect(state.activePlotModeId).toBeNull();
    expect(state.selectionSource).toBe('auto');

    const persisted = readPersistedState();
    expect(persisted).toMatchObject({
      activePlotModeId: null,
      selectionSource: 'auto',
    });
  });
});
