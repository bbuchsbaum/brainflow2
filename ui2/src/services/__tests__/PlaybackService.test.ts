import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { getEventBus } from '@/events/EventBus';

// --- TimeNavigationService mock -------------------------------------------
// A configurable fake standing in for the real time navigation singleton.
const timeNavState = vi.hoisted(() => ({
  has4D: true,
  currentTimepoint: 0,
  totalTimepoints: 4,
  tr: 2 as number | null,
}));

const setTimepoint = vi.hoisted(() =>
  vi.fn((t: number) => {
    timeNavState.currentTimepoint = t;
  }),
);

const nextTimepoint = vi.hoisted(() => vi.fn());

vi.mock('@/services/TimeNavigationService', () => ({
  getTimeNavigationService: () => ({
    has4DVolume: () => timeNavState.has4D,
    getTimeInfo: () =>
      timeNavState.has4D
        ? {
            currentTimepoint: timeNavState.currentTimepoint,
            totalTimepoints: timeNavState.totalTimepoints,
            tr: timeNavState.tr,
            currentTime: timeNavState.currentTimepoint * (timeNavState.tr ?? 0),
            totalTime: timeNavState.totalTimepoints * (timeNavState.tr ?? 0),
          }
        : null,
    setTimepoint,
    nextTimepoint,
  }),
}));

import { getPlaybackService, PLAYBACK_SPEEDS } from '@/services/PlaybackService';

// --- requestAnimationFrame harness ----------------------------------------
// Capture the single pending rAF callback so tests can drive ticks with an
// explicit timestamp (the loop re-schedules itself each frame).
let rafCallback: FrameRequestCallback | null = null;
let rafId = 0;

function flushFrame(now: number): void {
  const cb = rafCallback;
  rafCallback = null;
  if (cb) {
    cb(now);
  }
}

beforeEach(() => {
  rafCallback = null;
  rafId = 0;
  setTimepoint.mockClear();
  nextTimepoint.mockClear();
  timeNavState.has4D = true;
  timeNavState.currentTimepoint = 0;
  timeNavState.totalTimepoints = 4;
  timeNavState.tr = 2;

  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
    rafCallback = cb;
    return ++rafId;
  });
  vi.stubGlobal('cancelAnimationFrame', () => {
    rafCallback = null;
  });

  // Reset singleton state between tests.
  const playback = getPlaybackService();
  playback.stop();
  playback.setSpeed(1);
});

afterEach(() => {
  getPlaybackService().stop();
  vi.unstubAllGlobals();
});

