import { IconButton, Slider } from '@/components/ui/bf';
import { ChevronLeft, ChevronRight, Pause, Play } from 'lucide-react';
import { useEffect, useState } from 'react';
import { usePopulationViewStore } from '@/stores/populationViewStore';

/**
 * The footer's transport: step, play and the focused subject's place in the
 * order on screen. Discrete observations, never interpolated frames: each
 * completed display receives its full dwell time; a cache miss slows
 * playback rather than skipping. Playback follows the order on screen (Reverse
 * order reverses it); its speed is set in the ⋯ menu.
 */
export function PopulationNavigation({
  ids,
  focusedId,
  ready,
  failed,
  scope,
  onFocus,
  label,
  scrubber = true,
}: {
  ids: readonly string[];
  focusedId: string | null;
  ready: boolean;
  failed: boolean;
  scope: string;
  onFocus: (id: string) => void;
  /** The order playing, for the tooltip and the screen reader. */
  label: string;
  /** A scrubber across the order (Summary; the grid is its own scrubber). */
  scrubber?: boolean;
}) {
  const [playing, setPlaying] = useState(false);
  const speed = usePopulationViewStore((state) => state.playbackSpeed);
  const index = ids.indexOf(focusedId ?? '');
  useEffect(() => setPlaying(false), [scope, ids]);
  useEffect(() => {
    if (failed) setPlaying(false);
  }, [failed]);
  useEffect(() => {
    if (!playing || !ready) return;
    const next = index + 1;
    if (next >= ids.length) {
      setPlaying(false);
      return;
    }
    const timer = setTimeout(() => onFocus(ids[next]), 1000 / speed);
    return () => clearTimeout(timer);
  }, [playing, ready, index, ids, speed, onFocus]);
  const move = (next: number) => {
    setPlaying(false);
    if (ids[next]) onFocus(ids[next]);
  };
  return (
    <div
      role="group"
      aria-label="Population navigation"
      title={label}
      tabIndex={0}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setPlaying(false);
      }}
      className="flex min-w-0 shrink-0 items-center gap-1 text-bf-sm outline-none"
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
      <IconButton
        icon={<ChevronLeft />}
        aria-label="Previous subject in order"
        disabled={index <= 0}
        onClick={() => move(index - 1)}
      />
      <IconButton
        icon={playing ? <Pause /> : <Play />}
        aria-label={playing ? 'Pause' : 'Play'}
        title={`${playing ? 'Pause' : 'Play'} · ${label}`}
        disabled={!ids.length || failed}
        onClick={() => setPlaying((value) => !value)}
      />
      <IconButton
        icon={<ChevronRight />}
        aria-label="Next subject in order"
        disabled={index + 1 >= ids.length}
        onClick={() => move(index + 1)}
      />
      {/* The place in the order only: the focused subject is named on its
          tile, the strip and the Inspector; here it is the tooltip. */}
      <span
        className="whitespace-nowrap font-mono tabular-nums text-bf-text-secondary"
        data-testid="population-transport-position"
        title={focusedId ?? 'No focus'}
      >
        <span className="sr-only">{focusedId ?? 'No focus'}, </span>
        {index < 0 ? '–' : index + 1} / {ids.length}
        {playing && !ready ? ' · Buffering…' : ''}
      </span>
      {scrubber && (
        <Slider
          className="w-32 min-w-[96px] shrink"
          label="Focus observation"
          min={0}
          max={Math.max(0, ids.length - 1)}
          step={1}
          snap={1}
          fill={false}
          value={Math.max(0, index)}
          disabled={!ids.length}
          valueText={(v) => `Observation ${Math.round(v) + 1} of ${ids.length}`}
          onDragChange={(dragging) => {
            if (dragging) setPlaying(false);
          }}
          onValueChange={(v) => {
            const next = Math.round(v);
            if (next !== index) move(next);
          }}
        />
      )}
    </div>
  );
}
