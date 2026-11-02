import React, { useMemo } from 'react';
import type { BidsEventRow, BidsRunDetail, BidsRunRecord } from '@brainflow/api';
import { TimelineLegend } from '@/components/bids/BidsEventsTimeline';
import { trialTypeColors } from '@/components/bids/trialTypeColor';
import { BidsChecks } from './BidsChecks';

const W = 316;
const H = 24;

function trialTypesOf(events: readonly BidsEventRow[]) {
  return [...new Set(events.map((event) => event.trial_type))];
}

function CompactTimeline({ events, duration }: { events: readonly BidsEventRow[]; duration: number }) {
  const types = useMemo(() => trialTypesOf(events), [events]);
  const colors = useMemo(() => trialTypeColors(types), [types]);
  const lane = H / Math.max(1, types.length);
  const x = (t: number) => (t / duration) * W;
  const ticks: number[] = [];
  for (let t = 0; t <= duration; t += 60) ticks.push(t);
  return (
    <svg
      viewBox={`0 0 ${W} ${H + 12}`}
      className="block w-full"
      role="img"
      aria-label={`Events timeline, ${events.length} events`}
      data-testid="bids-events-timeline"
    >
      {events.map((event, i) => (
        <rect
          key={i}
          x={x(event.onset)}
          y={types.indexOf(event.trial_type) * lane + 1}
          width={Math.max(1.2, x(event.duration))}
          height={Math.max(1, lane - 2)}
          fill={colors.get(event.trial_type)}
        />
      ))}
      {ticks.map((t) => (
        <text
          key={t}
          x={x(t)}
          y={H + 10}
          fontSize={9}
          fill="var(--bf-text-faint)"
          fontFamily="var(--bf-font-mono)"
          textAnchor={t === 0 ? 'start' : 'middle'}
        >
          {t}
          {t === 0 ? ' s' : ''}
        </text>
      ))}
    </svg>
  );
}

export function BidsRunEvents({
  run,
  events,
  detail,
}: {
  run: BidsRunRecord;
  events: readonly BidsEventRow[];
  detail: BidsRunDetail;
}) {
  const types = useMemo(() => trialTypesOf(events), [events]);
  const colors = useMemo(() => trialTypeColors(types), [types]);
  if (events.length === 0) {
    return <p className="m-0 text-bf-xs text-bf-text-muted">The events file for {run.id} has no rows.</p>;
  }
  const end = Math.max(...events.map((event) => event.onset + event.duration));
  return (
    <div className="flex flex-col gap-1">
      <CompactTimeline events={events} duration={detail.events_duration ?? end} />
      <TimelineLegend trialTypes={types} colors={colors} />
      <BidsChecks checks={detail.event_checks} />
    </div>
  );
}
