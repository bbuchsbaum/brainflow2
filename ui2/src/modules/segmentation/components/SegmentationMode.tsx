import React, { useCallback, useEffect, useState } from 'react';
import type { SegmentationRegistration } from '@brainflow/api';
import { Button, Checkbox, EmptyPane, Select, TextArea, TextField } from '@/components/ui/bf';
import {
  captureActiveWorkspace,
  useActiveWorkspaceId,
  retainDocument,
  useLoadedVolumeLayers,
  useLayerMetadata,
  useSelectedLayer,
} from '@/modules/api/host';
import { useWorkspaceRenderState, type ViewPlane } from '@/modules/api/rendering';
import {
  createSegmentationSession,
  ensureSegmentationSession,
  forgetSegmentationSession,
  reconcileSegmentationSession,
  setSegmentationPresentation,
  useSegmentationSession,
} from '@/modules/segmentation/session';
import { parseSegmentationLabels } from '@/modules/segmentation/labelTable';
import { LabelTableEditor } from './LabelTableEditor';
import { RegistrationPreview } from './RegistrationPreview';
import { SegmentViewport } from './SegmentViewport';
import { numericEntryHandlers } from './shared/numericEntry';
const initialLabels = JSON.stringify(
  [{ id: 1, name: 'Label 1', abbreviation: 'L1', color: [196, 105, 46], parent: null }],
  null,
  2,
);
export function SegmentationMode({ workspaceId }: { workspaceId: string }) {
  const selected = useSelectedLayer(),
    allLoaded = useLoadedVolumeLayers();
  // Only images this view holds can be previewed and traced here. The
  // selection is shared by every tab, so it may name an image another tab
  // loaded; then the view's visible image (else any it holds) is used.
  const viewLayers = useWorkspaceRenderState(workspaceId)?.layers;
  const attached = new Set((viewLayers ?? []).map((item) => item.volumeId));
  const loaded = allLoaded.filter((candidate) => attached.has(candidate.volumeId));
  const shownVolume = viewLayers?.find((item) => item.visible)?.volumeId;
  const layer =
    (selected && attached.has(selected.volumeId) ? selected : undefined) ??
    loaded.find((candidate) => candidate.volumeId === shownVolume) ??
    loaded[0] ??
    null;
  const live = useSegmentationSession(workspaceId);
  const activeWorkspaceId = useActiveWorkspaceId();
  const [subject, setSubject] = useState(''),
    [session, setSession] = useState(''),
    [hemisphere, setHemisphere] = useState('left'),
    [rater, setRater] = useState('');
  const [blind, setBlind] = useState(true),
    [normalAxis, setNormalAxis] = useState(1),
    [reason, setReason] = useState('No secondary contrast registered.'),
    [labels, setLabels] = useState(initialLabels),
    [error, setError] = useState<string | null>(null);
  const [secondaryId, setSecondaryId] = useState(''),
    [aligned, setAligned] = useState(false),
    [reviewPlane, setReviewPlane] = useState<ViewPlane | null>(null),
    [reviewSlice, setReviewSlice] = useState(0);
  const referenceMetadata = useLayerMetadata(layer?.id ?? ''),
    secondaryMetadata = useLayerMetadata(
      loaded.find((candidate) => candidate.volumeId === secondaryId)?.id ?? '',
    );
  const reviewed = useCallback((plane: ViewPlane | null, sliceIndex?: number) => {
    setReviewPlane(plane);
    if (plane && sliceIndex != null) setReviewSlice(sliceIndex);
    setAligned(false);
  }, []);
  // A 4D image is traced on one explicit frame. Frames are typed and shown 1-based,
  // like the status-bar time slider; `frame` is the stored 0-based index.
  const [frameChoice, setFrameChoice] = useState<Record<string, string>>({});
  const frameInfo = (volumeId: string) => {
    const candidate = loaded.find((item) => item.volumeId === volumeId);
    const count =
      candidate?.volumeType === 'TimeSeries4D'
        ? (candidate.timeSeriesInfo?.num_timepoints ?? 0)
        : 0;
    if (count <= 0) return null;
    const raw =
      frameChoice[volumeId] ?? String(Math.min(count - 1, candidate?.currentTimepoint ?? 0) + 1);
    const n = raw.trim() === '' ? NaN : Number(raw);
    return { count, raw, frame: Number.isInteger(n) && n >= 1 && n <= count ? n - 1 : null };
  };
  const referenceFrames = layer ? frameInfo(layer.volumeId) : null,
    secondaryFrames = secondaryId ? frameInfo(secondaryId) : null;
  const chooseFrame = (volumeId: string, value: string) => {
    setFrameChoice((old) => ({ ...old, [volumeId]: value }));
    setAligned(false);
  };
  const previewFrame = referenceFrames?.frame ?? secondaryFrames?.frame ?? null;
  const previewFrameCount =
    referenceFrames?.frame != null ? referenceFrames.count : (secondaryFrames?.count ?? null);
  const previewMismatch =
    referenceFrames && secondaryFrames && referenceFrames.frame !== secondaryFrames.frame;
  useEffect(() => {
    if (activeWorkspaceId === workspaceId) void reconcileSegmentationSession(workspaceId);
  }, [workspaceId, activeWorkspaceId]);
  if (live?.info) return <SegmentViewport workspaceId={workspaceId} />;
  if (!layer)
    return (
      <EmptyPane
        title="Select a reference image"
        hint="Segment mode needs a loaded reference volume."
      />
    );
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    try {
      const lease = captureActiveWorkspace();
      if (!lease || lease.workspaceId !== workspaceId)
        throw new Error('This view is no longer active.');
      const table = parseSegmentationLabels(labels);
      if (!subject.trim() || !session.trim() || !rater.trim())
        throw new Error('Subject, session and rater are required.');
      if (!reviewPlane)
        throw new Error('Wait for the reference preview before creating the session.');
      for (const [role, frames] of [
        ['reference', referenceFrames],
        ['secondary', secondaryFrames],
      ] as const) {
        if (frames && frames.frame === null)
          throw new Error(`Enter a ${role} frame from 1 to ${frames.count}.`);
      }
      let registration: SegmentationRegistration;
      if (secondaryId) {
        if (!aligned)
          throw new Error('Review both contrasts, then explicitly confirm their alignment.');
        const matrices = [referenceMetadata?.voxelToWorld, secondaryMetadata?.voxelToWorld];
        if (matrices.some((matrix) => !matrix || matrix.length !== 16))
          throw new Error(
            'Both images need loaded affine metadata before alignment can be recorded.',
          );
        const digest = await crypto.subtle.digest(
          'SHA-256',
          new TextEncoder().encode(
            JSON.stringify({
              reference: layer.volumeId,
              secondary: secondaryId,
              matrices,
              referenceFrame: referenceFrames?.frame ?? null,
              secondaryFrame: secondaryFrames?.frame ?? null,
            }),
          ),
        );
        if (!lease.isCurrent()) return;
        registration = {
          status: 'aligned',
          confirmer: rater.trim(),
          confirmedAtMs: Date.now(),
          transformHash: Array.from(new Uint8Array(digest), (byte) =>
            byte.toString(16).padStart(2, '0'),
          ).join(''),
          view: [
            ...reviewPlane.origin_mm,
            ...reviewPlane.u_mm,
            ...reviewPlane.v_mm,
            ...reviewPlane.dim_px,
            normalAxis,
          ],
        };
      } else {
        if (!reason.trim()) throw new Error('State why no secondary contrast is registered.');
        registration = { status: 'withoutSecondary', reason: reason.trim() };
      }
      const document = retainDocument(workspaceId, {
        moduleId: 'segmentation',
        label: `Segmentation on ${layer.name}`,
        protectedVolumeIds: [layer.volumeId, ...(secondaryId ? [secondaryId] : [])],
        freezeEditing: () => setSegmentationPresentation(workspaceId, { tool: 'navigate' }),
        onDiscarded: () => forgetSegmentationSession(document),
      });
      const record = ensureSegmentationSession(lease, document);
      // Open on the native slice the rater just reviewed (adopt clamps it to the grid).
      setSegmentationPresentation(workspaceId, { sliceIndex: reviewSlice });
      await createSegmentationSession(record, {
        referenceVolumeId: layer.volumeId,
        identity: {
          subject: subject.trim(),
          session: session.trim(),
          hemisphere,
          rater: rater.trim(),
          blind,
        },
        normalAxis,
        labels: table,
        secondaryVolumeId: secondaryId || null,
        registration,
        referenceFrame: referenceFrames?.frame ?? null,
        secondaryFrame: secondaryFrames?.frame ?? null,
      });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    }
  };
  return (
    <div className="grid h-full min-h-0 grid-cols-[minmax(300px,420px)_minmax(240px,1fr)] gap-4 overflow-auto bg-bf-bg-panel p-4">
      <form
        className="flex flex-col gap-3 text-bf-xs"
        onSubmit={submit}
        aria-label="Create segmentation session"
      >
        <div>
          <h2 className="text-bf-lg font-medium">New segmentation</h2>
          <p className="mt-1 text-bf-text-muted">
            Reference grid: {layer.name}. Label data stays on this grid.
          </p>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <label>
            Subject
            <TextField required value={subject} onChange={(e) => setSubject(e.target.value)} />
          </label>
          <label>
            Session
            <TextField required value={session} onChange={(e) => setSession(e.target.value)} />
          </label>
          <label>
            Hemisphere
            <Select
              value={hemisphere}
              onValueChange={setHemisphere}
              options={[
                { value: 'left', label: 'Left' },
                { value: 'right', label: 'Right' },
                { value: 'bilateral', label: 'Bilateral' },
              ]}
            />
          </label>
          <label>
            Rater
            <TextField required value={rater} onChange={(e) => setRater(e.target.value)} />
          </label>
        </div>
        <Checkbox checked={blind} onCheckedChange={setBlind}>
          Blind rater
        </Checkbox>
        <label>
          Native normal axis
          <Select
            value={normalAxis}
            onValueChange={(value) => setNormalAxis(Number(value))}
            options={[
              { value: '0', label: 'i (voxel axis 0)' },
              { value: '1', label: 'j (voxel axis 1)' },
              { value: '2', label: 'k (voxel axis 2)' },
            ]}
          />
        </label>
        {referenceFrames ? (
          <label>
            Reference frame (1–{referenceFrames.count})
            <TextField
              type="number"
              mono
              required
              min={1}
              max={referenceFrames.count}
              step={1}
              {...numericEntryHandlers}
              value={referenceFrames.raw}
              invalid={referenceFrames.frame === null}
              onChange={(e) => chooseFrame(layer.volumeId, e.target.value)}
            />
          </label>
        ) : null}
        <label>
          Secondary contrast
          <Select
            value={secondaryId}
            onValueChange={(value) => {
              setSecondaryId(value);
              setAligned(false);
            }}
            options={[
              { value: '', label: 'Continue without a secondary contrast' },
              ...loaded
                .filter(
                  (candidate) =>
                    candidate.volumeId !== layer.volumeId && candidate.type !== 'label',
                )
                .map((candidate) => ({ value: candidate.volumeId, label: candidate.name })),
            ]}
          />
        </label>
        {secondaryFrames ? (
          <label>
            Secondary frame (1–{secondaryFrames.count})
            <TextField
              type="number"
              mono
              required
              min={1}
              max={secondaryFrames.count}
              step={1}
              {...numericEntryHandlers}
              value={secondaryFrames.raw}
              invalid={secondaryFrames.frame === null}
              onChange={(e) => chooseFrame(secondaryId, e.target.value)}
            />
          </label>
        ) : null}
        {referenceFrames || secondaryFrames ? (
          <p className="text-bf-2xs text-bf-text-muted">
            A 4D image is traced on the chosen frame only. The session keeps a copy of that frame
            and records it in the saved label header.
            {previewMismatch
              ? ` The preview shows frame ${previewFrame != null ? previewFrame + 1 : ''} of both images.`
              : ''}
          </p>
        ) : null}
        {secondaryId ? (
          <Checkbox checked={aligned} disabled={!reviewPlane} onCheckedChange={setAligned}>
            I reviewed the overlaid contrasts and confirm they align.
          </Checkbox>
        ) : (
          <label>
            Continue without secondary because
            <TextArea
              required
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={2}
            />
          </label>
        )}
        <LabelTableEditor value={labels} onChange={setLabels} />
        <p className="text-bf-2xs text-bf-text-muted">
          Free tracing uses your label table. Sessions are held in memory; closing or quitting asks
          before discarding.
        </p>
        {error || live?.error ? (
          <p role="alert" className="text-bf-warning">
            {error ?? live?.error}
          </p>
        ) : null}
        {live && !live.info ? (
          <Button
            type="button"
            disabled={live.busy}
            onClick={() => void reconcileSegmentationSession(workspaceId)}
          >
            Resume retained session
          </Button>
        ) : null}
        <Button type="submit" disabled={live?.busy || !reviewPlane}>
          {live?.busy ? 'Creating…' : 'Create segmentation'}
        </Button>
      </form>
      <RegistrationPreview
        workspaceId={workspaceId}
        referenceId={layer.volumeId}
        secondaryId={secondaryId || null}
        normalAxis={normalAxis}
        timepoint={previewFrame}
        timepointCount={previewFrameCount}
        onView={reviewed}
      />
    </div>
  );
}
