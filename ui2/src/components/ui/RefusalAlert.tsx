/**
 * RefusalAlert: a floating, dismissible alert for a request the app refused
 * (no free GPU texture slot, a view already drawing its maximum of layers;
 * QA N31). The status bar line shortens long messages, so the refusal's
 * full sentence (the cause and one way out) floats above the bar until it is
 * dismissed or replaced by the next refusal. The message stays in the status
 * bar list and in the Log like any other notification.
 *
 * It sits centred above the status bar, clear of the left rail and the
 * Inspector, and is small: one sentence, one dismiss button (or Escape). A
 * refusal whose operation scope is resolved by a later success goes away.
 */

import React, { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { useEvent } from '@/events/EventBus';
import { Notice } from './bf/Notice';
import { IconButton } from './IconButton';

interface Refusal {
  id: number;
  type: 'info' | 'warning' | 'error' | 'success';
  message: string;
  /** The operation group it belongs to (as in NotificationToast). */
  scope?: string;
  sequence?: number;
}

let nextRefusalId = 0;

export function RefusalAlert() {
  const [refusal, setRefusal] = useState<Refusal | null>(null);
  // A failure can arrive after a later request of its scope succeeded: it is
  // stale then, and a resolve clears the refusal it covers (as the status
  // bar's list does).
  const resolvedThrough = useRef(new Map<string, number>());

  useEvent('ui.notification', ({ type, message, alert, scope, sequence }) => {
    if (!alert) return;
    if (scope !== undefined && sequence !== undefined &&
        sequence <= (resolvedThrough.current.get(scope) ?? 0)) return;
    nextRefusalId += 1;
    setRefusal({
      id: nextRefusalId,
      type,
      message,
      ...(scope !== undefined ? { scope } : {}),
      ...(sequence !== undefined ? { sequence } : {}),
    });
  });
  useEvent('ui.notification.resolve', ({ scope, through }) => {
    const resolved = Math.max(resolvedThrough.current.get(scope) ?? 0, through);
    resolvedThrough.current.set(scope, resolved);
    setRefusal((current) =>
      current && current.scope === scope && current.sequence !== undefined && current.sequence <= resolved
        ? null
        : current,
    );
  });
  useEvent('ui.notification.clear', () => setRefusal(null));

  // Escape dismisses it, unless something else (a dialog, a menu) took the key.
  const shown = refusal !== null;
  useEffect(() => {
    if (!shown) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !event.defaultPrevented) setRefusal(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [shown]);

  if (!refusal) return null;
  return (
    <div
      key={refusal.id}
      className="pointer-events-auto fixed bottom-[calc(var(--bf-statusbar-h)+8px)] left-1/2 z-50 w-[min(440px,calc(100vw-32px))] -translate-x-1/2 rounded-bf-xs border border-bf-border-strong bg-bf-bg-panel-raised px-2 py-1.5 shadow-bf-panel"
      data-testid="refusal-alert"
    >
      <Notice
        role="alert"
        severity={refusal.type === 'error' ? 'danger' : 'warning'}
        action={
          <IconButton
            size="xs"
            variant="ghost"
            icon={<X />}
            aria-label="Dismiss alert"
            title="Dismiss"
            onClick={() => setRefusal(null)}
          />
        }
      >
        <span
          className="select-text whitespace-pre-wrap break-words text-bf-text-primary"
          data-testid="refusal-alert-text"
        >
          {refusal.message}
        </span>
      </Notice>
    </div>
  );
}
