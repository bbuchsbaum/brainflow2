/**
 * ImageHeaderDialog
 *
 * Modal dialog showing NIfTI header metadata for a loaded volume.
 * Opened via Cmd+I shortcut or the ⓘ button in the layer list.
 */

import React, { useEffect, useState, useCallback } from 'react';
import { Copy, Check } from 'lucide-react';
import { getApiService } from '@/services/apiService';
import type { NiftiHeaderInfo } from '@/services/apiService';
import { statisticFacts } from '@/utils/statistic';
import { Modal } from '@/components/ui/Modal';
import { Button, KeyValue, Notice, Section, type KeyValueItem } from '@/components/ui/bf';
import {
  asciiMinus,
  formatDims,
  formatFixed,
  formatDataRange,
  formatVoxelSize,
  formatWorldPoint,
} from '@/utils/valueFormat';

interface ImageHeaderDialogProps {
  open: boolean;
  onClose: () => void;
  volumeId: string | null;
}

// ---- small helpers --------------------------------------------------------


/** Display number at fixed decimals (U+2212 minus, see utils/valueFormat). */
function fmt(n: number, decimals = 4): string {
  return formatFixed(n, decimals);
}

/** A fact value that copies itself on click (the whole value is the target). */
function CopyValue({ value, unit }: { value: string; unit?: string }) {
  const [copied, setCopied] = useState(false);

  const copy = useCallback(() => {
    // The clipboard gets ASCII minus (parsers and other apps read "-95.5").
    navigator.clipboard.writeText(asciiMinus(value)).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }, [value]);

  return (
    <button
      type="button"
      className="group flex min-w-0 max-w-full cursor-pointer items-center gap-1 rounded-sm text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--bf-border-focus)]"
      onClick={copy}
      title={`${value} (click to copy)`}
      aria-label={copied ? `${value} (copied)` : `${value}, copy`}
    >
      <span className="min-w-0 truncate">{value}</span>
      {unit ? <span className="shrink-0 text-muted-foreground">{unit}</span> : null}
      <span className="shrink-0 opacity-0 transition-opacity group-hover:opacity-60 group-focus-visible:opacity-60" aria-hidden>
        {copied ? <Check className="h-3 w-3 text-bf-success" /> : <Copy className="h-3 w-3" />}
      </span>
    </button>
  );
}

interface Fact {
  label: string;
  value: string;
  unit?: string;
  mono?: boolean;
}

/** Image-header facts: the wide (148px) label column, values copy on click. */
function Facts({ items }: { items: ReadonlyArray<Fact | false | null | undefined | ''> }) {
  const rows: KeyValueItem[] = items
    .filter((f): f is Fact => Boolean(f))
    .map(f => ({
      key: f.label,
      label: f.label,
      // The unit sits inside the copy target (before the copy glyph) and is
      // not copied: the clipboard gets the number(s) only.
      value: <CopyValue value={f.value} unit={f.unit} />,
      mono: f.mono,
    }));
  return <KeyValue layout="rows" labelWidth="wide" items={rows} />;
}

// ---- main component -------------------------------------------------------

