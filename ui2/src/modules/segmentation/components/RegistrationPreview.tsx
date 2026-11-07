import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Slider } from '@/components/ui/bf';
import {
  SliceViewport,
  captureActiveWorkspace,
  formatModuleError,
  getLoadedNativePlane,
  getLoadedVolumeInfo,
  useActiveWorkspaceId,
} from '@/modules/api/host';
import {
  ensureModuleVolumeResident,
  renderModulePlane,
  type RenderContext,
  type ViewPlane,
} from '@/modules/api/rendering';
/** How long the reference may take to show before the preview says so. */
export const REGISTRATION_PREVIEW_TIMEOUT_MS = 15_000;
/** Fresh requests after a view change dropped one while this tab stayed in front. */
const REGISTRATION_PREVIEW_RETRIES = 3;
/** `timepoint` is the 0-based frame shown for 4D images (one frame per render; see
 * SegmentationMode); it is displayed 1-based like the time slider. `onView` also
 * reports the previewed native slice so the session can open on it. */
export function RegistrationPreview({
  workspaceId,
  referenceId,
  secondaryId,
  normalAxis,
  timepoint = null,
  timepointCount = null,
  onView,
}: {
  workspaceId: string;
  referenceId: string;
  secondaryId: string | null;
  normalAxis: number;
  timepoint?: number | null;
  timepointCount?: number | null;
  onView(plane: ViewPlane | null, sliceIndex?: number): void;
}) {
  const isFront = useActiveWorkspaceId() === workspaceId;
  const target = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState<[number, number]>([480, 360]);
  const [count, setCount] = useState(1),
    [index, setIndex] = useState(0),
    [blend, setBlend] = useState(0.5);
  const [plane, setPlane] = useState<ViewPlane | null>(null),
    [error, setError] = useState<string | null>(null);
  // A navigation change (entering Segment mode, say) makes a request's lease
  // stale and drops it without a word while this tab stays in front, and no
  // dependency changes: without asking again the preview would wait forever.
  const [attempt, setAttempt] = useState(0);
  const drops = useRef(0);
  const context = useMemo<RenderContext>(
    () => ({
      id: `segmentation-setup-${workspaceId}`,
      type: 'slice',
      dimensions: { width: size[0], height: size[1] },
      metadata: { workspaceId },
      viewPlane: plane ?? undefined,
    }),
    [workspaceId, size, plane],
  );
  useEffect(() => {
    if (!target.current) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) {
        const next: [number, number] = [
          Math.max(1, Math.round(entry.contentRect.width)),
          Math.max(1, Math.round(entry.contentRect.height)),
        ];
        setSize((old) => (old[0] === next[0] && old[1] === next[1] ? old : next));
      }
    });
    observer.observe(target.current);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    let disposed = false;
    const lease = captureActiveWorkspace();
    const current = () => !disposed && lease?.workspaceId === workspaceId && lease.isCurrent();
    setPlane(null);
    onView(null);
    if (!isFront) return;
    void getLoadedVolumeInfo(referenceId)
      .then((info) => {
        if (current()) {
          setCount(info.dims[normalAxis]);
          setIndex(Math.floor((info.dims[normalAxis] - 1) / 2));
        }
      })
      .catch((failure) => {
        if (current()) setError(formatModuleError(failure));
      });
    return () => {
      disposed = true;
    };
  }, [workspaceId, referenceId, normalAxis, onView, isFront, attempt]);
  useEffect(() => {
    let disposed = false;
    const lease = captureActiveWorkspace();
    const current = () => !disposed && lease?.workspaceId === workspaceId && lease.isCurrent();
    setPlane(null);
    onView(null);
    setError(null);
    if (!isFront) return;
    let settled = false;
    // Never wait without saying so: a request that neither shows nor fails in
    // time is reported (a backend call that does not return, for example).
    const timer = setTimeout(() => {
      if (!disposed && !settled)
        setError(
          'The reference image has not loaded. Switch tabs and back, or reopen the setup, to try again.',
        );
    }, REGISTRATION_PREVIEW_TIMEOUT_MS);
    void (async () => {
      const native = await getLoadedNativePlane(
        referenceId,
        normalAxis,
        Math.min(count - 1, index),
        size,
      );
      const plane = { ...native, dim_px: [native.width_px, native.height_px] as [number, number] };
      await ensureModuleVolumeResident(workspaceId, referenceId, current);
      if (secondaryId) await ensureModuleVolumeResident(workspaceId, secondaryId, current);
      await renderModulePlane({
        workspaceId,
        context,
        plane,
        volumeIds: secondaryId ? [referenceId, secondaryId] : [referenceId],
        opacity: secondaryId ? { [referenceId]: 1, [secondaryId]: blend } : { [referenceId]: 1 },
        ...(timepoint != null ? { timepoint } : {}),
        isCurrent: current,
      });
      if (current()) {
        settled = true;
        drops.current = 0;
        setPlane(plane);
        onView(plane, Math.min(count - 1, index));
      }
    })()
      .catch((failure) => {
        if (current()) {
          settled = true;
          setError(formatModuleError(failure));
        }
      })
      .finally(() => {
        // Dropped by a view change while still mounted and in front: ask
        // again with a fresh lease. A tab change re-runs this through `isFront`.
        if (!disposed && !settled && drops.current < REGISTRATION_PREVIEW_RETRIES) {
          drops.current += 1;
          setAttempt((value) => value + 1);
        }
      });
    return () => {
      disposed = true;
      clearTimeout(timer);
    };
    // Context identity/dimensions stay fixed for this request; publishing its plane must not refetch it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    workspaceId,
    referenceId,
    secondaryId,
    normalAxis,
    index,
    count,
    size,
    blend,
    onView,
    isFront,
    timepoint,
    attempt,
  ]);
  return (
    <div className="flex h-full min-h-[280px] flex-col border border-bf-border-subtle bg-bf-bg-canvas">
      <header className="px-3 py-2 text-bf-xs text-bf-text-secondary">
        Reference native slice {index + 1} / {count}
        {timepoint != null
          ? ` · frame ${timepoint + 1}${timepointCount ? ` of ${timepointCount}` : ''}`
          : ''}{' '}
        · registration check
      </header>
      <div ref={target} className="relative min-h-0 flex-1">
        {plane ? (
          <SliceViewport width={size[0]} height={size[1]} context={context} viewPlane={plane} />
        ) : error ? (
          // In place of the image, where a dock below cannot cover it.
          <p role="alert" className="p-3 text-bf-xs text-bf-warning">
            {error}
          </p>
        ) : (
          <span role="status" className="p-3 text-bf-xs">
            Preparing the loaded reference…
          </span>
        )}
        {plane && error ? (
          <p
            role="alert"
            className="absolute inset-x-2 bottom-2 bg-bf-bg-panel p-2 text-bf-xs text-bf-warning"
          >
            {error}
          </p>
        ) : null}
      </div>
      <div className="flex flex-col gap-2 p-3">
        <Slider
          label="Native slice"
          min={0}
          max={Math.max(1, count - 1)}
          step={1}
          value={index}
          onValueChange={setIndex}
        />
        {secondaryId ? (
          <Slider
            label="Secondary opacity"
            min={0}
            max={1}
            step={0.05}
            value={blend}
            onValueChange={setBlend}
          />
        ) : null}
      </div>
    </div>
  );
}
