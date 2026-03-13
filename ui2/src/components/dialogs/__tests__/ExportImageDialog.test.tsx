import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ExportImageDialog } from '../ExportImageDialog';
import { useExportDialogStore } from '@/stores/exportDialogStore';

const { captureActiveViewMock, transportInvokeMock } = vi.hoisted(() => ({
  captureActiveViewMock: vi.fn(),
  transportInvokeMock: vi.fn(),
}));

vi.mock('@/services/ViewExportService', () => ({
  getViewExportService: () => ({
    captureActiveView: captureActiveViewMock,
  }),
}));

vi.mock('@/services/transport', () => ({
  getTransport: () => ({
    invoke: transportInvokeMock,
  }),
}));

describe('ExportImageDialog', () => {
  beforeEach(() => {
    captureActiveViewMock.mockReset();
    transportInvokeMock.mockReset();
    vi.stubGlobal('URL', {
      ...URL,
      createObjectURL: vi.fn(() => 'blob:preview'),
      revokeObjectURL: vi.fn(),
    });

    useExportDialogStore.setState({
      isOpen: false,
      isCapturing: false,
      error: null,
      format: 'png',
      transparentBackground: false,
      suggestedName: '',
      bytes: null,
      mime: null,
      imageUrl: null,
    });
  });

  it('captures a preview on open and saves bytes through the backend transport', async () => {
    captureActiveViewMock.mockResolvedValue({
      bytes: new Uint8Array([1, 2, 3]),
      mime: 'image/png',
      suggestedName: 'slice.png',
      componentType: 'slice',
      componentState: null,
    });
    transportInvokeMock.mockResolvedValue('/tmp/slice.png');

    useExportDialogStore.getState().open();
    render(<ExportImageDialog />);

    await waitFor(() => {
      expect(captureActiveViewMock).toHaveBeenCalledWith({
        format: 'png',
        transparentBackground: false,
      });
    });

    expect(await screen.findByAltText('Captured view preview')).toBeInTheDocument();
    expect(screen.getByDisplayValue('slice.png')).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Save…' }));
    });

    await waitFor(() => {
      expect(transportInvokeMock).toHaveBeenCalledWith('save_image_bytes', {
        bytes: [1, 2, 3],
        suggestedName: 'slice.png',
      });
    });
    expect(useExportDialogStore.getState().isOpen).toBe(false);
  });

  it('keeps the dialog open and disables close affordances while saving', async () => {
    captureActiveViewMock.mockResolvedValue({
      bytes: new Uint8Array([9, 8, 7]),
      mime: 'image/png',
      suggestedName: 'surface.png',
      componentType: 'surface',
      componentState: null,
    });

    let resolveSave: ((value: string | null) => void) | null = null;
    transportInvokeMock.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveSave = resolve;
        })
    );

    useExportDialogStore.getState().open();
    render(<ExportImageDialog />);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Save…' })).toBeEnabled();
    });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Save…' }));
    });

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Saving…' })).toBeDisabled();
      expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();
      expect(screen.getByRole('button', { name: 'Close modal' })).toBeDisabled();
    });

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.getByRole('dialog')).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(screen.getByRole('dialog').parentElement!);
    });
    expect(screen.getByRole('dialog')).toBeInTheDocument();

    resolveSave?.('/tmp/surface.png');

    await waitFor(() => {
      expect(useExportDialogStore.getState().isOpen).toBe(false);
    });
  });
});
