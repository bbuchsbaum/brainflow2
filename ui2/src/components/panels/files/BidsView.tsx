import React, { useEffect, useState } from 'react';
import { getTransport } from '@/services/transport';
import { useBidsStore } from '@/stores/bidsStore';
import { useWorkspaceStore } from '@/stores/workspaceStore';
import type { FileTreeNode } from '@/types/filesystem';

interface BidsViewProps {
  rootNode: FileTreeNode | null;
}

export const BidsView: React.FC<BidsViewProps> = ({ rootNode }) => {
  const datasetPath = useBidsStore((state) => state.datasetPath);
  const summary = useBidsStore((state) => state.summary);
  const scanStatus = useBidsStore((state) => state.scanStatus);
  const scanError = useBidsStore((state) => state.scanError);

  const [detection, setDetection] = useState<'unknown' | 'checking' | 'yes' | 'no'>('unknown');
  const [detectionError, setDetectionError] = useState<string | null>(null);

  const rootPath = rootNode?.path ?? null;
  const datasetMatchesRoot = datasetPath !== null && datasetPath === rootPath;

  useEffect(() => {
    setDetection('unknown');
    setDetectionError(null);
    if (!rootPath) return;

    let cancelled = false;
    setDetection('checking');
    void (async () => {
      try {
        const isBids = await getTransport().invoke<boolean>('check_bids_directory', {
          path: rootPath,
        });
        if (cancelled) return;
        setDetection(isBids ? 'yes' : 'no');
      } catch (err) {
        if (cancelled) return;
        setDetection('unknown');
        setDetectionError(err instanceof Error ? err.message : String(err));
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [rootPath]);

  if (!rootNode) {
    return (
      <div className="fb-flat-empty" role="status">
        <p className="fb-flat-empty-kicker">No mounted root</p>
        <p className="fb-flat-empty-message">Mount a directory to check for a BIDS dataset.</p>
      </div>
    );
  }

  function openWorkspace() {
    if (!rootPath) return;
    void useWorkspaceStore.getState().createWorkspace('bids-explorer');
    void useBidsStore.getState().scanDataset(rootPath);
  }

  return (
    <div className="fb-bids-summary" role="region" aria-label="BIDS view">
      {detection === 'checking' && (
        <p className="fb-bids-status fb-bids-status--pending">Checking for BIDS layout…</p>
      )}

      {detection === 'no' && (
        <p className="fb-bids-status">
          This folder doesn't look like a BIDS dataset (no <code>dataset_description.json</code>).
        </p>
      )}

      {detection === 'yes' && (
        <div className="fb-bids-yes">
          <p className="fb-bids-status fb-bids-status--ok">BIDS dataset detected.</p>
          {datasetMatchesRoot && summary ? (
            <ul className="fb-bids-stats">
              <li>
                <span className="fb-bids-stats-label">Subjects</span>
                <span className="fb-bids-stats-value">{summary.subject_count}</span>
              </li>
              <li>
                <span className="fb-bids-stats-label">Sessions</span>
                <span className="fb-bids-stats-value">{summary.session_ids.length}</span>
              </li>
              <li>
                <span className="fb-bids-stats-label">Tasks</span>
                <span className="fb-bids-stats-value">{summary.task_ids.length}</span>
              </li>
            </ul>
          ) : (
            <p className="fb-bids-hint">
              Open the BIDS Explorer workspace for the full coverage matrix and validation.
            </p>
          )}
          <button type="button" className="fb-bids-cta" onClick={openWorkspace}>
            {scanStatus === 'scanning'
              ? 'Scanning…'
              : datasetMatchesRoot
                ? 'Open BIDS Explorer'
                : 'Scan & Open BIDS Explorer'}
          </button>
        </div>
      )}

      {detection === 'unknown' && detectionError && (
        <p className="fb-bids-status fb-bids-status--error">
          BIDS check failed: {detectionError}
        </p>
      )}

      {scanError && (
        <p className="fb-bids-status fb-bids-status--error">Scan failed: {scanError}</p>
      )}
    </div>
  );
};
