import React, { useEffect, useMemo, useState } from 'react';
import './BidsView.css';
import { VscChevronRight, VscChevronDown } from 'react-icons/vsc';
import { getTransport } from '@/services/transport';
import { useBidsStore, type BidsDatasetSummary } from '@/stores/bidsStore';
import { useWorkspaceStore } from '@/stores/workspaceStore';
import type { FileTreeNode } from '@/types/filesystem';

interface BidsViewProps {
  rootNode: FileTreeNode | null;
}

interface SubjectTaskMap {
  subjects: string[];
  tasksBySubject: Map<string, string[]>;
}

function buildSubjectTaskMap(summary: BidsDatasetSummary | null): SubjectTaskMap {
  if (!summary) return { subjects: [], tasksBySubject: new Map() };

  const subjects = summary.coverage.subjects ?? [];
  const columns = summary.coverage.columns ?? [];
  const cells = summary.coverage.cells ?? [];

  const tasksBySubject = new Map<string, string[]>();

  subjects.forEach((subjectId, rowIdx) => {
    const tasks = new Set<string>();
    const row = cells[rowIdx] ?? [];
    columns.forEach((col, colIdx) => {
      if (!col.task) return;
      const cell = row[colIdx];
      if (cell?.present) tasks.add(col.task);
    });
    tasksBySubject.set(
      subjectId,
      Array.from(tasks).sort((a, b) => a.localeCompare(b))
    );
  });

  return { subjects, tasksBySubject };
}

export const BidsView: React.FC<BidsViewProps> = ({ rootNode }) => {
  const datasetPath = useBidsStore((state) => state.datasetPath);
  const summary = useBidsStore((state) => state.summary);
  const scanStatus = useBidsStore((state) => state.scanStatus);
  const scanError = useBidsStore((state) => state.scanError);
  const selectedSubjectId = useBidsStore((state) => state.selection.subjectId);

  const [detection, setDetection] = useState<'unknown' | 'checking' | 'yes' | 'no'>('unknown');
  const [detectionError, setDetectionError] = useState<string | null>(null);
  const [expandedSubjects, setExpandedSubjects] = useState<Set<string>>(new Set());

  const rootPath = rootNode?.path ?? null;
  const datasetMatchesRoot = datasetPath !== null && datasetPath === rootPath;
  const summaryForRoot = datasetMatchesRoot ? summary : null;

  const { subjects, tasksBySubject } = useMemo(
    () => buildSubjectTaskMap(summaryForRoot),
    [summaryForRoot]
  );

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

  function startScan() {
    if (!rootPath) return;
    void useBidsStore.getState().scanDataset(rootPath);
  }

  function openInWorkspace() {
    if (!rootPath) return;
    void useWorkspaceStore.getState().createWorkspace('bids-explorer');
    if (!summaryForRoot) {
      void useBidsStore.getState().scanDataset(rootPath);
    }
  }

  function toggleSubject(subjectId: string) {
    setExpandedSubjects((prev) => {
      const next = new Set(prev);
      if (next.has(subjectId)) next.delete(subjectId);
      else next.add(subjectId);
      return next;
    });
  }

  function handleSubjectClick(subjectId: string) {
    useBidsStore.getState().selectSubject(subjectId);
    toggleSubject(subjectId);
  }

  function handleTaskClick(subjectId: string, task: string) {
    useBidsStore.getState().selectCell(subjectId, null, task);
  }

  const showTree = detection === 'yes' && summaryForRoot && subjects.length > 0;

  return (
    <div className="fb-bids-view" role="region" aria-label="BIDS view">
      {detection === 'checking' && (
        <p className="fb-bids-status fb-bids-status--pending">Checking for BIDS layout…</p>
      )}

      {detection === 'no' && (
        <p className="fb-bids-status">
          This folder doesn't look like a BIDS dataset (no <code>dataset_description.json</code>).
        </p>
      )}

      {detection === 'unknown' && detectionError && (
        <p className="fb-bids-status fb-bids-status--error">
          BIDS check failed: {detectionError}
        </p>
      )}

      {detection === 'yes' && !summaryForRoot && (
        <div className="fb-bids-yes">
          <p className="fb-bids-status fb-bids-status--ok">BIDS dataset detected.</p>
          <p className="fb-bids-hint">
            Scan the dataset to populate the subject/task tree, or open the BIDS Explorer for the
            full coverage matrix.
          </p>
          <div className="fb-bids-actions">
            <button
              type="button"
              className="fb-bids-cta"
              onClick={startScan}
              disabled={scanStatus === 'scanning'}
            >
              {scanStatus === 'scanning' ? 'Scanning…' : 'Scan Dataset'}
            </button>
            <button type="button" className="fb-bids-cta-secondary" onClick={openInWorkspace}>
              Open BIDS Explorer
            </button>
          </div>
        </div>
      )}

      {showTree && (
        <>
          <div className="fb-bids-tree-header">
            <span className="fb-bids-tree-label">
              {subjects.length} subject{subjects.length === 1 ? '' : 's'}
            </span>
            <button
              type="button"
              className="fb-bids-cta-secondary"
              onClick={openInWorkspace}
            >
              Open BIDS Explorer
            </button>
          </div>
          <ul className="fb-bids-tree" role="tree">
            {subjects.map((subjectId) => {
              const tasks = tasksBySubject.get(subjectId) ?? [];
              const isExpanded = expandedSubjects.has(subjectId);
              const isSelected = selectedSubjectId === subjectId;
              return (
                <li
                  key={subjectId}
                  className="fb-bids-tree-item"
                  role="treeitem"
                  aria-expanded={isExpanded}
                >
                  <button
                    type="button"
                    className={`fb-bids-tree-row${isSelected ? ' is-selected' : ''}`}
                    onClick={() => handleSubjectClick(subjectId)}
                  >
                    <span className="fb-bids-tree-chevron" aria-hidden>
                      {tasks.length > 0 ? (
                        isExpanded ? <VscChevronDown /> : <VscChevronRight />
                      ) : (
                        <span className="fb-bids-tree-chevron-spacer" />
                      )}
                    </span>
                    <span className="fb-bids-tree-name">{subjectId}</span>
                    <span className="fb-bids-tree-meta">
                      {tasks.length} task{tasks.length === 1 ? '' : 's'}
                    </span>
                  </button>
                  {isExpanded && tasks.length > 0 && (
                    <ul className="fb-bids-tree-children" role="group">
                      {tasks.map((task) => (
                        <li
                          key={`${subjectId}-${task}`}
                          className="fb-bids-tree-task"
                          role="treeitem"
                        >
                          <button
                            type="button"
                            className="fb-bids-tree-row fb-bids-tree-row--task"
                            onClick={() => handleTaskClick(subjectId, task)}
                          >
                            <span className="fb-bids-tree-chevron-spacer" aria-hidden />
                            <span className="fb-bids-tree-name">task-{task}</span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              );
            })}
          </ul>
        </>
      )}

      {scanError && (
        <p className="fb-bids-status fb-bids-status--error">Scan failed: {scanError}</p>
      )}
    </div>
  );
};
