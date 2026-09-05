import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ParcelTablePreview } from '@brainflow/api';
import { ParcelTableImport } from '../ParcelTableImport';
import { parcelOverlayService } from '@/services/ParcelOverlayService';
vi.mock('@/services/ParcelOverlayService', () => ({
  parcelOverlayService: { preview: vi.fn(), create: vi.fn() },
}));
const preview: ParcelTablePreview = {
  atlasName: 'Schaefer test',
  atlasParcels: 2,
  headers: ['id', 'beta', 't'],
  columns: [
    { name: 'beta', range: [-2, 0], finiteCount: 2, missingCount: 0, error: null },
    { name: 't', range: [-4, 8], finiteCount: 2, missingCount: 0, error: null },
  ],
  rowCount: 2,
  matchedParcels: 2,
  missingParcels: 0,
  bindingError: null,
  keyExamples: ['1 · LH_Area', '7 · RH_Area'],
  dictionarySha256: 'dictionary',
  tableSha256: 'table',
};
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(parcelOverlayService.preview).mockResolvedValue(preview);
  vi.mocked(parcelOverlayService.create).mockResolvedValue();
});
afterEach(cleanup);
function renderImport() {
  const onClose = vi.fn();
  render(
    <ParcelTableImport
      sourceVolumeId="atlas"
      atlasName="Schaefer 400 · 7 networks"
      onClose={onClose}
    />,
  );
  fireEvent.change(screen.getByLabelText('Table text'), {
    target: { value: 'id,beta,t\n7,-2,8\n1,0,-4' },
  });
  return onClose;
}
async function selectColumns() {
  await waitFor(() => expect(screen.getByLabelText('Parcel key column').children.length).toBe(4));
  fireEvent.change(screen.getByLabelText('Parcel key column'), { target: { value: 'id' } });
  fireEvent.change(screen.getByLabelText('Display column'), { target: { value: 'beta' } });
}
describe('parcel table import', () => {
  it('creates only after the full mapping has been validated and retains target and selected column', async () => {
    const onClose = renderImport();
    await selectColumns();
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Create overlay' })).toBeEnabled(),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Create overlay' }));
    await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
    expect(parcelOverlayService.create).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceVolumeId: 'atlas',
        keyColumn: 'id',
        keyKind: 'id',
        allowPartial: false,
      }),
      'beta',
      'Parcel values',
    );
  });
  it('invalidates a ready preview immediately when coverage or keys change', async () => {
    renderImport();
    await selectColumns();
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Create overlay' })).toBeEnabled(),
    );
    let complete: (p: ParcelTablePreview) => void = () => {};
    vi.mocked(parcelOverlayService.preview).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          complete = resolve;
        }),
    );
    fireEvent.click(screen.getByRole('checkbox'));
    expect(screen.getByRole('button', { name: 'Create overlay' })).toBeDisabled();
    await waitFor(() =>
      expect(parcelOverlayService.preview).toHaveBeenLastCalledWith(
        expect.objectContaining({ allowPartial: true }),
      ),
    );
    await act(async () => complete({ ...preview, bindingError: 'unknown atlas key 99' }));
    expect(screen.getByText('unknown atlas key 99')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Create overlay' })).toBeDisabled();
  });
  it('ignores late validation replies from an earlier table', async () => {
    let oldReply: (p: ParcelTablePreview) => void = () => {};
    vi.mocked(parcelOverlayService.preview).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          oldReply = resolve;
        }),
    );
    renderImport();
    await waitFor(() => expect(parcelOverlayService.preview).toHaveBeenCalledOnce());
    vi.mocked(parcelOverlayService.preview).mockResolvedValue({
      ...preview,
      bindingError: 'new table is invalid',
    });
    fireEvent.change(screen.getByLabelText('Table text'), { target: { value: 'id,beta\n99,2' } });
    await waitFor(() => expect(screen.getByText('new table is invalid')).toBeInTheDocument());
    await act(async () => oldReply(preview));
    expect(screen.getByText('new table is invalid')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Create overlay' })).toBeDisabled();
  });
});
