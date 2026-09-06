/* eslint-disable react-refresh/only-export-components -- isolated dev-only visual entry */
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { PopulationProbePanel } from '@/components/studio/PopulationProbePanel';
import { PopulationProbeController } from '@/services/studio/PopulationProbeController';
import { useSetStudioStore } from '@/stores/setStudioStore';
import '../index.css';

if (!import.meta.env.DEV) throw new Error('This synthetic harness is development-only.');
document.documentElement.classList.add('dark');
const ids = Array.from({ length: 80 }, (_, i) => `S${String(i + 1).padStart(3, '0')}`);
const state = useSetStudioStore.getState();
state.loadDemoSession();
const demo = useSetStudioStore.getState();
const original = demo.sets[demo.selection.activeSetId!];
demo.bootstrapStudio({
  set: {
    ...original,
    id: 'population-ui-fixture',
    name: 'Synthetic opposing observations',
    memberCount: ids.length,
    memberIds: ids,
    memberSummaries: ids.map((id) => ({ id, sourcePath: `/synthetic/${id}.nii` })),
    savedCohortIds: [],
    designTablePreview: {
      columns: ['observation', 'group'],
      rows: ids.map((id, i) => ({ id, cells: [id, i < 40 ? 'A' : 'B'] })),
    },
  },
  features: Object.values(demo.features),
  cohorts: [],
  expressions: [],
  selection: { activeMemberId: ids[0] },
});
const controller = new PopulationProbeController(async (request) => ({
  columns: [
    { name: 'member', role: 'nominal' },
    { name: 'value', role: 'quantitative' },
  ],
  rows:
    request.locus.kind === 'set'
      ? request.locus.members.map((member) => ({
          member: member.memberId,
          value: ids.indexOf(member.memberId) < 40 ? 3 : -1,
        }))
      : [],
  meta: { synthetic: true },
}));
function Harness() {
  const focus = useSetStudioStore((state) => state.selection.activeMemberId);
  return (
    <main className="mx-auto max-w-5xl p-5 text-foreground">
      <h1 className="mb-2 text-lg font-medium">Population probe interaction harness</h1>
      <p className="mb-5 text-sm text-muted-foreground">
        80 synthetic observations: forty +3, forty −1. Native sampling and brain images are not
        exercised here.
      </p>
      <div className="mb-3 rounded border border-border bg-card p-4 text-sm">
        Focused observation: <span data-testid="fixture-focus">{focus}</span>
      </div>
      <PopulationProbePanel controller={controller} />
    </main>
  );
}
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Harness />
  </StrictMode>,
);
