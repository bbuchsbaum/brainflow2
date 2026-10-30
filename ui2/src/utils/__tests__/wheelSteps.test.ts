import { describe, expect, it } from 'vitest';
import {
  createWheelStepper,
  WHEEL_GESTURE_GAP_MS,
  WHEEL_MAX_STEPS_PER_EVENT,
  WHEEL_PIXELS_PER_STEP,
  type WheelLike,
} from '../wheelSteps';

const wheel = (over: Partial<WheelLike>): WheelLike => ({
  deltaX: 0,
  deltaY: 0,
  deltaMode: 0,
  shiftKey: false,
  timeStamp: 0,
  ...over,
});

describe('createWheelStepper', () => {
  it('steps forward on wheel up and backward on wheel down', () => {
    const step = createWheelStepper();
    expect(step(wheel({ deltaY: -100, wheelDeltaY: 120, timeStamp: 0 }))).toBe(1);
    expect(step(wheel({ deltaY: 100, wheelDeltaY: -120, timeStamp: 1000 }))).toBe(-1);
  });

  it('moves one step per mouse notch even in a fast burst (10 notches -> 10 steps)', () => {
    const step = createWheelStepper();
    let total = 0;
    for (let i = 0; i < 10; i += 1) {
      total += step(wheel({ deltaY: -100, wheelDeltaY: 120, timeStamp: i * 5 }));
    }
    expect(total).toBe(10);
  });

  it('treats line- and page-mode deltas as one notch each', () => {
    const step = createWheelStepper();
    expect(step(wheel({ deltaY: -3, deltaMode: 1, timeStamp: 0 }))).toBe(1);
    expect(step(wheel({ deltaY: 1, deltaMode: 2, timeStamp: 5 }))).toBe(-1);
  });

  it('accumulates trackpad pixels into one step per WHEEL_PIXELS_PER_STEP', () => {
    const step = createWheelStepper();
    // First event of a gesture always moves.
    expect(step(wheel({ deltaY: -2, timeStamp: 0 }))).toBe(1);
    let total = 0;
    for (let i = 1; i <= 40; i += 1) {
      total += step(wheel({ deltaY: -5, timeStamp: i * 10 }));
    }
    expect(total).toBe(Math.trunc((40 * 5) / WHEEL_PIXELS_PER_STEP));
  });

  it('caps a momentum spike and restarts after a pause', () => {
    const step = createWheelStepper();
    step(wheel({ deltaY: 4, timeStamp: 0 }));
    expect(step(wheel({ deltaY: 10_000, timeStamp: 10 }))).toBe(-WHEEL_MAX_STEPS_PER_EVENT);
    // After a pause a small delta is again a full step in its own direction.
    expect(step(wheel({ deltaY: -1, timeStamp: 10 + WHEEL_GESTURE_GAP_MS + 1 }))).toBe(1);
  });

  it('reads Shift+wheel from deltaX (macOS turns it into a horizontal scroll)', () => {
    const step = createWheelStepper();
    expect(step(wheel({ deltaX: -100, deltaMode: 1, shiftKey: true, timeStamp: 0 }))).toBe(1);
    expect(step(wheel({ deltaX: -100, deltaMode: 1, timeStamp: 1000 }))).toBe(0);
  });
});
