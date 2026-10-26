/**
 * ExportImageDialog
 *
 * Preview of the view to export (in its own aspect) and the export options:
 * which view, format, transparent background and file name. Errors show in
 * the options column (role=alert) with the backend's own reason; the footer
 * is ruled with Cancel / Save like the other dialogs. Compositing (colorbar,
 * crosshair, labels) is P3 item 8.
 */

import React, { useEffect, useRef, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { Button, FieldRow, Notice, Select, Switch, TextField } from '@/components/ui/bf';
import { Modal } from '@/components/ui/Modal';
import { getViewExportService } from '@/services/ViewExportService';
import { useExportDialogStore } from '@/stores/exportDialogStore';
import { formatTauriError } from '@/utils/formatTauriError';
import type { ViewType } from '@/types/coordinates';

const FORMAT_OPTIONS = [
  { value: 'png', label: 'PNG' },
  { value: 'jpg', label: 'JPG' },
] as const;

const VIEW_OPTIONS = [
  { value: 'axial', label: 'Axial' },
  { value: 'sagittal', label: 'Sagittal' },
  { value: 'coronal', label: 'Coronal' },
] as const;

export function ExportImageDialog() {
  const isOpen = useExportDialogStore((state) => state.isOpen);
  const imageUrl = useExportDialogStore((state) => state.imageUrl);
  const isCapturing = useExportDialogStore((state) => state.isCapturing);
  const error = useExportDialogStore((state) => state.error);
  const hasBytes = useExportDialogStore((state) => state.bytes !== null);
  const format = useExportDialogStore((state) => state.format);
  const transparentBackground = useExportDialogStore((state) => state.transparentBackground);
  const suggestedName = useExportDialogStore((state) => state.suggestedName);
  const viewType = useExportDialogStore((state) => state.viewType);
  const target = useExportDialogStore((state) => state.target);

  const setFormat = useExportDialogStore((state) => state.setFormat);
  const setTransparentBackground = useExportDialogStore((state) => state.setTransparentBackground);
  const setSuggestedName = useExportDialogStore((state) => state.setSuggestedName);
  const setViewType = useExportDialogStore((state) => state.setViewType);
  const setCapturing = useExportDialogStore((state) => state.setCapturing);
  const setError = useExportDialogStore((state) => state.setError);
  const setCaptureResult = useExportDialogStore((state) => state.setCaptureResult);
  const close = useExportDialogStore((state) => state.close);

  const bytesRef = useRef<Uint8Array | null>(null);
  const captureSeqRef = useRef(0);
  const fileNameInputRef = useRef<HTMLInputElement | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (!isOpen) return;

    const seq = ++captureSeqRef.current;
    setCapturing(true);
    setError(null);

    getViewExportService()
      .captureActiveView({
        format,
        transparentBackground: format === 'png' ? transparentBackground : false,
        viewType: viewType ?? undefined,
      })
      .then(({ bytes, mime, suggestedName: name, target: captured }) => {
        if (seq !== captureSeqRef.current) return;
        bytesRef.current = bytes;
        setCaptureResult(bytes, mime, name, captured ?? null);
      })
      .catch((err) => {
        if (seq !== captureSeqRef.current) return;
        setError(formatTauriError(err) || 'Failed to capture view');
      })
      .finally(() => {
        if (seq !== captureSeqRef.current) return;
        setCapturing(false);
      });
  }, [isOpen, format, transparentBackground, viewType, setCapturing, setError, setCaptureResult]);

  const handleSave = async () => {
    const bytes = bytesRef.current;
    if (!bytes) return;

    setIsSaving(true);
    setError(null);
    try {
      // null = the user cancelled the native save dialog: keep this dialog
      // open (they may pick another name or format) and show no error.
      const savedPath = await getViewExportService().saveImageBytes(bytes, suggestedName);
      if (savedPath) close();
    } catch (err) {
      // Tauri rejects with a plain string: keep the backend's reason.
      setError(formatTauriError(err) || 'Failed to save image');
    } finally {
      setIsSaving(false);
    }
  };

  if (!isOpen) return null;

  const selectedView = viewType ?? target?.viewType ?? null;
  // Preview in the view's own aspect (landscape for a wide pane).
  const aspect = target?.aspect && Number.isFinite(target.aspect) ? target.aspect : 4 / 3;

  return (
    <Modal
      isOpen={isOpen}
      onClose={close}
      title="Export view"
      ariaLabel="Export view"
      size="xl"
      initialFocusRef={fileNameInputRef}
      closeOnOverlayClick={!isSaving}
      closeOnEscape={!isSaving}
      closeButtonDisabled={isSaving}
      bodyClassName="p-0"
      className="max-w-3xl rounded-sm ring-1 ring-bf-border-strong shadow-2xl"
    >
      <div className="flex flex-col gap-4 p-4 md:flex-row">
        {/* Preview */}
        <div className="min-w-0 flex-1">
          <div
            className="flex w-full items-center justify-center overflow-hidden rounded-sm bg-bf-bg-canvas"
            style={{ aspectRatio: String(aspect), maxHeight: '60vh' }}
            data-testid="export-preview"
          >
            {isCapturing ? (
              <div className="flex items-center gap-2 text-bf-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                Capturing…
              </div>
            ) : imageUrl ? (
              <img
                src={imageUrl}
                alt="Captured view preview"
                className="h-full w-full object-contain"
              />
            ) : (
              <div className="text-bf-sm text-muted-foreground">No preview available</div>
            )}
          </div>
        </div>

        {/* Options */}
        <div className="w-full space-y-2 md:w-72">
          {selectedView ? (
            <FieldRow label="View" layout="stacked" hint={target?.label ?? undefined}>
              <Select
                value={selectedView}
                options={VIEW_OPTIONS}
                onValueChange={(v) => setViewType(v as ViewType)}
              />
            </FieldRow>
          ) : target ? (
            <FieldRow label="View" layout="stacked">
              <span className="text-bf-sm text-foreground" data-testid="export-target">
                {target.label}
              </span>
            </FieldRow>
          ) : null}

          <FieldRow label="Format" layout="stacked">
            <Select
              value={format}
              options={FORMAT_OPTIONS}
              onValueChange={(v) => setFormat(v === 'jpg' ? 'jpg' : 'png')}
            />
          </FieldRow>

          <FieldRow label="Transparent background" labelWidth="wide">
            <Switch
              checked={transparentBackground}
              onCheckedChange={(checked) => setTransparentBackground(checked)}
              disabled={format !== 'png'}
            />
          </FieldRow>

          <FieldRow
            label="File name"
            layout="stacked"
            hint="Location is chosen in the save dialog."
          >
            <TextField
              ref={fileNameInputRef}
              value={suggestedName}
              onChange={(e) => setSuggestedName(e.target.value)}
              placeholder={`view.${format}`}
            />
          </FieldRow>

          {error && (
            <Notice severity="danger" role="alert" data-testid="export-error">
              {error}
            </Notice>
          )}
        </div>
      </div>

      {/* Ruled footer: Cancel (secondary) left of the primary, right-aligned. */}
      <div className="flex items-center justify-end gap-2 border-t border-bf-border-subtle px-3 py-3">
        <Button variant="secondary" size="sm" onClick={close} disabled={isSaving}>
          Cancel
        </Button>
        <Button
          variant="primary"
          size="sm"
          onClick={handleSave}
          disabled={isCapturing || isSaving || !hasBytes}
        >
          {isSaving ? 'Saving…' : 'Save…'}
        </Button>
      </div>
    </Modal>
  );
}
