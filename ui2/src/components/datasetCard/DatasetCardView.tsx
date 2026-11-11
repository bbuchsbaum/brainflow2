import React, { useId, useState } from 'react';
import { VscChevronDown, VscChevronRight } from 'react-icons/vsc';
import type { DatasetCard } from '@brainflow/api';
import { Button, Chip, FOCUS_RING } from '@/components/ui/bf';
import { RemoteReconnectButton } from '@/components/ui/RemoteReconnectButton';
import { AnalysesTable } from './AnalysesTable';
import { cn } from '@/utils/cn';
import {
  CardBody,
  CardFooter,
  CardHeader,
  CardSection,
  Facts,
  MONO,
  NOTE,
  RawJson,
  Spoken,
  type Fact,
} from './cardParts';
import { ReadmeText } from './ReadmeText';
import {
  baseName,
  containerLabel,
  contentTotals,
  countSpoken,
  countText,
  datasetCardTitle,
  datasetTypeLabel,
  kindCount,
  plural,
  present,
  prettyJson,
  showsAsCollection,
  sourcesDetail,
  sourcesLabel,
} from './datasetCardFormat';

export interface DatasetCardViewProps {
  card: DatasetCard;
  /** The path as the user knows it (remote origin for a mounted folder). */
  displayPath: string;
  titleId: string;
  /** Whether "Open as set" can take a folder of this tree. */
  canOpenAsSet: boolean;
  /**
   * What the folder's marker says about analyses below it (see
   * `collectionHint`): it chooses the layout until the folder is counted.
   */
  collectionHint?: boolean | null;
  /**
   * The descriptions are here and the folder is still being counted: every
   * area that shows a count waits quietly.
   */
  countsPending?: boolean;
  /** Counting failed; the descriptions stay on show. */
  countsError?: string | null;
  /**
   * Counting failed on a dropped remote connection: the folder's path, whose
   * mount Reconnect signs in to again.
   */
  countsReconnectPath?: string | null;
  onRetryCounts?: () => void;
  /** Title of the collection this analysis was opened from, when there is one. */
  backLabel?: string | null;
  onBack?: () => void;
  onShowAnalysis: (path: string) => void;
  onOpenAsSet: (path: string) => void;
  onRefresh: () => void;
  onClose: () => void;
}

function List({ items, mono = false }: { items: string[]; mono?: boolean }) {
  return (
    <span className="flex flex-col gap-0.5">
      {items.map((item, index) => (
        <span key={`${index}:${item}`} className={mono ? MONO : undefined}>
          {item}
        </span>
      ))}
    </span>
  );
}

/** What stands where counts will be, or why they are not there. */
function CountsState({
  pending,
  error,
  onRetry,
  reconnectPath,
  what,
}: {
  pending: boolean;
  error: string | null;
  onRetry?: () => void;
  reconnectPath?: string | null;
  what: string;
}) {
  if (error) {
    return (
      <p className={cn(NOTE, 'flex flex-wrap items-center gap-2')} data-testid="counts-error">
        <span>
          {what} could not be counted: {error}
        </span>
        {reconnectPath ? (
          <RemoteReconnectButton path={reconnectPath} testId="dataset-card-counts-reconnect" />
        ) : null}
        {onRetry ? (
          <Button variant="secondary" size="sm" onClick={onRetry}>
            Count again
          </Button>
        ) : null}
      </p>
    );
  }
  if (!pending) return null;
  return (
    <p role="status" className={cn(NOTE, 'text-bf-text-faint')} data-testid="counts-pending">
      Counting {what.toLowerCase()}…
    </p>
  );
}

function TruncatedNote({ card }: { card: DatasetCard }) {
  const { contents } = card;
  if (!contents.truncated) return null;
  return (
    <p className={NOTE} data-testid="contents-truncated">
      The folder was not counted in full, so every number is a lower bound
      {contents.truncatedReason ? `: ${contents.truncatedReason}` : '.'}
    </p>
  );
}

const KIND_GRID = 'grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-x-4';

