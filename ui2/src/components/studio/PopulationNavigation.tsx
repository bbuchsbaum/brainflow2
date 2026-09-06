import { useEffect, useState } from 'react';

const control = 'rounded border border-border bg-background px-2 py-1 text-xs disabled:opacity-40';

/** Discrete observations, never interpolated frames. Each completed display
 * receives its full dwell time; a cache miss slows playback rather than skipping. */
export function PopulationNavigation({
  ids,
  focusedId,
  ready,
  failed,
  scope,
  onFocus,
  label,
}: {
  ids: readonly string[];
  focusedId: string | null;
  ready: boolean;
  failed: boolean;
  scope: string;
  onFocus: (id: string) => void;
  label: string;
}) {
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(5);
  const [direction, setDirection] = useState(1);
  const index = ids.indexOf(focusedId ?? '');
  useEffect(() => setPlaying(false), [scope, ids]);
  useEffect(() => {
    if (failed) setPlaying(false);
  }, [failed]);
  useEffect(() => {
    if (!playing || !ready) return;
    const next = index + direction;
    if (next < 0 || next >= ids.length) {
      setPlaying(false);
      return;
    }
    const timer = setTimeout(() => onFocus(ids[next]), 1000 / speed);
    return () => clearTimeout(timer);
  }, [playing, ready, index, ids, speed, direction, onFocus]);
  const move = (next: number) => {
    setPlaying(false);
    if (ids[next]) onFocus(ids[next]);
  };
  return (
    <div
      aria-label="Population navigation"
      tabIndex={0}
      className="rounded border border-border bg-muted/20 p-2 space-y-2"
      onKeyDown={(event) => {
        if (event.target !== event.currentTarget) return;
        if (event.key === ' ') {
          event.preventDefault();
          setPlaying((value) => !value);
        }
        if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
          event.preventDefault();
          move(index + (event.key === 'ArrowLeft' ? -1 : 1));
        }
      }}
    >
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <button
          className={control}
          aria-label="Previous observation"
          disabled={index <= 0}
          onClick={() => move(index - 1)}
        >
          ←
        </button>
        <button
          className={control}
          disabled={!ids.length || failed}
          onClick={() => setPlaying((value) => !value)}
        >
          {playing ? 'Pause' : 'Play'}
        </button>
        <button
          className={control}
          aria-label="Next observation"
          disabled={index + 1 >= ids.length}
          onClick={() => move(index + 1)}
        >
          →
        </button>
        <span className="min-w-[130px] flex-1 tabular-nums">
          {focusedId ?? 'No focus'} · {index + 1} / {ids.length}
        </span>
        <select
          className={control}
          aria-label="Playback direction"
          value={direction}
          onChange={(e) => {
            setPlaying(false);
            setDirection(Number(e.target.value));
          }}
        >
          <option value={1}>Forward</option>
          <option value={-1}>Reverse</option>
        </select>
        <select
          className={control}
          aria-label="Playback speed"
          value={speed}
          onChange={(e) => setSpeed(Number(e.target.value))}
        >
          <option value={5}>5 observations/s</option>
          <option value={10}>10 observations/s</option>
        </select>
      </div>
      <input
        className="block w-full accent-primary"
        aria-label="Focus observation"
        type="range"
        min={0}
        max={Math.max(0, ids.length - 1)}
        value={Math.max(0, index)}
        disabled={!ids.length}
        onPointerDown={() => setPlaying(false)}
        onChange={(e) => move(Number(e.target.value))}
      />
      <p className="text-xs text-muted-foreground" title={label}>
        {label} · Show every observation{playing && !ready ? ' · Buffering…' : ''}
      </p>
    </div>
  );
}
