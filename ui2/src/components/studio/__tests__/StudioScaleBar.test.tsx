import { afterEach, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { StudioScaleBar } from '../StudioScaleBar';

afterEach(cleanup);

it('fits small Compare panes and shows the window, zero and the hidden band (N10)', () => {
  const { rerender } = render(
    <StudioScaleBar min={-2} max={2} hidden={[-0.2, 0.2]} colormap="fmri" label="Mean" paneHeight={80} />,
  );
  const bar = screen.getByTestId('studio-scale-bar');
  expect(bar.getAttribute('aria-label')).toBe('Colorbar for Mean: fMRI Red-Blue, −2 to 2, −0.2 to 0.2 hidden');
  expect(bar.textContent).toBe('20−2');
  // A member's own window and colormap (pane A), no threshold.
  rerender(<StudioScaleBar min={0.43} max={1.4} hidden={[0, 0]} colormap="gray" label="s01" paneHeight={200} />);
  expect(screen.getByTestId('studio-scale-bar').textContent).toBe('1.40.43');
  // Too short a pane: nothing rather than a cramped bar.
  rerender(<StudioScaleBar min={0} max={1} colormap="gray" label="s01" paneHeight={60} />);
  expect(screen.queryByTestId('studio-scale-bar')).toBeNull();
});
