/**
 * Surface geometry families: the pial, white, inflated (sphere, midthickness…)
 * meshes of one subject, space and hemisphere. They share one vertex
 * numbering, so one scene shows one of them per hemisphere and switching
 * between them morphs the drawn mesh instead of swapping it.
 *
 * - A family is the loaded meshes with the same scene identity
 *   (`anatomyKey`: the file name minus its geometry token) and identical
 *   topology.
 * - Its overlays are one set: an overlay loaded on any member is drawn on
 *   whichever geometry is shown (vertex i is the same cortex point on all).
 * - The display keeps the family's first-loaded handle, so the viewer sees
 *   one mesh whose `variant` changes.
 *
 * Inflated and spherical meshes are re-centred so their medial edge sits
 * where the folded mesh's does (FreeSurfer writes each inflated hemisphere
 * about its own centroid: left and right overlap at the midline otherwise).
 * Display positions only: picking and the linked cursor read the anatomical
 * vertices, never these.
 */
import type { LoadedSurface, SurfaceDataLayer } from '@/stores/surfaceStore';
import type { SurfaceSetMember } from '@/services/surfaceSetDiscovery';
import { sampleVolumeLinear } from '@brainflow/visualization/surface/projection';
import {
  ANATOMICAL_TYPES,
  anatomyKey,
  isAnatomical,
  sameTopology,
  surfaceGeometryType,
} from './surfaceLink';

/** Display order of geometries (folded to unfolded); others follow by name. */
const GEOMETRY_ORDER = [
  'pial',
  'midthickness',
  'graymid',
  'white',
  'smoothwm',
  'orig',
  'inflated',
  'very_inflated',
  'sphere',
];

/** Short labels for the geometry switcher. */
const GEOMETRY_LABELS: Record<string, string> = {
  pial: 'Pial',
  midthickness: 'Mid',
  graymid: 'Mid',
  white: 'White',
  smoothwm: 'Smooth WM',
  orig: 'Orig',
  inflated: 'Inflated',
  very_inflated: 'Very inflated',
  sphere: 'Sphere',
};

export function geometryLabel(type: string): string {
  return GEOMETRY_LABELS[type] ?? type.charAt(0).toUpperCase() + type.slice(1);
}

function geometryRank(type: string): number {
  const index = GEOMETRY_ORDER.indexOf(type);
  return index < 0 ? GEOMETRY_ORDER.length : index;
}

/** A display surface: one mesh, its geometry chosen among same-topology embeddings. */
export type SurfaceDisplay = LoadedSurface & {
  /** Display positions per geometry (all of one vertex numbering). */
  variants?: Readonly<Record<string, Float32Array>>;
  /** The geometry drawn: `geometry.vertices === variants[variant]`. */
  variant?: string;
  /** The loaded surface whose geometry is drawn (owner of name / path / metadata). */
  shownHandle?: string;
  /** Handles of every member, in load order. */
  memberHandles?: readonly string[];
};

function hasGeometry(surface: LoadedSurface): boolean {
  return surface.geometry.vertices.length > 0 && surface.geometry.faces.length > 0;
}

/**
 * The loaded meshes that are geometries of `surface`'s cortical sheet (itself
 * included), in load order, one per geometry type. Without an identity or
 * geometry the surface is its own family.
 */
export function surfaceFamily(
  surface: LoadedSurface,
  all: Iterable<LoadedSurface>,
): LoadedSurface[] {
  const key = anatomyKey(surface);
  if (!key || !hasGeometry(surface)) return [surface];
  const family: LoadedSurface[] = [];
  const types = new Set<string>();
  for (const candidate of all) {
    if (candidate.handle !== surface.handle) {
      if (!hasGeometry(candidate) || anatomyKey(candidate) !== key) continue;
      if (!sameTopology(surface, candidate)) continue;
    }
    const type = surfaceGeometryType(candidate) ?? candidate.handle;
    // Two files of one geometry (a reload): the requested one wins its slot.
    if (types.has(type)) {
      if (candidate.handle === surface.handle) {
        const index = family.findIndex((m) => (surfaceGeometryType(m) ?? m.handle) === type);
        family[index] = candidate;
      }
      continue;
    }
    types.add(type);
    family.push(candidate);
  }
  return family;
}

