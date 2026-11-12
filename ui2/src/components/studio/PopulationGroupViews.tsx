import { MoreHorizontal } from 'lucide-react';
import { useMemo, useState, type ComponentProps } from 'react';
import { useStudioWorkspaceKey } from '@/hooks/useStudioWorkspace';
import { useMirrorsView } from '@/stores/viewDisplaySettingsStore';
import { IconButton } from '@/components/ui/bf';
import { DropdownMenu, type DropdownMenuItem } from '@/components/ui/DropdownMenu';
import { useSetStudioState } from '@/stores/setStudio/useSetStudioState';
import { useViewStateStore } from '@/stores/viewStateStore';
import { ReusableSliceViewport, SliceViewerImageSurface } from '@/components/views/sliceViewer';
import {
  populationSharesEffectScale,
  populationSliceActions,
  populationSummaryDrawnValues,
  type PopulationSliceDisplay,
} from '@/services/studio/PopulationSliceService';
import { populationProbeActions } from '@/services/studio/PopulationProbeActions';
import { isUnassignedGroup } from '@/services/studio/populationGroups';
import type { ViewPlane } from '@/types/coordinates';
import { createMontageCropMemory, type MontageCrop } from './montageTileSupport';
import { limitDisplay } from './montageModel';
import { PopulationScaleStrip } from './PopulationColorbar';
import { scaleClipping } from '@/services/studio/studioMapDisplay';
import {
  ALL_CARD_STATISTICS,
  CARD_HEADER_PX,
  CARD_SCALE_PX,
  allCardStatistic,
  cardHeader,
  cardScaleText,
  differenceCardHeader,
  fitSummaryCards,
  positiveFractionTick,
  shortGroupLabel,
  summaryCardCrop,
  summaryCardIdentity,
  useCroppedCard,
  useGroupMeanDifference,
} from './summaryCards';

const CARD_GAP_PX = 12;

type CrosshairStyle = ComponentProps<typeof ReusableSliceViewport>['crosshairStyle'];

const sameMembers = (a: readonly string[], b: readonly string[]) => {
  if (a.length !== b.length) return false;
  const set = new Set(a);
  return b.every((id) => set.has(id));
};

/** A card's own colour scale (a scale no other card shares), drawn under its image. */
interface CardScale {
  limit: number;
  values: readonly (number | null)[] | null;
  format?: (value: number) => string;
  /** What the scale is of, for its accessible name. */
  label: string;
}

/**
 * The grouped Summary on one screen: the difference of two group means
 * first ("G1 − G2 · 29 vs 6"), then one card per group mean ("G1 · 29"),
 * then "All" (the whole population's mean, t or sign share, chosen in the
 * toolbar's Show). The cards are sized so every one fits the pane (the
 * montage's fit). Every card is drawn with one shared crop and one header
 * line that is never cut; a card on a scale of its own (the difference, t,
 * the sign share) carries its own compact bar, the others share the bar
 * below the cards. A card's actions are in its ⋯.
 */
