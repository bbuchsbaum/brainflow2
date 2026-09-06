import { setTransport } from '@/services/transport';
import { PopulationUnitControls } from '@/components/studio/PopulationUnitControls';
import { DesignPane } from '@/components/studio/DesignPane';
import { useStudioDerivedState } from '@/hooks/useStudioDerivedState';
/* eslint-disable react-refresh/only-export-components -- isolated dev-only visual entry */
import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { PopulationLens } from '@/components/studio/PopulationLens';
import { PopulationSliceService } from '@/services/studio/PopulationSliceService';
import { PopulationProbePanel } from '@/components/studio/PopulationProbePanel';
import { PopulationProbeController } from '@/services/studio/PopulationProbeController';
import { useSetStudioStore } from '@/stores/setStudioStore';
import '../index.css';

if (!import.meta.env.DEV) throw new Error('This synthetic harness is development-only.');
document.documentElement.classList.add('dark');
const maskMode = new URLSearchParams(location.search).has('mask');
const exportMode = new URLSearchParams(location.search).has('export');
const fakeHash = 'a'.repeat(64);
const fakeMaskHash = 'b'.repeat(64);
if (maskMode || exportMode)
  setTransport({
    async invoke<T>(command: string, args?: Record<string, unknown>): Promise<T> {
      if (command === 'plugin:dialog|open')
        return (
          (args?.options as { directory?: boolean })?.directory
            ? '/synthetic/export'
            : '/synthetic/left-half-mask.nii'
        ) as T;
      if (command === 'export_population_summary') {
        window.dispatchEvent(new CustomEvent('synthetic-export', { detail: args?.request }));
        return {
          directory: '/synthetic/export/population-demo',
          summaryPath: '/synthetic/export/population-demo/summary.nii.gz',
          coveragePath: '/synthetic/export/population-demo/coverage.nii.gz',
          provenancePath: '/synthetic/export/population-demo/provenance.json',
        } as T;
      }
      throw new Error(`Unexpected synthetic command: ${command}`);
    },
  });
