import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { SelectableRow } from '../SelectableRow';
import { useRovingFocus } from '../useRovingFocus';
import { FOCUS_RING_INSET, FOCUS_RING_INSET_BORDERED, insetBands, SELECTED } from '../states';

/** outline-offset (px) written in a focus-visible class string. */
function offsetOf(classes: string): number {
  const m = /focus-visible:\[outline-offset:(-?\d+)px\]/.exec(classes);
  if (!m) throw new Error('no inset outline offset');
  return Number(m[1]);
}

describe('bf SelectableRow', () => {
  it('is an option with aria-selected; Enter/Space/click select', () => {
    const onSelect = vi.fn();
    render(
      <div role="listbox" aria-label="Analyses">
        <SelectableRow onSelect={onSelect}>Smooth</SelectableRow>
        <SelectableRow selected>Mask</SelectableRow>
      </div>,
    );
    const smooth = screen.getByRole('option', { name: 'Smooth' });
    expect(smooth).toHaveAttribute('aria-selected', 'false');
    expect(screen.getByRole('option', { name: 'Mask' })).toHaveAttribute('aria-selected', 'true');
    fireEvent.keyDown(smooth, { key: 'Enter' });
    fireEvent.keyDown(smooth, { key: ' ' });
    fireEvent.click(smooth);
    expect(onSelect).toHaveBeenCalledTimes(3);
  });

  it('selection = the one selected fill (#36383d) + inset amber left edge', () => {
    render(<SelectableRow selected>anat</SelectableRow>);
    const row = screen.getByRole('option');
    expect(row.className).toContain('bg-bf-bg-active');
    expect(row.className).not.toContain('bg-bf-bg-selected');
    expect(row.className).toContain('shadow-[inset_2px_0_0_var(--bf-accent)]');
  });

  it('focus ring and selection edge never touch: ≥2px gap on rows, ≥1px (2px) on bordered cards', () => {
    const row = insetBands(0, offsetOf(FOCUS_RING_INSET));
    expect(row.edge).toEqual([0, 1]);
    expect(row.ring).toEqual([4, 5]);
    expect(row.gap).toBeGreaterThanOrEqual(2);
    const card = insetBands(1, offsetOf(FOCUS_RING_INSET_BORDERED));
    expect(card.edge).toEqual([1, 2]);
    expect(card.ring[0]).toBeGreaterThan(card.edge[1] + 1); // at least one clear pixel
    expect(card.gap).toBeGreaterThanOrEqual(2);
    // The classes the rows actually render use those offsets.
    const { rerender } = render(<SelectableRow selected>r</SelectableRow>);
    expect(screen.getByRole('option').className).toContain(FOCUS_RING_INSET);
    rerender(
      <SelectableRow selected variant="card">
        r
      </SelectableRow>,
    );
    const cardEl = screen.getByRole('option');
    expect(cardEl.className).toContain('focus-visible:[outline-offset:-7px]');
    expect(cardEl.className).toContain('border');
  });

  it('forced colors: no base outline on every row; selection has a Highlight bar', () => {
    render(<SelectableRow selected>a</SelectableRow>);
    const row = screen.getByRole('option');
    expect(row.className).not.toMatch(/(^|\s)outline-none(\s|$)/);
    expect(SELECTED).toContain('forced-colors:before:bg-[Highlight]');
    expect(row.className).toContain('forced-colors:before:bg-[Highlight]');
  });

  it('clicks and keys on a nested control do not select the row', () => {
    const onSelect = vi.fn();
    const onEye = vi.fn();
    render(
      <SelectableRow onSelect={onSelect}>
        Layer
        <button type="button" onClick={onEye}>
          eye
        </button>
      </SelectableRow>,
    );
    const eye = screen.getByRole('button', { name: 'eye' });
    fireEvent.click(eye);
    fireEvent.keyDown(eye, { key: 'Enter' });
    expect(onEye).toHaveBeenCalledTimes(1);
    expect(onSelect).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('option'));
    expect(onSelect).toHaveBeenCalledTimes(1);
  });

  it('tree rows take treeitem role and indentation; disabled rows ignore input', () => {
    const onSelect = vi.fn();
    render(
      <SelectableRow role="treeitem" aria-level={2} indent={1} disabled onSelect={onSelect}>
        sub-01
      </SelectableRow>,
    );
    const row = screen.getByRole('treeitem');
    expect(row.style.paddingLeft).toBe('20px');
    expect(row).toHaveAttribute('tabindex', '-1');
    fireEvent.click(row);
    fireEvent.keyDown(row, { key: 'Enter' });
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('button-role cards report aria-pressed instead of aria-selected', () => {
    render(
      <SelectableRow role="button" variant="card" selected>
        Card
      </SelectableRow>,
    );
    const card = screen.getByRole('button');
    expect(card).toHaveAttribute('aria-pressed', 'true');
    expect(card).not.toHaveAttribute('aria-selected');
  });
});

function RovingList({
  onExpand,
  onCollapse,
}: {
  onExpand?: (id: string) => void;
  onCollapse?: (id: string) => void;
}) {
  const ids = ['a', 'b', 'c', 'd'];
  const roving = useRovingFocus({ ids, activeId: 'b', disabledIds: ['c'], onExpand, onCollapse });
  return (
    <div role="tree" aria-label="Files" onKeyDown={roving.onKeyDown}>
      {ids.map((id) => (
        <SelectableRow key={id} role="treeitem" disabled={id === 'c'} {...roving.getItemProps(id)}>
          {id}
        </SelectableRow>
      ))}
    </div>
  );
}

describe('useRovingFocus', () => {
  it('one tab stop on the active row; arrows skip disabled rows; Home/End', () => {
    render(<RovingList />);
    const rows = screen.getAllByRole('treeitem');
    expect(rows.map((r) => r.getAttribute('tabindex'))).toEqual(['-1', '0', '-1', '-1']);
    rows[1].focus();
    fireEvent.keyDown(rows[1], { key: 'ArrowDown' });
    expect(rows[3]).toHaveFocus();
    expect(rows[3]).toHaveAttribute('tabindex', '0');
    fireEvent.keyDown(rows[3], { key: 'Home' });
    expect(rows[0]).toHaveFocus();
    fireEvent.keyDown(rows[0], { key: 'ArrowUp' });
    expect(rows[0]).toHaveFocus();
    fireEvent.keyDown(rows[0], { key: 'End' });
    expect(rows[3]).toHaveFocus();
  });

  it('tree mode routes Right/Left to expand/collapse', () => {
    const onExpand = vi.fn();
    const onCollapse = vi.fn();
    render(<RovingList onExpand={onExpand} onCollapse={onCollapse} />);
    const b = screen.getByRole('treeitem', { name: 'b' });
    b.focus();
    fireEvent.keyDown(b, { key: 'ArrowRight' });
    fireEvent.keyDown(b, { key: 'ArrowLeft' });
    expect(onExpand).toHaveBeenCalledWith('b');
    expect(onCollapse).toHaveBeenCalledWith('b');
  });
});

describe('bf SelectableRow focusable={false}', () => {
  it('has no tabIndex, passes role="none" through, and ignores Enter/Space', () => {
    const onSelect = vi.fn();
    const { container } = render(
      <div role="treeitem" aria-selected="true" tabIndex={0}>
        <SelectableRow focusable={false} role="none" selected onSelect={onSelect}>
          brain.nii.gz
        </SelectableRow>
      </div>,
    );
    const row = container.querySelector('[role="none"]') as HTMLElement;
    expect(row).not.toHaveAttribute('tabindex');
    expect(row).not.toHaveAttribute('aria-selected');
    expect(row).toHaveAttribute('data-state', 'selected');
    expect(row.className).toContain(SELECTED.split(' ')[0]);
    fireEvent.keyDown(row, { key: 'Enter' });
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('role="presentation" and an explicit tabIndex pass through; default rows keep tabIndex 0', () => {
    const { container, rerender } = render(
      <SelectableRow focusable={false} role="presentation" tabIndex={-1}>x</SelectableRow>,
    );
    const row = () => container.firstChild as HTMLElement;
    expect(row()).toHaveAttribute('role', 'presentation');
    expect(row()).toHaveAttribute('tabindex', '-1');
    rerender(<SelectableRow>x</SelectableRow>);
    expect(row()).toHaveAttribute('tabindex', '0');
    expect(row()).toHaveAttribute('role', 'option');
  });

  it('exports rowVariants with the same classes the row renders', async () => {
    const { rowVariants } = await import('../index');
    const { container } = render(<SelectableRow selected>x</SelectableRow>);
    const cls = (container.firstChild as HTMLElement).className;
    for (const c of rowVariants({ variant: 'row', selected: true }).split(' ')) {
      expect(cls).toContain(c);
    }
  });
});
