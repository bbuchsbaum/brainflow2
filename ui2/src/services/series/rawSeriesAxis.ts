/**
 * The series axis of a raw 4D layer (phase 4 round 2 X3). A layer that is a
 * member of a Set Studio dataset declaring a lag / time feature axis uses
 * that axis ("Lag (TR)", start + i · step, 0-based like the dataset series),
 * so the two views of one study index time the same way. Otherwise seconds
 * when the TR is known, else the 1-based frame.
 */
import type { useSetStudioStore } from '@/stores/setStudioStore';
import { studioMetadata } from '@/services/studio/studioMetadata';
import { resolveSetSeriesBinding } from './seriesBinding';
import { seriesAxisTitle } from './seriesRecipe';

export interface RawSeriesAxis {
  /** x of frame i. */
  at: (i: number) => number;
  title: string;
  /** CSV column stem ("lag", "t", "frame") and unit ("TR", "s", null). */
  name: string;
  unit: string | null;
  integer: boolean;
  step: number;
  /** "lag 2 TR", "frame 3", "4 s": how one position reads. */
  describe: (i: number) => string;
  /** The dataset member, when the axis came from a dataset ("s01 · faces"). */
  member: string | null;
  /** The measure the dataset names ("FIR beta"), for the y title. */
  measure: string | null;
  /** The member's condition ("faces"): its line takes the condition's colour. */
  condition?: string | null;
  /** The dataset the member belongs to ("FIR study (4D lag series)"). */
  dataset?: string | null;
}

type StudioState = ReturnType<typeof useSetStudioStore.getState>;
type StudioView = Pick<StudioState, 'sets' | 'selection' | 'population'> & {
  features?: StudioState['features'];
};

/** The dataset axis for a layer loaded from `sourcePath`, or null. */
export function datasetAxisFor(
  sourcePath: string | undefined,
  studio: StudioView,
): RawSeriesAxis | null {
  if (!sourcePath) return null;
  const sets = Object.values(studio.sets ?? {}).sort(
    (a, b) =>
      Number(b.id === studio.selection.activeSetId) - Number(a.id === studio.selection.activeSetId),
  );
  for (const set of sets) {
    if (set.supportKind !== 'volume') continue;
    const member = (set.memberSummaries ?? []).find((m) => m.sourcePath === sourcePath);
    if (!member) continue;
    const metadata = studioMetadata(set);
    if (metadata.issue) continue;
    const binding = resolveSetSeriesBinding(set, metadata, studio.population?.participants ?? null);
    if (!binding?.frames) continue;
    const { start, step } = binding.frames;
    const design = member.designValues ?? {};
    const memberLabel = [binding.subjectColumn, binding.conditionColumn]
      .map((c) => (c ? design[c] : undefined))
      .filter((v): v is string => !!v)
      .join(' · ');
    const featureId = studio.selection.activeFeatureId;
    const feature =
      featureId && studio.selection.activeSetId === set.id
        ? studio.features?.[featureId]
        : undefined;
    const name = binding.kind === 'lag' ? 'lag' : 'time';
    const at = (i: number) => start + i * step;
    return {
      at,
      title: seriesAxisTitle(binding),
      name,
      unit: binding.unit,
      integer: Number.isInteger(start) && Number.isInteger(step),
      step,
      describe: (i) => `${name} ${at(i)}${binding.unit ? ` ${binding.unit}` : ''}`,
      member: memberLabel || null,
      measure: feature?.label ?? null,
      condition: binding.conditionColumn ? (design[binding.conditionColumn] ?? null) : null,
      dataset: set.name ?? null,
    };
  }
  return null;
}

/** The plain axis of a 4D layer: seconds with a TR, else the 1-based frame. */
export function layerAxis(tr: number | null): RawSeriesAxis {
  return tr
    ? {
        at: (i) => i * tr,
        title: 'Time (s)',
        name: 't',
        unit: 's',
        integer: false,
        step: tr,
        describe: (i) => `${Number((i * tr).toFixed(3))} s`,
        member: null,
        measure: null,
      }
    : {
        at: (i) => i + 1,
        title: 'Frame',
        name: 'frame',
        unit: null,
        integer: true,
        step: 1,
        describe: (i) => `frame ${i + 1}`,
        member: null,
        measure: null,
      };
}
