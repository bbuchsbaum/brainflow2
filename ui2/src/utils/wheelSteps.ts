/**
 * Wheel → slice/time steps for the slice views.
 *
 * Wheel up (away from the user, deltaY < 0) steps forward: superior in axial,
 * anterior in coronal, right in sagittal, the next frame in time mode.
 *
 * A mouse notch (line/page deltas, or a legacy wheelDelta that is a multiple
 * of 120) is exactly one step, however fast the notches come: a burst of ten
 * notches moves ten slices. Pixel deltas from a trackpad or a smooth-scrolling
 * mouse accumulate, one step per WHEEL_PIXELS_PER_STEP, so a swipe moves a
 * sensible distance instead of one slice per event. The first event after a
 * pause always moves one step, and the remainder is dropped so a new gesture
 * starts clean.
 */

export const WHEEL_PIXELS_PER_STEP = 40;
export const WHEEL_GESTURE_GAP_MS = 250;
/** Cap per event so a single momentum spike cannot race through the volume. */
export const WHEEL_MAX_STEPS_PER_EVENT = 3;

export interface WheelLike {
  deltaX: number;
  deltaY: number;
  deltaMode: number;
  shiftKey: boolean;
  timeStamp: number;
  /** Non-standard (WebKit/Blink): ±120 per classic mouse notch. */
  wheelDeltaY?: number;
}

/** Steps for one wheel event (positive = forward); stateful across a gesture. */
export type WheelStepper = (event: WheelLike) => number;

export function createWheelStepper(): WheelStepper {
  let accumulated = 0;
  let lastTime = -Infinity;

  return (event) => {
    // macOS turns Shift+wheel into a horizontal scroll.
    const delta = event.deltaY !== 0 ? event.deltaY : event.shiftKey ? event.deltaX : 0;
    if (delta === 0) return 0;

    const newGesture = event.timeStamp - lastTime > WHEEL_GESTURE_GAP_MS;
    lastTime = event.timeStamp;

    const legacy = event.wheelDeltaY;
    const discrete =
      event.deltaMode !== 0 || (typeof legacy === 'number' && legacy !== 0 && legacy % 120 === 0);
    if (discrete) {
      accumulated = 0;
      return delta < 0 ? 1 : -1;
    }

    // The first event of a gesture always moves, so one slow notch of a
    // mouse that reports small pixel deltas is still one slice.
    if (newGesture) {
      accumulated = 0;
      return delta < 0 ? 1 : -1;
    }
    accumulated += -delta;
    const raw = Math.trunc(accumulated / WHEEL_PIXELS_PER_STEP);
    if (raw === 0) return 0;
    accumulated -= raw * WHEEL_PIXELS_PER_STEP;
    return Math.max(-WHEEL_MAX_STEPS_PER_EVENT, Math.min(WHEEL_MAX_STEPS_PER_EVENT, raw));
  };
}
