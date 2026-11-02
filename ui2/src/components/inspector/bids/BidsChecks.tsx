import React from 'react';
import type { BidsCheck } from '@brainflow/api';
import { cn } from '@/utils/cn';

const MARK: Record<string, { glyph: string; className: string; label: string }> = {
  ok: { glyph: '✓', className: 'text-bf-text-faint', label: 'Passed' },
  warning: { glyph: '!', className: 'text-bf-warning', label: 'Warning' },
  error: { glyph: '✕', className: 'text-bf-danger', label: 'Failed' },
};

/** Checks as a mark and a sentence. `ok: false` never reads as a pass. */
export function BidsChecks({ checks }: { checks: readonly BidsCheck[] }) {
  return (
    <ul className="m-0 grid list-none grid-cols-[14px_1fr] gap-x-1 gap-y-0.5 p-0 text-bf-xs text-bf-text-secondary">
      {checks.map((check) => {
        const severity = check.severity in MARK ? check.severity : check.ok ? 'ok' : 'warning';
        const mark = MARK[check.ok ? 'ok' : severity === 'ok' ? 'warning' : severity];
        return (
          <li key={check.text} className="contents">
            <span aria-label={mark.label} className={cn('font-mono', mark.className)}>
              {mark.glyph}
            </span>
            <span>{check.text}</span>
          </li>
        );
      })}
    </ul>
  );
}
