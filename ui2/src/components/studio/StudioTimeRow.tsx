import React, { useEffect, useRef, useState } from 'react';
import type { StudioMemberSummary } from '@/types/studio';

interface StudioTimeRowProps {
  activeMember: StudioMemberSummary | null;
  /** Total frame count of pane A's source. `null` when 3D / unknown. */
  frameCount: number | null;
  /** TR in seconds for pane A. `null` if unknown. */
  trSeconds: number | null;
  /** Currently displayed frame index for pane A. */
  frame: number;
  /** Setter; only invoked when 4D and not disabled. */
  onFrameChange: (frame: number) => void;
}

/**
 * 4D scrubber for the Compare lens. Explicitly scoped to Pane A only — the
 * derived panes (cohort mean / residual / z-score) are NOT bound to this scrubber
 * because their semantics under per-frame derivation are not yet defined.
 */
export function StudioTimeRow({
  activeMember,
  frameCount,
  trSeconds,
  frame,
  onFrameChange,
}: StudioTimeRowProps) {
  const total = frameCount ?? 0;
  const isFourD = total > 1;
  const safeFrame = isFourD ? Math.max(0, Math.min(frame, total - 1)) : 0;
  const [playing, setPlaying] = useState(false);
  const rafRef = useRef<number | null>(null);
  const lastTickRef = useRef<number>(0);

  useEffect(() => {
    if (!playing || !isFourD) {
      if (rafRef.current != null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
      return;
    }
    const tickMs = trSeconds && trSeconds > 0 ? trSeconds * 1000 : 100;
    const step = (now: number) => {
      if (now - lastTickRef.current >= tickMs) {
        lastTickRef.current = now;
        const next = (safeFrame + 1) % total;
        onFrameChange(next);
      }
      rafRef.current = requestAnimationFrame(step);
    };
    rafRef.current = requestAnimationFrame(step);
    return () => {
      if (rafRef.current != null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
  }, [playing, isFourD, safeFrame, total, trSeconds, onFrameChange]);

  useEffect(() => {
    if (!isFourD && playing) setPlaying(false);
  }, [isFourD, playing]);

  const disabledReason = !activeMember
    ? 'No active member'
    : !isFourD
      ? 'Active member is 3D'
      : null;

  return (
    <section
      aria-label="Pane A time scrubber"
      title={disabledReason ?? undefined}
      className={`flex items-center gap-3 rounded-lg border border-border bg-card px-3 py-2 ${
        disabledReason ? 'opacity-60' : ''
      }`}
    >
      <div className="flex flex-col">
        <span className="text-[11px] font-medium uppercase tracking-[0.06em] text-muted-foreground">
          Time (4D)
        </span>
        <span className="text-[10px] text-muted-foreground/80">Applies to Pane A only</span>
      </div>

      <div className="flex shrink-0 items-center gap-1">
        <TransportButton
          title="First frame"
          onClick={() => onFrameChange(0)}
          disabled={!isFourD || safeFrame === 0}
        >
          <FirstIcon />
        </TransportButton>
        <TransportButton
          title="Step back"
          onClick={() => onFrameChange(Math.max(0, safeFrame - 1))}
          disabled={!isFourD || safeFrame === 0}
        >
          <PrevIcon />
        </TransportButton>
        <TransportButton
          title={playing ? 'Pause' : 'Play'}
          onClick={() => isFourD && setPlaying((p) => !p)}
          disabled={!isFourD}
        >
          {playing ? <PauseIcon /> : <PlayIcon />}
        </TransportButton>
        <TransportButton
          title="Step forward"
          onClick={() => onFrameChange(Math.min(total - 1, safeFrame + 1))}
          disabled={!isFourD || safeFrame >= total - 1}
        >
          <NextIcon />
        </TransportButton>
        <TransportButton
          title="Last frame"
          onClick={() => onFrameChange(total - 1)}
          disabled={!isFourD || safeFrame >= total - 1}
        >
          <LastIcon />
        </TransportButton>
      </div>

      <input
        type="range"
        min={0}
        max={Math.max(0, total - 1)}
        value={safeFrame}
        disabled={!isFourD}
        onChange={(event) => onFrameChange(Number.parseInt(event.target.value, 10) || 0)}
        aria-label="Frame index"
        className="h-1 flex-1 cursor-pointer appearance-none rounded-full bg-border accent-sky-500 disabled:cursor-not-allowed"
      />

      <div
        className="flex shrink-0 items-baseline gap-3 font-mono text-xs text-muted-foreground tabular-nums"
        style={{ fontVariantNumeric: 'tabular-nums' }}
      >
        <span className="text-foreground">{isFourD ? safeFrame : '—'}</span>
        <span>/</span>
        <span>{isFourD ? total - 1 : '—'}</span>
        {trSeconds && trSeconds > 0 ? (
          <span className="ml-2 text-[10px] uppercase tracking-[0.06em]">
            TR = {trSeconds.toFixed(1)} s
          </span>
        ) : null}
      </div>
    </section>
  );
}

function TransportButton({
  children,
  title,
  onClick,
  disabled,
}: {
  children: React.ReactNode;
  title: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      onClick={onClick}
      disabled={disabled}
      className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-border bg-background text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground disabled:cursor-not-allowed disabled:opacity-40 focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-500"
    >
      {children}
    </button>
  );
}

function FirstIcon() {
  return (
    <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="currentColor">
      <rect x="3" y="4" width="1.5" height="8" />
      <path d="M13 4L6 8l7 4z" />
    </svg>
  );
}
function LastIcon() {
  return (
    <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="currentColor">
      <rect x="11.5" y="4" width="1.5" height="8" />
      <path d="M3 4l7 4-7 4z" />
    </svg>
  );
}
function PrevIcon() {
  return (
    <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="currentColor">
      <path d="M11 4L4 8l7 4z" />
    </svg>
  );
}
function NextIcon() {
  return (
    <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="currentColor">
      <path d="M5 4l7 4-7 4z" />
    </svg>
  );
}
function PlayIcon() {
  return (
    <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="currentColor">
      <path d="M4 3l9 5-9 5z" />
    </svg>
  );
}
function PauseIcon() {
  return (
    <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="currentColor">
      <rect x="4" y="3" width="3" height="10" />
      <rect x="9" y="3" width="3" height="10" />
    </svg>
  );
}
