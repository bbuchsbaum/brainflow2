/**
 * NotificationToast: transient feedback ("Loaded …", "Saved image to …",
 * errors), shown as ONE line inside the status bar (UI redesign phase 3, v3
 * critic: floating toasts covered the Inspector and dock content). It never
 * overlaps a panel: it takes the status bar's free space between the
 * readouts and Diagnostics, newest message first.
 *
 * Info / success / warning messages expire after 5 s (or `durationMs`); an
 * error stays until dismissed (or replaced) and is an assertive alert. Every
 * message is announced in a polite live region.
 *
 * The line is a button (v4 function critic: an error cut to a stub, its
 * reason only in a hover title): it opens every current message in full.
 * A long line is shortened in the MIDDLE, so the cause at its end stays.
 */

import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/shadcn/popover';
import { middleTruncate } from '@/components/views/viewportFrame/frameFormat';
import { X } from 'lucide-react';
import { useEvent } from '@/events/EventBus';
import { IconButton } from './IconButton';
import { focusFallback } from './bf/focusFallback';
import { statusLineMessage } from '@/utils/formatTauriError';

interface Notification {
  id: string;
  type: 'info' | 'warning' | 'error' | 'success';
  message: string;
  /** "Undo" after "Removed T1w.nii.gz": runs once, then the message goes. */
  action?: { label: string; run: () => void };
}

/** Unique per toast (two toasts in the same millisecond must not share an id). */
let nextNotificationId = 0;

const DEFAULT_DURATION_MS = 5000;

/** The loaded item of a "Loaded …: name" info message (null for others). */
function loadedItem(n: Pick<Notification, 'type' | 'message'>): string | null {
  if (n.type !== 'info' && n.type !== 'success') return null;
  const m = /^(?:loaded(?: overlay)?|surface loaded):\s*(.+)$/i.exec(n.message.trim());
  return m ? m[1] : null;
}

const DOT_CLASS: Record<Notification['type'], string> = {
  info: 'bg-bf-text-muted',
  success: 'bg-bf-success',
  warning: 'bg-bf-warning',
  error: 'bg-bf-danger',
};

/** Fit `text` to `el`'s width by middle truncation (its own font, measured). */
function useMiddleFit(text: string, el: React.RefObject<HTMLElement | null>): string {
  const [fitted, setFitted] = useState(text);
  useLayoutEffect(() => {
    const node = el.current;
    if (!node) return;
    let canvas: HTMLCanvasElement | null = null;
    const fit = () => {
      const width = node.clientWidth;
      if (!(width > 0)) {
        setFitted(text);
        return;
      }
      canvas ??= document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        setFitted(text);
        return;
      }
      ctx.font = getComputedStyle(node).font;
      if (ctx.measureText(text).width <= width) {
        setFitted(text);
        return;
      }
      let chars = Array.from(text).length - 1;
      let candidate = middleTruncate(text, chars, 8);
      while (candidate && chars > 8 && ctx.measureText(candidate).width > width) {
        chars -= 1;
        candidate = middleTruncate(text, chars, 8);
      }
      setFitted(candidate ?? text);
    };
    fit();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(fit);
    observer.observe(node);
    return () => observer.disconnect();
  }, [text, el]);
  return fitted;
}

