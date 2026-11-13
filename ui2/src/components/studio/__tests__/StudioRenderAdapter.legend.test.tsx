/**
 * The Deck's and pane A's legend shows the member's symmetric window in full:
 * the ends "−0.0145" and "0.0145" (not "0.01"), 0 marked where the form has
 * room, the true minus sign. Views outside the Studio keep the short labels.
 */
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { measureColorbar } from '@/components/views/viewportFrame/colorbarMeasure';
import { useOverlayColorbar } from '@/components/views/viewportFrame/useOverlayColorbar';
import { ViewportColorbarStrip } from '@/components/views/viewportFrame/ViewportColorbarStrip';
import { useLayerStore } from '@/stores/layerStore';
import { useViewStateStore } from '@/stores/viewStateStore';

// The slice view: a probe drawing the legend the hooks give it, in the strip
// form (beside the slice slider) and with the full form's ticks listed.
function Probe() {
  const bar = useOverlayColorbar();
  if (!bar) return null;
  const ticks = measureColorbar(bar).measure(160).ticks;
  return (
    <div>
      <ViewportColorbarStrip layer={bar} rowWidth={400} />
      <ul data-testid="full-ticks">
        {ticks.map((tick) => (
          <li key={tick.value} data-kind={tick.kind}>
            {tick.label}
          </li>
        ))}
      </ul>
      <span data-testid="caption">{measureColorbar(bar).exprParts?.join(' ')}</span>
    </div>
  );
}
vi.mock('@/components/views/FlexibleSlicePanel', () => ({ FlexibleSlicePanel: () => <Probe /> }));
vi.mock('@/components/views/OrthogonalViewContainer', () => ({ OrthogonalViewContainer: () => null }));
vi.mock('@/components/views/SurfaceViewPanelLazy', () => ({ SurfaceViewPanel: () => null }));
vi.mock('@/hooks/useStudioMemberRenderScope', () => ({ useStudioMemberRenderScope: () => {} }));

import { StudioRenderAdapter } from '../StudioRenderAdapter';

function showMember(threshold: [number, number]) {
  const state = useViewStateStore.getState();
  act(() =>
    useViewStateStore.setState({
      viewState: {
        ...state.viewState,
        layers: [
          {
            id: 'member',
            name: 'member',
            volumeId: 'member',
            visible: true,
            opacity: 1,
            colormap: 'fmri',
            intensity: [-0.0145, 0.0145],
            threshold,
          },
        ] as never,
      },
    } as never),
  );
}

beforeEach(() => {
  useLayerStore.setState({
    layers: [{ id: 'member', name: 'member', volumeId: 'member', visible: true, order: 0, sourcePath: '/m/s01.nii' }],
    layerMetadata: new Map([['member', { dataRange: { min: -0.0145, max: 0.0145 } }]]),
    selectedLayerId: 'member',
  } as never);
  showMember([-0.00145, 0.00145]);
});
afterEach(cleanup);

it('the Studio legend writes the symmetric window in full, with 0 marked and the true minus', () => {
  render(
    <StudioRenderAdapter supportKind="volume" title="" subtitle="" hideChrome plane="axial" memberSourcePath="/m/s01.nii" describeBase />,
  );
  // The strip beside the slider: the two window ends, tabular numerals.
  const strip = screen.getByTestId('viewport-colorbar');
  const ends = [...strip.querySelectorAll('[data-tick-kind="window"]')].map((node) => node.textContent);
  expect(ends).toEqual(['−0.0145', '0.0145']);
  expect(strip.className).toContain('tabular-nums');
  expect(strip.querySelector('[data-testid="viewport-colorbar-hidden-band"]')).not.toBeNull();
  // The margin block: the window ends and the edges of the hidden band,
  // which sit either side of zero (they take the room a "0" label would).
  const ticks = [...screen.getByTestId('full-ticks').querySelectorAll('li')];
  expect(ticks.map((tick) => tick.textContent)).toEqual(['0.0145', '0.00145', '−0.00145', '−0.0145']);
  expect(screen.getByTestId('caption')).toHaveTextContent('|value| ≤ 0.00145');
});

it('0 is marked when nothing near it is hidden', () => {
  showMember([0, 0]);
  render(
    <StudioRenderAdapter supportKind="volume" title="" subtitle="" hideChrome plane="axial" memberSourcePath="/m/s01.nii" describeBase />,
  );
  const ticks = [...screen.getByTestId('full-ticks').querySelectorAll('li')];
  expect(ticks.map((tick) => [tick.dataset.kind, tick.textContent])).toEqual([
    ['window', '0.0145'],
    ['zero', '0'],
    ['window', '−0.0145'],
  ]);
});

it('a view outside the Studio keeps the short labels', () => {
  const layer = {
    layerId: 'member',
    name: 'member',
    colormap: 'fmri',
    intensity: [-0.0145, 0.0145] as const,
    threshold: [-0.00145, 0.00145] as const,
  };
  const short = measureColorbar(layer).measure(160, true).ticks.map((tick) => tick.label);
  expect(short).toEqual(['0.01', '−0.01']);
  const precise = measureColorbar({ ...layer, preciseTicks: true }).measure(160, true).ticks;
  expect(precise.map((tick) => tick.label)).toEqual(['0.0145', '−0.0145']);
});

it('Studio ticks keep three significant digits, not the four of a pointer readout', () => {
  const layer = {
    layerId: 'member',
    name: 'member',
    colormap: 'fmri',
    intensity: [-0.012345, 1.23456] as const,
    threshold: [-0.0012345, 0.0012345] as const,
    preciseTicks: true,
  };
  const labels = measureColorbar(layer).measure(160, true).ticks.map((tick) => tick.label);
  expect(labels).toEqual(['1.23', '−0.0123']);
  expect(measureColorbar(layer, { value: 0.45678 }).valueLabel).toBe('0.457');
});
