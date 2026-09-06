import type { ComponentProps } from 'react';
import { useSetStudioStore } from '@/stores/setStudioStore';
import { useViewStateStore } from '@/stores/viewStateStore';
import { ReusableSliceViewport, SliceViewerImageSurface } from '@/components/views/sliceViewer';
import {
  populationSliceActions,
  type PopulationSliceDisplay,
} from '@/services/studio/PopulationSliceService';
import { populationProbeActions } from '@/services/studio/PopulationProbeActions';
const control = 'rounded border border-border bg-background px-2 py-1 text-xs disabled:opacity-40';
export function PopulationGroupViews({
  display,
  width,
  current,
  crosshairStyle,
  crosshairVisible,
}: {
  display: PopulationSliceDisplay;
  width: number;
  current: boolean;
  crosshairStyle: ComponentProps<typeof ReusableSliceViewport>['crosshairStyle'];
  crosshairVisible: boolean;
}) {
  const state = useSetStudioStore();
  const workspaceId = useViewStateStore((s) => s.activeWorkspaceKey);
  const crosshair = useViewStateStore((s) => s.viewState.crosshair);
  const columns = width < 600 ? 1 : 2;
  const cellWidth = Math.max(100, Math.floor((width - (columns - 1) * 12) / columns));
  return (
    <div
      className="grid gap-3"
      aria-label="Factor group means"
      style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}
    >
      {(display.data.groups ?? []).map((group) => {
        const operand = display.query.request.groups?.find((g) => g.id === group.id);
        const definition = operand
          ? { ...operand, label: display.query.groupLabels?.[group.id] ?? group.id }
          : null;
        if (!definition) return null;
        return (
          <section
            key={group.id}
            className="min-w-0 rounded border border-border p-2"
            aria-label={definition.label}
          >
            <h3 className="truncate text-sm font-medium" title={definition.label}>
              {definition.label}
            </h3>
            <p className="my-1 text-xs text-muted-foreground">
              {group.eligibleCount} observations · {group.unitCount}{' '}
              {display.query.request.aggregation ? 'participants' : 'analysis units'} · mean · ±
              {display.effectLimit.toPrecision(3)}
            </p>
            <div className="relative h-[220px] bg-black">
              <ReusableSliceViewport
                width={cellWidth - 16}
                height={220}
                viewPlane={display.data.plane}
                crosshair={{ ...crosshair, visible: crosshair.visible && crosshairVisible }}
                crosshairStyle={crosshairStyle}
                onWorldClick={(world) => {
                  if (current) populationSliceActions.navigate(workspaceId, world, true);
                }}
                renderSurface={(props) => (
                  <SliceViewerImageSurface
                    {...props}
                    image={display.images.groups[group.id] ?? null}
                  />
                )}
              />
            </div>
            <div className="mt-2 flex flex-wrap gap-2">
              <button
                className={control}
                disabled={!current}
                onClick={() =>
                  populationProbeActions.select(
                    definition.memberIds,
                    'replace',
                    'metadata',
                    definition.label,
                  )
                }
              >
                Use as A
              </button>
              <button
                className={control}
                disabled={!current}
                onClick={() => {
                  const id = state.createSavedCohort({
                    memberIds: [...definition.memberIds],
                    label: definition.label,
                    originLabel: `Factor ${state.population.partition?.column}`,
                  });
                  if (id) {
                    state.setPopulationReferenceMode('cohort');
                    state.setCompareCohort(id);
                  }
                }}
              >
                Use as B
              </button>
              <button
                className={control}
                disabled={!current}
                onClick={() =>
                  state.setPopulationPresentation({
                    ...state.population.presentation,
                    arrangement: 'montage',
                    contributorsGroupId: group.id,
                  })
                }
              >
                Show contributors
              </button>
            </div>
          </section>
        );
      })}
    </div>
  );
}
