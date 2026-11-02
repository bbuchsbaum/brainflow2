/**
 * Findings, the second tab of the left stack while the BIDS browser is in
 * front. Its own React root: every value comes from the store's one model.
 */
import React, { useCallback, useState } from 'react';
import { Button, SelectableRow } from '@/components/ui/bf';
import { getEventBus } from '@/events/EventBus';
import { copyLensList, selectBidsModel, useBidsModel, useBidsStore } from '@/stores/bidsStore';
import {
  EXCLUDED_MEAN_NOTE,
  entityRunIds,
  exclusionLens,
  type BidsCensorOffer,
  type BidsFindingGroupId,
  type BidsFindingItem,
  type BidsFindingRule,
} from '@/stores/bidsModel';
import { cn } from '@/utils/cn';

function Glyph({ group }: { group: BidsFindingGroupId }) {
  const base = 'mt-[3px] inline-block h-2.5 w-2.5 shrink-0';
  switch (group) {
    case 'saved':
      return <i aria-hidden className={cn(base, 'scale-75 rotate-45 border border-bf-text-muted')} />;
    case 'errors':
      return (
        <svg aria-hidden width="10" height="10" viewBox="0 0 10 10" className="mt-[3px] shrink-0">
          <rect width="10" height="10" fill="var(--bf-danger)" />
          <path d="M2.5 2.5l5 5M7.5 2.5l-5 5" stroke="var(--bf-text-inverse)" strokeWidth="1.4" />
        </svg>
      );
    case 'content':
      return <i aria-hidden className={cn(base, 'bg-bf-warning')} />;
    case 'variants':
      return <i aria-hidden className={cn(base, 'border border-bf-text-faint')} />;
    case 'quality':
      return <i aria-hidden className={cn(base, 'scale-75 rounded-full bg-bf-text-primary')} />;
    case 'notes':
      return <i aria-hidden className={cn(base, 'scale-50 rounded-full bg-bf-text-faint')} />;
    default:
      return <i aria-hidden className={cn(base, 'scale-75 border border-bf-text-faint')} />;
  }
}

const TAG_LABEL: Record<string, string> = { validator: 'validator', content: 'brainflow check' };

function FindingRow({
  item,
  selected,
  onActivate,
}: {
  item: BidsFindingItem;
  selected: boolean;
  onActivate: (item: BidsFindingItem) => void;
}) {
  const tag = TAG_LABEL[item.tag];
  const body = (
    <>
      <Glyph group={item.group} />
      <span className="min-w-0 whitespace-normal break-words text-bf-sm text-bf-text-secondary">
        {item.title}
        <span className="block font-mono text-bf-2xs text-bf-text-faint">
          {item.entity}
          {tag ? ` · ${tag}` : ''}
        </span>
        {item.source ? (
          <span className="block font-mono text-bf-2xs text-bf-text-faint">{item.source}</span>
        ) : null}
        {selected && item.detail ? (
          <span className="mt-0.5 block text-bf-xs text-bf-text-muted">{item.detail}</span>
        ) : null}
      </span>
    </>
  );
  if (!item.lens) {
    return (
      <div className="flex gap-2 py-1 pl-3 pr-2" data-testid="bids-finding-row">
        {body}
      </div>
    );
  }
  return (
    <SelectableRow
      role="button"
      selected={selected}
      onSelect={() => onActivate(item)}
      data-testid="bids-finding-row"
      data-finding={item.id}
      className="!h-auto min-h-0 items-start gap-2 py-1 pl-3 pr-2"
    >
      {body}
    </SelectableRow>
  );
}

/** Participant and session first; the rule is on the line above. */
function EntityRow({
  item,
  selected,
  onActivate,
}: {
  item: BidsFindingItem;
  selected: boolean;
  onActivate: (item: BidsFindingItem) => void;
}) {
  return (
    <SelectableRow
      role="button"
      selected={selected}
      onSelect={() => onActivate(item)}
      data-testid="bids-finding-entity"
      data-finding={item.id}
      className="!h-auto min-h-0 gap-2 py-0.5 pl-7 pr-2 font-mono text-bf-2xs text-bf-text-muted"
    >
      {item.entity}
      {item.value ? ` · ${item.value}` : ''}
    </SelectableRow>
  );
}

