/** Event colours, shared by the Inspector timeline and the viewer's track. */
const EVENT_COLORS = [
  'var(--bf-plot-line)',
  'var(--bf-coronal)',
  'var(--bf-sagittal)',
  'var(--bf-icon-freesurfer)',
];
const EVENT_NEUTRAL = /baseline|fixation|rest|null/i;

/** One colour per trial type, by first appearance, so a design's types stay apart. */
export function trialTypeColors(types: Iterable<string>): Map<string, string> {
  const colors = new Map<string, string>();
  let next = 0;
  for (const type of types) {
    if (colors.has(type)) continue;
    colors.set(
      type,
      EVENT_NEUTRAL.test(type) ? 'var(--bf-text-faint)' : EVENT_COLORS[next++ % EVENT_COLORS.length],
    );
  }
  return colors;
}

export function colorForTrialType(trialType: string): string {
  if (EVENT_NEUTRAL.test(trialType)) return 'var(--bf-text-faint)';
  let hash = 0;
  for (let i = 0; i < trialType.length; i++) {
    hash = ((hash << 5) - hash + trialType.charCodeAt(i)) | 0;
  }
  return EVENT_COLORS[Math.abs(hash) % EVENT_COLORS.length];
}
