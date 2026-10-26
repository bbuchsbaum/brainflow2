/**
 * ExportImageDialog
 *
 * Shows a preview of the captured active view and allows choosing
 * export options before saving to disk.
 */

import React, { useEffect, useRef, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { Button, FieldRow, Notice, Select, Switch, TextField } from '@/components/ui/bf';
import { Modal } from '@/components/ui/Modal';
import { getViewExportService } from '@/services/ViewExportService';
import { useExportDialogStore } from '@/stores/exportDialogStore';

const FORMAT_OPTIONS = [
  { value: 'png', label: 'PNG' },
  { value: 'jpg', label: 'JPG' },
] as const;

export function ExportImageDialog() {
  const isOpen = useExportDialogStore(state => state.isOpen);
  const imageUrl = useExportDialogStore(state => state.imageUrl);
  const isCapturing = useExportDialogStore(state => state.isCapturing);
  const error = useExportDialogStore(state => state.error);
  const hasBytes = useExportDialogStore(state => state.bytes !== null);
  const format = useExportDialogStore(state => state.format);
  const transparentBackground = useExportDialogStore(state => state.transparentBackground);
  const suggestedName = useExportDialogStore(state => state.suggestedName);

  const setFormat = useExportDialogStore(state => state.setFormat);
  const setTransparentBackground = useExportDialogStore(state => state.setTransparentBackground);
  const setSuggestedName = useExportDialogStore(state => state.setSuggestedName);
  const setCapturing = useExportDialogStore(state => state.setCapturing);
  const setError = useExportDialogStore(state => state.setError);
  const setCaptureResult = useExportDialogStore(state => state.setCaptureResult);
  const close = useExportDialogStore(state => state.close);

  const bytesRef = useRef<Uint8Array | null>(null);
  const mimeRef = useRef<string | null>(null);
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
      })
      .then(({ bytes, mime, suggestedName: name }) => {
        if (seq !== captureSeqRef.current) return;
        bytesRef.current = bytes;
        mimeRef.current = mime;
        setCaptureResult(bytes, mime, name);
      })
      .catch((err) => {
        if (seq !== captureSeqRef.current) return;
        setError((err as Error).message || 'Failed to capture view');
      })
      .finally(() => {
        if (seq !== captureSeqRef.current) return;
        setCapturing(false);
      });
  }, [isOpen, format, transparentBackground, setCapturing, setError, setCaptureResult]);

  const handleSave = async () => {
    const bytes = bytesRef.current;
    if (!bytes) return;

    setIsSaving(true);
    try {
      // null = the user cancelled the native save dialog: keep this dialog
      // open (they may pick another name or format) and show no error.
      const savedPath = await getViewExportService().saveImageBytes(bytes, suggestedName);
      if (savedPath) close();
    } catch (err) {
      setError((err as Error).message || 'Failed to save image');
    } finally {
      setIsSaving(false);
    }
  };

  if (!isOpen) return null;

  return (
    <Modal
      isOpen={isOpen}
      onClose={close}
      title="Export active view"
      ariaLabel="Export active view"
      size="xl"
      initialFocusRef={fileNameInputRef}
      closeOnOverlayClick={!isSaving}
      closeOnEscape={!isSaving}
      closeButtonDisabled={isSaving}
      bodyClassName="p-0"
      className="max-w-3xl rounded-sm ring-1 ring-bf-border-strong shadow-2xl"
    >
      <div className="flex flex-col md:flex-row gap-4 p-4">
          {/* Preview */}
          <div className="flex-1 min-h-[300px] bg-black/40 rounded-sm flex items-center justify-center overflow-hidden">
            {isCapturing && (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                Capturing…
              </div>
            )}
            {!isCapturing && imageUrl && (
              <img
                src={imageUrl}
                alt="Captured view preview"
                className="max-h-[70vh] w-auto object-contain"
              />
            )}
            {!isCapturing && !imageUrl && !error && (
              <div className="text-sm text-muted-foreground">No preview available</div>
            )}
            {error && (
              <Notice severity="danger" role="alert" className="px-3 py-2">{error}</Notice>
            )}
          </div>

          {/* Options */}
          <div className="w-full md:w-72 space-y-2">
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

            <FieldRow label="File name" layout="stacked" hint="Location is chosen in the save dialog.">
              <TextField
                ref={fileNameInputRef}
                value={suggestedName}
                onChange={(e) => setSuggestedName(e.target.value)}
                placeholder={`view.${format}`}
              />
            </FieldRow>

            {/* Footer convention: Cancel (secondary) left of the primary, right-aligned. */}
            <div className="pt-2 flex justify-end gap-2">
              <Button
                variant="secondary"
                size="sm"
                onClick={close}
                disabled={isSaving}
              >
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
          </div>
      </div>
    </Modal>
  );
}
