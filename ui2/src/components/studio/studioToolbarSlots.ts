import { createContext } from 'react';

/**
 * Beside the lens switch on the toolbar's first row: the active lens's view
 * switch (Population's Summary | Montage). Null for a lens rendered on its own.
 */
export const StudioViewSlotContext = createContext<HTMLElement | null>(null);

/**
 * Inside the toolbar's one "More" menu: the active lens's rarely used
 * controls. Null for a lens rendered on its own, which keeps its own menus.
 */
export const StudioMenuSlotContext = createContext<HTMLElement | null>(null);

/**
 * The ⋯ menu's Data section: the active lens's commands that save or open
 * data (Population's Save calculation). Null without the Studio's menu; a
 * lens then falls back to `StudioMenuSlotContext`.
 */
export const StudioMenuDataSlotContext = createContext<HTMLElement | null>(null);

/**
 * Inside the ⋯ menu's Provenance… disclosure: the active lens's plumbing
 * (Population's Refresh images). Null without the Studio's menu; a lens
 * then falls back to `StudioMenuSlotContext`.
 */
export const StudioProvenanceSlotContext = createContext<HTMLElement | null>(null);

/**
 * The Set studio column has one compact toolbar row (QA N13): the lens
 * switcher, then the active lens's own controls, portalled into this slot.
 * Without a slot (a lens rendered on its own, tests) the controls render in
 * place.
 */
export const StudioToolbarSlotContext = createContext<HTMLElement | null>(null);

/**
 * Height (px) the active lens's maps may fill: the column's visible height
 * below the toolbar. Null when unknown (a lens rendered on its own).
 */
export const StudioViewportHeightContext = createContext<number | null>(null);

/** Minimum height of one Studio map view (QA N13). */
export const STUDIO_MIN_VIEW_PX = 240;
