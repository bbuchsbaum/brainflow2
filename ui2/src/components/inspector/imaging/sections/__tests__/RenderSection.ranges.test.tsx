import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { create } from 'zustand';
import type { SceneItem } from '@/types/sceneItem';
import { installNumericInputGuard } from '@/utils/numericInput';

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

// Minimal live stores: RenderSection writes the window / threshold through
// `setViewState(draft => …)` and must re-render from the result.
interface VL {
  id: string;
  name: string;
  visible: boolean;
  opacity: number;
  colormap: string;
  intensity: [number, number];
  threshold: [number, number];
}
const viewStore = vi.hoisted(() => ({ current: null as any }));
const layerStoreRef = vi.hoisted(() => ({ current: null as any }));

vi.mock('@/stores/viewStateStore', async () => {
  const { create: createStore } = await import('zustand');
  const store = createStore<any>((set, get) => ({
    viewState: { layers: [] as VL[], crosshair: { world_mm: [0, 0, 0] } },
    setViewState: (fn: (draft: any) => void) => {
      const draft = structuredClone(get().viewState);
      fn(draft);
      set({ viewState: draft });
    },
  }));
  viewStore.current = store;
  return { useViewStateStore: store };
});

vi.mock('@/stores/layerStore', async () => {
  const { create: createStore } = await import('zustand');
  const store = createStore<any>(() => ({
    layers: [{ id: 'z', name: 'zstat1', type: 'volume', visible: true }],
    layerMetadata: new Map([['z', { dataRange: { min: -4.58, max: 6.15 } }]]),
    updateLayer: vi.fn(),
    selectLayer: vi.fn(),
  }));
  layerStoreRef.current = store;
  return { useLayerStore: store };
});

vi.mock('@/services/SamplingService', () => ({ sampleLayerAtWorld: vi.fn(async () => ({ value: null })) }));

import { RenderSection } from '../RenderSection';

const item: SceneItem = {
  id: 'z',
  kind: 'volume-overlay',
  group: 'volume',
  name: 'zstat1',
  subtitle: '',
  visible: true,
  opacity: 1,
  ref: { type: 'volume', layerId: 'z' },
} as SceneItem;

function reset() {
  viewStore.current.setState({
    viewState: {
      layers: [
        {
          id: 'z',
          name: 'zstat1',
          visible: true,
          opacity: 1,
          colormap: 'fmri_redblue',
          intensity: [-6, 6],
          threshold: [-2.3, 2.3],
        },
      ],
      crosshair: { world_mm: [0, 0, 0] },
    },
  });
}

const layer = () => viewStore.current.getState().viewState.layers[0] as VL;
// The thumbs are ARIA sliders (ui/bf RangeSlider): the ruler is
// aria-valuemin of the low thumb .. aria-valuemax of the high thumb, and the
// thumb's x is its `left` percentage on the ruler box.
const num = (el: HTMLElement, attr: string) => Number(el.getAttribute(attr));
const thumb = (name: string) => screen.getByRole('slider', { name });
const domainOf = (label: 'Intensity' | 'Threshold') => [
  num(thumb(`${label} low`), 'aria-valuemin'),
  num(thumb(`${label} high`), 'aria-valuemax'),
];
const fraction = (el: HTMLElement) => Number.parseFloat(el.style.left) / 100;

