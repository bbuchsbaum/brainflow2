/**
 * ImageHeaderDialog
 *
 * Modal dialog showing NIfTI header metadata for a loaded volume.
 * Opened via Cmd+I shortcut or the ⓘ button in the layer list.
 */

import React, { useEffect, useState, useCallback } from 'react';
import { ChevronDown, Copy, Check } from 'lucide-react';
import { getApiService } from '@/services/apiService';
import type { NiftiHeaderInfo } from '@/services/apiService';
import { Button } from '@/components/ui/shadcn/button';
import { Modal } from '@/components/ui/Modal';

interface ImageHeaderDialogProps {
  open: boolean;
  onClose: () => void;
  volumeId: string | null;
}

// ---- small helpers --------------------------------------------------------

function fmt(n: number, decimals = 4): string {
  return n.toFixed(decimals);
}

function CopyValue({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);

  const copy = useCallback(() => {
    navigator.clipboard.writeText(value).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }, [value]);

  return (
    <button
      type="button"
      className="group flex items-center gap-1 cursor-pointer rounded-sm text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      onClick={copy}
      title="Copy value"
      aria-label={copied ? `${value} (copied)` : `${value}, copy`}
    >
      <span className="font-mono tabular-nums text-sm text-foreground">{value}</span>
      <span className="opacity-0 group-hover:opacity-60 group-focus-visible:opacity-60 transition-opacity" aria-hidden>
        {copied ? <Check className="w-3 h-3 text-bf-success" /> : <Copy className="w-3 h-3" />}
      </span>
    </button>
  );
}

interface FieldRowProps {
  label: string;
  value: string;
}

function FieldRow({ label, value }: FieldRowProps) {
  return (
    <div className="grid grid-cols-[140px_1fr] items-start gap-2 py-1">
      <span className="text-bf-sm text-muted-foreground pt-0.5">{label}</span>
      <CopyValue value={value} />
    </div>
  );
}

interface SectionProps {
  title: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}

function Section({ title, defaultOpen = true, children }: SectionProps) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className="border-b" style={{ borderColor: 'var(--bf-border-subtle)' }}>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen(o => !o)}
        className="w-full px-6 py-3 flex items-center justify-between hover:bg-accent transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
      >
        <h3 className="m-0 border-0 p-0 text-bf-sm font-semibold text-foreground">{title}</h3>
        <ChevronDown
          className={`w-4 h-4 text-muted-foreground transition-transform ${open ? 'rotate-180' : ''}`}
        />
      </button>
      {open && (
        <div className="px-6 pb-4 space-y-0.5">
          {children}
        </div>
      )}
    </section>
  );
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
            <div className="flex items-center justify-center py-12 text-muted-foreground text-sm">
              Loading header info…
            </div>
          )}

          {error && (
            <div className="px-6 py-4 text-bf-danger text-sm">
              Error: {error}
            </div>
          )}

          {info && (
            <>
              {/* File */}
              <Section title="File">
                <FieldRow label="Filename" value={info.filename} />
                <FieldRow label="Format" value="NIfTI" />
                {info.description && <FieldRow label="Description" value={info.description} />}
              </Section>

              {/* Dimensions */}
              <Section title="Dimensions">
                <FieldRow
                  label="Voxel dims"
                  value={info.dimensions.slice(0, 3).join(' × ')}
                />
                <FieldRow
                  label="Total voxels"
                  value={info.dimensions.slice(0, 3)
                    .reduce((a, b) => a * b, 1)
                    .toLocaleString()}
                />
                <FieldRow label="Data type" value={info.data_type} />
                {info.data_range && (
                  <FieldRow
                    label="Data range"
                    value={`${fmt(info.data_range.min, 4)} – ${fmt(info.data_range.max, 4)}`}
                  />
                )}
              </Section>

              {/* Spatial */}
              <Section title="Spatial">
                <FieldRow
                  label="Voxel size (mm)"
                  value={info.voxel_spacing.map(v => fmt(v, 4)).join(' × ')}
                />
                <FieldRow label="Orientation" value={info.orientation_string} />
                <FieldRow label="Spatial units" value={info.spatial_units} />
                <FieldRow
                  label="World min"
                  value={info.world_bounds_min.map(v => fmt(v, 2)).join(', ')}
                />
                <FieldRow
                  label="World max"
                  value={info.world_bounds_max.map(v => fmt(v, 2)).join(', ')}
                />
                <FieldRow label="Sform code" value={String(info.sform_code)} />
                <FieldRow label="Qform code" value={String(info.qform_code)} />
              </Section>

              {/* Transform */}
              <Section title="Transform (voxel → world)" defaultOpen={false}>
                <div className="overflow-x-auto py-1">
                  <pre className="font-mono text-xs tabular-nums text-bf-text-secondary whitespace-pre leading-relaxed">
                    {matrixRows(info.voxel_to_world).join('\n')}
                  </pre>
                </div>
              </Section>

              {/* Temporal (4D only) */}
              {is4D && (
                <Section title="Temporal">
                  <FieldRow label="Timepoints" value={String(info.num_timepoints)} />
                  {info.tr_seconds != null && (
                    <FieldRow label="TR (s)" value={fmt(info.tr_seconds, 4)} />
                  )}
                  {info.temporal_units && (
                    <FieldRow label="Temporal units" value={info.temporal_units} />
                  )}
                </Section>
              )}
            </>
          )}
        </div>

        <div
          className="px-6 py-3 border-t flex justify-end flex-shrink-0"
          style={{ borderColor: 'var(--bf-border-subtle)' }}
        >
          <Button onClick={onClose} variant="outline" size="sm">
            Close
          </Button>
        </div>
      </div>
    </Modal>
  );
}
