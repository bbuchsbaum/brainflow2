import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ViewportHeader } from '../ViewportHeader';
import { ViewportColorbar } from '../ViewportColorbar';
import { chooseColorbarLayerId, colorbarNameLabel, resolveColorbarLayer } from '../useOverlayColorbar';
import type { LayerInfo } from '@/stores/layerStore';
import type { ViewLayer } from '@/types/viewState';

describe('ViewportHeader', () => {
  it('shows plane, slice mm and layer in a full-size view', () => {
    render(<ViewportHeader plane="axial" positionMm={17.5} layerName="Motor zstat1" width={600} height={300} />);
    const header = screen.getByTestId('viewport-header');
    expect(header).toHaveTextContent('Axial');
    expect(header).toHaveTextContent('z 17.5 mm');
    expect(screen.getByTestId('viewport-header-name')).toHaveTextContent('Motor zstat1');
    expect(header).toHaveAttribute('aria-label', 'Axial, z 17.5 mm, Motor zstat1');
    // Never reaches the top-centre orientation letter.
    expect(header.style.maxWidth).toBe('286px');
  });

  it('lets clicks through everywhere, the name included', () => {
    render(<ViewportHeader plane="axial" positionMm={17.5} layerName="Motor zstat1" width={600} height={300} />);
    expect(screen.getByTestId('viewport-header').className).toContain('pointer-events-none');
    expect(screen.getByTestId('viewport-header-name').className).not.toContain('pointer-events-auto');
  });

  it('uses the full form in a wide, short pane (density by width)', () => {
    render(<ViewportHeader plane="axial" positionMm={17.5} layerName={null} width={915} height={140} />);
    expect(screen.getByTestId('viewport-header')).toHaveAttribute('data-density', 'full');
  });

  it('is a labelled group for assistive tech', () => {
    render(<ViewportHeader plane="axial" positionMm={-0.5} layerName="MNI152_T1_2mm_brain.nii.gz" width={600} height={300} />);
    const header = screen.getByRole('group', { name: /Axial, z −0.5 mm, MNI152_T1_2mm_brain\.nii\.gz/ });
    expect(header).toBeInTheDocument();
  });

  it('collapses to the compact form (same 0.1 mm) and then hides', () => {
    const { rerender } = render(
      <ViewportHeader plane="sagittal" positionMm={-0.5} layerName="x" width={136} height={300} rangeMm={[-95.5, 94.5]} />,
    );
    expect(screen.getByTestId('viewport-header').textContent).toBe('x \u22120.5');
    rerender(<ViewportHeader plane="sagittal" positionMm={-0.5} layerName="x" width={80} height={300} />);
    expect(screen.queryByTestId('viewport-header')).toBeNull();
    rerender(<ViewportHeader plane="sagittal" positionMm={-0.5} layerName="x" width={600} height={89} />);
    expect(screen.queryByTestId('viewport-header')).toBeNull();
  });
});

const overlay = {
  layerId: 'stat',
  name: 'Motor zstat1',
  colormap: 'fmri',
  intensity: [-6, 6] as const,
  threshold: [-2.3, 2.3] as const,
  dataRange: { min: -4.58, max: 6.15 },
};

