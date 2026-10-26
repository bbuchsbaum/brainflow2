import React, { useEffect, useMemo, useState } from 'react';
import './BidsView.css';
import { VscChevronRight, VscChevronDown } from 'react-icons/vsc';
import { getTransport } from '@/services/transport';
import { useBidsStore, type BidsDatasetSummary } from '@/stores/bidsStore';
import { useWorkspaceStore } from '@/stores/workspaceStore';
import type { FileTreeNode } from '@/types/filesystem';
import { Button, Notice, SelectableRow, useRovingFocus } from '@/components/ui/bf';

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

  // Visible rows in tree order: a subject, then its tasks while expanded.
  const visibleRows = useMemo(() => {
    const rows: Array<{ id: string; subjectId: string; task: string | null }> = [];
    for (const subjectId of subjects) {
      rows.push({ id: `s:${subjectId}`, subjectId, task: null });
      if (expandedSubjects.has(subjectId)) {
        for (const task of tasksBySubject.get(subjectId) ?? []) {
          rows.push({ id: `t:${subjectId}:${task}`, subjectId, task });
        }
      }
    }
    return rows;
  }, [subjects, tasksBySubject, expandedSubjects]);
  const rowIds = useMemo(() => visibleRows.map((r) => r.id), [visibleRows]);
  const roving = useRovingFocus({
    ids: rowIds,
    activeId: selectedSubjectId ? `s:${selectedSubjectId}` : null,
    onExpand: (id) => {
      if (!id.startsWith('s:')) return;
      const subjectId = id.slice(2);
      if (!expandedSubjects.has(subjectId) && (tasksBySubject.get(subjectId)?.length ?? 0) > 0) {
        setExpandedSubjects((prev) => new Set(prev).add(subjectId));
      }
    },
    onCollapse: (id) => {
      const row = visibleRows.find((r) => r.id === id);
      if (!row) return;
      if (row.task !== null) {
        roving.focus(`s:${row.subjectId}`);
        return;
      }
      if (expandedSubjects.has(row.subjectId)) {
        setExpandedSubjects((prev) => {
          const next = new Set(prev);
          next.delete(row.subjectId);
          return next;
        });
      }
    },
  });

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
        <Notice severity="neutral" className="fb-bids-status">Checking for BIDS layout…</Notice>
      )}

      {detection === 'no' && (
        <Notice severity="info" className="fb-bids-status">
          This folder doesn't look like a BIDS dataset (no <code>dataset_description.json</code>).
        </Notice>
      )}

      {detection === 'unknown' && detectionError && (
        <Notice severity="danger" className="fb-bids-status">
          BIDS check failed: {detectionError}
        </Notice>
      )}

      {detection === 'yes' && !summaryForRoot && (
        <div className="fb-bids-yes">
          <Notice severity="success" className="fb-bids-status">BIDS dataset detected.</Notice>
          <p className="fb-bids-hint">
            Scan the dataset to populate the subject/task tree, or open the BIDS Explorer for the
            full coverage matrix.
          </p>
          <div className="fb-bids-actions">
            <Button
              variant="primary"
              size="sm"
              onClick={startScan}
              disabled={scanStatus === 'scanning'}
            >
              {scanStatus === 'scanning' ? 'Scanning…' : 'Scan Dataset'}
            </Button>
            <Button variant="secondary" size="sm" onClick={openInWorkspace}>
              Open BIDS Explorer
            </Button>
          </div>
        </div>
      )}

      {showTree && (
        <>
          <div className="fb-bids-tree-header">
            <span className="fb-bids-tree-label">
              {subjects.length} subject{subjects.length === 1 ? '' : 's'}
            </span>
            <Button variant="secondary" size="sm" onClick={openInWorkspace}>
              Open BIDS Explorer
            </Button>
          </div>
          <div
            className="fb-bids-tree"
            role="tree"
            aria-label="BIDS subjects"
            onKeyDown={roving.onKeyDown}
          >
            {visibleRows.map((row) => {
              const { ref, ...itemProps } = roving.getItemProps(row.id);
              if (row.task !== null) {
                return (
                  <SelectableRow
                    key={row.id}
                    ref={ref}
                    {...itemProps}
                    role="treeitem"
                    aria-level={2}
                    indent={1}
                    onSelect={() => handleTaskClick(row.subjectId, row.task as string)}
                    className="fb-bids-tree-row fb-bids-tree-row--task"
                  >
                    <span className="fb-bids-tree-chevron-spacer" aria-hidden />
                    <span className="fb-bids-tree-name">task-{row.task}</span>
                  </SelectableRow>
                );
              }
              const subjectId = row.subjectId;
              const tasks = tasksBySubject.get(subjectId) ?? [];
              const isExpanded = expandedSubjects.has(subjectId);
              return (
                <SelectableRow
                  key={row.id}
                  ref={ref}
                  {...itemProps}
                  role="treeitem"
                  aria-level={1}
                  aria-expanded={tasks.length > 0 ? isExpanded : undefined}
                  selected={selectedSubjectId === subjectId}
                  onSelect={() => handleSubjectClick(subjectId)}
                  className="fb-bids-tree-row"
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
                </SelectableRow>
              );
            })}
          </div>
        </>
      )}

      {scanError && (
        <Notice severity="danger" className="fb-bids-status">Scan failed: {scanError}</Notice>
      )}
    </div>
  );
};
