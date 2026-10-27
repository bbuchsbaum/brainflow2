import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ExportImageDialog } from '../ExportImageDialog';
import { useExportDialogStore } from '@/stores/exportDialogStore';
import { EXPORT_PRESETS } from '@/services/export/compositeExport';

const { captureCompositeMock, captureActiveViewMock } = vi.hoisted(() => ({
  captureCompositeMock: vi.fn(),
  captureActiveViewMock: vi.fn(),
}));

vi.mock('@/services/ViewExportService', () => ({
  getViewExportService: () => ({
    captureActiveView: captureActiveViewMock,
    saveImageBytes: vi.fn(),
  }),
}));

vi.mock('@/services/export/compositeCapture', () => ({
  availableExportTargets: () => ['axial', 'sagittal', 'coronal', 'orthogonal'],
  defaultExportTarget: () => 'axial',
  EXPORT_TARGET_LABEL: {
    axial: 'Axial',
    sagittal: 'Sagittal',
    coronal: 'Coronal',
    orthogonal: 'Orthogonal layout',
    mosaic: 'Mosaic',
  },
  captureComposite: captureCompositeMock,
  currentMosaicExportSource: () => null,
  MAX_EXPORT_TILES: 100,
  clampMosaicRange: (_s: unknown, spec: unknown) => spec,
}));

describe('ExportImageDialog composited export (P3.8)', () => {
  beforeEach(() => {
    captureCompositeMock.mockReset();
    captureActiveViewMock.mockReset();
    vi.stubGlobal('URL', {
      ...URL,
      createObjectURL: vi.fn(() => 'blob:preview'),
      revokeObjectURL: vi.fn(),
    });
    captureCompositeMock.mockImplementation(async (target: string, format: string, request) => {
      const scale =
        request.size.kind === 'screen' ? request.size.scale : ((request.size.widthMm / 25.4) * request.size.dpi) / 520;
      return {
        bytes: new Uint8Array([1]),
        mime: 'image/png',
        suggestedName: `zmap_${target}_50.5mm.${format}`,
        exportTarget: target,
        width: Math.round(520 * scale),
        height: Math.round(300 * scale),
        dpi: request.size.kind === 'print' ? request.size.dpi : null,
        warning: null,
        target: { label: target, viewType: target, aspect: 1 },
      };
    });
    useExportDialogStore.setState({
      isOpen: false,
      isCapturing: false,
      error: null,
      format: 'png',
      suggestedName: '',
      nameEdited: false,
      exportTarget: null,
      composite: { ...EXPORT_PRESETS.figure },
      size: { kind: 'screen', scale: 2 },
      provenance: false,
      mosaicTiles: { kind: 'page' },
      cropToBrain: true,
      mosaicColumns: null,
      outputSize: null,
      bytes: null,
      mime: null,
      imageUrl: null,
    });
  });

  it('composes the default view (Figure, 2× screen) and states the output size', async () => {
    useExportDialogStore.getState().open();
    render(<ExportImageDialog />);
    await waitFor(() =>
      expect(captureCompositeMock).toHaveBeenCalledWith('axial', 'png', {
        frame: EXPORT_PRESETS.figure,
        size: { kind: 'screen', scale: 2 },
        provenance: false,
        mosaicTiles: { kind: 'page' },
        cropToBrain: true,
        mosaicColumns: null,
        // A superseded preview is abandoned through this signal (review R3).
        signal: expect.any(AbortSignal),
      }),
    );
    expect(captureActiveViewMock).not.toHaveBeenCalled();
    expect(await screen.findByTestId('export-size')).toHaveTextContent('PNG · 1040 × 600 px · 2× screen');
  });

  it('abandons a superseded preview capture (its signal aborts) when options change (review R3)', async () => {
    useExportDialogStore.getState().open();
    render(<ExportImageDialog />);
    await waitFor(() => expect(captureCompositeMock).toHaveBeenCalledTimes(1));
    const first = captureCompositeMock.mock.calls[0][2] as { signal: AbortSignal };
    expect(first.signal.aborted).toBe(false);
    act(() => useExportDialogStore.getState().setSize({ kind: 'screen', scale: 3 }));
    expect(first.signal.aborted).toBe(true);
    // The new capture starts after the debounce.
    await waitFor(() => expect(captureCompositeMock).toHaveBeenCalledTimes(2));
  });

  it('states a print size in mm at its dpi and asks for provenance', async () => {
    useExportDialogStore.getState().open();
    render(<ExportImageDialog />);
    await waitFor(() => expect(captureCompositeMock).toHaveBeenCalled());
    await act(async () => {
      fireEvent.click(screen.getByRole('radio', { name: 'Print' }));
    });
    await waitFor(() =>
      expect(screen.getByTestId('export-size')).toHaveTextContent('PNG · 1051 × 606 px · 89 × 51 mm at 300 dpi'),
    );
    await act(async () => {
      fireEvent.click(screen.getByRole('checkbox', { name: 'Embed provenance in the file' }));
    });
    await waitFor(() =>
      expect(captureCompositeMock).toHaveBeenLastCalledWith(
        'axial',
        'png',
        expect.objectContaining({ provenance: true, size: { kind: 'print', widthMm: 89, dpi: 300 } }),
      ),
    );
  });

  it('applies the As shown preset, a scale and a layout target', async () => {
    useExportDialogStore.getState().open();
    render(<ExportImageDialog />);
    await waitFor(() => expect(captureCompositeMock).toHaveBeenCalled());
    await act(async () => {
      fireEvent.click(screen.getByRole('radio', { name: 'As shown' }));
    });
    await waitFor(() =>
      expect(captureCompositeMock).toHaveBeenLastCalledWith(
        'axial',
        'png',
        expect.objectContaining({ frame: EXPORT_PRESETS.shown }),
      ),
    );
    await act(async () => {
      fireEvent.click(screen.getByRole('radio', { name: '4 times' }));
    });
    await waitFor(() =>
      expect(captureCompositeMock).toHaveBeenLastCalledWith(
        'axial',
        'png',
        expect.objectContaining({ size: { kind: 'screen', scale: 4 } }),
      ),
    );
    await act(async () => {
      useExportDialogStore.getState().setExportTarget('orthogonal');
    });
    await waitFor(() =>
      expect(captureCompositeMock).toHaveBeenLastCalledWith('orthogonal', 'png', expect.anything()),
    );
  });

  it('shows the checkerboard only for a transparent background', async () => {
    useExportDialogStore.getState().open();
    render(<ExportImageDialog />);
    await waitFor(() => expect(captureCompositeMock).toHaveBeenCalled());
    expect(screen.getByTestId('export-preview').className).not.toContain('bf-checkerboard');
    await act(async () => {
      useExportDialogStore.getState().setComposite({ background: 'transparent' });
    });
    expect(screen.getByTestId('export-preview').className).toContain('bf-checkerboard');
  });
});
