import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useKeyboardShortcuts } from '../useKeyboardShortcuts';

const {
  registrations,
  registerMock,
  unregisterMocks,
  timeModeRef,
  has4DRef,
  previousTimepointMock,
  nextTimepointMock,
  jumpTimepointsMock,
  toggleModeMock,
  getSliceRangeMock,
  updateSlicePositionMock,
  stepSliceMock,
  activeRenderContextRef,
  mouseActiveViewRef,
  layoutActiveViewRef,
  emitMock,
} = vi.hoisted(() => {
  type Registration = {
    id: string;
    key: string;
    modifiers?: { shift?: boolean; meta?: boolean; ctrl?: boolean };
    when?: () => boolean;
    handler: () => void;
  };

  const collected: Registration[] = [];
  const unregisterFns: Array<ReturnType<typeof vi.fn>> = [];

  const register = vi.fn((registration: Registration) => {
    collected.push(registration);
    const unregister = vi.fn();
    unregisterFns.push(unregister);
    return unregister;
  });

  return {
    registrations: collected,
    registerMock: register,
    unregisterMocks: unregisterFns,
    timeModeRef: { current: 'slice' as 'slice' | 'time' },
    has4DRef: { current: false },
    previousTimepointMock: vi.fn(),
    nextTimepointMock: vi.fn(),
    jumpTimepointsMock: vi.fn(),
    toggleModeMock: vi.fn(),
    getSliceRangeMock: vi.fn(() => ({ min: 0, max: 20, step: 2, current: 10 })),
    updateSlicePositionMock: vi.fn(),
    stepSliceMock: vi.fn(),
    activeRenderContextRef: { current: null as string | null },
    mouseActiveViewRef: { current: null as 'axial' | 'sagittal' | 'coronal' | null },
    layoutActiveViewRef: { current: 'axial' as 'axial' | 'sagittal' | 'coronal' },
    emitMock: vi.fn(),
  };
});

vi.mock('@/services/KeyboardShortcutService', () => ({
  getKeyboardShortcutService: () => ({
    register: registerMock,
  }),
}));

vi.mock('../useTimeNavigation', () => ({
  useTimeNavigation: () => ({
    has4DVolume: () => has4DRef.current,
  }),
}));

vi.mock('@/services/TimeNavigationService', () => ({
  getTimeNavigationService: () => ({
    previousTimepoint: previousTimepointMock,
    nextTimepoint: nextTimepointMock,
    jumpTimepoints: jumpTimepointsMock,
    toggleMode: toggleModeMock,
    getMode: () => timeModeRef.current,
  }),
}));

vi.mock('@/services/SliceNavigationService', () => ({
  getSliceNavigationService: () => ({
    getSliceRange: getSliceRangeMock,
    updateSlicePosition: updateSlicePositionMock,
    stepSlice: stepSliceMock,
  }),
}));

vi.mock('@/stores/activeRenderContextStore', () => ({
  useActiveRenderContextStore: {
    getState: () => ({
      activeId: activeRenderContextRef.current,
    }),
  },
}));

vi.mock('@/stores/mouseCoordinateStore', () => ({
  useMouseCoordinateStore: {
    getState: () => ({
      activeView: mouseActiveViewRef.current,
    }),
  },
}));

vi.mock('@/stores/layoutStateStore', () => ({
  useLayoutStateStore: {
    getState: () => ({
      layoutState: {
        activeView: layoutActiveViewRef.current,
      },
    }),
  },
}));

vi.mock('@/events/EventBus', () => ({
  getEventBus: () => ({
    emit: emitMock,
  }),
}));

function findRegistration(id: string) {
  const registration = registrations.find((item) => item.id === id);
  if (!registration) {
    throw new Error(`Expected shortcut registration '${id}'`);
  }
  return registration;
}