function ContentsSection({
  card,
  countsPending,
  countsError,
  countsReconnectPath,
  onRetryCounts,
}: Pick<
  DatasetCardViewProps,
  'card' | 'countsPending' | 'countsError' | 'countsReconnectPath' | 'onRetryCounts'
>) {
  const { contents } = card;
  if (countsPending || countsError) {
    return (
      <CardSection title="What is in the folder">
        <CountsState
          pending={Boolean(countsPending)}
          error={countsError ?? null}
          onRetry={onRetryCounts}
          reconnectPath={countsReconnectPath}
          what="Subjects and images"
        />
      </CardSection>
    );
  }
  const totals = contentTotals(contents);
  const totalsSpoken = totals.map((total) => total.spoken).join(', ');
  // One total that reads as it is written needs no second, spoken copy.
  const totalsAsWritten = totals.length === 1 && totals[0].text === totalsSpoken;
  const more = contents.imageKindCount - contents.imageKinds.length;
  const facts = present<Fact>([
    contents.spaces.length > 0
      ? { label: 'Space', value: contents.spaces.join(', '), mono: true }
      : null,
    contents.tasks.length > 0
      ? { label: 'Tasks', value: contents.tasks.join(', '), mono: true }
      : null,
  ]);
  return (
    <CardSection title="What is in the folder">
      <p
        data-testid="content-totals"
        className="m-0 text-bf-md leading-5 tabular-nums text-bf-text-primary"
      >
        {totals.map((total, index) => (
          <React.Fragment key={total.key}>
            {index > 0 ? (
              <span aria-hidden="true" className="text-bf-text-faint">
                {' '}
                ·{' '}
              </span>
            ) : null}
            <span data-count={total.key} aria-hidden={totalsAsWritten ? undefined : 'true'}>
              {total.text}
            </span>
          </React.Fragment>
        ))}
        {totalsAsWritten ? null : (
          <span className="sr-only" data-testid="content-totals-spoken">
            {totalsSpoken}
          </span>
        )}
      </p>
      {contents.imageKinds.length > 0 ? (
        <div
          role="table"
          aria-label="Image kinds"
          className="flex flex-col rounded-sm border border-bf-border-subtle"
        >
          <div role="rowgroup">
            <div
              role="row"
              className={cn(
                KIND_GRID,
                'border-b border-bf-border-subtle bg-bf-bg-panel px-2 py-1 text-bf-xs leading-4 text-bf-text-muted',
              )}
            >
              <span role="columnheader">Image kind</span>
              <span role="columnheader" className="text-right">
                Images
              </span>
            </div>
          </div>
          <div role="rowgroup">
            {contents.imageKinds.map((kind) => {
              const count = kindCount(kind, contents);
              return (
                <div
                  key={kind.path}
                  role="row"
                  data-kind={kind.path}
                  data-complete={count.missing === 0}
                  className={cn(KIND_GRID, 'px-2 py-0.5')}
                >
                  <span role="cell" className={cn(MONO, 'min-w-0 [overflow-wrap:anywhere]')}>
                    {kind.path}
                  </span>
                  <span
                    role="cell"
                    aria-label={count.spoken}
                    className={cn(
                      MONO,
                      'whitespace-nowrap text-right tabular-nums',
                      // Form, not hue: an incomplete kind is set heavier and says how many.
                      count.missing > 0
                        ? 'font-semibold text-bf-text-primary'
                        : 'text-bf-text-secondary',
                    )}
                  >
                    {count.text}
                    {count.missing > 0 ? (
                      <span className="font-normal text-bf-text-muted">
                        {' '}
                        · {count.missing} missing
                      </span>
                    ) : null}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      ) : null}
      {more > 0 ? (
        <p className={NOTE}>
          and {more} more {plural(more, 'kind')}
        </p>
      ) : null}
      <Facts facts={facts} />
      <TruncatedNote card={card} />
      <p className={NOTE}>Counted from the file listing.</p>
    </CardSection>
  );
}

function GeneratedBySection({ card }: { card: DatasetCard }) {
  const description = card.description;
  if (!description) return null;
  const pipelines = description.generatedBy.filter(
    (entry) => entry.name || entry.version || entry.description || entry.codeUrl || entry.container,
  );
  const sources = description.sourceDatasets
    .map((source) => [source.url, source.doi, source.version].filter(Boolean).join(' · '))
    .filter((text) => text.length > 0);
  if (pipelines.length === 0 && sources.length === 0) return null;
  return (
    <CardSection title="Generated by">
      {pipelines.map((entry, index) => (
        <Facts
          key={`${index}:${entry.name ?? ''}`}
          facts={present<Fact>([
            entry.name || entry.version
              ? {
                  label: 'Pipeline',
                  value: (
                    <>
                      {entry.name}
                      {entry.version ? (
                        <>
                          {entry.name ? ' ' : null}
                          <span className={cn(MONO, 'text-bf-text-secondary')}>
                            {entry.version}
                          </span>
                        </>
                      ) : null}
                    </>
                  ),
                }
              : null,
            entry.description ? { label: 'Description', value: entry.description } : null,
            containerLabel(entry.container)
              ? { label: 'Container', value: containerLabel(entry.container), mono: true }
              : null,
            entry.codeUrl ? { label: 'Code', value: entry.codeUrl, mono: true } : null,
          ])}
        />
      ))}
      <Facts
        facts={
          sources.length > 0 ? [{ label: 'Source data', value: <List items={sources} mono /> }] : []
        }
      />
    </CardSection>
  );
}

function peopleFacts(card: DatasetCard, withLicense: boolean): Fact[] {
  const d = card.description;
  if (!d) return [];
  return present<Fact>([
    d.authors.length > 0 ? { label: 'Authors', value: d.authors.join(', ') } : null,
    withLicense && d.license ? { label: 'License', value: d.license } : null,
    d.funding.length > 0 ? { label: 'Funding', value: <List items={d.funding} /> } : null,
    d.datasetDoi ? { label: 'DOI', value: d.datasetDoi, mono: true } : null,
    d.acknowledgements ? { label: 'Thanks', value: d.acknowledgements } : null,
    d.howToAcknowledge ? { label: 'How to cite', value: d.howToAcknowledge } : null,
    d.ethicsApprovals.length > 0
      ? { label: 'Ethics', value: <List items={d.ethicsApprovals} /> }
      : null,
    d.referencesAndLinks.length > 0
      ? { label: 'References', value: <List items={d.referencesAndLinks} /> }
      : null,
    d.hedVersion.length > 0 ? { label: 'HED', value: d.hedVersion.join(', '), mono: true } : null,
  ]);
}

function ReadmeSection({ card }: { card: DatasetCard }) {
  const readme = card.readme;
  if (!readme || !readme.text.trim()) return null;
  return (
    <CardSection title="Readme" aside={<span className={MONO}>{readme.fileName}</span>} divided>
      <ReadmeText fileName={readme.fileName} text={readme.text} />
      {readme.truncated ? (
        <p className={NOTE}>The file is longer than the part shown here.</p>
      ) : null}
    </CardSection>
  );
}

function OtherFields({ card }: { card: DatasetCard }) {
  const fields = card.description?.otherFields ?? [];
  const [open, setOpen] = useState(false);
  const listId = useId();
  if (fields.length === 0) return null;
  return (
    <section className="border-t border-bf-border-subtle pt-3">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={listId}
        onClick={() => setOpen((value) => !value)}
        className={cn(
          'flex h-7 w-full items-center gap-1.5 rounded-sm border-0 bg-transparent p-0 text-left text-bf-sm text-bf-text-secondary hover:text-bf-text-primary',
          FOCUS_RING,
        )}
      >
        <span aria-hidden className="flex text-bf-text-muted">
          {open ? <VscChevronDown /> : <VscChevronRight />}
        </span>
        <span className="grow">Other fields</span>
        <span className={cn(MONO, 'text-bf-text-muted')}>
          <Spoken
            text={String(fields.length)}
            spoken={`${fields.length} ${plural(fields.length, 'field')}`}
          />
        </span>
      </button>
      {open ? (
        <dl id={listId} className="m-0 mt-2 flex flex-col gap-1.5">
          {fields.map((field) => (
            <div key={field.key} className="flex min-w-0 flex-col">
              <dt className={cn(MONO, 'text-bf-text-secondary')}>{field.key}</dt>
              <dd className={cn(MONO, 'm-0 text-bf-text-primary [overflow-wrap:anywhere]')}>
                {field.value}
                {field.truncated ? (
                  <span className="font-sans text-bf-text-muted"> (cut short)</span>
                ) : null}
              </dd>
            </div>
          ))}
        </dl>
      ) : null}
    </section>
  );
}

function AnalysesSection({
  card,
  countsPending,
  countsError,
  onShowAnalysis,
}: Pick<DatasetCardViewProps, 'card' | 'countsPending' | 'countsError' | 'onShowAnalysis'>) {
  const place = baseName(card.analysesPath ?? card.path) || card.folderName;
  const count = card.analyses.length;
  // Before the count, only the described folders are known: the full card
  // may find more by their subject folders.
  const floor = card.analysesTruncated || Boolean(countsPending || countsError);
  return (
    <CardSection
      title={`Analyses in ${place}`}
      aside={
        <span className={cn(MONO, 'tabular-nums')}>
          <Spoken
            text={countText(count, floor)}
            spoken={countSpoken(count, floor, 'analysis', 'analyses')}
          />
        </span>
      }
    >
      <AnalysesTable
        analyses={card.analyses}
        label={`Analyses in ${place}`}
        countsPending={Boolean(countsPending)}
        countsMissing={Boolean(countsError)}
        onOpen={onShowAnalysis}
      />
      <p className={NOTE}>
        Select an analysis to open its card. Subject counts come from the folder listing.
        {card.analysesTruncated ? ' More folders exist than are listed here.' : ''}
      </p>
    </CardSection>
  );
}

/**
 * The card of one folder. A folder with child analyses is a collection: the
 * analyses table comes first and the folder's own facts follow.
 */
export function DatasetCardView({
  card,
  displayPath,
  titleId,
  canOpenAsSet,
  collectionHint = null,
  countsPending = false,
  countsError = null,
  countsReconnectPath = null,
  onRetryCounts,
  backLabel,
  onBack,
  onShowAnalysis,
  onOpenAsSet,
  onRefresh,
  onClose,
}: DatasetCardViewProps) {
  const [showRaw, setShowRaw] = useState(false);
  const rawId = useId();
  const description = card.description;
  const { contents } = card;
  const counted = !countsPending && !countsError;
  const isCollection = showsAsCollection(card.analyses.length, counted, collectionHint);
  const typeLabel = datasetTypeLabel(description?.datasetType);
  const sources = sourcesLabel(card.sourcePaths);

  const chips = [
    typeLabel ? <Chip key="type">{typeLabel}</Chip> : null,
    description?.bidsVersion ? <Chip key="bids">BIDS {description.bidsVersion}</Chip> : null,
    !isCollection && description?.license ? <Chip key="license">{description.license}</Chip> : null,
    // Subjects of the folder itself, on a collection that is also a dataset.
    // A folder that only holds analyses has none of its own to announce:
    // stray `sub-*` folders beside `derivatives/` are not its subject count.
    isCollection && card.hasDescription && counted && contents.subjectCount > 0 ? (
      <Chip
        key="subjects"
        title={`${countText(contents.subjectCount, contents.truncated)} ${plural(contents.subjectCount, 'subject')}`}
      >
        <Spoken
          text={`${countText(contents.subjectCount, contents.truncated)} ${plural(contents.subjectCount, 'subject')}`}
          spoken={countSpoken(contents.subjectCount, contents.truncated, 'subject')}
        />
      </Chip>
    ) : null,
  ].filter(Boolean);

  const collectionFacts = present<Fact>([
    counted && contents.tasks.length > 0
      ? { label: 'Tasks', value: contents.tasks.join(', '), mono: true }
      : null,
    counted && contents.sessionCount > 0
      ? {
          label: 'Sessions',
          value: (
            <Spoken
              text={countText(contents.sessionCount, contents.truncated)}
              spoken={countSpoken(contents.sessionCount, contents.truncated, 'session')}
            />
          ),
          mono: true,
        }
      : null,
    counted && contents.spaces.length > 0
      ? { label: 'Space', value: contents.spaces.join(', '), mono: true }
      : null,
    ...peopleFacts(card, true),
  ]);
  const people = peopleFacts(card, false);

  return (
    <>
      <CardHeader
        title={datasetCardTitle(card)}
        titleId={titleId}
        path={displayPath}
        chips={chips.length > 0 ? chips : null}
        backLabel={backLabel}
        onBack={onBack}
        onRefresh={onRefresh}
        refreshLabel="Count the folder again"
        onClose={onClose}
      />
      <CardBody>
        {showRaw && card.descriptionRaw !== null ? (
          <RawJson
            id={rawId}
            text={prettyJson(card.descriptionRaw, card.descriptionRawTruncated)}
            what="Description JSON"
            truncatedNote={
              card.descriptionRawTruncated ? 'The file is longer than the part shown here.' : null
            }
          />
        ) : null}
        {!card.hasDescription ? (
          <p className={NOTE}>This folder has no dataset_description.json.</p>
        ) : null}
        {card.descriptionIssue ? (
          <p className={NOTE} data-testid="description-issue">
            The description file could not be read in full: {card.descriptionIssue}
          </p>
        ) : null}
        {description?.description ? (
          <p className="m-0 text-bf-md leading-5 text-bf-text-primary [overflow-wrap:anywhere]">
            {description.description}
          </p>
        ) : null}
        {isCollection ? (
          <>
            <AnalysesSection
              card={card}
              countsPending={countsPending}
              countsError={countsError}
              onShowAnalysis={onShowAnalysis}
            />
            {collectionFacts.length > 0 || !counted || contents.truncated ? (
              <CardSection title="This dataset">
                <Facts facts={collectionFacts} />
                <CountsState
                  pending={countsPending}
                  error={countsError}
                  onRetry={onRetryCounts}
                  reconnectPath={countsReconnectPath}
                  what="This folder"
                />
                {counted ? <TruncatedNote card={card} /> : null}
              </CardSection>
            ) : null}
          </>
        ) : (
          <>
            <ContentsSection
              card={card}
              countsPending={countsPending}
              countsError={countsError}
              countsReconnectPath={countsReconnectPath}
              onRetryCounts={onRetryCounts}
            />
            <GeneratedBySection card={card} />
            {people.length > 0 ? (
              <CardSection title="People">
                <Facts facts={people} />
              </CardSection>
            ) : null}
          </>
        )}
        <ReadmeSection card={card} />
        <OtherFields card={card} />
      </CardBody>
      <CardFooter
        note={
          sources ? (
            <span title={sourcesDetail(card.path, card.sourcePaths)}>Read from {sources}</span>
          ) : null
        }
      >
        {card.descriptionRaw !== null ? (
          <Button
            variant="secondary"
            size="md"
            aria-expanded={showRaw}
            aria-controls={showRaw ? rawId : undefined}
            onClick={() => setShowRaw((value) => !value)}
          >
            {showRaw ? 'Hide raw JSON' : 'Show raw JSON'}
          </Button>
        ) : null}
        {/* A folder of analyses is not offered as a set. Before the count,
            only the marker can say the folder holds none; without that the
            offer waits, so it never appears and then goes away. */}
        {!isCollection && canOpenAsSet && (counted || collectionHint === false) ? (
          <Button variant="primary" size="md" onClick={() => onOpenAsSet(card.path)}>
            Open as set
          </Button>
        ) : null}
      </CardFooter>
    </>
  );
}
