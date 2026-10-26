import React from 'react';
import { cn } from '@/utils/cn';
import { Button } from '../Button';

/**
 * EmptyPane (UI redesign phase 3, item 11): the one empty state used by
 * every pane and rail. A 13 px title, one muted hint line, at most one
 * primary and one secondary action (the primary may show its shortcut in
 * mono), and optional content behind it (a ghost grid, dashed placeholders,
 * empty axes). Centred in panes, left-aligned in rails. No illustration and
 * never a ring glyph (it reads as loading).
 */
export interface EmptyPaneAction {
  label: string;
  onClick: () => void;
  /** Shown in mono after the label ("Cmd+Shift+O"). */
  shortcut?: string;
  disabled?: boolean;
  testId?: string;
}

export interface EmptyPaneProps extends Omit<React.HTMLAttributes<HTMLDivElement>, 'title'> {
  title: React.ReactNode;
  hint?: React.ReactNode;
  primary?: EmptyPaneAction | null;
  secondary?: EmptyPaneAction | null;
  /** `center` in panes (default), `start` in rails. */
  align?: 'center' | 'start';
  /** Drawn behind the message (ghost grid, placeholders, axes). */
  backdrop?: React.ReactNode;
  /** Ground under the message over a backdrop (canvas panes pass the canvas). */
  messageGround?: 'canvas' | 'panel' | null;
}

export function EmptyPane({
  title,
  hint,
  primary,
  secondary,
  align = 'center',
  backdrop,
  messageGround = null,
  className,
  ...rest
}: EmptyPaneProps) {
  const centred = align === 'center';
  return (
    <div
      className={cn(
        'relative flex h-full w-full min-w-0',
        centred ? 'items-center justify-center text-center' : 'items-start justify-start p-3 text-left',
        className,
      )}
      data-testid="empty-pane"
      {...rest}
    >
      {backdrop ? (
        <div aria-hidden className="pointer-events-none absolute inset-0">
          {backdrop}
        </div>
      ) : null}
      <div
        className={cn(
          'relative flex max-w-[44ch] flex-col gap-1',
          centred ? 'items-center' : 'items-start',
          // Lines of the backdrop never run through the message.
          messageGround === 'canvas' && 'rounded-bf-xs bg-bf-bg-canvas px-4 py-3',
          messageGround === 'panel' && 'rounded-bf-xs bg-bf-bg-panel px-4 py-3',
        )}
      >
        <p className="text-bf-sm font-semibold text-bf-text-primary">{title}</p>
        {hint ? <p className="text-bf-xs text-bf-text-muted">{hint}</p> : null}
        {primary || secondary ? (
          <div className="mt-2 flex flex-wrap items-center gap-2">
            {primary ? (
              <Button
                variant="primary"
                size="sm"
                onClick={primary.onClick}
                disabled={primary.disabled}
                data-testid={primary.testId}
              >
                {primary.label}
                {primary.shortcut ? (
                  <span className="ml-2 font-mono text-bf-2xs opacity-70">{primary.shortcut}</span>
                ) : null}
              </Button>
            ) : null}
            {secondary ? (
              <Button
                variant="secondary"
                size="sm"
                onClick={secondary.onClick}
                disabled={secondary.disabled}
                data-testid={secondary.testId}
              >
                {secondary.label}
                {secondary.shortcut ? (
                  <span className="ml-2 font-mono text-bf-2xs text-bf-text-muted">{secondary.shortcut}</span>
                ) : null}
              </Button>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}