/** Geometry choices for a family, folded first (for the switcher). */
export function familyGeometries(family: readonly LoadedSurface[]): string[] {
  return family
    .map((member) => surfaceGeometryType(member) ?? member.handle)
    .sort((a, b) => geometryRank(a) - geometryRank(b) || a.localeCompare(b));
}

const medialShiftCache = new WeakMap<Float32Array, Map<string, Float32Array>>();

function xExtent(vertices: Float32Array): [number, number] {
  let min = Infinity;
  let max = -Infinity;
  for (let i = 0; i < vertices.length; i += 3) {
    const x = vertices[i];
    if (x < min) min = x;
    if (x > max) max = x;
  }
  return [min, max];
}

/**
 * `vertices` translated in x so its medial edge (largest x on the left,
 * smallest on the right) sits at `medialX`. Cached by input, so a display
 * keeps one array per geometry (the viewer compares by reference).
 */
export function alignMedialEdge(
  vertices: Float32Array,
  hemisphere: 'left' | 'right',
  medialX: number,
): Float32Array {
  const key = `${hemisphere}:${medialX}`;
  const cached = medialShiftCache.get(vertices)?.get(key);
  if (cached) return cached;
  const [min, max] = xExtent(vertices);
  const shift = medialX - (hemisphere === 'left' ? max : min);
  let shifted = vertices;
  if (Number.isFinite(shift) && Math.abs(shift) > 1e-3) {
    shifted = new Float32Array(vertices);
    for (let i = 0; i < shifted.length; i += 3) shifted[i] += shift;
  }
  let row = medialShiftCache.get(vertices);
  if (!row) medialShiftCache.set(vertices, (row = new Map()));
  row.set(key, shifted);
  return shifted;
}

/** Gap kept at the midline between unfolded hemispheres without a folded reference (mm). */
const MIDLINE_GAP_MM = 4;

function lateral(surface: LoadedSurface): 'left' | 'right' | null {
  const hemisphere = String(surface.geometry.hemisphere ?? surface.metadata.hemisphere ?? '').toLowerCase();
  if (hemisphere === 'left' || hemisphere === 'lh' || hemisphere === 'l') return 'left';
  if (hemisphere === 'right' || hemisphere === 'rh' || hemisphere === 'r') return 'right';
  return null;
}

/**
 * Overlays of every member in load order (later draw on top), ids unique.
 * The order does not depend on which geometry is shown, so switching never
 * restacks the overlays.
 */
function familyLayers(
  shown: LoadedSurface,
  family: readonly LoadedSurface[],
): Map<string, SurfaceDataLayer> {
  if (family.length === 1) return shown.layers;
  const layers = new Map<string, SurfaceDataLayer>();
  for (const member of family) {
    for (const [id, layer] of member.layers) {
      if (!layers.has(id)) layers.set(id, layer);
    }
  }
  return layers;
}

const anatomicalSampleCache = new WeakMap<ArrayBuffer, WeakMap<Float32Array, Float32Array | null>>();

/**
 * A GPU volume-projection layer samples the volume where the mesh is drawn:
 * right on a folded mesh, meaningless on an inflated or spherical one (and
 * changing while it morphs). There it becomes per-vertex values sampled once
 * at the folded `anatomy` vertices (cached per volume and mesh).
 */
function anatomicalLayers(
  layers: Map<string, SurfaceDataLayer>,
  anatomy: Float32Array,
): Map<string, SurfaceDataLayer> {
  let out: Map<string, SurfaceDataLayer> | null = null;
  for (const [id, layer] of layers) {
    if (!layer.volumeData || !layer.volumeDims || !layer.affineMatrix || layer.rgba) continue;
    let row = anatomicalSampleCache.get(layer.volumeData);
    if (!row) anatomicalSampleCache.set(layer.volumeData, (row = new WeakMap()));
    let values = row.get(anatomy);
    if (values === undefined) {
      try {
        values = sampleVolumeLinear(
          anatomy,
          new Float32Array(layer.volumeData),
          layer.volumeDims,
          layer.affineMatrix,
        );
      } catch (error) {
        console.warn(`[SurfaceView] Could not sample '${layer.name}' on the folded mesh:`, error);
        values = null;
      }
      row.set(anatomy, values);
    }
    out ??= new Map(layers);
    out.set(
      id,
      values
        ? { ...layer, values, volumeData: undefined, volumeDims: undefined, affineMatrix: undefined }
        : { ...layer, visible: false },
    );
  }
  return out ?? layers;
}

