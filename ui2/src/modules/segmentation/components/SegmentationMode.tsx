import React, { useCallback, useEffect, useState } from 'react';
import type { SegmentationRegistration } from '@brainflow/api';
import { Button, Checkbox, EmptyPane, Select, TextArea, TextField } from '@/components/ui/bf';
import { captureActiveWorkspace, useActiveWorkspaceId, retainDocument, useLoadedVolumeLayers, useLayerMetadata, useSelectedLayer } from '@/modules/api/host';
import type { ViewPlane } from '@/modules/api/rendering';
import { createSegmentationSession, ensureSegmentationSession, forgetSegmentationSession, reconcileSegmentationSession, setSegmentationPresentation, useSegmentationSession } from '@/modules/segmentation/session';
import { parseSegmentationLabels } from '@/modules/segmentation/labelTable';
import { LabelTableEditor } from './LabelTableEditor';
import { RegistrationPreview } from './RegistrationPreview';
import { SegmentViewport } from './SegmentViewport';
const initialLabels = JSON.stringify([{ id: 1, name: 'Label 1', abbreviation: 'L1', color: [196, 105, 46], parent: null }], null, 2);
export function SegmentationMode({ workspaceId }: { workspaceId: string }) {
  const layer = useSelectedLayer(), loaded = useLoadedVolumeLayers();
  const live = useSegmentationSession(workspaceId);
  const activeWorkspaceId = useActiveWorkspaceId();
  const [subject, setSubject] = useState(''), [session, setSession] = useState(''), [hemisphere, setHemisphere] = useState('left'), [rater, setRater] = useState('');
  const [blind, setBlind] = useState(true), [normalAxis, setNormalAxis] = useState(1), [reason, setReason] = useState('No secondary contrast registered.'), [labels, setLabels] = useState(initialLabels), [error, setError] = useState<string | null>(null);
  const [secondaryId, setSecondaryId] = useState(''), [aligned, setAligned] = useState(false), [reviewPlane, setReviewPlane] = useState<ViewPlane | null>(null);
  const referenceMetadata = useLayerMetadata(layer?.id ?? ''), secondaryMetadata = useLayerMetadata(loaded.find((candidate) => candidate.volumeId === secondaryId)?.id ?? '');
  const reviewed = useCallback((plane: ViewPlane | null) => { setReviewPlane(plane); setAligned(false); }, []);
  useEffect(() => { if (activeWorkspaceId === workspaceId) void reconcileSegmentationSession(workspaceId); }, [workspaceId, activeWorkspaceId]);
  if (live?.info) return <SegmentViewport workspaceId={workspaceId} />;
  if (!layer) return <EmptyPane title="Select a reference image" hint="Segment mode needs a loaded reference volume." />;
  const submit = async (event: React.FormEvent) => {
    event.preventDefault(); setError(null);
    try {
      const lease = captureActiveWorkspace();
      if (!lease || lease.workspaceId !== workspaceId) throw new Error('This view is no longer active.');
      const table = parseSegmentationLabels(labels);
      if (!subject.trim() || !session.trim() || !rater.trim()) throw new Error('Subject, session and rater are required.');
      if (!reviewPlane) throw new Error('Wait for the reference preview before creating the session.');
      let registration: SegmentationRegistration;
      if (secondaryId) {
        if (!aligned) throw new Error('Review both contrasts, then explicitly confirm their alignment.');
        const matrices = [referenceMetadata?.voxelToWorld, secondaryMetadata?.voxelToWorld];
        if (matrices.some((matrix) => !matrix || matrix.length !== 16)) throw new Error('Both images need loaded affine metadata before alignment can be recorded.');
        const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify({ reference: layer.volumeId, secondary: secondaryId, matrices })));
        if (!lease.isCurrent()) return;
        registration = { status: 'aligned', confirmer: rater.trim(), confirmedAtMs: Date.now(), transformHash: Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join(''), view: [...reviewPlane.origin_mm, ...reviewPlane.u_mm, ...reviewPlane.v_mm, ...reviewPlane.dim_px, normalAxis] };
      } else { if (!reason.trim()) throw new Error('State why no secondary contrast is registered.'); registration = { status: 'withoutSecondary', reason: reason.trim() }; }
      const document = retainDocument(workspaceId, { moduleId: 'segmentation', label: `Segmentation on ${layer.name}`, protectedVolumeIds: [layer.volumeId, ...(secondaryId ? [secondaryId] : [])], freezeEditing: () => setSegmentationPresentation(workspaceId, { tool: 'navigate' }), onDiscarded: () => forgetSegmentationSession(document) });
      const record = ensureSegmentationSession(lease, document);
      await createSegmentationSession(record, { referenceVolumeId: layer.volumeId, identity: { subject: subject.trim(), session: session.trim(), hemisphere, rater: rater.trim(), blind }, normalAxis, labels: table, secondaryVolumeId: secondaryId || null, registration });
    } catch (caught) { setError(caught instanceof Error ? caught.message : String(caught)); }
  };
  return <div className="grid h-full min-h-0 grid-cols-[minmax(300px,420px)_minmax(240px,1fr)] gap-4 overflow-auto bg-bf-bg-panel p-4">
    <form className="flex flex-col gap-3 text-bf-xs" onSubmit={submit} aria-label="Create segmentation session">
      <div><h2 className="text-bf-lg font-medium">New segmentation</h2><p className="mt-1 text-bf-text-muted">Reference grid: {layer.name}. Label data stays on this grid.</p></div>
      <div className="grid grid-cols-2 gap-2">
        <label>Subject<TextField required value={subject} onChange={(e) => setSubject(e.target.value)} /></label><label>Session<TextField required value={session} onChange={(e) => setSession(e.target.value)} /></label>
        <label>Hemisphere<Select value={hemisphere} onValueChange={setHemisphere} options={[{ value: 'left', label: 'Left' }, { value: 'right', label: 'Right' }, { value: 'bilateral', label: 'Bilateral' }]} /></label><label>Rater<TextField required value={rater} onChange={(e) => setRater(e.target.value)} /></label>
      </div>
      <Checkbox checked={blind} onCheckedChange={setBlind}>Blind rater</Checkbox>
      <label>Native normal axis<Select value={normalAxis} onValueChange={(value) => setNormalAxis(Number(value))} options={[{ value: '0', label: 'i (voxel axis 0)' }, { value: '1', label: 'j (voxel axis 1)' }, { value: '2', label: 'k (voxel axis 2)' }]} /></label>
      <label>Secondary contrast<Select value={secondaryId} onValueChange={(value) => { setSecondaryId(value); setAligned(false); }} options={[{ value: '', label: 'Continue without a secondary contrast' }, ...loaded.filter((candidate) => candidate.volumeId !== layer.volumeId && candidate.type !== 'label').map((candidate) => ({ value: candidate.volumeId, label: candidate.name }))]} /></label>
      {secondaryId ? <Checkbox checked={aligned} disabled={!reviewPlane} onCheckedChange={setAligned}>I reviewed the overlaid contrasts and confirm they align.</Checkbox> : <label>Continue without secondary because<TextArea required value={reason} onChange={(e) => setReason(e.target.value)} rows={2} /></label>}
      <LabelTableEditor value={labels} onChange={setLabels} />
      <p className="text-bf-2xs text-bf-text-muted">Free tracing uses your label table. Sessions are held in memory; closing or quitting asks before discarding.</p>
      {error || live?.error ? <p role="alert" className="text-bf-warning">{error ?? live?.error}</p> : null}
      {live && !live.info ? <Button type="button" disabled={live.busy} onClick={() => void reconcileSegmentationSession(workspaceId)}>Resume retained session</Button> : null}
      <Button type="submit" disabled={live?.busy || !reviewPlane}>{live?.busy ? 'Creating…' : 'Create segmentation'}</Button>
    </form>
    <RegistrationPreview workspaceId={workspaceId} referenceId={layer.volumeId} secondaryId={secondaryId || null} normalAxis={normalAxis} onView={reviewed} />
  </div>;
}
