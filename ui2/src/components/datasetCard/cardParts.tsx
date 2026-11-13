/** Shared chrome of the dataset, collection and sidecar cards. */
import React, { useEffect, useId, useRef } from 'react';
import { VscArrowLeft, VscClose, VscCopy, VscRefresh } from 'react-icons/vsc';
import { Button, IconButton } from '@/components/ui/bf';
import { cn } from '@/utils/cn';
import { copyToClipboard } from '@/utils/copyToClipboard';

export const SECTION_TITLE = 'm-0 text-bf-xs font-medium leading-4 text-bf-text-muted';
export const NOTE = 'm-0 text-bf-xs leading-4 text-bf-text-muted';
export const MONO = 'font-mono text-bf-xs';

/**
 * Text that is shown one way and spoken another ("35+" and "at least 35
 * subjects", a clipped title and the whole one). The shown text is hidden
 * from assistive technology and the spoken text from sight: an `aria-label`
 * on an element with no role is not announced, this is.
 */
export function Spoken({
  text,
  spoken,
  className,
}: {
  text: React.ReactNode;
  spoken: string;
  className?: string;
}) {
  if (text === spoken) return <span className={className}>{text}</span>;
  return (
    <>
      <span aria-hidden="true" className={className}>
        {text}
      </span>
      <span className="sr-only">{spoken}</span>
    </>
  );
}

export interface CardHeaderProps {
  title: string;
  /** The title is a file name: mono, smaller. */
  monoTitle?: boolean;
  titleId: string;
  path: string | null;
  chips?: React.ReactNode;
  /** Shown as a back button above the title ("Back to PCMRI"). */
  backLabel?: string | null;
  onBack?: () => void;
  onRefresh?: () => void;
  refreshLabel?: string;
  onClose: () => void;
}

export function CardHeader({
  title,
  monoTitle = false,
  titleId,
  path,
  chips,
  backLabel,
  onBack,
  onRefresh,
  refreshLabel = 'Read again',
  onClose,
}: CardHeaderProps) {
  return (
    <header className="flex shrink-0 items-start gap-3 border-b border-bf-border-subtle py-3.5 pl-5 pr-4 pt-4">
      <div className="flex min-w-0 grow flex-col gap-1.5">
        {backLabel && onBack ? (
          <Button
            variant="ghost"
            size="sm"
            className="-ml-2 self-start"
            icon={<VscArrowLeft />}
            onClick={onBack}
          >
            {backLabel}
          </Button>
        ) : null}
        <h2
          id={titleId}
          className={cn(
            'm-0 text-bf-text-primary [overflow-wrap:anywhere]',
            monoTitle
              ? 'font-mono text-bf-md font-medium leading-5'
              : 'text-bf-lg font-semibold leading-[22px]',
          )}
        >
          {title}
        </h2>
        {path ? (
          <span className={cn(MONO, 'leading-4 text-bf-text-muted [overflow-wrap:anywhere]')}>
            {path}
          </span>
        ) : null}
        {chips ? <div className="flex flex-wrap gap-1.5">{chips}</div> : null}
      </div>
      <div className="flex shrink-0 items-center gap-1">
        {onRefresh ? (
          <IconButton
            icon={<VscRefresh />}
            aria-label={refreshLabel}
            title={refreshLabel}
            onClick={onRefresh}
          />
        ) : null}
        <IconButton icon={<VscClose />} aria-label="Close" title="Close" onClick={onClose} />
      </div>
    </header>
  );
}

export function CardBody({ children }: { children: React.ReactNode }) {
  return (
    <div
      data-card-body
      className="flex min-h-0 grow flex-col gap-[18px] overflow-y-auto px-5 py-4"
      // The body scrolls; a keyboard user must be able to reach it to scroll.
      tabIndex={0}
      role="group"
      aria-label="Card contents"
    >
      {children}
    </div>
  );
}

export function CardFooter({
  note,
  children,
}: {
  note?: React.ReactNode;
  children?: React.ReactNode;
}) {
  return (
    <footer className="flex shrink-0 flex-wrap items-center gap-2 rounded-b-bf-md border-t border-bf-border bg-bf-bg-panel px-5 py-3">
      <span className={cn(NOTE, 'min-w-0 grow [overflow-wrap:anywhere]')}>{note}</span>
      {children}
    </footer>
  );
}

export interface CardSectionProps {
  title: string;
  /** Right-aligned beside the title (a count, a file name). */
  aside?: React.ReactNode;
  divided?: boolean;
  children: React.ReactNode;
}

export function CardSection({ title, aside, divided = false, children }: CardSectionProps) {
  const id = useId();
  return (
    <section
      aria-labelledby={id}
      className={cn(
        'flex min-w-0 flex-col gap-2',
        divided && 'border-t border-bf-border-subtle pt-4',
      )}
    >
      <div className="flex items-baseline justify-between gap-3">
        <h3 id={id} className={SECTION_TITLE}>
          {title}
        </h3>
        {aside ? <span className={cn(NOTE, 'shrink-0')}>{aside}</span> : null}
      </div>
      {children}
    </section>
  );
}

export interface Fact {
  label: string;
  value: React.ReactNode;
  mono?: boolean;
}

/** Label / value rows. A fact whose value is absent is not passed in. */
export function Facts({ facts, wide = false }: { facts: Fact[]; wide?: boolean }) {
  if (facts.length === 0) return null;
  return (
    <dl
      className={cn(
        'm-0 grid gap-y-1 text-bf-sm leading-[18px]',
        wide ? 'grid-cols-[132px_minmax(0,1fr)]' : 'grid-cols-[96px_minmax(0,1fr)]',
      )}
    >
      {facts.map((fact) => (
        <React.Fragment key={fact.label}>
          <dt className="text-bf-text-muted">{fact.label}</dt>
          <dd
            className={cn(
              'm-0 min-w-0 text-bf-text-primary [overflow-wrap:anywhere]',
              fact.mono && MONO,
            )}
          >
            {fact.value}
          </dd>
        </React.Fragment>
      ))}
    </dl>
  );
}

export interface RawJsonProps {
  text: string;
  /** What was copied, for the status bar ("Description JSON copied"). */
  what: string;
  /** Said under the text when it is not the whole file. */
  truncatedNote?: string | null;
  id: string;
}

export function RawJson({ text, what, truncatedNote, id }: RawJsonProps) {
  const ref = useRef<HTMLElement>(null);
  // It opens at the top of a body that may be scrolled far down.
  useEffect(() => {
    ref.current?.scrollIntoView?.({ block: 'start' });
  }, []);
  return (
    <section ref={ref} id={id} aria-label="Raw JSON" className="flex min-w-0 flex-col gap-2">
      <div className="flex items-center justify-between gap-3">
        <h3 className={SECTION_TITLE}>Raw JSON</h3>
        <Button
          variant="secondary"
          size="sm"
          icon={<VscCopy />}
          onClick={() => void copyToClipboard(text, what)}
        >
          Copy
        </Button>
      </div>
      <pre className="m-0 max-h-80 overflow-auto whitespace-pre-wrap rounded-sm border border-bf-border-subtle bg-bf-bg-panel-sunken px-3 py-2.5 font-mono text-bf-xs leading-4 text-bf-text-secondary [overflow-wrap:anywhere]">
        {text}
      </pre>
      {truncatedNote ? <p className={NOTE}>{truncatedNote}</p> : null}
    </section>
  );
}