export function PopulationGroupViews({
  display,
  width,
  height = null,
  current,
  crosshairStyle,
  crosshairVisible,
}: {
  display: PopulationSliceDisplay;
  width: number;
  /** Height the cards may fill (px); null when unknown (they take the width). */
  height?: number | null;
  current: boolean;
  crosshairStyle: CrosshairStyle;
  crosshairVisible: boolean;
}) {
  const state = useSetStudioState();
  const partition = state.population.partition;
  const groups = useMemo(
    () =>
      (display.data.groups ?? []).flatMap((group) => {
        const operand = display.query.request.groups?.find((g) => g.id === group.id);
        if (!operand) return [];
        const unassigned = partition?.groups.find((g) => g.id === group.id);
        // Unassigned observations of a fit are never a similarity-group card.
        if (partition && unassigned && isUnassignedGroup(partition, unassigned)) return [];
        return [
          {
            data: group,
            memberIds: operand.memberIds,
            label: shortGroupLabel(display.query.groupLabels?.[group.id] ?? group.id),
          },
        ];
      }),
    [display, partition],
  );
  // The difference card's pair: the first two groups unless chosen.
  const [pair, setPair] = useState<[string, string] | null>(null);
  const shownPair =
    pair && groups.some((g) => g.data.id === pair[0]) && groups.some((g) => g.data.id === pair[1])
      ? pair
      : groups.length >= 2
        ? ([groups[0].data.id, groups[1].data.id] as [string, string])
        : null;
  const first = groups.find((g) => g.data.id === shownPair?.[0]) ?? null;
  const second = groups.find((g) => g.data.id === shownPair?.[1]) ?? null;
  const differenceCardId =
    first && second ? `difference:${first.data.id}\u0000${second.data.id}` : 'difference';
  const difference = useGroupMeanDifference(
    display,
    first?.data.values ?? null,
    second?.data.values ?? null,
    summaryCardIdentity(display, differenceCardId),
  );
  // Kept across slices of one frame: stepping never resizes or shifts the cards.
  const [cropMemory] = useState(createMontageCropMemory);
  const { crop, background } = useMemo(
    () =>
      summaryCardCrop(
        display,
        [display.data.summary, ...(display.data.groups ?? []).map((group) => group.values)],
        cropMemory,
      ),
    [display, cropMemory],
  );
  const cardCount = groups.length + 1 + (first && second ? 1 : 0);
  const { columns, cellWidth, imageHeight } = fitSummaryCards({
    count: cardCount,
    width,
    height,
    aspect: crop.width / Math.max(1, crop.height),
    gap: CARD_GAP_PX,
  });
  const statistic = allCardStatistic(display.query.request.summary);
  const statisticName =
    ALL_CARD_STATISTICS.find((option) => option.value === statistic)?.name ?? 'mean';
  const allValues = useMemo(
    () => populationSummaryDrawnValues(display.query.request, display.data.summary),
    [display],
  );
  // The "All" card's mean shares the groups' scale (the bar below); t and the
  // sign share have their own.
  const allScale: CardScale | null = populationSharesEffectScale(display.query.request)
    ? null
    : {
        limit: display.summaryLimit,
        values: allValues,
        format: statistic === 'positiveFraction' ? positiveFractionTick : undefined,
        label: `All, ${statisticName}`,
      };
  const common = {
    display,
    crop,
    background,
    cellWidth,
    imageHeight,
    current,
    crosshairStyle,
    crosshairVisible,
  };
  const working = state.population.working;
  const compareCohort =
    state.population.referenceMode === 'cohort' && state.selection.compareCohortId
      ? state.cohorts[state.selection.compareCohortId]
      : null;
  const pairOptions = groups.flatMap((a, i) =>
    groups.slice(i + 1).map((b) => ({ id: `${a.data.id}\u0000${b.data.id}`, a, b })),
  );
  type CardGroup = (typeof groups)[number];
  const chooseAsA = (group: CardGroup) =>
    populationProbeActions.select(group.memberIds, 'replace', partition?.origin ?? 'metadata', group.label);
  const chooseAsB = (group: CardGroup) => {
    const id = state.createSavedCohort({
      memberIds: [...group.memberIds],
      label: group.label,
      originLabel:
        partition?.origin === 'map-derived'
          ? `Spatial similarity ${partition.fitId}`
          : `Factor ${partition?.column}`,
    });
    if (id) {
      state.setPopulationReferenceMode('cohort');
      state.setCompareCohort(id);
    }
  };
  const showContributors = (groupId: string | undefined) =>
    state.setPopulationPresentation({
      ...state.population.presentation,
      arrangement: 'montage',
      contributorsGroupId: groupId,
    });
  return (
    <div
      className="grid"
      aria-label="Group effects"
      data-columns={columns}
      style={{
        gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
        gap: CARD_GAP_PX,
      }}
    >
      {first && second && (
        <SummaryCard
          {...common}
          cardId={differenceCardId}
          label={`${first.label} − ${second.label}`}
          header={differenceCardHeader(
            { label: first.label, count: first.data.unitCount },
            { label: second.label, count: second.data.unitCount },
          )}
          title={`Mean of ${first.label} minus mean of ${second.label}${
            difference.limit === null ? '' : `; ${cardScaleText('mean', difference.limit)}`
          }`}
          image={difference.image}
          emptyText={difference.limit === null ? 'The two means do not differ here' : undefined}
          scale={
            difference.limit === null
              ? null
              : {
                  limit: difference.limit,
                  values: difference.values,
                  label: `${first.label} − ${second.label}`,
                }
          }
          actions={[
            {
              id: 'compare',
              label: `Use ${first.label} as A, ${second.label} as B`,
              disabled: !current,
              onClick: () => {
                chooseAsA(first);
                chooseAsB(second);
              },
            },
            ...(pairOptions.length > 1
              ? pairOptions.map((option) => ({
                  id: option.id,
                  label: `${option.a.data.id === first.data.id && option.b.data.id === second.data.id ? '✓ ' : ''}${option.a.label} − ${option.b.label}`,
                  onClick: () => setPair([option.a.data.id, option.b.data.id]),
                }))
              : []),
          ]}
          actionsTitle={
            pairOptions.length > 1
              ? 'Use the pair as A and B, or choose the groups to difference'
              : 'Use the pair as A and B'
          }
        />
      )}
      {groups.map((group) => {
        const isA = working.kind === 'members' && sameMembers(working.memberIds, group.memberIds);
        const isB = !!compareCohort && sameMembers(compareCohort.memberIds, group.memberIds);
        const items: DropdownMenuItem[] = [
          { id: 'a', label: 'Use as A', disabled: !current, onClick: () => chooseAsA(group) },
          { id: 'b', label: 'Use as B', disabled: !current, onClick: () => chooseAsB(group) },
          {
            id: 'contributors',
            label: 'Show contributors',
            disabled: !current,
            onClick: () => showContributors(group.data.id),
          },
        ];
        return (
          <SummaryCard
            {...common}
            key={group.data.id}
            cardId={`group:${group.data.id}`}
            label={group.label}
            header={cardHeader(group.label, group.data.unitCount)}
            title={`Mean of ${group.label}; ${cardScaleText('mean', display.effectLimit)}`}
            image={display.images.groups[group.data.id] ?? null}
            badges={[isA ? 'A' : null, isB ? 'B' : null]}
            actions={items}
            actionsTitle="Use as A, use as B, show contributors"
          />
        );
      })}
      <SummaryCard
        {...common}
        cardId="all"
        label="All"
        header={cardHeader(
          'All',
          display.data.unitCount,
          statistic === 'mean' ? undefined : statisticName,
        )}
        title={`${ALL_CARD_STATISTICS.find((option) => option.value === statistic)?.label ?? 'Mean'} of all ${display.data.unitCount}; ${cardScaleText(statistic, statistic === 'mean' ? display.effectLimit : display.summaryLimit)}`}
        image={display.images.summary}
        scale={allScale}
        actions={[
          {
            id: 'select-all',
            label: 'Select all',
            disabled: !current,
            onClick: () => populationProbeActions.selectAll(),
          },
          {
            id: 'contributors',
            label: 'Show contributors',
            disabled: !current,
            onClick: () => showContributors(undefined),
          },
        ]}
        actionsTitle="Select all, show contributors"
      />
    </div>
  );
}

