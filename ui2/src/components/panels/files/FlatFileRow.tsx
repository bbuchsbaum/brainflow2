import React from 'react';
import { SelectableRow, type RovingItemProps } from '@/components/ui/bf';
import type { FileTypeInfo } from './shared/inferFileType';
import { FileTypeBadge } from './shared/FileTypeBadge';
import { useFittedName } from './shared/useFittedName';

interface FlatFileRowProps {
  roving: RovingItemProps;
  selected: boolean;
  onSelect: () => void;
  info: FileTypeInfo;
  name: string;
  /** Trailing muted mono text (relative folder, layer source). */
  meta?: string;
  title: string;
  /** Starts a pointer drag (utils/pointerDrag.ts); HTML5 drags are unavailable. */
  onDragPointerDown: (event: React.PointerEvent) => void;
  /** Right-click on the row (e.g. Loaded › Unload). */
  onContextMenu?: (event: React.MouseEvent<HTMLDivElement>) => void;
}

/**
 * One row of the Images / Loaded flat lists: a bf SelectableRow (`option` in
 * a listbox, roving focus from the list), so selection, hover and focus have
 * the same geometry as the Files tree. The name is middle-truncated by
 * `formatName`, keeping the extension.
 */
export function FlatFileRow({
  roving,
  selected,
  onSelect,
  info,
  name,
  meta,
  title,
  onDragPointerDown,
  onContextMenu,
}: FlatFileRowProps) {
  const fitted = useFittedName<HTMLSpanElement>(name);
  const { ref, ...itemProps } = roving;
  return (
    <SelectableRow
      ref={ref}
      {...itemProps}
      role="option"
      selected={selected}
      onSelect={onSelect}
      title={title}
      aria-label={meta ? `${name}, ${meta}` : name}
      data-drag-source="file"
      onPointerDown={onDragPointerDown}
      onContextMenu={onContextMenu}
      className="fb-flat-row"
    >
      <FileTypeBadge info={info} />
      <span ref={fitted.ref} className="fb-flat-row-name font-mono text-bf-xs">
        {fitted.text}
      </span>
      {meta ? <span className="fb-flat-row-meta">{meta}</span> : null}
    </SelectableRow>
  );
}
