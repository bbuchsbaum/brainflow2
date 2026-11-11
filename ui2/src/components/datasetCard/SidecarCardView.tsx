import React, { useId, useState } from 'react';
import type { SidecarCard, SidecarEntry } from '@brainflow/api';
import { Button } from '@/components/ui/bf';
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
  type Fact,
} from './cardParts';
import {
  SIDECAR_LEVEL_BORDER,
  SIDECAR_LEVEL_LABEL,
  baseName,
  dirName,
  gridLabel,
  plural,
  present,
  relativeTo,
  seriesLabel,
  sidecarEntriesJson,
  sidecarValueDisplay,
} from './datasetCardFormat';

export interface SidecarCardViewProps {
  card: SidecarCard;
  rootPath: string;
  titleId: string;
  onRefresh: () => void;
  onClose: () => void;
}

/** The image's folder, from its dataset's folder down when one is known. */
function folderLabel(card: SidecarCard, rootPath: string): string | null {
  const folder = dirName(card.path);
  if (!folder) return null;
  for (const base of [card.datasetRoot, rootPath]) {
    if (!base) continue;
    const relative = relativeTo(base, folder);
    if (relative !== null) return relative ? `${baseName(base)}/${relative}` : baseName(base);
  }
  return folder;
}

/** A sidecar file as the tag names it: below the dataset when it can be. */
function sourceLabel(path: string, card: SidecarCard, rootPath: string): string {
  for (const base of [card.datasetRoot, rootPath]) {
    if (!base) continue;
    const relative = relativeTo(base, path);
    if (relative) return relative;
  }
  return path;
}

const BORDER_CLASS = {
  solid: 'border-solid text-bf-text-primary',
  dashed: 'border-dashed text-bf-text-secondary',
  dotted: 'border-dotted text-bf-text-secondary',
} as const;

function LevelTag({
  entry,
  card,
  rootPath,
}: {
  entry: SidecarEntry;
  card: SidecarCard;
  rootPath: string;
}) {
  const label = SIDECAR_LEVEL_LABEL[entry.sourceLevel];
  const source = sourceLabel(entry.sourcePath, card, rootPath);
  const replaced = entry.overriddenPaths.map((path) => sourceLabel(path, card, rootPath));
  const detail =
    replaced.length > 0
      ? `Set in ${source}\nReplaces the value in ${replaced.join(', ')}`
      : `Set in ${source}`;
  return (
    <span
      data-level={entry.sourceLevel}
      title={detail}
      className={cn(
        'justify-self-start whitespace-nowrap rounded-sm border border-bf-border-field px-1.5 text-bf-xs leading-4',
        BORDER_CLASS[SIDECAR_LEVEL_BORDER[entry.sourceLevel]],
      )}
    >
      {label}
      <span className="sr-only">
        {' '}
        level, set in {source}
        {replaced.length > 0 ? `, replaces the value in ${replaced.join(', ')}` : ''}
      </span>
    </span>
  );
}

export function SidecarCardView({
  card,
  rootPath,
  titleId,
  onRefresh,
  onClose,
}: SidecarCardViewProps) {
  const [showRaw, setShowRaw] = useState(false);
  const rawId = useId();
  const header = card.header;
  const imageFacts = header
    ? present<Fact>([
        gridLabel(header) ? { label: 'Grid', value: gridLabel(header), mono: true } : null,
        seriesLabel(header) ? { label: 'Series', value: seriesLabel(header), mono: true } : null,
        header.datatype ? { label: 'Data type', value: header.datatype, mono: true } : null,
      ])
    : [];
  const fileCount = card.sidecarPaths.length;

  return (
    <>
      <CardHeader
        title={card.fileName}
        monoTitle
        titleId={titleId}
        path={folderLabel(card, rootPath)}
        onRefresh={onRefresh}
        onClose={onClose}
      />
      <CardBody>
        {showRaw ? (
          <RawJson
            id={rawId}
            text={sidecarEntriesJson(card.entries)}
            what="Sidecar JSON"
            truncatedNote={
              card.entries.some((entry) => entry.valueTruncated)
                ? 'Long values are cut short here and are shown as text.'
                : null
            }
          />
        ) : null}
        {header || card.headerIssue ? (
          <CardSection title="Image">
            <Facts facts={imageFacts} wide />
            <p className={NOTE}>{header ? 'Read from the image header.' : card.headerIssue}</p>
          </CardSection>
        ) : null}
        <CardSection
          title="Sidecar metadata"
          aside={
            fileCount > 0 ? `merged from ${fileCount} ${plural(fileCount, 'file')}` : undefined
          }
        >
          {card.entries.length > 0 ? (
            <ul className="m-0 flex list-none flex-col rounded-sm border border-bf-border p-0 text-bf-sm leading-[18px]">
              {card.entries.map((entry, index) => {
                const value = sidecarValueDisplay(entry);
                return (
                  <li
                    key={entry.key}
                    data-sidecar-key={entry.key}
                    className={cn(
                      'grid grid-cols-[132px_minmax(0,1fr)_auto] items-baseline gap-x-2.5 px-3 py-[7px]',
                      index < card.entries.length - 1 && 'border-b border-bf-border-subtle',
                    )}
                  >
                    <span className={cn(MONO, 'text-bf-text-secondary [overflow-wrap:anywhere]')}>
                      {entry.key}
                    </span>
                    <span
                      data-sidecar-value
                      className={cn(
                        'min-w-0 text-bf-text-primary [overflow-wrap:anywhere]',
                        value.mono && MONO,
                      )}
                    >
                      {value.text}
                      {entry.valueTruncated ? (
                        <span className="font-sans text-bf-text-muted"> (cut short)</span>
                      ) : null}
                    </span>
                    <LevelTag entry={entry} card={card} rootPath={rootPath} />
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className={NOTE}>No sidecar metadata applies to this file.</p>
          )}
          {card.entries.length > 0 ? (
            <p className={NOTE}>
              The tag shows which level a value comes from. A value set closer to the file replaces
              one set higher up.
            </p>
          ) : null}
          {!card.entityNamed ? (
            <p className={NOTE}>
              The file name is not made of BIDS entities, so only the sidecar with the same name
              applies.
            </p>
          ) : null}
          {card.truncated ? (
            <p className={NOTE}>
              More sidecar files apply than were read; the farthest were left out.
            </p>
          ) : null}
          {card.issues.map((issue) => (
            <p key={issue} className={NOTE}>
              {issue}
            </p>
          ))}
        </CardSection>
      </CardBody>
      <CardFooter note={card.entries.length > 0 ? 'Hover a tag to see the file it names' : null}>
        {card.entries.length > 0 ? (
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
      </CardFooter>
    </>
  );
}
