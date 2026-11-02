import React, { useEffect, useMemo, useRef, useState } from 'react';
import './BidsView.css';
import { VscChevronRight, VscChevronDown } from 'react-icons/vsc';
import { getTransport } from '@/services/transport';
import type { BidsRunRecord } from '@brainflow/api';
import { openRunInViewer } from '@/services/bids/openRunInViewer';
import { selectBidsModel, useBidsStore, type BidsBrowserIndex } from '@/stores/bidsStore';
import { naturalCompare } from '@/stores/bidsModel';
import { useWorkspaceStore } from '@/stores/workspaceStore';
import type { FileTreeNode } from '@/types/filesystem';
import { formatSessionId, formatSubjectId, truncateBidsName } from '@/utils/bids';
import { Button, Notice, SelectableRow, useRovingFocus } from '@/components/ui/bf';

interface BidsViewProps {
  rootNode: FileTreeNode | null;
}

interface SubjectTaskMap {
  subjects: string[];
  tasksBySubject: Map<string, string[]>;
  /** Listed by the dataset, but no image has been read for them here. */
}

function buildSubjectTaskMap(index: BidsBrowserIndex | null): SubjectTaskMap {
  if (!index) return { subjects: [], tasksBySubject: new Map() };

  const tasks = new Map<string, Set<string>>();
  for (const run of index.runs) {
    const own = tasks.get(run.subject) ?? new Set<string>();
    if (run.task) own.add(run.task);
    tasks.set(run.subject, own);
  }

  const tasksBySubject = new Map<string, string[]>();
  for (const [subjectId, own] of tasks) {
    tasksBySubject.set(subjectId, [...own].sort(naturalCompare));
  }
  return {
    subjects: [...tasks.keys()].sort(naturalCompare),
    tasksBySubject,
  };
}

/** A subject's branches: its sessions when it has any, else its groups directly. */
interface SubjectTree {
  sessions: Array<{ session: string | null; groups: Array<{ name: string; runs: BidsRunRecord[] }> }>;
}

const groupName = (run: BidsRunRecord) => (run.task ? `task-${run.task}` : (run.datatype ?? 'other'));

function buildSubjectTrees(index: BidsBrowserIndex | null): Map<string, SubjectTree> {
  const raw = new Map<string, Map<string | null, Map<string, BidsRunRecord[]>>>();
  for (const run of index?.runs ?? []) {
    const sessions = raw.get(run.subject) ?? new Map<string | null, Map<string, BidsRunRecord[]>>();
    const session = run.session ?? null;
    const groups = sessions.get(session) ?? new Map<string, BidsRunRecord[]>();
    const name = groupName(run);
    groups.set(name, [...(groups.get(name) ?? []), run]);
    sessions.set(session, groups);
    raw.set(run.subject, sessions);
  }
  const trees = new Map<string, SubjectTree>();
  for (const [subject, sessions] of raw) {
    trees.set(subject, {
      sessions: [...sessions.entries()]
        .sort(([a], [b]) => naturalCompare(a ?? '', b ?? ''))
        .map(([session, groups]) => ({
          session,
          groups: [...groups.entries()]
            .sort(([a], [b]) => naturalCompare(a, b))
            .map(([name, runs]) => ({
              name,
              runs: runs.sort((a, b) => naturalCompare(a.id, b.id)),
            })),
        })),
    });
  }
  return trees;
}

type TreeRow =
  | { id: string; kind: 'subject'; level: 0; subjectId: string; parent: null }
  | { id: string; kind: 'session'; level: 1; subjectId: string; parent: string; session: string }
  | { id: string; kind: 'group'; level: number; subjectId: string; parent: string; name: string; count: number }
  | { id: string; kind: 'run'; level: number; subjectId: string; parent: string; run: BidsRunRecord };

const subjectRowId = (subjectId: string) => `s:${subjectId}`;
const sessionRowId = (subjectId: string, session: string | null) => `e:${subjectId}:${session ?? ''}`;
const groupRowId = (subjectId: string, session: string | null, name: string) =>
  `g:${subjectId}:${session ?? ''}:${name}`;
const runRowId = (runId: string) => `r:${runId}`;

const RUN_NAME_CHARS = 26;

function runFileName(run: BidsRunRecord): string {
  const prefix = `sub-${run.subject.replace(/^sub-/, '')}_${run.session ? `ses-${run.session.replace(/^ses-/, '')}_` : ''}`;
  return run.id.startsWith(prefix) ? run.id.slice(prefix.length) : run.id;
}

function formatSize(bytes: number | undefined): string {
  if (!bytes) return '';
  if (bytes >= 2 ** 30) return `${(bytes / 2 ** 30).toFixed(1)} GB`;
  return `${Math.round(bytes / 2 ** 20)} MB`;
}

