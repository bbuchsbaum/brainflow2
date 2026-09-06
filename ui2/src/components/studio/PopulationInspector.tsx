import { useSetStudioStore } from '@/stores/setStudioStore';
import { resolvePopulation } from '@/services/studio/populationContext';
import { PopulationUnitControls } from './PopulationUnitControls';
import { PopulationMaskControls } from './PopulationMaskControls';

/** Population settings live in Brainflow's existing Inspector, across dock roots. */
export function PopulationInspector() {
  const state = useSetStudioStore();
  const set = state.sets[state.selection.activeSetId ?? ''];
  const population = resolvePopulation(state);
  const saved = set?.savedPopulation;
  const source = saved?.members.find(
    (member) => member.memberId === state.selection.activeMemberId,
  );
  return (
    <section aria-label="Population inspector" className="flex min-w-0 flex-col gap-3 p-3 text-sm">
      <div>
        <h2 className="font-medium">Population</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          {population.workingMemberIds.length} selected / {population.context.memberIds.length}{' '}
          available
        </p>
      </div>
      <div className="border-t border-border pt-3 text-xs">
        <div className="text-muted-foreground">Focused observation</div>
        <p className="mt-1 break-all font-mono">{state.selection.activeMemberId ?? 'None'}</p>
        {source?.stackIndex != null && (
          <p className="mt-1 text-muted-foreground">
            Frame {source.stackIndex + 1} · saved index {source.stackIndex}
          </p>
        )}
      </div>
      <PopulationUnitControls />
      <PopulationMaskControls />
      <div className="border-t border-border pt-3 text-xs">
        <div className="text-muted-foreground">Spatial probe</div>
        <p className="mt-1">
          {state.population.pinnedProbe
            ? `${state.population.pinnedProbe.worldMm.map((value) => value.toFixed(1)).join(', ')} mm · ${state.population.pinnedProbe.radiusMm ? `${state.population.pinnedProbe.radiusMm} mm radius` : 'point'}`
            : 'Pin a location in the brain or the values panel.'}
        </p>
      </div>
      {saved && (
        <details className="border-t border-border pt-3 text-xs">
          <summary className="cursor-pointer font-medium">
            Saved calculation · verified inputs
          </summary>
          <p className="mt-2 break-all text-muted-foreground">{saved.recordPath}</p>
          <p
            className="mt-2 break-all font-mono text-muted-foreground"
            title="SHA-256 of the opened calculation record"
          >
            {saved.recordSha256}
          </p>
          {saved.notices.map((notice) => (
            <p key={notice} className="mt-2 leading-5 text-muted-foreground">
              {notice}
            </p>
          ))}
        </details>
      )}
      <p className="text-xs leading-5 text-muted-foreground">
        Summaries describe the selected observations. Focusing an individual keeps the selection and
        anatomical position fixed.
      </p>
    </section>
  );
}
