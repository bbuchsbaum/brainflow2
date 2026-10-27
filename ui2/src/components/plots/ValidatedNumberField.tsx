/**
 * A number field that keeps what the user typed until it is valid, marks the
 * field invalid with a specific message, and commits only valid values
 * (phase 4 v1 function 7: no silent revert).
 */
import { useEffect, useId, useState } from 'react';
import { NumberField } from '@/components/ui/bf';

export interface ValidatedNumberFieldProps {
  value: number;
  onCommit: (value: number) => void;
  /** A message when `value` (null: empty / not a number) is not acceptable. */
  validate: (value: number | null) => string | null;
  'aria-label': string;
  unit?: string;
  step?: number;
  min?: number;
  fieldClassName?: string;
  /** An extra problem from outside the field (e.g. "from > to"). */
  externalMessage?: string | null;
}

export function ValidatedNumberField({
  value,
  onCommit,
  validate,
  unit,
  step,
  min,
  fieldClassName,
  externalMessage,
  ...rest
}: ValidatedNumberFieldProps) {
  const [text, setText] = useState(String(value));
  const [message, setMessage] = useState<string | null>(null);
  const messageId = useId();
  // Follow outside changes (another control, a reset) when not mid-edit.
  useEffect(() => {
    if (!message) setText(String(value));
  }, [value, message]);
  const shown = message ?? externalMessage ?? null;
  return (
    <span className="inline-flex items-center gap-1">
      <NumberField
        aria-label={rest['aria-label']}
        aria-describedby={shown ? messageId : undefined}
        fieldClassName={fieldClassName}
        step={step}
        min={min}
        unit={unit}
        value={text}
        invalid={!!shown}
        onValueChange={(next, event) => {
          setText(event.target.value);
          const problem = validate(next);
          setMessage(problem);
          if (!problem && next !== null) onCommit(next);
        }}
      />
      {shown ? (
        <span id={messageId} role="status" className="text-bf-2xs text-bf-danger">
          {shown}
        </span>
      ) : null}
    </span>
  );
}
