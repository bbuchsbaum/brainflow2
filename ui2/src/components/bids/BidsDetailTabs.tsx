import React, { useEffect, useState, useMemo } from 'react';
import { useBidsStore } from '@/stores/bidsStore';
import type { BidsDetailTab, BidsSelection, BidsEventRow } from '@/stores/bidsStore';
import { BidsValidationPanel } from './BidsValidationPanel';
import { BidsEventsTimeline } from './BidsEventsTimeline';
import { Notice, TabPanel, Tabs, type TabItem } from '@/components/ui/bf';

const TABS: readonly TabItem[] = [
  { value: 'events', label: 'Events' },
  { value: 'validation', label: 'Validation' },
];

const TABS_ID = 'bids-detail';

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
      <Notice severity="neutral" role={undefined}>
        Select a functional run in the coverage matrix to view its event timeline
      </Notice>
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
      <Notice severity="neutral" role={undefined}>
        No task identifier found for the selected run
      </Notice>
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
      <Tabs
        idBase={TABS_ID}
        aria-label="BIDS run details"
        items={TABS}
        value={activeTab}
        onValueChange={(value) => setTab(value as BidsDetailTab)}
        className="shrink-0 border-b border-border px-2"
      />

      {TABS.map((tab) => (
        <TabPanel
          key={tab.value}
          idBase={TABS_ID}
          value={tab.value}
          selected={activeTab}
          className="min-h-0 flex-1 overflow-auto p-4"
        >
          {tab.value === 'events' ? (
            <EventsTabContent selection={selection} />
          ) : (
            <ValidationTabContent />
          )}
        </TabPanel>
      ))}
    </div>
  );
}
