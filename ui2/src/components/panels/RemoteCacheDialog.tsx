import React, { useEffect, useState } from 'react';
import { Button, Chip, FieldRow, Notice, Select, type SelectOption } from '@/components/ui/bf';
import { Modal } from '@/components/ui/Modal';
import {
  clearInactiveRemoteCaches,
  formatBytes,
  getRemoteCacheUsage,
  setRemoteCacheBudget,
  type RemoteCacheUsage,
} from '@/services/RemoteMountService';
import { formatTauriError } from '@/utils/formatTauriError';

const GB = 1024 * 1024 * 1024;
const LIMIT_CHOICES_GB = [1, 2, 4, 8, 16, 32, 64, 128, 256];

interface RemoteCacheDialogProps {
  isOpen: boolean;
  onClose: () => void;
}

function formatLastUsed(ms: number | null): string {
  if (!ms) return 'not used yet';
  const days = Math.floor((Date.now() - ms) / 86_400_000);
  if (days < 1) return 'used today';
  if (days === 1) return 'used yesterday';
  return `used ${days} days ago`;
}

/**
 * Downloaded remote files: how much space each remote folder uses, the
 * limit (older folders that are not mounted are removed first when it is
 * reached), and clearing folders that are not mounted.
 */
export function RemoteCacheDialog({ isOpen, onClose }: RemoteCacheDialogProps) {
  const [usage, setUsage] = useState<RemoteCacheUsage | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    let active = true;
    setError(null);
    getRemoteCacheUsage()
      .then((next) => {
        if (active) setUsage(next);
      })
      .catch((loadError) => {
        if (active) setError(formatTauriError(loadError) || 'Could not read the download cache.');
      });
    return () => {
      active = false;
    };
  }, [isOpen]);

  const run = async (operation: () => Promise<RemoteCacheUsage>) => {
    setPending(true);
    setError(null);
    try {
      setUsage(await operation());
    } catch (operationError) {
      setError(formatTauriError(operationError) || 'The change could not be made.');
    } finally {
      setPending(false);
    }
  };

  if (!isOpen) return null;

  const total = usage?.total_bytes ?? 0;
  const budget = usage?.budget_bytes ?? 0;
  const fraction = budget > 0 ? Math.min(1, total / budget) : 0;
  const unusedBytes = (usage?.folders ?? [])
    .filter((folder) => !folder.mount_id)
    .reduce((sum, folder) => sum + folder.bytes, 0);
  const limitOptions: SelectOption[] = LIMIT_CHOICES_GB.map((gb) => ({
    value: String(gb * GB),
    label: `${gb} GB`,
  }));
  if (budget > 0 && !limitOptions.some((option) => option.value === String(budget))) {
    limitOptions.push({ value: String(budget), label: formatBytes(budget) });
  }

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Remote downloads"
      ariaLabel="Remote downloads"
      size="lg"
      bodyClassName="p-0"
      className="max-w-[520px]"
    >
      <div className="flex flex-col gap-2 px-3 py-2">
        <p className="m-0 text-bf-sm text-bf-text-secondary">
          Files opened from remote folders are kept on this computer so they open instantly and
          work offline. When the limit is reached, folders that are not mounted are removed,
          least recently used first.
        </p>

        {usage && (
          <>
            <div className="flex items-baseline justify-between text-bf-sm">
              <span>
                {formatBytes(total)} of {formatBytes(budget)} used
              </span>
              <span className="text-bf-xs text-bf-text-secondary">
                {usage.folders.length} {usage.folders.length === 1 ? 'folder' : 'folders'}
              </span>
            </div>
            <div
              className="h-1.5 w-full overflow-hidden rounded-sm bg-bf-border-subtle"
              role="meter"
              aria-label="Download cache used"
              aria-valuemin={0}
              aria-valuemax={budget}
              aria-valuenow={total}
            >
              <div
                className={fraction > 0.9 ? 'h-full bg-bf-warning' : 'h-full bg-bf-text-secondary'}
                style={{ width: `${(fraction * 100).toFixed(1)}%` }}
              />
            </div>

            <ul className="m-0 max-h-[220px] list-none overflow-auto p-0" aria-label="Downloaded folders">
              {usage.folders.length === 0 && (
                <li className="py-1 text-bf-xs text-bf-text-secondary">Nothing downloaded yet.</li>
              )}
              {usage.folders.map((folder) => (
                <li
                  key={folder.label + folder.bytes}
                  className="flex min-w-0 items-center gap-2 border-b border-bf-border-subtle py-1 last:border-b-0"
                >
                  <span className="min-w-0 flex-1 truncate font-mono text-bf-xs" title={folder.label}>
                    {folder.label}
                  </span>
                  {folder.mount_id ? (
                    <Chip>Mounted</Chip>
                  ) : (
                    <span className="text-bf-xs text-bf-text-secondary">
                      {formatLastUsed(folder.last_used_ms)}
                    </span>
                  )}
                  <span className="w-16 text-right text-bf-xs tabular-nums">
                    {formatBytes(folder.bytes)}
                  </span>
                </li>
              ))}
            </ul>

            <FieldRow label="Limit" disabled={pending || usage.budget_from_env}>
              <Select
                value={String(budget)}
                onValueChange={(value) => void run(() => setRemoteCacheBudget(Number(value)))}
                options={limitOptions}
              />
            </FieldRow>
            {usage.budget_from_env && (
              <p className="m-0 text-bf-xs text-bf-text-secondary">
                Set by BRAINFLOW_REMOTE_CACHE_BYTES.
              </p>
            )}
          </>
        )}

        {error && (
          <Notice severity="danger" role="status">
            {error}
          </Notice>
        )}
      </div>

      <div className="flex justify-between gap-2 border-t border-bf-border-subtle px-3 py-2">
        <Button
          variant="secondary"
          size="sm"
          onClick={() => void run(clearInactiveRemoteCaches)}
          disabled={pending || unusedBytes === 0}
          title="Delete downloads of remote folders that are not mounted"
        >
          {unusedBytes > 0 ? `Clear unused (${formatBytes(unusedBytes)})` : 'Clear unused'}
        </Button>
        <Button variant="primary" size="sm" onClick={onClose}>
          Done
        </Button>
      </div>
    </Modal>
  );
}