function SummaryCard({
  display,
  crop,
  background,
  cellWidth,
  imageHeight,
  current,
  crosshairStyle,
  crosshairVisible,
  cardId,
  label,
  header,
  title,
  image,
  scale = null,
  badges = [],
  actions,
  actionsTitle,
  emptyText,
}: {
  display: PopulationSliceDisplay;
  crop: MontageCrop;
  background: Uint8Array | null;
  cellWidth: number;
  imageHeight: number;
  current: boolean;
  crosshairStyle: CrosshairStyle;
  crosshairVisible: boolean;
  /** The card within the display ("all", "group:<id>", "difference:<a>\0<b>"). */
  cardId: string;
  label: string;
  header: string;
  /** The header's tooltip: what the card shows and its colour scale. */
  title?: string;
  image: ImageBitmap | null;
  /** The card's own colour scale; null when it shares the bar below the cards. */
  scale?: CardScale | null;
  badges?: readonly ('A' | 'B' | null)[];
  actions?: DropdownMenuItem[];
  actionsTitle?: string;
  emptyText?: string;
}) {
  const workspaceId = useStudioWorkspaceKey();
  const crosshair = useViewStateStore((s) => s.getWorkspaceViewState(workspaceId).crosshair);
  const mirrorX = useMirrorsView(display.query.request.orientation);
  const shown = useCroppedCard(
    image,
    display.data.plane as ViewPlane,
    crop,
    background,
    summaryCardIdentity(display, cardId),
  );
  const range = scale
    ? `${(scale.format ?? limitDisplay)(-scale.limit)} to ${(scale.format ?? limitDisplay)(scale.limit)}`
    : '';
  return (
    <section className="min-w-0" aria-label={label} data-testid="population-summary-card">
      {/* The card's header: its title, badges and, right-aligned inside it, the ⋯. */}
      <div
        data-testid="population-card-header"
        className="flex min-w-0 items-center gap-1.5 border-b border-bf-border-subtle text-bf-sm"
        style={{ height: CARD_HEADER_PX }}
      >
        <h3
          className="m-0 min-w-0 flex-1 whitespace-nowrap text-bf-sm font-medium tabular-nums"
          title={title ?? header}
        >
          {header}
        </h3>
        {badges
          .filter((badge): badge is 'A' | 'B' => !!badge)
          .map((badge) => (
            <span
              key={badge}
              data-testid={`population-card-badge-${badge}`}
              title={badge === 'A' ? 'This group is A' : 'This group is B'}
              className="shrink-0 rounded-sm border border-border px-1 font-mono text-bf-2xs text-foreground"
            >
              {badge}
            </span>
          ))}
        {actions && (
          <span className="ml-auto flex shrink-0" data-testid="population-card-actions">
          <DropdownMenu
            position="bottom-right"
            trigger={
              <IconButton
                size="xs"
                variant="ghost"
                icon={<MoreHorizontal />}
                aria-label={`Actions for ${label}`}
                title={actionsTitle}
              />
            }
            items={actions}
          />
          </span>
        )}
      </div>
      <div className="relative" style={{ height: imageHeight }}>
        <ReusableSliceViewport
          width={cellWidth}
          height={imageHeight}
          viewPlane={shown.plane}
          crosshair={{ ...crosshair, visible: crosshair.visible && crosshairVisible }}
          crosshairStyle={crosshairStyle}
          onWorldClick={(world) => {
            if (current) populationSliceActions.navigate(workspaceId, world, true);
          }}
          renderSurface={(props) => (
            <SliceViewerImageSurface
              {...props}
              mirrorX={mirrorX}
              image={shown.image}
              emptyFallback={
                emptyText ? (
                  <p className="absolute inset-0 grid place-items-center text-bf-sm text-muted-foreground">
                    {emptyText}
                  </p>
                ) : undefined
              }
            />
          )}
        />
      </div>
      {/* The card's own scale, or an empty row: images line up across cards. */}
      <div
        data-testid={scale ? 'population-card-scale' : undefined}
        className="flex min-w-0 items-center justify-center gap-1.5 font-mono text-bf-2xs tabular-nums text-bf-text-secondary"
        style={{ height: CARD_SCALE_PX }}
      >
        {scale ? (
          <PopulationScaleStrip
            limit={scale.limit}
            range={range}
            label={`Colour scale of ${scale.label}`}
            format={scale.format ?? limitDisplay}
            width={Math.max(40, Math.min(120, cellWidth - 130))}
            clipped={scaleClipping(scale.values, -scale.limit, scale.limit)}
          />
        ) : null}
      </div>
    </section>
  );
}
