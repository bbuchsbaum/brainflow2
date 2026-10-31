/**
 * Pointer gestures of the slice views, listed in the Shortcuts dialog beside
 * the registered keys (QA features 2026-10-31 §1: the dialog lists zoom,
 * pan and Fit). Keys come from KeyboardShortcutService; these are not keys.
 */
export interface ViewGesture {
  id: string;
  gesture: string;
  description: string;
}

export const VIEW_GESTURES: readonly ViewGesture[] = [
  { id: 'gesture.scroll', gesture: 'Scroll', description: 'Step slices (⇧ for 10)' },
  { id: 'gesture.zoom', gesture: '⌥ Scroll / pinch', description: 'Zoom about the pointer' },
  { id: 'gesture.pan', gesture: 'Space-drag / middle drag', description: 'Pan the view' },
  { id: 'gesture.window', gesture: 'Right drag', description: 'Window and level' },
];
