import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { Tabs, TabPanel } from '../Tabs';

const ITEMS = [
  { value: 'tree', label: 'Tree' },
  { value: 'bids', label: 'BIDS' },
  { value: 'images', label: 'Images', disabled: true },
  { value: 'loaded', label: 'Loaded' },
];

function Harness({ activation }: { activation?: 'automatic' | 'manual' }) {
  const [value, setValue] = useState('tree');
  return (
    <>
      <Tabs aria-label="Files view" idBase="t" items={ITEMS} value={value} onValueChange={setValue} activation={activation} />
      {ITEMS.map((i) => (
        <TabPanel key={i.value} idBase="t" value={i.value} selected={value}>
          {i.label} panel
        </TabPanel>
      ))}
    </>
  );
}

describe('bf Tabs', () => {
  it('exposes tablist/tab/tabpanel semantics with one tab stop', () => {
    render(<Harness />);
    expect(screen.getByRole('tablist', { name: 'Files view' })).toBeInTheDocument();
    const tabs = screen.getAllByRole('tab');
    expect(tabs.map((t) => t.getAttribute('tabindex'))).toEqual(['0', '-1', '-1', '-1']);
    expect(tabs[0]).toHaveAttribute('aria-selected', 'true');
    const panel = screen.getByRole('tabpanel');
    expect(panel).toHaveAttribute('aria-labelledby', tabs[0].id);
    expect(tabs[0]).toHaveAttribute('aria-controls', panel.id);
  });

  it('arrow keys move focus and select, skipping disabled tabs and wrapping', () => {
    render(<Harness />);
    const tree = screen.getByRole('tab', { name: 'Tree' });
    tree.focus();
    fireEvent.keyDown(tree, { key: 'ArrowRight' });
    const bids = screen.getByRole('tab', { name: 'BIDS' });
    expect(bids).toHaveFocus();
    expect(bids).toHaveAttribute('aria-selected', 'true');
    fireEvent.keyDown(bids, { key: 'ArrowRight' });
    expect(screen.getByRole('tab', { name: 'Loaded' })).toHaveFocus();
    fireEvent.keyDown(screen.getByRole('tab', { name: 'Loaded' }), { key: 'ArrowRight' });
    expect(tree).toHaveFocus();
    fireEvent.keyDown(tree, { key: 'End' });
    expect(screen.getByRole('tab', { name: 'Loaded' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tabpanel')).toHaveTextContent('Loaded panel');
  });

  it('manual activation moves focus only; Enter selects', () => {
    render(<Harness activation="manual" />);
    const tree = screen.getByRole('tab', { name: 'Tree' });
    tree.focus();
    fireEvent.keyDown(tree, { key: 'ArrowRight' });
    const bids = screen.getByRole('tab', { name: 'BIDS' });
    expect(bids).toHaveFocus();
    expect(bids).toHaveAttribute('aria-selected', 'false');
    fireEvent.keyDown(bids, { key: 'Enter' });
    expect(bids).toHaveAttribute('aria-selected', 'true');
  });

  it('active edge is neutral by default and amber only with edge="accent"', () => {
    const { rerender } = render(<Tabs items={ITEMS} value="tree" onValueChange={() => {}} />);
    const active = () => screen.getByRole('tab', { name: 'Tree' });
    expect(active().className).toContain('var(--bf-text-muted)');
    expect(active().className).not.toContain('var(--bf-accent)');
    rerender(<Tabs items={ITEMS} value="tree" edge="accent" onValueChange={() => {}} />);
    expect(active().className).toContain('var(--bf-accent)');
    // One outer focus geometry: 2px outline, offset 1, square corners.
    expect(active().className).toContain('focus-visible:outline-offset-1');
    expect(active().className).toContain('focus-visible:rounded-none');
    // The amber edge hides under focus; a neutral edge would stay.
    expect(active().className).toContain('focus-visible:shadow-none');
  });

  it('neutral active edge stays visible under focus', () => {
    render(<Tabs items={ITEMS} value="tree" onValueChange={() => {}} />);
    expect(screen.getByRole('tab', { name: 'Tree' }).className).not.toContain('focus-visible:shadow-none');
  });

  it('close: Delete on the focused tab, 24px pointer target outside the a11y tree', () => {
    const onClose = vi.fn();
    const onValueChange = vi.fn();
    const { container } = render(
      <Tabs
        aria-label="Views"
        items={[
          { value: 'a', label: 'Axial', onClose },
          { value: 's', label: 'Surface', onClose },
        ]}
        value="a"
        onValueChange={onValueChange}
      />,
    );
    // The tablist owns only tabs (the close glyph is aria-hidden, wrappers role=none).
    expect(screen.queryByRole('button', { name: /Close/ })).toBeNull();
    const tablist = screen.getByRole('tablist');
    for (const wrapper of Array.from(tablist.children)) expect(wrapper).toHaveAttribute('role', 'none');
    const axial = screen.getByRole('tab', { name: 'Axial' });
    expect(axial).toHaveAttribute('aria-keyshortcuts', 'Delete');
    axial.focus();
    fireEvent.keyDown(axial, { key: 'Delete' });
    expect(onClose).toHaveBeenCalledWith('a');
    const close = container.querySelector('[data-tab-close="s"]') as HTMLElement;
    expect(close).toHaveAttribute('tabindex', '-1');
    expect(close).toHaveAttribute('aria-hidden', 'true');
    expect(close.className).toContain('h-6');
    expect(close.className).toContain('w-6');
    fireEvent.click(close);
    expect(onClose).toHaveBeenLastCalledWith('s');
    // Clicking close never activates the tab.
    expect(onValueChange).not.toHaveBeenCalled();
  });

  it('tab strip is 28px; panels can opt out of being a tab stop', () => {
    render(
      <>
        <Tabs items={ITEMS} value="tree" onValueChange={() => {}} idBase="p" />
        <TabPanel idBase="p" value="tree" selected="tree" focusable={false}>
          x
        </TabPanel>
      </>,
    );
    expect(screen.getByRole('tab', { name: 'Tree' }).className).toContain('h-7');
    expect(screen.getByRole('tabpanel')).not.toHaveAttribute('tabindex');
  });
});

describe('bf Tabs per-item hooks and density', () => {
  it('puts testId and data-* on each tab button', () => {
    render(
      <Tabs
        aria-label="Dock"
        value="plot"
        onValueChange={() => {}}
        items={[
          { value: 'plot', label: 'Plot', testId: 'dock-tab-plot', data: { 'data-kind': 'plot' } },
          { value: 'log', label: 'Log', testId: 'dock-tab-log' },
        ]}
      />,
    );
    const plot = screen.getByTestId('dock-tab-plot');
    expect(plot).toBe(screen.getByRole('tab', { name: 'Plot' }));
    expect(plot).toHaveAttribute('data-kind', 'plot');
    // The primitive's own state attribute is not overridable by item data.
    expect(plot).toHaveAttribute('data-state', 'active');
    expect(screen.getByTestId('dock-tab-log')).toHaveAttribute('role', 'tab');
  });

  it('density="compact" uses 4px side padding; default keeps 12px', () => {
    const { rerender } = render(
      <Tabs aria-label="Files" fill density="compact" value="tree" onValueChange={() => {}} items={ITEMS} />,
    );
    const tab = screen.getByRole('tab', { name: 'Tree' });
    expect(tab.className).toContain('px-1');
    expect(tab.className).not.toContain('px-3');
    rerender(<Tabs aria-label="Files" fill value="tree" onValueChange={() => {}} items={ITEMS} />);
    expect(screen.getByRole('tab', { name: 'Tree' }).className).toContain('px-3');
  });
});
