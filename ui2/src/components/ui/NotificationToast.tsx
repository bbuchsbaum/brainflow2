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
 */

import React, { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { useEvent } from '@/events/EventBus';
import { IconButton } from './IconButton';

interface Notification {
  id: string;
  type: 'info' | 'warning' | 'error' | 'success';
  message: string;
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

export function NotificationToast() {
  const [notifications, setNotifications] = useState<Notification[]>([]);

  useEvent('ui.notification.clear', () => setNotifications([]));

  useEvent('ui.notification', ({ type, message, durationMs }) => {
    const notification: Notification = { id: `toast-${(nextNotificationId += 1)}`, type, message };
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
      setTimeout(() => {
        setNotifications((prev) => prev.filter((n) => n.id !== notification.id));
      }, durationMs ?? DEFAULT_DURATION_MS);
    }
  });

  const current = notifications[notifications.length - 1] ?? null;
  const earlier = notifications.length - 1;

  // Keep the live region mounted so the first message is announced.
  const [announced, setAnnounced] = useState('');
  useEffect(() => {
    if (current) setAnnounced(current.message);
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
          title={current.message}
        >
          <span
            aria-hidden
            className={`h-2 w-2 shrink-0 rounded-bf-xs ${DOT_CLASS[current.type]}`}
          />
          <span
            className={`min-w-0 truncate text-bf-xs ${
              current.type === 'error' ? 'text-bf-text-primary' : 'text-bf-text-secondary'
            }`}
          >
            {current.message}
          </span>
          {earlier > 0 ? (
            <span className="shrink-0 font-mono text-bf-2xs tabular-nums text-bf-text-muted">
              +{earlier}
            </span>
          ) : null}
          <IconButton
            size="xs"
            variant="ghost"
            icon={<X />}
            aria-label="Dismiss message"
            title="Dismiss"
            onClick={() => setNotifications((prev) => prev.filter((n) => n.id !== current.id))}
          />
        </div>
      ) : null}
    </div>
  );
}
