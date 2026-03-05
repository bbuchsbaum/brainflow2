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
  activeRenderContextRef,
  mouseActiveViewRef,
  layoutActiveViewRef,
  emitMock,
} = vi.hoisted(() => {
  type Registration = {
    id: string;
    key: string;
    modifiers?: { shift?: boolean };
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

    expect(getSliceRangeMock).toHaveBeenCalledWith('sagittal');
    expect(updateSlicePositionMock).toHaveBeenCalledWith('sagittal', 12);
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
});

