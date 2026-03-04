/**
 * Hover Info Types
 *
 * Defines the core types for the modular hover information display system.
 * Providers register with the HoverInfoService and emit entries when the user
 * hovers over a view. The system is intentionally simple - entries are just
 * label/value pairs with optional grouping and priority.
 */

/** A single piece of information to display on hover */
export interface HoverInfoEntry {
  /** Display label (e.g., "Region", "Value", "World") */
  label: string;
  /** The value to display (e.g., "IPS-01", "2.451", "12.3, -45.6, 78.9 mm") */
  value: string;
  /** Sort order - lower values appear first (default: 50) */
  priority?: number;
  /** Optional grouping hint for UI organization */
  group?: string;
}

/** Context provided to hover info providers */
export interface HoverContext {
  /** World coordinates in mm (LPI) */
  worldCoord: [number, number, number];
  /** Which view triggered the hover */
  viewId: string;
  /** Screen position for tooltip placement */
  screenPos: { x: number; y: number };
  /** ID of the primary/active layer (if any) */
  activeLayerId?: string;
  /** ID of the active atlas layer (if any) */
  activeAtlasId?: string;
}

/**
 * A provider that contributes hover information.
 * Providers are registered with HoverInfoService and called on hover events.
 */
export interface HoverInfoProvider {
  /** Unique identifier for this provider (used in settings) */
  id: string;
  /** Human-readable name shown in settings UI */
  displayName: string;
  /** Execution order - lower values run first (default: 50) */
  priority: number;
  /**
   * Get hover info entries for the given context.
   * Returns null or empty array if this provider has nothing to show.
   * May be async to support backend queries (e.g., atlas lookup, sampling).
   */
  getInfo(ctx: HoverContext): Promise<HoverInfoEntry[] | null>;
}

/** Default priority for entries that don't specify one */
export const DEFAULT_ENTRY_PRIORITY = 50;

/** Default priority for providers that don't specify one */
export const DEFAULT_PROVIDER_PRIORITY = 50;
