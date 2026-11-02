import React, { useMemo, useState } from 'react';
import type { BidsEventRow, BidsRunDetail, BidsSliceImage } from '@brainflow/api';
import { Button, Chip, KeyValue, Notice, Section } from '@/components/ui/bf';
import { useBidsResource } from '@/hooks/useBidsResource';
import { openRunInViewer } from '@/services/bids/openRunInViewer';
import { useBidsModel, useBidsStore } from '@/stores/bidsStore';
import { runLabel, type BidsModel, type BidsRunFacts } from '@/stores/bidsModel';
import { BidsChecks } from './BidsChecks';
import { BidsFdCarpet } from './BidsFdCarpet';
import { BidsMetaCompare } from './BidsMetaCompare';
import { BidsRunEvents } from './BidsRunEvents';
import { RunSlice, SliceFrame, SliceFrameText, SliceTile } from './BidsSliceImage';
import { fetchMedianSlice, formatZ, isImageUnavailable, sliceKind } from './bidsSlices';

const Muted = ({ children }: { children: React.ReactNode }) => (
  <p className="m-0 text-bf-xs text-bf-text-muted">{children}</p>
);

const Failed = ({ what, message }: { what: string; message: string }) => (
  <Notice severity="danger" role="alert">
    {what} could not be read: {message}
  </Notice>
);

function participantFacts(model: BidsModel, facts: BidsRunFacts): string {
  const row = model.rows.find((item) => item.subject === facts.run.subject);
  const person = [row?.sex, row?.age].filter(Boolean).join(' ');
  return [row?.group, person].filter(Boolean).join(' · ');
}

function runVariant(facts: BidsRunFacts): string | null {
  return facts.run.variant_id ? `variant ${facts.run.variant_id}` : null;
}

function qualityChip(facts: BidsRunFacts, threshold: number): string | null {
  if (facts.meanFd !== null && facts.meanFd > threshold) return `mean FD ${facts.meanFd.toFixed(2)} mm`;
  if (facts.tsnr !== null && facts.tsnrOutlier) return `tSNR ${Math.round(facts.tsnr)}, series outlier`;
  return null;
}

/** The same participant's T1w, this session's when there is one. */
function t1wOf(model: BidsModel, facts: BidsRunFacts) {
  const own = model.runs.filter(
    (item) => item.run.subject === facts.run.subject && item.run.suffix === 'T1w',
  );
  return (own.find((item) => item.run.session === facts.run.session) ?? own[0])?.run ?? null;
}

function Thumbnails({
  model,
  facts,
  datasetPath,
}: {
  model: BidsModel;
  facts: BidsRunFacts;
  datasetPath: string | null;
}) {
  const t1w = facts.run.suffix === 'T1w' ? null : t1wOf(model, facts);
  const compare = useBidsStore((state) => state.compareWithModal);
  return (
    <div className="flex flex-col gap-1" data-testid="bids-thumbnails">
      <div className="grid grid-cols-2 gap-1.5">
        <RunSlice
          run={facts.run}
          datasetPath={datasetPath}
          maxPx={160}
          alt={facts.run.suffix === 'bold' ? 'Mean EPI, axial' : `${facts.run.suffix}, axial`}
        />
        {t1w ? (
          <RunSlice run={t1w} kind="anat" datasetPath={datasetPath} maxPx={160} alt="T1w, axial" />
        ) : (
          <SliceFrame>
            <SliceFrameText>No T1w for this participant.</SliceFrameText>
          </SliceFrame>
        )}
      </div>
      {compare ? <CompareWithModal model={model} facts={facts} datasetPath={datasetPath} /> : null}
    </div>
  );
}

const COMPARE_PX = 240;