/** One folding underlay for the family: a sulc / curv file before a computed one. */
function familyCurvature(shown: LoadedSurface, family: readonly LoadedSurface[]): Float32Array | null {
  return (
    family.find((member) => member.curvature && member.curvatureSource?.kind === 'file')?.curvature ??
    shown.curvature ??
    family.find((member) => member.curvature)?.curvature ??
    null
  );
}

/**
 * The overlays a scene draws for `surface`: its own and those of every
 * same-topology geometry of the same hemisphere (a colorbar or legend that
 * follows the drawn mesh, not only the selected file).
 */
export function familyOverlays(
  surface: LoadedSurface,
  all: Iterable<LoadedSurface>,
): Map<string, SurfaceDataLayer> {
  return familyLayers(surface, surfaceFamily(surface, all));
}

/**
 * Turn the scene's chosen meshes (one per hemisphere) into display
 * surfaces. `geometry` overrides the geometry drawn when the family has it.
 * Surfaces without a family pass through unchanged.
 */
export function buildSurfaceDisplays(
  chosen: readonly LoadedSurface[],
  all: ReadonlyMap<string, LoadedSurface>,
  geometry?: string | null,
): SurfaceDisplay[] {
  const loaded = [...all.values()];
  const bothHemispheres =
    chosen.some((s) => lateral(s) === 'left') && chosen.some((s) => lateral(s) === 'right');

  return chosen.map((candidate) => {
    const family = surfaceFamily(candidate, loaded);
    const hemisphere = lateral(candidate);
    const computed = family.some((member) => member.computedVariants);
    if (family.length < 2 && !computed) {
      if (!hemisphere || !bothHemispheres || isAnatomical(candidate) || !hasGeometry(candidate)) {
        return candidate;
      }
      // Two unfolded hemispheres with no folded reference: part them at the midline.
      const medialX = hemisphere === 'left' ? -MIDLINE_GAP_MM / 2 : MIDLINE_GAP_MM / 2;
      const vertices = alignMedialEdge(candidate.geometry.vertices, hemisphere, medialX);
      return vertices === candidate.geometry.vertices
        ? candidate
        : { ...candidate, geometry: { ...candidate.geometry, vertices } };
    }

    const typeOf = (member: LoadedSurface) => surfaceGeometryType(member) ?? member.handle;
    const base = family[0];
    const reference =
      family.find((member) => typeOf(member) === 'white') ??
      family.find((member) => typeOf(member) === 'pial') ??
      family.find(isAnatomical);
    const medialX =
      !hemisphere
        ? null
        : reference
          ? xExtent(reference.geometry.vertices)[hemisphere === 'left' ? 1 : 0]
          : bothHemispheres
            ? hemisphere === 'left'
              ? -MIDLINE_GAP_MM / 2
              : MIDLINE_GAP_MM / 2
            : null;
    const place = (name: string, vertices: Float32Array) =>
      hemisphere && medialX !== null && !ANATOMICAL_TYPES.has(name)
        ? alignMedialEdge(vertices, hemisphere, medialX)
        : vertices;

    // Loaded geometries, then embeddings computed from a member (an inflated
    // mesh for a template without one) where no loaded mesh has that name.
    const variants: Record<string, Float32Array> = {};
    const owners: Record<string, LoadedSurface> = {};
    for (const member of family) {
      const name = typeOf(member);
      variants[name] = place(name, member.geometry.vertices);
      owners[name] = member;
    }
    for (const member of family) {
      for (const [name, vertices] of Object.entries(member.computedVariants ?? {})) {
        if (name in variants || vertices.length !== member.geometry.vertices.length) continue;
        variants[name] = place(name, vertices);
        owners[name] = member;
      }
    }
    const variant =
      geometry && variants[geometry] ? geometry : typeOf(candidate);
    const shown = owners[variant] ?? candidate;

    return {
      ...shown,
      handle: base.handle,
      // Hidden only when the chosen mesh is (collectRenderSurfaces drops those).
      visible: candidate.visible,
      geometry: {
        ...shown.geometry,
        // A computed embedding is named by its geometry, not its source's.
        surfaceType: variant as LoadedSurface['geometry']['surfaceType'],
        vertices: variants[variant],
        // One face array for the family: the viewer morphs instead of rebuilding.
        faces: base.geometry.faces,
        hemisphere: shown.geometry.hemisphere ?? base.geometry.hemisphere,
      },
      layers:
        reference && !ANATOMICAL_TYPES.has(variant)
          ? anatomicalLayers(familyLayers(shown, family), reference.geometry.vertices)
          : familyLayers(shown, family),
      curvature: familyCurvature(shown, family),
      variants,
      variant,
      shownHandle: shown.handle,
      memberHandles: family.map((member) => member.handle),
    };
  });
}

