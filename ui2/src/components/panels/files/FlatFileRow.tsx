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
  onDragStart: (event: React.DragEvent) => void;
  onDragEnd?: () => void;
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
  onDragStart,
  onDragEnd,
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
      draggable
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
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