/** One line for one fact about many entities: the rule, its count, and the entities on request. */
function RuleRow({
  rule,
  group,
  lensId,
  onActivate,
}: {
  rule: BidsFindingRule;
  group: BidsFindingGroupId;
  lensId: string | null;
  onActivate: (lens: BidsFindingItem['lens']) => void;
}) {
  const [open, setOpen] = useState(false);
  const label = `${rule.items.length} ${rule.items[0].kind ? 'sessions' : 'entries'}`;
  return (
    <div data-testid="bids-finding-rule" data-rule={rule.id}>
      <div className="flex items-start">
        <SelectableRow
          role="button"
          selected={rule.lens !== null && rule.lens.id === lensId}
          onSelect={() => onActivate(rule.lens)}
          className="!h-auto min-h-0 min-w-0 flex-1 items-start gap-2 py-1 pl-3 pr-1"
        >
          <Glyph group={group} />
          <span className="min-w-0 whitespace-normal break-words text-bf-sm text-bf-text-secondary">
            {rule.title}
            <span className="block font-mono text-bf-2xs text-bf-text-faint">{label}</span>
            {rule.source ? (
              <span className="block font-mono text-bf-2xs text-bf-text-faint">{rule.source}</span>
            ) : null}
          </span>
        </SelectableRow>
        <button
          type="button"
          aria-expanded={open}
          aria-label={`${open ? 'Hide' : 'Show'} ${label}: ${rule.title}`}
          onClick={() => setOpen(!open)}
          className="mr-1 mt-1 h-5 w-5 shrink-0 cursor-pointer text-bf-xs text-bf-text-faint hover:text-bf-text-primary focus-visible:outline focus-visible:outline-1 focus-visible:outline-bf-accent"
        >
          {open ? '−' : '+'}
        </button>
      </div>
      {open
        ? rule.items.map((item) => (
            <EntityRow
              key={item.id}
              item={item}
              selected={item.lens !== null && item.lens.id === lensId}
              onActivate={(chosen) => onActivate(chosen.lens)}
            />
          ))
        : null}
    </div>
  );
}

function SavedRow({
  item,
  selected,
  onActivate,
}: {
  item: BidsFindingItem;
  selected: boolean;
  onActivate: (item: BidsFindingItem) => void;
}) {
  const deleteSavedLens = useBidsStore((state) => state.deleteSavedLens);
  return (
    <SelectableRow
      role="row"
      selected={selected}
      onSelect={() => onActivate(item)}
      data-testid="bids-saved-lens"
      className="!h-auto min-h-0 items-start gap-2 py-1 pl-3 pr-2"
    >
      <Glyph group="saved" />
      <span className="min-w-0 flex-1 whitespace-normal break-words text-bf-sm text-bf-text-secondary">
        {item.title}
        <span className="block font-mono text-bf-2xs text-bf-text-faint">{item.entity}</span>
      </span>
      <Button
        variant="ghost"
        size="sm"
        aria-label={`Delete saved lens ${item.title}`}
        onClick={() => deleteSavedLens(item.lens?.id ?? '')}
      >
        ✕
      </Button>
    </SelectableRow>
  );
}

function ExcludedRow({ item }: { item: BidsFindingItem }) {
  const review = useCallback(() => {
    const state = useBidsStore.getState();
    const model = selectBidsModel(state);
    const entity = item.exclusion?.entity ?? '';
    state.setLens(exclusionLens(model, entity));
    const first = entityRunIds(model, entity)[0];
    if (first) state.selectRun(first);
  }, [item.exclusion?.entity]);
  const revert = useCallback(() => {
    const row = item.exclusion;
    if (!row) return;
    const { entity, criterion } = row;
    useBidsStore
      .getState()
      .revertExclusions([{ entity, criterion }])
      .catch((error: unknown) => {
        getEventBus().emit('ui.notification', {
          type: 'error',
          message: `Could not revert ${entity}: ${error instanceof Error ? error.message : String(error)}`,
        });
      });
  }, [item.exclusion]);
  return (
    <div className="flex gap-2 py-1 pl-3 pr-2" data-testid="bids-excluded-row">
      <Glyph group="excluded" />
      <span className="min-w-0 whitespace-normal break-words text-bf-sm text-bf-text-secondary">
        <span className="line-through decoration-bf-text-faint">{item.title}</span>
        <span className="block font-mono text-bf-2xs text-bf-text-faint">{item.entity}</span>
        <span className="mt-0.5 flex gap-2">
          <Button variant="link" size="sm" onClick={review} aria-label={`Review ${item.title}`}>
            Review
          </Button>
          <Button variant="link" size="sm" onClick={revert} aria-label={`Revert ${item.title}`}>
            Revert
          </Button>
        </span>
      </span>
    </div>
  );
}