const metadataMode = new URLSearchParams(location.search).has('metadata');
const ids = Array.from(
  { length: metadataMode ? 161 : 80 },
  (_, i) => `S${String(i + 1).padStart(3, '0')}`,
);
const metadataFor = (id: string, i: number) => ({
  observation: id,
  group: i < 40 ? 'A' : 'B',
  participant: i < 40 ? 'P001' : `P${String(i - 38).padStart(3, '0')}`,
  site: i < 80 ? 'early-site' : 'late-site',
});
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
    memberSummaries: ids.map((id, i) => ({
      id,
      sourcePath: `/synthetic/${id}.nii`,
      designValues: metadataFor(id, i),
    })),
    savedCohortIds: [],
    ingestAudit: {
      ...original.ingestAudit,
      sourceLabel: 'Synthetic metadata fixture',
      join: {
        matchedRows: ids.length,
        unmatchedRows: 0,
        duplicateKeys: 0,
        severity: 'ok',
        issueDetails: [],
      },
      notes: [],
    },
    designColumns: ['observation', 'group', 'participant', 'site'],
    designTablePreview: {
      columns: ['observation', 'group', 'participant', 'site'],
      rows: ids.slice(0, 6).map((id, i) => ({
        id,
        cells: Object.values(metadataFor(id, i)),
      })),
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
          value:
            request.locus.kind === 'set' && request.locus.mask && request.locus.worldMm[0] >= 0
              ? null
              : ids.indexOf(member.memberId) < 40
                ? 3
                : -1,
        }))
      : [],
  meta: {
    synthetic: true,
    sources: ids.map((memberId) => ({
      memberId,
      sourceRevision: { sha256: fakeHash, sourceBytes: 0 },
      ...(request.locus.kind === 'set' && request.locus.mask
        ? { maskRevision: { sha256: fakeMaskHash, sourceBytes: 0 } }
        : {}),
      stackIndex: null,
      validCount:
        request.locus.kind === 'set' && request.locus.mask && request.locus.worldMm[0] >= 0 ? 0 : 1,
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
          return (x * x) / 400 + (y * y) / 625 <= 1 && (!request.mask || x < 0) ? value : null;
        });
      const observed = (id: string) => (ids.indexOf(id) < 40 ? 3 : -1);
      const values = request.aggregation
        ? request.aggregation.groups.map(
            (group) =>
              group.memberIds.reduce((sum, id) => sum + observed(id), 0) / group.memberIds.length,
          )
        : request.workingMemberIds.map(observed);
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
        eligibleCount: request.workingMemberIds.length,
        unitCount: values.length,
        sources: request.members.map((member) => ({
          memberId: member.memberId,
          revision: { sha256: fakeHash, sourceBytes: 0 },
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
                    return (x * x) / 400 + (y * y) / 625 <= 1 && (!request.mask || x < 0)
                      ? observed(memberId)
                      : null;
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
        maskRevision: request.mask ? { sha256: fakeMaskHash, sourceBytes: 0 } : null,
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
  const [exported, setExported] = useState<unknown>(null);
  useEffect(() => {
    const onExport = (event: Event) => setExported((event as CustomEvent).detail);
    window.addEventListener('synthetic-export', onExport);
    return () => window.removeEventListener('synthetic-export', onExport);
  }, []);
  const focus = useSetStudioStore((state) => state.selection.activeMemberId);
  return (
    <main className="mx-auto h-screen max-w-5xl overflow-y-auto p-5 text-foreground">
      <h1 className="mb-2 text-lg font-medium">Population probe interaction harness</h1>
      <p className="mb-5 text-sm text-muted-foreground">
        80 synthetic observations: forty +3, forty −1. The ellipse images and sampled values are
        synthetic; native sampling is not exercised here.{' '}
        {(maskMode || exportMode) &&
          'File choice and export are simulated; no files are written. Digests are synthetic.'}
      </p>
      <div className="mb-3 rounded border border-border bg-card p-4 text-sm">
        Focused observation: <span data-testid="fixture-focus">{focus}</span>
      </div>
      <PopulationUnitControls />
      <PopulationLens service={slices} probeController={controller} />
      <PopulationProbePanel controller={controller} />
      {exportMode && exported != null && (
        <pre
          data-testid="synthetic-export-receipt"
          className="whitespace-pre-wrap break-all text-xs"
        >
          {JSON.stringify(exported, null, 2)}
        </pre>
      )}
    </main>
  );
}
function MetadataHarness() {
  const derived = useStudioDerivedState();
  const state = useSetStudioStore();
  return (
    <main className="mx-auto flex h-screen max-w-5xl flex-col gap-3 p-4 text-foreground">
      <h1>Complete metadata · synthetic UI harness</h1>
      <p className="text-sm text-muted-foreground">
        161 observations; import preview contains six rows. Native import is not exercised here.
      </p>
      <div>
        Focused observation:{' '}
        <span data-testid="fixture-focus">{state.selection.activeMemberId}</span>
      </div>
      <PopulationUnitControls />
      <DesignPane
        activeSet={derived.activeSet}
        activeMemberId={state.selection.activeMemberId}
        cohorts={[]}
        visibleMemberIds={derived.visibleMemberIds}
        designSearch={state.designSearch}
        sortColumn={state.sortColumn}
        sortDirection={state.sortDirection}
        activeDesignFilters={state.activeDesignFilters}
        quickFilterOptions={derived.quickFilterOptions}
        onSelectMember={state.setActiveMember}
        onDesignSearchChange={state.setDesignSearch}
        onSortColumnChange={state.setSortColumn}
        onToggleSortDirection={state.toggleSortDirection}
        onToggleDesignFilter={state.toggleDesignFilter}
        onRemoveDesignFilter={state.removeDesignFilter}
        onClearSubsetNarrowing={state.clearSubsetNarrowing}
      />
    </main>
  );
}
createRoot(document.getElementById('root')!).render(
  <StrictMode>{metadataMode ? <MetadataHarness /> : <Harness />}</StrictMode>,
);
