/**
 * Scene Item — unified read-side representation of items shown in the right
 * Inspector's Scene Stack (Volume View / Surface View / Mappings groups).
 *
 * The underlying state stays separate (layerStore for volumes, surfaceStore
 * for surfaces); SceneItem is a derived view, produced by `useSceneStack`.
 */

export type SceneItemKind =
  | 'volume-base'
  | 'volume-overlay'
  | 'volume-overlay-atlas'
  | 'surface-geometry'
  | 'surface-overlay'
  | 'mapping';

export type SceneItemGroup = 'volume' | 'surface' | 'mapping';

/**
 * Reference back into the source stores so actions can mutate the right thing
 * without re-deriving.
 */
export type SceneItemRef =
  | { type: 'volume'; layerId: string }
  | { type: 'surface-geometry'; surfaceId: string }
  | { type: 'surface-overlay'; surfaceId: string; surfaceLayerId: string }
  | {
      type: 'mapping';
      surfaceId: string;
      surfaceLayerId: string;
      volumeId: string;
    };

export interface SceneItem {
  /** Stable id usable as React key and inspector-selection identifier. */
  id: string;
  kind: SceneItemKind;
  group: SceneItemGroup;
  /** Display name (e.g. `MNI152 T1w`, `task-rest projected L/R`). */
  name: string;
  /** Compact descriptor (e.g. `volume overlay · frame 120/240 · Jet`). */
  subtitle: string;
  visible: boolean;
  /** 0–1 opacity; volume base layers report 1 unless explicitly set. */
  opacity: number;
  ref: SceneItemRef;
}

export interface SceneStackGroups {
  volumes: SceneItem[];
  surfaces: SceneItem[];
  mappings: SceneItem[];
  totalCount: number;
}

export const EMPTY_SCENE_STACK: SceneStackGroups = {
  volumes: [],
  surfaces: [],
  mappings: [],
  totalCount: 0,
};

export function isVolumeItem(
  item: SceneItem
): item is SceneItem & { kind: 'volume-base' | 'volume-overlay' | 'volume-overlay-atlas' } {
  return (
    item.kind === 'volume-base' ||
    item.kind === 'volume-overlay' ||
    item.kind === 'volume-overlay-atlas'
  );
}

export function isSurfaceItem(
  item: SceneItem
): item is SceneItem & { kind: 'surface-geometry' | 'surface-overlay' } {
  return item.kind === 'surface-geometry' || item.kind === 'surface-overlay';
}

export function isMappingItem(
  item: SceneItem
): item is SceneItem & { kind: 'mapping' } {
  return item.kind === 'mapping';
}
