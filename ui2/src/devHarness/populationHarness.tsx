/* eslint-disable react-refresh/only-export-components -- isolated dev-only visual entry */
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { PopulationLens } from '@/components/studio/PopulationLens';
import { PopulationSliceService } from '@/services/studio/PopulationSliceService';
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
  meta: {
    synthetic: true,
    sources: ids.map((memberId) => ({
      memberId,
      sourceRevision: { sha256: 'synthetic', sourceBytes: 0 },
      stackIndex: null,
      validCount: 1,
      error: null,
    })),
  },
}));
const slices = new PopulationSliceService(
  {
    async evaluate(request) {
      const dimension = 64;
      const field = (value: number) =>
        Array.from({ length: dimension * dimension }, (_, i) => {
          const x = (i % dimension) - 31.5,
            y = Math.floor(i / dimension) - 31.5;
          return (x * x) / 400 + (y * y) / 625 <= 1 ? value : null;
        });
      const observed = (id: string) => (ids.indexOf(id) < 40 ? 3 : -1);
      const values = request.workingMemberIds.map(observed);
      const mean = values.length ? values.reduce((a, b) => a + b, 0) / values.length : NaN;
      const summary =
        request.summary === 'coverage'
          ? values.length
          : request.summary === 'meanAbsolute'
            ? values.reduce((sum, v) => sum + Math.abs(v), 0) / values.length
            : request.summary === 'cancellation'
              ? values.reduce((sum, v) => sum + Math.abs(v), 0) / values.length - Math.abs(mean)
              : request.summary === 'sampleSd'
                ? Math.sqrt(
                    values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / (values.length - 1),
                  )
                : mean;
      return {
        plane: {
          origin_mm: [-31.5, 31.5, request.crosshairMm[2]],
          u_mm: [1, 0, 0],
          v_mm: [0, -1, 0],
          dim_px: [dimension, dimension],
        },
        centerWorld: [0, 0, 0],
        contextRange: [-1, 3],
        summary: field(summary),
        focused: field(request.focusMemberId ? observed(request.focusMemberId) : NaN),
        validCounts: field(values.length).map((v) => v ?? 0),
        eligibleCount: values.length,
        sources: request.members.map((member) => ({
          memberId: member.memberId,
          revision: { sha256: 'synthetic', sourceBytes: 0 },
        })),
        cutouts: request.cutouts
          ? (() => {
              const { centerMm, widthMm, dimPx, memberIds } = request.cutouts;
              const spacing = widthMm / dimPx;
              const origin: [number, number, number] = [
                centerMm[0] - (spacing * (dimPx - 1)) / 2,
                centerMm[1] + (spacing * (dimPx - 1)) / 2,
                centerMm[2],
              ];
              return {
                plane: {
                  origin_mm: origin,
                  u_mm: [spacing, 0, 0] as [number, number, number],
                  v_mm: [0, -spacing, 0] as [number, number, number],
                  dim_px: [dimPx, dimPx] as [number, number],
                },
                members: memberIds.map((memberId) => {
                  const samples = Array.from({ length: dimPx ** 2 }, (_, i) => {
                    const x = origin[0] + (i % dimPx) * spacing,
                      y = origin[1] - Math.floor(i / dimPx) * spacing;
                    return (x * x) / 400 + (y * y) / 625 <= 1 ? observed(memberId) : null;
                  });
                  return {
                    memberId,
                    values: samples,
                    validPixels: samples.filter((v) => v !== null).length,
                  };
                }),
              };
            })()
          : null,
        sourceCacheHit: true,
        cachedBytes: 0,
        sampling: 'nearest',
      };
    },
    async release() {},
    async bitmap(rgba, width, height) {
      const data = new ImageData(width, height);
      data.data.set(rgba);
      return createImageBitmap(data);
    },
  },
  0,
);
function Harness() {
  const focus = useSetStudioStore((state) => state.selection.activeMemberId);
  return (
    <main className="mx-auto h-screen max-w-5xl overflow-y-auto p-5 text-foreground">
      <h1 className="mb-2 text-lg font-medium">Population probe interaction harness</h1>
      <p className="mb-5 text-sm text-muted-foreground">
        80 synthetic observations: forty +3, forty −1. The ellipse images and sampled values are
        synthetic; native sampling is not exercised here.
      </p>
      <div className="mb-3 rounded border border-border bg-card p-4 text-sm">
        Focused observation: <span data-testid="fixture-focus">{focus}</span>
      </div>
      <PopulationLens service={slices} probeController={controller} />
      <PopulationProbePanel controller={controller} />
    </main>
  );
}
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Harness />
  </StrictMode>,
);
