import { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { Button, IconButton, TextField } from '@/components/ui/bf';

export interface MontageSelectionBarProps {
  count: number;
  /** Save the selection as a named group. */
  onSaveGroup: (name: string) => void;
  /** The name offered when saving (it can be changed before Enter). */
  defaultGroupName?: string;
  /** Compare the selection with every other subject; absent when there is no one else. */
  onCompareRest?: () => void;
  onClear: () => void;
}

/**
 * An inline segment of the montage's toolbar row, there only while subjects
 * are selected: "8 selected · Save as group… · Compare with the rest · ✕".
 * Nothing floats over the tiles. "Save as group…" names the group in place
 * (Enter saves, Escape cancels). Clear here is a point-of-use copy of the
 * Inspector's selection commands; Open in Deck lives in the Inspector's
 * focused block.
 */
export function MontageSelectionBar({
  count,
  onSaveGroup,
  defaultGroupName,
  onCompareRest,
  onClear,
}: MontageSelectionBarProps) {
  const [naming, setNaming] = useState<string | null>(null);
  const field = useRef<HTMLInputElement>(null);
  const opener = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (naming !== null) field.current?.select();
  }, [naming !== null]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (count < 1) setNaming(null);
  }, [count]);
  if (count < 1) return null;
  const fallback = defaultGroupName ?? `${count} ${count === 1 ? 'subject' : 'subjects'}`;
  const close = () => {
    setNaming(null);
    requestAnimationFrame(() => opener.current?.focus());
  };
  return (
    <div
      role="group"
      aria-label="Selection"
      data-testid="montage-selection"
      data-montage-nodrag
      onKeyDown={(event) => {
        if (event.key !== 'Escape' || event.defaultPrevented) return;
        event.preventDefault();
        onClear();
      }}
      className="flex shrink-0 items-center gap-0.5 whitespace-nowrap text-bf-sm"
    >
      <span role="status" className="pr-1 font-medium tabular-nums text-foreground">
        {count} selected
      </span>
      <span aria-hidden className="text-bf-text-muted">
        ·
      </span>
      {naming === null ? (
        <Button ref={opener} variant="ghost" size="sm" onClick={() => setNaming(fallback)}>
          Save as group…
        </Button>
      ) : (
        <form
          className="flex items-center gap-1"
          onSubmit={(event) => {
            event.preventDefault();
            const name = naming.trim();
            if (!name) return;
            onSaveGroup(name);
            close();
          }}
        >
          <TextField
            ref={field}
            aria-label="Group name"
            className="w-40"
            value={naming}
            onChange={(event) => setNaming(event.target.value)}
            onKeyDown={(event) => {
              if (event.key !== 'Escape') return;
              // Escape leaves the name, not the selection.
              event.preventDefault();
              event.stopPropagation();
              close();
            }}
          />
          <Button type="submit" variant="primary" size="sm" disabled={!naming.trim()}>
            Save
          </Button>
        </form>
      )}
      <span aria-hidden className="text-bf-text-muted">
        ·
      </span>
      <Button variant="ghost" size="sm" disabled={!onCompareRest} onClick={onCompareRest}>
        Compare with the rest
      </Button>
      <IconButton icon={<X />} aria-label="Clear selection" onClick={onClear} />
    </div>
  );
}
