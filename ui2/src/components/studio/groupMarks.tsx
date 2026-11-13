/**
 * Group marks: the one achromatic glyph each group of a grouping wears,
 * wherever the group is drawn (a montage group header, a point on the
 * similarity map, a legend row). Colour is data, so groups are told apart by
 * FORM in neutral tones, never by hue (and never amber, which is reserved for
 * focus and selection).
 *
 * The marks depend on how many groups there are (`k`):
 * - k ≤ 3: three circles that differ in fill alone — filled, open, ringed (a
 *   dot inside a ring). Three marks of one shape read as one family.
 * - k > 3: distinct shapes — filled circle, square, triangle, diamond, then
 *   a stroked cross and plus, a downward triangle, an open circle — cycling
 *   past eight.
 * - Outliers (members alone in their cluster, not a group): a hollow diamond,
 *   whatever k is.
 *
 * API
 * - `groupMark(index, k)` → the {@link GroupMarkKind} of group `index`
 *   (0-based, in the grouping's order, outliers excluded) of `k` groups.
 * - `groupMarksFor(classes)` → a map from class id to its kind, for a list of
 *   classes in order (`{ id, outliers }`, as `similarityGroupingView` gives).
 * - `groupMarkParts(kind, cx, cy, r)` → the SVG paths of the mark centred at
 *   (cx, cy) with radius r; each part is filled or stroked. Use it to draw
 *   marks inside another SVG (scatter points).
 * - `<GroupMark index k size />` (or `kind`) → a standalone inline SVG.
 *
 * This module is independent of the montage: it imports no montage code.
 * The marks and their one component live together on purpose (one import
 * for every consumer), so Fast Refresh's component-only rule is waived here.
 */
/* eslint-disable react-refresh/only-export-components */

export type GroupMarkKind =
  | 'circle'
  | 'circle-open'
  | 'circle-ringed'
  | 'square'
  | 'triangle'
  | 'diamond'
  | 'cross'
  | 'plus'
  | 'triangle-down'
  | 'diamond-hollow';

/** The outliers' mark, at any k. */
export const OUTLIER_MARK: GroupMarkKind = 'diamond-hollow';

const FEW: readonly GroupMarkKind[] = ['circle', 'circle-open', 'circle-ringed'];
const MANY: readonly GroupMarkKind[] = [
  'circle',
  'square',
  'triangle',
  'diamond',
  'cross',
  'plus',
  'triangle-down',
  'circle-open',
];

/** The mark of group `index` (0-based) of `k` groups. */
export function groupMark(index: number, k: number): GroupMarkKind {
  const list = k <= FEW.length ? FEW : MANY;
  const i = Number.isFinite(index) && index >= 0 ? Math.floor(index) : 0;
  return list[i % list.length];
}

/** Each class's mark: groups by their order among groups, outliers by `OUTLIER_MARK`. */
export function groupMarksFor(
  classes: readonly { id: string; outliers?: boolean }[],
): Map<string, GroupMarkKind> {
  const groups = classes.filter((entry) => !entry.outliers);
  const marks = new Map<string, GroupMarkKind>();
  groups.forEach((entry, i) => marks.set(entry.id, groupMark(i, groups.length)));
  for (const entry of classes) if (entry.outliers) marks.set(entry.id, OUTLIER_MARK);
  return marks;
}

export interface GroupMarkPart {
  d: string;
  /** Filled (true) or stroked only (false). */
  filled: boolean;
}

const circle = (x: number, y: number, r: number) =>
  `M${x - r},${y}a${r},${r} 0 1,0 ${2 * r},0a${r},${r} 0 1,0 ${-2 * r},0`;

/** The mark as SVG path parts centred at (cx, cy), `r` its radius. */
export function groupMarkParts(kind: GroupMarkKind, x: number, y: number, r: number): GroupMarkPart[] {
  switch (kind) {
    case 'circle':
      return [{ d: circle(x, y, r), filled: true }];
    case 'circle-open':
      return [{ d: circle(x, y, r * 0.85), filled: false }];
    case 'circle-ringed':
      return [
        { d: circle(x, y, r * 0.85), filled: false },
        { d: circle(x, y, r * 0.38), filled: true },
      ];
    case 'square': {
      const s = r * 0.88;
      return [{ d: `M${x - s},${y - s}h${2 * s}v${2 * s}h${-2 * s}z`, filled: true }];
    }
    case 'triangle':
      return [
        { d: `M${x},${y - r * 1.1}L${x + r * 1.05},${y + r * 0.8}L${x - r * 1.05},${y + r * 0.8}z`, filled: true },
      ];
    case 'triangle-down':
      return [
        { d: `M${x},${y + r * 1.1}L${x + r * 1.05},${y - r * 0.8}L${x - r * 1.05},${y - r * 0.8}z`, filled: true },
      ];
    case 'diamond':
      return [{ d: `M${x},${y - r * 1.15}L${x + r * 1.15},${y}L${x},${y + r * 1.15}L${x - r * 1.15},${y}z`, filled: true }];
    case 'diamond-hollow':
      return [{ d: `M${x},${y - r * 1.05}L${x + r * 1.05},${y}L${x},${y + r * 1.05}L${x - r * 1.05},${y}z`, filled: false }];
    case 'cross':
      return [{ d: `M${x - r},${y - r}L${x + r},${y + r}M${x + r},${y - r}L${x - r},${y + r}`, filled: false }];
    case 'plus':
      return [{ d: `M${x - r},${y}h${2 * r}M${x},${y - r}v${2 * r}`, filled: false }];
  }
}

/** The neutral ink of a mark (a CSS colour; a `--bf-*` token). */
export const GROUP_MARK_INK = 'var(--bf-text-secondary)';

/**
 * A group's mark as an inline SVG. Give `kind`, or `index` and `k`
 * (`outlier` for the outliers' mark). Decorative: the group's name says the rest.
 */
export function GroupMark({
  index = 0,
  k = 1,
  kind,
  outlier = false,
  size = 10,
  className,
}: {
  index?: number;
  k?: number;
  kind?: GroupMarkKind;
  outlier?: boolean;
  size?: number;
  className?: string;
}) {
  const mark = kind ?? (outlier ? OUTLIER_MARK : groupMark(index, k));
  return (
    <svg
      aria-hidden
      width={size}
      height={size}
      viewBox="0 0 10 10"
      className={className ?? 'shrink-0'}
      data-glyph={mark}
    >
      {groupMarkParts(mark, 5, 5, 3.6).map((part, i) => (
        <path
          key={i}
          d={part.d}
          fill={part.filled ? GROUP_MARK_INK : 'none'}
          stroke={GROUP_MARK_INK}
          strokeWidth={part.filled ? 0 : 1.2}
        />
      ))}
    </svg>
  );
}

