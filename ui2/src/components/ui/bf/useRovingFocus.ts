import React, { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Roving focus for list and tree containers built from {@link SelectableRow}
 * (Files tree, scene stack, analysis list, Studio strip): one tab stop in the
 * container, arrow keys move focus between rows.
 *
 * - ArrowDown / ArrowUp (or Right / Left with `orientation="horizontal"`)
 *   move to the next / previous id, Home / End to the ends; `loop` wraps.
 * - Tree mode (`onExpand` / `onCollapse` given, vertical only): ArrowRight
 *   calls `onExpand(id)`, ArrowLeft calls `onCollapse(id)`; the caller decides
 *   whether that opens a folder or moves to the parent/child.
 * - `selectOnMove` also calls `onSelect` as focus moves (single-select lists
 *   where focus follows selection); otherwise Enter/Space on the row selects.
 *
 * Moving focus never selects by itself unless asked, and never changes the
 * caller's store: the hook keeps only the focused id. The tab stop follows
 * `activeId` (usually the selected row) until the user moves focus.
 *
 * ```tsx
 * const roving = useRovingFocus({ ids, activeId: selectedId });
 * <div role="listbox" aria-label="Analyses" onKeyDown={roving.onKeyDown}>
 *   {ids.map((id) => <SelectableRow key={id} {...roving.getItemProps(id)} … />)}
 * </div>
 * ```
 */
export interface RovingFocusOptions {
  ids: readonly string[];
  /** The row that holds the tab stop when nothing has been focused yet. */
  activeId?: string | null;
  orientation?: 'vertical' | 'horizontal';
  loop?: boolean;
  /** Ids that cannot take focus. */
  disabledIds?: ReadonlySet<string> | readonly string[];
  selectOnMove?: boolean;
  onSelect?: (id: string) => void;
  onExpand?: (id: string) => void;
  onCollapse?: (id: string) => void;
}

export interface RovingItemProps {
  tabIndex: number;
  ref: (el: HTMLElement | null) => void;
  onFocus: () => void;
  'data-roving-id': string;
}

export function useRovingFocus({
  ids,
  activeId = null,
  orientation = 'vertical',
  loop = false,
  disabledIds,
  selectOnMove = false,
  onSelect,
  onExpand,
  onCollapse,
}: RovingFocusOptions) {
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const nodes = useRef(new Map<string, HTMLElement>());
  const disabled = new Set(disabledIds ?? []);
  const enabled = ids.filter((id) => !disabled.has(id));

  // Drop a focused id that no longer exists (row removed).
  useEffect(() => {
    if (focusedId !== null && !ids.includes(focusedId)) setFocusedId(null);
  }, [ids, focusedId]);

  const stop =
    focusedId !== null && enabled.includes(focusedId)
      ? focusedId
      : activeId !== null && enabled.includes(activeId)
        ? activeId
        : (enabled[0] ?? null);

  const focusId = useCallback(
    (id: string) => {
      setFocusedId(id);
      nodes.current.get(id)?.focus();
      if (selectOnMove) onSelect?.(id);
    },
    [selectOnMove, onSelect],
  );

  const onKeyDown = (e: React.KeyboardEvent<HTMLElement>) => {
    if (e.defaultPrevented || enabled.length === 0) return;
    // Only rows drive the container: keys typed into a nested control are theirs.
    const from = (e.target as HTMLElement).closest?.('[data-roving-id]');
    if (!from || from !== e.target) return;
    const current = from.getAttribute('data-roving-id') ?? stop;
    const i = current ? enabled.indexOf(current) : -1;
    const next = orientation === 'vertical' ? 'ArrowDown' : 'ArrowRight';
    const prev = orientation === 'vertical' ? 'ArrowUp' : 'ArrowLeft';
    let target: string | null = null;
    if (e.key === next) {
      target = i + 1 < enabled.length ? enabled[i + 1] : loop ? enabled[0] : null;
    } else if (e.key === prev) {
      target = i > 0 ? enabled[i - 1] : loop ? enabled[enabled.length - 1] : null;
    } else if (e.key === 'Home') {
      target = enabled[0];
    } else if (e.key === 'End') {
      target = enabled[enabled.length - 1];
    } else if (orientation === 'vertical' && e.key === 'ArrowRight' && onExpand && current) {
      e.preventDefault();
      onExpand(current);
      return;
    } else if (orientation === 'vertical' && e.key === 'ArrowLeft' && onCollapse && current) {
      e.preventDefault();
      onCollapse(current);
      return;
    } else {
      return;
    }
    e.preventDefault();
    if (target !== null && target !== current) focusId(target);
  };

  const getItemProps = (id: string): RovingItemProps => ({
    tabIndex: id === stop ? 0 : -1,
    ref: (el) => {
      if (el) nodes.current.set(id, el);
      else nodes.current.delete(id);
    },
    onFocus: () => {
      if (focusedId !== id) setFocusedId(id);
    },
    'data-roving-id': id,
  });

  return { focusedId: stop, onKeyDown, getItemProps, focus: focusId };
}