/** One choice of the geometry switcher. */
export interface GeometryChoice {
  geometry: string;
  /** Meshes to load first (the scene does not hold this geometry for every drawn hemisphere). */
  toLoad: SurfaceSetMember[];
  /** Not on offer anywhere: computed in the app from the folded mesh (inflated). */
  compute?: boolean;
}

/**
 * The geometries a view can show: those its drawn meshes hold, then those
 * its set offers (on disk or from its template) for the drawn hemispheres,
 * folded first. Choosing one with `toLoad` loads it, then morphs to it.
 */
export function geometryChoices(
  displays: readonly SurfaceDisplay[],
  set: readonly SurfaceSetMember[],
  loadedPaths: ReadonlySet<string>,
): GeometryChoice[] {
  const choices = new Map<string, SurfaceSetMember[]>();
  for (const display of displays) {
    const names = display.variants
      ? Object.keys(display.variants)
      : [surfaceGeometryType(display)].filter((g): g is string => !!g);
    for (const name of names) if (!choices.has(name)) choices.set(name, []);
  }
  const drawn = new Set(displays.map(lateral).filter(Boolean));
  for (const member of set) {
    if (!drawn.has(member.hemisphere) || loadedPaths.has(member.path)) continue;
    const pending = choices.get(member.geometry) ?? [];
    pending.push(member);
    choices.set(member.geometry, pending);
  }
  const result: GeometryChoice[] = [...choices.entries()].map(([geometry, toLoad]) => ({
    geometry,
    toLoad,
  }));
  // No inflated mesh loaded or on offer (TemplateFlow fsaverage): offer one
  // computed from the folded mesh.
  const folded = displays.some((display) =>
    Object.keys(display.variants ?? { [surfaceGeometryType(display) ?? '']: null }).some((name) =>
      ANATOMICAL_TYPES.has(name),
    ),
  );
  if (folded && !choices.has('inflated')) result.push({ geometry: 'inflated', toLoad: [], compute: true });
  return result.sort((a, b) => geometryRank(a.geometry) - geometryRank(b.geometry) || a.geometry.localeCompare(b.geometry));
}

/**
 * The folded mesh that stands in for `surface` when sampling a volume: the
 * surface itself when folded (or of unknown geometry), else its family's
 * white, pial or other anatomical member. Null: an unfolded mesh alone.
 */
export function anatomicalStandIn(
  surface: LoadedSurface,
  all: Iterable<LoadedSurface>,
): LoadedSurface | null {
  if (isAnatomical(surface) || !surfaceGeometryType(surface)) return surface;
  const family = surfaceFamily(surface, all);
  const typeOf = (member: LoadedSurface) => surfaceGeometryType(member);
  return (
    family.find((member) => typeOf(member) === 'white') ??
    family.find((member) => typeOf(member) === 'pial') ??
    family.find(isAnatomical) ??
    null
  );
}

/**
 * A tab title naming the meshes a scene draws: the shown file, or for two
 * hemispheres of one name both at once ("lh+rh.inflated.gii",
 * "sub-01_hemi-LR_pial.surf.gii", "fsaverage white (both)").
 */
export function sceneTitle(names: readonly string[]): string {
  if (names.length < 2) return names[0] ?? '';
  const [a, b] = names;
  const pairs: Array<[RegExp, RegExp, string]> = [
    [/^lh[.]/i, /^rh[.]/i, 'lh+rh.'],
    [/hemi-L(?=_|[.])/, /hemi-R(?=_|[.])/, 'hemi-LR'],
    [/[(]left[)]$/, /[(]right[)]$/, '(both)'],
  ];
  for (const [left, right, both] of pairs) {
    if (left.test(a) && right.test(b) && a.replace(left, both) === b.replace(right, both)) {
      return a.replace(left, both);
    }
  }
  return `${a} + ${b}`;
}
