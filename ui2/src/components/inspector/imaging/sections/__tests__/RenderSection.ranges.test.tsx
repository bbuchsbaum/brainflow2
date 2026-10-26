import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { create } from 'zustand';
import type { SceneItem } from '@/types/sceneItem';
import { installNumericInputGuard } from '@/utils/numericInput';

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
const fraction = (input: HTMLInputElement) =>
  (Number(input.value) - Number(input.min)) / (Number(input.max) - Number(input.min));

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
    const row = intensityLow.parentElement as HTMLElement;
    expect(row.textContent).toBe('−6to6');
    expect(row.textContent).not.toMatch(/[–—]/);
  });

  describe('Intensity slider: the ruler is frozen during an interaction', () => {
    it('pointer drag: the domain does not move and the thumb tracks the value 1:1', () => {
      render(<RenderSection item={item} />);
      const low = screen.getByRole('slider', { name: 'Intensity low' }) as HTMLInputElement;
      expect([Number(low.min), Number(low.max)]).toEqual([-6, 6.15]);
      const span = 6.15 - -6;

      fireEvent.pointerDown(low);
      for (const v of [-5.88, -5.64, -5.28, -4.88, -4.2]) {
        fireEvent.change(low, { target: { value: String(v) } });
        expect(layer().intensity[0]).toBeCloseTo(v, 6);
        // Domain unchanged under the drag…
        expect([Number(low.min), Number(low.max)]).toEqual([-6, 6.15]);
        // …so the thumb position is exactly the value's position on it.
        expect(fraction(low)).toBeCloseTo((v - -6) / span, 6);
      }
      // A 3 px drag on a 330 px track moves the thumb by 3 px.
      const before = fraction(low) * 330;
      const v3 = Number(low.value) + (3 / 330) * span;
      fireEvent.change(low, { target: { value: String(v3) } });
      expect(fraction(low) * 330 - before).toBeCloseTo(3, 0);

      act(() => {
        window.dispatchEvent(new Event('pointerup'));
      });
      fireEvent.blur(low);
      // Interaction over: the ruler is recomputed (data ∪ window).
      expect(Number(low.min)).toBeCloseTo(-4.58, 6);
    });

    it('keyboard: arrows move the thumb, Home / End reach the true ends', () => {
      render(<RenderSection item={item} />);
      const low = screen.getByRole('slider', { name: 'Intensity low' }) as HTMLInputElement;
      const high = screen.getByRole('slider', { name: 'Intensity high' }) as HTMLInputElement;
      fireEvent.focus(low);
      // Arrows step by span / 200 on the frozen ruler; the thumb follows.
      const step = 12.15 / 200;
      expect(low.step).toBe('any');
      fireEvent.keyDown(low, { key: 'ArrowRight' });
      fireEvent.keyDown(low, { key: 'ArrowRight' });
      expect(layer().intensity[0]).toBeCloseTo(-6 + 2 * step, 9);
      expect(Number(low.min)).toBe(-6);
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
      const high = screen.getByRole('slider', { name: 'Threshold high' }) as HTMLInputElement;
      fireEvent.focus(high);
      fireEvent.keyDown(high, { key: 'End' });
      expect(layer().threshold[1]).toBe(6.15);
    });
  });

  describe('value chips accept the displayed minus', () => {
    const editChip = (name: RegExp) => {
      fireEvent.click(screen.getByRole('button', { name }));
      return screen.getByRole('spinbutton', { name: name.source.replace(/\\/g, '').split(':')[0] }) as HTMLInputElement;
    };

    it('pasting "−1.5" (U+2212) into Threshold low gives -1.5, not 1.5', () => {
      render(<RenderSection item={item} />);
      const input = editChip(/Threshold low/);
      fireEvent.paste(input, { clipboardData: { getData: () => '−1.5' } });
      expect(input.value).toBe('-1.5');
      fireEvent.keyDown(input, { key: 'Enter' });
      expect(layer().threshold).toEqual([-1.5, 2.3]);
    });

    it('typing a minus-like dash inserts ASCII "-"', () => {
      render(<RenderSection item={item} />);
      const input = editChip(/Threshold low/);
      fireEvent.change(input, { target: { value: '' } });
      // (jsdom sanitises a lone "-" in a number field to "", so insert "−1".)
      const ev = new InputEvent('beforeinput', { data: '−1', inputType: 'insertText', cancelable: true, bubbles: true });
      input.dispatchEvent(ev);
      expect(ev.defaultPrevented).toBe(true);
      expect(input.value).toBe('-1');
      fireEvent.keyDown(input, { key: 'Enter' });
      expect(layer().threshold).toEqual([-1, 2.3]);
    });

    it('a paste that is not a number is refused and shown invalid; the value is unchanged', () => {
      render(<RenderSection item={item} />);
      const input = editChip(/Threshold low/);
      fireEvent.paste(input, { clipboardData: { getData: () => '1-2' } });
      expect(input.value).toBe('-2.3');
      expect(input).toHaveAttribute('data-numeric-invalid', 'true');
      fireEvent.keyDown(input, { key: 'Enter' });
      expect(layer().threshold).toEqual([-2.3, 2.3]);
    });

    it('Enter on an unparseable draft keeps the editor open and marks it invalid', () => {
      render(<RenderSection item={item} />);
      const input = editChip(/Intensity low/);
      fireEvent.change(input, { target: { value: '' } });
      Object.defineProperty(input, 'validity', { value: { badInput: true }, configurable: true });
      fireEvent.change(input, { target: { value: '' } });
      fireEvent.keyDown(input, { key: 'Enter' });
      expect(input).toHaveAttribute('aria-invalid', 'true');
      expect(layer().intensity).toEqual([-6, 6]);
    });
  });
});