describe('useKeyboardShortcuts', () => {
  beforeEach(() => {
    registrations.length = 0;
    unregisterMocks.length = 0;
    registerMock.mockClear();
    previousTimepointMock.mockReset();
    nextTimepointMock.mockReset();
    jumpTimepointsMock.mockReset();
    toggleModeMock.mockReset();
    getSliceRangeMock.mockClear();
    updateSlicePositionMock.mockReset();
    stepSliceMock.mockReset();
    emitMock.mockReset();
    has4DRef.current = false;
    timeModeRef.current = 'slice';
    activeRenderContextRef.current = null;
    mouseActiveViewRef.current = null;
    layoutActiveViewRef.current = 'axial';
  });

  it('navigates slices in the active render view when time mode is inactive', () => {
    activeRenderContextRef.current = 'sagittal';
    renderHook(() => useKeyboardShortcuts());

    const sliceNext = findRegistration('slice.next');
    expect(sliceNext.when?.()).toBe(true);

    sliceNext.handler();

    // One navigation voxel up, in the active view (the service steps on the
    // snapping reference grid; see SliceNavigationService.snap.test).
    expect(stepSliceMock).toHaveBeenCalledWith('sagittal', 1);
  });

  it('keeps Arrow navigation bound to timepoints when in 4D time mode', () => {
    has4DRef.current = true;
    timeModeRef.current = 'time';
    renderHook(() => useKeyboardShortcuts());

    const timeNext = findRegistration('time.next');
    const sliceNext = findRegistration('slice.next');

    expect(timeNext.when?.()).toBe(true);
    expect(sliceNext.when?.()).toBe(false);

    timeNext.handler();
    expect(nextTimepointMock).toHaveBeenCalledTimes(1);
    expect(updateSlicePositionMock).not.toHaveBeenCalled();
  });

  it('steps slices with Up/Down (±1, Shift ±10) and PageUp/PageDown (±10) in the active view', () => {
    mouseActiveViewRef.current = 'coronal';
    renderHook(() => useKeyboardShortcuts());

    const cases: Array<[string, string, boolean, number]> = [
      ['slice.up', 'ArrowUp', false, 1],
      ['slice.down', 'ArrowDown', false, -1],
      ['slice.up10', 'ArrowUp', true, 10],
      ['slice.down10', 'ArrowDown', true, -10],
      ['slice.pageUp', 'PageUp', false, 10],
      ['slice.pageDown', 'PageDown', false, -10],
    ];
    for (const [id, key, shift, steps] of cases) {
      const registration = findRegistration(id);
      expect(registration.key).toBe(key);
      expect(Boolean(registration.modifiers?.shift)).toBe(shift);
      stepSliceMock.mockClear();
      registration.handler();
      expect(stepSliceMock).toHaveBeenCalledWith('coronal', steps);
    }
  });

  it('keeps Up/Down on slices in 4D time mode (Left/Right step time there)', () => {
    has4DRef.current = true;
    timeModeRef.current = 'time';
    renderHook(() => useKeyboardShortcuts());

    const up = findRegistration('slice.up');
    expect(up.when?.()).toBe(true); // focus on <body>
    up.handler();
    expect(stepSliceMock).toHaveBeenCalledWith('axial', 1);
    expect(nextTimepointMock).not.toHaveBeenCalled();
  });

  it('Space emits playback.toggle', () => {
    renderHook(() => useKeyboardShortcuts());
    const space = findRegistration('time.playPause');
    expect(space.key).toBe(' ');
    space.handler();
    expect(emitMock).toHaveBeenCalledWith('playback.toggle', {});
  });

  it('claims Cmd/Ctrl+A outside fields and clears the page selection', () => {
    renderHook(() => useKeyboardShortcuts());
    const meta = findRegistration('app.selectAll.meta');
    const ctrl = findRegistration('app.selectAll.ctrl');
    expect(meta.modifiers).toEqual({ meta: true });
    expect(ctrl.modifiers).toEqual({ ctrl: true });

    document.body.innerHTML = '<p>panel label</p>';
    const range = document.createRange();
    range.selectNodeContents(document.body);
    window.getSelection()?.addRange(range);
    expect(window.getSelection()?.rangeCount).toBe(1);
    meta.handler();
    expect(window.getSelection()?.rangeCount).toBe(0);
  });

  it('leaves Up/Down/PageUp/PageDown to trees, lists, logs and scrolling panels', () => {
    renderHook(() => useKeyboardShortcuts());
    document.body.innerHTML = `
      <div role="tree"><div role="treeitem" tabindex="0" id="row">a</div></div>
      <div role="log" tabindex="0" id="log">l</div>
      <div data-view-id="axial" tabindex="-1" id="view"></div>`;
    for (const id of ['slice.up', 'slice.down', 'slice.pageUp', 'slice.pageDown']) {
      const registration = findRegistration(id);
      document.getElementById('row')!.focus();
      expect(registration.when?.()).toBe(false);
      document.getElementById('log')!.focus();
      expect(registration.when?.()).toBe(false);
      document.getElementById('view')!.focus();
      expect(registration.when?.()).toBe(true);
    }
    document.body.innerHTML = '';
  });
});
