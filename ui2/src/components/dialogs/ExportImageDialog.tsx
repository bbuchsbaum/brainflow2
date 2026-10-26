/**
 * ExportImageDialog
 *
 * The export is the viewport frame at a scale factor (P3.8): the rendered
 * slice plus the frame's crosshair, header, orientation letters, colorbar /
 * Regions legend and a scale bar, composited on a canvas by ONE composer that
 * also makes the preview, so the preview is the file (same bytes). Presets:
 * "As shown" (with the crosshair, canvas black) and "Figure" (everything but
 * the crosshair, on white; the default). Size: a screen multiple, or a print
 * width (89 / 183 mm) at 300 / 600 dpi, written into the file. Targets: a
 * slice view, the orthogonal layout, or the mosaic (this page or a slice
 * range). Views that cannot be composited (surface, Compare) fall back to
 * the plain capture.
 *
 * Errors show in the options column (role=alert) with the backend's reason;
 * the footer is ruled with the format summary at left, Cancel / Save right.
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Loader2 } from 'lucide-react';
import {
  Button,
  Checkbox,
  FieldRow,
  Notice,
  NumberField,
  SegmentedControl,
  Select,
  Switch,
  TextField,
} from '@/components/ui/bf';
import { Modal } from '@/components/ui/Modal';
import { getViewExportService } from '@/services/ViewExportService';
import {
  availableExportTargets,
  captureComposite,
  currentMosaicExportSource,
  defaultExportTarget,
  EXPORT_TARGET_LABEL,
  MAX_EXPORT_TILES,
  type ExportTarget,
} from '@/services/export/compositeCapture';
import {
  outputSizeText,
  presetOf,
  PRINT_DPI,
  PRINT_WIDTHS_MM,
  type ExportBackground,
  type FrameIncludes,
} from '@/services/export/compositeExport';
import { useExportDialogStore } from '@/stores/exportDialogStore';
import { formatTauriError } from '@/utils/formatTauriError';
import { formatWorldMm } from '@/utils/valueFormat';

const FORMAT_OPTIONS = [
  { value: 'png', label: 'PNG' },
  { value: 'jpg', label: 'JPG' },
] as const;

const PRESET_OPTIONS = [
  { value: 'shown', label: 'As shown', title: 'What the view shows, crosshair included' },
  { value: 'figure', label: 'Figure', title: 'Everything but the crosshair, on white' },
] as const;

const SIZE_KIND_OPTIONS = [
  { value: 'screen', label: 'Screen', title: 'A multiple of the on-screen size' },
  { value: 'print', label: 'Print', title: 'A journal column width at a print resolution' },
] as const;

const SCALE_OPTIONS = [1, 2, 3, 4].map((s) => ({
  value: String(s),
  label: `${s}×`,
  'aria-label': `${s} times`,
}));

const WIDTH_OPTIONS = PRINT_WIDTHS_MM.map((mm) => ({
  value: String(mm),
  label: `${mm} mm (${mm === 89 ? '1 column' : '2 columns'})`,
}));

const DPI_OPTIONS = PRINT_DPI.map((dpi) => ({ value: String(dpi), label: `${dpi} dpi` }));

const BACKGROUND_OPTIONS = [
  { value: 'black', label: 'Black' },
  { value: 'white', label: 'White' },
  { value: 'transparent', label: 'Transparent' },
] as const;

const TILE_OPTIONS = [
  { value: 'page', label: 'This page' },
  { value: 'range', label: 'Range' },
] as const;

const INCLUDE: Array<{ key: keyof Omit<FrameIncludes, 'background'>; label: string }> = [
  { key: 'colorbar', label: 'Colorbar / legend' },
  { key: 'header', label: 'Slice position' },
  { key: 'orientation', label: 'Orientation letters' },
  { key: 'scaleBar', label: 'Scale bar (10 mm)' },
  { key: 'crosshair', label: 'Crosshair' },
];

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
  const exportTargetChoice = useExportDialogStore((state) => state.exportTarget);
  const composite = useExportDialogStore((state) => state.composite);
  const size = useExportDialogStore((state) => state.size);
  const provenance = useExportDialogStore((state) => state.provenance);
  const mosaicTiles = useExportDialogStore((state) => state.mosaicTiles);
  const outputSize = useExportDialogStore((state) => state.outputSize);

  const store = useExportDialogStore.getState;
  const {
    setFormat,
    setTransparentBackground,
    setSuggestedName,
    setExportTarget,
    setComposite,
    setSize,
    setProvenance,
    setMosaicTiles,
    applyPreset,
    setOutputSize,
    setCapturing,
    setError,
    setCaptureResult,
    close,
  } = store();

  const bytesRef = useRef<Uint8Array | null>(null);
  const captureSeqRef = useRef(0);
  const fileNameInputRef = useRef<HTMLInputElement | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [outputDpi, setOutputDpi] = useState<number | null>(null);

  // What can be composited here (slices + layout, or the mosaic). Empty for
  // views without a composited exporter (surface, Compare): plain capture.
  const targets = useMemo(() => (isOpen ? availableExportTargets() : []), [isOpen]);
  const exportTarget: ExportTarget | null =
    exportTargetChoice && targets.includes(exportTargetChoice)
      ? exportTargetChoice
      : isOpen
        ? defaultExportTarget()
        : null;
  const mosaicSource = useMemo(
    () => (isOpen && exportTarget === 'mosaic' ? currentMosaicExportSource() : null),
    [isOpen, exportTarget],
  );

  useEffect(() => {
    if (!isOpen) return;

    const seq = ++captureSeqRef.current;
    setCapturing(true);
    setError(null);

    const capture = exportTarget
      ? captureComposite(exportTarget, format, {
          frame: composite,
          size,
          provenance,
          mosaicTiles,
        }).then((result) => {
          if (seq === captureSeqRef.current) {
            setOutputSize({ width: result.width, height: result.height });
            setOutputDpi(result.dpi);
          }
          return result;
        })
      : getViewExportService().captureActiveView({
          format,
          transparentBackground: format === 'png' ? transparentBackground : false,
          viewType: viewType ?? undefined,
        });

    capture
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
  }, [
    isOpen,
    exportTarget,
    format,
    composite,
    size,
    provenance,
    mosaicTiles,
    transparentBackground,
    viewType,
    setCapturing,
    setError,
    setCaptureResult,
    setOutputSize,
  ]);

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

  const aspect =
    outputSize && exportTarget
      ? outputSize.width / outputSize.height
      : target?.aspect && Number.isFinite(target.aspect)
        ? target.aspect
        : 4 / 3;
  const preset = presetOf(composite);
  const transparentPreview = exportTarget
    ? composite.background === 'transparent'
    : transparentBackground;

  // Mosaic range defaults: the page on screen, every slice.
  const pageTiles = mosaicSource?.tiles ?? [];
  const rangeSpec =
    mosaicTiles.kind === 'range'
      ? mosaicTiles
      : {
          kind: 'range' as const,
          fromMm: pageTiles[0]?.positionMm ?? 0,
          toMm: pageTiles[pageTiles.length - 1]?.positionMm ?? 0,
          every: 1,
        };

  const summary =
    exportTarget && outputSize
      ? size.kind === 'print' && outputDpi
        ? `${format.toUpperCase()} · ${outputSizeText(outputSize.width, outputSize.height, outputDpi)}`
        : `${format.toUpperCase()} · ${outputSize.width} × ${outputSize.height} px · ${
            size.kind === 'screen' ? `${size.scale}× screen` : ''
          }`
      : format.toUpperCase();

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
      className="!max-w-4xl rounded-sm ring-1 ring-bf-border-strong shadow-2xl"
    >
      <div className="flex flex-col gap-4 p-4 md:flex-row">
        {/* Preview: exactly the composited image that will be saved. */}
        <div className="min-w-0 flex-1">
          <div
            className={`flex w-full items-center justify-center overflow-hidden rounded-sm ${
              transparentPreview ? 'bf-checkerboard' : 'bg-bf-bg-canvas'
            }`}
            style={{ aspectRatio: String(aspect), maxHeight: '60vh' }}
            data-testid="export-preview"
          >
            {isCapturing ? (
              <div className="flex items-center gap-2 text-bf-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                Composing…
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
        <div className="w-full space-y-2 md:w-80">
          {exportTarget ? (
            <>
              <FieldRow
                label="View"
                layout="stacked"
                hint={
                  target?.label && target.label !== EXPORT_TARGET_LABEL[exportTarget]
                    ? target.label
                    : undefined
                }
              >
                <Select
                  value={exportTarget}
                  options={targets.map((t) => ({ value: t, label: EXPORT_TARGET_LABEL[t] }))}
                  onValueChange={(v) => setExportTarget(v as ExportTarget)}
                />
              </FieldRow>

              {exportTarget === 'mosaic' && mosaicSource?.sampling ? (
                <>
                  <FieldRow label="Slices" controlId="export-tiles">
                    {(control) => (
                      <SegmentedControl
                        id={control.id}
                        aria-labelledby={`${control.id}-label`}
                        options={TILE_OPTIONS}
                        value={mosaicTiles.kind}
                        onValueChange={(v) =>
                          setMosaicTiles(v === 'range' ? rangeSpec : { kind: 'page' })
                        }
                      />
                    )}
                  </FieldRow>
                  {mosaicTiles.kind === 'range' ? (
                    <div className="grid grid-cols-3 gap-2" data-testid="export-tile-range">
                      <FieldRow label="From" layout="stacked">
                        <NumberField
                          step={mosaicSource.sampling.step}
                          unit="mm"
                          value={mosaicTiles.fromMm}
                          onValueChange={(v) =>
                            v !== null && setMosaicTiles({ ...mosaicTiles, fromMm: v })
                          }
                        />
                      </FieldRow>
                      <FieldRow label="To" layout="stacked">
                        <NumberField
                          step={mosaicSource.sampling.step}
                          unit="mm"
                          value={mosaicTiles.toMm}
                          onValueChange={(v) =>
                            v !== null && setMosaicTiles({ ...mosaicTiles, toMm: v })
                          }
                        />
                      </FieldRow>
                      <FieldRow label="Every" layout="stacked">
                        <NumberField
                          step={1}
                          min={1}
                          unit="th"
                          value={mosaicTiles.every}
                          onValueChange={(v) =>
                            v !== null &&
                            v >= 1 &&
                            setMosaicTiles({ ...mosaicTiles, every: Math.round(v) })
                          }
                        />
                      </FieldRow>
                    </div>
                  ) : (
                    <p className="text-bf-2xs text-bf-text-muted">
                      {pageTiles.length > 0
                        ? `${pageTiles.length} slices, ${formatWorldMm(pageTiles[0].positionMm)} to ${formatWorldMm(
                            pageTiles[pageTiles.length - 1].positionMm,
                          )} mm`
                        : null}
                    </p>
                  )}
                  {mosaicTiles.kind === 'range' ? (
                    <p className="text-bf-2xs text-bf-text-muted">
                      At most {MAX_EXPORT_TILES} slices; positions snap to the reference grid.
                    </p>
                  ) : null}
                </>
              ) : null}

              <FieldRow label="Preset" controlId="export-preset">
                {(control) => (
                  <SegmentedControl
                    id={control.id}
                    aria-labelledby={`${control.id}-label`}
                    options={PRESET_OPTIONS}
                    value={preset ?? ''}
                    onValueChange={(v) => applyPreset(v as 'shown' | 'figure')}
                  />
                )}
              </FieldRow>

              <FieldRow label="Size" controlId="export-size-kind">
                {(control) => (
                  <SegmentedControl
                    id={control.id}
                    aria-labelledby={`${control.id}-label`}
                    options={SIZE_KIND_OPTIONS}
                    value={size.kind}
                    onValueChange={(v) =>
                      setSize(
                        v === 'print'
                          ? { kind: 'print', widthMm: 89, dpi: 300 }
                          : { kind: 'screen', scale: 2 },
                      )
                    }
                  />
                )}
              </FieldRow>
              {size.kind === 'screen' ? (
                <FieldRow label="Scale" controlId="export-scale">
                  {(control) => (
                    <SegmentedControl
                      id={control.id}
                      aria-labelledby={`${control.id}-label`}
                      options={SCALE_OPTIONS}
                      value={String(size.scale)}
                      onValueChange={(v) => setSize({ kind: 'screen', scale: Number(v) })}
                    />
                  )}
                </FieldRow>
              ) : (
                <>
                  <FieldRow label="Width" controlId="export-width">
                    {(control) => (
                      <Select
                        {...control}
                        value={String(size.widthMm)}
                        options={WIDTH_OPTIONS}
                        onValueChange={(v) => setSize({ ...size, widthMm: Number(v) })}
                      />
                    )}
                  </FieldRow>
                  <FieldRow label="Resolution" controlId="export-dpi">
                    {(control) => (
                      <SegmentedControl
                        id={control.id}
                        aria-labelledby={`${control.id}-label`}
                        options={DPI_OPTIONS}
                        value={String(size.dpi)}
                        onValueChange={(v) => setSize({ ...size, dpi: Number(v) })}
                      />
                    )}
                  </FieldRow>
                </>
              )}

              <fieldset className="space-y-0.5">
                <legend className="mb-1 text-bf-xs text-bf-text-muted">Include</legend>
                <div className="grid grid-cols-2 gap-x-2">
                  {INCLUDE.map(({ key, label }) => (
                    <Checkbox
                      key={key}
                      checked={composite[key]}
                      onCheckedChange={(checked) => setComposite({ [key]: checked })}
                    >
                      {label}
                    </Checkbox>
                  ))}
                </div>
              </fieldset>

              <FieldRow label="Background" layout="stacked">
                <Select
                  value={composite.background}
                  options={BACKGROUND_OPTIONS}
                  onValueChange={(v) => setComposite({ background: v as ExportBackground })}
                />
              </FieldRow>
            </>
          ) : (
            <>
              {target?.label ? (
                <FieldRow label="View">
                  <span className="text-bf-sm text-bf-text-secondary">{target.label}</span>
                </FieldRow>
              ) : null}
              <FieldRow label="Transparent background" labelWidth="wide">
                <Switch
                  checked={transparentBackground}
                  onCheckedChange={(checked) => setTransparentBackground(checked)}
                  disabled={format !== 'png'}
                />
              </FieldRow>
            </>
          )}

          <FieldRow
            label="Format"
            layout="stacked"
            hint={
              format === 'jpg' && composite.background === 'transparent' && exportTarget
                ? 'JPG has no transparency: flattened onto black.'
                : undefined
            }
          >
            <Select
              value={format}
              options={FORMAT_OPTIONS}
              onValueChange={(v) => setFormat(v === 'jpg' ? 'jpg' : 'png')}
            />
          </FieldRow>

          {exportTarget ? (
            <Checkbox
              checked={provenance}
              onCheckedChange={(checked) => setProvenance(checked)}
              title="Layers, files, windows, thresholds, statistic, crosshair and app version, embedded in the image file"
            >
              Embed provenance in the file
            </Checkbox>
          ) : null}

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

      {/* Ruled footer: format summary at left; Cancel / Save at right. */}
      <div className="flex items-center justify-end gap-2 border-t border-bf-border-subtle px-3 py-3">
        {/* Format summary: what Save writes. */}
        <p
          className="mr-auto min-w-0 truncate font-mono text-bf-2xs tabular-nums text-bf-text-muted"
          data-testid="export-size"
        >
          {summary}
        </p>
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