export function NotificationToast() {
  const [notifications, setNotifications] = useState<Notification[]>([]);
  // While the message list is open, nothing expires out from under it (the
  // popover would vanish and drop focus to <body>, v5 function critic):
  // expiries wait and apply when it closes.
  const openRef = useRef(false);
  const deferredExpiry = useRef(new Set<string>());
  const expire = (id: string) => {
    if (openRef.current) {
      deferredExpiry.current.add(id);
      return;
    }
    setNotifications((prev) => prev.filter((n) => n.id !== id));
  };

  useEvent('ui.notification.clear', () => {
    const wasOpen = openRef.current;
    setNotifications([]);
    // Forced closed (all cleared): focus goes somewhere useful.
    if (wasOpen) focusFallback(['[data-testid="status-diagnostics-trigger"]']);
  });

  useEvent('ui.notification', ({ type, message, durationMs, action }) => {
    const notification: Notification = {
      id: `toast-${(nextNotificationId += 1)}`,
      type,
      message,
      ...(action ? { action } : {}),
    };
    // Several loads become ONE message ("Loaded: a, b, c"), not a stack.
    const item = loadedItem(notification);
    setNotifications((prev) => {
      const last = prev[prev.length - 1];
      const lastItem = last ? loadedItem(last) : null;
      if (item && lastItem) {
        const merged = { ...notification, message: `Loaded: ${lastItem}, ${item}` };
        return [...prev.slice(0, -1), merged];
      }
      return [...prev, notification];
    });
    // Errors wait for the user; the rest expire.
    if (type !== 'error') {
      setTimeout(() => expire(notification.id), durationMs ?? DEFAULT_DURATION_MS);
    }
  });

  const current = notifications[notifications.length - 1] ?? null;
  const earlier = notifications.length - 1;
  const textRef = useRef<HTMLSpanElement>(null);
  // The bar shows a short form of a long known cause; the list has it in full.
  const shown = useMiddleFit(statusLineMessage(current?.message ?? ''), textRef);
  const [open, setOpenState] = useState(false);
  const setOpen = (next: boolean) => {
    openRef.current = next;
    setOpenState(next);
    if (!next && deferredExpiry.current.size > 0) {
      const ids = new Set(deferredExpiry.current);
      deferredExpiry.current.clear();
      setNotifications((prev) => prev.filter((n) => !ids.has(n.id)));
    }
  };
  useEffect(() => {
    if (!current && openRef.current) {
      openRef.current = false;
      setOpenState(false);
    }
  }, [current]);

  // Keep the live region mounted so the first message is announced.
  const [announced, setAnnounced] = useState('');
  // Errors are announced once, by their alert; the polite region carries
  // the rest (v5: errors were read twice).
  useEffect(() => {
    if (current && current.type !== 'error') setAnnounced(current.message);
  }, [current]);

  return (
    <div className="status-notification" data-testid="status-notification-slot">
      <span className="sr-only" role="status" aria-live="polite">
        {announced}
      </span>
      {current ? (
        <div
          key={current.id}
          role={current.type === 'error' ? 'alert' : undefined}
          className="flex min-w-0 items-center gap-2"
          data-testid="status-notification"
          data-type={current.type}
        >
          <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger asChild>
              <button
                type="button"
                className="flex min-w-0 flex-1 items-center gap-2 rounded-bf-xs px-0.5 text-left hover:bg-accent focus-visible:outline focus-visible:outline-1 focus-visible:outline-ring"
                aria-label={`${current.type === 'error' ? 'Error' : 'Message'}: ${current.message}. Show ${
                  earlier > 0 ? `all ${earlier + 1} messages` : 'in full'
                }`}
                title={current.message}
                data-testid="status-notification-open"
              >
                <span
                  aria-hidden
                  className={`h-2 w-2 shrink-0 rounded-bf-xs ${DOT_CLASS[current.type]}`}
                />
                <span
                  ref={textRef}
                  className={`min-w-0 flex-1 overflow-hidden whitespace-nowrap text-bf-xs ${
                    current.type === 'error' ? 'text-bf-text-primary' : 'text-bf-text-secondary'
                  }`}
                  data-testid="status-notification-text"
                >
                  {shown}
                </span>
                {earlier > 0 ? (
                  <span className="shrink-0 font-mono text-bf-2xs tabular-nums text-bf-text-muted">
                    +{earlier}
                  </span>
                ) : null}
              </button>
            </PopoverTrigger>
            <PopoverContent
              side="top"
              align="start"
              sideOffset={6}
              className="w-[min(560px,90vw)] p-2"
              aria-label="Messages"
              data-testid="status-notification-list"
            >
              <ol className="max-h-[50vh] space-y-1.5 overflow-y-auto">
                {[...notifications].reverse().map((n) => (
                  <li key={n.id} className="flex items-start gap-2 text-bf-xs">
                    <span
                      aria-hidden
                      className={`mt-1 h-2 w-2 shrink-0 rounded-bf-xs ${DOT_CLASS[n.type]}`}
                    />
                    <span className="min-w-0 select-text whitespace-pre-wrap break-words text-bf-text-primary">
                      {n.message}
                    </span>
                  </li>
                ))}
              </ol>
            </PopoverContent>
          </Popover>
          {current.action ? (
            <button
              type="button"
              className="shrink-0 rounded-bf-xs px-1 text-bf-xs font-medium text-bf-text-primary underline-offset-2 hover:bg-accent hover:underline focus-visible:outline focus-visible:outline-1 focus-visible:outline-ring"
              data-testid="status-notification-action"
              onClick={() => {
                const { action, id } = current;
                setNotifications((prev) => prev.filter((n) => n.id !== id));
                action?.run();
              }}
            >
              {current.action.label}
            </button>
          ) : null}
          <IconButton
            size="xs"
            variant="ghost"
            icon={<X />}
            aria-label="Dismiss message"
            title="Dismiss"
            onClick={() => {
              setNotifications((prev) => prev.filter((n) => n.id !== current.id));
              // The next message's Dismiss, else the status bar's Diagnostics.
              focusFallback([
                '[data-testid="status-notification"] button[aria-label="Dismiss message"]',
                '[data-testid="status-diagnostics-trigger"]',
              ]);
            }}
          />
        </div>
      ) : null}
    </div>
  );
}