function CompareWithModal({
  model,
  facts,
  datasetPath,
}: {
  model: BidsModel;
  facts: BidsRunFacts;
  datasetPath: string | null;
}) {
  const { run } = facts;
  const [image, setImage] = useState<{ runId: string; image: BidsSliceImage } | null>(null);
  const own = image?.runId === run.id ? image.image : null;
  const unavailable = isImageUnavailable(run);
  // The modal group of the series: not a variant, not excluded, image present.
  const paths = useMemo(
    () =>
      model.runs
        .filter(
          (item) =>
            item.run.series === run.series &&
            item.variantKey === null &&
            !item.excluded &&
            !isImageUnavailable(item.run),
        )
        .map((item) => item.run.path),
    [model.runs, run.series],
  );
  const z = own?.world_z_mm ?? null;
  const kind = sliceKind(run);
  const median = useBidsResource(
    // The paths are part of the key: an exclusion changes which runs make the median.
    own && paths.length ? `${datasetPath}|median|${run.series}|${z}|${kind}|${paths.join('|')}` : null,
    () => fetchMedianSlice(paths, { path: run.path, kind, world_z_mm: z, max_px: COMPARE_PX }),
  );
  return (
    <div className="mt-1 flex flex-col gap-1" data-testid="bids-compare">
      <div className="grid grid-cols-2 gap-1.5">
        <RunSlice
          run={run}
          datasetPath={datasetPath}
          maxPx={COMPARE_PX}
          alt="This run"
          onImage={(next) => setImage({ runId: run.id, image: next })}
        />
        <SliceFrame>
          {median.status === 'ready' ? (
            <SliceTile image={median.data.image} alt="Dataset median" className="opacity-90" />
          ) : median.status === 'error' ? (
            <SliceFrameText role="alert">Median could not be built: {median.error}</SliceFrameText>
          ) : paths.length === 0 ? (
            <SliceFrameText>No modal runs to take a median of.</SliceFrameText>
          ) : unavailable ? (
            <SliceFrameText>This run's image is not available, so there is no slice to match.</SliceFrameText>
          ) : (
            <SliceFrameText>Loading…</SliceFrameText>
          )}
        </SliceFrame>
      </div>
      {median.status === 'ready' ? (
        <p className="m-0 text-bf-2xs text-bf-text-faint">
          Left: this run. Right: dataset median of {median.data.runs_used} modal{' '}
          {median.data.runs_used === 1 ? 'run' : 'runs'}
          {median.data.runs_skipped ? `, ${median.data.runs_skipped} unreadable and skipped` : ''}, same
          slice{own?.world_z_mm != null ? ` (${formatZ(own.world_z_mm)})` : ''}. Each image uses its own
          2nd to 98th percentile window: the same rule, not the same numbers.
        </p>
      ) : null}
    </div>
  );
}

function Derivatives({
  model,
  facts,
  detail,
}: {
  model: BidsModel;
  facts: BidsRunFacts;
  detail: BidsRunDetail;
}) {
  const index = model.index;
  if (!index || index.derivatives.length === 0) {
    return <Muted>No derivatives in this dataset.</Muted>;
  }
  const own = index.derivative_status.filter(
    (entry) =>
      entry.subject === facts.run.subject &&
      entry.status !== 'current' &&
      entry.status !== 'unrecorded',
  );
  return (
    <div className="flex flex-col gap-1">
      <BidsChecks checks={detail.derivative_checks} />
      {own.length ? (
        <BidsChecks
          checks={own.map((entry) => ({
            ok: false,
            severity: entry.status === 'missing' ? 'warning' : 'error',
            text: `${entry.name}: ${entry.status} for this participant`,
          }))}
        />
      ) : null}
    </div>
  );
}

function FieldMap({ model, facts }: { model: BidsModel; facts: BidsRunFacts }) {
  const link = facts.run.fmap;
  if (!link || link.via === 'none') {
    if (facts.run.datatype === 'anat' || facts.run.datatype === 'fmap') {
      return <Muted>Not applicable to this image.</Muted>;
    }
    return (
      <>
        <Notice severity="warning" role={undefined}>
          No field map for this run.
        </Notice>
        {link ? (
          <BidsChecks checks={link.checks.filter((check) => !/^no field map\b/i.test(check.text))} />
        ) : null}
      </>
    );
  }
  const names = link.fmap_run_ids.map((id) => {
    const target = model.runsById.get(id);
    return target ? runLabel(target.run) : id;
  });
  return (
    <div className="flex flex-col gap-1">
      <KeyValue
        layout="rows"
        wrap
        items={[
          { key: 'via', label: link.via, value: link.source_id ?? 'listed on the field map' },
          { key: 'maps', label: 'Field maps', value: names.join(' / ') || 'none found' },
        ]}
      />
      <BidsChecks checks={link.checks} />
    </div>
  );
}

function LandingNote({ facts }: { facts: BidsRunFacts }) {
  const peak = facts.run.fd?.peak_volume;
  const parts: string[] = [];
  if (peak !== undefined) parts.push(`lands on frame ${peak + 1} (FD peak)`);
  if (facts.run.has_events) parts.push('with events as a track');
  if (parts.length === 0) return null;
  return <p className="m-0 text-bf-2xs text-bf-text-faint">Open in viewer {parts.join(' ')}.</p>;
}