describe('ViewportColorbar', () => {
  it('names its layer in a top caption when it is not the active layer', () => {
    expect(colorbarNameLabel(overlay, 'base')).toBe('Motor zstat1');
    expect(colorbarNameLabel({ layerId: 'stat', name: 'zstat1.nii.gz' }, 'base')).toBe('zstat1');
    expect(colorbarNameLabel(overlay, 'stat')).toBeNull();
    const { rerender } = render(
      <ViewportColorbar layer={{ ...overlay, nameLabel: 'Motor zstat1' }} width={900} height={320} value={6.15} />,
    );
    const box = screen.getByTestId('viewport-colorbar');
    const name = screen.getByTestId('viewport-colorbar-name');
    expect(name).toHaveTextContent('Motor zstat1');
    // First line of the box: above the bar group.
    expect(box.firstElementChild).toBe(name);
    rerender(<ViewportColorbar layer={overlay} width={900} height={320} value={6.15} />);
    expect(screen.queryByTestId('viewport-colorbar-name')).toBeNull();
  });

  it('describes the window as a range with "to" in its accessible label', () => {
    render(<ViewportColorbar layer={overlay} width={900} height={320} />);
    expect(screen.getByTestId('viewport-colorbar').getAttribute('aria-label')).toContain('−6 to 6');
  });

  it('draws ticks, the hatched hidden band and the wording', () => {
    render(<ViewportColorbar layer={overlay} width={900} height={320} />);
    const bar = screen.getByTestId('viewport-colorbar');
    expect(bar).toHaveAttribute('aria-label', expect.stringContaining('|value| ≤ 2.3 hidden'));
    // Caption: at most two lines (the box widens to the expression).
    const caption = screen.getByTestId('viewport-colorbar-caption');
    expect(Array.from(caption.children).map((c) => c.textContent)).toEqual(['|value| ≤ 2.3', 'hidden']);
    expect(screen.getByTestId('viewport-colorbar-hidden-band')).toBeInTheDocument();
    for (const label of ['≥ 6', '2.3', '0', '−2.3', '−6']) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
    expect(bar.style.bottom).toBe('8px');
  });

  it('flips to the top-right when the crosshair centre is under it', () => {
    render(<ViewportColorbar layer={overlay} width={900} height={400} avoidPoint={{ x: 870, y: 340 }} topReserve={48} />);
    const bar = screen.getByTestId('viewport-colorbar');
    expect(bar.style.top).toBe('48px');
  });

  it('sits beside the image when the right margin can hold it', () => {
    render(
      <ViewportColorbar layer={overlay} width={948} height={311} imageRect={{ left: 333, top: 0, right: 615, bottom: 311 }} />,
    );
    const bar = screen.getByTestId('viewport-colorbar');
    expect(bar).toHaveAttribute('data-placement', 'beside');
    expect(bar.style.left).toBe('627px');
  });

  it('falls back to the corner when the image fills the width', () => {
    render(
      <ViewportColorbar layer={overlay} width={469} height={311} imageRect={{ left: 20, top: 0, right: 449, bottom: 311 }} />,
    );
    expect(screen.getByTestId('viewport-colorbar')).toHaveAttribute('data-placement', 'corner');
  });

  it('draws the crosshair value as a caret, clamped to the bar', () => {
    const { rerender } = render(<ViewportColorbar layer={overlay} width={900} height={320} value={-3.71} />);
    const caret = screen.getByTestId('viewport-colorbar-caret');
    expect(caret).toHaveTextContent('−3.71');
    expect(screen.getByTestId('viewport-colorbar')).toHaveAttribute('aria-label', expect.stringContaining('value at crosshair −3.71'));
    // The value label is on the caret's side, opposite the tick labels, so a
    // value near (or clipped past) a window end never reads as a tick.
    const left = (el: HTMLElement) => Number.parseFloat(el.style.left);
    const value = screen.getByTestId('viewport-colorbar-value');
    const bar = screen.getByTestId('viewport-colorbar-bar');
    expect(left(value)).toBeLessThan(left(bar));
    expect(left(screen.getByText('−6'))).toBeGreaterThan(left(bar));
    // Clipped above the window: the true value stays visible next to the "≥ 6" end.
    rerender(<ViewportColorbar layer={overlay} width={900} height={320} value={6.15} />);
    expect(screen.getByTestId('viewport-colorbar-value')).toHaveTextContent('6.15');
    expect(screen.getByText('≥ 6')).toBeVisible();
    expect(Number.parseFloat(screen.getByTestId('viewport-colorbar-value').style.top)).toBe(
      Number.parseFloat(screen.getByText('≥ 6').style.top),
    );
    rerender(<ViewportColorbar layer={overlay} width={900} height={320} value={null} />);
    expect(screen.queryByTestId('viewport-colorbar-caret')).toBeNull();
  });

  it('keeps a clipped end visible as a swatch outside the hatch', () => {
    // Window [1, 8], threshold ±2.3: the band covers the bottom end while
    // values down to -4.58 are drawn in the window-min colour.
    render(
      <ViewportColorbar
        layer={{ ...overlay, intensity: [1, 8] as const }}
        width={900}
        height={320}
      />,
    );
    expect(screen.getByTestId('viewport-colorbar-cap-bottom')).toBeInTheDocument();
    expect(screen.queryByTestId('viewport-colorbar-cap-top')).toBeNull();
    expect(screen.getByText('≤ 1')).toBeInTheDocument();
  });

  it('is omitted when the view is too small or the colormap is unknown', () => {
    const { rerender } = render(<ViewportColorbar layer={overlay} width={900} height={120} />);
    expect(screen.queryByTestId('viewport-colorbar')).toBeNull();
    rerender(<ViewportColorbar layer={{ ...overlay, colormap: 'nope' }} width={900} height={320} />);
    expect(screen.queryByTestId('viewport-colorbar')).toBeNull();
  });
});