export function ImageHeaderDialog({ open, onClose, volumeId }: ImageHeaderDialogProps) {
  const [info, setInfo] = useState<NiftiHeaderInfo | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Fetch header info when dialog opens
  useEffect(() => {
    if (!open || !volumeId) {
      setInfo(null);
      setError(null);
      return;
    }
    setLoading(true);
    setError(null);
    getApiService()
      .getNiftiHeaderInfo(volumeId)
      .then(result => {
        setInfo(result);
        setLoading(false);
      })
      .catch(err => {
        setError(String(err));
        setLoading(false);
      });
  }, [open, volumeId]);

  if (!open) return null;

  const is4D = info != null && info.num_timepoints != null;

  // Format the 4×4 affine matrix rows
  function matrixRows(vtw: number[]): string[] {
    const rows: string[] = [];
    for (let r = 0; r < 4; r++) {
      const vals = [0, 1, 2, 3].map(c => fmt(vtw[r * 4 + c], 4).padStart(10));
      rows.push(`[ ${vals.join('  ')} ]`);
    }
    return rows;
  }

  return (
    <Modal
      isOpen={open}
      onClose={onClose}
      title="Image header"
      ariaLabel="Image header"
      size="lg"
      bodyClassName="p-0"
      className="max-w-lg rounded-sm ring-1 ring-bf-border-strong shadow-2xl"
    >
      <div className="max-h-[90vh] overflow-hidden flex flex-col">
        <div className="flex-1 overflow-y-auto">
          {loading && (
            <div className="flex items-center justify-center py-12">
              <Notice role={undefined}>Loading header info…</Notice>
            </div>
          )}

          {error && (
            <div className="px-3 py-3">
              <Notice severity="danger" role="alert">
                Error: {error}
              </Notice>
            </div>
          )}

          {info && (
            <>
              <Section title="File" divider={false}>
                <Facts
                  items={[
                    { label: 'Filename', value: info.filename },
                    { label: 'Format', value: 'NIfTI', mono: false },
                    info.description ? { label: 'Description', value: info.description, mono: false } : null,
                  ]}
                />
              </Section>

              {/* Plain images (intent none) get no Statistic section. */}
              {info.statistic && info.statistic.kind !== 'none' && (
                <Section title="Statistic">
                  <Facts items={statisticFacts(info.statistic, info.data_range)} />
                </Section>
              )}

              <Section title="Dimensions">
                <Facts
                  items={[
                    { label: 'Voxel dims', value: formatDims(info.dimensions.slice(0, 3)) },
                    {
                      label: 'Total voxels',
                      value: info.dimensions
                        .slice(0, 3)
                        .reduce((a, b) => a * b, 1)
                        .toLocaleString(),
                    },
                    { label: 'Data type', value: info.data_type },
                    info.data_range && {
                      label: 'Data range',
                      value: formatDataRange(info.data_range.min, info.data_range.max),
                    },
                  ]}
                />
              </Section>

              <Section title="Spatial">
                <Facts
                  items={[
                    {
                      label: 'Voxel size',
                      value: formatVoxelSize(info.voxel_spacing),
                      unit: 'mm',
                    },
                    { label: 'Orientation', value: info.orientation_string },
                    { label: 'Spatial units', value: info.spatial_units },
                    // Corner voxel CENTRES (the field of view extends half a voxel further).
                    { label: 'Voxel centres, min', value: formatWorldPoint(info.world_bounds_min), unit: 'mm' },
                    { label: 'Voxel centres, max', value: formatWorldPoint(info.world_bounds_max), unit: 'mm' },
                    { label: 'Sform code', value: String(info.sform_code) },
                    { label: 'Qform code', value: String(info.qform_code) },
                  ]}
                />
              </Section>

              <Section title="Transform (voxel → world)" defaultOpen={false}>
                <div className="overflow-x-auto py-1">
                  <pre className="font-mono text-xs tabular-nums text-bf-text-secondary whitespace-pre leading-relaxed">
                    {matrixRows(info.voxel_to_world).join('\n')}
                  </pre>
                </div>
              </Section>

              {is4D && (
                <Section title="Temporal">
                  <Facts
                    items={[
                      { label: 'Timepoints', value: String(info.num_timepoints) },
                      info.tr_seconds != null && {
                        label: 'TR',
                        value: fmt(info.tr_seconds, 4),
                        unit: 's',
                      },
                      info.temporal_units && { label: 'Temporal units', value: info.temporal_units },
                    ]}
                  />
                </Section>
              )}
            </>
          )}
        </div>

        <div className="flex flex-shrink-0 justify-end border-t border-bf-border-subtle px-3 py-3">
          <Button onClick={onClose} variant="secondary" size="sm">
            Close
          </Button>
        </div>
      </div>
    </Modal>
  );
}
