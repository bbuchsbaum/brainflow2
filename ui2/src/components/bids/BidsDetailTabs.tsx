import React, { useEffect, useState, useMemo } from 'react';
import { useBidsStore } from '@/stores/bidsStore';
import type { BidsDetailTab, BidsSelection, BidsEventRow } from '@/stores/bidsStore';
import { BidsValidationPanel } from './BidsValidationPanel';
import { BidsEventsTimeline } from './BidsEventsTimeline';

const TABS: { id: BidsDetailTab; label: string }[] = [
  { id: 'events', label: 'Events' },
  { id: 'validation', label: 'Validation' },
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
          fontSize: 11,
          color: 'hsl(var(--muted-foreground))',
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
        Loading events&hellip;
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
      <div role="tablist" aria-label="BIDS run details" className="flex border-b border-border px-4 shrink-0">
        {TABS.map(tab => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={activeTab === tab.id}
            onClick={() => setTab(tab.id)}
            className={`bf-role-section py-2 px-3 transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background ${
              activeTab === tab.id
                ? 'bg-bf-bg-active text-foreground shadow-[inset_0_-2px_0_var(--bf-text-muted)]'
                : 'text-muted-foreground hover:bg-accent hover:text-foreground'
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
