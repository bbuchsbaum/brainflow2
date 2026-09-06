import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { PopulationExportControls } from '../PopulationExportControls';
import type { PopulationSliceDisplay } from '@/services/studio/PopulationSliceService';
const { freeze, save, replay } = vi.hoisted(() => ({
  freeze: vi.fn(),
  save: vi.fn(),
  replay: vi.fn(),
}));
vi.mock('@/services/studio/PopulationExportService', () => ({
  freezePopulationExport: freeze,
  populationExportService: { chooseAndExport: save, chooseAndReplay: replay },
}));
const display = { query: { request: { workingMemberIds: ['a'] } } } as PopulationSliceDisplay;
beforeEach(() => {
  freeze.mockReset().mockReturnValue({ population: {} });
  save.mockReset();
  replay.mockReset();
});
it('disables stale or empty views and presents saved bundle paths', async () => {
  const { rerender } = render(<PopulationExportControls display={display} current={false} />);
  expect(screen.getByRole('button', { name: 'Export summary…' })).toBeDisabled();
  rerender(<PopulationExportControls display={display} current />);
  save.mockResolvedValue({ directory: '/output/population-1' });
  fireEvent.click(screen.getByRole('button', { name: 'Export summary…' }));
  await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('/output/population-1'));
  expect(freeze).toHaveBeenCalledWith(display);
});
it('keeps cancellation available during native work and cancels on unmount', async () => {
  let finish!: (v: null) => void;
  save.mockImplementation(
    () =>
      new Promise((r) => {
        finish = r;
      }),
  );
  const { unmount } = render(<PopulationExportControls display={display} current />);
  fireEvent.click(screen.getByRole('button', { name: 'Export summary…' }));
  const signal = save.mock.calls[0][1] as AbortSignal;
  fireEvent.click(screen.getByRole('button', { name: 'Cancel export' }));
  expect(signal.aborted).toBe(true);
  unmount();
  await act(async () => finish(null));
});
it('shows readable validation errors and allows retry', async () => {
  freeze.mockImplementation(() => {
    throw new Error('Source revision changed. Refresh the view.');
  });
  render(<PopulationExportControls display={display} current />);
  fireEvent.click(screen.getByRole('button', { name: 'Export summary…' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Source revision changed');
  expect(screen.getByRole('button', { name: 'Export summary…' })).toBeEnabled();
  expect(save).not.toHaveBeenCalled();
});

it('recalculates a saved record even without a current display and shows verified completion', async () => {
  replay.mockResolvedValue({ directory: '/replayed' });
  render(<PopulationExportControls display={null} current={false} />);
  fireEvent.click(screen.getByRole('button', { name: 'Recalculate saved summary…' }));
  expect(await screen.findByRole('status')).toHaveTextContent(
    'Verified recalculation saved to /replayed',
  );
  expect(freeze).not.toHaveBeenCalled();
  expect(replay).toHaveBeenCalledWith(expect.any(AbortSignal));
});
