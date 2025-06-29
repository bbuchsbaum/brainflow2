/**
 * Pure interaction helpers for slice viewing
 * 
 * These utilities handle common interaction patterns like
 * windowing, measurements, and annotations.
 */

import type { Vec2, Vec3 } from '../geometry/types';

/**
 * Window/level adjustment from drag gesture
 */
export interface WindowLevelState {
  level: number;
  width: number;
}

export function adjustWindowLevel(
  current: WindowLevelState,
  dragDelta: Vec2,
  sensitivity = 1.0
): WindowLevelState {
  // Horizontal drag adjusts window width
  // Vertical drag adjusts window level
  return {
    level: current.level + dragDelta.y * sensitivity,
    width: Math.max(1, current.width + dragDelta.x * sensitivity)
  };
}

/**
 * Distance measurement between two points
 */
export interface Measurement {
  id: string;
  start: Vec3;
  end: Vec3;
  distance: number;
}

export function createMeasurement(
  start: Vec3,
  end: Vec3,
  id = crypto.randomUUID()
): Measurement {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const dz = end.z - start.z;
  const distance = Math.sqrt(dx * dx + dy * dy + dz * dz);
  
  return { id, start, end, distance };
}

/**
 * ROI (Region of Interest) rectangle
 */
export interface ROI {
  id: string;
  topLeft: Vec3;
  bottomRight: Vec3;
  stats?: {
    mean: number;
    std: number;
    min: number;
    max: number;
    area: number;
  };
}

export function createROI(
  corner1: Vec3,
  corner2: Vec3,
  id = crypto.randomUUID()
): ROI {
  // Normalize to top-left and bottom-right
  const topLeft: Vec3 = {
    x: Math.min(corner1.x, corner2.x),
    y: Math.min(corner1.y, corner2.y),
    z: corner1.z // Keep same slice
  };
  
  const bottomRight: Vec3 = {
    x: Math.max(corner1.x, corner2.x),
    y: Math.max(corner1.y, corner2.y),
    z: corner1.z
  };
  
  return { id, topLeft, bottomRight };
}

/**
 * Annotation with text label
 */
export interface Annotation {
  id: string;
  position: Vec3;
  text: string;
  timestamp: number;
}

export function createAnnotation(
  position: Vec3,
  text: string,
  id = crypto.randomUUID()
): Annotation {
  return {
    id,
    position,
    text,
    timestamp: Date.now()
  };
}

/**
 * Gesture recognizer for pinch zoom
 */
export interface PinchState {
  active: boolean;
  startDistance: number;
  currentDistance: number;
  center: Vec2;
}

export function updatePinchState(
  touch1: Vec2,
  touch2: Vec2,
  previousState?: PinchState
): PinchState {
  const dx = touch2.x - touch1.x;
  const dy = touch2.y - touch1.y;
  const distance = Math.sqrt(dx * dx + dy * dy);
  
  const center: Vec2 = {
    x: (touch1.x + touch2.x) / 2,
    y: (touch1.y + touch2.y) / 2
  };
  
  if (!previousState || !previousState.active) {
    return {
      active: true,
      startDistance: distance,
      currentDistance: distance,
      center
    };
  }
  
  return {
    ...previousState,
    currentDistance: distance,
    center
  };
}

export function getPinchZoomFactor(state: PinchState): number {
  if (!state.active || state.startDistance === 0) return 1;
  return state.currentDistance / state.startDistance;
}

/**
 * Keyboard shortcut handlers
 */
export interface KeyboardAction {
  key: string;
  ctrl?: boolean;
  shift?: boolean;
  alt?: boolean;
  action: () => void;
  description: string;
}

export const defaultKeyboardActions: KeyboardAction[] = [
  {
    key: 'ArrowUp',
    action: () => 'next-slice',
    description: 'Next slice'
  },
  {
    key: 'ArrowDown',
    action: () => 'prev-slice',
    description: 'Previous slice'
  },
  {
    key: 'r',
    action: () => 'reset-view',
    description: 'Reset view'
  },
  {
    key: 'c',
    action: () => 'toggle-crosshair',
    description: 'Toggle crosshair'
  },
  {
    key: 'm',
    action: () => 'measure-tool',
    description: 'Measure tool'
  },
  {
    key: 'a',
    action: () => 'annotate-tool',
    description: 'Annotate tool'
  },
  {
    key: '+',
    action: () => 'zoom-in',
    description: 'Zoom in'
  },
  {
    key: '-',
    action: () => 'zoom-out',
    description: 'Zoom out'
  }
];

export function matchKeyboardAction(
  event: KeyboardEvent,
  actions: KeyboardAction[]
): string | null {
  for (const action of actions) {
    if (
      event.key === action.key &&
      !!event.ctrlKey === !!action.ctrl &&
      !!event.shiftKey === !!action.shift &&
      !!event.altKey === !!action.alt
    ) {
      const result = action.action();
      return typeof result === 'string' ? result : null;
    }
  }
  return null;
}

/**
 * Mouse cursor styles for different tools
 */
export type ToolType = 'pan' | 'window' | 'measure' | 'roi' | 'annotate' | 'crosshair';

export function getCursorForTool(tool: ToolType, isActive = false): string {
  switch (tool) {
    case 'pan':
      return isActive ? 'grabbing' : 'grab';
    case 'window':
      return 'ns-resize';
    case 'measure':
      return 'crosshair';
    case 'roi':
      return 'crosshair';
    case 'annotate':
      return 'text';
    case 'crosshair':
    default:
      return 'crosshair';
  }
}

/**
 * Snap to pixel grid
 */
export function snapToPixel(value: number, pixelSize: number): number {
  return Math.round(value / pixelSize) * pixelSize;
}

/**
 * Constrain a point to viewport bounds
 */
export function constrainToViewport(
  point: Vec2,
  viewportSize: Vec2
): Vec2 {
  return {
    x: Math.max(0, Math.min(viewportSize.x - 1, point.x)),
    y: Math.max(0, Math.min(viewportSize.y - 1, point.y))
  };
}