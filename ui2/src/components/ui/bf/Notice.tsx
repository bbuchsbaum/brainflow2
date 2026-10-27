import React, { forwardRef } from 'react';
import { cva } from 'class-variance-authority';
import { AlertCircle, AlertTriangle, CheckCircle2, CircleDashed, Info } from 'lucide-react';
import { cn } from '@/utils/cn';

/**
 * Inline status line. For dialog notes, empty-state explanations, on-canvas
 * metadata and warnings ("Surface and volume are in different spaces").
 *
 * - `surface="panel"` (default): NO box. A 2px left hairline in the severity
 *   colour (neutral and info use `--bf-border-strong`) + icon + neutral
 *   secondary text (severity colour only on icon and hairline), so a
 *   notice never looks like a disabled text field. Every severity has an
 *   icon, neutral included (a dashed circle: "nothing here").
 * - `surface="canvas"`: the boxed form, on a near-opaque black ground (90%)
 *   so warning text keeps ≥ 4.5:1 even over a white image region.
 *
 * Live regions: `role="status"` (polite) when `role` is omitted, but a
 * status present at mount is not announced by most screen readers.
 * Persistent notices (empty states, static notes) pass `role={undefined}`
 * (or `role={null}`): the notice then has NO role and no live region (an
 * explicit `undefined` is honoured, it does not fall back to `status`).
 * Transient ones should mount inside an existing live region. Pass
 * `role="alert"` explicitly, and only for a blocking error that appears in
 * response to an action.
 */

export type NoticeSeverity = 'neutral' | 'info' | 'success' | 'warning' | 'danger';

export interface NoticeProps extends Omit<React.HTMLAttributes<HTMLDivElement>, 'role'> {
  /**
   * ARIA role. Omitted: `status`. An explicit `undefined` or `null`: no role
   * (persistent notice, no live region). `alert` only for blocking errors.
   */
  role?: React.AriaRole | null;
  severity?: NoticeSeverity;
  /** `canvas`: over an image (black translucent ground); `panel`: on the panel ground. */
  surface?: 'panel' | 'canvas';
  /** Replace the severity icon, or `false` for none. */
  icon?: React.ReactNode | false;
  /** Trailing action (a link-style Button), outside the text flow. */
  action?: React.ReactNode;
}

const noticeVariants = cva('flex min-w-0 items-start gap-1.5 text-bf-xs', {
  variants: {
    severity: {
      neutral: 'border-bf-border-strong text-bf-text-secondary',
      info: 'border-bf-border-strong text-bf-text-secondary',
      // Text stays neutral secondary for every severity: the colour lives
      // only on the icon and the hairline (v3 fix), so a warm warning never
      // competes with warm colormaps and stays legible on any ground.
      success: 'border-bf-success text-bf-text-secondary',
      warning: 'border-bf-warning text-bf-text-secondary',
      danger: 'border-bf-danger text-bf-text-secondary',
    },
    surface: {
      panel: 'border-l-2 py-0.5 pl-2',
      canvas: 'rounded-sm border bg-bf-bg-canvas/90 px-2 py-1',
    },
  },
  compoundVariants: [
    { surface: 'canvas', severity: ['neutral', 'info'], className: 'border-bf-border' },
    { surface: 'canvas', severity: 'success', className: 'border-bf-success/40' },
    { surface: 'canvas', severity: 'warning', className: 'border-bf-warning/50' },
    { surface: 'canvas', severity: 'danger', className: 'border-destructive/50' },
  ],
  defaultVariants: { severity: 'neutral', surface: 'panel' },
});

const ICONS: Record<NoticeSeverity, React.ComponentType<{ className?: string }> | null> = {
  neutral: CircleDashed,
  info: Info,
  success: CheckCircle2,
  warning: AlertTriangle,
  danger: AlertCircle,
};

const ICON_TONE: Record<NoticeSeverity, string> = {
  neutral: 'text-muted-foreground',
  info: 'text-muted-foreground',
  success: 'text-bf-success',
  warning: 'text-bf-warning',
  danger: 'text-bf-danger',
};

export const Notice = forwardRef<HTMLDivElement, NoticeProps>(function Notice(props, ref) {
  const {
    severity = 'neutral',
    surface = 'panel',
    icon,
    action,
    role: roleProp,
    className,
    children,
    ...rest
  } = props;
  // Only an OMITTED role defaults to `status`; `role={undefined}` means none.
  const role = 'role' in props ? (roleProp ?? undefined) : 'status';
  const Icon = ICONS[severity];
  // Neutral and info glyphs are muted; semantic glyphs carry the severity colour.
  const iconTone = ICON_TONE[severity];
  const iconNode =
    icon === false
      ? null
      : (icon ?? (Icon ? <Icon className={cn('mt-px h-3.5 w-3.5 shrink-0', iconTone)} /> : null));
  return (
    <div
      ref={ref}
      role={role}
      data-severity={severity}
      className={cn(noticeVariants({ severity, surface }), className)}
      {...rest}
    >
      {iconNode ? (
        <span aria-hidden className="flex shrink-0">
          {iconNode}
        </span>
      ) : null}
      <div className="min-w-0 flex-1 leading-4">{children}</div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
});
