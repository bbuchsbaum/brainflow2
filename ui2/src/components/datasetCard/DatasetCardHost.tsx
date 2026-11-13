import React, { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import * as PopoverPrimitive from '@radix-ui/react-popover';
import { VscLoading } from 'react-icons/vsc';
import { Button, Notice } from '@/components/ui/bf';
import { RemoteReconnectButton } from '@/components/ui/RemoteReconnectButton';
import { useRecoverOnReconnect } from '@/hooks/useRemoteReconnect';
import { canOpenFolderAsSet, getDatasetCardService } from '@/services/DatasetCardService';
import { countsPending, selectMarker, useDatasetCardStore } from '@/stores/datasetCardStore';
import { findOwningRoot } from '@/stores/fileBrowserSearch';
import { useFileBrowserStore } from '@/stores/fileBrowserStore';
import { cn } from '@/utils/cn';
import { ESCAPE_CLEARS_SELECTOR } from './AnalysesTable';
import { CardBody, CardHeader } from './cardParts';
import { DatasetCardView } from './DatasetCardView';
import { SidecarCardView } from './SidecarCardView';
import {
  baseName,
  collectionHint,
  datasetCardTitle,
  displayPath,
  showsAsCollection,
} from './datasetCardFormat';

/** Attribute a browser row carries so focus can return to it when the card closes. */
export const CARD_ROW_PATH_ATTRIBUTE = 'data-fs-path';

function focusOrigin(originPath: string | null, remembered: HTMLElement | null): void {
  // Only when focus was left nowhere: never pull it from where the user went.
  const active = document.activeElement;
  if (active && active !== document.body) return;
  if (remembered?.isConnected) {
    remembered.focus({ preventScroll: true });
    return;
  }
  if (!originPath) return;
  for (const row of document.querySelectorAll<HTMLElement>(`[${CARD_ROW_PATH_ATTRIBUTE}]`)) {
    if (row.getAttribute(CARD_ROW_PATH_ATTRIBUTE) === originPath) {
      row.focus({ preventScroll: true });
      return;
    }
  }
}

/** Whether `element` or an ancestor is `display: none` (an inactive layout tab). */
function isHidden(element: Element): boolean {
  for (let current: Element | null = element; current; current = current.parentElement) {
    if (getComputedStyle(current).display === 'none') return true;
  }
  return false;
}

/** Controls inside the card that keep Space for themselves. */
const OWN_SPACE = [
  'button',
  'a[href]',
  'input',
  'textarea',
  'select',
  'summary',
  '[contenteditable="true"]',
  '[role="button"]',
  '[role="tab"]',
  '[role="option"]',
  '[role="checkbox"]',
  '[role="switch"]',
  '[role="menuitem"]',
].join(', ');
/** Places in the panel where Escape already means something else. */
const OWN_ESCAPE = [
  'input',
  'textarea',
  'select',
  '[contenteditable="true"]',
  '[role="dialog"]',
  '[role="menu"]',
  '[role="listbox"]',
].join(', ');
/** The docking layout: the card stays inside it, clear of the app's top and status bars. */
const LAYOUT_BOUNDARY = '.lm_goldenlayout';

export interface DatasetCardHostProps {
  /** The element the card sits beside (the file browser panel). */
  anchorRef: React.RefObject<HTMLElement | null>;
}

/**
 * The pinned card: a non-modal floating panel beside the file browser. It
 * stays open while the user works elsewhere, and closes on its close button,
 * on Escape or Space pressed in the card, and on Escape or the Space toggle
 * in the browser; another row's marker swaps what it shows. Nothing is
 * trapped: Tab leaves it in document order.
 */
export function DatasetCardHost({ anchorRef }: DatasetCardHostProps) {
  const pinned = useDatasetCardStore((state) => state.card);
  // A card that failed on a dropped connection loads again when its mount
  // is back, whichever surface reconnected it.
  useRecoverOnReconnect(
    pinned?.path,
    (pinned?.status === 'error' && Boolean(pinned.connectionLost)) ||
      (pinned?.status === 'ready' &&
        pinned.countsError !== null &&
        Boolean(pinned.countsConnectionLost)),
    () => getDatasetCardService().retry(),
  );
  const entries = useFileBrowserStore((state) => state.entries);
  const titleId = useId();
  const contentRef = useRef<HTMLDivElement>(null);
  const originRef = useRef<string | null>(null);
  const open = pinned !== null;

  // The card closes with an exit animation: it keeps showing what it showed.
  const [shown, setShown] = useState(pinned);
  if (pinned && pinned !== shown) setShown(pinned);
  const card = pinned ?? shown;

  // A card of a folder whose root was unmounted describes nothing reachable.
  const rootPath = pinned?.rootPath ?? null;
  const rootMounted =
    rootPath === null ||
    entries.some((entry) => entry.path === rootPath || rootPath.startsWith(`${entry.path}/`));
  useEffect(() => {
    if (!rootMounted) getDatasetCardService().close();
  }, [rootMounted]);
  // Nor do the markers of its folders.
  const rootsKey = entries.map((entry) => entry.path).join('\n');
  const knownRootsRef = useRef<string[]>([]);
  useEffect(() => {
    const roots = rootsKey ? rootsKey.split('\n') : [];
    for (const root of knownRootsRef.current) {
      if (!roots.includes(root)) getDatasetCardService().forgetMarkers(root);
    }
    knownRootsRef.current = roots;
  }, [rootsKey]);
  const originPath = pinned?.originPath ?? null;
  useEffect(() => {
    if (originPath !== null) originRef.current = originPath;
  }, [originPath]);

  // The card belongs to this panel: it goes when the panel does.
  useEffect(() => () => getDatasetCardService().close(), []);

  // The panel shares a tab stack: when another tab is shown the layout sets
  // it to `display: none`, and a card anchored to nothing would sit in a corner.
  useEffect(() => {
    const anchor = anchorRef.current;
    if (!open || !anchor) return undefined;
    const closeIfHidden = () => {
      if (isHidden(anchor)) getDatasetCardService().close();
    };
    closeIfHidden();
    if (typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(closeIfHidden);
    observer.observe(anchor);
    return () => observer.disconnect();
  }, [open, anchorRef]);

  const [boundary, setBoundary] = useState<Element | null>(null);
  useLayoutEffect(() => {
    if (open) setBoundary(anchorRef.current?.closest(LAYOUT_BOUNDARY) ?? null);
  }, [open, anchorRef]);

  // Whether the card was the last thing focused. A transition replaces the
  // card's body, and with it the focused control (the row that was opened,
  // "Back", "Retry"): the browser then leaves focus on <body>, which says
  // nothing about where the user is. This remembers it. Focus moving
  // elsewhere, or a press outside the card, ends it.
  const focusInCardRef = useRef(false);
  useEffect(() => {
    if (!open) {
      focusInCardRef.current = false;
      return undefined;
    }
    const inCard = (target: EventTarget | null) =>
      target instanceof Node && Boolean(contentRef.current?.contains(target));
    const onFocusIn = (event: FocusEvent) => {
      focusInCardRef.current = inCard(event.target);
    };
    // A press counts as well: WebKit does not focus a button that is clicked.
    const onPointerDown = (event: PointerEvent) => {
      focusInCardRef.current = inCard(event.target);
    };
    document.addEventListener('focusin', onFocusIn, true);
    document.addEventListener('pointerdown', onPointerDown, true);
    return () => {
      document.removeEventListener('focusin', onFocusIn, true);
      document.removeEventListener('pointerdown', onPointerDown, true);
    };
  }, [open]);
  // After each change of what the card shows: if the focused control went
  // with the old body, the card itself takes focus, so the keyboard (Tab,
  // Escape, Space) still acts on the card.
  useLayoutEffect(() => {
    if (!pinned || !focusInCardRef.current) return;
    const active = document.activeElement;
    if (active && active !== document.body && active.isConnected) return;
    contentRef.current?.focus({ preventScroll: true });
  }, [pinned]);

  const service = getDatasetCardService();
  const close = () => service.close();
  const marker = useDatasetCardStore(
    selectMarker(card?.kind === 'dataset' ? card.rootPath : null, card?.path ?? ''),
  );
  const hint =
    card?.kind === 'dataset'
      ? collectionHint(
          marker,
          findOwningRoot(entries, card.path)?.mountSource?.kind === 'remote',
        )
      : null;
  // The width follows the layout, and the layout is known from the marker
  // before the card has loaded or counted: it does not change on the way.
  const isCollection =
    card?.kind === 'dataset' &&
    showsAsCollection(
      card.dataset?.analyses.length ?? 0,
      card.status === 'ready' && card.dataset !== null && !countsPending(card) && !card.countsError,
      hint,
    );

  let body: React.ReactNode = null;
  if (card) {
    if (card.status === 'ready' && card.kind === 'dataset' && card.dataset) {
      const previous = card.backStack[card.backStack.length - 1];
      body = (
        <DatasetCardView
          key={card.path}
          card={card.dataset}
          displayPath={displayPath(card.path, entries)}
          titleId={titleId}
          canOpenAsSet={canOpenFolderAsSet(entries, card.path)}
          collectionHint={hint}
          countsPending={countsPending(card)}
          countsError={card.countsError}
          countsReconnectPath={card.countsConnectionLost ? card.path : null}
          onRetryCounts={() => service.retry()}
          backLabel={previous ? `Back to ${datasetCardTitle(previous.data)}` : null}
          onBack={() => service.back()}
          onShowAnalysis={(path) => service.showAnalysis(path)}
          onOpenAsSet={(path) => void service.openAsSet(path)}
          onRefresh={() => service.refresh()}
          onClose={close}
        />
      );
    } else if (card.status === 'ready' && card.kind === 'sidecar' && card.sidecar) {
      body = (
        <SidecarCardView
          key={card.path}
          card={card.sidecar}
          rootPath={card.rootPath}
          titleId={titleId}
          onRefresh={() => service.refresh()}
          onClose={close}
        />
      );
    } else {
      const previous = card.backStack[card.backStack.length - 1];
      body = (
        <>
          <CardHeader
            title={baseName(card.path)}
            monoTitle={card.kind === 'sidecar'}
            titleId={titleId}
            path={displayPath(card.path, entries)}
            backLabel={previous ? `Back to ${datasetCardTitle(previous.data)}` : null}
            onBack={() => service.back()}
            onClose={close}
          />
          <CardBody>
            {card.status === 'loading' ? (
              <p
                role="status"
                className="m-0 flex items-center gap-2 text-bf-sm text-bf-text-secondary"
              >
                <VscLoading aria-hidden className="motion-safe:animate-spin" />
                {card.kind === 'dataset' ? 'Reading the folder…' : 'Reading the metadata…'}
              </p>
            ) : (
              <Notice
                severity={card.connectionLost ? 'warning' : 'danger'}
                action={
                  <span className="flex shrink-0 items-center gap-1">
                    {card.connectionLost ? (
                      <RemoteReconnectButton
                        path={card.path}
                        variant="primary"
                        testId="dataset-card-reconnect"
                      />
                    ) : null}
                    <Button variant="secondary" size="sm" onClick={() => service.retry()}>
                      Retry
                    </Button>
                  </span>
                }
              >
                {card.error}
              </Notice>
            )}
          </CardBody>
        </>
      );
    }
  }

  return (
    <PopoverPrimitive.Root
      open={open}
      modal={false}
      onOpenChange={(next) => {
        if (!next) close();
      }}
    >
      <PopoverPrimitive.Anchor virtualRef={anchorRef as React.RefObject<HTMLElement>} />
      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Content
          ref={contentRef}
          role="dialog"
          aria-labelledby={titleId}
          data-testid="dataset-card"
          data-card-kind={card?.kind}
          side="right"
          align="start"
          sideOffset={8}
          collisionPadding={8}
          collisionBoundary={boundary ?? undefined}
          tabIndex={-1}
          // Pinned: a click or focus elsewhere leaves it open.
          onInteractOutside={(event) => event.preventDefault()}
          // Escape closes the card only from the card or its browser. Anywhere
          // else it belongs to whatever has focus (a menu, a dialog, a brush).
          onEscapeKeyDown={(event) => {
            const active = document.activeElement;
            if (active && contentRef.current?.contains(active)) {
              // A filter with text in it takes the first Escape to empty
              // itself; only the next one closes the card.
              if (active.matches(ESCAPE_CLEARS_SELECTOR) && (active as HTMLInputElement).value) {
                event.preventDefault();
              }
              return;
            }
            // Focus fell to <body> when the card replaced what was focused
            // in it: the card was still the last thing the user was in.
            if ((!active || active === document.body) && focusInCardRef.current) return;
            const panel = anchorRef.current;
            if (active && panel?.contains(active)) {
              const owner = active.closest(OWN_ESCAPE);
              if (!owner || !panel.contains(owner)) return;
            }
            event.preventDefault();
          }}
          onKeyDown={(event) => {
            // Space again closes the card, as it does on the browser row.
            if (event.key !== ' ' || event.defaultPrevented) return;
            if (event.metaKey || event.ctrlKey || event.altKey) return;
            if ((event.target as HTMLElement).closest(OWN_SPACE)) return;
            event.preventDefault();
            close();
          }}
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            contentRef.current?.focus({ preventScroll: true });
          }}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            focusOrigin(originRef.current, service.takeReturnFocus());
          }}
          className={cn(
            // Under the app's menus and dialogs (z-50 and up), over the layout.
            'z-40 flex flex-col overflow-hidden rounded-bf-md border border-bf-border-strong bg-bf-bg-panel-raised p-0 text-bf-md leading-5 text-bf-text-primary shadow-bf-panel outline-none',
            'data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0',
            // Never taller than the room the layout leaves; the body scrolls.
            'max-h-[min(var(--radix-popover-content-available-height,100vh),calc(100vh-16px))]',
            isCollection ? 'w-[min(620px,calc(100vw-16px))]' : 'w-[min(480px,calc(100vw-16px))]',
          )}
        >
          {body}
        </PopoverPrimitive.Content>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  );
}
