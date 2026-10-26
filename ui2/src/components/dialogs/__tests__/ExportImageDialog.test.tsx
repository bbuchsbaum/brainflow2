import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ExportImageDialog } from '../ExportImageDialog';
import { useExportDialogStore } from '@/stores/exportDialogStore';

const { captureActiveViewMock, saveImageBytesMock } = vi.hoisted(() => ({
  captureActiveViewMock: vi.fn(),
  saveImageBytesMock: vi.fn(),
}));

vi.mock('@/services/ViewExportService', () => ({
  getViewExportService: () => ({
    captureActiveView: captureActiveViewMock,
    saveImageBytes: saveImageBytesMock,
  }),
}));

describe('ExportImageDialog', () => {
  beforeEach(() => {
    captureActiveViewMock.mockReset();
    saveImageBytesMock.mockReset();
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
    saveImageBytesMock.mockResolvedValue('/tmp/slice.png');

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
      expect(saveImageBytesMock).toHaveBeenCalledWith(new Uint8Array([1, 2, 3]), 'slice.png');
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
    saveImageBytesMock.mockImplementation(
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
      // aria-disabled, not disabled: focus stays on it during the save (v3 function critic).
      expect(screen.getByRole('button', { name: 'Saving…' })).toHaveAttribute('aria-disabled', 'true');
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
  it('keeps the dialog open without an error when the save dialog is cancelled', async () => {
    captureActiveViewMock.mockResolvedValue({
      bytes: new Uint8Array([4, 4]),
      mime: 'image/jpeg',
      suggestedName: 'slice.jpg',
      componentType: 'slice',
      componentState: null,
    });
    saveImageBytesMock.mockResolvedValue(null);

    useExportDialogStore.getState().open();
    render(<ExportImageDialog />);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Save…' })).toBeEnabled();
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Save…' }));
    });

    await waitFor(() => expect(saveImageBytesMock).toHaveBeenCalledTimes(1));
    expect(useExportDialogStore.getState().isOpen).toBe(true);
    expect(useExportDialogStore.getState().error).toBeNull();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save…' })).toBeEnabled();
  });

  it('shows a save failure inline and keeps the dialog open', async () => {
    captureActiveViewMock.mockResolvedValue({
      bytes: new Uint8Array([5]),
      mime: 'image/png',
      suggestedName: 'slice.png',
      componentType: 'slice',
      componentState: null,
    });
    saveImageBytesMock.mockRejectedValue(new Error('Permission denied'));

    useExportDialogStore.getState().open();
    render(<ExportImageDialog />);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Save…' })).toBeEnabled();
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Save…' }));
    });

    expect(await screen.findByRole('alert')).toHaveTextContent('Permission denied');
    expect(useExportDialogStore.getState().isOpen).toBe(true);
  });
});

describe('ExportImageDialog mount', () => {
  // Regression guard (P3 item 1): the dialog existed but was never mounted, so
  // "Export View as Image…" opened the store and nothing appeared. The App
  // shell is too heavy to render here; assert the single global mount.
  it('is mounted once, globally, in the App shell', () => {
    const app = readFileSync(resolve(__dirname, '../../../App.tsx'), 'utf8');
    expect(app.match(/<ExportImageDialog\s*\/>/g)).toHaveLength(1);
  });

  it('renders nothing until the store opens it, then the dialog', async () => {
    captureActiveViewMock.mockResolvedValue({
      bytes: new Uint8Array([1]),
      mime: 'image/png',
      suggestedName: 'a.png',
      componentType: 'slice',
      componentState: null,
    });
    useExportDialogStore.setState({ isOpen: false, bytes: null, imageUrl: null, error: null });
    render(<ExportImageDialog />);
    expect(screen.queryByRole('dialog')).toBeNull();
    await act(async () => {
      useExportDialogStore.getState().open();
    });
    expect(await screen.findByRole('dialog', { name: 'Export view' })).toBeInTheDocument();
  });
});

describe('ExportImageDialog v1 critiques', () => {
  beforeEach(() => {
    captureActiveViewMock.mockReset();
    saveImageBytesMock.mockReset();
    vi.stubGlobal('URL', { ...URL, createObjectURL: vi.fn(() => 'blob:preview'), revokeObjectURL: vi.fn() });
    useExportDialogStore.setState({
      isOpen: false, isCapturing: false, error: null, format: 'png', transparentBackground: false,
      suggestedName: '', nameEdited: false, viewType: null, target: null, bytes: null, mime: null, imageUrl: null,
    });
    captureActiveViewMock.mockImplementation(async ({ format, viewType }: { format: string; viewType?: string }) => ({
      bytes: new Uint8Array([1]),
      mime: format === 'jpg' ? 'image/jpeg' : 'image/png',
      suggestedName: `zmap_${viewType ?? 'axial'}_50.5mm.${format}`,
      componentType: 'slice',
      componentState: null,
      target: { label: `${viewType === 'coronal' ? 'Coronal' : 'Axial'} · Orthogonal`, viewType: viewType ?? 'axial', aspect: 2 },
    }));
  });

  it('shows a plain-string save rejection in the options column as an alert', async () => {
    saveImageBytesMock.mockImplementation(() => Promise.reject('Permission denied: /Volumes/ro/out.png'));
    useExportDialogStore.getState().open();
    render(<ExportImageDialog />);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Save…' })).toBeEnabled());
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Save…' }));
    });
    const alert = await screen.findByTestId('export-error');
    expect(alert).toHaveTextContent('Permission denied: /Volumes/ro/out.png');
    expect(screen.getByTestId('export-preview')).not.toContainElement(alert);
  });

  it('names the exported view, switches planes, and keeps a typed name when the format changes', async () => {
    useExportDialogStore.getState().open();
    render(<ExportImageDialog />);
    expect(await screen.findByText('Axial · Orthogonal')).toBeInTheDocument();
    expect(screen.getByDisplayValue('zmap_axial_50.5mm.png')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('File name'), { target: { value: 'figure2a.png' } });
    await act(async () => {
      useExportDialogStore.getState().setFormat('jpg');
    });
    await waitFor(() => expect(screen.getByDisplayValue('figure2a.jpg')).toBeInTheDocument());
    await act(async () => {
      useExportDialogStore.getState().setViewType('coronal');
    });
    await waitFor(() => expect(captureActiveViewMock).toHaveBeenLastCalledWith(expect.objectContaining({ viewType: 'coronal' })));
    expect(screen.getByDisplayValue('figure2a.jpg')).toBeInTheDocument();
  });
});

