import type { ReactNode } from 'react';
import { Info } from 'lucide-react';
import {
  Button,
  Chip,
  FOCUS_RING,
  KeyValue,
  Select,
  StatusPill,
  type KeyValueItem,
} from '@/components/ui/bf';
import type { StudioSetMap } from '@/services/studio/studioMaps';
import { StudioPopover, StudioToolbarMore } from './StudioToolbarSlot';
import type { StudioSetAudit } from './useStudioSetAudit';
import './studio.css';

/** Where a set lives (a connection and a path), on one line. */
function setLocationText(setLocation?: { label?: string; path: string } | null) {
  return setLocation ? [setLocation.label, setLocation.path].filter(Boolean).join(' · ') : null;
}

/**
 * The set's name: read first and the last thing to shorten. A button that
 * opens the dataset card when the set's folder has one; plain text otherwise.
 * Where the set lives is its tooltip.
 */
export function StudioSetName({
  setName,
  setLocation,
  onOpenDatasetCard,
  className = '',
}: {
  setName: string;
  setLocation?: { label?: string; path: string } | null;
  onOpenDatasetCard?: (from: HTMLElement) => void;
  className?: string;
}) {
  const where = setLocationText(setLocation);
  return onOpenDatasetCard ? (
    <button
      type="button"
      className={`min-w-0 truncate rounded-sm bg-transparent p-0 text-left text-bf-md font-semibold text-foreground underline decoration-[var(--bf-border-strong)] underline-offset-2 hover:decoration-current [flex:0_1_auto] ${FOCUS_RING} ${className}`}
      title={`${where ? `${setName}\n${where}` : setName}\nAbout this dataset`}
      aria-label={`${setName}: about this dataset`}
      data-testid="studio-set-name"
      onClick={(event) => onOpenDatasetCard(event.currentTarget)}
    >
      {setName}
    </button>
  ) : (
    <div
      className={`min-w-0 truncate text-bf-md font-semibold text-foreground [flex:0_1_auto] ${className}`}
      title={where ? `${setName}\n${where}` : setName}
      data-testid="studio-set-name"
    >
      {setName}
    </div>
  );
}

/**
 * Which of the set's maps Population shows, after the set's name: the map's
 * short name, and a compact select when the set holds several (enc_rep_rsa:
 * same_item, same_run, temporal_dist). Choosing one switches Population.
 */
export function StudioMapSelect({
  maps,
  activeId,
  onSelect,
}: {
  maps: readonly StudioSetMap[];
  activeId: string | null;
  onSelect: (featureId: string) => void;
}) {
  const active = maps.find((map) => map.id === activeId) ?? null;
  if (maps.length === 0) return null;
  if (maps.length === 1 || !active) {
    const shown = active ?? maps[0];
    return (
      <span
        className="shrink-0 whitespace-nowrap font-mono text-bf-sm text-bf-text-secondary"
        title={`Map: ${shown.label}${shown.units ? ` (${shown.units})` : ''}`}
        data-testid="studio-map-name"
      >
        {shown.short}
      </span>
    );
  }
  return (
    <Select
      aria-label="Map"
      title={`Map: ${active.label}${active.units ? ` (${active.units})` : ''}`}
      data-testid="studio-map-select"
      // Sized to its longest short name, and never shortened (the row's
      // background select gives up its width first).
      className="w-auto shrink-0 font-mono"
      value={active.id}
      onValueChange={(value) => {
        if (value && value !== active.id) onSelect(value);
      }}
    >
      {maps.map((map) => (
        <option key={map.id} value={map.id}>
          {map.short}
        </option>
      ))}
    </Select>
  );
}

/**
 * The set's facts behind one ⓘ: its status (including "Ready to compare",
 * which the header no longer says), how many images matched, the grid they
 * share, where the background came from ("matched from the images; not
 * declared by the files"), how the data was opened, where it lives, and the
 * way to the folder's dataset card.
 */