function CensorOffer({ offer }: { offer: BidsCensorOffer }) {
  const active = useBidsStore(
    (state) =>
      state.censor?.lineMm === offer.lineMm && state.censor.maxFraction === offer.maxFraction,
  );
  const setCensor = useBidsStore((state) => state.setCensor);
  return (
    <button
      type="button"
      aria-pressed={active}
      data-testid="bids-censor-offer"
      onClick={() =>
        setCensor(active ? null : { lineMm: offer.lineMm, maxFraction: offer.maxFraction })
      }
      className={cn(
        'block w-full cursor-pointer whitespace-normal px-3 py-0.5 text-left text-bf-xs',
        'focus-visible:outline focus-visible:outline-1 focus-visible:outline-bf-accent',
        active ? 'text-bf-text-primary' : 'text-bf-text-muted hover:text-bf-text-primary',
      )}
    >
      {active ? '✓ ' : ''}
      Over {Math.round(offer.maxFraction * 100)}% of frames above {offer.lineMm} mm:{' '}
      <span className="font-mono">
        {offer.runsOver} of {offer.ofRuns}
      </span>{' '}
      runs
    </button>
  );
}

export function BidsFindingsPanel() {
  const model = useBidsModel();
  const lensId = useBidsStore((state) => state.lens?.id ?? null);
  const setLens = useBidsStore((state) => state.setLens);
  const activateLens = useCallback(
    (lens: BidsFindingItem['lens']) => {
      if (lens) setLens(lens.id === lensId ? null : lens);
    },
    [lensId, setLens],
  );
  const activate = useCallback((item: BidsFindingItem) => activateLens(item.lens), [activateLens]);
  const lensExport = useCallback(() => {
    copyLensList();
  }, []);

  if (!model.index) {
    return (
      <div className="flex h-full items-center justify-center px-3 text-center text-bf-sm text-bf-text-muted">
        Open a BIDS dataset to see its findings.
      </div>
    );
  }

  return (
    <div
      className="h-full overflow-y-auto bg-background pb-2"
      data-testid="bids-findings"
      aria-label="Findings"
      role="region"
    >
      {model.status.soFar ? (
        <p className="m-0 px-3 pt-2 text-bf-xs text-bf-text-faint">
          So far: findings update until the scan completes.
        </p>
      ) : null}
      {model.findings.groups.map((group) => {
        const offers = group.id === 'quality' ? model.censorOffers : [];
        if (group.items.length === 0 && offers.length === 0) return null;
        return (
          <section key={group.id} aria-label={group.label}>
            <h3 className="m-0 flex items-center justify-between px-3 pb-1 pt-3 text-bf-xs font-normal text-bf-text-faint">
              <span>{group.label}</span>
              <span className="text-bf-2xs" data-testid={`bids-findings-count-${group.id}`}>
                {group.items.length}
              </span>
            </h3>
            {group.rules.map((rule) => {
              const item = rule.items[0];
              if (rule.items.length > 1) {
                return <RuleRow key={rule.id} rule={rule} group={group.id} lensId={lensId} onActivate={activateLens} />;
              }
              if (group.id === 'excluded') return <ExcludedRow key={item.id} item={item} />;
              const selected = item.lens !== null && item.lens.id === lensId;
              return group.id === 'saved' ? (
                <SavedRow key={item.id} item={item} selected={selected} onActivate={activate} />
              ) : (
                <FindingRow key={item.id} item={item} selected={selected} onActivate={activate} />
              );
            })}
            {offers.length ? (
              <div className="mt-1" aria-label="Censoring-fraction criteria">
                {offers.map((offer) => (
                  <CensorOffer key={offer.lineMm} offer={offer} />
                ))}
                <p className="m-0 px-3 pt-0.5 text-bf-2xs text-bf-text-faint">
                  Beside mean FD, {model.fdThreshold} mm. Session means: {EXCLUDED_MEAN_NOTE}.
                </p>
              </div>
            ) : null}
            {group.id === 'saved' && lensId ? (
              <div className="px-3 pt-1">
                <Button variant="link" size="sm" onClick={lensExport}>
                  Copy lens list (TSV)
                </Button>
              </div>
            ) : null}
          </section>
        );
      })}
    </div>
  );
}
