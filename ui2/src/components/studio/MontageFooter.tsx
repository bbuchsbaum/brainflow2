import { useEffect, useState, type ReactNode } from 'react';
import { Button, NumberField, Pager, Slider } from '@/components/ui/bf';
import { StudioPopover } from './StudioToolbarSlot';
import { POPULATION_HIDDEN_FRACTION } from '@/services/studio/PopulationSliceService';
import { limitDisplay, limitText } from './montageModel';
import { PopulationScaleStrip } from './PopulationColorbar';
import { scaleClipping } from '@/services/studio/studioMapDisplay';

/**
 * One end of the shared colour scale. It shows the limit at three significant
 * digits and, while being edited, exactly what was typed; every valid edit is
 * applied at once.
 */
function LimitField({
  label,
  sign,
  limit,
  disabled,
  onLimit,
}: {
  label: string;
  sign: -1 | 1;
  limit: number | null;
  disabled: boolean;
  onLimit: (limit: number) => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const shown = limit === null ? '' : limitText(sign * limit);
  return (
    <NumberField
      aria-label={label}
      title={limit === null ? label : `${label}, ${limitDisplay(sign * limit)}`}
      fieldClassName="w-20 shrink-0"
      step="any"
      disabled={disabled}
      value={draft ?? shown}
      onFocus={() => setDraft(shown)}
      onBlur={() => setDraft(null)}
      onChange={(event) => {
        setDraft(event.target.value);
        const magnitude = Math.abs(event.target.valueAsNumber);
        if (Number.isFinite(magnitude) && magnitude > 0) onLimit(magnitude);
      }}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === 'Escape') event.currentTarget.blur();
      }}
    />
  );
}

/**
 * "IDs without “sub-”": the prefix stripped from every tile label, said once,
 * quietly. No trailing ellipsis (it read as truncated text); never wraps or
 * shrinks.
 */
export function MontageIdPrefixNote({ prefix }: { prefix: string }) {
  return (
    <span
      data-testid="montage-id-prefix"
      title={`Every ID starts with "${prefix}"; the tiles show the rest`}
      className="shrink-0 whitespace-nowrap text-bf-xs text-bf-text-muted"
    >
      IDs without “<span className="font-mono">{prefix}</span>”
    </span>
  );
}

export interface MontageFooterProps {
  /**
   * What the grid shows, in plain words. Not on the line: it is the footer's
   * tooltip and its status for a screen reader.
   */
  description: string;
  /** The value under the pointer; replaces the description while present. */
  hover?: string | null;
  /** Why a sort, grouping or selection could not be applied. */
  error?: string | null;
  /** Something to try instead, offered beside the error. */
  errorAction?: { label: string; onClick: () => void } | null;
  /** The shared scale's limit (the maps run −limit to +limit); null before the first result. */
  limit: number | null;
  onLimit: (limit: number) => void;
  /** Fit the scale to the data; absent when the range is unknown. */
  onFit?: () => void;
  /** The largest magnitude in the data, the slider's top; null when unknown. */
  dataLimit?: number | null;
  /** The data's extent: an end the data run past is marked on the scale. */
  dataRange?: readonly [number, number] | null;
  /** What the scale belongs to (set and image): another one drops a pending slider value. */
  scaleIdentity?: string;
  /** A calculation the montage is waiting for: said first, with a way to stop it. */
  busy?: { text: string; onCancel?: () => void } | null;
  page?: { page: number; count: number; onPage: (page: number) => void; label?: string };
  /** The transport (step, play, the focused subject's place), first on the line. */
  transport?: ReactNode;
  /** A summary on its own scale (magnitude, spread, coverage): its maximum. */
  summaryLimit?: { value: number; onChange: (value: number) => void } | null;
  /** The values' unit, when known ("z", "%"): after the scale. */
  unit?: string | null;
  /**
   * The prefix every ID shares ("sub-"), stripped from the tile labels: said
   * once, after the transport, never shortened.
   */
  idPrefix?: string;
}

/**
 * The one line below the images, in every view: the transport and the place
 * in the order, then what is being computed or what went wrong (or the value
 * under the pointer) when there is any, then the one scale every map shares,
 * drawn compactly; its limits, slider and Fit open from it. What the grid
 * shows is the line's tooltip and its status, not a sentence on it.
 */
