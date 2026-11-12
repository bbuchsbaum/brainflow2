import { useMemo } from 'react';
import { Button } from '@/components/ui/bf';
import { OUTLIER_SHAPE, type SimilarityGlyphShape } from '@/services/studio/similarityGroupingView';
import { GroupMark, groupMarksFor, type GroupMarkKind } from './groupMarks';
import type { MontageGroupRow } from './montageModel';
import { MontageTile, type MontageTileHandlers } from './MontageTiles';
import { MontageIdPrefixNote } from './MontageFooter';
import {
  MONTAGE_GROUP_GAP_CLASS,
  commonIdPrefix,
  montageGridStyle,
  shortId,
  useRevealFocusedTile,
  useTileFlip,
  type MontageSprites,
} from './montageTileSupport';

/** A quiet header action: a ghost button, not a link (links go to entities). */
const HEADER_ACTION = 'h-5 px-1.5 font-normal';

/**
 * Each similarity group's mark from the strip's shapes: the groups in order
 * (k of them) and the outliers. The map's own order is the grouping's.
 */
function headerMarks(
  glyphs: ReadonlyMap<string, SimilarityGlyphShape> | undefined,
): Map<string, GroupMarkKind> {
  if (!glyphs) return new Map();
  return groupMarksFor(
    [...glyphs].map(([id, shape]) => ({ id, outliers: shape === OUTLIER_SHAPE })),
  );
}

/**
 * The grouped montage: one section per group, every member shown and wrapped
 * onto as many rows as the group needs. `rows` is one page of it.
 */
export function MontageGroupRows({
  rows,
  columns,
  idPrefix,
  onShowMean,
  onShowAllGroups,
  onSelectGroup,
  glyphs,
  sprites,
  ...handlers
}: MontageTileHandlers & {
  /** Select the group's subjects; absent where a group cannot be selected. */
  onSelectGroup?: (groupId: string) => void;
  /** Each similarity group's mark, the same as on the similarity map. */
  glyphs?: ReadonlyMap<string, SimilarityGlyphShape>;
  rows: readonly MontageGroupRow[];
  columns: number;
  /** The prefix every ID in the set shares ("sub-"), stripped from the labels; said once, in the first group's heading. */
  idPrefix?: string;
  /** Show the group's mean map; absent when the group has none. */
  onShowMean?: (groupId: string) => void;
  /** The view is narrowed to one group; this returns to all of them. */
  onShowAllGroups?: () => void;
  sprites: MontageSprites | null;
}) {
  const order = useMemo(
    () => rows.map((row) => `${row.group.id}:${row.shown.join(',')}`).join('|'),
    [rows],
  );
  const host = useRevealFocusedTile(handlers.focusedId, `${order}:${columns}`);
  useTileFlip(host, order, String(columns));
  const marks = useMemo(() => headerMarks(glyphs), [glyphs]);
  const prefix = useMemo(
    () => idPrefix ?? commonIdPrefix(rows.flatMap((row) => row.group.memberIds)),
    [idPrefix, rows],
  );
  return (
    <div ref={host} className={`flex flex-col ${MONTAGE_GROUP_GAP_CLASS}`}>
      {rows.map(({ group, shown }, index) => {
        const count = group.memberIds.length;
        const mark = glyphs?.has(group.id) ? marks.get(group.id) : undefined;
        return (
          <section key={group.id} aria-label={group.label} className="flex flex-col gap-0.5">
            {/* Sticky within the tile scroller: a scrolled group keeps its
                name over its tiles until the next group's heading pushes it
                off. Opaque, and above the tiles it covers. */}
            <div
              data-montage-sticky
              data-testid="montage-group-heading"
              className="sticky top-0 z-10 flex h-6 items-center gap-1.5 bg-bf-bg-panel"
            >
              {mark ? <GroupMark kind={mark} /> : null}
              {/* Never truncated: "Group 1 · 29" is the heading's whole text. */}
              <h3 className="m-0 shrink-0 whitespace-nowrap text-bf-xs font-medium text-foreground">
                {group.label}
                <span className="font-normal text-bf-text-muted">
                  {' · '}
                  {count}
                  <span className="sr-only"> {count === 1 ? 'subject' : 'subjects'}</span>
                  {shown.length < count ? ` · ${shown.length} on this page` : ''}
                </span>
              </h3>
              {index === 0 && prefix ? <MontageIdPrefixNote prefix={prefix} /> : null}
              <span aria-hidden className="min-w-0 flex-1" />
              {onShowAllGroups && (
                <Button
                  data-montage-nodrag
                  variant="ghost"
                  size="sm"
                  className={HEADER_ACTION}
                  onClick={onShowAllGroups}
                >
                  Show all groups
                </Button>
              )}
              {onSelectGroup && !group.unassigned && !group.outliers && (
                <Button
                  data-montage-nodrag
                  variant="ghost"
                  size="sm"
                  className={HEADER_ACTION}
                  aria-label={`Select ${group.label}`}
                  title={`Select the ${count} subjects of ${group.label}`}
                  onClick={() => onSelectGroup(group.id)}
                >
                  Select
                </Button>
              )}
              {onShowMean && !group.unassigned && !group.outliers && (
                <Button
                  data-montage-nodrag
                  variant="ghost"
                  size="sm"
                  className={HEADER_ACTION}
                  aria-label={`Show mean of ${group.label}`}
                  title={`Show the mean of ${group.label}`}
                  onClick={() => onShowMean(group.id)}
                >
                  Mean
                </Button>
              )}
            </div>
            {/* Focus that scrolls a tile into view keeps it clear of the sticky heading. */}
            <div className="grid [&>*]:scroll-mt-7" style={montageGridStyle(columns)}>
              {shown.map((id) => (
                <MontageTile
                  key={id}
                  id={id}
                  label={shortId(id, prefix)}
                  sprites={sprites}
                  {...handlers}
                />
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}