function RunInspector({ model, facts }: { model: BidsModel; facts: BidsRunFacts }) {
  const { run } = facts;
  const datasetPath = useBidsStore((state) => state.datasetPath);
  const loadRunDetail = useBidsStore((state) => state.loadRunDetail);
  const loadRunEvents = useBidsStore((state) => state.loadRunEvents);
  const requestAction = useBidsStore((state) => state.requestAction);
  const compare = useBidsStore((state) => state.compareWithModal);
  const index = model.index;

  const detail = useBidsResource<BidsRunDetail | null>(`${datasetPath}|${run.id}`, () =>
    loadRunDetail(run.id),
  );
  const events = useBidsResource<BidsEventRow[]>(
    run.has_events ? `${datasetPath}|events|${run.id}` : null,
    () => loadRunEvents(run.id),
  );
  const variant = runVariant(facts);
  const quality = qualityChip(facts, model.fdThreshold);
  const facts1 = participantFacts(model, facts);
  const isBold = run.suffix === 'bold';
  const loaded = detail.status === 'ready' ? detail.data : null;
  const eventCount = events.status === 'ready' ? events.data.length : null;

  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="bids-inspector" data-run={run.id}>
      <header className="flex h-10 shrink-0 items-center gap-2 border-b border-bf-border-subtle px-3">
        <span className="min-w-0 flex-1 truncate font-mono text-bf-xs text-bf-text-primary" title={run.id}>
          {runLabel(run)}
        </span>
        <Button variant="primary" size="sm" onClick={() => void openRunInViewer(run)}>
          Open in viewer ↵
        </Button>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="flex flex-col gap-2 p-3" data-testid="bids-run-head">
          <div className="flex flex-wrap items-center gap-1.5 text-bf-xs text-bf-text-muted">
            {facts1 ? <span>{facts1}</span> : null}
            {variant ? <Chip>{variant}</Chip> : null}
            {quality ? <Chip>{quality}</Chip> : null}
            {facts.excluded ? <Chip>excluded</Chip> : null}
          </div>
          <Thumbnails model={model} facts={facts} datasetPath={datasetPath} />
        </div>

        <Section variant="static" title="Framewise displacement and carpet">
          {!isBold ? (
            <Muted>Not a BOLD run.</Muted>
          ) : detail.status === 'error' ? (
            <Failed what="Motion" message={detail.error} />
          ) : loaded ? (
            <BidsFdCarpet
              facts={facts}
              detail={loaded}
              modalGroup={model.fdGroups.find((group) => group.modal)}
              datasetPath={datasetPath}
            />
          ) : detail.status === 'ready' ? (
            <Muted>The dataset changed before this run was read.</Muted>
          ) : (
            <Muted>Loading…</Muted>
          )}
        </Section>

        <Section variant="static" title="Effective metadata vs modal">
          {index ? <BidsMetaCompare run={run} index={index} /> : null}
        </Section>

        <Section variant="static" title="Field map">
          <FieldMap model={model} facts={facts} />
        </Section>

        <Section
          variant="static"
          title="Events"
          meta={
            eventCount !== null
              ? `${eventCount} ${eventCount === 1 ? 'event' : 'events'}${loaded?.events_duration != null ? ` · ${loaded.events_duration.toFixed(1)} s` : ''}`
              : undefined
          }
        >
          {!run.has_events ? (
            <Muted>No events file for this run.</Muted>
          ) : events.status === 'error' ? (
            <Failed what="Events" message={events.error} />
          ) : detail.status === 'error' ? (
            <Failed what="Event checks" message={detail.error} />
          ) : events.status === 'ready' && loaded ? (
            <BidsRunEvents run={run} events={events.data} detail={loaded} />
          ) : (
            <Muted>Loading…</Muted>
          )}
        </Section>

        <Section variant="static" title="Derivatives">
          {detail.status === 'error' ? (
            <Failed what="Derivatives" message={detail.error} />
          ) : loaded ? (
            <Derivatives model={model} facts={facts} detail={loaded} />
          ) : (
            <Muted>Loading…</Muted>
          )}
        </Section>

        <Section variant="static" title="Actions">
          <div className="flex flex-wrap gap-1.5">
            <Button
              variant="secondary"
              size="sm"
              aria-pressed={compare}
              onClick={() => requestAction('compare')}
            >
              Compare with modal (C)
            </Button>
            <Button variant="secondary" size="sm" onClick={() => requestAction('exclude')}>
              Exclude (X)
            </Button>
          </div>
          <LandingNote facts={facts} />
        </Section>
      </div>
    </div>
  );
}

/** The selected run's detail, in design order. Lazy, and always the current run's. */
export function BidsInspector() {
  const model = useBidsModel();
  const selectedRunId = useBidsStore((state) => state.selectedRunId);
  const facts = selectedRunId ? model.runsById.get(selectedRunId) : undefined;
  if (!facts) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 px-3 py-8 text-center text-bf-sm text-muted-foreground">
        <div className="text-foreground">No run selected</div>
        <div className="text-bf-xs text-muted-foreground">
          Select a run in the matrix, the runs dock or Files to see its detail here.
        </div>
      </div>
    );
  }
  return <RunInspector key={facts.run.id} model={model} facts={facts} />;
}
