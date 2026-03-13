/**
 * ExportImageDialog
 *
 * Shows a preview of the captured active view and allows choosing
 * export options before saving to disk.
 */

import React, { useEffect, useRef, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { Label } from '@/components/ui/shadcn/label';
import { Switch } from '@/components/ui/shadcn/switch';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/shadcn/select';
import { Button } from '@/components/ui/shadcn/button';
import { Modal } from '@/components/ui/Modal';
import { getViewExportService } from '@/services/ViewExportService';
import { getTransport } from '@/services/transport';
import { useExportDialogStore } from '@/stores/exportDialogStore';

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
      const transport = getTransport();
      await transport.invoke<string | null>('save_image_bytes', {
        bytes: Array.from(bytes),
        suggestedName: suggestedName || undefined
      });
      close();
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
      title="Export Active View"
      ariaLabel="Export Active View"
      size="xl"
      initialFocusRef={fileNameInputRef}
      closeOnOverlayClick={!isSaving}
      closeOnEscape={!isSaving}
      closeButtonDisabled={isSaving}
      bodyClassName="p-0"
      className="max-w-3xl rounded-sm ring-1 ring-white/10 shadow-2xl"
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
              <div className="text-sm text-destructive px-3 py-2">{error}</div>
            )}
          </div>

          {/* Options */}
          <div className="w-full md:w-72 space-y-4">
            <div className="space-y-1">
              <Label className="text-sm text-muted-foreground">Format</Label>
              <Select
                value={format}
                onValueChange={(v) => setFormat(v === 'jpg' ? 'jpg' : 'png')}
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Select format" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="png">PNG</SelectItem>
                  <SelectItem value="jpg">JPG</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="flex items-center justify-between">
              <Label className="text-sm text-muted-foreground">Transparent background</Label>
              <Switch
                checked={transparentBackground}
                onCheckedChange={(checked) => setTransparentBackground(checked)}
                disabled={format !== 'png'}
              />
            </div>

            <div className="space-y-1">
              <Label className="text-sm text-muted-foreground">File name</Label>
              <input
                ref={fileNameInputRef}
                className="w-full rounded-md bg-background/60 border border-border px-2 py-1.5 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                value={suggestedName}
                onChange={(e) => setSuggestedName(e.target.value)}
                placeholder={`view.${format}`}
              />
              <p className="text-xs text-muted-foreground">Location is chosen in the save dialog.</p>
            </div>

            <div className="pt-2 flex gap-2">
              <Button
                className="flex-1"
                onClick={handleSave}
                disabled={isCapturing || isSaving || !hasBytes}
              >
                {isSaving ? 'Saving…' : 'Save…'}
              </Button>
              <Button
                variant="secondary"
                onClick={close}
                disabled={isSaving}
              >
                Cancel
              </Button>
            </div>
          </div>
      </div>
    </Modal>
  );
}
