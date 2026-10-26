import { describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { RangeSlider, Slider } from '../Slider';
import { makeRuler, rulerDomain } from '../helpers';

// jsdom has no PointerEvent: give pointer events their MouseEvent fields (button, clientX).
if (typeof window.PointerEvent === 'undefined') {
  class PointerEventPolyfill extends MouseEvent {
    pointerId: number;
    constructor(type: string, init: PointerEventInit = {}) {
      super(type, init);
      this.pointerId = init.pointerId ?? 1;
    }
  }
  (window as unknown as { PointerEvent: typeof MouseEvent }).PointerEvent = PointerEventPolyfill;
}

describe('ruler', () => {
  it('maps values to clamped fractions and back', () => {
    const r = makeRuler(-6, 6.15);
    expect(r.toFraction(-6)).toBe(0);
    expect(r.toFraction(6.15)).toBe(1);
    expect(r.toFraction(100)).toBe(1);
    expect(r.fromFraction(0.5)).toBeCloseTo(0.075);
    expect(makeRuler(3, 3).toFraction(3)).toBe(0);
  });

  it('domain is the union of values and only grows with a frozen domain', () => {
    expect(rulerDomain([-4.58, 6.15, -6, 6])).toEqual([-6, 6.15]);
    expect(rulerDomain([-5.5, 6], [-6, 6.15])).toEqual([-6, 6.15]);
    expect(rulerDomain([NaN])).toEqual([0, 1]);
  });
});

describe('bf Slider', () => {
  it('is a named slider with ASCII value text', () => {
    render(<Slider label="Opacity" min={-1} max={1} value={-0.5} onValueChange={() => {}} />);
    const s = screen.getByRole('slider', { name: 'Opacity' });
    expect(s).toHaveAttribute('aria-valuenow', '-0.5');
    expect(s).toHaveAttribute('aria-valuetext', '-0.5');
    expect(s).toHaveAttribute('aria-valuemin', '-1');
    expect(s).toHaveAttribute('aria-valuemax', '1');
  });

  it('steps exactly from an off-grid value; Page ×10; Home/End reach the ends', () => {
    const onValueChange = vi.fn();
    render(<Slider label="x" min={0} max={10} step={0.5} value={3.33} onValueChange={onValueChange} />);
    const s = screen.getByRole('slider');
    fireEvent.keyDown(s, { key: 'ArrowRight' });
    expect(onValueChange).toHaveBeenLastCalledWith(3.83);
    fireEvent.keyDown(s, { key: 'PageDown' });
    expect(onValueChange).toHaveBeenLastCalledWith(0);
    fireEvent.keyDown(s, { key: 'End' });
    expect(onValueChange).toHaveBeenLastCalledWith(10);
  });

  it('does not move when disabled and is not a tab stop', () => {
    const onValueChange = vi.fn();
    render(<Slider label="x" min={0} max={10} value={3} disabled onValueChange={onValueChange} />);
    const s = screen.getByRole('slider');
    expect(s).toHaveAttribute('tabindex', '-1');
    expect(s).toHaveAttribute('aria-disabled', 'true');
    fireEvent.keyDown(s, { key: 'ArrowRight' });
    expect(onValueChange).not.toHaveBeenCalled();
  });

  it('shows the value with the display minus, LTR-isolated', () => {
    render(<Slider label="x" min={-5} max={5} value={-2.3} showValue onValueChange={() => {}} />);
    const readout = screen.getByText('−2.3');
    expect(readout).toHaveAttribute('dir', 'ltr');
  });

  it('draws the data range as two short marks BELOW the track, with tooltips', () => {
    render(<Slider label="x" min={-6} max={6.15} dataRange={[-4.58, 6.15]} value={0} onValueChange={() => {}} />);
    const ticks = screen.getAllByTestId('slider-data-tick');
    expect(ticks).toHaveLength(2);
    expect(parseFloat(ticks[1].style.left)).toBeCloseTo(100);
    // Anchored to the bottom of the 24px strip: outside the 3px track and the 12-14px thumb.
    expect(ticks[0].className).toContain('bottom-0');
    expect(ticks[0].className).toContain('h-[5px]');
    expect(ticks[0]).toHaveAttribute('title', 'data min −4.58');
  });

  it('aria-valuenow carries no float noise', () => {
    render(<Slider label="x" min={0} max={1} step={0.005} value={0.5650000000000001} onValueChange={() => {}} />);
    expect(screen.getByRole('slider')).toHaveAttribute('aria-valuenow', '0.565');
  });

  it('onValueCommit fires on key release; onDragChange never fires for keyboard', () => {
    const commits: number[] = [];
    const drags: boolean[] = [];
    function H() {
      const [v, setV] = useState(1);
      return (
        <Slider
          label="x"
          min={0}
          max={10}
          step={1}
          value={v}
          onValueChange={setV}
          onValueCommit={(c) => commits.push(c)}
          onDragChange={(d) => drags.push(d)}
        />
      );
    }
    render(<H />);
    const s = screen.getByRole('slider');
    act(() => s.focus());
    fireEvent.keyDown(s, { key: 'ArrowRight' });
    fireEvent.keyDown(s, { key: 'ArrowRight' });
    expect(commits).toEqual([]);
    fireEvent.keyUp(s, { key: 'ArrowRight' });
    expect(commits).toEqual([3]);
    expect(drags).toEqual([]);
  });

  it('pointer drag: onDragChange true/false around the drag, one commit on release', () => {
    const commits: number[] = [];
    const drags: boolean[] = [];
    function H() {
      const [v, setV] = useState(0);
      return (
        <Slider
          label="x"
          min={0}
          max={100}
          value={v}
          onValueChange={setV}
          onValueCommit={(c) => commits.push(c)}
          onDragChange={(d) => drags.push(d)}
        />
      );
    }
    const { container } = render(<H />);
    const box = container.querySelector('[data-slider-box]') as HTMLElement;
    box.getBoundingClientRect = () => ({ left: 0, width: 100, top: 0, height: 24, right: 100, bottom: 24, x: 0, y: 0, toJSON: () => ({}) });
    const strip = box.parentElement!;
    fireEvent.pointerDown(strip, { button: 0, clientX: 20, pointerId: 1 });
    expect(drags).toEqual([true]);
    fireEvent.pointerMove(strip, { clientX: 40, pointerId: 1 });
    fireEvent.pointerUp(strip, { clientX: 40, pointerId: 1 });
    expect(drags).toEqual([true, false]);
    expect(commits).toEqual([40]);
  });

  it('separate domain: the ruler spans `domain`, the value clamps to [min, max]', () => {
    const onValueChange = vi.fn();
    render(<Slider label="x" min={-2} max={2} domain={[-6, 6]} value={0} onValueChange={onValueChange} />);
    const s = screen.getByRole('slider');
    expect(s.style.left).toBe('50%');
    fireEvent.keyDown(s, { key: 'Home' });
    expect(onValueChange).toHaveBeenLastCalledWith(-2);
    expect(s).toHaveAttribute('aria-valuemin', '-2');
  });

  it('freezes the domain while focused so a shrinking window never ratchets it', () => {
    const onInteraction = vi.fn();
    const { rerender } = render(
      <Slider label="x" min={-6} max={6} value={0} onInteraction={onInteraction} onValueChange={() => {}} />,
    );
    const s = screen.getByRole('slider');
    act(() => s.focus());
    expect(onInteraction).toHaveBeenLastCalledWith(true, [-6, 6]);
    rerender(<Slider label="x" min={-5} max={5} value={0} onInteraction={onInteraction} onValueChange={() => {}} />);
    expect(s).toHaveAttribute('aria-valuemin', '-6');
    act(() => s.blur());
    expect(onInteraction).toHaveBeenLastCalledWith(false, [-6, 6]);
    expect(s).toHaveAttribute('aria-valuemin', '-5');
  });

  it('rail variant: no fill, custom value text', () => {
    render(
      <Slider
        variant="rail"
        label="Axial slice position"
        min={-72}
        max={90}
        step={2}
        value={17.5}
        valueText={(v) => `z = ${v.toFixed(1)} mm`}
        onValueChange={() => {}}
      />,
    );
    expect(screen.queryByTestId('slider-fill')).toBeNull();
    expect(screen.getByRole('slider', { name: 'Axial slice position' })).toHaveAttribute(
      'aria-valuetext',
      'z = 17.5 mm',
    );
  });
});

describe('bf RangeSlider', () => {
  function Harness({ mode }: { mode?: 'shown' | 'hidden' }) {
    const [v, setV] = useState<[number, number]>([-2.3, 2.3]);
    return <RangeSlider label="Threshold" min={-6} max={6} step={1} mode={mode} value={v} onValueChange={setV} />;
  }

  it('names both thumbs and keeps low ≤ high', () => {
    render(<Harness />);
    const low = screen.getByRole('slider', { name: 'Threshold low' });
    const high = screen.getByRole('slider', { name: 'Threshold high' });
    fireEvent.keyDown(low, { key: 'End' });
    expect(low).toHaveAttribute('aria-valuenow', '2.3');
    fireEvent.keyDown(high, { key: 'Home' });
    expect(high).toHaveAttribute('aria-valuenow', '2.3');
    fireEvent.keyDown(low, { key: 'Home' });
    expect(low).toHaveAttribute('aria-valuenow', '-6');
  });

  it('hidden mode draws the hatched cut-out; shown mode a fill', () => {
    const { unmount } = render(<Harness mode="hidden" />);
    expect(screen.getByTestId('slider-hidden-band')).toBeInTheDocument();
    expect(screen.queryByTestId('slider-fill')).toBeNull();
    unmount();
    render(<Harness mode="shown" />);
    expect(screen.getByTestId('slider-fill')).toBeInTheDocument();
  });

  it('shows the range with "to", never a dash', () => {
    render(<RangeSlider label="Intensity" min={-6} max={6} value={[-6, 6]} showValue onValueChange={() => {}} />);
    expect(screen.getByText('−6 to 6')).toBeInTheDocument();
  });

  it('threshold mode lightly fills the kept segments', () => {
    render(<Harness mode="hidden" />);
    expect(screen.getAllByTestId('slider-kept')).toHaveLength(2);
  });

  it('range thumbs are bounded by each other (APG multi-thumb)', () => {
    render(<Harness />);
    expect(screen.getByRole('slider', { name: 'Threshold low' })).toHaveAttribute('aria-valuemax', '2.3');
    expect(screen.getByRole('slider', { name: 'Threshold high' })).toHaveAttribute('aria-valuemin', '-2.3');
  });

  function Coincident() {
    const [v, setV] = useState<[number, number]>([0, 0]);
    return <RangeSlider label="Threshold" mode="hidden" min={-10} max={10} value={v} onValueChange={setV} />;
  }
  function grabCentre(container: HTMLElement) {
    const box = container.querySelector('[data-slider-box]') as HTMLElement;
    box.getBoundingClientRect = () => ({ left: 0, width: 200, top: 0, height: 24, right: 200, bottom: 24, x: 0, y: 0, toJSON: () => ({}) });
    return box.parentElement!;
  }

  it('coincident thumbs separate to the RIGHT (high thumb follows)', () => {
    const { container } = render(<Coincident />);
    const strip = grabCentre(container);
    fireEvent.pointerDown(strip, { button: 0, clientX: 100, pointerId: 1 });
    fireEvent.pointerMove(strip, { clientX: 130, pointerId: 1 });
    fireEvent.pointerUp(strip, { clientX: 130, pointerId: 1 });
    expect(screen.getByRole('slider', { name: 'Threshold low' })).toHaveAttribute('aria-valuenow', '0');
    expect(screen.getByRole('slider', { name: 'Threshold high' })).toHaveAttribute('aria-valuenow', '3');
  });

  it('coincident thumbs separate to the LEFT (low thumb follows)', () => {
    const { container } = render(<Coincident />);
    const strip = grabCentre(container);
    fireEvent.pointerDown(strip, { button: 0, clientX: 100, pointerId: 1 });
    fireEvent.pointerMove(strip, { clientX: 70, pointerId: 1 });
    fireEvent.pointerUp(strip, { clientX: 70, pointerId: 1 });
    expect(screen.getByRole('slider', { name: 'Threshold low' })).toHaveAttribute('aria-valuenow', '-3');
    expect(screen.getByRole('slider', { name: 'Threshold high' })).toHaveAttribute('aria-valuenow', '0');
  });

  it('editable chips: Enter commits, Escape reverts, bad text is invalid with a message', () => {
    const commits: Array<[number, number]> = [];
    function H() {
      const [v, setV] = useState<[number, number]>([-2, 2]);
      return (
        <RangeSlider
          label="Intensity"
          min={-6}
          max={6}
          value={v}
          editable
          valuePlacement="below"
          caption="|value| ≤ 2 hidden"
          onValueChange={setV}
          onValueCommit={(c) => commits.push(c)}
        />
      );
    }
    render(<H />);
    expect(screen.getByText('|value| ≤ 2 hidden')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Intensity low: -2, edit' }));
    const input = screen.getByRole('textbox', { name: 'Intensity low' }) as HTMLInputElement;
    expect(input.value).toBe('-2');
    fireEvent.change(input, { target: { value: '12 mm' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(input).toHaveAccessibleDescription('Not a number');
    fireEvent.change(input, { target: { value: '−1.5' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(commits).toEqual([[-1.5, 2]]);
    expect(screen.getByRole('slider', { name: 'Intensity low' })).toHaveAttribute('aria-valuenow', '-1.5');
    fireEvent.click(screen.getByRole('button', { name: 'Intensity high: 2, edit' }));
    const hi = screen.getByRole('textbox', { name: 'Intensity high' });
    fireEvent.change(hi, { target: { value: '5' } });
    fireEvent.keyDown(hi, { key: 'Escape' });
    expect(screen.getByRole('slider', { name: 'Intensity high' })).toHaveAttribute('aria-valuenow', '2');
    expect(commits).toHaveLength(1);
  });
});

describe('bf Slider gap fixes (snap precision, hidden-band activity)', () => {
  const rect = (width: number) => () =>
    ({ left: 0, width, top: 0, height: 24, right: width, bottom: 24, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;

  it('pointer snap results carry the grid precision, not float noise', () => {
    const onValueChange = vi.fn();
    const { container } = render(
      <Slider label="Opacity" min={0} max={1} step={0.01} snap={0.01} value={0.5} onValueChange={onValueChange} />,
    );
    const box = container.querySelector('[data-slider-box]') as HTMLElement;
    box.getBoundingClientRect = rect(100);
    const strip = box.parentElement!;
    // 0.07 * k would produce 0.07000000000000001 without rounding.
    for (const x of [7, 29, 57, 83]) {
      fireEvent.pointerDown(strip, { button: 0, clientX: x, pointerId: 1 });
      fireEvent.pointerUp(strip, { clientX: x, pointerId: 1 });
      expect(onValueChange).toHaveBeenLastCalledWith(Number((x / 100).toFixed(2)));
    }
  });

  it('half-step snap from a non-zero anchor (crosshair thickness 1..5 by 0.5)', () => {
    const onValueChange = vi.fn();
    const { container } = render(
      <Slider label="Thickness" min={1} max={5} step={0.5} snap={0.5} value={2} onValueChange={onValueChange} />,
    );
    const box = container.querySelector('[data-slider-box]') as HTMLElement;
    box.getBoundingClientRect = rect(80);
    const strip = box.parentElement!;
    fireEvent.pointerDown(strip, { button: 0, clientX: 49, pointerId: 1 });
    fireEvent.pointerUp(strip, { clientX: 49, pointerId: 1 });
    expect(onValueChange).toHaveBeenLastCalledWith(3.5);
  });

  it('snapToPrecision keeps a long anchor exact and cleans only the grid offset', async () => {
    const { snapToPrecision } = await import('../helpers');
    expect(snapToPrecision(0.1 + 0.2, 0.1)).toBe(0.3);
    expect(snapToPrecision(0.5 + 0.07, 0.01, 0.5)).toBe(0.57);
    const anchor = -4.58123456789;
    expect(snapToPrecision(anchor + 3 * 0.1, 0.1, anchor)).toBe(anchor + 0.3);
  });

  it('hiddenActive={false} draws no hatch and reads the whole track as kept', () => {
    const { rerender } = render(
      <RangeSlider label="Threshold" min={-6} max={6} mode="hidden" hiddenActive={false} value={[0, 0]} onValueChange={() => {}} />,
    );
    expect(screen.queryByTestId('slider-hidden-band')).toBeNull();
    expect(screen.getAllByTestId('slider-kept')).toHaveLength(1);
    // [0, 100] is the backend's other "no threshold" sentinel: still no hatch.
    rerender(
      <RangeSlider label="Threshold" min={-6} max={100} mode="hidden" hiddenActive={false} value={[0, 100]} onValueChange={() => {}} />,
    );
    expect(screen.queryByTestId('slider-hidden-band')).toBeNull();
    // Without the prop the legacy rule (high > low) still applies.
    rerender(
      <RangeSlider label="Threshold" min={-6} max={100} mode="hidden" value={[0, 100]} onValueChange={() => {}} />,
    );
    expect(screen.getByTestId('slider-hidden-band')).toBeInTheDocument();
    rerender(
      <RangeSlider label="Threshold" min={-6} max={6} mode="hidden" hiddenActive value={[-2, 2]} onValueChange={() => {}} />,
    );
    expect(screen.getByTestId('slider-hidden-band')).toBeInTheDocument();
    expect(screen.getAllByTestId('slider-kept')).toHaveLength(2);
  });
});