describe('PlaybackService', () => {
  it('toggle starts and stops playback, emitting playback.stateChanged', () => {
    const playback = getPlaybackService();
    playback.start();

    const states: boolean[] = [];
    const unsub = getEventBus().on('playback.stateChanged', (d) => states.push(d.playing));

    getEventBus().emit('playback.toggle', {});
    expect(playback.getIsPlaying()).toBe(true);

    getEventBus().emit('playback.toggle', {});
    expect(playback.getIsPlaying()).toBe(false);

    expect(states).toEqual([true, false]);
    unsub();
  });

  it('advances the timepoint on each tick at TR/speed cadence', () => {
    const playback = getPlaybackService();
    playback.start();
    getEventBus().emit('playback.toggle', {}); // play

    // tr=2s, speed=1 -> tickMs = 2000. First frame primes lastTick=0,
    // so a tick at t=2000 should advance.
    flushFrame(2000);
    expect(setTimepoint).toHaveBeenLastCalledWith(1);

    timeNavState.currentTimepoint = 1;
    flushFrame(4000);
    expect(setTimepoint).toHaveBeenLastCalledWith(2);

    expect(setTimepoint).toHaveBeenCalledTimes(2);
  });

  it('does not advance before the tick interval elapses', () => {
    const playback = getPlaybackService();
    playback.start();
    getEventBus().emit('playback.toggle', {});

    // Below tickMs (2000) -> no advance.
    flushFrame(1000);
    expect(setTimepoint).not.toHaveBeenCalled();
  });

  it('wraps from the last timepoint back to zero (loops)', () => {
    timeNavState.currentTimepoint = 3; // last frame of a 4-frame series
    const playback = getPlaybackService();
    playback.start();
    getEventBus().emit('playback.toggle', {});

    flushFrame(2000);
    // (3 + 1) % 4 === 0
    expect(setTimepoint).toHaveBeenLastCalledWith(0);
  });

  it('honors the speed multiplier (4x => quarter interval)', () => {
    const playback = getPlaybackService();
    playback.setSpeed(4);
    playback.start();
    getEventBus().emit('playback.toggle', {});

    // tickMs = 2000 / 4 = 500.
    flushFrame(400);
    expect(setTimepoint).not.toHaveBeenCalled();
    flushFrame(500);
    expect(setTimepoint).toHaveBeenLastCalledWith(1);
  });

  it('uses the fallback interval when TR is null', () => {
    timeNavState.tr = null;
    const playback = getPlaybackService();
    playback.start();
    getEventBus().emit('playback.toggle', {});

    // Fallback is 100ms; below it should not advance, at/after it should.
    flushFrame(50);
    expect(setTimepoint).not.toHaveBeenCalled();
    flushFrame(100);
    expect(setTimepoint).toHaveBeenLastCalledWith(1);
  });

  it('does not start when no 4D volume is loaded', () => {
    timeNavState.has4D = false;
    const playback = getPlaybackService();
    playback.start();

    let lastState: boolean | null = null;
    const unsub = getEventBus().on('playback.stateChanged', (d) => (lastState = d.playing));

    getEventBus().emit('playback.toggle', {});
    expect(playback.getIsPlaying()).toBe(false);
    expect(lastState).toBeNull(); // no state change emitted
    unsub();
  });

  it('does not start when the series has a single timepoint', () => {
    timeNavState.totalTimepoints = 1;
    const playback = getPlaybackService();
    playback.start();

    getEventBus().emit('playback.toggle', {});
    expect(playback.getIsPlaying()).toBe(false);
  });

  it('auto-stops mid-playback when the 4D volume disappears', () => {
    const playback = getPlaybackService();
    playback.start();
    getEventBus().emit('playback.toggle', {});
    expect(playback.getIsPlaying()).toBe(true);

    // The volume is removed; the next frame should pause and not advance.
    timeNavState.has4D = false;
    flushFrame(2000);

    expect(playback.getIsPlaying()).toBe(false);
    expect(setTimepoint).not.toHaveBeenCalled();
  });

  it('stop() cancels the loop and unsubscribes from playback.toggle', () => {
    const playback = getPlaybackService();
    playback.start();
    getEventBus().emit('playback.toggle', {});
    expect(playback.getIsPlaying()).toBe(true);

    playback.stop();
    // No pending frame remains.
    expect(rafCallback).toBeNull();

    // After stop(), toggle is no longer wired up.
    getEventBus().emit('playback.toggle', {});
    expect(playback.getIsPlaying()).toBe(false);
  });

  it('start() is idempotent — a double start keeps a single working subscription', () => {
    const playback = getPlaybackService();
    playback.start();
    playback.start(); // StrictMode-style double invoke

    // A single stop() should fully tear down despite two start() calls.
    playback.stop();
    getEventBus().emit('playback.toggle', {});
    expect(playback.getIsPlaying()).toBe(false);
  });

  it('re-subscribes after stop() so a later start() works again', () => {
    const playback = getPlaybackService();
    playback.start();
    playback.stop();

    // Mirrors a StrictMode remount: start again after teardown.
    playback.start();
    getEventBus().emit('playback.toggle', {});
    expect(playback.getIsPlaying()).toBe(true);
  });

  it('exposes the supported speed multipliers', () => {
    expect(PLAYBACK_SPEEDS).toEqual([1, 2, 4]);
  });
});
