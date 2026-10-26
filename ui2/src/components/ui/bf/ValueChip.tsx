import React, { forwardRef, useEffect, useId, useRef, useState } from 'react';
import { AlertCircle } from 'lucide-react';
import { cn } from '@/utils/cn';
import { asciiCopyHandler, parseNumericText } from '@/utils/numericInput';
import { formatLayerValue, formatLayerValueAscii } from '@/utils/valueFormat';
import { FOCUS_RING } from './states';

/**
 * Click-to-edit numeric readout (the Inspector's `EditableNumber`, and the
 * Slider's `editable` value chips).
 *
 * At rest: a button showing the DISPLAY text (U+2212 minus, mono, tabular);
 * copying it yields ASCII ("-4.58") via `asciiCopyHandler`. Activating it
 * (click, Enter, Space) swaps in a text field holding the ASCII text,
 * selected. Enter or blur commits, Escape reverts. The draft is parsed with
 * the strict `parseNumericText` ("−37.5" -> -37.5; "12 mm", "abc" -> invalid):
 * an invalid draft keeps the field open, marked `aria-invalid`, with a
 * visible "Not a number" message tied by `aria-describedby`, and commits
 * nothing. A committed value is clamped to [min, max] when given.
 */
export interface ValueChipProps {
  value: number;
  onCommit: (value: number) => void;
  /** Accessible name of the edited quantity ("Intensity low"). */
  label: string;
  format?: (value: number) => string;
  /** Text placed in the editor (ASCII). */
  formatEdit?: (value: number) => string;
  min?: number;
  max?: number;
  disabled?: boolean;
  className?: string;
  align?: 'start' | 'end';
  /**
   * External error slot. When given, the chip does NOT float its own message
   * (which would overprint whatever sits below a label-line readout, e.g. a
   * slider track); it reports the invalid state here and points
   * `aria-describedby` at `errorId`, where the caller renders
   * {@link ValueChipError} in flow (under the control).
   */
  onInvalidChange?: (invalid: boolean) => void;
  /** Id of the caller's {@link ValueChipError}; used with `onInvalidChange`. */
  errorId?: string;
}

/** The invalid-draft message text, shared by the chip and external slots. */
export const VALUE_CHIP_ERROR = 'Not a number';

/**
 * In-flow error line for a {@link ValueChip} with an external error slot:
 * the FieldRow error look (danger text, alert icon) in a polite live region
 * that is present from mount, so it never overlaps the control above it.
 */
export function ValueChipError({ id, show, className }: { id: string; show: boolean; className?: string }) {
  return (
    <div aria-live="polite" aria-atomic="true" className={cn(!show && 'hidden', className)}>
      {show ? (
        <div id={id} className="flex items-center gap-1 text-bf-xs text-bf-danger">
          <AlertCircle aria-hidden className="h-3 w-3 shrink-0" />
          <span>{VALUE_CHIP_ERROR}</span>
        </div>
      ) : null}
    </div>
  );
}

export const ValueChip = forwardRef<HTMLButtonElement, ValueChipProps>(function ValueChip(
  {
    value,
    onCommit,
    label,
    format = formatLayerValue,
    formatEdit = formatLayerValueAscii,
    min,
    max,
    disabled = false,
    className,
    align = 'start',
    onInvalidChange,
    errorId: externalErrorId,
  },
  ref,
) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [invalid, setInvalidState] = useState(false);
  const onInvalidRef = useRef(onInvalidChange);
  onInvalidRef.current = onInvalidChange;
  const setInvalid = (next: boolean) => {
    setInvalidState(next);
    onInvalidRef.current?.(next);
  };
  const inputRef = useRef<HTMLInputElement>(null);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const ownErrorId = `${useId().replace(/:/g, '')}-error`;
  const external = onInvalidChange !== undefined;
  const errorId = external && externalErrorId ? externalErrorId : ownErrorId;
  // Escape closes without the blur that follows committing.
  const skipBlur = useRef(false);

  useEffect(() => {
    if (editing) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [editing]);

  const start = () => {
    if (disabled) return;
    setDraft(formatEdit(value));
    setInvalid(false);
    setEditing(true);
  };
  const close = (refocus: boolean) => {
    setEditing(false);
    setInvalid(false);
    if (refocus) requestAnimationFrame(() => buttonRef.current?.focus());
  };
  const commit = (refocus: boolean): boolean => {
    const parsed = parseNumericText(draft);
    if (parsed === null) {
      setInvalid(true);
      return false;
    }
    let next = parsed;
    if (min !== undefined) next = Math.max(min, next);
    if (max !== undefined) next = Math.min(max, next);
    close(refocus);
    if (!Object.is(next, value)) onCommit(next);
    return true;
  };

  if (editing) {
    return (
      <span
        // mx: the 3px outer ring (offset 1 + width 2) keeps >= 4px clear of
        // neighbouring text ("to") in a gap-1 readout.
        className={cn('relative mx-[3px] inline-flex flex-col', align === 'end' && 'items-end', className)}
      >
        <input
          ref={inputRef}
          type="text"
          inputMode="decimal"
          data-numeric="true"
          data-numeric-paste="self"
          aria-label={label}
          aria-invalid={invalid || undefined}
          aria-describedby={invalid ? errorId : undefined}
          value={draft}
          size={Math.max(4, draft.length + 1)}
          onChange={(e) => {
            setDraft(e.currentTarget.value);
            if (invalid) setInvalid(false);
          }}
          onPaste={(e) => {
            // Own paste: keep the text (normalised later by parseNumericText).
            e.stopPropagation();
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              commit(true);
            } else if (e.key === 'Escape') {
              e.preventDefault();
              e.stopPropagation();
              skipBlur.current = true;
              close(true);
            }
          }}
          onBlur={() => {
            if (skipBlur.current) {
              skipBlur.current = false;
              return;
            }
            // Blur with an invalid draft reverts (the user left the field).
            if (!commit(false)) close(false);
          }}
          className={cn(
            'h-5 min-w-[4ch] rounded-sm border border-bf-border-strong bg-bf-bg-input px-1 font-mono text-bf-xs tabular-nums text-foreground outline-0',
            'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--bf-border-focus)] focus-visible:rounded-none',
            invalid && 'border-bf-danger',
          )}
        />
        {invalid && !external ? (
          <span
            id={errorId}
            role="alert"
            className="absolute top-full z-20 mt-0.5 whitespace-nowrap bg-bf-bg-panel px-0.5 text-bf-2xs text-bf-danger"
          >
            {VALUE_CHIP_ERROR}
          </span>
        ) : null}
      </span>
    );
  }

  return (
    <button
      ref={(el) => {
        buttonRef.current = el;
        if (typeof ref === 'function') ref(el);
        else if (ref) ref.current = el;
      }}
      type="button"
      disabled={disabled}
      aria-label={`${label}: ${formatEdit(value)}, edit`}
      onClick={start}
      onCopy={asciiCopyHandler}
      className={cn(
        // 20px visual chip, 24px hit area: a transparent ::after extends the
        // target 2px above and below (pointer hits on it land on the button).
        "relative after:absolute after:inset-x-0 after:-inset-y-0.5 after:content-['']",
        'inline-flex h-5 items-center rounded-sm px-1 font-mono text-bf-xs tabular-nums text-foreground underline decoration-[var(--bf-border-strong)] decoration-dotted underline-offset-2 hover:bg-accent hover:decoration-current disabled:cursor-not-allowed disabled:no-underline disabled:opacity-50',
        FOCUS_RING,
        className,
      )}
    >
      {format(value)}
    </button>
  );
});
