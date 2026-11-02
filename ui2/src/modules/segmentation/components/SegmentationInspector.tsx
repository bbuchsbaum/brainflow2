import React from 'react';
import { Button, EmptyPane, Section } from '@/components/ui/bf';
import { useActiveWorkspaceId } from '@/modules/api/host';
import { LabelList } from './shared/LabelList';
import { SliceProgress } from './shared/SliceProgress';
import { setSegmentationLabelState, setSegmentationPresentation, travelSegmentationHistory, useSegmentationSession } from '@/modules/segmentation/session';

export function SegmentationInspector() {
  const workspaceId = useActiveWorkspaceId();
  const session = useSegmentationSession(workspaceId ?? '');
  if (!workspaceId || !session?.info) return <EmptyPane title="Segment" hint="Create a segmentation session in Segment mode." />;
  const snapshot = session.info.snapshot;
  const labels = snapshot.labels.map((label) => ({ id: label.definition.id, name: label.definition.name, long: label.definition.name, color: `rgb(${label.definition.color.join(' ')})`, voxels: label.voxels, mm3: label.mm3, locked: label.locked, visible: !session.hiddenLabelIds.includes(label.definition.id), status: label.complete ? 'complete' as const : label.voxels > 0 ? 'in-progress' as const : 'not-started' as const }));
  const active = snapshot.labels.find((row) => row.definition.id === session.activeLabelId);
  return <div className="h-full overflow-auto text-bf-xs" data-session-id={snapshot.sessionId}>
    <Section title="Session"><p className="text-bf-text-secondary">{snapshot.identity.subject} · {snapshot.identity.hemisphere}</p><p className="font-mono text-bf-2xs text-bf-text-muted">{snapshot.identity.rater} · revision {snapshot.revision} · unsaved</p>
      <p className="mt-2 text-bf-2xs text-bf-text-muted">Free tracing. No anatomical protocol is attached.</p>
    </Section>
    <Section title="Labels"><LabelList labels={labels} activeId={session.activeLabelId} onSelect={(id) => setSegmentationPresentation(workspaceId, { activeLabelId: id })} onToggleVisibility={(id) => setSegmentationPresentation(workspaceId, { hiddenLabelIds: session.hiddenLabelIds.includes(id) ? session.hiddenLabelIds.filter((x) => x !== id) : [...session.hiddenLabelIds, id] })} onToggleLock={(id) => { const label = snapshot.labels.find((x) => x.definition.id === id); if (label) void setSegmentationLabelState(workspaceId, id, !label.locked, label.complete); }} />
      {active ? <Button size="sm" className="mt-2" disabled={session.busy} onClick={() => void setSegmentationLabelState(workspaceId, active.definition.id, !active.complete, !active.complete)}>{active.complete ? `Reopen ${active.definition.name}` : `Mark ${active.definition.name} complete`}</Button> : null}
      <SliceProgress snapshot={snapshot} activeId={session.activeLabelId} current={session.sliceIndex} onPick={(sliceIndex) => { if (!session.busy) setSegmentationPresentation(workspaceId, { sliceIndex }); }} />
    </Section>
    <Section title="History"><div className="flex flex-col items-start gap-2"><Button size="sm" disabled={!snapshot.undo || session.busy} onClick={() => void travelSegmentationHistory(workspaceId)}>Undo{snapshot.undo ? ` ${snapshot.undo}` : ''}</Button><Button size="sm" disabled={!snapshot.redo || session.busy} onClick={() => void travelSegmentationHistory(workspaceId, true)}>Redo{snapshot.redo ? ` ${snapshot.redo}` : ''}</Button></div>
      <p className="mt-2 text-bf-2xs text-bf-text-muted">Each stroke is one history step. Locks apply to painting; undo restores the exact previous edit.</p>
    </Section>
    {session.error ? <p role="alert" className="p-3 text-bf-warning">{session.error}</p> : null}
  </div>;
}