/** Give every slider box a 330 px width so pointer x maps onto the ruler. */
function sizeBoxes(container: HTMLElement, width = 330) {
  container.querySelectorAll<HTMLElement>('[data-slider-box]').forEach((box) => {
    box.getBoundingClientRect = () =>
      ({ left: 0, width, top: 0, height: 24, right: width, bottom: 24, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;
  });
}

describe('Inspector ranges', () => {
  let uninstall: () => void;
  beforeEach(() => {
    reset();
    uninstall = installNumericInputGuard(document);
  });
  afterEach(() => uninstall());

  it('separates range ends with "to", never a dash', () => {
    render(<RenderSection item={item} />);
    const intensityLow = screen.getByRole('button', { name: /Intensity low/ });
    const row = intensityLow.closest('[data-testid="range-readout"]') as HTMLElement;
    expect(row.textContent).toBe('−6to6');
    expect(row.textContent).not.toMatch(/[–—]/);
  });

  it('the readout is one right-aligned group on the label line, above the track', () => {
    render(<RenderSection item={item} />);
    for (const label of ['Intensity', 'Threshold']) {
      const lowChip = screen.getByRole('button', { name: new RegExp(`^${label} low`) });
      const highChip = screen.getByRole('button', { name: new RegExp(`^${label} high`) });
      const readout = lowChip.closest('[data-testid="range-readout"]') as HTMLElement;
      // Both chips and the joiner in one group…
      expect(readout).toContainElement(highChip);
      // …on the label's line (same row as the <label>), not under the track.
      const labelLine = readout.parentElement!.parentElement as HTMLElement;
      expect(labelLine.querySelector('label')?.textContent).toBe(label);
      const slider = thumb(`${label} low`);
      expect(labelLine.contains(slider)).toBe(false);
      expect(
        labelLine.compareDocumentPosition(slider) & Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
    }
  });

  it('marks the data range under both tracks and captions the hidden band', () => {
    const { container } = render(<RenderSection item={item} />);
    const ticks = container.querySelectorAll<HTMLElement>('[data-testid="slider-data-tick"]');
    // Two marks per range (Intensity, Threshold) at the data min / max on the shared ruler.
    expect(ticks).toHaveLength(4);
    const span = 6.15 - -6;
    expect(Number.parseFloat(ticks[0].style.left) / 100).toBeCloseTo((-4.58 - -6) / span, 6);
    expect(Number.parseFloat(ticks[1].style.left) / 100).toBeCloseTo(1, 6);
    const band = container.querySelector<HTMLElement>('[data-testid="slider-hidden-band"]')!;
    expect(Number.parseFloat(band.style.left) / 100).toBeCloseTo((-2.3 - -6) / span, 6);
    expect(screen.getByTestId('threshold-caption').textContent).toBe('|value| ≤ 2.3 hidden');
    // The colormap strip's cut-out uses the same fractions.
    const strip = container.querySelector<HTMLElement>('[data-testid="colormap-strip-hidden-band"]')!;
    expect(strip.style.left).toBe(band.style.left);
    expect(strip.style.width).toBe(band.style.width);
  });

  it('names and value texts: ASCII minus for assistive tech', () => {
    render(<RenderSection item={item} />);
    expect(thumb('Intensity low')).toHaveAttribute('aria-valuetext', '-6');
    expect(thumb('Threshold low')).toHaveAttribute('aria-valuetext', '-2.3');
    expect(thumb('Threshold high')).toHaveAttribute('aria-valuetext', '2.3');
    expect(thumb('Opacity')).toHaveAttribute('aria-valuetext', '100%');
  });

  describe('Intensity slider: the ruler is frozen during an interaction', () => {
    it('pointer drag: the domain does not move and the thumb tracks the value 1:1', () => {
      const { container } = render(<RenderSection item={item} />);
      sizeBoxes(container);
      const low = thumb('Intensity low');
      expect(domainOf('Intensity')).toEqual([-6, 6.15]);
      const span = 6.15 - -6;
      const strip = (low.closest('[data-slider-box]') as HTMLElement).parentElement!;
      const x = (v: number) => ((v - -6) / span) * 330;

      fireEvent.pointerDown(strip, { button: 0, clientX: x(-5.88), pointerId: 1 });
      for (const v of [-5.88, -5.64, -5.28, -4.88, -4.2]) {
        fireEvent.pointerMove(strip, { clientX: x(v), pointerId: 1 });
        expect(layer().intensity[0]).toBeCloseTo(v, 6);
        // Domain unchanged under the drag (also on the other range)…
        expect(domainOf('Intensity')).toEqual([-6, 6.15]);
        expect(domainOf('Threshold')).toEqual([-6, 6.15]);
        // …so the thumb position is exactly the value's position on it.
        expect(fraction(thumb('Intensity low'))).toBeCloseTo((v - -6) / span, 6);
      }
      // A 3 px drag on a 330 px track moves the thumb by 3 px.
      const before = fraction(thumb('Intensity low')) * 330;
      fireEvent.pointerMove(strip, { clientX: x(-4.2) + 3, pointerId: 1 });
      expect(fraction(thumb('Intensity low')) * 330 - before).toBeCloseTo(3, 6);

      fireEvent.pointerUp(strip, { clientX: x(-4.2) + 3, pointerId: 1 });
      fireEvent.blur(low);
      // Interaction over: the ruler stays data ∪ window ∪ the window first
      // seen for the layer, so it does not shrink to the data min (−4.58).
      expect(domainOf('Intensity')).toEqual([-6, 6.15]);
    });

    it('between interactions the ruler does not shrink: Home after a narrowing returns to the original window end', () => {
      render(<RenderSection item={item} />);
      const low = thumb('Intensity low');
      fireEvent.focus(low);
      for (let i = 0; i < 3; i++) fireEvent.keyDown(low, { key: 'PageUp' });
      expect(layer().intensity[0]).toBeCloseTo(-6 + 30 * (12.15 / 200), 9);
      fireEvent.blur(low);
      // Window now inside the data range on the low side; the ruler keeps −6.
      expect(layer().intensity[0]).toBeGreaterThan(-4.58);
      expect(domainOf('Intensity')).toEqual([-6, 6.15]);
      expect(domainOf('Threshold')).toEqual([-6, 6.15]);
      fireEvent.focus(low);
      fireEvent.keyDown(low, { key: 'Home' });
      expect(layer().intensity[0]).toBe(-6);
      fireEvent.blur(low);
    });

    it('the layer default window (load-time render props) is always on the ruler', () => {
      const meta = layerStoreRef.current.getState().layerMetadata as Map<string, unknown>;
      const prev = meta.get('z');
      layerStoreRef.current.setState({
        layerMetadata: new Map([
          ['z', { dataRange: { min: -4.58, max: 6.15 }, renderProps: { intensity: [-8, 7] } }],
        ]),
      });
      try {
        render(<RenderSection item={item} />);
        expect(domainOf('Intensity')).toEqual([-8, 7]);
      } finally {
        act(() => layerStoreRef.current.setState({ layerMetadata: new Map([['z', prev]]) }));
      }
    });

    it('keyboard: arrows move the thumb, Home / End reach the true ends', () => {
      render(<RenderSection item={item} />);
      const low = thumb('Intensity low');
      const high = thumb('Intensity high');
      fireEvent.focus(low);
      // Arrows step by span / 200 on the frozen ruler, never snapped to a grid
      // (the former step="any"); the thumb follows.
      const step = 12.15 / 200;
      fireEvent.keyDown(low, { key: 'ArrowRight' });
      fireEvent.keyDown(low, { key: 'ArrowRight' });
      expect(layer().intensity[0]).toBeCloseTo(-6 + 2 * step, 9);
      expect(num(low, 'aria-valuemin')).toBe(-6);
      expect(fraction(low)).toBeCloseTo((2 * step) / 12.15, 9);
      fireEvent.keyDown(low, { key: 'ArrowLeft' });
      expect(layer().intensity[0]).toBeCloseTo(-6 + step, 9);
      fireEvent.keyDown(low, { key: 'Home' });
      expect(layer().intensity[0]).toBe(-6);
      expect(fraction(low)).toBe(0);
      fireEvent.blur(low);

      fireEvent.focus(high);
      fireEvent.keyDown(high, { key: 'End' });
      expect(layer().intensity[1]).toBe(6.15);
      expect(fraction(high)).toBe(1);
      fireEvent.keyDown(high, { key: 'Home' });
      // Clamped to low ≤ high.
      expect(layer().intensity[1]).toBe(-6);
    });

    it('Threshold high End lands on the ruler end, not one step short', () => {
      render(<RenderSection item={item} />);
      const high = thumb('Threshold high');
      fireEvent.focus(high);
      fireEvent.keyDown(high, { key: 'End' });
      expect(layer().threshold[1]).toBe(6.15);
    });
  });

  it('opacity keeps the 0.01 grid of the former native range', () => {
    render(<RenderSection item={item} />);
    const opacity = thumb('Opacity');
    fireEvent.focus(opacity);
    fireEvent.keyDown(opacity, { key: 'ArrowLeft' });
    fireEvent.keyDown(opacity, { key: 'ArrowLeft' });
    fireEvent.keyDown(opacity, { key: 'ArrowLeft' });
    expect(layer().opacity).toBe(0.97);
  });

  // The value chips are ui/bf ValueChips: a text field that parses its own
  // text (`parseNumericText`), so U+2212 and other minus-like dashes are
  // accepted however they arrive (typed, pasted, dropped).
  describe('value chips accept the displayed minus', () => {
    const editChip = (label: string) => {
      fireEvent.click(screen.getByRole('button', { name: new RegExp(`^${label}:`) }));
      return screen.getByRole('textbox', { name: label }) as HTMLInputElement;
    };

    it('a pasted "−1.5" (U+2212) in Threshold low gives -1.5, not 1.5', () => {
      render(<RenderSection item={item} />);
      const input = editChip('Threshold low');
      expect(input.value).toBe('-2.3');
      // The chip handles its own paste: the document guard leaves the text alone…
      const paste = fireEvent.paste(input, { clipboardData: { getData: () => '−1.5' } });
      expect(paste).toBe(true);
      // …and the browser inserts it as typed text (jsdom does not, so do it here).
      fireEvent.change(input, { target: { value: '−1.5' } });
      fireEvent.keyDown(input, { key: 'Enter' });
      expect(layer().threshold).toEqual([-1.5, 2.3]);
    });

    it('typing a minus-like dash inserts ASCII "-"', () => {
      render(<RenderSection item={item} />);
      const input = editChip('Threshold low');
      fireEvent.change(input, { target: { value: '' } });
      const ev = new InputEvent('beforeinput', { data: '−1', inputType: 'insertText', cancelable: true, bubbles: true });
      input.dispatchEvent(ev);
      expect(ev.defaultPrevented).toBe(true);
      expect(input.value).toBe('-1');
      fireEvent.keyDown(input, { key: 'Enter' });
      expect(layer().threshold).toEqual([-1, 2.3]);
    });

    it('text that is not a number is refused and shown invalid; the value is unchanged', () => {
      render(<RenderSection item={item} />);
      const input = editChip('Threshold low');
      fireEvent.change(input, { target: { value: '1-2' } });
      fireEvent.keyDown(input, { key: 'Enter' });
      expect(input).toHaveAttribute('aria-invalid', 'true');
      // The message is tied to the editor and sits in flow UNDER the slider
      // (a polite live region), never floated over the track and thumbs.
      const msgId = input.getAttribute('aria-describedby')!;
      const msg = document.getElementById(msgId)!;
      expect(msg).toHaveTextContent('Not a number');
      expect(msg.closest('[aria-live="polite"]')).not.toBeNull();
      const slider = screen.getAllByRole('slider', { name: /Threshold/ })[0];
      expect(slider.compareDocumentPosition(msg) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      expect(msg.className).not.toMatch(/absolute/);
      expect(layer().threshold).toEqual([-2.3, 2.3]);
      // Escape reverts and closes the editor.
      fireEvent.keyDown(input, { key: 'Escape' });
      expect(screen.queryByRole('textbox', { name: 'Threshold low' })).toBeNull();
      expect(layer().threshold).toEqual([-2.3, 2.3]);
    });

    it('Enter on an unparseable draft keeps the editor open and marks it invalid', () => {
      render(<RenderSection item={item} />);
      const input = editChip('Intensity low');
      fireEvent.change(input, { target: { value: '12 mm' } });
      fireEvent.keyDown(input, { key: 'Enter' });
      expect(screen.getByRole('textbox', { name: 'Intensity low' })).toHaveAttribute('aria-invalid', 'true');
      expect(layer().intensity).toEqual([-6, 6]);
    });

    it('a typed value beyond the other end clamps to it (low ≤ high)', () => {
      render(<RenderSection item={item} />);
      const input = editChip('Threshold low');
      fireEvent.change(input, { target: { value: '5' } });
      fireEvent.keyDown(input, { key: 'Enter' });
      expect(layer().threshold).toEqual([2.3, 2.3]);
    });
  });
});
