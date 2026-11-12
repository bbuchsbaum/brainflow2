import { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { Button, Notice } from '@/components/ui/bf';
import { IconButton } from '@/components/ui/IconButton';
import { getSetIngestionService } from '@/services/studio/SetIngestionService';
import { useSetStudioStore } from '@/stores/setStudioStore';

/** How long a notice that asks nothing stays up. */
export const STUDIO_OPEN_NOTICE_MS = 6000;

const isTextEntry = (target: EventTarget | null) =>
  target instanceof HTMLElement &&
  (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName));

/**
 * One quiet line under the Studio header after a folder was opened as a set
 * without its review: what was opened, and the way to the review. It is
 * information, so it goes away after a few seconds, or as soon as the Studio
 * is used with the pointer or typed into; "Review…" stays in the toolbar's
 * menu. Moving through the page with the keyboard does not hide it, and its
 * time does not run while it has focus or the pointer, so its own controls
 * can be reached. A notice that asks the reader to act (`requiresAction`)
 * stays until dismissed.
 */
export function StudioOpenNotice() {
  const notice = useSetStudioStore((state) =>
    state.studioOpenNotice && state.studioOpenNotice.setId === state.selection.activeSetId
      ? state.studioOpenNotice
      : null,
  );
  const host = useRef<HTMLDivElement>(null);
  // Hidden here only: the store keeps the notice, which the menu's Review… needs.
  const [hidden, setHidden] = useState<typeof notice>(null);
  // In use (focus inside, or the pointer over it): its time does not run.
  const [held, setHeld] = useState(false);
  const shown = notice && notice !== hidden ? notice : null;
  const transient = !!shown && !shown.requiresAction;
  useEffect(() => {
    if (!transient || !shown) return;
    const hide = () => setHidden(shown);
    const outside = (event: Event) => !host.current?.contains(event.target as Node | null);
    const onPointer = (event: Event) => {
      if (outside(event)) hide();
    };
    // Tab and the arrows are how a keyboard reaches the notice: only typing hides it.
    const onKey = (event: KeyboardEvent) => {
      if (outside(event) && isTextEntry(event.target) && event.key.length === 1) hide();
    };
    document.addEventListener('pointerdown', onPointer, true);
    document.addEventListener('keydown', onKey, true);
    const timer = held ? null : setTimeout(hide, STUDIO_OPEN_NOTICE_MS);
    return () => {
      if (timer !== null) clearTimeout(timer);
      document.removeEventListener('pointerdown', onPointer, true);
      document.removeEventListener('keydown', onKey, true);
    };
  }, [transient, shown, held]);
  useEffect(() => {
    if (!shown) setHeld(false);
  }, [shown]);
  if (!shown) return null;
  return (
    <div
      ref={host}
      onFocus={() => setHeld(true)}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setHeld(false);
      }}
      onMouseEnter={() => setHeld(true)}
      onMouseLeave={(event) => {
        if (!event.currentTarget.contains(document.activeElement)) setHeld(false);
      }}
    >
      <Notice
        severity="neutral"
        icon={false}
        className="items-center border-b border-border px-3 py-1"
        data-testid="studio-open-notice"
        action={
          <span className="flex items-center gap-1">
            <Button
              variant="link"
              size="sm"
              className="min-h-6"
              onClick={() => void getSetIngestionService().reviewOpenedFolder()}
            >
              Review…
            </Button>
            <IconButton
              size="xs"
              variant="ghost"
              icon={<X />}
              aria-label="Dismiss"
              title="Dismiss"
              onClick={() => setHidden(shown)}
            />
          </span>
        }
      >
        {shown.message}
      </Notice>
    </div>
  );
}
