import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { SegmentedControl } from '../SegmentedControl';

const OPTIONS = [
  { value: 'solid', label: 'Solid' },
  { value: 'dashed', label: 'Dashed' },
  { value: 'dotted', label: 'Dotted' },
];

function Harness() {
  const [value, setValue] = useState('solid');
  return <SegmentedControl aria-label="Line style" options={OPTIONS} value={value} onValueChange={setValue} />;
}

describe('bf SegmentedControl', () => {
  it('is a radiogroup with one tab stop on the checked radio', () => {
    render(<Harness />);
    expect(screen.getByRole('radiogroup', { name: 'Line style' })).toBeInTheDocument();
    const radios = screen.getAllByRole('radio');
    expect(radios.map((r) => r.getAttribute('aria-checked'))).toEqual(['true', 'false', 'false']);
    expect(radios.map((r) => r.tabIndex)).toEqual([0, -1, -1]);
  });

  it('arrows move and select (wrapping); Home/End jump', () => {
    render(<Harness />);
    const solid = screen.getByRole('radio', { name: 'Solid' });
    solid.focus();
    fireEvent.keyDown(solid, { key: 'ArrowLeft' });
    const dotted = screen.getByRole('radio', { name: 'Dotted' });
    expect(dotted).toHaveFocus();
    expect(dotted).toHaveAttribute('aria-checked', 'true');
    fireEvent.keyDown(dotted, { key: 'Home' });
    expect(solid).toHaveAttribute('aria-checked', 'true');
    fireEvent.click(screen.getByRole('radio', { name: 'Dashed' }));
    expect(screen.getByRole('radio', { name: 'Dashed' })).toHaveAttribute('aria-checked', 'true');
  });

  it('renders nothing for a single option unless asked', () => {
    const { container, rerender } = render(
      <SegmentedControl aria-label="Line" options={[OPTIONS[0]]} value="solid" onValueChange={() => {}} />,
    );
    expect(container).toBeEmptyDOMElement();
    rerender(<SegmentedControl aria-label="Line" options={[OPTIONS[0]]} value="solid" hideWhenSingle={false} onValueChange={() => {}} />);
    expect(screen.getByRole('radio', { name: 'Solid' })).toBeInTheDocument();
  });

  it('does not re-emit the checked value and respects disabled', () => {
    const onValueChange = vi.fn();
    const { rerender } = render(<SegmentedControl aria-label="Line" options={OPTIONS} value="solid" onValueChange={onValueChange} />);
    fireEvent.click(screen.getByRole('radio', { name: 'Solid' }));
    expect(onValueChange).not.toHaveBeenCalled();
    rerender(<SegmentedControl aria-label="Line" options={OPTIONS} value="solid" disabled onValueChange={onValueChange} />);
    fireEvent.click(screen.getByRole('radio', { name: 'Dashed' }));
    expect(onValueChange).not.toHaveBeenCalled();
  });

  it('uses the amber edge only with edge="accent"; focus ring sits 2px outside', () => {
    const { rerender } = render(<SegmentedControl aria-label="Line" options={OPTIONS} value="solid" onValueChange={() => {}} />);
    const solid = () => screen.getByRole('radio', { name: 'Solid' });
    expect(solid().className).not.toContain('var(--bf-accent)');
    rerender(<SegmentedControl aria-label="Line" options={OPTIONS} value="solid" edge="accent" onValueChange={() => {}} />);
    expect(solid().className).toContain('var(--bf-accent)');
    expect(solid().className).toContain('focus-visible:outline-offset-1');
  });

  it('active segment: light primary fill, dark text, no outline, no bottom edge (user decision 2026-10-26)', () => {
    const { rerender } = render(<SegmentedControl aria-label="Line" options={OPTIONS} value="solid" onValueChange={() => {}} />);
    const solid = () => screen.getByRole('radio', { name: 'Solid' });
    const cls = () => solid().className.split(/\s+/);
    expect(cls()).toContain('bg-primary');
    expect(cls()).toContain('text-primary-foreground');
    // Hover on the selected item brightens to --foreground.
    expect(cls()).toContain('hover:bg-[hsl(var(--foreground))]');
    // At rest there is no outline; hover adds a 1px dark inner frame (a form
    // cue: the fill step alone is only 1.16:1).
    expect(cls().filter((c) => c.includes('inset_0_0_0_1px') && !/^(hover|data-\[force-hover\]):/.test(c))).toEqual([]);
    expect(cls()).toContain('hover:shadow-[inset_0_0_0_1px_hsl(var(--primary-foreground))]');
    expect(solid().className).not.toContain('inset_0_-2px');
    expect(cls()).not.toContain('bg-bf-bg-active');
    // Forced colors: a Highlight frame stands in for the fill.
    expect(solid().className).toContain('forced-colors:after:border-[Highlight]');
    // The focus ring keeps a dark gap so amber never touches the light fill.
    expect(cls()).toContain('focus-visible:shadow-[0_0_0_1px_var(--bf-bg-app)]');
    const dashed = screen.getByRole('radio', { name: 'Dashed' }).className.split(/\s+/);
    expect(dashed).not.toContain('bg-primary');
    // The switcher exception keeps raised fill + amber bottom edge, no light fill.
    rerender(<SegmentedControl aria-label="Line" options={OPTIONS} value="solid" edge="accent" onValueChange={() => {}} />);
    expect(solid().className).toContain('shadow-[inset_0_-2px_0_var(--bf-accent)]');
    expect(cls()).toContain('bg-bf-bg-active');
    expect(cls()).not.toContain('bg-primary');
    expect(cls()).not.toContain('focus-visible:shadow-[0_0_0_1px_var(--bf-bg-app)]');
  });

  it('a disabled selected segment keeps the on fill at the shared disabled opacity', () => {
    render(<SegmentedControl aria-label="Line" options={OPTIONS} value="solid" disabled onValueChange={() => {}} />);
    const solid = screen.getByRole('radio', { name: 'Solid' });
    expect(solid).toBeDisabled();
    expect(solid.className).toContain('bg-primary');
    expect(solid.className).toContain('disabled:opacity-50');
  });

  it('manual activation: arrows move focus only; Enter/Space (click) select', () => {
    const onValueChange = vi.fn();
    render(
      <SegmentedControl
        aria-label="Mode"
        activation="manual"
        options={OPTIONS}
        value="solid"
        onValueChange={onValueChange}
      />,
    );
    const solid = screen.getByRole('radio', { name: 'Solid' });
    const dashed = screen.getByRole('radio', { name: 'Dashed' });
    solid.focus();
    fireEvent.keyDown(solid, { key: 'ArrowRight' });
    expect(dashed).toHaveFocus();
    expect(onValueChange).not.toHaveBeenCalled();
    expect(solid).toHaveAttribute('aria-checked', 'true');
    fireEvent.keyDown(dashed, { key: 'End' });
    expect(screen.getByRole('radio', { name: 'Dotted' })).toHaveFocus();
    expect(onValueChange).not.toHaveBeenCalled();
    // Enter / Space on a native button dispatch click.
    fireEvent.click(screen.getByRole('radio', { name: 'Dotted' }));
    expect(onValueChange).toHaveBeenCalledWith('dotted');
    expect(screen.getByRole('radiogroup')).toHaveAttribute('data-activation', 'manual');
  });

  it('md size: 28px group (26px items), text-bf-sm, wider padding', () => {
    render(<SegmentedControl aria-label="Mode" size="md" options={OPTIONS} value="solid" onValueChange={() => {}} />);
    const solid = screen.getByRole('radio', { name: 'Solid' });
    expect(solid.className).toContain('h-[26px]');
    expect(solid.className).toContain('text-bf-sm');
    expect(solid.className).toContain('px-3');
  });

  it('singleLabel renders one option as plain text, not a one-segment group', () => {
    render(
      <SegmentedControl
        aria-label="Plot mode"
        data-testid="pm"
        singleLabel
        options={[{ value: 'pop', label: 'Population' }]}
        value="pop"
        onValueChange={() => {}}
      />,
    );
    expect(screen.queryByRole('radiogroup')).toBeNull();
    expect(screen.queryByRole('radio')).toBeNull();
    const el = screen.getByTestId('pm');
    expect(el).toHaveTextContent('Population');
    expect(el).toHaveAttribute('data-single-label');
    expect(el).not.toHaveAttribute('aria-label');
  });

  it('items are 24px targets even for one letter (24px tall items)', () => {
    render(
      <SegmentedControl
        aria-label="Axis"
        options={[
          { value: 'x', label: 'X' },
          { value: 'y', label: 'Y' },
        ]}
        value="x"
        onValueChange={() => {}}
      />,
    );
    const x = screen.getByRole('radio', { name: 'X' });
    expect(x.className).toContain('min-w-6');
    expect(x.className.split(/\s+/)).toContain('h-6');
  });

  it('warns in development when the radiogroup has no name', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    // @ts-expect-error -- the type requires aria-label or aria-labelledby
    render(<SegmentedControl options={OPTIONS} value="solid" onValueChange={() => {}} />);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('unnamed radiogroup'));
    warn.mockRestore();
  });
});

describe('bf SegmentedControl per-option hooks', () => {
  it('puts testId and data-* on each segment', () => {
    render(
      <SegmentedControl
        aria-label="Mode"
        value="a"
        onValueChange={() => {}}
        options={[
          { value: 'a', label: 'A', testId: 'mode-a', data: { 'data-active': 'true' } },
          { value: 'b', label: 'B', testId: 'mode-b', data: { 'data-active': 'false' } },
        ]}
      />,
    );
    expect(screen.getByTestId('mode-a')).toBe(screen.getByRole('radio', { name: 'A' }));
    expect(screen.getByTestId('mode-a')).toHaveAttribute('data-active', 'true');
    expect(screen.getByTestId('mode-b')).toHaveAttribute('data-active', 'false');
    expect(screen.getByTestId('mode-a')).toHaveAttribute('data-state', 'on');
  });
});