export function StudioSetInfo({
  audit,
  backgroundNote = null,
  dataStateLabel = null,
  setLocation = null,
  datasetCard,
  maps = [],
  activeMapId = null,
}: {
  audit: StudioSetAudit | null;
  /** The set's maps; listed when there are any, the shown one marked. */
  maps?: readonly StudioSetMap[];
  activeMapId?: string | null;
  /** Where the background template came from, when it has a note. */
  backgroundNote?: string | null;
  dataStateLabel?: string | null;
  setLocation?: { label?: string; path: string } | null;
  /** The folder's dataset card: how to open it, or why it cannot be opened. */
  datasetCard?: { open: (from: HTMLElement) => void } | { reason: string } | null;
}) {
  const where = setLocationText(setLocation);
  const items: KeyValueItem[] = [
    ...(audit ? [{ key: 'images', label: 'Images', value: audit.images }] : []),
    ...(audit && audit.unmatched > 0
      ? [{ key: 'unmatched', label: 'Unmatched', value: String(audit.unmatched) }]
      : []),
    ...(audit && audit.duplicates > 0
      ? [{ key: 'duplicates', label: 'Duplicates', value: String(audit.duplicates) }]
      : []),
    ...(maps.length > 0
      ? [
          {
            key: 'maps',
            label: maps.length === 1 ? 'Map' : 'Maps',
            mono: false,
            wrap: true,
            value: (
              <ul className="m-0 flex list-none flex-col p-0" data-testid="studio-set-maps">
                {maps.map((map) => (
                  <li
                    key={map.id}
                    title={map.label}
                    aria-current={map.id === activeMapId ? 'true' : undefined}
                    className={
                      map.id === activeMapId ? 'text-foreground' : 'text-bf-text-secondary'
                    }
                  >
                    <span className="font-mono">{map.short}</span>
                    {map.units ? (
                      <span className="text-bf-text-muted"> · {map.units}</span>
                    ) : null}
                    {map.id === activeMapId && maps.length > 1 ? (
                      <span className="text-bf-text-muted"> · shown</span>
                    ) : null}
                  </li>
                ))}
              </ul>
            ),
          },
        ]
      : []),
    ...(audit?.grid ? [{ key: 'grid', label: 'Grid', value: audit.grid, wrap: true }] : []),
    ...(backgroundNote
      ? [{ key: 'background', label: 'Background', value: backgroundNote, mono: false, wrap: true }]
      : []),
    ...(dataStateLabel
      ? [{ key: 'data', label: 'Data', value: dataStateLabel, mono: false }]
      : []),
    ...(where ? [{ key: 'where', label: 'Location', value: where, wrap: true }] : []),
  ];
  return (
    <StudioPopover
      label="Dataset details"
      testId="studio-set-info"
      panelClassName="w-[20rem]"
      summaryClassName="inline-flex h-6 w-6 items-center justify-center rounded-sm text-bf-text-muted hover:bg-accent hover:text-foreground"
      summary={<Info aria-hidden className="h-3.5 w-3.5" />}
    >
      {audit ? (
        <div>
          <StatusPill
            status={audit.status.status}
            title={audit.status.detail ?? undefined}
            data-phase={audit.phase}
          >
            {audit.status.label}
          </StatusPill>
          {audit.status.detail ? (
            <p className="m-0 mt-1 text-bf-xs text-muted-foreground">{audit.status.detail}</p>
          ) : null}
        </div>
      ) : null}
      {items.length ? <KeyValue layout="rows" items={items} /> : null}
      {datasetCard ? (
        <div>
          <Button
            variant="secondary"
            size="sm"
            disabled={!('open' in datasetCard)}
            title={'reason' in datasetCard ? datasetCard.reason : undefined}
            onClick={(event) => {
              if ('open' in datasetCard) datasetCard.open(event.currentTarget);
            }}
          >
            About this dataset
          </Button>
          {'reason' in datasetCard ? (
            <p className="m-0 mt-1 text-bf-xs text-muted-foreground">{datasetCard.reason}</p>
          ) : null}
        </div>
      ) : null}
    </StudioPopover>
  );
}

interface StudioToolbarProps {
  setName: string;
  /** Where the set lives (a connection and a path): the name's tooltip. */
  setLocation?: { label?: string; path: string } | null;
  dataStateLabel?: string | null;
  /** The audit facts, shown on the same line (QA N13). */
  audit?: ReactNode;
  /**
   * Open the description of the set's source folder. Given only for a set
   * opened from a folder the Files panel is browsing: the name is then a
   * button; otherwise it is plain text.
   */
  onOpenDatasetCard?: (from: HTMLElement) => void;
  /** Content for a menu at the header's end. */
  menu?: ReactNode;
}

/**
 * A set header shown on its own (the development harness, a lens without
 * the Studio): the name, then the audit facts in the room it leaves. The
 * Studio itself puts the name on its lens row (StudioCenterPane) and keeps
 * the facts behind ⓘ.
 */
export function StudioToolbar({
  setName,
  setLocation,
  dataStateLabel,
  audit,
  onOpenDatasetCard,
  menu,
}: StudioToolbarProps) {
  return (
    <header className="studio-set-header relative z-30 flex min-w-0 flex-nowrap items-center gap-2 border-b border-border bg-background px-3 py-1.5">
      <StudioSetName
        setName={setName}
        setLocation={setLocation}
        onOpenDatasetCard={onOpenDatasetCard}
      />
      {dataStateLabel ? (
        <Chip className="studio-header-tertiary shrink-0">{dataStateLabel}</Chip>
      ) : null}
      {/* Takes what the name leaves; clips rather than push the name. */}
      <div className="flex min-w-0 items-center gap-2 overflow-hidden [flex:1_1000_0%]">
        {audit ? <span className="h-4 w-px shrink-0 bg-border" aria-hidden /> : null}
        {audit}
      </div>
      {menu ? <StudioToolbarMore label="More">{menu}</StudioToolbarMore> : null}
    </header>
  );
}
