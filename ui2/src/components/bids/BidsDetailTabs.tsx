import React, { useEffect, useState, useMemo } from 'react';
import { useBidsStore } from '@/stores/bidsStore';
import type { BidsDetailTab, BidsSelection, BidsEventRow } from '@/stores/bidsStore';
import { BidsValidationPanel } from './BidsValidationPanel';
import { BidsEventsTimeline } from './BidsEventsTimeline';

const TABS: { id: BidsDetailTab; label: string }[] = [
  { id: 'events', label: 'EVENTS' },
  { id: 'validation', label: 'VALIDATION' },
];

interface EventsTabContentProps {
  selection: BidsSelection;
}

function EventsTabContent({ selection }: EventsTabContentProps) {
  const isFunctional = selection.modality !== null && selection.modality.includes('func');

  const summary = useBidsStore((state) => state.summary);
  const loadEvents = useBidsStore((state) => state.loadEvents);

  const [events, setEvents] = useState<BidsEventRow[]>([]);
  const [loading, setLoading] = useState(false);

  // Find the task id from the coverage column that matches this selection
  const task = useMemo(() => {
    if (!summary || !selection.modality) return null;
    const col = summary.coverage.columns.find(
      (c) =>
        c.modality === selection.modality &&
        (c.session ?? null) === selection.sessionId,
    );
    return col?.task ?? null;
  }, [summary, selection.modality, selection.sessionId]);

  useEffect(() => {
    if (!isFunctional || !selection.subjectId || !task) {
      setEvents([]);
      return;
    }

    let cancelled = false;
    setLoading(true);

    void loadEvents(
      selection.subjectId,
      task,
      selection.sessionId ?? undefined,
    ).then((rows) => {
      if (!cancelled) {
        setEvents(rows);
        setLoading(false);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [isFunctional, selection.subjectId, selection.sessionId, task, loadEvents]);

  if (!isFunctional) {
    return (
      <p className="bf-role-body text-muted-foreground">
        Select a functional run in the coverage matrix to view its event timeline
      </p>
    );
  }

  if (loading) {
    return (
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          fontFamily: 'var(--app-font-mono)',
          fontSize: 11,
          color: 'hsla(var(--foreground) / 0.4)',
          letterSpacing: '0.08em',
        }}
      >
        <svg
          className="animate-spin"
          width="12"
          height="12"
          viewBox="0 0 12 12"
          fill="none"
          aria-hidden="true"
        >
          <circle cx="6" cy="6" r="4" stroke="currentColor" strokeWidth="1.5" className="text-border" />
          <path d="M6 2a4 4 0 0 1 4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" className="text-primary" />
        </svg>
        LOADING EVENTS&hellip;
      </div>
    );
  }

  if (!task) {
    return (
      <p className="bf-role-body text-muted-foreground">
        No task identifier found for the selected run
      </p>
    );
  }

  return <BidsEventsTimeline events={events} />;
}

function ValidationTabContent() {
  return <BidsValidationPanel />;
}

export function BidsDetailTabs() {
  const activeTab = useBidsStore(state => state.activeDetailTab);
  const setTab = useBidsStore(state => state.setDetailTab);
  const selection = useBidsStore(state => state.selection);

  return (
    <div className="flex flex-col h-full">
      {/* Tab bar */}
      <div className="flex border-b border-border px-4 shrink-0">
        {TABS.map(tab => (
          <button
            key={tab.id}
            onClick={() => setTab(tab.id)}
            className={`bf-role-section py-2 px-3 transition-colors duration-200 ${
              activeTab === tab.id
                ? 'text-foreground border-b-2 border-primary'
                : 'text-muted-foreground border-b-2 border-transparent hover:text-foreground/70'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto p-4 min-h-0">
        {activeTab === 'events' && <EventsTabContent selection={selection} />}
        {activeTab === 'validation' && <ValidationTabContent />}
      </div>
    </div>
  );
}
