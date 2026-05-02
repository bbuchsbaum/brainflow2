/**
 * LogPanel — bottom dock log slot. Verifies render, level filtering,
 * search, clear, and the EventBus → log handshake via LogService.
 */

import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { act, fireEvent, render, screen, within } from '@testing-library/react';

import { LogPanel } from '../LogPanel';
import { useLogStore, addLogEntry } from '@/stores/logStore';
import { bootstrapLogService, resetLogServiceForTest } from '@/services/LogService';
import { getEventBus } from '@/events/EventBus';

function resetLog() {
  act(() => {
    useLogStore.getState().clear();
  });
}

describe('LogPanel — view', () => {
  beforeEach(() => {
    resetLog();
    resetLogServiceForTest();
  });

  it('renders the empty state with no entries', () => {
    render(<LogPanel />);

    expect(screen.getByTestId('log-panel')).toBeInTheDocument();
    expect(screen.getByTestId('log-panel-empty').textContent).toMatch(/no log entries/i);
  });

  it('renders entries with level + source + message', () => {
    act(() => {
      addLogEntry({ level: 'info', source: 'volume', message: 'Loaded sub-01.nii.gz' });
      addLogEntry({ level: 'error', source: 'volume', message: 'Failed to load broken.nii.gz' });
    });

    render(<LogPanel />);

    const body = screen.getByTestId('log-panel-body');
    const rows = within(body).getAllByText(/loaded|failed/i);
    expect(rows.length).toBe(2);
    // Both levels visible by default.
    expect(body.querySelectorAll('[data-level="info"]').length).toBe(1);
    expect(body.querySelectorAll('[data-level="error"]').length).toBe(1);
  });

  it('filters by level (toggling info hides info entries)', () => {
    act(() => {
      addLogEntry({ level: 'info', source: 'volume', message: 'info one' });
      addLogEntry({ level: 'error', source: 'volume', message: 'error one' });
    });

    render(<LogPanel />);

    expect(screen.getByTestId('log-panel-body').textContent).toContain('info one');
    expect(screen.getByTestId('log-panel-body').textContent).toContain('error one');

    act(() => {
      fireEvent.click(screen.getByTestId('log-panel-level-info'));
    });

    expect(screen.getByTestId('log-panel-body').textContent).not.toContain('info one');
    expect(screen.getByTestId('log-panel-body').textContent).toContain('error one');
  });

  it('filters by search query against message and source', () => {
    act(() => {
      addLogEntry({ level: 'info', source: 'volume', message: 'loaded T1' });
      addLogEntry({ level: 'info', source: 'surface', message: 'loaded lh.pial' });
    });

    render(<LogPanel />);

    const search = screen.getByTestId('log-panel-search');
    act(() => {
      fireEvent.change(search, { target: { value: 'pial' } });
    });

    expect(screen.getByTestId('log-panel-body').textContent).not.toContain('loaded T1');
    expect(screen.getByTestId('log-panel-body').textContent).toContain('loaded lh.pial');

    act(() => {
      fireEvent.change(search, { target: { value: 'volume' } });
    });

    expect(screen.getByTestId('log-panel-body').textContent).toContain('loaded T1');
    expect(screen.getByTestId('log-panel-body').textContent).not.toContain('loaded lh.pial');
  });

  it('clears the log when the user clicks the trash button', () => {
    act(() => {
      addLogEntry({ level: 'info', source: 'volume', message: 'loaded' });
    });

    render(<LogPanel />);

    const clear = screen.getByTestId('log-panel-clear');
    expect(clear).not.toBeDisabled();

    act(() => {
      fireEvent.click(clear);
    });

    expect(screen.getByTestId('log-panel-empty')).toBeInTheDocument();
    expect(useLogStore.getState().entries.length).toBe(0);
  });

  it('refuses to disable every level (keeps at least one active)', () => {
    render(<LogPanel />);

    act(() => {
      fireEvent.click(screen.getByTestId('log-panel-level-info'));
      fireEvent.click(screen.getByTestId('log-panel-level-warn'));
      // Third click would empty the set; the panel should refuse.
      fireEvent.click(screen.getByTestId('log-panel-level-error'));
    });

    // The error level should still be active.
    expect(screen.getByTestId('log-panel-level-error').getAttribute('data-active')).toBe('true');
  });
});

describe('LogService — EventBus handshake', () => {
  beforeEach(() => {
    resetLog();
    resetLogServiceForTest();
  });

  afterEach(() => {
    resetLogServiceForTest();
  });

  it('records volume load completions and errors as log entries', () => {
    bootstrapLogService();
    const bus = getEventBus();

    act(() => {
      bus.emit('volume.load.complete', {
        volumeId: 'vol-1',
        layerId: 'layer-12345abcdef',
        source: '/data/sub-01.nii.gz',
        duration: 250,
      });
      bus.emit('volume.load.error', {
        volumeId: 'vol-2',
        source: '/data/broken.nii.gz',
        error: new Error('parse failure'),
      });
    });

    const entries = useLogStore.getState().entries;
    expect(entries.length).toBe(2);
    expect(entries[0].level).toBe('info');
    expect(entries[0].message).toMatch(/sub-01\.nii\.gz/);
    expect(entries[1].level).toBe('error');
    expect(entries[1].message).toMatch(/broken\.nii\.gz/);
    expect(entries[1].message).toMatch(/parse failure/);
  });

  it('records surface load events and atlas evictions', () => {
    bootstrapLogService();
    const bus = getEventBus();

    act(() => {
      bus.emit('surface.loaded', {
        path: '/data/lh.pial.gii',
        filename: 'lh.pial.gii',
        handle: 'srf-abcdef1234567890',
      });
      bus.emit('atlas.eviction', {
        layerId: null,
        stats: null,
        timestamp: Date.now(),
        reason: 'auto',
      });
    });

    const entries = useLogStore.getState().entries;
    expect(entries.some((e) => e.source === 'surface' && /lh\.pial/.test(e.message))).toBe(true);
    expect(entries.some((e) => e.source === 'atlas' && e.level === 'warn')).toBe(true);
  });

  it('teardown unsubscribes — no further entries after resetLogServiceForTest', () => {
    bootstrapLogService();
    resetLogServiceForTest();

    const bus = getEventBus();
    act(() => {
      bus.emit('volume.load.error', {
        volumeId: 'vol-x',
        source: '/data/x.nii.gz',
        error: new Error('after teardown'),
      });
    });

    expect(useLogStore.getState().entries.length).toBe(0);
  });
});
