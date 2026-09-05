import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ParcelTablePreview, ParcelTableRequest } from '@brainflow/api';
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
  vi.mocked(parcelOverlayService.preview).mockImplementation(async (request) => ({
    ...preview,
    bindingError: request.keyColumn ? null : 'Choose a parcel key column',
  }));
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
  await waitFor(() => expect(screen.getByLabelText('Parcel key column')).toHaveValue('id'));
  await waitFor(() => expect(screen.getByLabelText('Display column')).toHaveValue('beta'));
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
    fireEvent.click(screen.getByText('Mapping options'));
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
  it('revalidates a suggested ID mapping before enabling creation', async () => {
    let complete: (p: ParcelTablePreview) => void = () => {};
    vi.mocked(parcelOverlayService.preview).mockImplementation((request) =>
      request.keyColumn
        ? new Promise((resolve) => {
            complete = resolve;
          })
        : Promise.resolve({ ...preview, bindingError: 'Choose a parcel key column' }),
    );
    renderImport();
    await waitFor(() =>
      expect(parcelOverlayService.preview).toHaveBeenLastCalledWith(
        expect.objectContaining({ keyColumn: 'id', keyKind: 'id' }),
      ),
    );
    expect(screen.getByRole('button', { name: 'Create overlay' })).toBeDisabled();
    await act(async () => complete(preview));
    expect(screen.getByLabelText('Display column')).toHaveValue('beta');
    expect(screen.getByRole('button', { name: 'Create overlay' })).toBeEnabled();
  });

  it('loads the polynomial example with safe defaults and resets a previous incorrect mapping', async () => {
    const polynomial: ParcelTablePreview = {
      ...preview,
      atlasParcels: 400,
      matchedParcels: 400,
      rowCount: 400,
      headers: ['roi_id', 'linear', 'quadratic', 'cubic'],
      columns: ['roi_id', 'linear', 'quadratic', 'cubic'].map((name, i) => ({
        name,
        range: [1, 400 ** Math.max(1, i)],
        finiteCount: 400,
        missingCount: 0,
        error: null,
      })),
    };
    vi.mocked(parcelOverlayService.preview).mockImplementation(
      async (request: ParcelTableRequest) => ({
        ...polynomial,
        bindingError:
          request.keyColumn === 'roi_id' && request.keyKind === 'id'
            ? null
            : 'Invalid Input: Invalid data: ambiguous atlas key LabelHemisphere("OFC_1", Left)',
      }),
    );
    const close = vi.fn();
    render(<ParcelTableImport sourceVolumeId="atlas" atlasName="Schaefer 400" onClose={close} />);
    const load = () =>
      fireEvent.change(screen.getByLabelText('CSV or TSV file'), {
        target: {
          files: [
            {
              name: 'schaefer400.tsv',
              size: 100,
              text: async () => 'roi_id\tlinear\tquadratic\tcubic\n1\t1\t1\t1',
            },
          ],
        },
      });
    load();
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Create overlay' })).toBeEnabled(),
    );
    expect(screen.getByLabelText('Display column')).toHaveValue('linear');
    expect(
      Array.from(screen.getByLabelText('Display column').children).map((c) => c.textContent),
    ).not.toContain('roi_id');
    expect(screen.getByText('Mapping options').parentElement).not.toHaveAttribute('open');
    fireEvent.click(screen.getByText('Mapping options'));
    fireEvent.change(screen.getByLabelText('Match parcels using'), {
      target: { value: 'label_hemi' },
    });
    fireEvent.change(screen.getByLabelText('Parcel key column'), { target: { value: 'linear' } });
    await waitFor(() =>
      expect(screen.getByText(/These labels are not unique/)).toBeInTheDocument(),
    );
    expect(screen.getByRole('button', { name: 'Create overlay' })).toBeDisabled();
    load();
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Create overlay' })).toBeEnabled(),
    );
    expect(screen.getByLabelText('Match parcels using')).toHaveValue('id');
    expect(screen.getByLabelText('Parcel key column')).toHaveValue('roi_id');
    expect(screen.getByLabelText('Display column')).toHaveValue('linear');
    fireEvent.click(screen.getByRole('button', { name: 'Create overlay' }));
    await waitFor(() => expect(close).toHaveBeenCalledOnce());
    expect(parcelOverlayService.create).toHaveBeenCalledWith(
      expect.objectContaining({
        keyKind: 'id',
        keyColumn: 'roi_id',
        delimiter: '\t',
        hemisphereColumn: null,
        networkColumn: null,
        allowPartial: false,
      }),
      'linear',
      'schaefer400.tsv',
    );
  });

  it('leaves multiple possible ID columns for the user to resolve', async () => {
    vi.mocked(parcelOverlayService.preview).mockResolvedValue({
      ...preview,
      headers: ['roi_id', 'id', 'beta'],
      bindingError: 'Choose a parcel key column',
    });
    renderImport();
    await waitFor(() => expect(screen.getByText('Choose a parcel key column')).toBeInTheDocument());
    expect(screen.getByLabelText('Parcel key column')).toHaveValue('');
    expect(screen.getByText('Mapping options').parentElement).toHaveAttribute('open');
    expect(screen.getByRole('button', { name: 'Create overlay' })).toBeDisabled();
  });
  it('keeps a valid mapping retryable after a transient creation failure', async () => {
    renderImport();
    await selectColumns();
    vi.mocked(parcelOverlayService.create).mockRejectedValueOnce(
      new Error('Temporary upload failure'),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Create overlay' }));
    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent('Temporary upload failure'),
    );
    expect(screen.getByRole('button', { name: 'Create overlay' })).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: 'Create overlay' }));
    await waitFor(() => expect(parcelOverlayService.create).toHaveBeenCalledTimes(2));
  });
  it('explains a table with keys but no display values', async () => {
    vi.mocked(parcelOverlayService.preview).mockResolvedValue({ ...preview, columns: [] });
    renderImport();
    await waitFor(() =>
      expect(screen.getByText(/No numeric display values found/)).toBeInTheDocument(),
    );
    expect(screen.getByRole('button', { name: 'Create overlay' })).toBeDisabled();
  });
});
