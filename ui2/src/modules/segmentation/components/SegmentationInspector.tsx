import React, { useState } from 'react';
import { Button, EmptyPane, Pager, Section, TextField } from '@/components/ui/bf';
import { useActiveWorkspaceId, useLoadedVolumeLayers } from '@/modules/api/host';
import { LabelList } from './shared/LabelList';
import { SliceProgress } from './shared/SliceProgress';
import { saveSegmentationLabels, segmentationFrameCounts, segmentationFrames, segmentationSaveState, setSegmentationLabelState, setSegmentationPresentation, travelSegmentationHistory, useSegmentationSession } from '@/modules/segmentation/session';

const fileName = (path: string) => path.split(/[\\/]/).pop() ?? path;

export function SegmentationInspector() {
  const workspaceId = useActiveWorkspaceId();
  const session = useSegmentationSession(workspaceId ?? '');
  const loaded = useLoadedVolumeLayers();
  const [filter, setFilter] = useState(''), [page, setPage] = useState(1);
  if (!workspaceId || !session?.info) return <EmptyPane title="Segment" hint="Create a segmentation session in Segment mode." />;
  const snapshot = session.info.snapshot;
  const labels = snapshot.labels.map((label) => ({ id: label.definition.id, name: label.definition.name, long: label.definition.name, color: `rgb(${label.definition.color.join(' ')})`, voxels: label.voxels, mm3: label.mm3, locked: label.locked, visible: !session.hiddenLabelIds.includes(label.definition.id), status: label.complete ? 'complete' as const : label.voxels > 0 ? 'in-progress' as const : 'not-started' as const }));
  const filtered = labels.filter((label) => `${label.id} ${label.name}`.toLocaleLowerCase().includes(filter.toLocaleLowerCase()));
  const pageCount = Math.max(1, Math.ceil(filtered.length / 32)), currentPage = Math.min(page, pageCount);
  const shown = filtered.slice((currentPage - 1) * 32, currentPage * 32);
  const active = snapshot.labels.find((row) => row.definition.id === session.activeLabelId);
  const saved = session.lastSave?.sessionId === snapshot.sessionId ? session.lastSave : null;
  const saveState = segmentationSaveState(session), frames = segmentationFrames(snapshot, segmentationFrameCounts(snapshot, loaded));
  return <div className="h-full overflow-auto text-bf-xs" data-session-id={snapshot.sessionId}>
    <Section title="Session"><p className="text-bf-text-secondary">{snapshot.identity.subject} · {snapshot.identity.hemisphere}</p><p className="font-mono text-bf-2xs text-bf-text-muted">{snapshot.identity.rater} · revision {snapshot.revision} · <span data-testid="segmentation-save-state">{saveState}</span></p>
      {frames ? <p className="font-mono text-bf-2xs text-bf-text-muted" data-testid="segmentation-frames">{frames} (recorded in the saved header)</p> : null}
      <p className="mt-2 text-bf-2xs text-bf-text-muted">Free tracing. No anatomical protocol is attached.</p>
      <p className="mt-1 text-bf-2xs text-bf-text-secondary" data-testid="segmentation-workflow">Pick the brush (B) and drag to paint · scroll to step slices · mark each label complete · save as NIfTI.</p>
      <Button size="sm" className="mt-2" disabled={session.busy} onClick={() => void saveSegmentationLabels(workspaceId)}>Save labels as NIfTI…</Button>
      {saved ? <p role="status" className="mt-2 text-bf-2xs text-bf-text-muted">Saved revision {saved.revision} to <span className="font-mono">{fileName(saved.labelPath)}</span> with its label table <span className="font-mono">{fileName(saved.tablePath)}</span>.</p> : null}
    </Section>
    <Section title="Labels">{labels.length > 32 ? <TextField aria-label="Find a label" placeholder="Find a label" value={filter} onChange={(event) => { setFilter(event.target.value); setPage(1); }} /> : null}<LabelList labels={shown} activeId={session.activeLabelId} onSelect={(id) => setSegmentationPresentation(workspaceId, { activeLabelId: id })} onToggleVisibility={(id) => setSegmentationPresentation(workspaceId, { hiddenLabelIds: session.hiddenLabelIds.includes(id) ? session.hiddenLabelIds.filter((x) => x !== id) : [...session.hiddenLabelIds, id] })} onToggleLock={(id) => { const label = snapshot.labels.find((x) => x.definition.id === id); if (label) void setSegmentationLabelState(workspaceId, id, !label.locked, label.complete); }} />
      {pageCount > 1 ? <Pager page={currentPage} count={pageCount} onPageChange={setPage} label="Labels" noun="page" /> : null}
      {active ? <Button size="sm" className="mt-2" disabled={session.busy} onClick={() => void setSegmentationLabelState(workspaceId, active.definition.id, !active.complete, !active.complete)}>{active.complete ? `Reopen ${active.definition.name}` : `Mark ${active.definition.name} complete`}</Button> : null}
      <SliceProgress snapshot={snapshot} activeId={session.activeLabelId} current={session.sliceIndex} onPick={(sliceIndex) => { if (!session.busy) setSegmentationPresentation(workspaceId, { sliceIndex }); }} />
    </Section>
    <Section title="History"><div className="flex flex-col items-start gap-2"><Button size="sm" disabled={!snapshot.undo || session.busy} onClick={() => void travelSegmentationHistory(workspaceId)}>Undo{snapshot.undo ? ` ${snapshot.undo}` : ''}</Button><Button size="sm" disabled={!snapshot.redo || session.busy} onClick={() => void travelSegmentationHistory(workspaceId, true)}>Redo{snapshot.redo ? ` ${snapshot.redo}` : ''}</Button></div>
      <p className="mt-2 text-bf-2xs text-bf-text-muted">Each stroke is one history step. Locks apply to painting; undo restores the exact previous edit.</p>
    </Section>
    {session.error ? <p role="alert" className="p-3 text-bf-warning">{session.error}</p> : null}
  </div>;
}
