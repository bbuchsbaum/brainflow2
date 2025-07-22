/**
 * StatusBar Type Definitions
 * Provides a flexible abstraction for status bar items
 */

import type { ReactNode } from 'react';

export type StatusSlot = {
  /** Stable id - used as React key and by mutators */
  id: 'coordSys' | 'crosshair' | 'mouse' | 'fps' | 'gpu' | 'volume' | 'layer' | string;
  
  /** Static label portion (e.g., "Coordinate system:") */
  label: string;
  
  /** Dynamic value (string or ReactNode) */
  value: string | ReactNode;
  
  /** Optional fixed width (any CSS length) */
  width?: number | string; // e.g., '18ch', '120px', '15%'
  
  /** Text alignment inside the slot */
  align?: 'left' | 'center' | 'right';
};

/** Type for status updates */
export type StatusUpdate = {
  id: string;
  value: string | ReactNode;
};

/** Type for batch status updates */
export type StatusBatchUpdate = [string, string | ReactNode][];