export const BidsView: React.FC<BidsViewProps> = ({ rootNode }) => {
  const datasetPath = useBidsStore((state) => state.datasetPath);
  const index = useBidsStore((state) => state.index);
  const scanStatus = useBidsStore((state) => state.scanStatus);
  const scanError = useBidsStore((state) => state.scanError);
  const selectedSubjectId = useBidsStore((state) => state.selection.subjectId);
  const selectedRunId = useBidsStore((state) => state.selectedRunId);
  const inExplorer = useWorkspaceStore((state) => state.getActiveWorkspace?.()?.type === 'bids-explorer');

  const [detection, setDetection] = useState<'unknown' | 'checking' | 'yes' | 'no'>('unknown');
  const [detectionError, setDetectionError] = useState<string | null>(null);
  const [opened, setOpened] = useState<Set<string>>(new Set());
  // Branches open only to reveal the selection; they close when it moves on.
  const [revealed, setRevealed] = useState<Set<string>>(new Set());
  const expanded = useMemo(() => new Set([...opened, ...revealed]), [opened, revealed]);
  const treeRef = useRef<HTMLDivElement>(null);

  const rootPath = rootNode?.path ?? null;
  const datasetMatchesRoot = datasetPath !== null && datasetPath === rootPath;
  const indexForRoot = datasetMatchesRoot ? index : null;

  const { subjects, tasksBySubject } = useMemo(
    () => buildSubjectTaskMap(indexForRoot),
    [indexForRoot]
  );
  const trees = useMemo(() => buildSubjectTrees(indexForRoot), [indexForRoot]);
  // The model's count, which knows when absence can be claimed at all.
  const withoutImages = useBidsStore((state) => (indexForRoot ? selectBidsModel(state).participants.noLocalData : 0));

  // Visible rows in tree order: subject, session, task or datatype, run.
  const visibleRows = useMemo(() => {
    const rows: TreeRow[] = [];
    for (const subjectId of subjects) {
      const subjectRow = subjectRowId(subjectId);
      rows.push({ id: subjectRow, kind: 'subject', level: 0, subjectId, parent: null });
      if (!expanded.has(subjectRow)) continue;
      for (const { session, groups } of trees.get(subjectId)?.sessions ?? []) {
        const sessionRow = sessionRowId(subjectId, session);
        if (session !== null) {
          rows.push({ id: sessionRow, kind: 'session', level: 1, subjectId, parent: subjectRow, session });
          if (!expanded.has(sessionRow)) continue;
        }
        const groupLevel = session === null ? 1 : 2;
        for (const { name, runs } of groups) {
          const groupRow = groupRowId(subjectId, session, name);
          rows.push({
            id: groupRow,
            kind: 'group',
            level: groupLevel,
            subjectId,
            parent: session === null ? subjectRow : sessionRow,
            name,
            count: runs.length,
          });
          if (!expanded.has(groupRow)) continue;
          for (const run of runs) {
            rows.push({ id: runRowId(run.id), kind: 'run', level: groupLevel + 1, subjectId, parent: groupRow, run });
          }
        }
      }
    }
    return rows;
  }, [subjects, trees, expanded]);
  const rowIds = useMemo(() => visibleRows.map((r) => r.id), [visibleRows]);
  const selectedRowId = selectedRunId ? runRowId(selectedRunId) : null;
  const closeRow = (id: string) => {
    const without = (prev: Set<string>) => {
      if (!prev.has(id)) return prev;
      const next = new Set(prev);
      next.delete(id);
      return next;
    };
    setOpened(without);
    setRevealed(without);
  };
  const roving = useRovingFocus({
    ids: rowIds,
    activeId:
      selectedRowId && rowIds.includes(selectedRowId)
        ? selectedRowId
        : selectedSubjectId
          ? subjectRowId(selectedSubjectId)
          : null,
    onExpand: (id) => {
      const row = visibleRows.find((r) => r.id === id);
      if (row && row.kind !== 'run' && !expanded.has(id)) {
        setOpened((prev) => new Set(prev).add(id));
      }
    },
    onCollapse: (id) => {
      const row = visibleRows.find((r) => r.id === id);
      if (!row) return;
      if (row.kind !== 'run' && expanded.has(id)) {
        closeRow(id);
        return;
      }
      if (row.parent) roving.focus(row.parent);
    },
  });

  // Follows the selection: open the branches above the run. No focus moves here.
  useEffect(() => {
    const run = selectedRunId
      ? indexForRoot?.runs.find((item) => item.id === selectedRunId)
      : undefined;
    if (!run) {
      setRevealed((prev) => (prev.size ? new Set() : prev));
      return;
    }
    const session = run.session ?? null;
    setRevealed(
      new Set([
        subjectRowId(run.subject),
        ...(session !== null ? [sessionRowId(run.subject, session)] : []),
        groupRowId(run.subject, session, groupName(run)),
      ]),
    );
  }, [selectedRunId, indexForRoot]);

  // Then scroll it into view, once its row exists.
  const selectedRowVisible = selectedRowId !== null && rowIds.includes(selectedRowId);
  useEffect(() => {
    if (!selectedRowVisible || !selectedRunId) return;
    const row = treeRef.current?.querySelector(`[data-run-id="${CSS.escape(selectedRunId)}"]`);
    row?.scrollIntoView?.({ block: 'nearest' });
  }, [selectedRowVisible, selectedRunId]);

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
    if (!indexForRoot && !(datasetPath === rootPath && scanStatus === 'scanning')) {
      void useBidsStore.getState().scanDataset(rootPath);
    }
  }

  function toggleRow(id: string) {
    if (expanded.has(id)) closeRow(id);
    else setOpened((prev) => new Set(prev).add(id));
  }

  function handleSubjectClick(subjectId: string) {
    useBidsStore.getState().selectSubject(subjectId);
    toggleRow(subjectRowId(subjectId));
  }

  function handleGroupClick(row: Extract<TreeRow, { kind: 'group' }>) {
    if (row.name.startsWith('task-')) {
      useBidsStore.getState().selectCell(row.subjectId, null, row.name.slice('task-'.length));
    }
    toggleRow(row.id);
  }

  const showTree = detection === 'yes' && indexForRoot && subjects.length > 0;

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

      {detection === 'yes' && !indexForRoot && (
        <div className="fb-bids-yes">
          <Notice severity="success" className="fb-bids-status">BIDS dataset detected.</Notice>
          <p className="fb-bids-hint">
            {scanStatus === 'scanning'
              ? 'Scanning. The BIDS Explorer shows participants as they are read.'
              : 'The BIDS Explorer shows what exists, what is missing and what looks wrong.'}
          </p>
          <div className="fb-bids-actions">
            {inExplorer ? null : (
              <Button variant="primary" size="sm" onClick={openInWorkspace}>
                Open BIDS Explorer
              </Button>
            )}
            {scanStatus === 'scanning' ? null : (
              <Button variant="secondary" size="sm" onClick={startScan}>
                Scan Dataset
              </Button>
            )}
          </div>
        </div>
      )}

      {showTree && (
        <>
          <div className="fb-bids-tree-header">
            <span className="fb-bids-tree-label">
              {subjects.length} participant{subjects.length === 1 ? '' : 's'}
              {withoutImages > 0 ? ` · ${withoutImages} with no images here` : ''}
              <span className="fb-bids-follows"> · follows selection</span>
            </span>
            {inExplorer ? null : (
              <Button variant="primary" size="sm" onClick={openInWorkspace}>
                Open BIDS Explorer
              </Button>
            )}
          </div>
          <div
            ref={treeRef}
            className="fb-bids-tree"
            role="tree"
            aria-label="BIDS subjects"
            onKeyDown={roving.onKeyDown}
          >
            {visibleRows.map((row) => {
              const { ref, ...itemProps } = roving.getItemProps(row.id);
              const branch = (name: string, meta: string, onSelect: () => void) => {
                const open = expanded.has(row.id);
                return (
                  <SelectableRow
                    key={row.id}
                    ref={ref}
                    {...itemProps}
                    role="treeitem"
                    aria-level={row.level + 1}
                    aria-expanded={open}
                    indent={row.level}
                    onSelect={onSelect}
                    className="fb-bids-tree-row fb-bids-tree-row--task"
                  >
                    <span className="fb-bids-tree-chevron" aria-hidden>
                      {open ? <VscChevronDown /> : <VscChevronRight />}
                    </span>
                    <span className="fb-bids-tree-name">{name}</span>
                    <span className="fb-bids-tree-meta">{meta}</span>
                  </SelectableRow>
                );
              };
              if (row.kind === 'session') {
                return branch(formatSessionId(row.session), '', () => toggleRow(row.id));
              }
              if (row.kind === 'group') {
                return branch(row.name, String(row.count), () => handleGroupClick(row));
              }
              if (row.kind === 'run') {
                const name = runFileName(row.run);
                return (
                  <SelectableRow
                    key={row.id}
                    ref={ref}
                    {...itemProps}
                    role="treeitem"
                    aria-level={row.level + 1}
                    indent={row.level}
                    selected={row.run.id === selectedRunId}
                    data-run-id={row.run.id}
                    title={row.run.id}
                    onSelect={() => useBidsStore.getState().selectRun(row.run.id)}
                    onDoubleClick={() => void openRunInViewer(row.run)}
                    className="fb-bids-tree-row fb-bids-tree-row--task"
                  >
                    <span className="fb-bids-tree-chevron-spacer" aria-hidden />
                    <span className="fb-bids-tree-name">{truncateBidsName(name, RUN_NAME_CHARS)}</span>
                    <span className="fb-bids-tree-meta">{formatSize(row.run.size_bytes)}</span>
                  </SelectableRow>
                );
              }
              const subjectId = row.subjectId;
              const tasks = tasksBySubject.get(subjectId) ?? [];
              const isExpanded = expanded.has(row.id);
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
                  <span className="fb-bids-tree-name">{formatSubjectId(subjectId)}</span>
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