describe('resolveColorbarLayer', () => {
  const layers = [
    { id: 'mni', name: 'MNI', source: 'file' },
    { id: 'stat', name: 'Motor zstat1', source: 'file' },
    { id: 'atlas', name: 'Atlas', source: 'atlas' },
  ] as unknown as LayerInfo[];
  const viewLayer = (id: string, extra: Partial<ViewLayer> = {}) =>
    ({ id, name: id, volumeId: id, visible: true, opacity: 1, colormap: 'fmri', intensity: [-6, 6], threshold: [-2.3, 2.3], ...extra }) as ViewLayer;

  it('returns the selected overlay only', () => {
    expect(resolveColorbarLayer(layers, 'stat', viewLayer('stat'), true)).toMatchObject({ layerId: 'stat', units: null });
    expect(resolveColorbarLayer(layers, 'mni', viewLayer('mni'), true)).toBeNull();
    expect(resolveColorbarLayer(layers, 'atlas', viewLayer('atlas'), true)).toBeNull();
    expect(resolveColorbarLayer(layers, null, undefined, true)).toBeNull();
  });

  it('respects the setting, visibility and layer mode', () => {
    expect(resolveColorbarLayer(layers, 'stat', viewLayer('stat'), false)).toBeNull();
    expect(resolveColorbarLayer(layers, 'stat', viewLayer('stat', { visible: false }), true)).toBeNull();
    expect(resolveColorbarLayer(layers, 'stat', viewLayer('stat', { layerMode: 'label' }), true)).toBeNull();
  });
});

describe('chooseColorbarLayerId', () => {
  const layers = [
    { id: 'mni', name: 'MNI', source: 'file' },
    { id: 'stat', name: 'Motor zstat1', source: 'file' },
    { id: 'stat2', name: 'Visual zstat2', source: 'file' },
    { id: 'atlas', name: 'Atlas', source: 'atlas' },
  ] as unknown as LayerInfo[];
  const vl = (id: string, extra: Partial<ViewLayer> = {}) => ({ id, name: id, visible: true, ...extra }) as ViewLayer;

  it('prefers the selected overlay', () => {
    expect(chooseColorbarLayerId(layers, [vl('mni'), vl('stat'), vl('stat2')], 'stat')).toBe('stat');
  });

  it('falls back to the topmost visible scalar overlay when nothing or the base is selected', () => {
    const view = [vl('mni'), vl('stat'), vl('stat2'), vl('atlas')];
    expect(chooseColorbarLayerId(layers, view, null)).toBe('stat2');
    expect(chooseColorbarLayerId(layers, view, 'mni')).toBe('stat2');
    expect(chooseColorbarLayerId(layers, [vl('mni'), vl('stat'), vl('stat2', { visible: false })], 'atlas')).toBe('stat');
    expect(chooseColorbarLayerId(layers, [vl('mni')], null)).toBeNull();
  });
});