export function MontageFooter({
  description,
  hover,
  error,
  errorAction = null,
  limit,
  onLimit,
  onFit,
  dataLimit = null,
  dataRange = null,
  scaleIdentity = '',
  busy = null,
  page,
  transport = null,
  summaryLimit = null,
  unit = null,
  idPrefix,
}: MontageFooterProps) {
  // While the slider is dragged the numbers follow it; the maps are redrawn on
  // release. The released value stays shown until the redrawn result carries
  // it (or a different limit, or another set), so the thumb never snaps back.
  const [pending, setPending] = useState<{
    value: number;
    /** The limit shown when the value was released; null while still dragging. */
    releasedFrom: number | null | undefined;
  } | null>(null);
  useEffect(() => setPending(null), [scaleIdentity]);
  useEffect(() => {
    if (!pending || pending.releasedFrom === undefined) return;
    if (limit === null || limit !== pending.releasedFrom || limit === pending.value)
      setPending(null);
  }, [limit, pending]);
  const preview = limit === null ? null : (pending?.value ?? null);
  const shownLimit = preview ?? limit;
  const top = Math.max(dataLimit ?? 0, limit ?? 0, preview ?? 0) || 1;
  const range =
    limit === null ? 'no maps yet' : `${limitDisplay(-limit)} to ${limitDisplay(limit)}`;
  const hiddenBelow = shownLimit === null ? null : POPULATION_HIDDEN_FRACTION * shownLimit;
  return (
    <div
      data-testid="montage-footer"
      title={description}
      className="flex min-h-8 shrink-0 flex-wrap items-center gap-x-3 gap-y-1 border-t border-border py-1 text-bf-sm"
    >
      {/* The live region carries state only (order, fit, paging): a value under
          the pointer is shown, never announced on every mouse move. */}
      <span role={error ? 'alert' : 'status'} className="sr-only">
        {error ?? busy?.text ?? description}
      </span>
      {transport}
      {idPrefix ? <MontageIdPrefixNote prefix={idPrefix} /> : null}
      {busy && !error ? (
        <span className="flex min-w-0 flex-1 items-center gap-2">
          <span
            aria-hidden
            data-testid="montage-footer-busy"
            className="min-w-0 truncate font-medium text-bf-text-primary"
            title={busy.text}
          >
            {busy.text}
          </span>
          {busy.onCancel && (
            <Button variant="secondary" size="sm" className="shrink-0" onClick={busy.onCancel}>
              Cancel
            </Button>
          )}
        </span>
      ) : error && !hover ? (
        <span className="flex min-w-0 flex-1 items-center gap-2">
          <span aria-hidden className="min-w-0 truncate text-bf-danger" title={error}>
            {error}
          </span>
          {errorAction && (
            <Button variant="secondary" size="sm" className="shrink-0" onClick={errorAction.onClick}>
              {errorAction.label}
            </Button>
          )}
        </span>
      ) : hover ? (
        <span
          aria-hidden
          data-testid="montage-footer-text"
          className="min-w-0 flex-1 truncate font-mono tabular-nums text-bf-text-secondary"
          title={hover}
        >
          {hover}
        </span>
      ) : (
        <span className="min-w-0 flex-1" />
      )}
      {page && page.count > 1 && (
        <Pager
          label={page.label ?? 'Subjects'}
          noun="page"
          showNoun
          page={page.page}
          count={page.count}
          onPageChange={page.onPage}
        />
      )}
      <StudioPopover
        label={`Colour scale, ${range}: limits and Fit`}
        placement="above"
        testId="montage-scale-popover"
        panelClassName="w-auto"
        summaryClassName="inline-flex h-6 items-center gap-1.5 rounded-sm px-1 font-mono text-bf-2xs tabular-nums text-bf-text-secondary hover:bg-accent hover:text-foreground"
        summary={
          <PopulationScaleStrip
            clipped={
              shownLimit === null ? null : scaleClipping(dataRange, -shownLimit, shownLimit)
            }
            limit={shownLimit}
            unit={unit}
            range={range}
            format={limitDisplay}
          />
        }
      >
        <div role="group" aria-label="Colour scale" className="flex flex-col gap-2">
          <div className="flex items-center gap-2">
            <LimitField
              label="Lower limit"
              sign={-1}
              limit={shownLimit}
              disabled={limit === null}
              onLimit={onLimit}
            />
            <Slider
              className="w-32 shrink-0"
              label="Colour scale limit"
              min={top / 200}
              max={top}
              step={top / 200}
              fill={false}
              disabled={limit === null}
              value={Math.min(top, Math.max(top / 200, shownLimit ?? top))}
              valueText={(v) => `plus or minus ${limitText(v)}`}
              onValueChange={(v) => setPending({ value: v, releasedFrom: undefined })}
              onValueCommit={(v) => {
                setPending({ value: v, releasedFrom: limit });
                onLimit(v);
              }}
            />
            <LimitField
              label="Upper limit"
              sign={1}
              limit={shownLimit}
              disabled={limit === null}
              onLimit={onLimit}
            />
            <Button
              variant="ghost"
              size="sm"
              aria-label="Fit scale to the data"
              disabled={!onFit}
              onClick={onFit}
            >
              Fit
            </Button>
          </div>
          {summaryLimit ? (
            <label className="flex items-center gap-2 text-bf-xs text-muted-foreground">
              Summary maximum
              <NumberField
                aria-label="Population summary scale maximum"
                title="The summary uses its own scale: its maximum"
                fieldClassName="w-20 shrink-0"
                min="0.000001"
                step="any"
                value={summaryLimit.value}
                onChange={(event) => summaryLimit.onChange(event.target.valueAsNumber)}
              />
            </label>
          ) : null}
          <p className="m-0 text-bf-xs text-muted-foreground" data-testid="montage-scale-threshold">
            {hiddenBelow === null
              ? 'No maps yet.'
              : `Values between ${limitDisplay(-hiddenBelow)} and ${limitDisplay(hiddenBelow)} are not drawn (the notch).`}
            {unit ? ` Unit: ${unit}.` : ''}
          </p>
        </div>
      </StudioPopover>
    </div>
  );
}
