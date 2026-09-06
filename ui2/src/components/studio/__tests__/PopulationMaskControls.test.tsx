import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { PopulationMaskControls } from '../PopulationMaskControls';
import { useSetStudioStore } from '@/stores/setStudioStore';
const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock('@/services/transport', () => ({ getTransport: () => ({ invoke }) }));
beforeEach(() => {
  useSetStudioStore.setState(useSetStudioStore.getInitialState(), true);
  useSetStudioStore.getState().loadDemoSession();
  invoke.mockReset();
});
it('shows the mask, its scope and removal, preserving the focused observation', async () => {
  const focus = useSetStudioStore.getState().selection.activeMemberId;
  invoke.mockResolvedValueOnce('/data/brain-mask.nii');
  render(<PopulationMaskControls />);
  fireEvent.click(screen.getByRole('button', { name: 'Choose mask…' }));
  await waitFor(() => expect(screen.getByText('Mask: brain-mask.nii')).toBeInTheDocument());
  expect(screen.getByText(/excluded voxels are unavailable/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Clear mask' }));
  expect(screen.getByText('Mask: None · finite values included')).toBeInTheDocument();
  expect(useSetStudioStore.getState().selection.activeMemberId).toBe(focus);
});
it('reports dialog failure without enabling an unspecified mask', async () => {
  invoke.mockRejectedValueOnce(new Error('Dialog failed'));
  render(<PopulationMaskControls />);
  fireEvent.click(screen.getByRole('button', { name: 'Choose mask…' }));
  await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Dialog failed'));
  expect(useSetStudioStore.getState().population.mask).toBeNull();
});
